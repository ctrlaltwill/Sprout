/**
 * @file src/platform/plugin/plugin-base.ts
 * @summary Module for plugin base.
 *
 * @exports
 *  - LearnKitPluginBase
 *  - SproutPluginBase
 */
import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS } from "../core/constants";
export class LearnKitPluginBase extends Plugin {
    constructor() {
        super(...arguments);
        this._bc = null;
        this.isWideMode = false;
        this.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
    }
    // Narrow Plugin's `onload(): Promise<void> | void` so that the
    // mixin chain sees a consistent `Promise<void>` return type.
    async onload() { }
}
// Backwards-compatible alias retained for Phase 1 rename safety.
export { LearnKitPluginBase as SproutPluginBase };
