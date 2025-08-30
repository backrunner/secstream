/**
 * Cross-platform timer utilities compatible with Node.js, Cloudflare Workers, and browsers
 */

export interface Timer {
  clear: () => void;
}

export class IntervalTimer implements Timer {
  private timerId: number | NodeJS.Timeout | undefined;
  private isCancelled = false;

  constructor(callback: () => void, interval: number) {
    // Use appropriate timer implementation based on environment
    if (typeof setInterval !== 'undefined') {
      this.timerId = setInterval(() => {
        if (!this.isCancelled) {
          callback();
        }
      }, interval);
    }
  }

  clear(): void {
    this.isCancelled = true;
    if (this.timerId) {
      if (typeof clearInterval !== 'undefined') {
        clearInterval(this.timerId as any);
      }
      this.timerId = undefined;
    }
  }
}

export class TimeoutTimer implements Timer {
  private timerId: number | NodeJS.Timeout | undefined;
  private isCancelled = false;

  constructor(callback: () => void, delay: number) {
    if (typeof setTimeout !== 'undefined') {
      this.timerId = setTimeout(() => {
        if (!this.isCancelled) {
          callback();
        }
      }, delay);
    }
  }

  clear(): void {
    this.isCancelled = true;
    if (this.timerId) {
      if (typeof clearTimeout !== 'undefined') {
        clearTimeout(this.timerId as any);
      }
      this.timerId = undefined;
    }
  }
}

/**
 * Creates an interval timer that works across all JavaScript environments
 */
export function createInterval(callback: () => void, interval: number): Timer {
  return new IntervalTimer(callback, interval);
}

/**
 * Creates a timeout timer that works across all JavaScript environments
 */
export function createTimeout(callback: () => void, delay: number): Timer {
  return new TimeoutTimer(callback, delay);
}

/**
 * Cross-platform sleep function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setTimeout !== 'undefined') {
      setTimeout(resolve, ms);
    } else {
      // Fallback for environments without setTimeout
      resolve();
    }
  });
}
