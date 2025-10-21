# CLAUDE.md - SecStream AI Coding Instructions

## Project Overview
SecStream is a secure, type-safe audio streaming library with pluggable compression, encryption, key exchange processors, and customizable slice ID generation. The library is designed for flexibility while maintaining strong TypeScript type safety throughout.

## Core Architecture Principles

### 1. Type Safety First
- **NEVER use `any` types** - always use proper generics or specific type definitions
- All processors must be fully typed with TypeScript generics
- Use strict type checking for all interfaces and implementations
- Example: `EncryptionProcessor<TKey>` instead of `EncryptionProcessor<any>`

### 2. Processor Pattern
The library uses three types of processors:
- **CompressionProcessor** - Handle data compression/decompression
- **EncryptionProcessor<TKey>** - Handle encryption/decryption with any key type
- **KeyExchangeProcessor<TKey, TSessionInfo, TRequestData, TResponseData>** - Handle secure key exchange

### 3. Generic Architecture
All processors are fully generic to support custom types:
```typescript
export interface EncryptionProcessor<TKey = CryptoKey | ArrayBuffer | string> {
  encrypt(data: ArrayBuffer, key: TKey, options?: EncryptionOptions): Promise<{
    encrypted: ArrayBuffer;
    metadata: CryptoMetadata;
  }>;
  decrypt(encryptedData: ArrayBuffer, key: TKey, metadata: CryptoMetadata, options?: EncryptionOptions): Promise<ArrayBuffer>;
  getName(): string;
}
```

### 4. Customizable Slice ID Generation
The library supports customizable slice ID generation strategies:
```typescript
export interface SliceIdGenerator {
  generateSliceId(sliceIndex: number, sessionId: string, totalSlices: number): Promise<string> | string;
  getName(): string;
}
```

### 5. Randomized Slice Lengths
The library supports randomized slice lengths for enhanced security against pattern analysis:
```typescript
export interface AudioConfig {
  sliceDurationMs: number;              // Average slice duration
  randomizeSliceLength?: boolean;       // Enable randomization (default: false)
  sliceLengthVariance?: number;         // Variance factor 0.0-1.0 (default: 0.4)
  // ... other config
}
```

**Key Features:**
- **Disabled by default** - maintains backward compatibility
- **Session-specific patterns** - each session uses a different randomization seed derived from session ID
- **Deterministic** - same session ID always produces same slice pattern (no performance overhead)
- **Configurable variance** - control how much slices vary from average duration
- **Smart merging** - prevents tiny final slices by merging with previous slice

**Example:**
```typescript
const sessionManager = new SessionManager({
  sliceDurationMs: 5000,           // Average 5 seconds
  randomizeSliceLength: true,      // Enable randomization
  sliceLengthVariance: 0.4,        // ±40% variance (3-7 seconds)
});
// Session A might produce: [3.2s, 6.5s, 4.1s, 5.8s, ...]
// Session B might produce: [5.3s, 2.9s, 6.8s, 4.4s, ...]
```

### 6. Multi-Track Sessions
The library supports multi-track sessions for playlist and album streaming with optimized performance:

**Architecture:**
- **One session, multiple tracks** - Each track has its own encryption key for security isolation
- **Lazy key exchange** - Track keys are initialized on-demand when first accessed
- **Smart prefetch** - Automatically prefetch next track's first slices near end of current track
- **Parallel processing** - Server can process multiple tracks concurrently during upload
- **Backward compatible** - Single-track sessions continue to work seamlessly
- **Transport flexibility** - No assumptions about how sessions are created; developers implement their own upload strategy

**Key Interfaces:**
```typescript
export interface TrackInfo {
  trackId: string;              // Unique identifier for this track
  trackIndex: number;           // Zero-based position in session
  totalSlices: number;          // Number of slices for this track
  sliceDuration: number;        // Duration per slice in ms
  sampleRate: number;           // Sample rate in Hz
  channels: number;             // Audio channels (1=mono, 2=stereo)
  sliceIds: string[];          // Slice IDs for this track
  duration: number;            // Total duration in seconds
  title?: string;              // Track metadata
  artist?: string;
  album?: string;
}

export interface SessionInfo {
  sessionId: string;
  tracks?: TrackInfo[];        // Multi-track session: array of all tracks
  activeTrackId?: string;      // Currently active track ID
  // Backward compatible single-track fields...
  totalSlices: number;
  sliceDuration: number;
  sliceIds: string[];
}
```

