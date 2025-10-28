/**
 * Audio decoder interface for converting compressed formats to PCM
 * Required for Safari/Firefox compatibility with FLAC/OGG streaming
 *
 * AAC handling: Server falls back to byte estimation for AAC files on Safari/Firefox
 * since AAC decoders are too large (1MB+) for Cloudflare Workers deployment.
 * The client's Web Audio API may still be able to decode AAC slices.
 */

import type { AudioMetadata } from './format-parser.js';

export interface PCMAudioData {
  pcmData: ArrayBuffer; // Interleaved PCM samples
  sampleRate: number;
  channels: number;
  bitDepth: number; // 16, 24, or 32
  isFloat32: boolean; // true if 32-bit float, false if integer
}

/**
 * Audio decoder interface - implement this to support compressed formats
 *
 * Recommended implementation: WASMAudioDecoder (see wasm-audio-decoder.ts)
 * - Supports FLAC (~67 KB) and Ogg Vorbis (~80 KB)
 * - Compatible with Cloudflare Workers, Node.js, and browsers
 * - Uses highly optimized WASM decoders
 */
export interface AudioDecoder {
  /**
   * Decode compressed audio (FLAC/OGG) to PCM
   * @param compressedData - The compressed audio buffer
   * @param metadata - Parsed audio metadata
   * @returns PCM audio data
   */
  decode: (compressedData: ArrayBuffer, metadata: AudioMetadata) => Promise<PCMAudioData>;

  /**
   * Check if this decoder supports the given format
   */
  supportsFormat: (format: string) => boolean;

  /**
   * Get decoder name for logging/debugging
   */
  getName: () => string;
}

/**
 * Example implementation guide:
 *
 * For Node.js, Cloudflare Workers, and browser environments:
 *
 * ```typescript
 * import { WASMAudioDecoder } from 'secstream/server';
 *
 * const decoder = new WASMAudioDecoder();
 * // Supports FLAC and Ogg Vorbis
 * // Small bundle size: ~150 KB combined
 * // Compatible with Cloudflare Workers
 * ```
 *
 * For custom implementations with different formats:
 *
 * ```typescript
 * import type { AudioDecoder, PCMAudioData, AudioMetadata } from 'secstream/server';
 *
 * export class CustomAudioDecoder implements AudioDecoder {
 *   async decode(compressedData: ArrayBuffer, metadata: AudioMetadata): Promise<PCMAudioData> {
 *     // Your custom decoding logic here
 *     return {
 *       pcmData: decodedBuffer,
 *       sampleRate: 44100,
 *       channels: 2,
 *       bitDepth: 32,
 *       isFloat32: true,
 *     };
 *   }
 *
 *   supportsFormat(format: string): boolean {
 *     return ['flac', 'ogg', 'opus'].includes(format);
 *   }
 *
 *   getName(): string {
 *     return 'CustomAudioDecoder';
 *   }
 * }
 * ```
 */

