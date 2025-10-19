import type { EncryptedSlice, SessionInfo } from '../../shared/types/interfaces.js';
import type {
  CompressionProcessor,
  CryptoMetadata,
  EncryptionProcessor,
  KeyExchangeProcessor,
  ProcessingConfig,
} from '../../shared/types/processors.js';
import type { RetryConfig } from '../network/retry-manager.js';
import type { Transport } from '../network/transport.js';
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';
import { EcdhP256KeyExchangeProcessor } from '../../shared/crypto/key-exchange/ecdh-p256-processor.js';
import { AesGcmEncryptionProcessor } from '../../shared/crypto/processors/aes-gcm-processor.js';
import { RetryManager } from '../network/retry-manager.js';
import {
  DecodingError,
  DecryptionError,
  NetworkError,
} from '../network/transport.js';

export interface ClientConfig<
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor,
> {
  bufferSize: number;
  prefetchSize: number;
  /** Maximum concurrent prefetch/loading operations (excludes the active, high-priority load) */
  prefetchConcurrency: number;
  retryConfig: Partial<RetryConfig>;
  processingConfig?: ProcessingConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>;
}

export interface AudioSliceData {
  audioBuffer: AudioBuffer;
  sequence: number;
}

/**
 * Secure audio client for encrypted audio streaming
 * Handles key exchange, session management, and buffer strategies
 * Uses pluggable transport interface for flexibility
 * Supports customizable compression and encryption processors
 */
