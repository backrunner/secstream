import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { SessionManager } from 'secstream/server';
import { parseAudioMetadata } from 'secstream/server';
import { calculateSliceCrc32 } from './utils/crc32.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Serve static files from public directory
app.use('/public/*', serveStatic({ root: './' }));
// Serve root dist files from parent directory (SecStream client library)
app.use('/dist/client/*', serveStatic({ root: '../' }));
app.use('/dist/shared/*', serveStatic({ root: '../' }));
// Serve demo dist files from current directory
app.use('/dist/demo-transport.js', serveStatic({ root: './' }));
app.use('/dist/utils/*', serveStatic({ root: './' }));
app.use('/*', serveStatic({
  root: './public',
  rewriteRequestPath: (path) => path.replace(/^\//, ''),
}));

// Create session manager with optimized settings for low latency streaming
const sessionManager = new SessionManager({
  sliceDurationMs: 5000, // 5 second slices
  compressionLevel: 6,
  // Prewarm optimization: prepare first 3 slices during key exchange
  // This reduces initial playback latency by having slices ready immediately
  prewarmSlices: 3,
  prewarmConcurrency: 3,
  // Cache settings for better performance
  serverCacheSize: 10,
  serverCacheTtlMs: 300_000, // 5 minutes
});

// Create a second session manager with randomized slice lengths
const randomizedSessionManager = new SessionManager({
  sliceDurationMs: 5000, // Average slice duration
  compressionLevel: 6,
  randomizeSliceLength: true,  // Enable randomization
  sliceLengthVariance: 0.4,     // ±40% variance
  prewarmSlices: 3,
  prewarmConcurrency: 3,
  serverCacheSize: 10,
  serverCacheTtlMs: 300_000,
});

// Track which session belongs to which manager
const sessionManagerMap = new Map<string, SessionManager>();

// API Routes
app.post('/api/sessions', async (c) => {
  try {
    console.log('📥 Received session creation request');
    const formData = await c.req.formData();
    console.log('📋 Form data keys:', Array.from(formData.keys()));

    const audioFile = formData.get('audio') as File;
    const randomizeSliceLength = formData.get('randomizeSliceLength') === 'true';

    if (!audioFile) {
      console.error('❌ No audio file provided in request');
      return c.json({ error: 'No audio file provided' }, 400);
    }

    console.log('📁 Audio file details:', {
      name: audioFile.name,
      size: audioFile.size,
      type: audioFile.type,
      randomizeSliceLength,
    });

    const audioBuffer = await audioFile.arrayBuffer();
    console.log('📊 Audio buffer size:', audioBuffer.byteLength);

    // Detect audio format
    console.log('🔍 Detecting audio format...');
    const metadata = parseAudioMetadata(audioBuffer);
    console.log(`📄 Detected format: ${metadata.format}, Sample rate: ${metadata.sampleRate}Hz, Channels: ${metadata.channels}`);

    // Select the appropriate session manager based on configuration
    const activeSessionManager = randomizeSliceLength ? randomizedSessionManager : sessionManager;
    console.log(`🔧 Using ${randomizeSliceLength ? 'randomized' : 'standard'} session manager`);

    // Create session
    console.log('🏗️ Creating session with SessionManager...');
    const sessionId = await activeSessionManager.createSession(audioBuffer);
    console.log('✅ Session created successfully:', sessionId);

    // Track which manager this session belongs to
    sessionManagerMap.set(sessionId, activeSessionManager);

    const response = {
      sessionId,
      metadata: {
        format: metadata.format,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        duration: metadata.duration,
      },
      configuration: {
        randomizeSliceLength,
      },
      message: 'Session created successfully',
    };

    console.log('📤 Sending successful response:', response);
    return c.json(response);
  } catch (error: unknown) {
    console.error('❌ Session creation error:', error);
    console.error('❌ Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'Unknown stack',
      name: error instanceof Error ? error.name : 'Unknown error'
    });

    const errorResponse = {
      error: 'Failed to create session',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    };
    console.error('📤 Sending error response:', errorResponse);
    return c.json(errorResponse, 500);
  }
});

