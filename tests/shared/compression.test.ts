import { describe, it, expect } from 'vitest'
import { compressData, decompressData } from '../../src/shared/compression/data-compression.js'

describe('Compression utilities', () => {
  it('should compress and decompress data', async () => {
    const originalData = new TextEncoder().encode('This is a test string for compression. '.repeat(100))
    const originalBuffer = originalData.buffer
    
    const compressed = await compressData(originalBuffer, 6)
    expect(compressed.byteLength).toBeLessThan(originalBuffer.byteLength)
    
    const decompressed = await decompressData(compressed)
    const decompressedText = new TextDecoder().decode(decompressed)
    const originalText = new TextDecoder().decode(originalBuffer)
    
    expect(decompressedText).toBe(originalText)
  })

  it('should handle empty data', async () => {
    const emptyBuffer = new ArrayBuffer(0)
    
    const compressed = await compressData(emptyBuffer)
    const decompressed = await decompressData(compressed)
    
    expect(decompressed.byteLength).toBe(0)
  })

  it('should handle different compression levels', async () => {
    const testData = new TextEncoder().encode('Compression test data. '.repeat(50)).buffer
    
    const compressed1 = await compressData(testData, 1)
    const compressed9 = await compressData(testData, 9)
    
    // Higher compression should generally result in smaller size (though not guaranteed for small data)
    expect(compressed9.byteLength).toBeLessThanOrEqual(compressed1.byteLength * 1.1) // Allow some variance
    
    // Both should decompress to the same original data
    const decompressed1 = await decompressData(compressed1)
    const decompressed9 = await decompressData(compressed9)
    
    expect(new Uint8Array(decompressed1)).toEqual(new Uint8Array(testData))
    expect(new Uint8Array(decompressed9)).toEqual(new Uint8Array(testData))
  })

  it('should handle binary data', async () => {
    // Create some binary test data
    const binaryData = new Uint8Array(1000)
    for (let i = 0; i < 1000; i++) {
      binaryData[i] = i % 256
    }
    
    const compressed = await compressData(binaryData.buffer)
    const decompressed = await decompressData(compressed)
    
    expect(new Uint8Array(decompressed)).toEqual(binaryData)
  })
})