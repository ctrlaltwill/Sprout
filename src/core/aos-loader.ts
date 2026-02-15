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
let AOS_LOAD_PROMISE: Promise<void> | null = null;
let AOS_LOAD_FAILED = false;

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
function loadAOS(): Promise<void> {
  if (AOS || AOS_LOAD_FAILED) return Promise.resolve();
  if (AOS_LOAD_PROMISE) return AOS_LOAD_PROMISE;

  AOS_LOAD_PROMISE = import("aos")
    .then((mod) => {
      const typed = mod as { default?: AOSModule } & Partial<AOSModule>;
      AOS = typed.default ?? (typed as unknown as AOSModule);
    })
    .catch(() => {
      AOS_LOAD_FAILED = true;
      log.warn("AOS not available");
    });

  return AOS_LOAD_PROMISE;
}

// Kick off the import ASAP, but keep init resilient if callers race it.
void loadAOS();

export function initAOS(config?: Record<string, unknown>): void {
  if (AOS_INITIALIZED || AOS_LOAD_FAILED) return;
  if (!AOS) {
    void loadAOS().then(() => {
      if (!AOS_INITIALIZED && AOS) initAOS(config);
    });
    return;
  }
  try {
    // Important: do NOT set startEvent: 'load'. In Obsidian (and SPAs), the
    // window 'load' event has typically already fired, so AOS would never run
    // its first initialization and refresh calls would be ignored.
    AOS.init(
      config || {
        duration: AOS_DURATION,
        easing: "ease-out",
        once: true,
        offset: 50,
        disable: false,
      }
    );
    AOS_INITIALIZED = true;
    // Force refresh after next frame(s) so newly-rendered nodes are measured.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          AOS?.refresh?.();
          AOS?.refreshHard?.();
        } catch (e) {
          log.swallow("AOS post-init refresh", e);
        }
      });
    });
  } catch (e) { log.swallow("AOS init", e); }
}

export function refreshAOS(): void {
  if (AOS_LOAD_FAILED) return;
  if (!AOS_INITIALIZED) {
    initAOS();
    return;
  }
  if (!AOS) return;
  try { 
    AOS.refresh?.(); 
    AOS.refreshHard?.(); 
  } catch (e) { log.swallow("AOS refresh", e); }
}

/**
 * Force an AOS-style cascade on load.
 *
 * Why: In Obsidian, view content often scrolls inside a container, not the window.
 * AOS listens to window scroll, so elements may never receive `aos-animate`.
 *
 * This helper assigns a cascading `data-aos-delay` and then adds `aos-animate`
 * after the next paint so everything animates on initial render (no scroll).
 *
 * Returns the maximum delay applied (ms).
 */
export function cascadeAOSOnLoad(
  root: ParentNode,
  options?: {
    stepMs?: number;
    baseDelayMs?: number;
    durationMs?: number;
    overwriteDelays?: boolean;
  }
): number {
  const stepMs = Number.isFinite(options?.stepMs) ? Number(options?.stepMs) : 0;
  const baseDelayMs = Number.isFinite(options?.baseDelayMs) ? Number(options?.baseDelayMs) : 0;
  const durationMs = Number.isFinite(options?.durationMs) ? Number(options?.durationMs) : AOS_DURATION;
  const overwriteDelays = options?.overwriteDelays !== false;

  let els: HTMLElement[] = [];
  try {
    els = Array.from(root.querySelectorAll<HTMLElement>("[data-aos]"));
  } catch (e) {
    log.swallow("cascadeAOSOnLoad query", e);
    return 0;
  }

  if (els.length === 0) return 0;

  // Reset any prior forced visibility and ensure a clean starting state.
  for (const el of els) {
    el.classList.remove("sprout-aos-fallback");
    el.classList.remove("aos-animate");
    // Ensure a duration is present even if AOS JS never runs.
    if (!el.hasAttribute("data-aos-duration")) el.setAttribute("data-aos-duration", String(durationMs));
  }

  let maxDelay = 0;
  if (stepMs > 0) {
    let idx = 0;
    for (const el of els) {
      const existing = Number(el.getAttribute("data-aos-delay"));
      const shouldOverwrite = overwriteDelays || !Number.isFinite(existing);
      const delay = Math.max(0, Math.floor(baseDelayMs + idx * stepMs));
      if (shouldOverwrite) el.setAttribute("data-aos-delay", String(delay));
      maxDelay = Math.max(maxDelay, shouldOverwrite ? delay : (Number.isFinite(existing) ? existing : 0));
      idx += 1;
    }
  } else {
    for (const el of els) {
      const existing = Number(el.getAttribute("data-aos-delay"));
      if (Number.isFinite(existing)) maxDelay = Math.max(maxDelay, existing);
    }
  }

  // Add `aos-animate` after next paint so transitions run.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const el of els) el.classList.add("aos-animate");
    });
  });

  return maxDelay;
}

export function getAOS() { return AOS; }

export function resetAOS(): void { 
  AOS_INITIALIZED = false;
  
  // Remove AOS classes from all elements to allow re-animation
  try {
    const aosElements = document.querySelectorAll('[data-aos]');
    aosElements.forEach(el => {
      el.classList.remove('aos-init', 'aos-animate');
      el.removeAttribute('data-aos-id');
    });
  } catch (e) { 
    log.swallow("AOS reset cleanup", e); 
  }
}
