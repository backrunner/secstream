/**
 * WASM-based audio decoder implementation using @wasm-audio-decoders
 * Supports FLAC, Ogg Vorbis, and MP3 formats
 * Optimized for size and compatible with Cloudflare Workers, Node.js, and browsers
 */

import type { AudioMetadata } from './format-parser.js';
import type { AudioDecoder, PCMAudioData } from './types.js';
import { FLACDecoder } from '@wasm-audio-decoders/flac';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
import { MPEGDecoder } from 'mpg123-decoder';

/**
 * WASM-based audio decoder for FLAC, Ogg Vorbis, and MP3 formats
 * Uses highly optimized WASM decoders with small bundle sizes:
 * - FLAC: ~67 KiB
 * - Ogg Vorbis: ~80 KiB
 * - MP3: ~76 KiB
 *
 * This decoder is compatible with:
 * - Cloudflare Workers
 * - Node.js
 * - Browsers
 */
export class WASMAudioDecoder implements AudioDecoder {
  /**
   * Decode compressed audio to PCM
   */
  async decode(compressedData: ArrayBuffer, metadata: AudioMetadata): Promise<PCMAudioData> {
    const format = metadata.format;

    if (format === 'flac') {
      return await this.decodeFLAC(compressedData);
    }

    if (format === 'ogg') {
      return await this.decodeOggVorbis(compressedData);
    }

    if (format === 'mp3') {
      return await this.decodeMP3(compressedData);
    }

    throw new Error(
      `WASMAudioDecoder does not support format: ${format}. `
      + 'Supported formats: FLAC, Ogg Vorbis, MP3.',
    );
  }

  /**
   * Decode FLAC audio to PCM
   */
  private async decodeFLAC(compressedData: ArrayBuffer): Promise<PCMAudioData> {
    const decoder = new FLACDecoder();

    // Initialize the decoder
    await decoder.ready;

    // Decode the entire file
    const result = await decoder.decode(new Uint8Array(compressedData));

    // Free decoder resources
    await decoder.free();

    if (!result || !result.channelData || result.channelData.length === 0) {
      throw new Error('FLAC decoding failed: No audio data returned');
    }

    // Convert de-interleaved channel data to interleaved PCM
    const channels = result.channelData.length;
    const sampleCount = result.samplesDecoded;
    const sampleRate = result.sampleRate;
    const bitDepth = result.bitDepth || 16;

    // Interleave channels: [L0, R0, L1, R1, ...] for stereo
    const interleavedData = this.interleaveChannels(result.channelData, sampleCount);

    return {
      pcmData: interleavedData.buffer as ArrayBuffer,
      sampleRate,
      channels,
      bitDepth,
      isFloat32: bitDepth === 32,
    };
  }

  /**
   * Decode Ogg Vorbis audio to PCM
   */
  private async decodeOggVorbis(compressedData: ArrayBuffer): Promise<PCMAudioData> {
    const decoder = new OggVorbisDecoder();

    // Initialize the decoder
    await decoder.ready;

    // Decode the entire file
    const result = await decoder.decode(new Uint8Array(compressedData));

    // Free decoder resources
    await decoder.free();

    if (!result || !result.channelData || result.channelData.length === 0) {
      throw new Error('Ogg Vorbis decoding failed: No audio data returned');
    }

    // Convert de-interleaved channel data to interleaved PCM
    const channels = result.channelData.length;
    const sampleCount = result.samplesDecoded;
    const sampleRate = result.sampleRate;

    // Ogg Vorbis decoder returns Float32 samples
    const bitDepth = 32;
    const isFloat32 = true;

    // Interleave channels
    const interleavedData = this.interleaveChannels(result.channelData, sampleCount);

    return {
      pcmData: interleavedData.buffer as ArrayBuffer,
      sampleRate,
      channels,
      bitDepth,
      isFloat32,
    };
  }

  /**
   * Decode MP3 audio to PCM
   */
  private async decodeMP3(compressedData: ArrayBuffer): Promise<PCMAudioData> {
    const decoder = new MPEGDecoder();

    // Initialize the decoder
    await decoder.ready;

    // Decode the entire file
    const result = await decoder.decode(new Uint8Array(compressedData));

    // Free decoder resources
    await decoder.free();

    if (!result || !result.channelData || result.channelData.length === 0) {
      throw new Error('MP3 decoding failed: No audio data returned');
    }

    // Convert de-interleaved channel data to interleaved PCM
    const channels = result.channelData.length;
    const sampleCount = result.samplesDecoded;
    const sampleRate = result.sampleRate;

    // MP3 decoder returns Float32 samples
    const bitDepth = 32;
    const isFloat32 = true;

    // Interleave channels
    const interleavedData = this.interleaveChannels(result.channelData, sampleCount);

    return {
      pcmData: interleavedData.buffer as ArrayBuffer,
      sampleRate,
      channels,
      bitDepth,
      isFloat32,
    };
  }

  /**
   * Interleave de-interleaved channel data
   * Input: [[L0, L1, L2, ...], [R0, R1, R2, ...]]
   * Output: [L0, R0, L1, R1, L2, R2, ...]
   */
  private interleaveChannels(channelData: Float32Array[], sampleCount: number): Float32Array {
    const channels = channelData.length;
    const interleavedData = new Float32Array(sampleCount * channels);

    for (let sample = 0; sample < sampleCount; sample++) {
      for (let channel = 0; channel < channels; channel++) {
        interleavedData[sample * channels + channel] = channelData[channel][sample];
      }
    }

    return interleavedData;
  }

  /**
   * Check if this decoder supports the given format
   */
  supportsFormat(format: string): boolean {
    return format === 'flac' || format === 'ogg' || format === 'mp3';
  }

  /**
   * Get decoder name
   */
  getName(): string {
    return 'WASMAudioDecoder (FLAC, Ogg Vorbis, MP3)';
  }
}
