import type { AudioConfig, EncryptedSlice, SessionInfo } from '../../shared/types/interfaces.js';
import type { AudioMetadata } from '../audio/format-parser.js';
import { compressData } from '../../shared/compression/data-compression.js';
import { encryptData } from '../../shared/crypto/encryption.js';
import { estimateSampleCount, extractAudioData, parseAudioMetadata } from '../audio/format-parser.js';

export interface AudioSource {
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  length: number; // number of samples
  format: string;
  metadata: AudioMetadata;
}

/**
 * Processes audio files into encrypted slices for secure streaming
 * Handles audio decoding, slicing, compression, and encryption
 * Supports WAV, MP3, FLAC, and other audio formats
 * Compatible with Node.js, Cloudflare Workers, and other JavaScript environments
 *
 * Provides pure binary data - transport encoding is developer's responsibility
 */
export class AudioProcessor {
  private config: AudioConfig;

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = {
      sliceDurationMs: 5000,
      compressionLevel: 6,
      encryptionAlgorithm: 'AES-GCM',
      ...config,
    };
  }

  async processAudio(
    audioData: ArrayBuffer | ReadableStream,
    sessionKey: CryptoKey,
    sessionId: string,
  ): Promise<{ sessionInfo: SessionInfo; getSlice: (sliceId: string) => Promise<EncryptedSlice | null> }> {
    // Convert input to AudioBuffer-like data
    const audioSource = await this.decodeAudio(audioData);

    // Calculate slice information
    const samplesPerSlice = Math.floor((audioSource.sampleRate * this.config.sliceDurationMs) / 1000);
    const totalSlices = Math.ceil(audioSource.length / samplesPerSlice);

    const sessionInfo: SessionInfo = {
      sessionId,
      totalSlices,
      sliceDuration: this.config.sliceDurationMs,
      sampleRate: audioSource.sampleRate,
      channels: audioSource.channels,
      bitDepth: audioSource.metadata.bitDepth || 16,
    };

    // Don't pre-process all slices - create them on-demand for fast startup
    const sliceCache = new Map<string, EncryptedSlice>();

    // Return getSlice function that prepares slices on-demand
    return {
      sessionInfo,
      getSlice: async(sliceId: string) => {
        // Check cache first
        if (sliceCache.has(sliceId)) {
          return sliceCache.get(sliceId)!;
        }

        // Parse slice index from sliceId (format: "slice_0", "slice_1", etc.)
        const sliceIndex = Number.parseInt(sliceId.split('_')[1]);
        if (Number.isNaN(sliceIndex) || sliceIndex < 0 || sliceIndex >= totalSlices) {
          return null;
        }

        // Prepare slice on-demand for fast response
        const encryptedSlice = await this.prepareSlice(audioSource, sliceIndex, sessionKey, sessionId, samplesPerSlice);

        // Cache the slice (but implement LRU eviction to prevent memory buildup)
        this.manageSliceCache(sliceCache, sliceId, encryptedSlice);

        return encryptedSlice;
      },
    };
  }

  private async prepareSlice(
    audioSource: AudioSource,
    sliceIndex: number,
    sessionKey: CryptoKey,
    sessionId: string,
    samplesPerSlice: number,
  ): Promise<EncryptedSlice> {
    const startSample = sliceIndex * samplesPerSlice;
    const endSample = Math.min(startSample + samplesPerSlice, audioSource.length);
    const sliceId = `slice_${sliceIndex}`;

    // Extract slice data efficiently
    const sliceData = this.extractAudioSlice(audioSource, startSample, endSample);

    // Compress the slice
    const compressedData = await compressData(sliceData, this.config.compressionLevel);

    // Encrypt the compressed slice
    const { encrypted, iv } = await encryptData(sessionKey, compressedData);

    // Return pure binary data - no base64, no hashes
    // Developer handles transport encoding and validation as needed
    return {
      id: sliceId,
      encryptedData: encrypted, // Pure ArrayBuffer
      iv, // Pure ArrayBuffer
      sequence: sliceIndex,
      sessionId,
    };
  }

  private manageSliceCache(
    sliceCache: Map<string, EncryptedSlice>,
    sliceId: string,
    encryptedSlice: EncryptedSlice,
  ): void {
    // Add new slice to cache with expiration
    const now = Date.now();
    const ttl = 300_000; // 5 minutes server-side cache
    (encryptedSlice as any).expiresAt = now + ttl;

    sliceCache.set(sliceId, encryptedSlice);

    // Clean up expired slices first
    for (const [key, slice] of sliceCache) {
      if ((slice as any).expiresAt && (slice as any).expiresAt <= now) {
        sliceCache.delete(key);
      }
    }

    // Implement LRU eviction if still over limit
    const maxCacheSize = 10; // Increased for better performance
    if (sliceCache.size > maxCacheSize) {
      // Remove oldest non-expired slices
      const entries = Array.from(sliceCache.entries())
        .filter(([, slice]) => !(slice as any).expiresAt || (slice as any).expiresAt > now)
        .sort(([, a], [, b]) => ((a as any).cachedAt || 0) - ((b as any).cachedAt || 0));

      const excessCount = entries.length - maxCacheSize + 1;
      for (let i = 0; i < excessCount && i < entries.length; i++) {
        sliceCache.delete(entries[i][0]);
      }
    }

    // Mark when this slice was cached for LRU
    (encryptedSlice as any).cachedAt = now;
  }

  private async decodeAudio(input: ArrayBuffer | ReadableStream): Promise<AudioSource> {
    let arrayBuffer: ArrayBuffer;

    if (input instanceof ArrayBuffer) {
      arrayBuffer = input;
    } else if (input instanceof ReadableStream) {
      // Handle ReadableStream
      const reader = input.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          chunks.push(value);
          totalLength += value.length;
        }
      } finally {
        reader.releaseLock();
      }

      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      arrayBuffer = combined.buffer;
    } else {
      throw new TypeError('Unsupported audio input type');
    }

    // Parse audio metadata using the new format parser
    const metadata = parseAudioMetadata(arrayBuffer);
    const audioData = extractAudioData(arrayBuffer, metadata);
    const sampleCount = estimateSampleCount(metadata);

    return {
      data: audioData,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      length: sampleCount,
      format: metadata.format,
      metadata,
    };
  }

  private extractAudioSlice(audioSource: AudioSource, startSample: number, endSample: number): ArrayBuffer {
    // For raw PCM (WAV), we can slice directly
    if (audioSource.format === 'wav') {
      const bytesPerSample = (audioSource.metadata.bitDepth || 16) / 8;
      const frameSize = audioSource.channels * bytesPerSample;
      const startByte = startSample * frameSize;
      const endByte = endSample * frameSize;

      return audioSource.data.slice(startByte, endByte);
    }

    // For compressed formats (MP3, FLAC), we need to estimate slice positions
    // This is a simplified approach - in production, you might want to use
    // proper audio decoding libraries
    const totalBytes = audioSource.data.byteLength;
    const totalSamples = audioSource.length;
    const startByte = Math.floor((startSample / totalSamples) * totalBytes);
    const endByte = Math.floor((endSample / totalSamples) * totalBytes);

    return audioSource.data.slice(startByte, endByte);
  }
}
