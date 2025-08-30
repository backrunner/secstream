import { deflate, inflate } from 'fflate';

/**
 * Data compression utilities using fflate library
 * Provides efficient compression/decompression for audio data transmission
 */

export async function compressData(data: ArrayBuffer, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const uint8Data = new Uint8Array(data);
    deflate(uint8Data, { level }, (err: Error | null, compressed: Uint8Array) => {
      if (err)
        reject(err);
      else resolve(compressed.buffer as ArrayBuffer);
    });
  });
}

export async function decompressData(compressedData: ArrayBuffer): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const uint8Data = new Uint8Array(compressedData);
    inflate(uint8Data, (err: Error | null, decompressed: Uint8Array) => {
      if (err)
        reject(err);
      else resolve(decompressed.buffer as ArrayBuffer);
    });
  });
}
