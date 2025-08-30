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

export interface SessionInfo {
  sessionId: string;
  totalSlices: number;
  sliceDuration: number;
  sampleRate: number;
  channels: number;
  bitDepth?: number;
}

export interface KeyExchangeRequest {
  clientPublicKey: string;
}

export interface KeyExchangeResponse {
  serverPublicKey: string;
  encryptedSessionKey: string;
  iv: string; // IV for session key decryption
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

export interface AudioConfig {
  sliceDurationMs: number;
  compressionLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  encryptionAlgorithm: 'AES-GCM';
  // Removed hash validation - developers handle their own validation
}

export const DEFAULT_CONFIG: AudioConfig = {
  sliceDurationMs: 5000, // 5 second slices
  compressionLevel: 6,
  encryptionAlgorithm: 'AES-GCM',
};
