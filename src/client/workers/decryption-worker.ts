/* eslint-disable no-restricted-globals */
/**
 * Web Worker script for background decryption
 * Runs crypto operations off the main thread to prevent blocking
 *
 * NOTE: This is a browser Web Worker, not a Cloudflare Worker
 * - Designed to run in browser environments (Chrome, Firefox, Safari, etc.)
 * - Uses Web Worker API (postMessage, onmessage, self)
 * - Cannot be used in Cloudflare Workers runtime (different environment)
 * - Requires Web Crypto API support
 *
 * Environment requirements:
 * - Web Worker context (not main thread)
 * - Web Crypto API (crypto.subtle)
 * - ArrayBuffer and Transferable support
 */

import type { CompressionProcessor, CryptoMetadata, EncryptionProcessor } from '../../shared/types/processors.js';
import type { WorkerMessage, WorkerResponse } from './decryption-worker-types.js';
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';
import { AesGcmEncryptionProcessor } from '../../shared/crypto/processors/aes-gcm-processor.js';
import { XorStreamCipherProcessor } from '../../shared/crypto/processors/xor-cipher-processor.js';

// Verify we're in a Web Worker context
if (typeof self === 'undefined') {
  throw new TypeError('[DecryptionWorker] Not running in Web Worker context');
}

// Verify Web Crypto API is available
if (typeof crypto === 'undefined' || !crypto.subtle) {
  throw new Error('[DecryptionWorker] Web Crypto API not available');
}

let compressionProcessor: CompressionProcessor | null = null;
let encryptionProcessor: EncryptionProcessor | null = null;

/**
 * Initialize processors based on configuration
 */
function initializeProcessors(compressionName: string, encryptionName: string): void {
  // Initialize compression processor
  switch (compressionName) {
    case 'DeflateCompressionProcessor':
      compressionProcessor = new DeflateCompressionProcessor();
      break;
    default:
      throw new Error(`Unknown compression processor: ${compressionName}`);
  }

  // Initialize encryption processor
  switch (encryptionName) {
    case 'AesGcmEncryptionProcessor':
      encryptionProcessor = new AesGcmEncryptionProcessor();
      break;
    case 'XorStreamCipherProcessor':
      encryptionProcessor = new XorStreamCipherProcessor() as unknown as EncryptionProcessor;
      break;
    default:
      throw new Error(`Unknown encryption processor: ${encryptionName}`);
  }
}

/**
 * Decrypt and decompress a slice
 */
async function decryptSlice(
  encryptedData: ArrayBuffer,
  iv: ArrayBuffer,
  sessionKey: ArrayBuffer | string,
): Promise<ArrayBuffer> {
  if (!compressionProcessor || !encryptionProcessor) {
    throw new Error('Processors not initialized');
  }

  const metadata: CryptoMetadata = { iv };

  // Decrypt
  const compressedData = await encryptionProcessor.decrypt(
    encryptedData,
    sessionKey as Parameters<EncryptionProcessor['decrypt']>[1],
    metadata,
  );

  // Decompress
  const audioData = await compressionProcessor.decompress(compressedData);

  return audioData;
}

/**
 * Handle messages from main thread
 */
self.onmessage = async(event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  let operation: 'init' | 'decrypt' | 'terminate' | 'unknown' = 'unknown';
  let taskId = '';

  try {
    switch (message.type) {
      case 'init': {
        operation = 'init';
        initializeProcessors(message.compressionProcessorName, message.encryptionProcessorName);
        const response: WorkerResponse = { type: 'ready' };
        self.postMessage(response);
        break;
      }

      case 'decrypt': {
        operation = 'decrypt';
        const { taskId: msgTaskId, encryptedSlice, sessionKey } = message;
        taskId = msgTaskId;

        const decryptedData = await decryptSlice(
          encryptedSlice.encryptedData,
          encryptedSlice.iv,
          sessionKey,
        );

        const response: WorkerResponse = {
          type: 'success',
          taskId,
          decryptedData,
        };

        // Transfer decrypted data back to main thread (zero-copy)
        self.postMessage(response, { transfer: [decryptedData] });
        break;
      }

      case 'terminate': {
        operation = 'terminate';
        self.close();
        break;
      }

      default: {
        throw new Error(`Unknown message type: ${(message as WorkerMessage).type}`);
      }
    }
  } catch(error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Build detailed error context
    const errorContext = {
      operation,
      timestamp: new Date().toISOString(),
    };

    // Add operation-specific context
    if (message.type === 'init') {
      Object.assign(errorContext, {
        compressionProcessor: message.compressionProcessorName,
        encryptionProcessor: message.encryptionProcessorName,
      });
    } else if (message.type === 'decrypt') {
      Object.assign(errorContext, {
        sliceId: message.encryptedSlice.id,
        sessionId: message.encryptedSlice.sessionId,
        taskId: message.taskId,
        encryptedDataSize: message.encryptedSlice.encryptedData.byteLength,
        ivSize: message.encryptedSlice.iv.byteLength,
      });
    }

    console.error(`[DecryptionWorker] ${operation} error:`, errorMessage, '\nContext:', errorContext, '\nStack:', errorStack);

    if (message.type === 'decrypt') {
      const response: WorkerResponse = {
        type: 'error',
        taskId: message.taskId,
        error: errorMessage,
        errorDetails: {
          operation: 'decrypt',
          sliceId: message.encryptedSlice.id,
          sessionId: message.encryptedSlice.sessionId,
          processorName: `${compressionProcessor?.getName() || 'unknown'}/${encryptionProcessor?.getName() || 'unknown'}`,
          stack: errorStack,
        },
      };
      self.postMessage(response);
    } else if (message.type === 'init') {
      // For init errors, we can't use taskId since we don't have one
      const response: WorkerResponse = {
        type: 'error',
        taskId: 'init-error',
        error: `Initialization failed: ${errorMessage}`,
        errorDetails: {
          operation: 'init',
          processorName: `${message.compressionProcessorName}/${message.encryptionProcessorName}`,
          stack: errorStack,
        },
      };
      self.postMessage(response);
    } else {
      console.error(`[DecryptionWorker] Fatal error in ${operation}:`, errorMessage, errorStack);
    }
  }
};
