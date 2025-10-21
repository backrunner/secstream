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
import type { DecryptionWorkerConfig } from '../workers/decryption-worker-types.js';
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';
import { EcdhP256KeyExchangeProcessor } from '../../shared/crypto/key-exchange/ecdh-p256-processor.js';
import { AesGcmEncryptionProcessor } from '../../shared/crypto/processors/aes-gcm-processor.js';
import { RetryManager } from '../network/retry-manager.js';
import {
  DecodingError,
  DecryptionError,
  NetworkError,
} from '../network/transport.js';
import { DecryptionWorkerManager } from '../workers/decryption-worker-manager.js';

// Default configuration constants
const DEFAULT_PREFETCH_CONCURRENCY = 3;
const DEFAULT_BUFFER_SIZE = 5;
const DEFAULT_POLL_INTERVAL_MS = 50;

export interface ClientConfig<
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor,
> {
  /** Maximum concurrent prefetch/loading operations */
  prefetchConcurrency?: number;
  retryConfig?: Partial<RetryConfig>;
  processingConfig?: ProcessingConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>;
  /** Web Worker configuration for offloading decryption (optional) */
  workerConfig?: Partial<DecryptionWorkerConfig>;
  /** URL to the worker script (required if workerConfig.enabled is true) */
  workerUrl?: string;
}

export interface AudioSliceData {
  audioBuffer: AudioBuffer;
  sequence: number;
}

/**
 * Secure audio client for encrypted audio streaming
 * Handles key exchange, session management, and slice storage
 * Uses pluggable transport interface for flexibility
 * Supports customizable compression and encryption processors
 *
 * Note: This client acts as "dumb storage" - it loads and stores slices on demand.
 * Buffer management strategies (prefetch/cleanup) are handled by SecureAudioPlayer.
 * If using standalone, call cleanupBuffers() manually when needed.
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
  private workerManager: DecryptionWorkerManager | null = null;

  public config: ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>;
  private sessionInfo: SessionInfo | null = null;
  private sessionKey: TKey | null = null;

  // Buffer management
  private audioBuffers = new Map<number, AudioSliceData>();
  private playedSlices = new Set<number>();
  private loadingSlices = new Map<string, AbortController>(); // Track slices currently being loaded with abort controllers

  constructor(
    transport: Transport,
    config: Partial<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>> = {},
  ) {
    this.transport = transport;
    this.config = {
      prefetchConcurrency: DEFAULT_PREFETCH_CONCURRENCY,
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

    // Initialize Web Worker manager if enabled
    if (this.config.workerConfig?.enabled && this.config.workerUrl) {
      const workerConfig: DecryptionWorkerConfig = {
        enabled: true,
        workerCount: this.config.workerConfig.workerCount,
        maxQueueSize: this.config.workerConfig.maxQueueSize,
      };

      this.workerManager = new DecryptionWorkerManager(
        this.config.workerUrl,
        this.compressionProcessor.getName(),
        this.encryptionProcessor.getName(),
        workerConfig,
      );
    }
  }

  /**
   * Expose the decoding AudioContext so that player can share it to avoid resampling
   */
  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  /**
   * Get current client configuration
   */
  getConfig(): Readonly<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>> {
    return { ...this.config };
  }

  /**
   * Update client configuration at runtime
   * @param updates - Partial config object with properties to update
   */
  updateConfig(updates: Partial<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>>): void {
    this.config = {
      ...this.config,
      ...updates,
    };

    // Update retry manager if retry config changed
    if (updates.retryConfig) {
      this.retryManager = new RetryManager({
        ...this.config.retryConfig,
        ...updates.retryConfig,
      });
    }
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

    // Initialize worker manager if configured
    if (this.workerManager) {
      try {
        await this.workerManager.initialize();
      } catch(error) {
        console.warn('Failed to initialize Web Worker, falling back to main thread:', error);
        this.workerManager = null;
      }
    }

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
              setTimeout(checkLoading, DEFAULT_POLL_INTERVAL_MS);
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

      // Convert audio data to AudioBuffer with retry
      // For WAV (PCM), parse manually; for MP3/FLAC/OGG, use Web Audio API decoder
      const audioBuffer = await this.retryManager.retry(async() => {
        if (loadController.signal.aborted) {
          throw new Error('Operation cancelled');
        }
        try {
          const format = this.sessionInfo!.format || 'wav';
          if (format === 'wav') {
            // Raw PCM data - parse manually for precise control
            return this.createAudioBufferFromPCM(audioData, this.sessionInfo!);
          } else {
            // Compressed format (MP3, FLAC, OGG) - use Web Audio API decoder
            // This is more efficient than server-side decoding
            return await this.createAudioBufferFromCompressed(audioData);
          }
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

    const concurrency = Math.max(1, this.config.prefetchConcurrency ?? DEFAULT_PREFETCH_CONCURRENCY);
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
   * Uses Web Worker if configured, otherwise falls back to main thread
   */
  private async decryptSlice(encryptedSlice: EncryptedSlice): Promise<ArrayBuffer> {
    if (!this.sessionKey) {
      throw new Error('Session key not available');
    }

    // Try using Web Worker if available
    if (this.workerManager) {
      try {
        // Convert session key to transferable type
        let transferableKey: ArrayBuffer | string;
        if (this.sessionKey instanceof ArrayBuffer) {
          transferableKey = this.sessionKey;
        } else if (typeof this.sessionKey === 'string') {
          transferableKey = this.sessionKey;
        } else if (this.sessionKey instanceof CryptoKey) {
          // CryptoKey cannot be transferred to workers easily
          // Fall back to main thread for CryptoKey
          throw new TypeError('CryptoKey not supported in workers, using main thread');
        } else {
          // Unknown key type, fall back to main thread
          throw new TypeError('Unknown key type, using main thread');
        }

        return await this.workerManager.decryptSlice(encryptedSlice, transferableKey);
      } catch(error) {
        // Log warning and fall through to main thread decryption
        console.warn('Worker decryption failed, falling back to main thread:', error);
      }
    }

    // Main thread decryption (fallback or default)
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
   * Manually clean up old buffers based on current playback position
   * Note: When using SecureAudioPlayer, buffer cleanup is managed by player strategies.
   * Only call this manually if using the client standalone without a player.
   * @param currentSlice - The current slice being played
   * @param bufferSize - Number of slices to keep in buffer behind current position
   */
  cleanupBuffers(currentSlice: number, bufferSize: number = DEFAULT_BUFFER_SIZE): void {
    const bufferStart = Math.max(0, currentSlice - bufferSize);

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

  /**
   * Create AudioBuffer from compressed audio data (MP3, FLAC, OGG) using Web Audio API
   */
  private async createAudioBufferFromCompressed(compressedData: ArrayBuffer): Promise<AudioBuffer> {
    // Use browser's built-in decoder - supports MP3, AAC, WAV, FLAC, OGG, etc.
    // This is much more efficient than server-side decoding
    return await this.audioContext.decodeAudioData(compressedData);
  }

  // Mark a slice as played for cleanup purposes
  markSlicePlayed(sequence: number): void {
    this.playedSlices.add(sequence);
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

    // Clean up worker manager
    if (this.workerManager) {
      this.workerManager.destroy();
      this.workerManager = null;
    }

    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}
