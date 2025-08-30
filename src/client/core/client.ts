import type { EncryptedSlice, SessionInfo } from '../../shared/types/interfaces.js';
import type { RetryConfig } from '../network/retry-manager.js';
import type { Transport } from '../network/transport.js';
import { decompressData } from '../../shared/compression/data-compression.js';
import { decryptData } from '../../shared/crypto/encryption.js';
import { KeyExchangeManager } from '../../shared/crypto/key-exchange.js';
import { RetryManager } from '../network/retry-manager.js';
import {
  DecodingError,
  DecryptionError,
  NetworkError,
} from '../network/transport.js';

export interface ClientConfig {
  bufferSize: number;
  prefetchSize: number;
  retryConfig: Partial<RetryConfig>;
}

export interface AudioSliceData {
  audioBuffer: AudioBuffer;
  sequence: number;
}

/**
 * Secure audio client for encrypted audio streaming
 * Handles key exchange, session management, and buffer strategies
 * Uses pluggable transport interface for flexibility
 */
export class SecureAudioClient {
  private keyManager = new KeyExchangeManager();
  private audioContext: AudioContext;
  private transport: Transport;
  private retryManager: RetryManager;

  public config: ClientConfig;
  private sessionInfo: SessionInfo | null = null;
  private sessionKey: CryptoKey | null = null;

  // Buffer management
  private audioBuffers = new Map<number, AudioSliceData>();
  private playedSlices = new Set<number>();
  private currentSlice = 0;

  constructor(transport: Transport, config: Partial<ClientConfig> = {}) {
    this.transport = transport;
    this.config = {
      bufferSize: 5,
      prefetchSize: 3,
      retryConfig: {},
      ...config,
    };
    this.retryManager = new RetryManager(this.config.retryConfig);
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    await this.keyManager.initialize();

    // Create key exchange request
    const keyExchangeRequest = await this.keyManager.createKeyExchangeRequest();

    // Perform key exchange with retry
    const keyExchangeResponse = await this.retryManager.retry(async() => {
      try {
        return await this.transport.performKeyExchange(sessionId, keyExchangeRequest);
      } catch(error) {
        throw new NetworkError('Key exchange failed', error as Error);
      }
    });

    // Process key exchange response
    this.sessionKey = await this.keyManager.processKeyExchangeResponse(keyExchangeResponse);
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

    // Check if slice is already loaded
    const sequence = Number.parseInt(sliceId.replace('slice_', ''));
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

    // Convert to AudioBuffer with retry
    const audioBuffer = await this.retryManager.retry(async() => {
      try {
        return await this.audioContext.decodeAudioData(audioData);
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

      const sliceId = `slice_${sliceIndex}`;

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
   * Decrypt slice data
   */
  private async decryptSlice(encryptedSlice: EncryptedSlice): Promise<ArrayBuffer> {
    if (!this.sessionKey) {
      throw new Error('Session key not available');
    }

    // Data is binary - no encoding conversion needed
    const encryptedData = encryptedSlice.encryptedData;
    const iv = encryptedSlice.iv;

    // Decrypt
    const compressedData = await decryptData(this.sessionKey, encryptedData, iv);

    // Decompress
    const audioData = await decompressData(compressedData);

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
    this.keyManager.destroy();
    this.audioBuffers.clear();
    this.playedSlices.clear();

    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}
