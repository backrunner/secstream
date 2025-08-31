import type { EncryptionProcessor, CryptoMetadata, EncryptionOptions } from '../../types/processors.js';

/**
 * Supported key types for XOR encryption
 */
export type XORKeyType = ArrayBuffer | Uint8Array | string | number[];

/**
 * XOR-based encryption processor for educational/testing purposes
 * Simple bitwise XOR encryption with support for multiple key formats
 * WARNING: Not cryptographically secure - use only for demonstration or testing
 */
export class XorStreamCipherProcessor implements EncryptionProcessor<XORKeyType> {
  constructor() {}

  async encrypt(
    data: ArrayBuffer, 
    key: XORKeyType, 
    options?: EncryptionOptions
  ): Promise<{ encrypted: ArrayBuffer; metadata: CryptoMetadata }> {
    const keyBytes = this.prepareKey(key);
    const dataBytes = new Uint8Array(data);
    const encrypted = new Uint8Array(dataBytes.length);

    // XOR each byte with the key
    for (let i = 0; i < dataBytes.length; i++) {
      encrypted[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
    }

    return {
      encrypted: encrypted.buffer,
      metadata: {
        algorithm: 'XOR',
        keyLength: keyBytes.length
      }
    };
  }

  async decrypt(
    encryptedData: ArrayBuffer,
    key: XORKeyType,
    metadata: CryptoMetadata,
    options?: EncryptionOptions
  ): Promise<ArrayBuffer> {
    // XOR decryption is the same as encryption
    const result = await this.encrypt(encryptedData, key, options);
    return result.encrypted;
  }

  getName(): string {
    return 'XorStreamCipherProcessor';
  }

  private prepareKey(key: XORKeyType): Uint8Array {
    if (key instanceof ArrayBuffer) {
      return new Uint8Array(key);
    }
    
    if (key instanceof Uint8Array) {
      return key;
    }
    
    if (typeof key === 'string') {
      const encoder = new TextEncoder();
      return encoder.encode(key);
    }
    
    if (Array.isArray(key)) {
      if (!key.every(item => typeof item === 'number' && item >= 0 && item <= 255)) {
        throw new Error('Array key must contain only numbers between 0 and 255');
      }
      return new Uint8Array(key);
    }
    
    throw new Error(`Unsupported key type for XOR encryption: ${typeof key}`);
  }
}