export class SecureAudioClient<
  TKey = unknown,
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor,
> {
  private keyExchangeProcessor: TKeyExchangeProcessor;
  private audioContext: AudioContext;
  private transport: Transport;
  private retryManager: RetryManager;
  private compressionProcessor: TCompressionProcessor;
  private encryptionProcessor: TEncryptionProcessor;

  public config: ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>;
  private sessionInfo: SessionInfo | null = null;
  private sessionKey: TKey | null = null;

  // Buffer management
  private audioBuffers = new Map<number, AudioSliceData>();
  private playedSlices = new Set<number>();
  private loadingSlices = new Map<string, AbortController>(); // Track slices currently being loaded with abort controllers
  private currentSlice = 0;

  constructor(
    transport: Transport,
    config: Partial<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>> = {},
  ) {
    this.transport = transport;
    this.config = {
      bufferSize: 5,
      prefetchSize: 3,
      prefetchConcurrency: 3,
      retryConfig: {},
      ...config,
    };
    this.retryManager = new RetryManager(this.config.retryConfig);
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Initialize processors with defaults or user-provided ones
    const processingConfig = this.config.processingConfig || {};
    this.compressionProcessor = (processingConfig.compressionProcessor || new DeflateCompressionProcessor()) as TCompressionProcessor;
    this.encryptionProcessor = (processingConfig.encryptionProcessor || new AesGcmEncryptionProcessor()) as TEncryptionProcessor;
    this.keyExchangeProcessor = (processingConfig.keyExchangeProcessor || new EcdhP256KeyExchangeProcessor()) as TKeyExchangeProcessor;
  }

  /**
   * Expose the decoding AudioContext so that player can share it to avoid resampling
   */
  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  /**
   * Create session with audio data
   * Framework handles the process, developer implements transport
   */
  async createSession(audioData: File | ArrayBuffer): Promise<string> {
    return await this.retryManager.retry(async() => {
      try {
        return await this.transport.createSession(audioData);
      } catch(error) {
        throw new NetworkError('Failed to create session', error as Error);
      }
    });
  }

  /**
   * Initialize session with key exchange
   * Core framework functionality - handles crypto automatically
   */
  async initializeSession(sessionId: string): Promise<SessionInfo> {
    // Initialize key exchange
    await this.keyExchangeProcessor.initialize();

    // Create key exchange request
    const keyExchangeRequest = await this.keyExchangeProcessor.createKeyExchangeRequest();

    // Perform key exchange with retry
    const keyExchangeResponse = await this.retryManager.retry(async() => {
      try {
        return await this.transport.performKeyExchange(sessionId, keyExchangeRequest);
      } catch(error) {
        throw new NetworkError('Key exchange failed', error as Error);
      }
    });

    // Process key exchange response
    this.sessionKey = await this.keyExchangeProcessor.processKeyExchangeResponse(keyExchangeResponse) as TKey;
    this.sessionInfo = keyExchangeResponse.sessionInfo;

    // Align decode context sample rate with source to preserve quality
    try {
      if (this.audioContext.sampleRate !== this.sessionInfo.sampleRate) {
        if (this.audioContext.state !== 'closed') {
          await this.audioContext.close();
        }
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: this.sessionInfo.sampleRate,
        });
      }
    } catch {
      // Fallback: if sampleRate hint not supported, continue with existing context
    }

    return this.sessionInfo;
  }

  /**
   * Check if there are any pending slice loading operations
   */
  hasPendingLoads(): boolean {
    return this.loadingSlices.size > 0;
  }

  /**
   * Cancel all pending slice loading operations
   */
  cancelPendingLoads(): void {
    // Cancel all ongoing slice loading operations
    for (const [_sliceId, controller] of this.loadingSlices) {
      controller.abort();
    }
    this.loadingSlices.clear();
  }

  /**
   * Load slice with buffering strategy
   * Framework manages caching and decryption
   */
  async loadSlice(sliceId: string, abortSignal?: AbortSignal): Promise<AudioSliceData> {
    if (!this.sessionInfo || !this.sessionKey) {
      throw new Error('Session not initialized');
    }

    // Get sequence from slice ID using the session info
    const sequence = this.sessionInfo.sliceIds.indexOf(sliceId);
    if (sequence === -1) {
      throw new Error(`Invalid slice ID: ${sliceId}`);
    }

    // Check if slice is already loaded
    const cached = this.audioBuffers.get(sequence);
    if (cached) {
      return cached;
    }

    // Check if slice is currently being loaded
    const existingController = this.loadingSlices.get(sliceId);
    if (existingController) {
      // If we have a new abort signal, cancel the existing load and start fresh
      if (abortSignal) {
        existingController.abort();
        this.loadingSlices.delete(sliceId);
      } else {
        // Wait for the ongoing loading to complete
        return new Promise<AudioSliceData>((resolve, reject) => {
          const checkLoading = (): void => {
            const cached = this.audioBuffers.get(sequence);
            if (cached) {
              resolve(cached);
            } else if (!this.loadingSlices.has(sliceId)) {
              // Loading failed, reject
              reject(new Error(`Slice loading failed: ${sliceId}`));
            } else {
              // Still loading, check again after a short delay
              setTimeout(checkLoading, 50);
            }
          };
          checkLoading();
        });
      }
    }

    // Create abort controller for this loading operation
    const loadController = new AbortController();

    // Chain with provided abort signal if any
    if (abortSignal) {
      if (abortSignal.aborted) {
        throw new Error('Operation cancelled');
      }
      abortSignal.addEventListener('abort', () => {
        loadController.abort();
      });
    }

    // Mark slice as being loaded
    this.loadingSlices.set(sliceId, loadController);

    try {
      // Check if cancelled before starting
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      // Fetch encrypted slice with retry and cancellation support
      const encryptedSlice = await this.retryManager.retry(async() => {
        if (loadController.signal.aborted) {
          throw new Error('Operation cancelled');
        }
        try {
          return await this.transport.fetchSlice(this.sessionInfo!.sessionId, sliceId);
        } catch(error) {
          throw new NetworkError(`Failed to fetch slice ${sliceId}`, error as Error);
        }
      });

      // Check if cancelled after fetch
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      // Decrypt and decompress the slice with retry
      const audioData = await this.retryManager.retry(async() => {
        if (loadController.signal.aborted) {
          throw new Error('Operation cancelled');
        }
        try {
          return await this.decryptSlice(encryptedSlice);
        } catch(error) {
          throw new DecryptionError(`Failed to decrypt slice ${sliceId}`, error as Error);
        }
      });

      // Check if cancelled after decrypt
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      // Convert raw PCM data to AudioBuffer with retry
      const audioBuffer = await this.retryManager.retry(async() => {
        if (loadController.signal.aborted) {
          throw new Error('Operation cancelled');
        }
        try {
          return this.createAudioBufferFromPCM(audioData, this.sessionInfo!);
        } catch(error) {
          throw new DecodingError(`Failed to decode slice ${sliceId}`, error as Error);
        }
      });

      // Final check if cancelled before storing
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const sliceData: AudioSliceData = {
        audioBuffer,
        sequence: encryptedSlice.sequence,
      };

      // Store in buffer only if not cancelled
      this.audioBuffers.set(sequence, sliceData);

      // Clean up old buffers
      this.cleanupBuffers();

      return sliceData;
    } catch(error) {
      // If operation was cancelled, don't treat as error
      if (error instanceof Error && error.message === 'Operation cancelled') {
        throw error;
      }
      // For other errors, rethrow
      throw error;
    } finally {
      // Always remove from loading set when done (success, failure, or cancellation)
      this.loadingSlices.delete(sliceId);
    }
  }

  /**
   * Prefetch multiple slices for smooth playback
   * Framework buffer strategy - developers can customize this
   */
  async prefetchSlices(startSlice: number, count: number): Promise<void> {
    if (!this.sessionInfo)
      return;

    // Limit concurrency for prefetch to reduce contention and maintain responsiveness
    const tasks: Array<() => Promise<void>> = [];

    for (let i = 0; i < count; i++) {
      const sliceIndex = startSlice + i;
      if (sliceIndex >= this.sessionInfo.totalSlices)
        break;

      const sliceId = this.sessionInfo.sliceIds[sliceIndex];
      if (!sliceId)
        continue;

      if (this.audioBuffers.has(sliceIndex))
        continue;

      tasks.push(async() => {
        try {
          await this.loadSlice(sliceId);
        } catch(error) {
          if (!(error instanceof Error && error.message === 'Operation cancelled')) {
            console.warn(`Failed to prefetch slice ${sliceId}:`, error);
          }
        }
      });
    }

    const concurrency = Math.max(1, this.config.prefetchConcurrency);
    let index = 0;
    const runners: Promise<void>[] = [];

    const runNext = async(): Promise<void> => {
      if (index >= tasks.length)
        return;
      const task = tasks[index++];
      await task();
      return runNext();
    };

    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
      runners.push(runNext());
    }

    await Promise.all(runners);
  }

  /**
   * Get slice data if available
   */
  getSliceData(sequence: number): AudioSliceData | null {
    return this.audioBuffers.get(sequence) || null;
  }

  /**
   * Get session information
   */
  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Decrypt slice data using configurable processor
   */
  private async decryptSlice(encryptedSlice: EncryptedSlice): Promise<ArrayBuffer> {
    if (!this.sessionKey) {
      throw new Error('Session key not available');
    }

    // Data is binary - no encoding conversion needed
    const encryptedData = encryptedSlice.encryptedData;
    const metadata: CryptoMetadata = { iv: encryptedSlice.iv };

    // Decrypt using configurable processor
    // Type assertion is safe here because we know the encryption processor accepts TKey type
    const compressedData = await this.encryptionProcessor.decrypt(
      encryptedData,
      this.sessionKey as Parameters<TEncryptionProcessor['decrypt']>[1],
      metadata,
    );

    // Decompress using configurable processor
    const audioData = await this.compressionProcessor.decompress(compressedData);

    return audioData;
  }

  /**
   * Clean up old buffers based on strategy
   */
  private cleanupBuffers(): void {
    const bufferStart = Math.max(0, this.currentSlice - this.config.bufferSize);

    for (const [sequence] of this.audioBuffers) {
      if (sequence < bufferStart && this.playedSlices.has(sequence)) {
        this.audioBuffers.delete(sequence);
        this.playedSlices.delete(sequence);
      }
    }
  }

  /**
   * Create AudioBuffer from raw PCM data
   */
  private createAudioBufferFromPCM(pcmData: ArrayBuffer, sessionInfo: SessionInfo): AudioBuffer {
    const sampleRate = sessionInfo.sampleRate;
    const channels = sessionInfo.channels;
    const bitDepth = sessionInfo.bitDepth || 16;

    // Calculate number of samples per channel
    const bytesPerSample = bitDepth / 8;
    const frameSize = channels * bytesPerSample;
    const totalFrames = pcmData.byteLength / frameSize;

    // Create AudioBuffer with exact sampleRate to avoid resampling drift
    const audioBuffer = this.audioContext.createBuffer(channels, totalFrames, sampleRate);

    // Convert PCM data to float32 arrays for each channel
    const dataView = new DataView(pcmData);

    for (let channel = 0; channel < channels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);

      for (let frame = 0; frame < totalFrames; frame++) {
        const byteOffset = frame * frameSize + channel * bytesPerSample;

        let sample: number;
        if (bitDepth === 16) {
          // 16-bit signed PCM
          sample = dataView.getInt16(byteOffset, true) / 32768.0;
        } else if (bitDepth === 24) {
          // 24-bit signed PCM (stored as 3 bytes)
          const byte1 = dataView.getUint8(byteOffset);
          const byte2 = dataView.getUint8(byteOffset + 1);
          const byte3 = dataView.getUint8(byteOffset + 2);
          const intVal = (byte3 << 16) | (byte2 << 8) | byte1;
          // Convert from unsigned to signed
          sample = (intVal > 0x7FFFFF ? intVal - 0x1000000 : intVal) / 8388608.0;
        } else if (bitDepth === 32 && sessionInfo.isFloat32) {
          // 32-bit float PCM
          sample = dataView.getFloat32(byteOffset, true);
        } else if (bitDepth === 32) {
          // 32-bit signed PCM (int)
          sample = dataView.getInt32(byteOffset, true) / 2147483648.0;
        } else {
          // Default to 16-bit if unsupported bit depth
          sample = dataView.getInt16(byteOffset, true) / 32768.0;
        }

        channelData[frame] = sample;
      }
    }

    return audioBuffer;
  }

  // Mark a slice as played for cleanup purposes
  markSlicePlayed(sequence: number): void {
    this.playedSlices.add(sequence);
    this.currentSlice = Math.max(this.currentSlice, sequence);
  }

  // Check if a slice is available in buffer
  isSliceAvailable(sequence: number): boolean {
    return this.audioBuffers.has(sequence);
  }

  // Remove a specific slice from buffer
  removeSlice(sequence: number): void {
    this.audioBuffers.delete(sequence);
    this.playedSlices.delete(sequence);
  }

  // Get all buffered slice indices
  getBufferedSlices(): number[] {
    return Array.from(this.audioBuffers.keys());
  }

  // Get total duration in seconds
  getTotalDuration(): number {
    if (!this.sessionInfo)
      return 0;
    return (this.sessionInfo.totalSlices * this.sessionInfo.sliceDuration) / 1000;
  }

  // Clean up resources
  destroy(): void {
    this.keyExchangeProcessor.destroy();
    this.cancelPendingLoads();
    this.audioBuffers.clear();
    this.playedSlices.clear();

    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}
