# SecStream 🔐🎵

A secure audio streaming library that prevents client-side audio piracy through encryption, slicing, and customizable processing components.

[![npm version](https://badge.fury.io/js/secstream.svg)](https://badge.fury.io/js/secstream)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## ✨ Features

- 🔐 **End-to-End Encryption**: ECDH key exchange with AES-GCM encryption by default
- 🎵 **Multi-Format Audio**: WAV, MP3, FLAC, and OGG support
- 🎵 **Secure Audio Slicing**: Encrypted chunks prevent piracy
- 🛡️ **Memory Protection**: Buffer disposal prevents audio extraction
- 🌐 **Framework Agnostic**: Works with Express, Hono, Cloudflare Workers
- 🎮 **Full Playback Control**: Play, pause, stop, seek with precision
- 🆔 **Customizable Slice IDs**: Multiple generation strategies
- 🚀 **Cross-Platform**: Node.js, browsers, Deno, and Bun

## 🚀 Quick Start

### Installation

```bash
npm install secstream
```

### Server Side (Node.js/Hono/Cloudflare Workers)

```typescript
import { SessionManager, SecureAudioAPI, honoHandler } from 'secstream/server'
import { Hono } from 'hono'

const app = new Hono()

// Create session manager with custom slice ID generator
const sessionManager = new SessionManager({
  sliceDurationMs: 5000,
  compressionLevel: 6,
  // Optional: Use custom slice ID generator
  // sliceIdGenerator: new UuidSliceIdGenerator() // or TimestampSliceIdGenerator(), etc.
})

// Create API
const api = new SecureAudioAPI(sessionManager)

// Mount API routes
app.all('/api/*', honoHandler(api))

export default app
```

### Client Side (Browser)

```typescript
import { SecStreamClient } from 'secstream/client'

// Create client
const client = new SecStreamClient({
  serverUrl: 'https://your-server.com',
  bufferSize: 5,
  prefetchSize: 3
})

// Load and play audio
const audioFile = document.getElementById('audioInput').files[0]
const player = await client.createSession(audioFile)
await player.play()

// Control playback
player.pause()
player.stop()
await player.seek(30) // Seek to 30 seconds
```

## 📦 Package Structure

SecStream is designed with **complete separation** between client and server code to ensure optimal bundle sizes and prevent code contamination.

### Import Paths

**For Server-Side (Node.js, Cloudflare Workers, etc.):**
```typescript
// ✅ Correct - Only imports server code
import { SessionManager, AudioProcessor } from 'secstream/server'
import type { SessionManagerConfig, AudioProcessorConfig } from 'secstream/server'
```

**For Client-Side (Browser, React, Vue, etc.):**
```typescript
// ✅ Correct - Only imports client code
import { SecureAudioClient, SecureAudioPlayer } from 'secstream/client'
import type { ClientConfig, PlayerConfig } from 'secstream/client'
```

**For Shared Types and Utilities:**
```typescript
// ✅ For isomorphic/shared code - imports everything
import type { AudioConfig, CompressionLevel, EncryptionAlgorithm } from 'secstream'
import { NanoidSliceIdGenerator, AesGcmEncryptionProcessor } from 'secstream'
```

### Bundle Sizes (v0.1.0)

| Import Path | Bundle Size | Contains |
|------------|-------------|----------|
| `secstream/client` | ~69 KB | Client code + shared types |
| `secstream/server` | ~38 KB | Server code + shared types |
| `secstream` | ~106 KB | Everything (client + server + shared) |

### Why Separate Imports?

- **🎯 Optimal Bundle Sizes**: Client apps don't ship with server code
- **🔒 Security**: Server-only code stays on the server
- **⚡ Performance**: Faster load times with smaller bundles
- **🛡️ Type Safety**: TypeScript prevents importing wrong code
- **📦 Tree Shaking**: Better dead code elimination

### Migration Guide

If you're using the main entry point:

```typescript
// ❌ Avoid this - imports everything
import { SessionManager, SecureAudioClient } from 'secstream'

// ✅ Better - use specific entry points
import { SessionManager } from 'secstream/server'
import { SecureAudioClient } from 'secstream/client'
```

The main `secstream` entry point is kept for backward compatibility and shared utilities, but prefer specific entry points for optimal bundle sizes.

## 📚 Documentation

### Server API

#### SessionManager

Manages audio sessions and handles encryption/decryption.

```typescript
const sessionManager = new SessionManager({
  sliceDurationMs: 5000,    // Duration of each slice in ms
  compressionLevel: 6,       // Compression level (0-9)
  encryptionAlgorithm: 'AES-GCM'
})
```

##### Randomized Slice Lengths (Enhanced Security)

For enhanced security against pattern analysis, you can enable randomized slice lengths. This makes each slice have a variable duration while maintaining an average:

```typescript
const sessionManager = new SessionManager({
  sliceDurationMs: 5000,           // Average slice duration (5 seconds)
  randomizeSliceLength: true,      // Enable randomization (default: false)
  sliceLengthVariance: 0.4,        // Variance ±40% (default: 0.4)
  compressionLevel: 6,
})
```

With `randomizeSliceLength: true` and `sliceLengthVariance: 0.4`:
- Average slice duration: 5 seconds
- Actual slice durations will vary between ~3 seconds and ~7 seconds
- Each session uses a different randomization pattern (based on session ID)
- This makes traffic analysis and pattern detection much more difficult

**Configuration Options:**
- `randomizeSliceLength` (boolean, default: `false`): Enable variable-length slicing
- `sliceLengthVariance` (number, 0.0-1.0, default: `0.4`): Variance factor
  - `0.2` = ±20% variance (more predictable)
  - `0.4` = ±40% variance (balanced, recommended)
  - `0.6` = ±60% variance (more random)

**Security Benefits:**
- Makes slice boundaries unpredictable
- Different patterns for each session
- Harder to analyze traffic patterns
- No performance overhead (deterministic randomization)

##### Streaming Optimization (Low Latency Playback)

To minimize initial playback latency, especially when playing from the beginning, use the **prewarm** feature to prepare slices during key exchange:

```typescript
const sessionManager = new SessionManager({
  sliceDurationMs: 5000,
  compressionLevel: 6,
  // Prewarm the first 3 slices (15 seconds of audio) during key exchange
  prewarmSlices: 3,              // Number of slices to prepare ahead (default: 0)
  prewarmConcurrency: 3,         // Parallel workers for prewarming (default: 3)
  // Cache settings
  serverCacheSize: 10,           // Keep 10 slices in memory (default: 10)
  serverCacheTtlMs: 300_000,     // Cache for 5 minutes (default: 300_000)
})
```

**How Prewarm Works:**

1. **Key Exchange Phase**: Client completes ECDH key exchange with server
2. **Background Processing**: Server immediately starts preparing the first N slices in parallel
3. **Non-Blocking**: Key exchange response returns instantly (processing happens async)
4. **Cache Ready**: When client requests first slices, they're already encrypted and cached
5. **Result**: Near-instant playback start with no waiting for encryption

**Latency Comparison:**

| Configuration | First Slice Latency | Use Case |
|---------------|-------------------|----------|
| `prewarmSlices: 0` | ~100-300ms | On-demand processing (default) |
| `prewarmSlices: 1` | ~0-50ms | Instant playback start |
| `prewarmSlices: 3` | ~0-50ms | Smooth initial buffering (recommended) |
| `prewarmSlices: 5` | ~0-50ms | Pre-buffer for network variance |

**Best Practices:**
- For **instant playback**: Set `prewarmSlices: 1` (prepare just the first slice)
- For **smooth streaming**: Set `prewarmSlices: 3-5` (15-25 seconds buffered)
- For **seek-heavy usage**: Keep default `0` (saves server resources)
- Adjust `prewarmConcurrency` based on server CPU cores

**Trade-offs:**
- ✅ Dramatically reduces initial playback latency
- ✅ Better user experience for sequential playback
- ✅ No client-side changes needed
- ⚠️ Uses more server CPU during key exchange
- ⚠️ Not beneficial for random seeking patterns

**Methods:**
- `createSession(audioData: ArrayBuffer | ReadableStream): Promise<string>` - Create new session
- `handleKeyExchange(sessionId: string, request: KeyExchangeRequest): Promise<KeyExchangeResponse>` - Handle key exchange
- `getSlice(sessionId: string, sliceId: string): Promise<EncryptedSlice | null>` - Get encrypted slice
- `destroySession(sessionId: string): void` - Clean up session
- `getStats(): { activeSessions: number }` - Get statistics

**Supported Audio Formats:**
- **WAV**: Full PCM parsing with accurate metadata extraction
- **MP3**: ID3v2 tag detection and MPEG frame parsing
- **FLAC**: Metadata block parsing and stream info extraction
- **OGG**: Format detection and basic metadata support

#### Slice ID Generators

SecStream supports multiple slice ID generation strategies:

```typescript
import {
  NanoidSliceIdGenerator,    // Default - cryptographically secure
  UuidSliceIdGenerator,      // Standard UUID v4 format
  SequentialSliceIdGenerator, // Predictable IDs for debugging
  TimestampSliceIdGenerator, // Time-based ordering
  HashSliceIdGenerator      // Deterministic hash-based IDs
} from 'secstream'

// Use different generators
const sessionManager = new SessionManager({
  // Default: NanoidSliceIdGenerator (recommended for production)
  sliceIdGenerator: new NanoidSliceIdGenerator(21), // Configurable length

  // For maximum compatibility
  // sliceIdGenerator: new UuidSliceIdGenerator(),

  // For debugging (less secure - development only)
  // sliceIdGenerator: new SequentialSliceIdGenerator('debug'),

  // For natural ordering
  // sliceIdGenerator: new TimestampSliceIdGenerator(),

  // For caching scenarios (deterministic)
  // sliceIdGenerator: new HashSliceIdGenerator()
})
```

**Creating Custom Slice ID Generators:**

```typescript
import { SliceIdGenerator } from 'secstream'

class CustomSliceIdGenerator implements SliceIdGenerator {
  constructor(private prefix: string = 'CUSTOM') {}

  generateSliceId(sliceIndex: number, sessionId: string, totalSlices: number): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${this.prefix}_${timestamp}_${sliceIndex}_${random}`;
  }

  getName(): string {
    return `CustomSliceIdGenerator(${this.prefix})`;
  }
}