**Client Usage:**
```typescript
// Initialize session (lazy key exchange)
const sessionInfo = await client.initializeSession(sessionId);

// Switch to a specific track (by ID or index)
await client.switchToTrack('track_id');
await client.switchToTrack(0); // First track

// Load slices for specific track
await client.loadSlice(sliceId, undefined, trackId);

// Add new track to existing session
const trackInfo = await client.addTrack(audioFile, {
  title: 'Song Title',
  artist: 'Artist Name',
  album: 'Album Name'
});
```

**Player Usage:**
```typescript
const player = new SecureAudioPlayer(client, {
  smartPrefetchNextTrack: true,        // Auto-prefetch next track (default: true)
  nextTrackPrefetchThreshold: 10,      // Start prefetching 10s before end
});

// Track navigation
await player.switchTrack(trackIdOrIndex, autoPlay);
await player.nextTrack();
await player.previousTrack();

// Get track information
const tracks = player.getTracks();
const currentTrack = player.getCurrentTrack();

// Listen to track changes
player.addEventListener('trackchange', (event) => {
  console.log('Switched to:', event.detail.track);
});
```

**Server Usage:**
```typescript
const sessionManager = new SessionManager({
  // Multi-track optimizations
  trackProcessingConcurrency: 3,  // Process 3 tracks in parallel
  prewarmFirstTrack: true,        // Fully cache first track for instant playback
});

// Batch upload (playlist/album)
const sessionId = await sessionManager.createMultiTrackSession([
  { audioData: track1Data, metadata: { title: 'Track 1' } },
  { audioData: track2Data, metadata: { title: 'Track 2' } },
  { audioData: track3Data, metadata: { title: 'Track 3' } },
]);

// Incremental track addition
const trackInfo = await sessionManager.addTrack(sessionId, audioData, metadata);

// Lazy key exchange (per-track, on-demand)
const response = await sessionManager.handleKeyExchange(sessionId, request, trackId);

// Track-aware slice retrieval
const slice = await sessionManager.getSlice(sessionId, sliceId, trackId);
```

**Performance Optimizations:**
- **Parallel track processing**: Configure `trackProcessingConcurrency` to process multiple tracks simultaneously
- **First track prewarm**: Enable `prewarmFirstTrack` to cache first track during session creation for instant playback
- **Smart prefetch**: Client automatically prefetches next track's first 3 slices when approaching end
- **Lazy initialization**: Track keys only exchanged when track is accessed, reducing initial overhead
- **Track isolation**: Each track has independent buffer management and encryption key

### 7. Buffer Management Architecture
The library uses a separation of concerns between **storage** (client) and **strategy** (player):

**Client as "Dumb Storage":**
- The `SecureAudioClient` acts as pure storage - it loads and stores slices on demand
- No automatic cleanup or prefetch logic in the client
- Provides programmatic API to manage buffers: `cleanupBuffers()`, `removeSlice()`, `getBufferedSlices()`
- Supports concurrent loading with abort signals for cancellation

**Player with Strategies:**
- `SecureAudioPlayer` controls buffer lifecycle using pluggable strategies
- `BufferManagementStrategy` - Controls when to cleanup old slices
- `PrefetchStrategy` - Controls which slices to prefetch ahead
- Default implementations: `BalancedBufferStrategy`, `LinearPrefetchStrategy`

**Client Configuration:**
```typescript
const client = new SecureAudioClient(transport, {
  prefetchConcurrency: 3,  // Max concurrent slice loads
});

// Programmatic config updates
client.updateConfig({
  prefetchConcurrency: 5,
  retryConfig: { maxRetries: 5 }
});

// Manual buffer management (if using client without player)
client.cleanupBuffers(currentSlice, bufferSize, trackId);
client.removeSlice(sliceIndex, trackId);
const buffered = client.getBufferedSlices(trackId);
```

**Player Configuration:**
```typescript
const player = new SecureAudioPlayer(client, {
  bufferStrategy: new BalancedBufferStrategy(),
  prefetchStrategy: new LinearPrefetchStrategy(),
  bufferingTimeoutMs: 10000,
});
```

