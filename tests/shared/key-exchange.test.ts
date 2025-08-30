import { describe, it, expect, beforeEach } from 'vitest'
import { KeyExchangeManager } from '../../src/shared/crypto/key-exchange.js'
import type { SessionInfo } from '../../src/shared/types/interfaces.js'

describe('KeyExchangeManager', () => {
  let serverManager: KeyExchangeManager
  let clientManager: KeyExchangeManager
  let mockSessionInfo: SessionInfo

  beforeEach(async () => {
    serverManager = new KeyExchangeManager()
    clientManager = new KeyExchangeManager()
    await serverManager.initialize()
    await clientManager.initialize()
    
    mockSessionInfo = {
      sessionId: 'test-session',
      totalSlices: 10,
      sliceDuration: 5000,
      sampleRate: 44100,
      channels: 2
    }
  })

  it('should create key exchange request', async () => {
    const request = await clientManager.createKeyExchangeRequest()
    
    expect(request).toBeDefined()
    expect(request.clientPublicKey).toBeDefined()
    expect(typeof request.clientPublicKey).toBe('string')
    expect(request.clientPublicKey.length).toBeGreaterThan(0)
  })

  it('should handle key exchange request and generate response', async () => {
    const request = await clientManager.createKeyExchangeRequest()
    const response = await serverManager.handleKeyExchangeRequest(request, mockSessionInfo)
    
    expect(response).toBeDefined()
    expect(response.serverPublicKey).toBeDefined()
    expect(response.encryptedSessionKey).toBeDefined()
    expect(response.iv).toBeDefined()
    expect(response.sessionInfo).toEqual(mockSessionInfo)
  })

  it('should complete full key exchange', async () => {
    // Client creates request
    const request = await clientManager.createKeyExchangeRequest()
    
    // Server handles request
    const response = await serverManager.handleKeyExchangeRequest(request, mockSessionInfo)
    
    // Client processes response
    const sessionKey = await clientManager.processKeyExchangeResponse(response)
    
    expect(sessionKey).toBeDefined()
    
    // Both parties should have valid session keys
    const serverSessionKey = serverManager.getSessionKey()
    const clientSessionKey = clientManager.getSessionKey()
    
    expect(serverSessionKey).toBeDefined()
    expect(clientSessionKey).toBeDefined()
  })

  it('should allow encryption/decryption with session keys', async () => {
    // Complete key exchange
    const request = await clientManager.createKeyExchangeRequest()
    const response = await serverManager.handleKeyExchangeRequest(request, mockSessionInfo)
    await clientManager.processKeyExchangeResponse(response)
    
    // Get session keys
    const serverSessionKey = serverManager.getSessionKey()
    const clientSessionKey = clientManager.getSessionKey()
    
    // Test data encryption/decryption
    const testData = new TextEncoder().encode('Test audio slice data').buffer
    
    // Encrypt with server key
    const { encryptData, decryptData } = await import('../../src/shared/crypto/encryption.js')
    const { encrypted, iv } = await encryptData(serverSessionKey, testData)
    
    // Decrypt with client key
    const decrypted = await decryptData(clientSessionKey, encrypted, iv)
    const decryptedText = new TextDecoder().decode(decrypted)
    
    expect(decryptedText).toBe('Test audio slice data')
  })

  it('should clean up resources on destroy', async () => {
    serverManager.destroy()
    
    // Should throw error when trying to access keys after destroy
    expect(() => serverManager.getSessionKey()).toThrow()
    expect(() => serverManager.getSharedKey()).toThrow()
  })

  it('should throw error when not initialized', async () => {
    const uninitializedManager = new KeyExchangeManager()
    
    await expect(uninitializedManager.createKeyExchangeRequest()).rejects.toThrow()
  })
})