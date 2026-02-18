/**
 * @file src/core/version-manager.ts
 * @summary Version upgrade detection and What's New modal state management.
 * 
 * This module handles:
 * - Detecting when the plugin has been upgraded to a new version
 * - Tracking which versions the user has dismissed the What's New modal for
 * - Determining whether to show the modal on plugin load
 * 
 * Uses localStorage for persistence (separate from plugin settings).
 * 
 * @exports checkForVersionUpgrade - Check if plugin was upgraded and modal should show
 * @exports markVersionSeen - Mark a version as seen (user dismissed modal)
 * @exports getLastSeenVersion - Get the last version the user has seen the modal for
 * @exports compareVersions - Compare two semantic version strings
 */

const STORAGE_KEY_LAST_VERSION = "sprout_lastSeenVersion";
const STORAGE_KEY_DISMISSED_VERSIONS = "sprout_dismissedVersions";

/**
 * Compare two semantic version strings (e.g., "1.0.4" vs "1.0.3")
 * Returns:
 *  - negative if v1 < v2
 *  - zero if v1 === v2
 *  - positive if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parseSemver = (value: string): {
    major: number;
    minor: number;
    patch: number;
    pre: string[];
  } | null => {
    const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: match[4] ? match[4].split(".") : [],
    };
  };

  const comparePreRelease = (a: string[], b: string[]): number => {
    if (!a.length && !b.length) return 0;
    if (!a.length) return 1;
    if (!b.length) return -1;

    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const ai = a[i];
      const bi = b[i];
      if (ai === undefined) return -1;
      if (bi === undefined) return 1;
      if (ai === bi) continue;

      const aNum = /^\d+$/.test(ai);
      const bNum = /^\d+$/.test(bi);

      if (aNum && bNum) {
        return Number(ai) - Number(bi);
      }
      if (aNum) return -1;
      if (bNum) return 1;
      return ai.localeCompare(bi);
    }

    return 0;
  };

  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);

  if (!p1 || !p2) {
    const parts1 = v1.split(".").map((part) => Number(part.replace(/\D.*$/, "")) || 0);
    const parts2 = v2.split(".").map((part) => Number(part.replace(/\D.*$/, "")) || 0);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      if (part1 !== part2) {
        return part1 - part2;
      }
    }
    return 0;
  }

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  return comparePreRelease(p1.pre, p2.pre);
}

/**
 * Get the last version the user has seen the What's New modal for
 */
export function getLastSeenVersion(): string | null {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY_LAST_VERSION);
  } catch (e) {
    console.error("Failed to get last seen version:", e);
    return null;
  }
}

/**
 * Get the set of versions the user has explicitly dismissed the modal for
 */
function getDismissedVersions(): Set<string> {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY_DISMISSED_VERSIONS);
    if (!raw) return new Set();
    
    const data = JSON.parse(raw) as unknown;
    const arr = Array.isArray(data) ? data.filter((v): v is string => typeof v === 'string') : [];
    return new Set(arr);
  } catch (e) {
    console.error("Failed to get dismissed versions:", e);
    return new Set();
  }
}

/**
 * Save the set of dismissed versions to localStorage
 */
function saveDismissedVersions(versions: Set<string>): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY_DISMISSED_VERSIONS, JSON.stringify([...versions]));
  } catch (e) {
    console.error("Failed to save dismissed versions:", e);
  }
}

/**
 * Check if the user has upgraded to a new version and should see the What's New modal.
 * 
 * @param currentVersion - Current plugin version (from manifest.json)
 * @returns Object with shouldShow flag and optional version to display
 */
export function checkForVersionUpgrade(currentVersion: string): {
  shouldShow: boolean;
  version?: string;
} {
  const lastSeen = getLastSeenVersion();
  const dismissed = getDismissedVersions();
  
  // Check if user has dismissed this specific version
  if (dismissed.has(currentVersion)) {
    return { shouldShow: false };
  }
  
  // First time user - show modal
  if (!lastSeen) {
    // Save current version as last seen so we can track future upgrades
    try {
      globalThis.localStorage.setItem(STORAGE_KEY_LAST_VERSION, currentVersion);
    } catch (e) {
      console.error("Failed to save last seen version:", e);
    }
    return { 
      shouldShow: true,
      version: currentVersion 
    };
  }
  
  // Check if this is a new version
  const isNewer = compareVersions(currentVersion, lastSeen) > 0;
  
  if (!isNewer) {
    // Same version as before - don't show (would have been dismissed or seen already)
    return { shouldShow: false };
  }
  
  // Show the modal for this new version
  return {
    shouldShow: true,
    version: currentVersion,
  };
}

/**
 * Mark a version as dismissed (when user clicks "don't show again").
 * Only updates last seen version when user explicitly dismisses.
 * This allows the modal to keep appearing until dismissed.
 * 
 * @param version - Version to mark as seen/dismissed
 * @param dontShowAgain - If true, user clicked "don't show again" for this version
 */
export function markVersionSeen(version: string, dontShowAgain: boolean = false): void {
  try {
    // Only update last seen and dismissed list if user chose "don't show again"
    // This allows the modal to keep showing on every load until dismissed
    if (dontShowAgain) {
      globalThis.localStorage.setItem(STORAGE_KEY_LAST_VERSION, version);
      const dismissed = getDismissedVersions();
      dismissed.add(version);
      saveDismissedVersions(dismissed);
    }
    // If not dismissed, do nothing - modal will appear again next time
  } catch (e) {
    console.error("Failed to mark version as seen:", e);
  }
}

/**
 * Clear all version tracking data (for testing/debugging)
 */
export function clearVersionTracking(): void {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY_LAST_VERSION);
    globalThis.localStorage.removeItem(STORAGE_KEY_DISMISSED_VERSIONS);
  } catch (e) {
    console.error("Failed to clear version tracking:", e);
  }
}