**Custom Buffer Strategy Example:**
```typescript
class AggressiveBufferStrategy implements BufferManagementStrategy {
  shouldCleanupBuffer(entry: BufferEntry, currentSlice: number): boolean {
    // Keep only current slice + 2 ahead
    return entry.sliceIndex < currentSlice || entry.sliceIndex > currentSlice + 2;
  }

  onSeek(targetSlice: number, currentSlice: number, buffered: number[]): number[] {
    // Clear all buffers on seek for maximum memory savings
    return buffered;
  }
}
```

**Key Benefits:**
- **Separation of concerns**: Storage logic separate from playback logic
- **Flexibility**: Use client standalone or with player strategies
- **Testability**: Strategies can be tested independently
- **Customization**: Implement custom strategies for specific use cases
- **Track-aware**: All buffer operations support multi-track sessions

## Folder Structure and Organization

```
src/
├── shared/
│   ├── types/           # Type definitions and interfaces
│   ├── slice-id/        # Slice ID generation strategies
│   ├── compression/     # Compression processors
│   │   └── processors/  # Individual compression implementations
│   ├── crypto/          # Cryptographic functionality
│   │   ├── processors/  # Encryption processor implementations
│   │   └── key-exchange/# Key exchange processor implementations
│   └── utils/           # Utility functions
├── client/              # Client-side code
└── server/              # Server-side code
```

## Default Implementations

### Slice ID Generators
- **`NanoidSliceIdGenerator`** (`src/shared/slice-id/generators.ts`) - **Default**
  - Uses nanoid library for cryptographically secure, URL-safe unique IDs
  - Configurable length (default 21 characters)
  - Recommended for production use

- **`UuidSliceIdGenerator`** (`src/shared/slice-id/generators.ts`)
  - Uses standard UUID v4 format
  - Maximum compatibility with existing systems

- **`SequentialSliceIdGenerator`** (`src/shared/slice-id/generators.ts`)
  - Generates predictable sequential IDs for debugging
  - **WARNING: Less secure** - use only for development/debugging

- **`TimestampSliceIdGenerator`** (`src/shared/slice-id/generators.ts`)
  - Combines timestamp, session info, and slice index
  - Provides natural ordering and time-based uniqueness

- **`HashSliceIdGenerator`** (`src/shared/slice-id/generators.ts`)
  - Generates deterministic IDs based on session and slice info
  - Useful for caching scenarios where same input = same ID

### Compression
- **`DeflateCompressionProcessor`** (`src/shared/compression/processors/deflate-processor.ts`)
  - Uses fflate library for DEFLATE compression
  - Optimal for real-time audio streaming
  - Configurable compression levels (0-9)

### Encryption
- **`AesGcmEncryptionProcessor`** (`src/shared/crypto/processors/aes-gcm-processor.ts`)
  - Industry-standard AES-256-GCM encryption
  - Supports CryptoKey, ArrayBuffer, and string keys
  - Built on Web Crypto API for performance

- **`XorStreamCipherProcessor`** (`src/shared/crypto/processors/xor-cipher-processor.ts`)
  - Simple XOR encryption for testing/educational purposes
  - Supports multiple key formats
  - **NOT cryptographically secure** - testing only

### Key Exchange
- **`EcdhP256KeyExchangeProcessor`** (`src/shared/crypto/key-exchange/ecdh-p256-processor.ts`)
  - ECDH with P-256 curve
  - Derives AES-256-GCM session keys
  - Industry-standard secure key exchange

## Coding Guidelines

### 1. File Naming Conventions
- Use descriptive, logic-related names
- Processor files: `{algorithm}-processor.ts` (e.g., `deflate-processor.ts`, `aes-gcm-processor.ts`)
- Use kebab-case for file names
- Avoid generic names like `default-processor.ts`

### 2. Import/Export Patterns
```typescript
// Always use explicit named exports
export class DeflateCompressionProcessor implements CompressionProcessor {
  // implementation
}

// Never use legacy exports or default exports for processors
// Import with descriptive names
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';
```

### 3. Generic Type Usage
```typescript
// Good - Proper generic constraints
export class SecureAudioClient<
  TKey = unknown,
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor
> {
  // implementation
}

// Bad - Using any types
export class SecureAudioClient {
  private sessionKey: any; // NEVER do this
}
```

