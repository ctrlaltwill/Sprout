/**
 * AOS loader with error suppression
 * The querySelector errors don't break anything - we just hide them
 */

import { log } from "./logger";
import { AOS_DURATION } from "./constants";

type AOSModule = {
  init: (config: Record<string, unknown>) => void;
  refresh?: () => void;
  refreshHard?: () => void;
  default?: AOSModule;
};

let AOS: AOSModule | null = null;
let AOS_INITIALIZED = false;

// Suppress AOS querySelector errors (removable handler)
function aosErrorHandler(event: ErrorEvent) {
  if (event.message?.includes('querySelector')) {
    event.preventDefault();
    return true;
  }
}
window.addEventListener('error', aosErrorHandler);

/** Remove the global AOS error suppression handler. Call on plugin unload. */
export function removeAosErrorHandler(): void {
  window.removeEventListener('error', aosErrorHandler);
}

// Load AOS via dynamic import (resolves before plugin onload)
void (async () => {
  try {
    const mod = (await import("aos")) as { default?: AOSModule } & Partial<AOSModule>;
    AOS = mod.default ?? (mod as unknown as AOSModule);
  } catch {
    log.warn("AOS not available");
  }
})();

export function initAOS(config?: Record<string, unknown>): void {
  if (AOS_INITIALIZED || !AOS) return;
  try {
    AOS.init(config || { 
      duration: AOS_DURATION, 
      easing: "ease-out", 
      once: true, 
      offset: 50,
      disable: false,
      startEvent: 'DOMContentLoaded'
    });
    AOS_INITIALIZED = true;
    // Force immediate refresh to show elements
    setTimeout(() => {
      if (AOS?.refresh) AOS.refresh();
    }, 100);
  } catch (e) { log.swallow("AOS init", e); }
}

export function refreshAOS(): void {
  if (!AOS || !AOS_INITIALIZED) return;
  try { 
    AOS.refresh?.(); 
    AOS.refreshHard?.(); 
  } catch (e) { log.swallow("AOS refresh", e); }
}

export function getAOS() { return AOS; }
export function resetAOS(): void { AOS_INITIALIZED = false; }
