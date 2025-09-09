// SecStream worker with R2 integration and optional key prefix
import { parseAudioMetadata, SecureAudioServer, SessionManager } from 'secstream/server';

export interface Env {
  // R2 binding produced by wrangler.toml (configured via scripts/configure.mjs)
  AUDIO_BUCKET: R2Bucket;
  // Optional CORS allowlist, comma-separated. If omitted, allows request origin (dev-friendly)
  ALLOWED_ORIGINS?: string;
  // Optional key prefix used as the R2 root for requests
  KEY_PREFIX?: string;
}

interface ExportedHandler<Environment = unknown> {
  fetch: (request: Request, env: Environment, ctx: ExecutionContext) => Promise<Response> | Response;
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(request, env.ALLOWED_ORIGINS);
    }

    const url = new URL(request.url);

    try {
      // Initialize SecStream components
      const sessionManager = new SessionManager({
        sliceDurationMs: 5000,
        compressionLevel: 6,
      });
      const api = new SecureAudioServer(sessionManager);

      // Route: Create session from R2 using path-based addressing with optional KEY_PREFIX
      // Example: POST /api/sessions/from-r2/music/track.mp3
      if (request.method === 'POST' && url.pathname.startsWith('/api/sessions/from-r2/')) {
        const relativePath = url.pathname.replace('/api/sessions/from-r2/', '');
        return handleCreateSessionFromR2Path(relativePath, request, env, sessionManager);
      }

      // Backward-compatible Route: JSON body { key } (relative to optional KEY_PREFIX)
      if (request.method === 'POST' && url.pathname === '/api/sessions/from-r2') {
        return handleCreateSessionFromR2Body(request, env, sessionManager);
      }

      // Route: SecStream API endpoints
      if (url.pathname.startsWith('/api/sessions')) {
        return handleSecStreamAPI(request, api, env.ALLOWED_ORIGINS);
      }

      return new Response('Not Found', { status: 404 });
    } catch(error) {
      console.error('Worker error:', error);
      return json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  },
};

export default worker;

function resolveObjectKey(rawKey: string, prefix?: string): string {
  const cleaned = rawKey.replace(/^\/+/, ''); // trim leading slashes
  const p = (prefix ?? '').replace(/^\/+|\/+$/g, ''); // trim both sides
  if (!p)
    return cleaned;
  return `${p}/${cleaned}`;
}

async function handleCreateSessionFromR2Path(
  relativePath: string,
  request: Request,
  env: Env,
  sessionManager: SessionManager,
): Promise<Response> {
  if (!relativePath || relativePath === '/') {
    return json({ error: 'Missing object key in path' }, 400);
  }

  const key = resolveObjectKey(relativePath, env.KEY_PREFIX);
  return createSessionFromR2Key(key, request, env, sessionManager);
}

async function handleCreateSessionFromR2Body(
  request: Request,
  env: Env,
  sessionManager: SessionManager,
): Promise<Response> {
  try {
    const requestBody = await request.json().catch(() => ({})) as { key?: unknown };
    const key = typeof requestBody.key === 'string' ? requestBody.key : undefined;
    if (!key) {
      return json({ error: 'Missing or invalid R2 object key' }, 400);
    }

    const resolved = resolveObjectKey(key, env.KEY_PREFIX);
    return createSessionFromR2Key(resolved, request, env, sessionManager);
  } catch(error) {
    console.error('Error parsing body for create-session:', error);
    return json({ error: 'Invalid request body' }, 400);
  }
}

async function createSessionFromR2Key(
  key: string,
  request: Request,
  env: Env,
  sessionManager: SessionManager,
): Promise<Response> {
  try {
    // Retrieve audio file from R2
    const object = await env.AUDIO_BUCKET.get(key);
    if (!object) {
      return json({ error: 'Audio file not found in R2', key }, 404);
    }

    // Convert R2 object to ArrayBuffer
    const audioBuffer = await object.arrayBuffer();

    // Parse audio metadata for format validation
    const metadata = parseAudioMetadata(audioBuffer);
    console.log(`Processing ${key}: ${metadata.format}, duration: ${metadata.duration}s`);

    // Create secure session
    const sessionId = await sessionManager.createSession(audioBuffer);

    // Get session info for client
    const sessionInfo = sessionManager.getSessionInfo(sessionId);

    return withCors(request, json({
      sessionId,
      metadata,
      sessionInfo,
      r2Key: key,
    }, 201));
  } catch(error) {
    console.error('Error creating session from R2:', error);
    return json({
      error: 'Failed to create session',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

async function handleSecStreamAPI(
  request: Request,
  api: SecureAudioServer,
  allowedOrigins?: string,
): Promise<Response> {
  const url = new URL(request.url);
  const apiPath = url.pathname.replace('/api/sessions', '') || '/';
  const method = request.method;

  try {
    let response: Response;

    if (method === 'POST' && apiPath === '/') {
      // Create session (direct upload)
      const formData = await request.formData();
      const audioFile = formData.get('audio') as File;
      if (!audioFile)
        return json({ error: 'No audio file provided' }, 400);

      const audioBuffer = await audioFile.arrayBuffer();
      const result = await api.createSession(audioBuffer);
      response = json(result);
    } else if (method === 'POST' && apiPath.match(/^\/[\w-]+\/key-exchange$/)) {
      // Key exchange
      const sessionId = apiPath.split('/')[1];
      const keyExchangeData = await request.json() as Record<string, unknown>;
      const result = await api.handleKeyExchange(sessionId, keyExchangeData);
      response = json(result);
    } else if (method === 'GET' && apiPath.match(/^\/[\w-]+\/info$/)) {
      // Session info
      const sessionId = apiPath.split('/')[1];
      const result = await api.getSessionInfo(sessionId);
      if (!result)
        return json({ error: 'Session not found' }, 404);
      response = json(result);
    } else if (method === 'GET' && apiPath.match(/^\/[\w-]+\/slices\/[\w-]+$/)) {
      // Get slice
      const pathParts = apiPath.split('/');
      const sessionId = pathParts[1];
      const sliceId = pathParts[3];
      const result = await api.getSlice(sessionId, sliceId);
      if (!result)
        return json({ error: 'Slice not found' }, 404);
      response = new Response(result.encryptedData, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Slice-Id': result.id,
          'X-Slice-IV': Array.from(new Uint8Array(result.iv)).join(','),
          'X-Slice-Sequence': result.sequence.toString(),
          'X-Session-Id': result.sessionId,
        },
      });
    } else {
      response = new Response('Not Found', { status: 404 });
    }

    // Add CORS headers to successful responses
    if (response.status < 400) {
      const corsHeaders = getCorsHeaders(request.headers.get('Origin'), allowedOrigins);
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
    return response;
  } catch(error) {
    console.error('SecStream API error:', error);
    return json({
      error: 'API request failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

function handleCors(request: Request, allowedOrigins?: string): Response {
  const corsHeaders = getCorsHeaders(request.headers.get('Origin'), allowedOrigins);
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function getCorsHeaders(origin: string | null, allowedOrigins?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (origin) {
    if (allowedOrigins) {
      const allowed = allowedOrigins.split(',').map(o => o.trim());
      if (allowed.includes(origin) || allowed.includes('*')) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers.Vary = 'Origin';
      }
    } else {
      // Development mode - allow request origin
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
  }
  return headers;
}

function json(body: unknown, status = 200, headers: Record<string, string> = { 'Content-Type': 'application/json' }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(request: Request, response: Response): Response {
  if (response.status >= 400)
    return response;
  const corsHeaders = getCorsHeaders(request.headers.get('Origin'));
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}
