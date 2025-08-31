import type { 
  KeyExchangeProcessor, 
  KeyExchangeRequest, 
  KeyExchangeResponse 
} from '../../types/processors.js';
import type { SessionInfo } from '../../types/interfaces.js';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
} from '../key-management.js';

/**
 * ECDH key exchange metadata
 */
export interface ECDHKeyExchangeMetadata extends Record<string, unknown> {
  algorithm: 'ECDH';
  curve: 'P-256';
  keyType: 'CryptoKey';
}

/**
 * ECDH P-256 key exchange processor with AES-GCM key derivation
 * Uses industry-standard Elliptic Curve Diffie-Hellman key exchange
 * Derives AES-256-GCM session keys for secure audio streaming
 */
export class EcdhP256KeyExchangeProcessor implements KeyExchangeProcessor<
  CryptoKey, 
  SessionInfo, 
  never, // No custom request data
  never  // No custom response data
> {
  private keyPair: CryptoKeyPair | null = null;

  constructor() {}

  async initialize(): Promise<void> {
    this.keyPair = await generateKeyPair();
  }

  async createKeyExchangeRequest(): Promise<KeyExchangeRequest<never>> {
    if (!this.keyPair) {
      throw new Error('Key exchange processor not initialized');
    }

    const publicKeyBase64 = await exportPublicKey(this.keyPair.publicKey);
    
    return {
      publicKey: publicKeyBase64,
      metadata: {
        algorithm: 'ECDH',
        curve: 'P-256',
        keyType: 'CryptoKey'
      } as ECDHKeyExchangeMetadata
    };
  }

  async processKeyExchangeRequest(
    request: KeyExchangeRequest<never>, 
    sessionId: string
  ): Promise<{ 
    response: KeyExchangeResponse<never, SessionInfo>; 
    sessionKey: CryptoKey 
  }> {
    if (!request.publicKey) {
      throw new Error('No public key in request');
    }

    // Generate server key pair
    const serverKeyPair = await generateKeyPair();
    const serverPublicKeyBase64 = await exportPublicKey(serverKeyPair.publicKey);

    // Import client's public key
    const clientPublicKey = await importPublicKey(request.publicKey);

    // Derive shared session key
    const sessionKey = await deriveSharedKey(serverKeyPair.privateKey, clientPublicKey);

    const response: KeyExchangeResponse<never, SessionInfo> = {
      publicKey: serverPublicKeyBase64,
      sessionInfo: { sessionId } as SessionInfo, // This will be expanded by the caller
      metadata: {
        algorithm: 'ECDH',
        curve: 'P-256',
        keyType: 'CryptoKey'
      } as ECDHKeyExchangeMetadata
    };

    return { response, sessionKey };
  }

  async processKeyExchangeResponse(
    response: KeyExchangeResponse<never, SessionInfo>
  ): Promise<CryptoKey> {
    if (!this.keyPair) {
      throw new Error('Key exchange processor not initialized');
    }

    if (!response.publicKey) {
      throw new Error('No public key in response');
    }

    // Import server's public key
    const serverPublicKey = await importPublicKey(response.publicKey);

    // Derive shared session key
    const sessionKey = await deriveSharedKey(this.keyPair.privateKey, serverPublicKey);

    return sessionKey;
  }

  getName(): string {
    return 'EcdhP256KeyExchangeProcessor';
  }

  destroy(): void {
    this.keyPair = null;
  }
}