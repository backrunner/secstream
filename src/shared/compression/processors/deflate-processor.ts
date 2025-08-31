import type { CompressionOptions, CompressionProcessor } from '../../types/processors.js';
import { deflate, inflate } from 'fflate';

/**
 * DEFLATE-based compression processor using fflate library
 * Provides efficient DEFLATE compression/decompression for audio data transmission
 * Optimal for real-time audio streaming with configurable compression levels
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
    return new Promise((resolve, reject) => {
      const uint8Data = new Uint8Array(data);
      const level = this.validateCompressionLevel(options?.level ?? this.defaultLevel);

      deflate(uint8Data, { level }, (err: Error | null, compressed: Uint8Array) => {
        if (err) {
          reject(err);
        } else {
          resolve(compressed.buffer as ArrayBuffer);
        }
      });
    });
  }

  async decompress(compressedData: ArrayBuffer): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const uint8Data = new Uint8Array(compressedData);

      inflate(uint8Data, (err: Error | null, decompressed: Uint8Array) => {
        if (err) {
          reject(err);
        } else {
          resolve(decompressed.buffer as ArrayBuffer);
        }
      });
    });
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
