import type { LegacyKeyExchangeRequest as KeyExchangeRequest, LegacyKeyExchangeResponse as KeyExchangeResponse, SessionInfo } from '../types/interfaces.js';
// import { decryptData, deriveSharedKey, encryptData, exportKey, exportPublicKey, generateKeyPair, generateSessionKey, importKey, importPublicKey } from './encryption.js';

/**
 * Manages ECDH key exchange protocol for secure session establishment
 * Handles both client and server sides of the key exchange process
 */
export class KeyExchangeManager {
  private keyPair: CryptoKeyPair | null = null;
  private sessionKey: CryptoKey | null = null;
  private sharedKey: CryptoKey | null = null;

  async initialize(): Promise<void> {
    // this.keyPair = await generateKeyPair();
    throw new Error('Legacy KeyExchangeManager is deprecated. Use EcdhP256KeyExchangeProcessor instead.');
  }

  async createKeyExchangeRequest(): Promise<KeyExchangeRequest> {
    throw new Error('Legacy KeyExchangeManager is deprecated. Use EcdhP256KeyExchangeProcessor instead.');
  }

  async handleKeyExchangeRequest(request: KeyExchangeRequest, sessionInfo: SessionInfo): Promise<KeyExchangeResponse> {
    throw new Error('Legacy KeyExchangeManager is deprecated. Use EcdhP256KeyExchangeProcessor instead.');
  }

  async processKeyExchangeResponse(response: KeyExchangeResponse): Promise<CryptoKey> {
    throw new Error('Legacy KeyExchangeManager is deprecated. Use EcdhP256KeyExchangeProcessor instead.');
  }

  getSessionKey(): CryptoKey {
    throw new Error('Legacy KeyExchangeManager is deprecated. Use EcdhP256KeyExchangeProcessor instead.');
  }

  getSharedKey(): CryptoKey {
    throw new Error('Legacy KeyExchangeManager is deprecated. Use EcdhP256KeyExchangeProcessor instead.');
  }

  // Clean up keys from memory
  destroy(): void {
    this.keyPair = null;
    this.sessionKey = null;
    this.sharedKey = null;
  }
}
