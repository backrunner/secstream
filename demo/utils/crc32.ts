/**
 * CRC32 calculation for data integrity checking
 * Demo-only implementation - not part of core library
 */

// CRC32 polynomial table for fast calculation
const crc32Table = new Uint32Array(256);

// Initialize CRC32 table
function initCrc32Table(): void {
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
    crc32Table[i] = crc;
  }
}

// Initialize table once
initCrc32Table();

/**
 * Calculate CRC32 hash of data
 * @param data - ArrayBuffer to hash
 * @returns CRC32 hash as hexadecimal string
 */
export function calculateCrc32(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xFF];
  }

  crc = (crc ^ 0xFFFFFFFF) >>> 0; // Convert to unsigned 32-bit

  // Convert to hex string with proper padding
  return crc.toString(16).padStart(8, '0');
}

/**
 * Verify CRC32 hash of data
 * @param data - ArrayBuffer to verify
 * @param expectedHash - Expected CRC32 hash
 * @returns True if hashes match
 */
export function verifyCrc32(data: ArrayBuffer, expectedHash: string): boolean {
  const actualHash = calculateCrc32(data);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Calculate CRC32 hash of encrypted slice data
 * Combines encrypted data and IV for complete integrity check
 * @param encryptedData - Encrypted slice data
 * @param iv - Initialization vector
 * @returns CRC32 hash as hexadecimal string
 */
export function calculateSliceCrc32(encryptedData: ArrayBuffer, iv: ArrayBuffer): string {
  // Combine encrypted data and IV
  const combined = new Uint8Array(encryptedData.byteLength + iv.byteLength);
  combined.set(new Uint8Array(encryptedData), 0);
  combined.set(new Uint8Array(iv), encryptedData.byteLength);

  return calculateCrc32(combined.buffer);
}

/**
 * Verify CRC32 hash of encrypted slice data
 * @param encryptedData - Encrypted slice data
 * @param iv - Initialization vector
 * @param expectedHash - Expected CRC32 hash
 * @returns True if hashes match
 */
export function verifySliceCrc32(
  encryptedData: ArrayBuffer,
  iv: ArrayBuffer,
  expectedHash: string,
): boolean {
  const actualHash = calculateSliceCrc32(encryptedData, iv);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}