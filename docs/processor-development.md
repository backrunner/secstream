# Creating Custom Processors for SecStream

SecStream provides a flexible, type-safe architecture for customizing compression, encryption, and key exchange algorithms. This guide shows you how to create your own processors.

## Architecture Overview

SecStream uses three types of processors:
- **Compression Processors** - Handle data compression/decompression
- **Encryption Processors** - Handle data encryption/decryption with any key type
- **Key Exchange Processors** - Handle secure key exchange between client and server

All processors are fully generic and type-safe, allowing you to define your own key formats and data types.

## Quick Start

```typescript
import { 
  SecureAudioClient, 
  SessionManager,
  DeflateCompressionProcessor,
  AesGcmEncryptionProcessor,
  EcdhP256KeyExchangeProcessor 
} from 'secstream';

// Using default processors
const client = new SecureAudioClient(transport, {
  processingConfig: {
    compressionProcessor: new DeflateCompressionProcessor(9), // Max compression
    encryptionProcessor: new AesGcmEncryptionProcessor(),
    keyExchangeProcessor: new EcdhP256KeyExchangeProcessor()
  }
});
```

## Creating a Custom Compression Processor

```typescript
import { CompressionProcessor, CompressionOptions } from 'secstream';

export class CustomCompressionProcessor implements CompressionProcessor {
  async compress(data: ArrayBuffer, options?: CompressionOptions): Promise<ArrayBuffer> {
    // Implement your compression algorithm
    // options.level provides compression level (0-9)
    return compressedData;
  }

  async decompress(compressedData: ArrayBuffer, options?: CompressionOptions): Promise<ArrayBuffer> {
    // Implement your decompression algorithm
    return originalData;
  }

  getName(): string {
    return 'CustomCompressionProcessor';
  }
}
```

## Creating a Custom Encryption Processor

```typescript
import { EncryptionProcessor, CryptoMetadata, EncryptionOptions } from 'secstream';

// Define your custom key type
interface MyCustomKey {
  algorithm: string;
  keyData: Uint8Array;
  strength: number;
}

export class CustomEncryptionProcessor implements EncryptionProcessor<MyCustomKey> {
  async encrypt(
    data: ArrayBuffer, 
    key: MyCustomKey, 
    options?: EncryptionOptions
  ): Promise<{ encrypted: ArrayBuffer; metadata: CryptoMetadata }> {
    // Implement your encryption algorithm
    const encrypted = this.performEncryption(data, key);
    
    return {
      encrypted,
      metadata: {
        algorithm: key.algorithm,
        iv: this.generateIV(), // If needed
        strength: key.strength
      }
    };
  }

  async decrypt(
    encryptedData: ArrayBuffer,
    key: MyCustomKey,
    metadata: CryptoMetadata,
    options?: EncryptionOptions
  ): Promise<ArrayBuffer> {
    // Implement your decryption algorithm
    return this.performDecryption(encryptedData, key, metadata);
  }

  getName(): string {
    return 'CustomEncryptionProcessor';
  }

  private performEncryption(data: ArrayBuffer, key: MyCustomKey): ArrayBuffer {
    // Your encryption logic here
  }

  private performDecryption(data: ArrayBuffer, key: MyCustomKey, metadata: CryptoMetadata): ArrayBuffer {
    // Your decryption logic here
  }

  private generateIV(): ArrayBuffer {
    // Generate initialization vector if needed
  }
}
```

## Creating a Custom Key Exchange Processor