// Use your custom generator
const sessionManager = new SessionManager({
  sliceIdGenerator: new CustomSliceIdGenerator('MYAPP')
});
```

#### SecureAudioAPI

Provides HTTP API for secure audio streaming.

```typescript
const api = new SecureAudioAPI(sessionManager)
```

**Framework Integrations:**
```typescript
// Hono
app.all('/api/*', honoHandler(api))

// Express
app.use('/api', expressHandler(api))

// Cloudflare Workers
addEventListener('fetch', cloudflareHandler(api))
```

**API Endpoints:**
- `POST /api/sessions` - Create session (body: audio file)
- `POST /api/sessions/:id/key-exchange` - Key exchange
- `GET /api/sessions/:id/info` - Get session info
- `GET /api/sessions/:id/slices/:sliceId` - Get encrypted slice

### Client API

#### SecStreamClient

Main client for creating sessions and managing playback.

```typescript
const client = new SecStreamClient({
  serverUrl: 'https://api.example.com',
  bufferSize: 5,        // Slices to keep in memory
  prefetchSize: 3       // Slices to prefetch ahead
})
```

**Methods:**
- `createSession(audioFile: File | ArrayBuffer): Promise<string>` - Upload and create session
- `loadSession(sessionId: string): Promise<SecureAudioPlayer>` - Load existing session
- `destroy(): void` - Clean up resources

#### SecureAudioPlayer

Controls audio playback with security features.

```typescript
// Playback control
await player.play()
player.pause()
player.stop()
await player.seek(timeInSeconds)

