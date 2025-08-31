// Cryptographic key management utilities for secure audio streaming
// Provides ECDH key exchange and AES-GCM key generation/management functions

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey'],
  );
}

export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const keyBuffer = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'spki',
    keyBuffer,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false,
    [],
  );
}

export async function deriveSharedKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return await crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: publicKey,
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function generateSessionKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return await crypto.subtle.exportKey('raw', key);
}

export async function importKey(keyData: ArrayBuffer): Promise<CryptoKey> {
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