app.post('/api/sessions/:sessionId/key-exchange', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const keyExchangeRequest = await c.req.json();

    console.log(`🔑 Key exchange for session: ${sessionId}`);

    // Get the correct session manager for this session
    const activeSessionManager = sessionManagerMap.get(sessionId) || sessionManager;
    const response = await activeSessionManager.handleKeyExchange(sessionId, keyExchangeRequest);

    return c.json(response);
  } catch (error) {
    console.error('❌ Key exchange error:', error);
    return c.json({ error: 'Key exchange failed' }, 500);
  }
});

app.get('/api/sessions/:sessionId/info', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');

    // Get the correct session manager for this session
    const activeSessionManager = sessionManagerMap.get(sessionId) || sessionManager;
    const info = activeSessionManager.getSessionInfo(sessionId);

    if (!info) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json(info);
  } catch (error) {
    console.error('❌ Get session info error:', error);
    return c.json({ error: 'Failed to get session info' }, 500);
  }
});

app.get('/api/sessions/:sessionId/slices/:sliceId', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const sliceId = c.req.param('sliceId');

    // Get the correct session manager for this session
    const activeSessionManager = sessionManagerMap.get(sessionId) || sessionManager;
    const slice = await activeSessionManager.getSlice(sessionId, sliceId);

    if (!slice) {
      return c.json({ error: 'Slice not found' }, 404);
    }

    // Calculate CRC32 hash for integrity checking
    const crc32Hash = calculateSliceCrc32(slice.encryptedData, slice.iv);

    // Combine encrypted data and IV into single binary payload
    const combinedData = new Uint8Array(slice.encryptedData.byteLength + slice.iv.byteLength);
    combinedData.set(new Uint8Array(slice.encryptedData), 0);
    combinedData.set(new Uint8Array(slice.iv), slice.encryptedData.byteLength);

    // Set metadata in HTTP headers
    c.header('X-Slice-ID', slice.id);
    c.header('X-Slice-Sequence', slice.sequence.toString());
    c.header('X-Session-ID', slice.sessionId);
    c.header('X-Encrypted-Data-Length', slice.encryptedData.byteLength.toString());
    c.header('X-IV-Length', slice.iv.byteLength.toString());
    c.header('X-CRC32-Hash', crc32Hash);
    c.header('Content-Type', 'application/octet-stream');

    console.log(`🔐 Serving binary slice: ${sliceId}, size: ${combinedData.byteLength} bytes, hash: ${crc32Hash}`);

    // Return pure binary data
    return new Response(combinedData.buffer);
  } catch (error) {
    console.error('❌ Get slice error:', error);
    return c.json({ error: 'Failed to get slice' }, 500);
  }
});

// Stats endpoint
app.get('/api/stats', (c) => {
  const stats = sessionManager.getStats();
  return c.json({
    server: 'hono',
    framework: 'secstream',
    timestamp: new Date().toISOString(),
    ...stats,
  });
});

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Serve demo page
app.get('/', async (c) => {
  try {
    const html = await readFile('./public/index.html', 'utf-8');
    return c.html(html);
  } catch (error) {
    return c.html(`
      <h1>SecStream Demo</h1>
      <p>Demo page not found. Please check if public/index.html exists.</p>
    `);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not found',
    available_endpoints: [
      'GET /',
      'POST /api/sessions',
      'POST /api/sessions/:sessionId/key-exchange',
      'GET /api/sessions/:sessionId/info',
      'GET /api/sessions/:sessionId/slices/:sliceId',
      'GET /api/stats',
      'GET /health',
    ],
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('❌ Server error:', err);
  return c.json({
    error: 'Internal server error',
    message: err.message,
  }, 500);
});

const port = 3000;

console.log('🚀 SecStream Demo Server Starting...');
console.log(`📡 Server will run on http://localhost:${port}`);
console.log('🎵 Upload audio files to test secure streaming');
console.log('🔒 Features: Multi-format support, Encryption, Cloudflare Workers compatible');

serve({
  fetch: app.fetch,
  port,
});

console.log(`✅ Server running on http://localhost:${port}`);
console.log('📋 Endpoints:');
console.log('  GET  /              - Demo page');
console.log('  POST /api/sessions  - Create session');
console.log('  GET  /api/stats     - Server statistics');
console.log('  GET  /health        - Health check');