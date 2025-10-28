/**
 * Audio format detection and parsing utilities
 * Supports WAV, MP3, FLAC, and other common audio formats
 */

export interface AudioMetadata {
  format: 'wav' | 'mp3' | 'flac' | 'ogg' | 'aac' | 'unknown';
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  duration?: number;
  bitrate?: number;
  dataOffset: number;
  dataLength: number;
  totalSamples?: number; // For MP3: calculated from duration and sample rate
}

/**
 * Detects audio format from buffer header
 */
export function detectAudioFormat(buffer: ArrayBuffer): AudioMetadata['format'] {
  const view = new DataView(buffer);

  // Check for various audio format signatures
  if (buffer.byteLength >= 12) {
    // WAV: "RIFF" at 0, "WAVE" at 8
    if (view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645) {
      return 'wav';
    }

    // FLAC: "fLaC" at 0
    if (view.getUint32(0, false) === 0x664C6143) {
      return 'flac';
    }

    // OGG: "OggS" at 0
    if (view.getUint32(0, false) === 0x4F676753) {
      return 'ogg';
    }
  }

  if (buffer.byteLength >= 3) {
    // MP3: ID3 header or frame sync
    if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
      return 'mp3'; // ID3v2
    }
    if ((view.getUint16(0, false) & 0xFFE0) === 0xFFE0) {
      return 'mp3'; // MPEG frame sync
    }
  }

  return 'unknown';
}

/**
 * Parses WAV file header
 */
function parseWAV(buffer: ArrayBuffer): AudioMetadata {
  const view = new DataView(buffer);

  // WAV header structure:
  // 0-3: "RIFF"
  // 4-7: file size - 8
  // 8-11: "WAVE"
  // 12-15: "fmt "
  // 16-19: fmt chunk size
  // 20-21: audio format (1 = PCM)
  // 22-23: channels
  // 24-27: sample rate
  // 28-31: byte rate
  // 32-33: block align
  // 34-35: bits per sample

  let offset = 12;
  let dataOffset = 0;
  let dataLength = 0;
  let channels = 2;
  let sampleRate = 44100;
  let bitDepth = 16;

  // Find fmt and data chunks
  while (offset < buffer.byteLength - 8) {
    const chunkId = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 0x666D7420) { // "fmt "
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitDepth = view.getUint16(offset + 22, true);
    } else if (chunkId === 0x64617461) { // "data"
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  return {
    format: 'wav',
    sampleRate,
    channels,
    bitDepth,
    dataOffset,
    dataLength,
    duration: dataLength / (sampleRate * channels * (bitDepth / 8)),
  };
}

/**
 * Parses MP3 frame header for metadata
 * Scans through file to calculate accurate duration
 */
function parseMP3(buffer: ArrayBuffer): AudioMetadata {
  const view = new DataView(buffer);
  let offset = 0;

  // Skip ID3v2 tag if present
  if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
    const tagSize = (view.getUint8(6) << 21) | (view.getUint8(7) << 14)
      | (view.getUint8(8) << 7) | view.getUint8(9);
    offset = 10 + tagSize;
  }

  const dataOffset = offset;

  // Find first frame header to get audio parameters
  while (offset < buffer.byteLength - 4) {
    if ((view.getUint16(offset, false) & 0xFFE0) === 0xFFE0) {
      break;
    }
    offset++;
  }

  if (offset >= buffer.byteLength - 4) {
    // Fallback values if no frame found
    return {
      format: 'mp3',
      sampleRate: 44100,
      channels: 2,
      dataOffset,
      dataLength: buffer.byteLength - dataOffset,
    };
  }

  // Parse first frame header
  const header = view.getUint32(offset, false);

  // MPEG version
  const version = (header >> 19) & 0x3;

  // Sample rate table for MPEG 1, 2, 2.5
  const sampleRates = [
    [44100, 48000, 32000], // MPEG 1
    [22050, 24000, 16000], // MPEG 2
    [11025, 12000, 8000], // MPEG 2.5
  ];
  const versionIndex = version === 3 ? 0 : (version === 2 ? 1 : 2);
  const sampleRateIndex = (header >> 10) & 0x3;
  const sampleRate = sampleRates[versionIndex]?.[sampleRateIndex] || 44100;

  // Channel mode
  const channelMode = (header >> 6) & 0x3;
  const channels = channelMode === 3 ? 1 : 2;

  // Bitrate table (kbps) for MPEG 1 Layer 3
  const bitrateIndex = (header >> 12) & 0xF;
  const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const bitrate = bitrateTable[bitrateIndex] || 128;

  // Calculate approximate duration by scanning frames
  // This is more accurate than just using file size
  let frameCount = 0;
  let scanOffset = offset;
  const samplesPerFrame = version === 3 ? 1152 : 576; // MPEG 1 vs MPEG 2/2.5

  // Scan up to 1000 frames or 100KB to estimate (avoid full file scan for large files)
  const maxScan = Math.min(buffer.byteLength, scanOffset + 100000);
  while (scanOffset < maxScan - 4 && frameCount < 1000) {
    if ((view.getUint16(scanOffset, false) & 0xFFE0) === 0xFFE0) {
      frameCount++;
      // Calculate frame length: (144 * bitrate * 1000) / sampleRate
      const frameLength = Math.floor((144 * bitrate * 1000) / sampleRate);
      scanOffset += frameLength;
    } else {
      scanOffset++;
    }
  }

  // Estimate total frames from scan ratio
  const scannedBytes = scanOffset - offset;
  const totalBytes = buffer.byteLength - dataOffset;
  const estimatedTotalFrames = scannedBytes > 0 ? Math.floor((totalBytes / scannedBytes) * frameCount) : frameCount;

  // Calculate duration and total samples
  const duration = (estimatedTotalFrames * samplesPerFrame) / sampleRate;
  const totalSamples = Math.floor(duration * sampleRate);

  return {
    format: 'mp3',
    sampleRate,
    channels,
    bitrate,
    dataOffset,
    dataLength: totalBytes,
    duration,
    totalSamples,
  };
}