// State monitoring
const state = player.getState()
console.log(state.isPlaying, state.currentTime, state.duration)

// Event handling
player.addEventListener('play', () => console.log('Started'))
player.addEventListener('timeupdate', (e) => console.log(e.detail.currentTime))
player.addEventListener('ended', () => console.log('Finished'))
```

**Properties:**
- `isPlaying: boolean` - Current playback state
- `isPaused: boolean` - Pause state
- `currentTime: number` - Current position in seconds
- `duration: number` - Total duration in seconds
- `volume: number` - Volume level (0-1)

**Events:**
- `play`, `pause`, `stop` - Playback state changes
- `timeupdate` - Time position updates
- `ended` - Playback finished
- `buffering` - Loading audio data
- `canplaythrough` - Ready to play
- `error` - Playback errors

## 🔒 Security Architecture

⚠️ **Important Security Disclaimer**

**SecStream is NOT Digital Rights Management (DRM)**. It provides **content protection** to raise the barrier for audio piracy, but determined attackers with sufficient technical knowledge can still extract content. SecStream is designed to:

- Make casual piracy significantly more difficult
- Prevent direct file downloads and simple extraction
- Add technical friction to the piracy process
- Require understanding of encryption protocols to extract content

**What SecStream does:**
- ✅ Encrypts audio slices with unique session keys
- ✅ Prevents direct access to complete audio files
- ✅ Makes memory extraction more complex
- ✅ Requires protocol knowledge to reconstruct content
- ✅ Suitable for reasonable protection against casual piracy

**What SecStream does NOT do:**
- ❌ Provide legal protection or enforcement mechanisms
- ❌ Stop determined attackers with reverse engineering skills
- ❌ Prevent screen recording, audio capture, or analog extraction
- ❌ Replace professional DRM solutions or content licensing
- ❌ Guarantee content cannot be extracted by sophisticated users

**For stronger protection, consider professional DRM solutions:**
- Widevine, FairPlay, PlayReady for enterprise-grade protection
- Content delivery networks with robust token authentication
- Legal agreements, terms of service, and enforcement mechanisms
- Audio watermarking and content fingerprinting systems

### Key Exchange Protocol

1. **Client Request**: Client generates ECDH key pair and sends public key
2. **Server Response**: Server generates session key, encrypts with shared ECDH key
3. **Session Key**: Both parties derive the same session key for audio encryption

### Audio Protection

1. **Slicing**: Audio split into small encrypted chunks (3-10 seconds)
2. **Encryption**: Each slice encrypted with AES-GCM using unique session key
3. **Compression**: Slices compressed to reduce bandwidth
4. **Memory Protection**: Played slices immediately disposed from memory
5. **Network Security**: All transfers over HTTPS with additional encryption

### Content Protection Features

- **No Complete Audio**: Client never has access to full unencrypted audio files
- **Memory Disposal**: Played audio buffers cleared immediately from memory
- **Session Isolation**: Unique session keys prevent cross-session attacks
- **Slice Encryption**: Individual encrypted slices are useless without session keys
- **Server-Side Processing**: All audio processing and encryption happens server-side
- **Protocol Obfuscation**: Custom protocol makes automated extraction more difficult

## 🌐 Framework Support

### Express.js

```typescript
import express from 'express'
import { SessionManager, SecureAudioAPI, expressHandler } from 'secstream/server'

