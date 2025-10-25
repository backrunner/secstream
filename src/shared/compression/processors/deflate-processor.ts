import type { CompressionOptions, CompressionProcessor } from '../../types/processors.js';
import { deflateSync, inflateSync } from 'fflate';

/**
 * DEFLATE-based compression processor using fflate library
 * Provides efficient DEFLATE compression/decompression for audio data transmission
 * Optimal for real-time audio streaming with configurable compression levels
 *
 * Uses synchronous versions (deflateSync/inflateSync) to avoid Worker dependencies
 * which cause issues in server-side environments like Node.js and Cloudflare Workers
 */
export class DeflateCompressionProcessor implements CompressionProcessor {
  private readonly defaultLevel: number;

  constructor(defaultLevel: number = 6) {
    if (defaultLevel < 0 || defaultLevel > 9) {
      throw new Error('Compression level must be between 0 and 9');
    }
    this.defaultLevel = defaultLevel;
  }

  async compress(data: ArrayBuffer, options?: CompressionOptions): Promise<ArrayBuffer> {
    try {
      const uint8Data = new Uint8Array(data);
      const level = this.validateCompressionLevel(options?.level ?? this.defaultLevel);

      // Use synchronous version to avoid Worker dependency
      const compressed = deflateSync(uint8Data, { level });
      return compressed.buffer as ArrayBuffer;
    } catch (err) {
      throw new Error(`Compression failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async decompress(compressedData: ArrayBuffer): Promise<ArrayBuffer> {
    try {
      const uint8Data = new Uint8Array(compressedData);

      // Use synchronous version to avoid Worker dependency
      const decompressed = inflateSync(uint8Data);
      return decompressed.buffer as ArrayBuffer;
    } catch (err) {
      throw new Error(`Decompression failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getName(): string {
    return 'DeflateCompressionProcessor';
  }

  private validateCompressionLevel(level: unknown): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 {
    if (typeof level !== 'number' || level < 0 || level > 9 || !Number.isInteger(level)) {
      throw new Error('Compression level must be an integer between 0 and 9');
    }
    return level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  }
}
