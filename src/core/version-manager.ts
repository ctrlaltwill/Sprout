/**
 * @file src/core/version-manager.ts
 * @summary Version upgrade detection and What's New modal state management.
 * 
 * This module handles:
 * - Detecting when the plugin has been upgraded to a new version
 * - Tracking which versions the user has dismissed the What's New modal for
 * - Determining whether to show the modal on plugin load
 * 
 * Uses Obsidian's plugin data store (data.json) for persistence via an in-memory
 * cache that is loaded at startup and written back through the plugin's save cycle.
 * 
 * @exports checkForVersionUpgrade - Check if plugin was upgraded and modal should show
 * @exports markVersionSeen - Mark a version as seen (user dismissed modal)
 * @exports getLastSeenVersion - Get the last version the user has seen the modal for
 * @exports compareVersions - Compare two semantic version strings
 * @exports loadVersionTracking - Load version tracking data from data.json root
 * @exports getVersionTrackingData - Get current in-memory version tracking data for persistence
 * @exports clearVersionTracking - Clear all version tracking data
 */

/**
 * Shape of the version tracking data persisted in data.json under the
 * `versionTracking` key.
 */
export interface VersionTrackingData {
  lastSeenVersion: string | null;
  dismissedVersions: string[];
}

/** In-memory cache — loaded once at startup, mutated in place, persisted via the plugin save cycle. */
let _cache: VersionTrackingData = { lastSeenVersion: null, dismissedVersions: [] };

/**
 * Populate the in-memory cache from the `versionTracking` key found in the
 * root object returned by `plugin.loadData()`.  Call this once during plugin
 * `onload()`.
 */
export function loadVersionTracking(rootObj: Record<string, unknown>): void {
  const raw = rootObj?.versionTracking;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    _cache = {
      lastSeenVersion: typeof obj.lastSeenVersion === "string" ? obj.lastSeenVersion : null,
      dismissedVersions: Array.isArray(obj.dismissedVersions)
        ? (obj.dismissedVersions as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
    };
  } else {
    _cache = { lastSeenVersion: null, dismissedVersions: [] };
  }
}

/**
 * Return the current in-memory version tracking data so the plugin's save
 * cycle can write it to `root.versionTracking` in data.json.
 */
export function getVersionTrackingData(): VersionTrackingData {
  return _cache;
}

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
  return _cache.lastSeenVersion;
}

/**
 * Get the set of versions the user has explicitly dismissed the modal for
 */
function getDismissedVersions(): Set<string> {
  return new Set(_cache.dismissedVersions);
}

/**
 * Save the set of dismissed versions to the in-memory cache.
 * Changes are persisted on the next plugin save cycle.
 */
function saveDismissedVersions(versions: Set<string>): void {
  _cache.dismissedVersions = [...versions];
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
    _cache.lastSeenVersion = currentVersion;
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
  // Only update last seen and dismissed list if user chose "don't show again"
  // This allows the modal to keep showing on every load until dismissed
  if (dontShowAgain) {
    _cache.lastSeenVersion = version;
    const dismissed = getDismissedVersions();
    dismissed.add(version);
    saveDismissedVersions(dismissed);
  }
  // If not dismissed, do nothing - modal will appear again next time
}

/**
 * Clear all version tracking data (for testing/debugging)
 */
export function clearVersionTracking(): void {
  _cache = { lastSeenVersion: null, dismissedVersions: [] };
}