const app = express()
const sessionManager = new SessionManager()
const api = new SecureAudioAPI(sessionManager)

app.use('/api', expressHandler(api))
```

### Hono

```typescript
import { Hono } from 'hono'
import { SessionManager, SecureAudioAPI, honoHandler } from 'secstream/server'

const app = new Hono()
const sessionManager = new SessionManager()
const api = new SecureAudioAPI(sessionManager)

app.all('/api/*', honoHandler(api))
```

### Cloudflare Workers + R2

```typescript
import { SessionManager, SecureAudioServer, parseAudioMetadata } from 'secstream/server'

export interface Env {
  AUDIO_BUCKET: R2Bucket
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const sessionManager = new SessionManager()
    const api = new SecureAudioServer(sessionManager)

    // Create session from R2-stored audio file
    if (request.method === 'POST' && url.pathname === '/api/sessions/from-r2') {
      const { key } = await request.json()
      
      // Retrieve audio from R2
      const object = await env.AUDIO_BUCKET.get(key)
      if (!object) {
        return new Response('Audio file not found', { status: 404 })
      }
      
      const audioBuffer = await object.arrayBuffer()
      const metadata = parseAudioMetadata(audioBuffer)
      const { sessionId } = await api.createSession(audioBuffer)
      
      return new Response(JSON.stringify({ sessionId, metadata }))
    }

    // Standard SecStream API endpoints
    if (url.pathname.startsWith('/api/sessions')) {
      // Route to SecureAudioServer...
    }
  }
}
```

**Complete Example**: See `examples/cloudflare-workers-r2/` for a full implementation with R2 integration, CORS handling, and production configurations.

## 🧪 Testing

Run the comprehensive test suite:

```bash
npm test
```

Tests cover:
- Cryptographic functions
- Key exchange protocol
- Audio format detection and parsing
- Audio processing and slicing
- Session management
- Compression/decompression
- Cloudflare Workers compatibility
- Cross-platform timer utilities
- Error handling

## 📖 Demo

Try the live demo to see SecStream in action:

```bash
cd demo
pnpm install
pnpm run dev
# Open http://localhost:3000
```

The demo features:
- **🎵 Audio Upload**: Drag and drop any audio file (WAV, MP3, FLAC, OGG)
- **🔍 Format Detection**: Automatic audio format and metadata detection
- **🔐 Secure Processing**: Real-time encryption and session creation
- **📊 Statistics**: Live server statistics and session management
- **🎨 Modern UI**: Beautiful, responsive web interface
- **🌐 Full API**: Complete REST API demonstration

## ⚙️ Configuration

### Server Configuration

```typescript
const sessionManager = new SessionManager({
  sliceDurationMs: 5000,      // Slice length (shorter = more secure, more requests)
  compressionLevel: 6,         // 0-9, higher = smaller files, more CPU
  encryptionAlgorithm: 'AES-GCM'  // Encryption method
})
```

### Client Configuration

```typescript
const client = new SecStreamClient({
  serverUrl: 'https://api.example.com',
  bufferSize: 5,    // Memory usage vs. smoothness tradeoff
  prefetchSize: 3   // Network efficiency vs. memory usage
})
```

---

## 🤝 Contributing

Contributions welcome! Please read the contributing guidelines and submit pull requests.

## 📄 License

Apache-2.0 License - see LICENSE file for details.
