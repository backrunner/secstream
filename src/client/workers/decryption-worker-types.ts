/**
 * Type definitions for Web Worker-based decryption
 * Enables offloading crypto operations to background threads
 */

import type { EncryptedSlice } from '../../shared/types/interfaces.js';

/**
 * Message types for worker communication
 */
export type WorkerMessageType = 'init' | 'decrypt' | 'terminate';

/**
 * Message sent to worker to initialize processors
 */
export interface WorkerInitMessage {
  type: 'init';
  compressionProcessorName: string;
  encryptionProcessorName: string;
}

/**
 * Message sent to worker to decrypt a slice
 */
export interface WorkerDecryptMessage {
  type: 'decrypt';
  taskId: string;
  encryptedSlice: EncryptedSlice;
  sessionKey: ArrayBuffer | string; // Transferable types only
}

/**
 * Message sent to worker to terminate
 */
export interface WorkerTerminateMessage {
  type: 'terminate';
}

/**
 * Union of all possible messages to worker
 */
export type WorkerMessage = WorkerInitMessage | WorkerDecryptMessage | WorkerTerminateMessage;

/**
 * Success response from worker
 */
export interface WorkerSuccessResponse {
  type: 'success';
  taskId: string;
  decryptedData: ArrayBuffer;
}

/**
 * Error response from worker
 */
export interface WorkerErrorResponse {
  type: 'error';
  taskId: string;
  error: string;
}

/**
 * Ready response from worker after initialization
 */
export interface WorkerReadyResponse {
  type: 'ready';
}

/**
 * Union of all possible responses from worker
 */
export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse | WorkerReadyResponse;

/**
 * Configuration for Web Worker decryption
 */
export interface DecryptionWorkerConfig {
  /** Enable Web Worker decryption (default: false) */
  enabled: boolean;
  /** Number of worker threads to use (default: 1) */
  workerCount?: number;
  /** Maximum queue size per worker before blocking (default: 10) */
  maxQueueSize?: number;
}
