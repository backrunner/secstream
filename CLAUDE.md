# CLAUDE.md - SecStream AI Coding Instructions

## Project Overview
SecStream is a secure, type-safe audio streaming library with pluggable compression, encryption, and key exchange processors. The library is designed for flexibility while maintaining strong TypeScript type safety throughout.

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

## Folder Structure and Organization

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

## Default Processor Implementations

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

## Common Pitfalls to Avoid

1. **Never use `any` types** - always use proper generics
2. **Don't hardcode processor types** - use the factory pattern
3. **Avoid blocking operations** - everything should be async
4. **Don't ignore error handling** - implement proper retry and fallback
5. **Never expose internal implementation details** - use proper abstraction
6. **Don't assume key formats** - support multiple key types generically
7. **Avoid memory leaks** - implement proper cleanup and disposal

## Package Information

- **Package Name**: `secstream`
- **Main Entry Points**: Client, Server, and individual processors
- **TypeScript**: Full type safety with no `any` types
- **Platform Support**: Node.js, Browser, Cloudflare Workers

## Extension Points

When adding new functionality:
1. Create proper interfaces with generics
2. Provide default implementations
3. Update type definitions
4. Add comprehensive tests
5. Document usage patterns
6. Maintain backward compatibility where possible

This architecture ensures SecStream remains flexible, type-safe, and extensible while providing excellent developer experience and security by default.