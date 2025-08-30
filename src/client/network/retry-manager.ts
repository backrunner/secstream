/**
 * Retry configuration for different operation types
 */
export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffFactor: 2,
};

/**
 * Retry manager for handling transient failures
 */
export class RetryManager {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Retry an operation with exponential backoff
   */
  async retry<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch(error) {
        lastError = error as Error;

        if (attempt === this.config.maxRetries) {
          // Final attempt failed
          break;
        }

        // Calculate delay with exponential backoff
        const delay = this.config.retryDelay * this.config.backoffFactor ** attempt;
        await this.sleep(delay);
      }
    }

    throw new Error(`Operation failed after ${this.config.maxRetries + 1} attempts: ${lastError!.message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
