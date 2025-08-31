# SecStream - Documentation

Welcome to SecStream, a secure, customizable audio streaming library with pluggable compression, encryption, and key exchange processors.

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
- ✅ **Zero Legacy Code** - Clean, modern codebase without `any` types
- ✅ **Organized Structure** - Well-structured shared modules with proper separation of concerns
- ✅ **Performance Optimized** - Efficient algorithms with customization options

## Architecture

```
src/
├── shared/
│   ├── types/           # Type definitions and interfaces
│   ├── compression/     # Compression processors
│   │   └── processors/  # Individual compression implementations
│   ├── crypto/          # Cryptographic functionality
│   │   ├── processors/  # Encryption processor implementations
│   │   └── key-exchange/# Key exchange processor implementations
│   └── utils/           # Utility functions
├── client/              # Client-side code
└── server/              # Server-side code
```

## Default Processors

SecStream comes with production-ready default processors:

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

1. **Basic Usage**: Start with the default processors for immediate functionality
2. **Custom Development**: Follow the [Processor Development Guide](./processor-development.md) to create your own processors
3. **Type Safety**: Use TypeScript generics for full type safety throughout your application