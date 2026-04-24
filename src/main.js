/**
 * @file src/main.ts
 * @summary Plugin entry point that wires lifecycle, startup registration, and teardown.
 *
 * @exports
 *  - LearnKitPlugin
 *  - SproutPlugin
 */
// This file is small on purpose. The chaos now lives in organized modules. Have fun exploring!
import "basecoat-css/all";
import { LearnKitPluginBase } from "./platform/plugin/plugin-base";
import { WithCoreMethods } from "./platform/plugin/core-methods";
import { WithDataSyncMethods } from "./platform/plugin/data-sync-methods";
import { WithNavigationMethods } from "./platform/plugin/navigation-methods";
import { WithReminderAndRibbonMethods } from "./platform/plugin/reminder-ribbon-methods";
import { WithLifecycleMethods } from "./platform/plugin/lifecycle-methods";
const _Composed = WithLifecycleMethods(WithReminderAndRibbonMethods(WithNavigationMethods(WithDataSyncMethods(WithCoreMethods(LearnKitPluginBase)))));
export class LearnKitPlugin extends _Composed {
}
export { LearnKitPlugin as SproutPlugin };
export default LearnKitPlugin;
// If you want to help clean this up and keep the dev caffeinated, head here:
// https://buymeacoffee.com/williamguy
