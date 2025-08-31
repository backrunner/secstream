import type { SliceIdGenerator } from '../types/interfaces.js';
import { nanoid } from 'nanoid';

/**
 * Nanoid-based slice ID generator
 * Generates cryptographically secure, URL-safe unique IDs using nanoid
 * This is the default generator providing good security and uniqueness
 */
export class NanoidSliceIdGenerator implements SliceIdGenerator {
  private readonly length: number;

  constructor(length: number = 21) {
    this.length = length;
  }

  generateSliceId(_sliceIndex: number, _sessionId: string, _totalSlices: number): string {
    return nanoid(this.length);
  }

  getName(): string {
    return `NanoidSliceIdGenerator(length=${this.length})`;
  }
}

/**
 * UUID-based slice ID generator
 * Generates slice IDs using standard UUID v4 format
 * Provides maximum compatibility with existing systems
 */
export class UuidSliceIdGenerator implements SliceIdGenerator {
  generateSliceId(_sliceIndex: number, _sessionId: string, _totalSlices: number): string {
    return crypto.randomUUID();
  }

  getName(): string {
    return 'UuidSliceIdGenerator';
  }
}

/**
 * Sequential slice ID generator
 * Generates predictable sequential IDs based on session and slice index
 * Useful for debugging or systems that need ordered identifiers
 *
 * WARNING: Less secure than random generators - use only for non-production or debugging
 */
export class SequentialSliceIdGenerator implements SliceIdGenerator {
  private readonly prefix: string;

  constructor(prefix: string = 'slice') {
    this.prefix = prefix;
  }

  generateSliceId(sliceIndex: number, sessionId: string, totalSlices: number): string {
    const paddedIndex = sliceIndex.toString().padStart(String(totalSlices - 1).length, '0');
    return `${this.prefix}_${sessionId.slice(0, 8)}_${paddedIndex}`;
  }

  getName(): string {
    return `SequentialSliceIdGenerator(prefix=${this.prefix})`;
  }
}

/**
 * Timestamp-based slice ID generator
 * Generates IDs combining timestamp, session info, and slice index
 * Provides natural ordering and time-based uniqueness
 */
export class TimestampSliceIdGenerator implements SliceIdGenerator {
  generateSliceId(sliceIndex: number, sessionId: string, _totalSlices: number): string {
    const timestamp = Date.now().toString(36);
    const sessionPart = sessionId.slice(0, 6);
    const indexPart = sliceIndex.toString(36).padStart(3, '0');
    return `${timestamp}_${sessionPart}_${indexPart}`;
  }

  getName(): string {
    return 'TimestampSliceIdGenerator';
  }
}

/**
 * Hash-based slice ID generator
 * Generates deterministic IDs based on session and slice info
 * Same input always produces same output - useful for caching scenarios
 */
export class HashSliceIdGenerator implements SliceIdGenerator {
  async generateSliceId(sliceIndex: number, sessionId: string, totalSlices: number): Promise<string> {
    const input = `${sessionId}-${sliceIndex}-${totalSlices}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hashHex.slice(0, 16); // Use first 16 chars for shorter IDs
  }

  getName(): string {
    return 'HashSliceIdGenerator';
  }
}
