# SecStream 🔐🎵

A secure audio streaming library that prevents client-side audio piracy through encryption, slicing, memory protection, and customizable processing components.

[![npm version](https://badge.fury.io/js/secstream.svg)](https://badge.fury.io/js/secstream)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## ✨ Features

- 🔐 **End-to-End Encryption**: ECDH key exchange with AES-GCM encryption
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

### Anti-Piracy Features

- **No Full Audio**: Client never has access to complete unencrypted audio
- **Memory Disposal**: Played buffers cleared immediately  
- **Key Rotation**: Unique session keys prevent replay attacks
- **Slice Encryption**: Individual slices useless without session key
- **Server-Side Processing**: Audio processing happens server-side only

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

### Cloudflare Workers

```typescript
import { SessionManager, SecureAudioAPI, parseAudioMetadata } from 'secstream/server'

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'POST' && url.pathname === '/upload') {
      const formData = await request.formData()
      const audioFile = formData.get('audio')
      const audioBuffer = await audioFile.arrayBuffer()

      // Detect audio format
      const metadata = parseAudioMetadata(audioBuffer)
      console.log(`Detected format: ${metadata.format}`)

      // Create session
      const sessionManager = new SessionManager()
      const sessionId = await sessionManager.createSession(audioBuffer)

      return new Response(JSON.stringify({ sessionId, metadata }))
    }
  }
}
```

**See [examples/CLOUDFLARE_WORKERS.md](examples/CLOUDFLARE_WORKERS.md) for complete integration guide.**

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
npm install
npm run dev
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

## 🚀 Production Deployment

### Performance Considerations

- **Audio Format**: WAV provides best performance, MP3/FLAC require more processing
- **Slice Duration**: Balance security (shorter) vs. performance (longer)
- **Slice ID Generation**: Choose appropriate generator for your use case:
  - **NanoidSliceIdGenerator**: Best balance of security and performance (default)
  - **UuidSliceIdGenerator**: Good compatibility, slightly slower than nanoid
  - **SequentialSliceIdGenerator**: Fastest generation, but less secure (development only)
  - **TimestampSliceIdGenerator**: Fast with natural ordering
  - **HashSliceIdGenerator**: Slower due to hashing, but deterministic
- **Compression**: Higher compression saves bandwidth but uses more CPU
- **Buffer Size**: More buffering = smoother playback but more memory usage
- **CDN**: Use CDN for static assets, direct connection for API
- **Edge Computing**: Deploy on Cloudflare Workers for global performance
- **Audio Seeking**: Optimized seeking algorithm provides accurate positioning within slices

### Security Best Practices

- **HTTPS Only**: Never use HTTP in production
- **Audio Format Validation**: Validate file formats before processing
- **Rate Limiting**: Implement API rate limiting
- **File Size Limits**: Restrict maximum upload sizes
- **Session Cleanup**: Implement session expiration
- **Error Handling**: Don't leak sensitive information in errors
- **Content Security**: Use proper CORS headers for cross-origin requests
- **Slice ID Security**: Use secure generators in production:
  - ✅ **NanoidSliceIdGenerator** (default, recommended)
  - ✅ **UuidSliceIdGenerator** (secure, good compatibility)
  - ⚠️ **SequentialSliceIdGenerator** (predictable, development only)
  - ✅ **TimestampSliceIdGenerator** (secure with time-based uniqueness)
  - ✅ **HashSliceIdGenerator** (deterministic but secure)

### Monitoring

- Track active sessions with `sessionManager.getStats()`
- Monitor API response times and error rates
- Watch memory usage and cleanup effectiveness
- Alert on unusual session creation patterns

---

## 🤝 Contributing

Contributions welcome! Please read the contributing guidelines and submit pull requests.

## 📄 License

Apache-2.0 License - see LICENSE file for details.

## 🛡️ Security

Found a security issue? Please report it privately to [security@example.com] rather than opening a public issue.

---

**SecStream** - Secure Audio Streaming Made Simple