### 4. Error Handling
- Use specific error types (NetworkError, DecryptionError, DecodingError)
- Provide descriptive error messages
- Handle edge cases gracefully
- Validate input parameters thoroughly

### 5. ArrayBuffer and Binary Data
- Always use ArrayBuffer for binary data
- No base64 encoding unless explicitly required
- Handle endianness properly for cross-platform compatibility
- Use DataView for safe binary data access

## Key Integration Points

### 1. Client Integration (`src/client/core/client.ts`)
```typescript
// Processors are initialized with defaults but can be overridden
const processingConfig = this.config.processingConfig || {};
this.compressionProcessor = (processingConfig.compressionProcessor || new DeflateCompressionProcessor()) as TCompressionProcessor;
this.encryptionProcessor = (processingConfig.encryptionProcessor || new AesGcmEncryptionProcessor()) as TEncryptionProcessor;
this.keyExchangeProcessor = (processingConfig.keyExchangeProcessor || new EcdhP256KeyExchangeProcessor()) as TKeyExchangeProcessor;
```

### 2. Server Integration (`src/server/core/session-manager.ts`)
```typescript
// Factory pattern for key exchange processors
this.keyExchangeProcessorFactory = keyExchangeProcessor 
  ? () => {
      const ProcessorClass = keyExchangeProcessor.constructor as new () => KeyExchangeProcessor;
      return new ProcessorClass();
    }
  : () => new EcdhP256KeyExchangeProcessor();
```

### 3. Audio Processing (`src/server/processing/audio-processor.ts`)
```typescript
// Processors are type-safe and configurable
const compressionOptions: CompressionOptions = { level: this.config.compressionLevel };
const compressedData = await this.compressionProcessor.compress(sliceData, compressionOptions);

const { encrypted, metadata } = await this.encryptionProcessor.encrypt(
  compressedData, 
  sessionKey as Parameters<TEncryptionProcessor['encrypt']>[1]
);
```

## Testing Patterns

### 1. Processor Testing
- Test round-trip operations (encrypt/decrypt, compress/decompress)
- Test with various input sizes and edge cases
- Verify type safety with different key formats
- Performance test with realistic audio data

### 2. Integration Testing
- Test custom processors with client/server
- Verify key exchange works with different encryption processors
- Test error handling and retry mechanisms

## Performance Considerations

### 1. Memory Management
- Implement LRU cache for audio slices
- Clean up expired resources automatically
- Use efficient algorithms for real-time processing

### 2. Async Operations
- Use proper async/await patterns
- Handle Promise rejections appropriately
- Implement retry mechanisms for network operations

### 3. Streaming Latency Optimization

For applications that require instant playback (especially from the beginning), use the **prewarm** feature:

```typescript
const sessionManager = new SessionManager({
  sliceDurationMs: 5000,
  compressionLevel: 6,
  // Prewarm first 3 slices during key exchange
  prewarmSlices: 3,
  prewarmConcurrency: 3,
  serverCacheSize: 10,
  serverCacheTtlMs: 300_000,
});
```

**How Prewarm Works:**
1. Client initiates key exchange
2. Server processes key exchange and returns immediately
3. In parallel (non-blocking), server starts preparing first N slices
4. Slices are encrypted, compressed, and cached
5. When client requests first slice, it's already ready (cache hit)

**Implementation Details:**
- Located in `audio-processor.ts` lines 174-215
- Uses fire-and-forget pattern (line 214) to avoid blocking key exchange
- Configurable concurrency for parallel processing
- Failed prewarm operations are non-fatal (graceful degradation)

**Performance Impact:**
- **Latency Reduction**: ~100-300ms → ~0-50ms for first slice
- **CPU Usage**: Temporary spike during prewarm (background)
- **Memory**: `prewarmSlices × avgSliceSize` additional cache
- **Recommended**: 3-5 slices for smooth streaming, 1 for minimal latency

**When to Use:**
- ✅ Music/podcast players (sequential playback from start)
- ✅ Live streaming scenarios
- ✅ Video game audio systems (level start)
- ❌ Random access players (heavy seeking)
- ❌ Resource-constrained servers

