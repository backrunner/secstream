import type { EncryptedSlice, SessionInfo } from '../../shared/types/interfaces.js';
import type { RetryConfig } from '../network/retry-manager.js';
import type { Transport } from '../network/transport.js';
import type { 
  CompressionProcessor, 
  EncryptionProcessor, 
  ProcessingConfig, 
  KeyExchangeProcessor,
  CryptoMetadata 
} from '../../shared/types/processors.js';
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';
import { AesGcmEncryptionProcessor } from '../../shared/crypto/processors/aes-gcm-processor.js';
import { EcdhP256KeyExchangeProcessor } from '../../shared/crypto/key-exchange/ecdh-p256-processor.js';
import { RetryManager } from '../network/retry-manager.js';
import {
  DecodingError,
  DecryptionError,
  NetworkError,
} from '../network/transport.js';

export interface ClientConfig<
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor
> {
  bufferSize: number;
  prefetchSize: number;
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
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor
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
  private currentSlice = 0;

  constructor(
    transport: Transport, 
    config: Partial<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>> = {}
  ) {
    this.transport = transport;
    this.config = {
      bufferSize: 5,
      prefetchSize: 3,
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

    return this.sessionInfo;
  }

  /**
   * Load slice with buffering strategy
   * Framework manages caching and decryption
   */
  async loadSlice(sliceId: string): Promise<AudioSliceData> {
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

    // Fetch encrypted slice with retry
    const encryptedSlice = await this.retryManager.retry(async() => {
      try {
        return await this.transport.fetchSlice(this.sessionInfo!.sessionId, sliceId);
      } catch(error) {
        throw new NetworkError(`Failed to fetch slice ${sliceId}`, error as Error);
      }
    });

    // Decrypt and decompress the slice with retry
    const audioData = await this.retryManager.retry(async() => {
      try {
        return await this.decryptSlice(encryptedSlice);
      } catch(error) {
        throw new DecryptionError(`Failed to decrypt slice ${sliceId}`, error as Error);
      }
    });

    // Convert raw PCM data to AudioBuffer with retry
    const audioBuffer = await this.retryManager.retry(async() => {
      try {
        return this.createAudioBufferFromPCM(audioData, this.sessionInfo!);
      } catch(error) {
        throw new DecodingError(`Failed to decode slice ${sliceId}`, error as Error);
      }
    });

    const sliceData: AudioSliceData = {
      audioBuffer,
      sequence: encryptedSlice.sequence,
    };

    // Store in buffer
    this.audioBuffers.set(sequence, sliceData);

    // Clean up old buffers
    this.cleanupBuffers();

    return sliceData;
  }

  /**
   * Prefetch multiple slices for smooth playback
   * Framework buffer strategy - developers can customize this
   */
  async prefetchSlices(startSlice: number, count: number): Promise<void> {
    if (!this.sessionInfo)
      return;

    const promises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      const sliceIndex = startSlice + i;
      if (sliceIndex >= this.sessionInfo.totalSlices)
        break;

      // Get slice ID from the session's slice ID list
      const sliceId = this.sessionInfo.sliceIds[sliceIndex];
      if (!sliceId) {
        console.warn(`No slice ID found for index ${sliceIndex}`);
        continue;
      }

      // Only prefetch if not already cached
      if (!this.audioBuffers.has(sliceIndex)) {
        promises.push(
          this.loadSlice(sliceId).then(() => {}).catch((error) => {
            console.warn(`Failed to prefetch slice ${sliceId}:`, error);
          }),
        );
      }
    }

    await Promise.all(promises);
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
      metadata
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

    // Create AudioBuffer
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
        } else if (bitDepth === 32) {
          // 32-bit signed PCM
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

  // Get total duration in seconds
  getTotalDuration(): number {
    if (!this.sessionInfo)
      return 0;
    return (this.sessionInfo.totalSlices * this.sessionInfo.sliceDuration) / 1000;
  }

  // Clean up resources
  destroy(): void {
    this.keyExchangeProcessor.destroy();
    this.audioBuffers.clear();
    this.playedSlices.clear();

    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}