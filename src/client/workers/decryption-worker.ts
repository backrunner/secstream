/* eslint-disable no-restricted-globals */
/**
 * Web Worker script for background decryption
 * Runs crypto operations off the main thread to prevent blocking
 */

import type { CompressionProcessor, CryptoMetadata, EncryptionProcessor } from '../../shared/types/processors.js';
import type { WorkerMessage, WorkerResponse } from './decryption-worker-types.js';
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';
import { AesGcmEncryptionProcessor } from '../../shared/crypto/processors/aes-gcm-processor.js';
import { XorStreamCipherProcessor } from '../../shared/crypto/processors/xor-cipher-processor.js';

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

  try {
    switch (message.type) {
      case 'init': {
        initializeProcessors(message.compressionProcessorName, message.encryptionProcessorName);
        const response: WorkerResponse = { type: 'ready' };
        self.postMessage(response);
        break;
      }

      case 'decrypt': {
        const { taskId, encryptedSlice, sessionKey } = message;

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
        self.close();
        break;
      }

      default: {
        throw new Error(`Unknown message type: ${(message as WorkerMessage).type}`);
      }
    }
  } catch(error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (message.type === 'decrypt') {
      const response: WorkerResponse = {
        type: 'error',
        taskId: message.taskId,
        error: errorMessage,
      };
      self.postMessage(response);
    } else {
      console.error('Worker error:', errorMessage);
    }
  }
};
