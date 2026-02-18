/**
 * @file src/core/basecoat.ts
 * @summary Basecoat UI runtime helpers. Provides the `BasecoatApi` type and a safe accessor
 * for the global `window.basecoat` object used to initialise/start the Basecoat observer.
 *
 * @exports
 *   - BasecoatApi    — shape of the global basecoat runtime
 *   - getBasecoatApi — returns the global Basecoat API or null if unavailable
 */

/** Shape of the Basecoat UI runtime API expected on `window.basecoat`. */
export type BasecoatApi = {
  init?: (group: string) => void;
  initAll?: () => void;
  start?: () => void;
  stop?: () => void;
};

/**
 * Returns a valid BasecoatApi from `window.basecoat`, or `null` if the global
 * is missing or lacks the required `init`/`initAll` + `start` methods.
 */
export function getBasecoatApi(): BasecoatApi | null {
  const bc = window?.basecoat as BasecoatApi | undefined;
  if (!bc) return null;
  const hasInit = typeof bc.initAll === "function" || typeof bc.init === "function";
  const hasStart = typeof bc.start === "function";
  if (!hasInit || !hasStart) return null;
  return bc;
}
