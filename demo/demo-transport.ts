import type { Transport } from 'secstream/client';
import type { ProcessorKeyExchangeRequest as KeyExchangeRequest, ProcessorKeyExchangeResponse as KeyExchangeResponse } from 'secstream';
import type { EncryptedSlice, SessionInfo } from 'secstream';
import { verifySliceCrc32 } from './utils/crc32.js';

/**
 * Demo transport implementation with CRC32 validation
 * Shows how developers can implement custom transport logic
 * while the framework handles key exchange and buffer strategies
 */
export class DemoTransport implements Transport {
  private baseUrl: string;
  private randomizeSliceLength: boolean;

  constructor(baseUrl: string = '', randomizeSliceLength: boolean = false) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.randomizeSliceLength = randomizeSliceLength;
  }

  async createSession(audioData: File | ArrayBuffer): Promise<string> {
    let body: FormData | ArrayBuffer;

    if (audioData instanceof File) {
      const formData = new FormData();
      formData.append('audio', audioData);
      // Add randomize slice length configuration
      formData.append('randomizeSliceLength', String(this.randomizeSliceLength));
      body = formData;
    } else {
      // For ArrayBuffer, we can't send FormData, so we'll use JSON
      // This is a simplified approach - in production you might want to handle this differently
      body = audioData;
    }

    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result.sessionId;
  }

  async performKeyExchange<TRequestData = unknown, TResponseData = unknown, TSessionInfo = SessionInfo>(
    sessionId: string, 
    request: KeyExchangeRequest<TRequestData>
  ): Promise<KeyExchangeResponse<TResponseData, TSessionInfo>> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/key-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/info`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Custom slice fetching with CRC32 validation
   * This is where developers implement their own transport logic
   */
  async fetchSlice(sessionId: string, sliceId: string): Promise<EncryptedSlice> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/slices/${sliceId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get binary data
    const binaryData = await response.arrayBuffer();

    // Developer decides how to parse metadata - here we use HTTP headers
    const sliceIdHeader = response.headers.get('X-Slice-ID');
    const sequenceHeader = response.headers.get('X-Slice-Sequence');
    const sessionIdHeader = response.headers.get('X-Session-ID');
    const encryptedDataLengthHeader = response.headers.get('X-Encrypted-Data-Length');
    const ivLengthHeader = response.headers.get('X-IV-Length');
    const crc32HashHeader = response.headers.get('X-CRC32-Hash');

    if (!sliceIdHeader || !sequenceHeader || !sessionIdHeader ||
      !encryptedDataLengthHeader || !ivLengthHeader || !crc32HashHeader) {
      throw new Error('Missing required headers in slice response');
    }

    const encryptedDataLength = parseInt(encryptedDataLengthHeader, 10);
    const ivLength = parseInt(ivLengthHeader, 10);
    const sequence = parseInt(sequenceHeader, 10);

    // Developer decides how to split binary payload
    const encryptedData = binaryData.slice(0, encryptedDataLength);
    const iv = binaryData.slice(encryptedDataLength, encryptedDataLength + ivLength);

    // Developer implements their own validation logic
    if (!verifySliceCrc32(encryptedData, iv, crc32HashHeader)) {
      throw new Error(`CRC32 hash verification failed for slice ${sliceId}`);
    }

    console.log(`✅ Demo transport: Slice ${sliceId} validated (hash: ${crc32HashHeader})`);

    return {
      id: sliceIdHeader,
      encryptedData,
      iv,
      sequence,
      sessionId: sessionIdHeader,
    };
  }
}