**Configuration Guidelines:**
- **Low latency priority**: `prewarmSlices: 1-3`
- **Smooth buffering**: `prewarmSlices: 3-5`
- **Resource saving**: `prewarmSlices: 0` (default)
- Adjust `prewarmConcurrency` based on available CPU cores

## Security Best Practices

### 1. Key Management
- Use cryptographically secure random number generation
- Implement proper key derivation functions
- Consider timing attack resistance
- Never log or expose sensitive key material

### 2. Input Validation
- Validate all input parameters
- Check data bounds and types
- Sanitize user-provided data
- Handle malformed inputs gracefully

## Documentation Standards

### 1. Code Comments
- Document complex algorithms and security considerations
- Explain non-obvious type constraints
- Document performance implications
- Use JSDoc for public APIs

### 2. Example Usage
Always provide complete, working examples:

#### Basic Usage with Default Slice ID Generator
```typescript
import { 
  SecureAudioClient, 
  SessionManager,
  DeflateCompressionProcessor,
  AesGcmEncryptionProcessor,
  EcdhP256KeyExchangeProcessor 
} from 'secstream';

const client = new SecureAudioClient(transport, {
  processingConfig: {
    compressionProcessor: new DeflateCompressionProcessor(9),
    encryptionProcessor: new AesGcmEncryptionProcessor(),
    keyExchangeProcessor: new EcdhP256KeyExchangeProcessor()
  }
});
```

#### Custom Slice ID Generator Usage
```typescript
import { 
  SessionManager,
  UuidSliceIdGenerator,
  SequentialSliceIdGenerator,
  TimestampSliceIdGenerator,
  HashSliceIdGenerator
} from 'secstream';

// Use UUID-based slice IDs for maximum compatibility
const sessionManager = new SessionManager({
  sliceIdGenerator: new UuidSliceIdGenerator()
});

// Use sequential IDs for debugging (development only)
const debugSessionManager = new SessionManager({
  sliceIdGenerator: new SequentialSliceIdGenerator('debug')
});

// Use timestamp-based IDs for natural ordering
const timestampSessionManager = new SessionManager({
  sliceIdGenerator: new TimestampSliceIdGenerator()
});

// Use hash-based IDs for caching scenarios
const cachingSessionManager = new SessionManager({
  sliceIdGenerator: new HashSliceIdGenerator()
});
```

#### Creating Custom Slice ID Generators
```typescript
import { SliceIdGenerator } from 'secstream';

// Custom generator using company prefix and random suffix
class CompanySliceIdGenerator implements SliceIdGenerator {
  constructor(private companyPrefix: string = 'ACME') {}

  generateSliceId(sliceIndex: number, sessionId: string, totalSlices: number): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${this.companyPrefix}_${timestamp}_${sliceIndex}_${random}`;
  }

  getName(): string {
    return `CompanySliceIdGenerator(${this.companyPrefix})`;
  }
}

