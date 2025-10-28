/**
 * MP3 frame parsing utilities for Safari-compatible slicing
 * Safari requires MP3 buffers to start and end at exact frame boundaries
 */

export interface MP3FrameInfo {
  offset: number; // Byte offset of frame start
  length: number; // Frame length in bytes
  samples: number; // Samples per frame (1152 for MPEG1, 576 for MPEG2/2.5)
  sampleRate: number;
  bitrate: number;
}

/**
 * Parse MP3 frame header and return frame information
 */
export function parseMP3FrameHeader(buffer: ArrayBuffer, offset: number): MP3FrameInfo | null {
  const view = new DataView(buffer);

  // Check if we have enough bytes for a header
  if (offset + 4 > buffer.byteLength) {
    return null;
  }

  // Check for frame sync (11 bits set to 1: 0xFFE or 0xFFF)
  const sync = view.getUint16(offset, false);
  if ((sync & 0xFFE0) !== 0xFFE0) {
    return null;
  }

  const header = view.getUint32(offset, false);

  // Parse MPEG version
  const version = (header >> 19) & 0x3;
  if (version === 1) {
    return null; // Reserved
  }

  // Parse layer
  const layer = (header >> 17) & 0x3;
  if (layer === 0) {
    return null; // Reserved
  }

  // Sample rate tables for MPEG 1, 2, 2.5
  const sampleRates = [
    [44100, 48000, 32000], // MPEG 1
    [22050, 24000, 16000], // MPEG 2
    [11025, 12000, 8000], // MPEG 2.5
  ];
  const versionIndex = version === 3 ? 0 : (version === 2 ? 1 : 2);
  const sampleRateIndex = (header >> 10) & 0x3;

  if (sampleRateIndex === 3) {
    return null; // Reserved
  }

  const sampleRate = sampleRates[versionIndex]?.[sampleRateIndex];
  if (!sampleRate) {
    return null;
  }

  // Bitrate tables (kbps) for MPEG 1 Layer 3
  const bitrateIndex = (header >> 12) & 0xF;
  if (bitrateIndex === 0 || bitrateIndex === 15) {
    return null; // Free format or reserved
  }

  // Bitrate table depends on MPEG version and layer
  let bitrateTable: number[];
  if (version === 3 && layer === 1) { // MPEG 1 Layer 3
    bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  } else if (version === 3 && layer === 2) { // MPEG 1 Layer 2
    bitrateTable = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
  } else { // MPEG 2/2.5 Layer 3 or other combinations
    bitrateTable = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  }

  const bitrate = bitrateTable[bitrateIndex];
  if (!bitrate) {
    return null;
  }

  // Padding bit
  const padding = (header >> 9) & 0x1;

  // Calculate frame length
  // Formula: frameLength = (144 * bitrate * 1000) / sampleRate + padding
  const frameLength = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;

  // Samples per frame
  const samplesPerFrame = version === 3 ? 1152 : 576; // MPEG 1 vs MPEG 2/2.5

  return {
    offset,
    length: frameLength,
    samples: samplesPerFrame,
    sampleRate,
    bitrate,
  };
}

/**
 * Scan MP3 buffer and build frame boundary map
 * Returns array of frame offsets (byte positions)
 */
export function buildMP3FrameMap(buffer: ArrayBuffer): number[] {
  const view = new DataView(buffer);
  const frameBoundaries: number[] = [];
  let offset = 0;

  // Skip ID3v2 tag if present
  if (buffer.byteLength >= 10
    && view.getUint8(0) === 0x49
    && view.getUint8(1) === 0x44
    && view.getUint8(2) === 0x33) {
    const tagSize = (view.getUint8(6) << 21) | (view.getUint8(7) << 14)
      | (view.getUint8(8) << 7) | view.getUint8(9);
    offset = 10 + tagSize;
  }

  // Scan for frames
  while (offset < buffer.byteLength - 4) {
    const frameInfo = parseMP3FrameHeader(buffer, offset);

    if (frameInfo) {
      frameBoundaries.push(offset);
      offset += frameInfo.length;
    } else {
      // Not a valid frame header, try next byte
      offset++;
    }
  }

  return frameBoundaries;
}

/**
 * Find the closest frame boundary at or before the target byte position
 */
export function findFrameBoundary(frameBoundaries: number[], targetByte: number): number {
  // Binary search for closest boundary at or before target
  let left = 0;
  let right = frameBoundaries.length - 1;

  if (targetByte <= frameBoundaries[0]) {
    return frameBoundaries[0];
  }

  if (targetByte >= frameBoundaries[right]) {
    return frameBoundaries[right];
  }

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const boundary = frameBoundaries[mid];

    if (boundary === targetByte) {
      return boundary;
    }

    if (boundary < targetByte) {
      // Check if this is the closest before target
      if (mid === frameBoundaries.length - 1 || frameBoundaries[mid + 1] > targetByte) {
        return boundary;
      }
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return frameBoundaries[left];
}

/**
 * Slice MP3 buffer at proper frame boundaries for Safari compatibility
 * Returns a slice that starts and ends at frame boundaries
 */
export function sliceMP3AtFrameBoundaries(
  buffer: ArrayBuffer,
  frameBoundaries: number[],
  startByte: number,
  endByte: number,
): ArrayBuffer {
  // Find closest frame boundaries
  const actualStart = findFrameBoundary(frameBoundaries, startByte);
  const actualEnd = findFrameBoundary(frameBoundaries, endByte);

  // Ensure we have at least one complete frame
  if (actualStart >= actualEnd) {
    // Fallback: include at least the frame at actualStart
    const startIndex = frameBoundaries.indexOf(actualStart);
    if (startIndex < frameBoundaries.length - 1) {
      return buffer.slice(actualStart, frameBoundaries[startIndex + 1]);
    }
    return buffer.slice(actualStart);
  }

  return buffer.slice(actualStart, actualEnd);
}
