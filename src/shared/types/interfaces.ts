/**
 * Core type definitions and interfaces for SecStream
 * Shared across client, server, and core modules
 */

export interface AudioSlice {
  id: string;
  data: ArrayBuffer;
  sequence: number;
  sessionId: string;
}

/**
 * Interface for custom slice ID generation
 * Allows users to implement their own slice ID generation strategy
 */
export interface SliceIdGenerator {
  /**
   * Generate a unique slice ID for the given slice index and session
   * @param sliceIndex - The index of the slice (0-based)
   * @param sessionId - The session identifier
   * @param totalSlices - Total number of slices in the session
   * @returns Promise<string> - A unique slice ID
   */
  generateSliceId: (sliceIndex: number, sessionId: string, totalSlices: number) => Promise<string> | string;

  /**
   * Get the name/identifier of this generator for logging/debugging
   * @returns string - Name of the generator
   */
  getName: () => string;
}

export interface SessionInfo {
  sessionId: string;
  totalSlices: number;
  sliceDuration: number;
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  /** Whether raw PCM is 32-bit float (true) or integer (false/undefined) */
  isFloat32?: boolean;
  sliceIds: string[]; // Sorted list of slice IDs for the session
  /** Audio format: 'wav' = raw PCM, 'mp3'/'flac'/'ogg' = compressed (client must decode) */
  format?: string;
}

// Legacy key exchange interfaces - marked for backward compatibility
export interface LegacyKeyExchangeRequest {
  clientPublicKey: string;
}

export interface LegacyKeyExchangeResponse {
  serverPublicKey: string;
  encryptedSessionKey?: string; // Optional for backward compatibility
  iv?: string; // Optional for backward compatibility
  sessionInfo: SessionInfo;
}

export interface SliceRequest {
  sessionId: string;
  sliceId: string;
}

export interface EncryptedSlice {
  id: string;
  encryptedData: ArrayBuffer; // Pure binary data
  iv: ArrayBuffer; // Binary IV
  sequence: number;
  sessionId: string;
  // Removed hash - developers can compute their own if needed
}

/**
 * Compression level for audio processing (0-9)
 * - 0: No compression (fastest)
 * - 1-3: Fast compression with moderate ratio
 * - 4-6: Balanced compression (recommended: 6)
 * - 7-9: Maximum compression (slower)
 */
export type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Encryption algorithm type
 * Currently only AES-GCM is supported
 */
export type EncryptionAlgorithm = 'AES-GCM';

export interface AudioConfig {
  sliceDurationMs: number;
  compressionLevel: CompressionLevel;
  encryptionAlgorithm: EncryptionAlgorithm;
  /**
   * Enable randomized slice lengths for enhanced security
   * When enabled, each slice will have a different duration based on variance
   * Different sessions will use different randomization patterns
   * @default false
   */
  randomizeSliceLength?: boolean;
  /**
   * Variance factor for randomized slice lengths (0.0 to 1.0)
   * For example, 0.4 means slices can vary ±40% from the average sliceDurationMs
   * Only applies when randomizeSliceLength is true
   * @default 0.4
   */
  sliceLengthVariance?: number;
  // Removed hash validation - developers handle their own validation
}

export const DEFAULT_CONFIG: AudioConfig = {
  sliceDurationMs: 5000, // 5 second slices
  compressionLevel: 6,
  encryptionAlgorithm: 'AES-GCM',
};