// Use custom generator
const customSessionManager = new SessionManager({
  sliceIdGenerator: new CompanySliceIdGenerator('MYCO')
});
```

## Common Pitfalls to Avoid

1. **Never use `any` types** - always use proper generics or `unknown`
2. **Don't hardcode processor types** - use the factory pattern
3. **Avoid blocking operations** - everything should be async
4. **Don't ignore error handling** - implement proper retry and fallback
5. **Never expose internal implementation details** - use proper abstraction
6. **Don't assume key formats** - support multiple key types generically
7. **Avoid memory leaks** - implement proper cleanup and disposal
8. **Don't use insecure slice ID generators in production** - avoid SequentialSliceIdGenerator in production
9. **Ensure slice ID uniqueness** - custom generators must guarantee unique IDs within a session
10. **Consider slice ID performance** - generators are called for every slice, optimize accordingly
11. **NEVER import server code in client** - `src/client/` must not import from `src/server/`
12. **NEVER import client code in server** - `src/server/` must not import from `src/client/`
13. **Always verify bundle separation** - run grep checks after making changes to imports
14. **Multi-track sessions: Always provide trackId when needed** - For multi-track operations, explicitly pass trackId to avoid confusion
15. **Multi-track sessions: Initialize tracks lazily** - Don't initialize all track keys upfront, use lazy initialization
16. **Buffer management: Don't mix client and player responsibilities** - Let player strategies control buffers, not client logic
17. **Type assertions: Use `unknown` intermediate** - When type assertions are necessary (e.g., `as unknown as T`), use `unknown` as intermediate step

## Package Information

- **Package Name**: `secstream`
- **Main Entry Points**: Client, Server, and individual processors
- **TypeScript**: Full type safety with no `any` types
- **Platform Support**: Node.js, Browser, Cloudflare Workers

### Package Structure and Exports

SecStream uses **separate entry points** to ensure client and server code remain isolated:

```
secstream/
├── secstream         → Main entry (client + server + shared) - 106 KB
├── secstream/client  → Client-only code + shared types - 69 KB
└── secstream/server  → Server-only code + shared types - 38 KB
```

**CRITICAL RULES FOR MAINTAINING SEPARATION:**

1. **Client code** (`src/client/`) must NEVER import from `src/server/`
2. **Server code** (`src/server/`) must NEVER import from `src/client/`
3. **Both can import** from `src/shared/` for types, utilities, and processors
4. **Rollup builds** three separate bundles from three entry points
5. **package.json exports** field controls external access

### Import Patterns for Development

When working on the codebase, follow these import patterns:

**In Client Code (`src/client/**`):**
```typescript
// ✅ Allowed
import type { AudioConfig, SessionInfo } from '../shared/types/interfaces.js';
import { AesGcmEncryptionProcessor } from '../shared/crypto/processors/aes-gcm-processor.js';

// ❌ NEVER do this
import { SessionManager } from '../server/core/session-manager.js'; // FORBIDDEN
```

**In Server Code (`src/server/**`):**
```typescript
// ✅ Allowed
import type { AudioConfig, EncryptedSlice } from '../../shared/types/interfaces.js';
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';

// ❌ NEVER do this
import { SecureAudioClient } from '../../client/core/client.js'; // FORBIDDEN
```

**In Shared Code (`src/shared/**`):**
```typescript
// ✅ Only import from other shared modules
import type { AudioConfig } from '../types/interfaces.js';
import { someUtil } from '../utils/helpers.js';

// ❌ NEVER import from client or server
import { anything } from '../../client/...'; // FORBIDDEN
import { anything } from '../../server/...'; // FORBIDDEN
```

### Export Configuration (package.json)

The `exports` field in package.json controls what users can import:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./server": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.js",
      "default": "./dist/server/index.js"
    },
    "./client": {
      "types": "./dist/client/index.d.ts",
      "import": "./dist/client/index.js",
      "default": "./dist/client/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

This configuration:
- Prevents users from importing internal paths like `secstream/dist/...`
- Enforces the public API surface
- Enables tree-shaking for optimal bundle sizes
- Provides clear separation between client/server code

### Adding New Exports

When adding new functionality that should be exported:

1. **Identify the audience**: Is it client-only, server-only, or shared?
2. **Add to the correct index.ts**:
   - `src/client/index.ts` for client functionality
   - `src/server/index.ts` for server functionality
   - `src/index.ts` for shared utilities/types
3. **Use explicit named exports** (never `export *` without care)
4. **Export types separately** from implementations
5. **Test the import** from the consumer's perspective

Example:
```typescript
// In src/server/index.ts
export { SessionManager } from './core/session-manager.js';
export type { SessionManagerConfig } from './core/session-manager.js';
export { AudioProcessor } from './processing/audio-processor.js';
export type { AudioProcessorConfig, AudioSource } from './processing/audio-processor.js';
```

### Verifying Separation

To verify that client/server separation is maintained:

```bash
# Check client doesn't import server
grep -r "from.*server" src/client/

# Check server doesn't import client
grep -r "from.*client" src/server/

# Check bundle sizes
ls -lh dist/*.js dist/client/*.js dist/server/*.js

# Verify no server code in client bundle
grep -o "SessionManager\|AudioProcessor" dist/client/index.js

# Verify no client code in server bundle
grep -o "SecureAudioClient\|SecureAudioPlayer" dist/server/index.js
```

All checks should return empty results or expected sizes.

## Extension Points

When adding new functionality:
1. Create proper interfaces with generics
2. Provide default implementations
3. Update type definitions
4. Add comprehensive tests
5. Document usage patterns
6. Maintain backward compatibility where possible

This architecture ensures SecStream remains flexible, type-safe, and extensible while providing excellent developer experience and security by default.