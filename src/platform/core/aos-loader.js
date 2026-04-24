/**
 * @file src/core/aos-loader.ts
 * @summary Lazy-loads and initialises the AOS (Animate On Scroll) library
 * with error suppression for querySelector errors that don't affect functionality.
 *
 * @exports
 *   - initAOS     — initialise AOS with default config
 *   - resetAOS    — refresh AOS after DOM changes
 *   - removeAOS   — shut down AOS and clean up global listeners
 */
import { log } from "./logger";
import { AOS_DURATION } from "./constants";
let AOS = null;
let AOS_INITIALIZED = false;
let AOS_LOAD_PROMISE = null;
let AOS_LOAD_FAILED = false;
function isMobileAOSDisabled() {
    var _a;
    // Disable AOS on phone-sized mobile devices; keep it for iPad / tablet / desktop.
    // Obsidian adds body.is-mobile for all mobile devices (phones + tablets).
    // We distinguish phones from iPads via viewport width (phones < 768px).
    if (typeof document !== "undefined" &&
        ((_a = document.body) === null || _a === void 0 ? void 0 : _a.classList.contains("is-mobile")) &&
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 767px)").matches) {
        return true;
    }
    return false;
}
function forceRevealAosElements(root = document) {
    let elements = [];
    try {
        elements = Array.from(root.querySelectorAll("[data-aos]"));
    }
    catch (e) {
        log.swallow("forceRevealAosElements query", e);
        return;
    }
    for (const el of elements) {
        el.classList.remove("aos-init", "aos-animate");
        el.classList.add("learnkit-aos-fallback", "learnkit-aos-fallback");
    }
}
// Suppress AOS querySelector errors (removable handler)
function isLikelyAosQuerySelectorError(event) {
    var _a, _b, _c;
    const message = String((_a = event.message) !== null && _a !== void 0 ? _a : "").toLowerCase();
    if (!message.includes("queryselector"))
        return false;
    const filename = String((_b = event.filename) !== null && _b !== void 0 ? _b : "").toLowerCase();
    const stackRaw = (_c = event.error) === null || _c === void 0 ? void 0 : _c.stack;
    const stack = typeof stackRaw === "string" ? stackRaw.toLowerCase() : "";
    return message.includes("aos") || filename.includes("aos") || stack.includes("aos");
}
function aosErrorHandler(event) {
    if (isLikelyAosQuerySelectorError(event)) {
        event.preventDefault();
        return true;
    }
}
window.addEventListener("error", aosErrorHandler);
/** Remove the global AOS error suppression handler. Call on plugin unload. */
export function removeAosErrorHandler() {
    window.removeEventListener("error", aosErrorHandler);
}
// Load AOS via dynamic import (resolves before plugin onload)
function loadAOS() {
    if (AOS || AOS_LOAD_FAILED)
        return Promise.resolve();
    if (AOS_LOAD_PROMISE)
        return AOS_LOAD_PROMISE;
    AOS_LOAD_PROMISE = import("aos")
        .then((mod) => {
        var _a;
        const typed = mod;
        AOS = (_a = typed.default) !== null && _a !== void 0 ? _a : typed;
    })
        .catch(() => {
        AOS_LOAD_FAILED = true;
        log.warn("AOS not available");
    });
    return AOS_LOAD_PROMISE;
}
// Kick off the import ASAP, but keep init resilient if callers race it.
void loadAOS();
export function initAOS(config) {
    if (isMobileAOSDisabled()) {
        forceRevealAosElements(document);
        return;
    }
    if (AOS_INITIALIZED || AOS_LOAD_FAILED)
        return;
    if (!AOS) {
        void loadAOS().then(() => {
            if (!AOS_INITIALIZED && AOS)
                initAOS(config);
        });
        return;
    }
    try {
        // Important: do NOT set startEvent: 'load'. In Obsidian (and SPAs), the
        // window 'load' event has typically already fired, so AOS would never run
        // its first initialization and refresh calls would be ignored.
        AOS.init(config || {
            duration: AOS_DURATION,
            easing: "ease-out",
            once: true,
            offset: 50,
            disable: false,
        });
        AOS_INITIALIZED = true;
        // Force refresh after next frame(s) so newly-rendered nodes are measured.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                var _a, _b;
                try {
                    (_a = AOS === null || AOS === void 0 ? void 0 : AOS.refresh) === null || _a === void 0 ? void 0 : _a.call(AOS);
                    (_b = AOS === null || AOS === void 0 ? void 0 : AOS.refreshHard) === null || _b === void 0 ? void 0 : _b.call(AOS);
                }
                catch (e) {
                    log.swallow("AOS post-init refresh", e);
                }
            });
        });
    }
    catch (e) {
        log.swallow("AOS init", e);
    }
}
export function refreshAOS() {
    var _a, _b;
    if (isMobileAOSDisabled()) {
        forceRevealAosElements(document);
        return;
    }
    if (AOS_LOAD_FAILED)
        return;
    if (!AOS_INITIALIZED) {
        initAOS();
        return;
    }
    if (!AOS)
        return;
    try {
        (_a = AOS.refresh) === null || _a === void 0 ? void 0 : _a.call(AOS);
        (_b = AOS.refreshHard) === null || _b === void 0 ? void 0 : _b.call(AOS);
    }
    catch (e) {
        log.swallow("AOS refresh", e);
    }
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
export function cascadeAOSOnLoad(root, options) {
    if (isMobileAOSDisabled()) {
        forceRevealAosElements(root);
        return 0;
    }
    const stepMs = Number.isFinite(options === null || options === void 0 ? void 0 : options.stepMs) ? Number(options === null || options === void 0 ? void 0 : options.stepMs) : 0;
    const baseDelayMs = Number.isFinite(options === null || options === void 0 ? void 0 : options.baseDelayMs) ? Number(options === null || options === void 0 ? void 0 : options.baseDelayMs) : 0;
    const durationMs = Number.isFinite(options === null || options === void 0 ? void 0 : options.durationMs) ? Number(options === null || options === void 0 ? void 0 : options.durationMs) : AOS_DURATION;
    const overwriteDelays = (options === null || options === void 0 ? void 0 : options.overwriteDelays) !== false;
    let els = [];
    try {
        els = Array.from(root.querySelectorAll("[data-aos]"));
    }
    catch (e) {
        log.swallow("cascadeAOSOnLoad query", e);
        return 0;
    }
    if (els.length === 0)
        return 0;
    // Reset any prior forced visibility and ensure a clean starting state.
    for (const el of els) {
        el.classList.remove("learnkit-aos-fallback", "learnkit-aos-fallback");
        el.classList.remove("aos-animate");
        // Ensure a duration is present even if AOS JS never runs.
        if (!el.hasAttribute("data-aos-duration"))
            el.setAttribute("data-aos-duration", String(durationMs));
    }
    let maxDelay = 0;
    if (stepMs > 0) {
        let idx = 0;
        for (const el of els) {
            const existing = Number(el.getAttribute("data-aos-delay"));
            const shouldOverwrite = overwriteDelays || !Number.isFinite(existing);
            const delay = Math.max(0, Math.floor(baseDelayMs + idx * stepMs));
            if (shouldOverwrite)
                el.setAttribute("data-aos-delay", String(delay));
            maxDelay = Math.max(maxDelay, shouldOverwrite ? delay : (Number.isFinite(existing) ? existing : 0));
            idx += 1;
        }
    }
    else {
        for (const el of els) {
            const existing = Number(el.getAttribute("data-aos-delay"));
            if (Number.isFinite(existing))
                maxDelay = Math.max(maxDelay, existing);
        }
    }
    // Add `aos-animate` after next paint so transitions run.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            for (const el of els)
                el.classList.add("aos-animate");
        });
    });
    // Safety-net: if any element is still invisible after animations should
    // have completed (e.g. AOS CSS failed to load, or a mobile quirk hides
    // elements), force-reveal them via the fallback class.
    const safetyDelayMs = Math.max(600, Math.floor(maxDelay + durationMs + 300));
    setTimeout(() => {
        for (const el of els) {
            if (!el.isConnected)
                continue;
            const cs = getComputedStyle(el);
            if (cs.opacity === "0" || cs.visibility === "hidden") {
                el.classList.add("learnkit-aos-fallback", "learnkit-aos-fallback");
            }
        }
    }, safetyDelayMs);
    return maxDelay;
}
export function getAOS() { return AOS; }
export function resetAOS() {
    AOS_INITIALIZED = false;
    if (isMobileAOSDisabled()) {
        forceRevealAosElements(document);
        return;
    }
    // Remove AOS classes from all elements to allow re-animation
    try {
        const aosElements = document.querySelectorAll('[data-aos]');
        aosElements.forEach(el => {
            el.classList.remove('aos-init', 'aos-animate');
            el.removeAttribute('data-aos-id');
        });
    }
    catch (e) {
        log.swallow("AOS reset cleanup", e);
    }
}
