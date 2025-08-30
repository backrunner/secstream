import type { KeyExchangeRequest, KeyExchangeResponse, SessionInfo } from '../types/interfaces.js';
import { decryptData, deriveSharedKey, encryptData, exportKey, exportPublicKey, generateKeyPair, generateSessionKey, importKey, importPublicKey } from './encryption.js';

/**
 * Manages ECDH key exchange protocol for secure session establishment
 * Handles both client and server sides of the key exchange process
 */
export class KeyExchangeManager {
  private keyPair: CryptoKeyPair | null = null;
  private sessionKey: CryptoKey | null = null;
  private sharedKey: CryptoKey | null = null;

  async initialize(): Promise<void> {
    this.keyPair = await generateKeyPair();
  }

  async createKeyExchangeRequest(): Promise<KeyExchangeRequest> {
    if (!this.keyPair) {
      throw new Error('KeyExchangeManager not initialized');
    }

    const publicKey = await exportPublicKey(this.keyPair.publicKey);
    return { clientPublicKey: publicKey };
  }

  async handleKeyExchangeRequest(request: KeyExchangeRequest, sessionInfo: SessionInfo): Promise<KeyExchangeResponse> {
    if (!this.keyPair) {
      throw new Error('KeyExchangeManager not initialized');
    }

    // Import client's public key
    const clientPublicKey = await importPublicKey(request.clientPublicKey);

    // Derive shared key using ECDH
    this.sharedKey = await deriveSharedKey(this.keyPair.privateKey, clientPublicKey);

    // Generate session key for this audio session
    this.sessionKey = await generateSessionKey();

    // Encrypt session key with shared key
    const sessionKeyData = await exportKey(this.sessionKey);
    const { encrypted: encryptedSessionKey, iv } = await encryptData(this.sharedKey, sessionKeyData);

    // Export our public key
    const serverPublicKey = await exportPublicKey(this.keyPair.publicKey);

    return {
      serverPublicKey,
      encryptedSessionKey: btoa(String.fromCharCode(...new Uint8Array(encryptedSessionKey))),
      iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
      sessionInfo,
    };
  }

  async processKeyExchangeResponse(response: KeyExchangeResponse): Promise<CryptoKey> {
    if (!this.keyPair) {
      throw new Error('KeyExchangeManager not initialized');
    }

    // Import server's public key
    const serverPublicKey = await importPublicKey(response.serverPublicKey);

    // Derive shared key using ECDH
    this.sharedKey = await deriveSharedKey(this.keyPair.privateKey, serverPublicKey);

    // Decrypt session key
    const encryptedSessionKeyData = Uint8Array.from(atob(response.encryptedSessionKey), c => c.charCodeAt(0)).buffer;
    const ivData = Uint8Array.from(atob(response.iv), c => c.charCodeAt(0)).buffer;

    const sessionKeyData = await decryptData(this.sharedKey, encryptedSessionKeyData, ivData);
    this.sessionKey = await importKey(sessionKeyData);

    return this.sessionKey;
  }

  getSessionKey(): CryptoKey {
    if (!this.sessionKey) {
      throw new Error('Session key not available');
    }
    return this.sessionKey;
  }

  getSharedKey(): CryptoKey {
    if (!this.sharedKey) {
      throw new Error('Shared key not available');
    }
    return this.sharedKey;
  }

  // Clean up keys from memory
  destroy(): void {
    this.keyPair = null;
    this.sessionKey = null;
    this.sharedKey = null;
  }
}
