/**
 * Manager for Web Worker-based decryption
 * Distributes decryption tasks across multiple workers for parallel processing
 */

import type { EncryptedSlice } from '../../shared/types/interfaces.js';
import type {
  DecryptionWorkerConfig,
  WorkerMessage,
  WorkerResponse,
  WorkerSuccessResponse,
  WorkerErrorResponse,
} from './decryption-worker-types.js';

interface PendingTask {
  taskId: string;
  resolve: (data: ArrayBuffer) => void;
  reject: (error: Error) => void;
}

/**
 * Manages a pool of Web Workers for parallel decryption
 */
export class DecryptionWorkerManager {
  private workers: Worker[] = [];
  private pendingTasks = new Map<string, PendingTask>();
  private taskQueue: Array<() => void> = [];
  private nextWorkerIndex = 0;
  private isInitialized = false;
  private config: Required<DecryptionWorkerConfig>;

  constructor(
    private workerUrl: string,
    private compressionProcessorName: string,
    private encryptionProcessorName: string,
    config: DecryptionWorkerConfig,
  ) {
    this.config = {
      enabled: config.enabled,
      workerCount: config.workerCount || 1,
      maxQueueSize: config.maxQueueSize || 10,
    };
  }

  /**
   * Initialize workers and wait for them to be ready
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const workerCount = Math.max(1, Math.min(this.config.workerCount, navigator.hardwareConcurrency || 4));
    const initPromises: Array<Promise<void>> = [];

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(this.workerUrl, { type: 'module' });
      this.workers.push(worker);

      // Set up message handler
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };

      worker.onerror = (error) => {
        console.error('Worker error:', error);
      };

      // Initialize worker and wait for ready signal
      const initPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'));
        }, 5000);

        const handler = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'ready') {
            clearTimeout(timeout);
            worker.removeEventListener('message', handler);
            resolve();
          }
        };

        worker.addEventListener('message', handler);

        const initMessage: WorkerMessage = {
          type: 'init',
          compressionProcessorName: this.compressionProcessorName,
          encryptionProcessorName: this.encryptionProcessorName,
        };
        worker.postMessage(initMessage);
      });

      initPromises.push(initPromise);
    }

    await Promise.all(initPromises);
    this.isInitialized = true;
  }

  /**
   * Decrypt a slice using a worker from the pool
   */
  async decryptSlice(
    encryptedSlice: EncryptedSlice,
    sessionKey: ArrayBuffer | string,
  ): Promise<ArrayBuffer> {
    if (!this.isInitialized) {
      throw new Error('DecryptionWorkerManager not initialized');
    }

    const taskId = `${encryptedSlice.sessionId}-${encryptedSlice.id}-${Date.now()}`;

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const pendingTask: PendingTask = { taskId, resolve, reject };
      this.pendingTasks.set(taskId, pendingTask);

      // Check queue size limit
      if (this.taskQueue.length >= this.config.maxQueueSize * this.workers.length) {
        reject(new Error('Worker queue full'));
        this.pendingTasks.delete(taskId);
        return;
      }

      // Queue the task
      this.taskQueue.push(() => {
        this.sendDecryptTask(taskId, encryptedSlice, sessionKey);
      });

      // Process queue
      this.processQueue();
    });
  }

  /**
   * Send decrypt task to next available worker
   */
  private sendDecryptTask(
    taskId: string,
    encryptedSlice: EncryptedSlice,
    sessionKey: ArrayBuffer | string,
  ): void {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    const message: WorkerMessage = {
      type: 'decrypt',
      taskId,
      encryptedSlice,
      sessionKey,
    };

    // Transfer ArrayBuffers for zero-copy performance
    const transferList: Transferable[] = [];
    if (sessionKey instanceof ArrayBuffer) {
      // Clone sessionKey since it's reused across tasks
      sessionKey = sessionKey.slice(0);
      transferList.push(sessionKey);
    }

    // Clone encrypted data and IV to transfer
    const encryptedData = encryptedSlice.encryptedData.slice(0);
    const iv = encryptedSlice.iv.slice(0);
    transferList.push(encryptedData, iv);

    // Update message with cloned buffers
    message.encryptedSlice = {
      ...encryptedSlice,
      encryptedData,
      iv,
    };

    worker.postMessage(message, transferList);
  }

  /**
   * Process queued tasks
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        task();
      }
    }
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(response: WorkerResponse): void {
    if (response.type === 'ready') {
      // Already handled during initialization
      return;
    }

    if (response.type === 'success') {
      const successResponse = response as WorkerSuccessResponse;
      const task = this.pendingTasks.get(successResponse.taskId);
      if (task) {
        task.resolve(successResponse.decryptedData);
        this.pendingTasks.delete(successResponse.taskId);
      }
    } else if (response.type === 'error') {
      const errorResponse = response as WorkerErrorResponse;
      const task = this.pendingTasks.get(errorResponse.taskId);
      if (task) {
        console.error('Worker returned error for task', errorResponse.taskId, ':', errorResponse.error);
        task.reject(new Error(errorResponse.error));
        this.pendingTasks.delete(errorResponse.taskId);
      }
    }
  }

  /**
   * Terminate all workers and clean up
   */
  destroy(): void {
    // Reject all pending tasks
    for (const [taskId, task] of this.pendingTasks) {
      task.reject(new Error('Worker manager destroyed'));
      this.pendingTasks.delete(taskId);
    }

    // Terminate all workers
    for (const worker of this.workers) {
      const terminateMessage: WorkerMessage = { type: 'terminate' };
      worker.postMessage(terminateMessage);
      worker.terminate();
    }

    this.workers = [];
    this.taskQueue = [];
    this.isInitialized = false;
  }

  /**
   * Get number of active workers
   */
  getWorkerCount(): number {
    return this.workers.length;
  }

  /**
   * Get number of pending tasks
   */
  getPendingTaskCount(): number {
    return this.pendingTasks.size;
  }
}