```typescript
import { 
  KeyExchangeProcessor, 
  KeyExchangeRequest, 
  KeyExchangeResponse,
  SessionInfo 
} from 'secstream';

// Define custom types
interface MyKeyExchangeData {
  clientId: string;
  timestamp: number;
}

interface MyCustomSessionKey {
  key: Uint8Array;
  expiry: number;
}

export class CustomKeyExchangeProcessor implements KeyExchangeProcessor<
  MyCustomSessionKey,     // TKey - your session key type
  SessionInfo,           // TSessionInfo - session information type
  MyKeyExchangeData,     // TRequestData - request payload type  
  MyKeyExchangeData      // TResponseData - response payload type
> {
  private clientId: string;

  async initialize(): Promise<void> {
    this.clientId = this.generateClientId();
  }

  async createKeyExchangeRequest(): Promise<KeyExchangeRequest<MyKeyExchangeData>> {
    return {
      publicKey: 'my-public-identifier',
      data: {
        clientId: this.clientId,
        timestamp: Date.now()
      },
      metadata: {
        algorithm: 'CustomKeyExchange',
        version: '1.0'
      }
    };
  }

  async processKeyExchangeRequest(
    request: KeyExchangeRequest<MyKeyExchangeData>,
    sessionId: string
  ): Promise<{
    response: KeyExchangeResponse<MyKeyExchangeData, SessionInfo>;
    sessionKey: MyCustomSessionKey;
  }> {
    // Server-side: process the request and generate response
    const sessionKey: MyCustomSessionKey = {
      key: this.deriveSessionKey(request.data?.clientId || ''),
      expiry: Date.now() + 3600000 // 1 hour
    };

    const response: KeyExchangeResponse<MyKeyExchangeData, SessionInfo> = {
      publicKey: 'server-response-key',
      sessionInfo: { sessionId } as SessionInfo, // Will be filled by SessionManager
      data: {
        clientId: 'server-123',
        timestamp: Date.now()
      },
      metadata: {
        algorithm: 'CustomKeyExchange',
        version: '1.0'
      }
    };

    return { response, sessionKey };
  }

  async processKeyExchangeResponse(
    response: KeyExchangeResponse<MyKeyExchangeData, SessionInfo>
  ): Promise<MyCustomSessionKey> {
    // Client-side: process the response and derive session key
    return {
      key: this.deriveSessionKey(response.data?.clientId || ''),
      expiry: Date.now() + 3600000
    };
  }

  getName(): string {
    return 'CustomKeyExchangeProcessor';
  }

  destroy(): void {
    // Clean up resources
  }

  private generateClientId(): string {
    return `client-${Math.random().toString(36).substr(2, 9)}`;
  }

  private deriveSessionKey(id: string): Uint8Array {
    // Your key derivation logic
    return new Uint8Array(32); // Example 32-byte key
  }
}
```

## Using Your Custom Processors

```typescript
// Type-safe usage with custom processors
const client = new SecureAudioClient<MyCustomSessionKey>(transport, {
  processingConfig: {
    compressionProcessor: new CustomCompressionProcessor(),
    encryptionProcessor: new CustomEncryptionProcessor(),
    keyExchangeProcessor: new CustomKeyExchangeProcessor()
  }
});

const sessionManager = new SessionManager({
  processingConfig: {
    compressionProcessor: new CustomCompressionProcessor(),
    encryptionProcessor: new CustomEncryptionProcessor(),
    keyExchangeProcessor: new CustomKeyExchangeProcessor()
  }
});
```

## Best Practices

### Security
- Always validate input parameters
- Use cryptographically secure random number generation
- Implement proper key derivation functions
- Consider timing attack resistance

### Performance
- Optimize for your specific use case
- Consider memory usage for large audio streams
- Implement efficient algorithms for real-time processing

### Error Handling
- Throw descriptive errors for invalid inputs
- Handle edge cases gracefully
- Provide clear error messages

### Testing
- Test with various input sizes
- Verify round-trip encryption/decryption
- Test key exchange with different scenarios
- Performance test with realistic audio data

## Available Default Processors

SecStream includes these production-ready processors:

- **`DeflateCompressionProcessor`** - DEFLATE compression (optimal for audio)
- **`AesGcmEncryptionProcessor`** - AES-256-GCM encryption
- **`EcdhP256KeyExchangeProcessor`** - ECDH P-256 key exchange  
- **`XorStreamCipherProcessor`** - XOR cipher (for testing only)

## Type Safety

All processors are fully typed with TypeScript generics:
- Compile-time type checking
- IntelliSense support
- No `any` types
- Proper error detection

The type system ensures your custom processors integrate seamlessly with the SecStream architecture while maintaining complete type safety.