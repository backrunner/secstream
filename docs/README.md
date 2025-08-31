# SecStream - Documentation

Welcome to SecStream, a secure, customizable audio streaming library with pluggable compression, encryption, key exchange processors, and customizable slice ID generation.

## Quick Start

```typescript
import { SecureAudioClient, SessionManager, SecureAudioServer } from 'secstream';

// Basic client
const client = new SecureAudioClient(transport);

// Basic server  
const sessionManager = new SessionManager();
const server = new SecureAudioServer(sessionManager);
```

## Documentation

- **[Processor Development Guide](./processor-development.md)** - Complete guide to creating custom processors

## Core Features

- ✅ **Type-Safe Architecture** - Full TypeScript support with proper generics
- ✅ **Customizable Processors** - Plug in your own compression, encryption, and key exchange algorithms
- ✅ **Customizable Slice ID Generation** - Multiple built-in generators and support for custom implementations
- ✅ **Zero Legacy Code** - Clean, modern codebase without `any` types
- ✅ **Organized Structure** - Well-structured shared modules with proper separation of concerns
- ✅ **Performance Optimized** - Efficient algorithms with customization options
- ✅ **Accurate Audio Seeking** - Precise seeking within sliced audio streams
- ✅ **Sound Quality Optimization** - Enhanced audio processing and server performance

## Architecture

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
- **`NanoidSliceIdGenerator`** - **Default**
  - Uses nanoid library for cryptographically secure, URL-safe unique IDs
  - Configurable length (default 21 characters)
  - Recommended for production use

- **`UuidSliceIdGenerator`**
  - Uses standard UUID v4 format
  - Maximum compatibility with existing systems

- **`SequentialSliceIdGenerator`**
  - Generates predictable sequential IDs for debugging
  - **WARNING: Less secure** - use only for development/debugging

- **`TimestampSliceIdGenerator`**
  - Combines timestamp, session info, and slice index
  - Provides natural ordering and time-based uniqueness

- **`HashSliceIdGenerator`**
  - Generates deterministic IDs based on session and slice info
  - Useful for caching scenarios where same input = same ID

### Compression
- **`DeflateCompressionProcessor`** - DEFLATE compression using fflate library
  - Optimal for real-time audio streaming
  - Configurable compression levels (0-9)

### Encryption  
- **`AesGcmEncryptionProcessor`** - Industry-standard AES-256-GCM encryption
  - Supports CryptoKey, ArrayBuffer, and string keys
  - Built on Web Crypto API for performance

### Key Exchange
- **`EcdhP256KeyExchangeProcessor`** - ECDH with P-256 curve
  - Derives AES-256-GCM session keys
  - Industry-standard secure key exchange

### Testing/Educational
- **`XorStreamCipherProcessor`** - Simple XOR encryption
  - For testing and educational purposes only
  - Not cryptographically secure

## Getting Started

### Basic Usage with Default Slice ID Generator
```typescript
import { 
  SecureAudioClient, 
  SessionManager,
  DeflateCompressionProcessor,
  AesGcmEncryptionProcessor,
  EcdhP256KeyExchangeProcessor 
} from 'secstream';

// Using defaults (NanoidSliceIdGenerator is used automatically)
const client = new SecureAudioClient(transport, {
  processingConfig: {
    compressionProcessor: new DeflateCompressionProcessor(9), // Max compression
    encryptionProcessor: new AesGcmEncryptionProcessor(),
    keyExchangeProcessor: new EcdhP256KeyExchangeProcessor()
  }
});
```

### Custom Slice ID Generator Usage
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