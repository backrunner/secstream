import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { 
  generateKeyPair, 
  exportPublicKey, 
  importPublicKey, 
  deriveSharedKey, 
  generateSessionKey,
  encryptData,
  decryptData,
  exportKey,
  importKey
} from '../../src/shared/crypto/encryption.js'

describe('Crypto utilities', () => {
  it('should generate key pair', async () => {
    const keyPair = await generateKeyPair()
    expect(keyPair).toBeDefined()
    expect(keyPair.publicKey).toBeDefined()
    expect(keyPair.privateKey).toBeDefined()
  })

  it('should export and import public key', async () => {
    const keyPair = await generateKeyPair()
    const exported = await exportPublicKey(keyPair.publicKey)
    
    expect(typeof exported).toBe('string')
    expect(exported.length).toBeGreaterThan(0)
    
    const imported = await importPublicKey(exported)
    expect(imported).toBeDefined()
  })

  it('should derive shared key from key pair', async () => {
    const keyPair1 = await generateKeyPair()
    const keyPair2 = await generateKeyPair()
    
    const sharedKey1 = await deriveSharedKey(keyPair1.privateKey, keyPair2.publicKey)
    const sharedKey2 = await deriveSharedKey(keyPair2.privateKey, keyPair1.publicKey)
    
    // Both parties should derive the same key
    const exported1 = await exportKey(sharedKey1)
    const exported2 = await exportKey(sharedKey2)
    
    expect(new Uint8Array(exported1)).toEqual(new Uint8Array(exported2))
  })

  it('should generate session key', async () => {
    const sessionKey = await generateSessionKey()
    expect(sessionKey).toBeDefined()
    
    const exported = await exportKey(sessionKey)
    expect(exported.byteLength).toBe(32) // 256 bits
  })

  it('should encrypt and decrypt data', async () => {
    const sessionKey = await generateSessionKey()
    const data = new TextEncoder().encode('Hello, secure world!')
    
    const { encrypted, iv } = await encryptData(sessionKey, data.buffer)
    expect(encrypted).toBeDefined()
    expect(iv).toBeDefined()
    expect(encrypted.byteLength).toBeGreaterThan(0)
    
    const decrypted = await decryptData(sessionKey, encrypted, iv)
    const decryptedText = new TextDecoder().decode(decrypted)
    
    expect(decryptedText).toBe('Hello, secure world!')
  })

  it('should export and import session key', async () => {
    const originalKey = await generateSessionKey()
    const exported = await exportKey(originalKey)
    const imported = await importKey(exported)
    
    // Test that both keys work the same
    const testData = new TextEncoder().encode('test data').buffer
    
    const { encrypted: encrypted1, iv } = await encryptData(originalKey, testData)
    const decrypted1 = await decryptData(imported, encrypted1, iv)
    
    expect(new Uint8Array(decrypted1)).toEqual(new Uint8Array(testData))
  })
})