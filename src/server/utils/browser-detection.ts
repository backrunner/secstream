/**
 * Browser detection utilities for server-side User-Agent parsing
 * Used to determine audio processing strategies based on browser capabilities
 */

export interface BrowserInfo {
  isChromium: boolean;
  browser: 'chrome' | 'edge' | 'safari' | 'firefox' | 'unknown';
  version?: string;
}

/**
 * Detects if the User-Agent represents a Chromium-based browser
 * Chromium browsers (Chrome, Edge, Opera, etc.) are more forgiving with compressed audio slicing
 */
export function isChromiumBrowser(userAgent: string): boolean {
  if (!userAgent) {
    return false;
  }

  const ua = userAgent.toLowerCase();

  // Check for Chromium-based browsers
  // Note: Edge switched to Chromium in 2020 (version 79+)
  const isChrome = ua.includes('chrome') && !ua.includes('edg'); // Modern Edge uses 'Edg' not 'Edge'
  const isEdgeChromium = ua.includes('edg/'); // Chromium-based Edge
  const isOpera = ua.includes('opr/') || ua.includes('opera');
  const isBrave = ua.includes('brave'); // Brave is Chromium-based

  // Explicitly NOT Chromium
  const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
  const isFirefox = ua.includes('firefox') || ua.includes('fxios');

  if (isSafari || isFirefox) {
    return false;
  }

  return isChrome || isEdgeChromium || isOpera || isBrave;
}

/**
 * Parses User-Agent to extract browser information
 */
export function parseBrowserInfo(userAgent: string): BrowserInfo {
  if (!userAgent) {
    return { isChromium: false, browser: 'unknown' };
  }

  const ua = userAgent.toLowerCase();

  // Safari detection (must come before Chrome check)
  if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium')) {
    const versionMatch = ua.match(/version\/(\d+\.\d+)/);
    return {
      isChromium: false,
      browser: 'safari',
      version: versionMatch?.[1],
    };
  }

  // Firefox detection
  if (ua.includes('firefox') || ua.includes('fxios')) {
    const versionMatch = ua.match(/firefox\/(\d+\.\d+)/);
    return {
      isChromium: false,
      browser: 'firefox',
      version: versionMatch?.[1],
    };
  }

  // Edge (Chromium-based) detection
  if (ua.includes('edg/')) {
    const versionMatch = ua.match(/edg\/(\d+\.\d+)/);
    return {
      isChromium: true,
      browser: 'edge',
      version: versionMatch?.[1],
    };
  }

  // Chrome detection
  if (ua.includes('chrome')) {
    const versionMatch = ua.match(/chrome\/(\d+\.\d+)/);
    return {
      isChromium: true,
      browser: 'chrome',
      version: versionMatch?.[1],
    };
  }

  return { isChromium: false, browser: 'unknown' };
}

/**
 * Determines if a browser requires strict audio format handling
 * Non-Chromium browsers (Safari, Firefox) need proper frame boundaries for MP3
 * and decoded PCM for FLAC/OGG
 */
export function requiresStrictAudioHandling(userAgent: string): boolean {
  return !isChromiumBrowser(userAgent);
}
