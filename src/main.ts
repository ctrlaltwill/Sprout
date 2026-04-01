// This file is small on purpose. The chaos now lives in organized modules. Have fun exploring!

import "basecoat-css/all";

import { LearnKitPluginBase } from "./platform/plugin/plugin-base";
import { installCorePluginMethods } from "./platform/plugin/core-methods";
import { installDataSyncMethods } from "./platform/plugin/data-sync-methods";
import { installNavigationMethods } from "./platform/plugin/navigation-methods";
import { installReminderAndRibbonMethods } from "./platform/plugin/reminder-ribbon-methods";
import { installLifecycleMethods } from "./platform/plugin/lifecycle-methods";

export class LearnKitPlugin extends LearnKitPluginBase {}
export { LearnKitPlugin as SproutPlugin };
export default LearnKitPlugin;

installCorePluginMethods(LearnKitPlugin);
installDataSyncMethods(LearnKitPlugin);
installNavigationMethods(LearnKitPlugin);
installReminderAndRibbonMethods(LearnKitPlugin);
installLifecycleMethods(LearnKitPlugin);

// If you want to help clean this up and keep the dev caffeinated, head here:
// https://buymeacoffee.com/williamguy
