// Secure audio streaming with R2 integration using SecStream package
import { SessionManager } from 'secstream/server'
import { SecureAudioServer } from 'secstream/server'
import { parseAudioMetadata } from 'secstream/server'

export interface Env {
  AUDIO_BUCKET: R2Bucket
  ALLOWED_ORIGINS?: string
}

interface ExportedHandler<Env = unknown> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(request, env.ALLOWED_ORIGINS)
    }

    const url = new URL(request.url)
    
    try {
      // Initialize SecStream components
      const sessionManager = new SessionManager({
        sliceDurationMs: 5000,
        compressionLevel: 6
      })
      const api = new SecureAudioServer(sessionManager)

      // Route: Get audio from R2 and create session
      if (request.method === 'POST' && url.pathname === '/api/sessions/from-r2') {
        return handleCreateSessionFromR2(request, env, sessionManager)
      }

      // Route: SecStream API endpoints
      if (url.pathname.startsWith('/api/sessions')) {
        return handleSecStreamAPI(request, api, env.ALLOWED_ORIGINS)
      }

      return new Response('Not Found', { status: 404 })

    } catch (error) {
      console.error('Worker error:', error)
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
}

export default worker

async function handleCreateSessionFromR2(
  request: Request, 
  env: Env, 
  sessionManager: SessionManager
): Promise<Response> {
  try {
    const requestBody = await request.json() as { key?: unknown }
    const { key } = requestBody
    
    if (!key || typeof key !== 'string') {
      return new Response(JSON.stringify({ 
        error: 'Missing or invalid R2 object key' 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Retrieve audio file from R2
    const object = await env.AUDIO_BUCKET.get(key)
    
    if (!object) {
      return new Response(JSON.stringify({ 
        error: 'Audio file not found in R2' 
      }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Convert R2Object stream to ArrayBuffer
    const audioBuffer = await object.arrayBuffer()

    // Parse audio metadata for format validation
    const metadata = parseAudioMetadata(audioBuffer)
    console.log(`Processing ${key}: ${metadata.format}, duration: ${metadata.duration}s`)

    // Create secure session
    const sessionId = await sessionManager.createSession(audioBuffer)

    // Get session info for client
    const sessionInfo = sessionManager.getSessionInfo(sessionId)

    return new Response(JSON.stringify({
      sessionId,
      metadata,
      sessionInfo,
      r2Key: key
    }), {
      status: 201,
      headers: { 
        'Content-Type': 'application/json',
        ...getCorsHeaders(request.headers.get('Origin'))
      }
    })

  } catch (error) {
    console.error('Error creating session from R2:', error)
    return new Response(JSON.stringify({ 
      error: 'Failed to create session',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

async function handleSecStreamAPI(
  request: Request, 
  api: SecureAudioServer,
  allowedOrigins?: string
): Promise<Response> {
  const url = new URL(request.url)
  
  // Extract path relative to /api/sessions
  const apiPath = url.pathname.replace('/api/sessions', '') || '/'
  const method = request.method

  try {
    let response: Response

    // Route requests to SecureAudioAPI
    if (method === 'POST' && apiPath === '/') {
      // Create session (direct upload)
      const formData = await request.formData()
      const audioFile = formData.get('audio') as File
      
      if (!audioFile) {
        return new Response(JSON.stringify({ error: 'No audio file provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const audioBuffer = await audioFile.arrayBuffer()
      const result = await api.createSession(audioBuffer)
      response = new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      })

    } else if (method === 'POST' && apiPath.match(/^\/[\w-]+\/key-exchange$/)) {
      // Key exchange
      const sessionId = apiPath.split('/')[1]
      const keyExchangeData = await request.json() as Record<string, unknown>
      const result = await api.handleKeyExchange(sessionId, keyExchangeData)
      response = new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      })

    } else if (method === 'GET' && apiPath.match(/^\/[\w-]+\/info$/)) {
      // Session info
      const sessionId = apiPath.split('/')[1]
      const result = await api.getSessionInfo(sessionId)
      if (!result) {
        response = new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      } else {
        response = new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

    } else if (method === 'GET' && apiPath.match(/^\/[\w-]+\/slices\/[\w-]+$/)) {
      // Get slice
      const pathParts = apiPath.split('/')
      const sessionId = pathParts[1]
      const sliceId = pathParts[3]
      const result = await api.getSlice(sessionId, sliceId)
      if (!result) {
        response = new Response(JSON.stringify({ error: 'Slice not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      } else {
        response = new Response(result.encryptedData, {
          headers: { 
            'Content-Type': 'application/octet-stream',
            'X-Slice-Id': result.id,
            'X-Slice-IV': Array.from(new Uint8Array(result.iv)).join(','),
            'X-Slice-Sequence': result.sequence.toString(),
            'X-Session-Id': result.sessionId
          }
        })
      }

    } else {
      response = new Response('Not Found', { status: 404 })
    }

    // Add CORS headers to successful responses
    if (response.status < 400) {
      const corsHeaders = getCorsHeaders(request.headers.get('Origin'), allowedOrigins)
      const newHeaders = new Headers(response.headers)
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value)
      })
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      })
    }

    return response

  } catch (error) {
    console.error('SecStream API error:', error)
    return new Response(JSON.stringify({ 
      error: 'API request failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

function handleCors(request: Request, allowedOrigins?: string): Response {
  const corsHeaders = getCorsHeaders(request.headers.get('Origin'), allowedOrigins)
  
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  })
}

function getCorsHeaders(origin: string | null, allowedOrigins?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  
  if (origin) {
    if (allowedOrigins) {
      const allowed = allowedOrigins.split(',').map(o => o.trim())
      if (allowed.includes(origin) || allowed.includes('*')) {
        headers['Access-Control-Allow-Origin'] = origin
        headers['Vary'] = 'Origin'
      }
    } else {
      // Development mode - allow all origins
      headers['Access-Control-Allow-Origin'] = origin
      headers['Vary'] = 'Origin'
    }
  }
  
  return headers
}