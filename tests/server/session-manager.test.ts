import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SessionManager } from '../../src/server/core/session-manager.js'
import { KeyExchangeManager } from '../../src/shared/crypto/key-exchange.js'

// Mock audio data (simple WAV header + data)
function createMockWavData(): ArrayBuffer {
  const sampleRate = 44100
  const channels = 2
  const bitsPerSample = 16
  const duration = 2 // seconds
  const numSamples = sampleRate * duration * channels
  const dataSize = numSamples * (bitsPerSample / 8)
  const fileSize = 44 + dataSize

  const buffer = new ArrayBuffer(fileSize)
  const view = new DataView(buffer)

  // WAV header
  view.setUint32(0, 0x46464952, false) // "RIFF"
  view.setUint32(4, fileSize - 8, true) // file size - 8
  view.setUint32(8, 0x45564157, false) // "WAVE"
  view.setUint32(12, 0x20746d66, false) // "fmt "
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true) // byte rate
  view.setUint16(32, channels * (bitsPerSample / 8), true) // block align
  view.setUint16(34, bitsPerSample, true)
  view.setUint32(36, 0x61746164, false) // "data"
  view.setUint32(40, dataSize, true)

  // Generate simple sine wave data
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((i / channels) * 2 * Math.PI * 440 / sampleRate) * 0x7FFF
    view.setInt16(44 + i * 2, sample, true)
  }

  return buffer
}

describe('SessionManager', () => {
  let sessionManager: SessionManager
  let clientKeyManager: KeyExchangeManager

  beforeEach(async () => {
    sessionManager = new SessionManager()
    clientKeyManager = new KeyExchangeManager()
    await clientKeyManager.initialize()
  })

  afterEach(() => {
    sessionManager.destroy()
    clientKeyManager.destroy()
  })

  it('should create a session', async () => {
    const audioData = createMockWavData()
    const sessionId = await sessionManager.createSession(audioData)
    
    expect(sessionId).toBeDefined()
    expect(typeof sessionId).toBe('string')
    expect(sessionId).toMatch(/^session_\d+_[a-z0-9]+$/)
  })

  it('should handle key exchange and process audio', async () => {
    // Create session
    const audioData = createMockWavData()
    const sessionId = await sessionManager.createSession(audioData)
    
    // Create key exchange request
    const keyExchangeRequest = await clientKeyManager.createKeyExchangeRequest()
    
    // Handle key exchange
    const response = await sessionManager.handleKeyExchange(sessionId, keyExchangeRequest)
    
    console.log('Key exchange response:', response.sessionInfo);
    
    expect(response).toBeDefined()
    expect(response.serverPublicKey).toBeDefined()
    expect(response.encryptedSessionKey).toBeDefined()
    expect(response.sessionInfo).toBeDefined()
    expect(response.sessionInfo.sessionId).toBe(sessionId)
    expect(response.sessionInfo.totalSlices).toBeGreaterThan(0)
  })

  it('should retrieve session info', async () => {
    // Create session and complete key exchange
    const audioData = createMockWavData()
    const sessionId = await sessionManager.createSession(audioData)
    const keyExchangeRequest = await clientKeyManager.createKeyExchangeRequest()
    await sessionManager.handleKeyExchange(sessionId, keyExchangeRequest)
    
    const sessionInfo = sessionManager.getSessionInfo(sessionId)
    
    expect(sessionInfo).toBeDefined()
    expect(sessionInfo!.sessionId).toBe(sessionId)
    expect(sessionInfo!.sampleRate).toBe(44100)
    expect(sessionInfo!.channels).toBe(2)
  })

  it('should retrieve encrypted slices', async () => {
    // Create session and complete key exchange
    const audioData = createMockWavData()
    const sessionId = await sessionManager.createSession(audioData)
    const keyExchangeRequest = await clientKeyManager.createKeyExchangeRequest()
    const response = await sessionManager.handleKeyExchange(sessionId, keyExchangeRequest)
    
    // Get session info to access slice IDs
    const sessionInfo = sessionManager.getSessionInfo(sessionId)
    expect(sessionInfo).toBeDefined()
    expect(sessionInfo!.sliceIds).toBeDefined()
    expect(sessionInfo!.sliceIds.length).toBeGreaterThan(0)
    
    // Try to get the first slice using the actual slice ID
    const firstSliceId = sessionInfo!.sliceIds[0]
    const slice = await sessionManager.getSlice(sessionId, firstSliceId)
    
    expect(slice).toBeDefined()
    expect(slice!.id).toBe(firstSliceId)
    expect(slice!.sessionId).toBe(sessionId)
    expect(slice!.sequence).toBe(0)
    expect(slice!.encryptedData).toBeDefined()
    expect(slice!.iv).toBeDefined()
  })

  it('should return null for non-existent session', async () => {
    const sessionInfo = sessionManager.getSessionInfo('non-existent')
    expect(sessionInfo).toBeNull()
    
    const slice = await sessionManager.getSlice('non-existent', 'invalid-slice-id')
    expect(slice).toBeNull()
  })

  it('should destroy session', async () => {
    const audioData = createMockWavData()
    const sessionId = await sessionManager.createSession(audioData)
    
    sessionManager.destroySession(sessionId)
    
    const sessionInfo = sessionManager.getSessionInfo(sessionId)
    expect(sessionInfo).toBeNull()
  })

  it('should provide session statistics', async () => {
    const initialStats = sessionManager.getStats()
    expect(initialStats.activeSessions).toBe(0)
    
    const audioData = createMockWavData()
    await sessionManager.createSession(audioData)
    
    const stats = sessionManager.getStats()
    expect(stats.activeSessions).toBe(1)
  })

  it('should handle buffer input type', async () => {
    const audioData = createMockWavData()
    const buffer = Buffer.from(audioData)
    
    const sessionId = await sessionManager.createSession(buffer)
    expect(sessionId).toBeDefined()
  })

  it('should handle errors gracefully', async () => {
    // Test with invalid session ID
    await expect(
      sessionManager.handleKeyExchange('invalid-session', await clientKeyManager.createKeyExchangeRequest())
    ).rejects.toThrow()
  })
})