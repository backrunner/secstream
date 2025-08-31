import type { CryptoMetadata, EncryptionProcessor } from '../../types/processors.js';

/**
 * Supported key types for AES-GCM encryption
 */
export type AESGCMKeyType = CryptoKey | ArrayBuffer | string;

/**
 * AES-GCM encryption processor using Web Crypto API
 * Provides industry-standard AES-256-GCM encryption for secure audio streaming
 * Supports multiple key formats: CryptoKey, ArrayBuffer, and string
 */
export class AesGcmEncryptionProcessor implements EncryptionProcessor<AESGCMKeyType> {
  constructor() {}

  async encrypt(
    data: ArrayBuffer,
    key: AESGCMKeyType,
  ): Promise<{ encrypted: ArrayBuffer; metadata: CryptoMetadata }> {
    const cryptoKey = await this.ensureCryptoKey(key);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      cryptoKey,
      data,
    );

    return {
      encrypted,
      metadata: {
        iv: iv.buffer as ArrayBuffer,
        algorithm: 'AES-GCM',
      },
    };
  }

  async decrypt(
    encryptedData: ArrayBuffer,
    key: AESGCMKeyType,
    metadata: CryptoMetadata,
  ): Promise<ArrayBuffer> {
    const cryptoKey = await this.ensureCryptoKey(key);
    const iv = this.extractIV(metadata);

    return await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      cryptoKey,
      encryptedData,
    );
  }

  getName(): string {
    return 'AesGcmEncryptionProcessor';
  }

  private async ensureCryptoKey(key: AESGCMKeyType): Promise<CryptoKey> {
    if (key instanceof CryptoKey) {
      return key;
    }

    let keyData: ArrayBuffer;

    if (typeof key === 'string') {
      const encoder = new TextEncoder();
      const encodedKey = encoder.encode(key);

      // Pad or truncate to 32 bytes for AES-256
      const paddedKey = new Uint8Array(32);
      paddedKey.set(encodedKey.slice(0, Math.min(encodedKey.length, 32)));
      keyData = paddedKey.buffer as ArrayBuffer;
    } else if (key instanceof ArrayBuffer) {
      // Pad or truncate to 32 bytes for AES-256
      const paddedKey = new Uint8Array(32);
      const keyBytes = new Uint8Array(key);
      paddedKey.set(keyBytes.slice(0, Math.min(keyBytes.length, 32)));
      keyData = paddedKey.buffer as ArrayBuffer;
    } else {
      throw new TypeError(`Unsupported key type: ${typeof key}`);
    }

    return await crypto.subtle.importKey(
      'raw',
      keyData,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private extractIV(metadata: CryptoMetadata): ArrayBuffer {
    if (!metadata.iv || !(metadata.iv instanceof ArrayBuffer)) {
      throw new Error('Invalid or missing IV in metadata');
    }
    return metadata.iv;
  }
}
