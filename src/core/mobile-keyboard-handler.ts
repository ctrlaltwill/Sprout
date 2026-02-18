/**
 * @file src/core/mobile-keyboard-handler.ts
 * @summary Detects keyboard open/close on mobile devices and applies adaptive padding
 * to prevent content from being hidden behind the keyboard. Uses visualViewport API
 * to detect height changes and applies device-specific padding (adaptive between
 * iPhone, iPad, Android).
 *
 * @exports
 *   - initMobileKeyboardHandler — initializes keyboard detection and padding management
 *   - cleanupMobileKeyboardHandler — cleanup function
 */

import { Platform } from "obsidian";
import { log } from "./logger";
import { setCssProps } from "./ui";

// Store keyboard and cache state
let keyboardHeightCache = 0;
let isKeyboardOpen = false;

/**
 * Get device type based on view port and device metrics
 * Returns: 'iphone' | 'ipad' | 'android' | 'unknown'
 */
function getDeviceType(): "iphone" | "ipad" | "android" | "unknown" {
  if (!Platform.isMobileApp) return "unknown";

  // Get device dimensions
  const width = Math.min(window.innerWidth, window.innerHeight);
  const isTablet = width > 600;

  // Device detection heuristics
  // eslint-disable-next-line obsidianmd/platform
  const userAgent = navigator.userAgent.toLowerCase();

  // iPad detection
  if (
    userAgent.includes("ipad") ||
    (isTablet && userAgent.includes("like mac") && !userAgent.includes("iphone"))
  ) {
    return "ipad";
  }

  // iPhone detection
  if (userAgent.includes("iphone")) {
    return "iphone";
  }

  // Android tablet detection
  if (isTablet && userAgent.includes("android")) {
    return "android";
  }

  // Android phone detection
  if (userAgent.includes("android")) {
    return "android";
  }

  return "unknown";
}

/**
 * Calculate adaptive bottom padding based on device type and keyboard height
 * iPhone: smaller keyboard, needs less padding
 * iPad: larger keyboard, needs adaptive approach (landscape vs portrait)
 * Android: varies by device
 */
function calculateAdaptivePadding(keyboardHeight: number): number {
  const deviceType = getDeviceType();

  if (keyboardHeight === 0) {
    return 0;
  }

  switch (deviceType) {
    case "iphone":
      // iPhone keyboard is typically 216-260px
      // Add 20-30px buffer for safety margin
      return Math.min(keyboardHeight + 20, 300);

    case "ipad":
      // iPad keyboard varies: ~352px (portrait), ~350px (landscape)
      // But we want to be conservative and not over-pad on iPad
      return Math.min(keyboardHeight + 15, 400);

    case "android":
      // Android keyboards vary widely, use middle ground
      return Math.min(keyboardHeight + 25, 350);

    default:
      return keyboardHeight + 20;
  }
}

/**
 * Update padding on the main content view based on keyboard visibility
 */
function updateContentPadding() {
  if (!Platform.isMobileApp) return;

  const viewContent = document.querySelector<HTMLElement>(
    ".sprout .sprout-view-content",
  );

  if (!viewContent) return;

  const vv = window.visualViewport;
  if (!vv) return;

  const currentViewportHeight = vv.height ?? window.innerHeight;
  const windowHeight = window.innerHeight;

  // Detect if keyboard is open by comparing heights
  const heightDifference = windowHeight - currentViewportHeight;

  if (heightDifference > 50) {
    // Keyboard is open
    isKeyboardOpen = true;

    if (heightDifference !== keyboardHeightCache) {
      keyboardHeightCache = heightDifference;
      log.debug(
        `[Keyboard] Detected keyboard open, height: ${heightDifference}px, device: ${getDeviceType()}`,
      );
    }

    const adaptivePadding = calculateAdaptivePadding(keyboardHeightCache);
    const totalPadding = 40 + 50 + adaptivePadding; // 40px base + 50px buffer + keyboard padding

    if (viewContent) setCssProps(viewContent, "--kb-padding", `${totalPadding}px`);
  } else {
    // Keyboard is closed
    if (isKeyboardOpen) {
      isKeyboardOpen = false;
      log.debug("[Keyboard] Keyboard closed");
    }

    // Reset to default mobile padding
    if (viewContent) setCssProps(viewContent, "--kb-padding", "0px");
    keyboardHeightCache = 0;
  }
}

let cleanupFunctions: Array<() => void> = [];

/**
 * Initialize mobile keyboard detection and padding handler
 * Should be called once during plugin onload
 */
export function initMobileKeyboardHandler(): void {
  // Only initialize on mobile
  if (!Platform.isMobileApp) {
    log.debug("[Keyboard] Platform not mobile, skipping keyboard handler");
    return;
  }

  // Verify visualViewport is supported
  if (!window.visualViewport) {
    log.warn("[Keyboard] visualViewport not supported on this device");
    return;
  }

  log.debug("[Keyboard] Initializing keyboard handler");

  // Initialize keyboard detection

  // Handle visualViewport resize (keyboard open/close, orientation change)
  const handleViewportResize = () => {
    updateContentPadding();
  };

  // Handle window resize (orientation change, etc)
  const handleWindowResize = () => {
    updateContentPadding();
  };

  // Debounce to avoid excessive updates
  let resizeTimeout: number | null = null;
  const debouncedUpdate = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = window.setTimeout(() => {
      updateContentPadding();
      resizeTimeout = null;
    }, 50);
  };

  window.visualViewport.addEventListener("resize", handleViewportResize);
  window.visualViewport.addEventListener("scroll", debouncedUpdate);
  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("orientationchange", () => {
    // Reset cache on orientation change
    keyboardHeightCache = 0;
    isKeyboardOpen = false;
    debouncedUpdate();
  });

  // Store cleanup functions
  cleanupFunctions = [
    () => window.visualViewport?.removeEventListener("resize", handleViewportResize),
    () => window.visualViewport?.removeEventListener("scroll", debouncedUpdate),
    () => window.removeEventListener("resize", handleWindowResize),
    () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
    },
  ];

  // Initial update
  updateContentPadding();

  log.debug(
    `[Keyboard] Handler initialized for device: ${getDeviceType()}`,
  );
}

/**
 * Cleanup mobile keyboard handler
 * Should be called during plugin unload
 */
export function cleanupMobileKeyboardHandler(): void {
  log.debug("[Keyboard] Cleaning up keyboard handler");
  cleanupFunctions.forEach((cleanup) => {
    try {
      cleanup();
    } catch (e) {
      log.swallow("cleanup keyboard handler", e);
    }
  });
  cleanupFunctions = [];

  // Reset padding
  const viewContent = document.querySelector<HTMLElement>(
    ".sprout .sprout-view-content",
  );
  if (viewContent) {
    setCssProps(viewContent, "--kb-padding", "");
  }
}
