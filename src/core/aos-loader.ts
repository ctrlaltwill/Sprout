/**
 * AOS loader with error suppression
 * The querySelector errors don't break anything - we just hide them
 */

let AOS: any = null;
let AOS_INITIALIZED = false;

// Suppress AOS querySelector errors
window.addEventListener('error', (event) => {
  if (event.message?.includes('querySelector')) {
    event.preventDefault();
    return true;
  }
});

// Load AOS
try {
  AOS = require("aos");
  if (AOS.default) AOS = AOS.default;
} catch (err) {
  console.warn("AOS not available");
}

export function initAOS(config?: any): void {
  if (AOS_INITIALIZED || !AOS) return;
  try {
    AOS.init(config || { 
      duration: 600, 
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
  } catch {}
}

export function refreshAOS(): void {
  if (!AOS || !AOS_INITIALIZED) return;
  try { 
    AOS.refresh?.(); 
    AOS.refreshHard?.(); 
  } catch {}
}

export function getAOS() { return AOS; }
export function resetAOS(): void { AOS_INITIALIZED = false; }