/**
 * Parses FLAC metadata
 */
function parseFLAC(buffer: ArrayBuffer): AudioMetadata {
  const view = new DataView(buffer);

  // Skip "fLaC" signature
  let offset = 4;
  let sampleRate = 44100;
  let channels = 2;
  let bitDepth = 16;

  // Read metadata blocks
  while (offset < buffer.byteLength - 4) {
    const blockHeader = view.getUint32(offset, false);
    const isLast = (blockHeader >> 31) === 1;
    const blockType = (blockHeader >> 24) & 0x7F;
    const blockLength = blockHeader & 0xFFFFFF;

    if (blockType === 0) { // STREAMINFO block
      // Sample rate is at bytes 10-12 (20 bits)
      sampleRate = (view.getUint32(offset + 10, false) >> 12) & 0xFFFFF;

      // Channels at bits 78-80 (3 bits) + 1
      channels = ((view.getUint8(offset + 12) >> 1) & 0x7) + 1;

      // Bits per sample at bits 81-85 (5 bits) + 1
      bitDepth = (((view.getUint8(offset + 12) & 0x1) << 4)
        | (view.getUint8(offset + 13) >> 4)) + 1;
      break;
    }

    offset += 4 + blockLength;
    if (isLast)
      break;
  }

  return {
    format: 'flac',
    sampleRate,
    channels,
    bitDepth,
    dataOffset: offset,
    dataLength: buffer.byteLength - offset,
  };
}

/**
 * Parses audio metadata from various formats
 */
export function parseAudioMetadata(buffer: ArrayBuffer): AudioMetadata {
  const format = detectAudioFormat(buffer);

  switch (format) {
    case 'wav':
      return parseWAV(buffer);
    case 'mp3':
      return parseMP3(buffer);
    case 'flac':
      return parseFLAC(buffer);
    default:
      // Fallback for unknown formats
      return {
        format: 'unknown',
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        dataOffset: 0,
        dataLength: buffer.byteLength,
      };
  }
}

/**
 * Extracts audio data from various formats
 * Note: Returns compressed data as-is for MP3/FLAC/OGG
 * Client will decode using Web Audio API
 */
export function extractAudioData(buffer: ArrayBuffer, metadata: AudioMetadata): ArrayBuffer {
  return buffer.slice(metadata.dataOffset, metadata.dataOffset + metadata.dataLength);
}

/**
 * Estimates sample count for different formats
 */
export function estimateSampleCount(metadata: AudioMetadata): number {
  // Use pre-calculated totalSamples if available (from MP3 parsing)
  if (metadata.totalSamples !== undefined) {
    return metadata.totalSamples;
  }

  switch (metadata.format) {
    case 'wav':
      return metadata.dataLength / (metadata.channels * ((metadata.bitDepth || 16) / 8));
    case 'mp3':
    // Fallback if totalSamples not calculated
    {
      if (metadata.duration) {
        return Math.floor(metadata.duration * metadata.sampleRate);
      }
      // Very rough estimate as last resort
      const estimatedFrames = Math.floor(metadata.dataLength / 417);
      return estimatedFrames * 1152;
    }
    case 'flac':
      // FLAC frames are variable, rough estimate
      return Math.floor(metadata.dataLength / metadata.channels / ((metadata.bitDepth || 16) / 8));
    default:
      return Math.floor(metadata.dataLength / (metadata.channels * 2)); // Assume 16-bit
  }
}
