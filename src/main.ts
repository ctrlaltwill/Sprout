/**
 * @file src/main.ts
 * @summary Entry point for the Sprout Obsidian plugin. Extends the Obsidian Plugin class
 * to register views (Reviewer, Widget, Browser, Analytics, Home), commands, ribbon icons,
 * editor context-menu items, settings, and the Basecoat UI runtime. Handles plugin lifecycle
 * (load/unload), settings normalisation, data persistence, sync orchestration, GitHub star
 * fetching, and scheduling/analytics reset utilities.
 *
 * @exports
 *   - SproutPlugin (default) — main plugin class extending Obsidian's Plugin
 */

import "basecoat-css/all";

import {
  Plugin,
  Notice,
  TFile,
  addIcon,
  type ItemView,
  type MenuItem,
  type Editor,
  MarkdownView,
  type Menu,
  type WorkspaceLeaf,
  Platform,
  requestUrl,
} from "obsidian";

import {
  VIEW_TYPE_REVIEWER,
  VIEW_TYPE_WIDGET,
  VIEW_TYPE_STUDY_ASSISTANT,
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_HOME,
  VIEW_TYPE_SETTINGS,
  BRAND,
  DEFAULT_SETTINGS,
  deepMerge,
  type SproutSettings,
} from "./platform/core/constants";

import { log } from "./platform/core/logger";
import { clamp, clonePlain, isPlainObject, type FlashcardType } from "./platform/core/utils";
import { getBasecoatApi, patchBasecoatNullGuards } from "./platform/core/basecoat";
import { migrateSettingsInPlace } from "./views/settings/settings-migration";
import { normaliseSettingsInPlace } from "./views/settings/settings-normalisation";
import { registerReadingViewPrettyCards, teardownReadingView } from "./views/reading/reading-view";
import { removeAosErrorHandler } from "./platform/core/aos-loader";
import { initTooltipPositioner } from "./platform/core/tooltip-positioner";
import { initButtonTooltipDefaults } from "./platform/core/tooltip-defaults";
import { initMobileKeyboardHandler, cleanupMobileKeyboardHandler } from "./platform/core/mobile-keyboard-handler";

import { JsonStore } from "./platform/core/store";
import type { IStore } from "./platform/core/store-interface";
import { SqliteStore, isSqliteDatabasePresent } from "./platform/core/sqlite-store";
import { migrateJsonToSqlite } from "./platform/core/migration";
import { queryFirst } from "./platform/core/ui";
import { SproutReviewerView } from "./views/reviewer/review-view";
import { SproutWidgetView } from "./views/widget/sprout-widget-view";
import { SproutAssistantPopup } from "./views/study-assistant/sprout-assistant-popup";
import { SproutStudyAssistantView } from "./views/study-assistant/sprout-study-assistant-view";
import { SproutCardBrowserView } from "./views/browser/sprout-card-browser-view";
import { SproutAnalyticsView } from "./views/analytics/analytics-view";
import { SproutHomeView } from "./views/home/sprout-home-view";
import { SproutSettingsTab } from "./views/settings/sprout-settings-tab";
import { SproutSettingsView } from "./views/settings/sprout-settings-view";
import { formatSyncNotice, syncOneFile, syncQuestionBank } from "./platform/integrations/sync/sync-engine";
import { joinPath, safeStatMtime, createDataJsonBackupNow } from "./platform/integrations/sync/backup";
import { CardCreatorModal } from "./platform/modals/card-creator-modal";
import { ImageOcclusionCreatorModal } from "./platform/modals/image-occlusion-creator-modal";
import { ParseErrorModal } from "./platform/modals/parse-error-modal";
import { LaunchNoticeModal } from "./platform/modals/launch-notice-modal";
import { setDelimiter } from "./platform/core/delimiter";
// Anki modals are lazy-loaded to defer sql.js WASM parsing until needed
// import { AnkiImportModal } from "./platform/modals/anki-import-modal";
// import { AnkiExportModal } from "./platform/modals/anki-export-modal";
import { resetCardScheduling, type CardState } from "./engine/scheduler/scheduler";
import { WhatsNewModal, hasReleaseNotes } from "./platform/modals/whats-new-modal";
import { checkForVersionUpgrade, loadVersionTracking, getVersionTrackingData } from "./platform/core/version-manager";
import { ReminderEngine } from "./views/reminders/reminder-engine";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import React from "react";
import { t } from "./platform/translations/translator";


const SPROUT_RIBBON_BRAND_ICON = `<svg viewBox="0 0 1536 1536" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="matrix(13.970297,0,0,13.970297,-11267.410891,-2326.950495)"><path fill="currentColor" d="M857.924,173.62C857.924,173.606 857.924,173.591 857.924,173.576C857.924,171.603 859.526,170 861.5,170C863.474,170 865.076,171.603 865.076,173.576C865.076,173.591 865.076,173.606 865.076,173.62L864.621,210.894L886.162,180.471C886.171,180.459 886.179,180.448 886.188,180.436C887.348,178.839 889.586,178.484 891.183,179.645C892.78,180.805 893.135,183.043 891.974,184.64C891.966,184.652 891.957,184.664 891.948,184.675L869.671,214.563L904.98,202.612C904.994,202.608 905.008,202.603 905.022,202.598C906.899,201.988 908.918,203.017 909.528,204.895C910.138,206.772 909.109,208.791 907.232,209.401C907.218,209.406 907.204,209.41 907.191,209.414L871.6,220.5L907.191,231.586C907.204,231.59 907.218,231.594 907.232,231.599C909.109,232.209 910.138,234.228 909.528,236.105C908.918,237.983 906.899,239.012 905.022,238.402C905.008,238.397 904.994,238.392 904.98,238.388L869.671,226.437L891.948,256.325C891.957,256.336 891.966,256.348 891.974,256.36C893.135,257.957 892.78,260.195 891.183,261.355C889.586,262.516 887.348,262.161 886.188,260.564C886.179,260.552 886.171,260.541 886.162,260.529L864.621,230.106L865.076,267.38C865.076,267.394 865.076,267.409 865.076,267.424C865.076,269.397 863.474,271 861.5,271C859.526,271 857.924,269.397 857.924,267.424C857.924,267.409 857.924,267.394 857.924,267.38L858.379,230.106L836.838,260.529C836.829,260.541 836.821,260.552 836.812,260.564C835.652,262.161 833.414,262.516 831.817,261.355C830.22,260.195 829.865,257.957 831.026,256.36C831.034,256.348 831.043,256.336 831.052,256.325L853.329,226.437L818.02,238.388C818.006,238.392 817.992,238.397 817.978,238.402C816.101,239.012 814.082,237.983 813.472,236.105C812.862,234.228 813.891,232.209 815.768,231.599C815.782,231.594 815.796,231.59 815.809,231.586L851.4,220.5L815.809,209.414C815.796,209.41 815.782,209.406 815.768,209.401C813.891,208.791 812.862,206.772 813.472,204.895C814.082,203.017 816.101,201.988 817.978,202.598C817.992,202.603 818.006,202.608 818.02,202.612L853.329,214.563L831.052,184.675C831.043,184.664 831.034,184.652 831.026,184.64C829.865,183.043 830.22,180.805 831.817,179.645C833.414,178.484 835.652,178.839 836.812,180.436C836.821,180.448 836.829,180.459 836.838,180.471L858.379,210.894L857.924,173.62Z"/></g></svg>`;
const SPROUT_BRAND_ICON_KEY = "sprout-brand";
const SPROUT_WIDGET_STUDY_ICON_KEY = "sprout-widget-study";
const SPROUT_WIDGET_ASSISTANT_ICON_KEY = "sprout-widget-assistant";

const SPROUT_STUDY_WIDGET_ICON = `<svg width="100%" height="100%" viewBox="0 0 1536 1536" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" fill="currentColor" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g transform="matrix(0.751074,0,0,0.767541,191.175419,189.658048)"><path d="M1354.471,475.629L1216.426,1222.622C1187.458,1379.373 1036.678,1483.116 879.927,1454.149L413.056,1367.87C256.305,1338.903 152.561,1188.122 181.529,1031.371L319.574,284.378C348.542,127.627 499.322,23.883 656.073,52.851L1122.944,139.13C1279.695,168.097 1383.439,318.878 1354.471,475.629ZM1253.316,456.935C1271.966,356.013 1205.172,258.935 1104.25,240.285L637.38,154.007C536.458,135.356 439.38,202.15 420.73,303.072L282.684,1050.065C264.034,1150.987 330.828,1248.064 431.75,1266.715L898.62,1352.993C999.542,1371.644 1096.62,1304.85 1115.27,1203.928L1253.316,456.935ZM462.176,778.988L462.875,805.567L460.897,796.724L460.681,787.684L462.176,778.988Z"/></g><g transform="matrix(0.653494,0,0,0.653494,266.116393,275.592048)"><path d="M557.822,584.808L558.31,585.081L558.46,585.163L673.145,650.736L615.411,528.644L614.94,527.643L614.612,526.911L611.748,518.568L610.561,509.804L611.046,501.161L613.099,492.854L616.651,485.058L621.662,477.967L628.088,471.829L635.811,466.957L644.396,463.73L653.283,462.344L662.108,462.762L670.581,464.893L678.462,468.638L685.515,473.899L691.481,480.558L695.93,488.084L696.316,488.919L750.406,610.807L773.492,477.073L773.59,476.534L776.089,467.851L780.128,459.991L785.499,453.161L792.013,447.511L799.511,443.183L807.83,440.344L816.752,439.195L825.95,439.919L834.799,442.53L842.721,446.792L849.477,452.416L854.933,459.139L858.997,466.744L861.572,475.042L862.535,483.826L861.766,492.83L861.665,493.368L835.429,626.521L929.51,532.013L929.9,531.631L929.992,531.55L937.014,525.932L944.966,521.846L953.433,519.453L962.132,518.772L970.807,519.81L979.199,522.574L987.003,527.044L993.868,533.127L999.34,540.437L1003.148,548.466L1005.293,556.88L1005.824,565.43L1004.773,573.923L1002.136,582.168L997.896,589.929L992.239,596.697L991.671,597.264L990.874,598.03L893.318,691.424L1023.863,671.171L1024.033,671.146L1024.586,671.067L1033.797,670.713L1042.682,672.233L1050.907,675.443L1058.241,680.144L1064.504,686.155L1069.528,693.312L1073.125,701.433L1075.103,710.276L1075.319,719.316L1073.824,728.012L1070.773,736.113L1066.309,743.437L1060.543,749.822L1053.566,755.075L1045.506,758.952L1036.663,761.16L1036.039,761.253L903.141,778.474L1021.029,842.014L1021.657,842.366L1029.126,847.588L1035.268,854.09L1039.907,861.489L1043.01,869.513L1044.561,877.948L1044.516,886.605L1042.804,895.261L1039.372,903.626L1034.364,911.179L1028.102,917.478L1020.852,922.367L1012.854,925.742L1004.325,927.512L995.495,927.57L986.654,925.814L978.178,922.192L977.69,921.919L977.54,921.837L862.855,856.264L920.589,978.356L921.06,979.357L921.388,980.089L924.252,988.432L925.439,997.196L924.954,1005.839L922.901,1014.146L919.349,1021.942L914.338,1029.033L907.912,1035.171L900.189,1040.043L891.604,1043.27L882.717,1044.656L873.892,1044.238L865.419,1042.107L857.538,1038.362L850.485,1033.101L844.519,1026.442L840.07,1018.916L839.684,1018.081L785.593,896.193L762.508,1029.927L762.41,1030.466L759.911,1039.149L755.872,1047.009L750.501,1053.839L743.987,1059.489L736.489,1063.817L728.169,1066.656L719.247,1067.805L710.05,1067.081L701.201,1064.47L693.279,1060.208L686.523,1054.584L681.067,1047.861L677.003,1040.256L674.428,1031.958L673.465,1023.174L674.234,1014.17L674.335,1013.632L700.571,880.479L606.49,974.987L606.1,975.369L606.008,975.45L598.986,981.068L591.034,985.154L582.567,987.547L573.868,988.228L565.193,987.189L556.801,984.426L548.997,979.956L542.132,973.873L536.66,966.563L532.852,958.534L530.707,950.12L530.176,941.57L531.227,933.077L533.863,924.832L538.104,917.071L543.761,910.303L544.328,909.736L545.126,908.97L642.682,815.576L512.137,835.829L511.967,835.854L511.414,835.933L502.203,836.287L493.318,834.767L485.093,831.557L477.759,826.856L471.496,820.845L466.472,813.688L462.875,805.567L460.897,796.724L460.681,787.684L462.176,778.988L465.227,770.887L469.691,763.563L475.457,757.178L482.434,751.925L490.494,748.048L499.336,745.84L499.961,745.747L632.859,728.526L514.971,664.986L514.343,664.634L506.874,659.412L500.732,652.91L496.093,645.511L492.99,637.487L491.438,629.052L491.484,620.395L493.196,611.739L496.628,603.374L501.636,595.821L507.898,589.522L515.148,584.633L523.146,581.258L531.675,579.488L540.505,579.43L549.346,581.186L557.822,584.808Z"/></g></svg>`;
const SPROUT_ASSISTANT_WIDGET_ICON = `<svg width="100%" height="100%" viewBox="0 0 1536 1536" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" fill="currentColor" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g transform="matrix(0.699379,0,0,0.699379,257.301657,241.017995)"><path d="M557.822,584.808L558.31,585.081L558.46,585.163L673.145,650.736L615.411,528.644L614.94,527.643L614.612,526.911L611.748,518.568L610.561,509.804L611.046,501.161L613.099,492.854L616.651,485.058L621.662,477.967L628.088,471.829L635.811,466.957L644.396,463.73L653.283,462.344L662.108,462.762L670.581,464.893L678.462,468.638L685.515,473.899L691.481,480.558L695.93,488.084L696.316,488.919L750.406,610.807L773.492,477.073L773.59,476.534L776.089,467.851L780.128,459.991L785.499,453.161L792.013,447.511L799.511,443.183L807.83,440.344L816.752,439.195L825.95,439.919L834.799,442.53L842.721,446.792L849.477,452.416L854.933,459.139L858.997,466.744L861.572,475.042L862.535,483.826L861.766,492.83L861.665,493.368L835.429,626.521L929.51,532.013L929.9,531.631L929.992,531.55L937.014,525.932L944.966,521.846L953.433,519.453L962.132,518.772L970.807,519.81L979.199,522.574L987.003,527.044L993.868,533.127L999.34,540.437L1003.148,548.466L1005.293,556.88L1005.824,565.43L1004.773,573.923L1002.136,582.168L997.896,589.929L992.239,596.697L991.671,597.264L990.874,598.03L893.318,691.424L1023.863,671.171L1024.033,671.146L1024.586,671.067L1033.797,670.713L1042.682,672.233L1050.907,675.443L1058.241,680.144L1064.504,686.155L1069.528,693.312L1073.125,701.433L1075.103,710.276L1075.319,719.316L1073.824,728.012L1070.773,736.113L1066.309,743.437L1060.543,749.822L1053.566,755.075L1045.506,758.952L1036.663,761.16L1036.039,761.253L903.141,778.474L1021.029,842.014L1021.657,842.366L1029.126,847.588L1035.268,854.09L1039.907,861.489L1043.01,869.513L1044.561,877.948L1044.516,886.605L1042.804,895.261L1039.372,903.626L1034.364,911.179L1028.102,917.478L1020.852,922.367L1012.854,925.742L1004.325,927.512L995.495,927.57L986.654,925.814L978.178,922.192L977.69,921.919L977.54,921.837L862.855,856.264L920.589,978.356L921.06,979.357L921.388,980.089L924.252,988.432L925.439,997.196L924.954,1005.839L922.901,1014.146L919.349,1021.942L914.338,1029.033L907.912,1035.171L900.189,1040.043L891.604,1043.27L882.717,1044.656L873.892,1044.238L865.419,1042.107L857.538,1038.362L850.485,1033.101L844.519,1026.442L840.07,1018.916L839.684,1018.081L785.593,896.193L762.508,1029.927L762.41,1030.466L759.911,1039.149L755.872,1047.009L750.501,1053.839L743.987,1059.489L736.489,1063.817L728.169,1066.656L719.247,1067.805L710.05,1067.081L701.201,1064.47L693.279,1060.208L686.523,1054.584L681.067,1047.861L677.003,1040.256L674.428,1031.958L673.465,1023.174L674.234,1014.17L674.335,1013.632L700.571,880.479L606.49,974.987L606.1,975.369L606.008,975.45L598.986,981.068L591.034,985.154L582.567,987.547L573.868,988.228L565.193,987.189L556.801,984.426L548.997,979.956L542.132,973.873L536.66,966.563L532.852,958.534L530.707,950.12L530.176,941.57L531.227,933.077L533.863,924.832L538.104,917.071L543.761,910.303L544.328,909.736L545.126,908.97L642.682,815.576L512.137,835.829L511.967,835.854L511.414,835.933L502.203,836.287L493.318,834.767L485.093,831.557L477.759,826.856L471.496,820.845L466.472,813.688L462.875,805.567L460.897,796.724L460.681,787.684L462.176,778.988L465.227,770.887L469.691,763.563L475.457,757.178L482.434,751.925L490.494,748.048L499.336,745.84L499.961,745.747L632.859,728.526L514.971,664.986L514.343,664.634L506.874,659.412L500.732,652.91L496.093,645.511L492.99,637.487L491.438,629.052L491.484,620.395L493.196,611.739L496.628,603.374L501.636,595.821L507.898,589.522L515.148,584.633L523.146,581.258L531.675,579.488L540.505,579.43L549.346,581.186L557.822,584.808Z"/></g><g transform="matrix(43.963361,0,0,43.963361,266.850304,240.422628)"><path d="M2.073,16.738C1.367,15.258 1,13.64 1,12C1,5.966 5.966,1 12,1C18.035,1 23,5.966 23,12C23,18.035 18.035,23 12,23C10.407,23 8.833,22.654 7.38,21.984C7.227,21.932 7.064,21.918 6.901,21.943L3.538,22.927L3.514,22.934L3,23C1.903,23 1,22.098 1,21C1,20.865 1.014,20.73 1.042,20.598C1.049,20.562 1.058,20.526 1.07,20.491L2.118,17.25C2.148,17.078 2.132,16.901 2.073,16.738ZM3.892,15.906C3.892,15.907 3.893,15.907 3.893,15.908C3.903,15.929 3.913,15.951 3.922,15.973C3.922,15.974 3.922,15.975 3.923,15.976C4.142,16.532 4.191,17.14 4.063,17.724C4.056,17.755 4.047,17.786 4.037,17.817L3.01,20.991C3.019,20.991 3.024,20.992 3.02,20.994L6.389,20.009C6.418,20.001 6.446,19.994 6.475,19.988C7.027,19.879 7.598,19.927 8.124,20.126C8.147,20.135 8.17,20.144 8.192,20.155C9.384,20.712 10.684,21 12,21C16.938,21 21,16.938 21,12C21,7.063 16.938,3 12,3C7.063,3 3,7.063 3,12C3,13.353 3.305,14.688 3.892,15.906Z"/></g></svg>`;

type StudyAssistantApiKeys = SproutSettings["studyAssistant"]["apiKeys"];

/**
 * Maps each configuration file in `configuration/` to the settings key(s) it
 * persists. Single-key entries store the value directly; multi-key entries
 * store a wrapper object `{ key1: {...}, key2: {...} }`.
 * `api-keys.json` is handled separately for backward compatibility.
 */
const SETTINGS_CONFIG_FILES: ReadonlyArray<{
  readonly file: string;
  readonly keys: readonly (keyof SproutSettings)[];
}> = [
  { file: "general.json", keys: ["general"] },
  { file: "study.json", keys: ["study"] },
  { file: "assistant.json", keys: ["studyAssistant"] },
  { file: "reminders.json", keys: ["reminders"] },
  { file: "scheduling.json", keys: ["scheduling"] },
  { file: "indexing.json", keys: ["indexing"] },
  { file: "cards.json", keys: ["cards", "imageOcclusion"] },
  { file: "reading-view.json", keys: ["readingView"] },
  { file: "storage.json", keys: ["storage"] },
  { file: "audio.json", keys: ["audio"] },
];

export default class SproutPlugin extends Plugin {
  settings!: SproutSettings;
  store!: IStore;
  _bc: unknown;

  private _basecoatStarted = false;

  // Save mutex to prevent concurrent read-modify-write races
  private _saving: Promise<void> | null = null;

  // Shared wide mode state across all views
  isWideMode = false;

  readonly DEFAULT_SETTINGS: SproutSettings = DEFAULT_SETTINGS;

  // Ribbon icons (desktop + mobile)
  private _ribbonEls: HTMLElement[] = [];

  // Hide Obsidian global status bar when these views are active
  private readonly _hideStatusBarViewTypes = new Set<string>([
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_HOME,
    VIEW_TYPE_SETTINGS,
    // If you also want it hidden in the sidebar widget, uncomment:
    // VIEW_TYPE_WIDGET,
  ]);

  // What's New modal state
  private _whatsNewModalContainer: HTMLElement | null = null;
  private _whatsNewModalRoot: ReactRoot | null = null;

  // Sprout-scoped zoom (only Sprout leaves + widget, never other plugins)
  private _sproutZoomValue = 1;
  private _sproutZoomSaveTimer: number | null = null;

  private _disposeTooltipPositioner: (() => void) | null = null;
  private _reminderEngine: ReminderEngine | null = null;
  private _assistantPopup: SproutAssistantPopup | null = null;
  private _readingViewRefreshTimer: number | null = null;
  private _readingModeWatcherInterval: number | null = null;
  private readonly _markdownLeafModeSnapshot = new WeakMap<WorkspaceLeaf, "source" | "preview">();
  private readonly _markdownLeafContentSnapshot = new WeakMap<WorkspaceLeaf, string>();
  private readonly _reminderDevConsoleCommandNames = [
    "sproutReminderLaunch",
    "sproutReminderRoutine",
    "sproutReminderGatekeeper",
  ] as const;

  private readonly _refreshableViewTypes = [
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_WIDGET,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_HOME,
    VIEW_TYPE_SETTINGS,
  ];

  private _addCommand(
    id: string,
    name: string,
    callback: () => void | Promise<void>,
  ) {
    this.addCommand({ id, name, callback });
  }

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  refreshAssistantPopupFromSettings(): void {
    const activeFile = this.app.workspace.getActiveFile();
    this._assistantPopup?.onActiveLeafChange();
    this._assistantPopup?.onFileOpen(activeFile);
    if (!this.settings?.studyAssistant?.enabled) {
      this._closeAllAssistantWidgetInstances();
    }
  }

  private _closeAllAssistantWidgetInstances(): void {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
      .forEach((leaf) => {
        try {
          leaf.detach();
        } catch (e) {
          log.swallow("close assistant widget leaf", e);
        }
      });
  }

  private _registerCommands() {
    this._addCommand("sync-flashcards-current-note", "Sync flashcards from current note", async () => this._runSyncCurrentNote());
    this._addCommand("sync-flashcards", "Sync all flashcards from the vault", async () => this._runSync());
    this._addCommand("open", "Open home", async () => this.openHomeTab());
    this._addCommand("open-widget", "Open flashcard study widget", async () => this.openWidgetSafe());
    this.addCommand({
      id: "open-assistant-widget",
      name: "Open learning assistant widget",
      checkCallback: (checking) => {
        if (!this.settings?.studyAssistant?.enabled) return false;
        if (!checking) void this.openAssistantWidgetSafe();
        return true;
      },
    });
    this._addCommand("open-analytics", "Open analytics", async () => this.openAnalyticsTab());
    this._addCommand("open-settings", "Open plugin settings", () => this.openPluginSettingsInObsidian());
    this._addCommand("open-guide", "Open guide", async () => this.openSettingsTab(false, "guide"));
    this._addCommand("edit-flashcards", "Edit flashcards", async () => this.openBrowserTab());
    this._addCommand("new-study-session", "New study session", async () => this.openReviewerTab());

    const flashcardCommands: Array<{ id: string; name: string; type: FlashcardType }> = [
      { id: "add-basic-flashcard", name: "Add basic flashcard to note", type: "basic" },
      { id: "add-basic-reversed-flashcard", name: "Add basic (reversed) flashcard to note", type: "reversed" },
      { id: "add-cloze-flashcard", name: "Add cloze flashcard to note", type: "cloze" },
      { id: "add-multiple-choice-flashcard", name: "Add multiple choice flashcard to note", type: "mcq" },
      { id: "add-ordered-question-flashcard", name: "Add ordered question flashcard to note", type: "oq" },
      { id: "add-image-occlusion-flashcard", name: "Add image occlusion flashcard to note", type: "io" },
    ];

    for (const command of flashcardCommands) {
      this._addCommand(command.id, command.name, () => this.openAddFlashcardModal(command.type));
    }

    this._addCommand("import-anki", "Import from Anki (.apkg)", async () => {
      const { AnkiImportModal } = await import("./platform/modals/anki-import-modal");
      new AnkiImportModal(this).open();
    });

    this._addCommand("export-anki", "Export to Anki (.apkg)", async () => {
      const { AnkiExportModal } = await import("./platform/modals/anki-export-modal");
      new AnkiExportModal(this).open();
    });
  }

  private async _openSingleTabView(viewType: string, forceNew = false): Promise<WorkspaceLeaf> {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(viewType);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return existing;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: viewType, active: true });
    void this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private _initBasecoatRuntime() {
    const bc = getBasecoatApi();
    if (!bc) {
      log.warn(`Basecoat API not found on window.basecoat (dropdowns may not work).`);
      return;
    }

    try {
      // Patch known null-dereference issues in bundled Basecoat runtime before init/start.
      patchBasecoatNullGuards(bc);

      // If hot-reloading or reloading the plugin, avoid multiple observers.
      bc.stop?.();

      // Initialize any already-rendered components (Obsidian loads long after DOMContentLoaded).
      bc.initAll?.();

      // Start observing future DOM changes (for views created later).
      // Mobile page transitions can expose transient/partial DOM nodes that
      // trigger noisy Basecoat runtime errors; keep observer desktop-only.
      if (!Platform.isMobileApp) {
        bc.start?.();
        this._basecoatStarted = true;
      } else {
        this._basecoatStarted = false;
      }

      (this as unknown as { _basecoatApi: unknown })._basecoatApi = bc;
      log.info(`Basecoat initAll OK${Platform.isMobileApp ? " (observer disabled on mobile)" : " + start OK"}`);
    } catch (e) {
      log.warn(`Basecoat init failed`, e);
    }
  }

  private _stopBasecoatRuntime() {
    if (!this._basecoatStarted) return;
    try {
      const bc = getBasecoatApi();
      bc?.stop?.();
    } catch (e) { log.swallow("stop basecoat runtime", e); }
    this._basecoatStarted = false;
  }

  private _isActiveHiddenViewType(): boolean {
    const ws = this.app.workspace;
    const activeLeaf = ws?.getMostRecentLeaf?.() ?? null;
    const viewType = activeLeaf?.view?.getViewType?.();
    return viewType ? this._hideStatusBarViewTypes.has(viewType) : false;
  }

  private _updateStatusBarVisibility(leaf: WorkspaceLeaf | null) {
    const viewType = leaf?.view?.getViewType?.();
    const hide = viewType
      ? this._hideStatusBarViewTypes.has(viewType)
      : this._isActiveHiddenViewType();
    document.body.classList.toggle("sprout-hide-status-bar", hide);
  }

  /** Migrate legacy settings keys (delegates to settings-migration module). */
  private _migrateSettingsInPlace() {
    migrateSettingsInPlace(this.settings as Record<string, unknown>);
  }

  /** Normalise settings (delegates to settings-normalisation module). */
  private _normaliseSettingsInPlace() {
    normaliseSettingsInPlace(this.settings);
  }

  // ── Sprout-scoped pinch zoom ───────────────────────────────────────────────

  private _applySproutZoom(value: number) {
    const next = clamp(Number(value || 1), 0.8, 1.8);
    this._sproutZoomValue = next;
    document.body.style.setProperty("--sprout-leaf-zoom", next.toFixed(3));
  }

  private _queueSproutZoomSave() {
    if (this._sproutZoomSaveTimer != null) window.clearTimeout(this._sproutZoomSaveTimer);
    this._sproutZoomSaveTimer = window.setTimeout(() => {
      this._sproutZoomSaveTimer = null;
      void this.saveAll();
    }, 250);
  }

  /**
   * Register a Ctrl+Scroll / trackpad-pinch listener that only fires inside
   * Sprout-owned views (`.workspace-leaf-content.sprout` or `.sprout-widget.sprout`).
   * Events over non-Sprout leaves pass through untouched.
   */
  private _registerSproutPinchZoom() {
    this._applySproutZoom(this.settings.general.workspaceContentZoom ?? 1);

    this.registerDomEvent(
      document,
      "wheel",
      (ev: WheelEvent) => {
        if (!ev.ctrlKey) return;

        const target = ev.target as HTMLElement | null;
        if (!target) return;

        // Don't intercept inside modals, menus, popovers, or suggestion lists
        if (target.closest(".modal-container, .menu, .popover, .suggestion-container")) return;

        // Only intercept within Sprout-owned leaves or the Sprout widget
        const sproutEl = target.closest<HTMLElement>(
          ".workspace-leaf-content.sprout, .sprout-widget.sprout",
        );
        if (!sproutEl) return;

        ev.preventDefault();
        ev.stopPropagation();

        const factor = Math.exp(-ev.deltaY * 0.006);
        const next = clamp(this._sproutZoomValue * factor, 0.8, 1.8);
        if (Math.abs(next - this._sproutZoomValue) < 0.001) return;

        this._applySproutZoom(next);
        this.settings.general.workspaceContentZoom = Number(next.toFixed(3));
        this._queueSproutZoomSave();
      },
      { capture: true, passive: false },
    );
  }

  /**
   * Ensures exactly one leaf exists for a given view type.
   * If multiple exist, detaches the extras and returns the kept leaf.
   */
  private _ensureSingleLeafOfType(viewType: string): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (!leaves.length) return null;

    const [keep, ...extras] = leaves;

    for (const l of extras) {
      try {
        l.detach();
      } catch (e) { log.swallow("detach extra leaf", e); }
    }

    return keep;
  }

  async onload() {
    try {
      // ✅ IMPORTANT: Basecoat runtime init for Obsidian (DOMContentLoaded already happened)
      this._initBasecoatRuntime();

      // Initialize tooltip positioner for dynamic positioning
      this._disposeTooltipPositioner?.();
      this._disposeTooltipPositioner = initTooltipPositioner();

      // Ensure all buttons use `aria-label` and never rely on native `title` tooltips.
      this.register(initButtonTooltipDefaults());

      // Initialize mobile keyboard handler for adaptive bottom padding
      initMobileKeyboardHandler();

      this._bc = {
        VIEW_TYPE_REVIEWER,
        VIEW_TYPE_WIDGET,
        VIEW_TYPE_BROWSER,
        VIEW_TYPE_ANALYTICS,
        VIEW_TYPE_HOME,
        VIEW_TYPE_SETTINGS,
        BRAND,
        DEFAULT_SETTINGS,
        deepMerge,
        SproutReviewerView,
        SproutWidgetView,
        SproutCardBrowserView,
        SproutAnalyticsView,
        SproutHomeView,
        SproutSettingsView,
        SproutSettingsTab,
        syncQuestionBank,
        CardCreatorModal,
        ParseErrorModal,
      };

      const root = (await this.loadData()) as unknown;
      const rootObj = isPlainObject(root) ? root : {};
      const rootSettings = isPlainObject(rootObj.settings)
        ? (rootObj.settings as Partial<SproutSettings>)
        : {};
      this.settings = deepMerge(DEFAULT_SETTINGS, rootSettings);
      await this._loadSettingsFromConfigFiles();
      this._migrateSettingsInPlace();
      this._normaliseSettingsInPlace();
      await this._initialiseDedicatedApiKeyStorage();
      this._registerSproutPinchZoom();

      // Activate the user's chosen delimiter before any parsing occurs
      setDelimiter(this.settings.indexing.delimiter ?? "|");

      const hasSqlite = await isSqliteDatabasePresent(this);
      const hasLegacyStore = isPlainObject(rootObj.store);

      if (hasSqlite) {
        const sqliteStore = new SqliteStore(this);
        await sqliteStore.open();
        this.store = sqliteStore;
      } else if (hasLegacyStore) {
        const migrated = await migrateJsonToSqlite(this, rootObj);
        if (migrated) {
          const sqliteStore = new SqliteStore(this);
          await sqliteStore.open();
          this.store = sqliteStore;
        } else {
          this.store = new JsonStore(this);
          this.store.load(rootObj);
        }
      } else {
        const sqliteStore = new SqliteStore(this);
        await sqliteStore.open();
        this.store = sqliteStore;
      }

      this._reminderEngine = new ReminderEngine(this);
      this._registerReminderDevConsoleCommands();

      // Load version tracking from data.json
      loadVersionTracking(rootObj);

      if (!(this.store instanceof SqliteStore) && !this.store.loadedFromDisk && isPlainObject(root)) {
        log.warn(
          "data.json existed but contained no .store — " +
          "initial save will be guarded by assessPersistSafety.",
        );
      }

      registerReadingViewPrettyCards(this);

      this.registerView(VIEW_TYPE_REVIEWER, (leaf) => new SproutReviewerView(leaf, this));
      this.registerView(VIEW_TYPE_WIDGET, (leaf) => new SproutWidgetView(leaf, this));
      this.registerView(VIEW_TYPE_STUDY_ASSISTANT, (leaf) => new SproutStudyAssistantView(leaf, this));
      this.registerView(VIEW_TYPE_BROWSER, (leaf) => new SproutCardBrowserView(leaf, this));
      this.registerView(VIEW_TYPE_ANALYTICS, (leaf) => new SproutAnalyticsView(leaf, this));
      this.registerView(VIEW_TYPE_HOME, (leaf) => new SproutHomeView(leaf, this));
      this.registerView(VIEW_TYPE_SETTINGS, (leaf) => new SproutSettingsView(leaf, this));

      this.addSettingTab(new SproutSettingsTab(this.app, this));

      // Commands (hotkeys default to none; users can bind in Settings → Hotkeys)
      this._registerCommands();

      // Register custom branded ribbon icon from site/branding/Sprout Icon.svg artwork.
      addIcon(SPROUT_BRAND_ICON_KEY, SPROUT_RIBBON_BRAND_ICON);
      addIcon(SPROUT_WIDGET_STUDY_ICON_KEY, SPROUT_STUDY_WIDGET_ICON);
      addIcon(SPROUT_WIDGET_ASSISTANT_ICON_KEY, SPROUT_ASSISTANT_WIDGET_ICON);

      // Replace dropdown with separate ribbon icons (desktop + mobile)
      this._registerRibbonIcons();
      this._registerEditorContextMenu();
      this._registerMarkdownSourceClozeShortcuts();

      // Hide status bar when Sprout views are active
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => {
          this._updateStatusBarVisibility(leaf ?? null);
          this._assistantPopup?.onActiveLeafChange();
        }),
      );

      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          const f = file instanceof TFile ? file : null;
          this._assistantPopup?.onFileOpen(f);
          this.app.workspace
            .getLeavesOfType(VIEW_TYPE_WIDGET)
            .forEach((leaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
          this.app.workspace
            .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
            .forEach((leaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
        }),
      );

      // Rename assistant chat files when notes are renamed
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (file instanceof TFile && file.path.toLowerCase().endsWith(".md")) {
            void this._assistantPopup?.onFileRename(oldPath, file);
          }
        }),
      );

      this.app.workspace.onLayoutReady(() => {
        // Ensure status bar class matches the active view after layout settles
        this._updateStatusBarVisibility(null);

        // Check for version upgrades and show What's New modal if needed
        this._checkAndShowWhatsNewModal();

        if (this.settings?.general?.showLaunchNoticeModal ?? true) {
          new LaunchNoticeModal(this.app, this).open();
        }

        // Mount per-leaf assistant popup triggers
        this._assistantPopup = new SproutAssistantPopup(this);
        this._assistantPopup.mount();
        this._assistantPopup.onActiveLeafChange();
        this.refreshAssistantPopupFromSettings();
        this._startMarkdownModeWatcher();

        this._reminderEngine?.start();
      });

      await this.saveAll();
      void this.refreshGithubStars();
      log.info(`loaded`);
    } catch (e) {
      log.error(`failed to load`, e);
      new Notice(this._tx("ui.main.notice.loadFailed", "Failed to load. See console for details."));
    }
  }

  onunload() {
    // Best-effort save: await pending save, then fire one last save.
    // Obsidian calls onunload synchronously so we can't truly await,
    // but we kick it off so the microtask completes before the process exits.
    const pending = this._saving ?? Promise.resolve();
    void pending
      .then(() => this._doSave())
      .catch((e) => log.swallow("save all on unload", e));

    if (this.store instanceof SqliteStore) {
      void this.store.close().catch((e) => log.swallow("close sqlite store", e));
    }

    this._bc = null;
    this._destroyRibbonIcons();
    document.body.classList.remove("sprout-hide-status-bar");
    document.body.style.removeProperty("--sprout-leaf-zoom");
    if (this._sproutZoomSaveTimer != null) {
      window.clearTimeout(this._sproutZoomSaveTimer);
      this._sproutZoomSaveTimer = null;
    }
    if (this._readingViewRefreshTimer != null) {
      window.clearTimeout(this._readingViewRefreshTimer);
      this._readingViewRefreshTimer = null;
    }
    if (this._readingModeWatcherInterval != null) {
      window.clearInterval(this._readingModeWatcherInterval);
      this._readingModeWatcherInterval = null;
    }

    this._disposeTooltipPositioner?.();
    this._disposeTooltipPositioner = null;
    this._unregisterReminderDevConsoleCommands();
    this._reminderEngine?.stop();
    this._reminderEngine = null;

    // Clean up What's New modal
    this._closeWhatsNewModal();

    // Tear down reading-view observers + window listeners
    teardownReadingView();

    // Remove global AOS error suppression handler
    removeAosErrorHandler();

    // Clean up mobile keyboard handler
    cleanupMobileKeyboardHandler();

    // Clean up floating assistant popup
    this._assistantPopup?.destroy();
    this._assistantPopup = null;

    // ✅ stop Basecoat observer on unload (helps plugin reload / dev)
    this._stopBasecoatRuntime();
  }

  private _destroyRibbonIcons() {
    for (const el of this._ribbonEls) {
      try {
        el.remove();
      } catch (e) { log.swallow("remove ribbon icon", e); }
    }
    this._ribbonEls = [];
  }

  /**
   * Check if the plugin was upgraded and show the What's New modal if needed.
   */
  private _checkAndShowWhatsNewModal() {
    try {
      const currentVersion = this.manifest.version;
      const { shouldShow, version } = checkForVersionUpgrade(currentVersion);
      
      if (shouldShow && version && hasReleaseNotes(version)) {
        this._showWhatsNewModal(version);
      }
    } catch (e) {
      log.swallow("check version upgrade", e);
    }
  }

  /**
   * Display the What's New modal for a specific version.
   */
  private _showWhatsNewModal(version: string) {
    // Clean up any existing modal
    this._closeWhatsNewModal();

    // Create modal container
    const container = document.body.createDiv();
    this._whatsNewModalContainer = container;

    // Create React root and render modal
    const root = createRoot(container);
    this._whatsNewModalRoot = root;

    const modalElement = React.createElement(WhatsNewModal, {
      version,
      onClose: () => this._closeWhatsNewModal(),
    });
    
    root.render(modalElement);
  }

  /**
   * Close and clean up the What's New modal.
   */
  private _closeWhatsNewModal() {
    if (this._whatsNewModalRoot) {
      this._whatsNewModalRoot.unmount();
      this._whatsNewModalRoot = null;
    }
    if (this._whatsNewModalContainer) {
      this._whatsNewModalContainer.remove();
      this._whatsNewModalContainer = null;
    }
  }

  _getActiveMarkdownFile(): TFile | null {
    const f = this.app.workspace.getActiveFile();
    return f instanceof TFile ? f : null;
  }

  private _ensureEditingNoteEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    if (view.getMode() !== "source") return null;
    const editor = view.editor;
    if (!editor) return null;
    return { view, editor };
  }

  private _applyClozeShortcutToEditor(editor: Editor, clozeIndex = 1) {
    const selection = String(editor.getSelection?.() ?? "");
    const tokenStart = `{{c${clozeIndex}::`;

    if (selection.length > 0) {
      editor.replaceSelection(`${tokenStart}${selection}}}`);
      return;
    }

    const cursor = editor.getCursor();
    editor.replaceSelection(`{{c${clozeIndex}::}}`);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + tokenStart.length });
  }

  private _registerMarkdownSourceClozeShortcuts() {
    this.registerDomEvent(
      document,
      "keydown",
      (ev: KeyboardEvent) => {
        const key = String(ev.key || "").toLowerCase();
        if (key !== "c" && ev.code !== "KeyC") return;

        const primary = Platform.isMacOS ? ev.metaKey : ev.ctrlKey;
        if (!primary || !ev.shiftKey) return;

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== "source" || !view.editor) return;

        const target = ev.target as HTMLElement | null;
        if (!target) return;
        if (!view.contentEl?.contains(target)) return;
        if (!target.closest(".cm-editor")) return;

        ev.preventDefault();
        ev.stopPropagation();
        this._applyClozeShortcutToEditor(view.editor, 1);
      },
      { capture: true },
    );
  }

  openAddFlashcardModal(forcedType?: FlashcardType) {
    const ok = this._ensureEditingNoteEditor();
    if (!ok) {
      new Notice(this._tx("ui.main.notice.mustEditNote", "Must be editing a note to add a flashcard"));
      return;
    }

    if (forcedType === "io") {
      new ImageOcclusionCreatorModal(this.app, this).open();
    } else {
      new CardCreatorModal(this.app, this, forcedType).open();
    }
  }

  // -----------------------
  // Editor right-click menu
  // -----------------------

  private _registerEditorContextMenu() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, _editor, view) => {
        if (!(view instanceof MarkdownView)) return;

        const mode = view.getMode();
        if (mode !== "source") return;

        if (!(view.file instanceof TFile)) return;

        // Add the item with submenu
        let itemDom: HTMLElement | null = null;

        menu.addItem((item) => {
          item.setTitle(this._tx("ui.main.menu.addFlashcard", "Add flashcard")).setIcon("plus");

          // Create submenu
          const submenu = item.setSubmenu?.();
          if (submenu) {
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.basic", "Basic")).setIcon("file-text").onClick(() => this.openAddFlashcardModal("basic"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.basicReversed", "Basic (reversed)")).setIcon("file-text").onClick(() => this.openAddFlashcardModal("reversed"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.cloze", "Cloze")).setIcon("file-minus").onClick(() => this.openAddFlashcardModal("cloze"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.multipleChoice", "Multiple choice")).setIcon("list").onClick(() => this.openAddFlashcardModal("mcq"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.orderedQuestion", "Ordered question")).setIcon("list-ordered").onClick(() => this.openAddFlashcardModal("oq"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.imageOcclusion", "Image occlusion")).setIcon("image").onClick(() => this.openAddFlashcardModal("io"));
            });
          }

          itemDom = item?.dom ?? null;
        });

        const positionAfterExternalLink = () => {
          try {
            const menuDom: HTMLElement | null = menu?.dom ?? null;
            if (!menuDom || !itemDom) return;

            let node: HTMLElement | null = itemDom;
            while (node && node.parentElement && node.parentElement !== menuDom) {
              node = node.parentElement;
            }
            if (!node || node.parentElement !== menuDom) return;

            // Find "Add external link" menu item
            const menuItems = Array.from(menuDom.children);
            let externalLinkItem: Element | null = null;

            for (const item of menuItems) {
              const titleEl = queryFirst(item, ".menu-item-title");
              if (titleEl && titleEl.textContent?.includes("Add external link")) {
                externalLinkItem = item;
                break;
              }
            }

            // Position after external link, or at top if not found
            if (externalLinkItem && externalLinkItem.nextSibling) {
              menuDom.insertBefore(node, externalLinkItem.nextSibling);
            } else if (externalLinkItem) {
              menuDom.appendChild(node);
            } else {
              // Fallback: insert after first item (likely "Add link")
              if (menuDom.children.length > 1 && menuDom.children[1]) {
                menuDom.insertBefore(node, menuDom.children[1]);
              }
            }
          } catch (e) { log.swallow("reposition menu item", e); }
        };

        positionAfterExternalLink();
        setTimeout(positionAfterExternalLink, 0);
      }),
    );
  }

  public async syncBank(): Promise<void> {
    await this._runSync();
  }

  public refreshAllViews(): void {
    this._refreshOpenViews();
  }

  public notifyWidgetCardsSynced(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET).forEach((leaf) => {
      const view = leaf.view as ItemView & { onCardsSynced?(): void; onRefresh?(): void };
      if (typeof view.onCardsSynced === "function") {
        view.onCardsSynced();
        return;
      }
      view.onRefresh?.();
    });
  }

  public async refreshReadingViewMarkdownLeaves(): Promise<void> {
    const leaves = this.app.workspace
      .getLeavesOfType("markdown")
      .filter((leaf) => this._isMainWorkspaceMarkdownLeaf(leaf));
    await Promise.all(leaves.map(async (leaf) => {
      const container = leaf.view?.containerEl ?? null;
      if (!(container instanceof HTMLElement)) return;

      const content = queryFirst(
        container,
        ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
      );
      if (!(content instanceof HTMLElement)) return;

      const scrollHost =
        content.closest(".markdown-reading-view, .markdown-preview-view, .markdown-rendered") ??
        content;
      const prevTop = Number(scrollHost.scrollTop || 0);
      const prevLeft = Number(scrollHost.scrollLeft || 0);
      const sourcePayload = await this._getMarkdownLeafSource(leaf);

      try {
        content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
          bubbles: true,
          detail: sourcePayload,
        }));
      } catch (e) {
        log.swallow("dispatch reading view refresh", e);
      }

      const view = leaf.view;
      if (view instanceof MarkdownView && view.getMode?.() === "preview") {
        try {
          view.previewMode?.rerender?.();
        } catch (e) {
          log.swallow("rerender markdown preview", e);
        }
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          try {
            scrollHost.scrollTo({ top: prevTop, left: prevLeft });
          } catch {
            scrollHost.scrollTop = prevTop;
            scrollHost.scrollLeft = prevLeft;
          }

          try {
            content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
              bubbles: true,
              detail: sourcePayload,
            }));
          } catch (e) {
            log.swallow("dispatch reading view refresh (post-rerender)", e);
          }
        });
      });
    }));
  }

  private _scheduleReadingViewRefresh(delayMs = 90): void {
    if (this._readingViewRefreshTimer != null) {
      window.clearTimeout(this._readingViewRefreshTimer);
      this._readingViewRefreshTimer = null;
    }

    this._readingViewRefreshTimer = window.setTimeout(() => {
      this._readingViewRefreshTimer = null;
      try {
        void this.refreshReadingViewMarkdownLeaves();
      } catch (e) {
        log.swallow("schedule reading view refresh", e);
      }
    }, Math.max(0, Number(delayMs) || 0));
  }

  private _isMainWorkspaceMarkdownLeaf(leaf: WorkspaceLeaf): boolean {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return false;

    const container = view.containerEl;
    if (!(container instanceof HTMLElement)) return false;

    // Ignore leaves docked in sidebars; only central note workspace leaves
    // should drive reading refresh scheduling.
    const inSidebar = !!container.closest(
      ".workspace-split.mod-left-split, .workspace-split.mod-right-split",
    );

    return !inSidebar;
  }

  private _computeContentSignature(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  }

  private async _getMarkdownLeafSource(leaf: WorkspaceLeaf): Promise<{ sourceContent: string; sourcePath: string }> {
    try {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return { sourceContent: "", sourcePath: "" };

      const sourcePath = view.file instanceof TFile ? view.file.path : "";
      const mode = view.getMode?.();
      if (mode === "source") {
        const liveViewData =
          typeof (view as unknown as { getViewData?: () => string }).getViewData === "function"
            ? String((view as unknown as { getViewData: () => string }).getViewData() ?? "")
            : "";

        if (liveViewData.trim()) {
          return { sourceContent: liveViewData, sourcePath };
        }
      }

      if (view.file instanceof TFile && view.file.extension === "md") {
        const fileContent = await this.app.vault.read(view.file);
        return { sourceContent: String(fileContent ?? ""), sourcePath };
      }
    } catch (e) {
      log.swallow("get markdown leaf source", e);
    }

    return { sourceContent: "", sourcePath: "" };
  }

  private _startMarkdownModeWatcher(): void {
    if (this._readingModeWatcherInterval != null) return;

    const scanModes = () => {
      try {
        const leaves = this.app.workspace
          .getLeavesOfType("markdown")
          .filter((leaf) => this._isMainWorkspaceMarkdownLeaf(leaf));
        let sawModeChange = false;

        for (const leaf of leaves) {
          const view = leaf.view;
          if (!(view instanceof MarkdownView)) continue;

          const mode = view.getMode?.();
          if (mode !== "source" && mode !== "preview") continue;

          const prev = this._markdownLeafModeSnapshot.get(leaf);
          if (prev !== mode) {
            this._markdownLeafModeSnapshot.set(leaf, mode);
            // Ignore first-seen snapshot to avoid startup noise.
            if (prev) sawModeChange = true;
          }

          // Track source text changes as well, so field edits (including
          // multi-line blocks) in source mode trigger reading refresh.
          const sourcePath = view.file instanceof TFile ? view.file.path : "";
          const liveViewData =
            typeof (view as unknown as { getViewData?: () => string }).getViewData === "function"
              ? String((view as unknown as { getViewData: () => string }).getViewData() ?? "")
              : "";
          const signature = `${sourcePath}|${this._computeContentSignature(liveViewData)}`;
          const prevSignature = this._markdownLeafContentSnapshot.get(leaf);
          if (prevSignature !== signature) {
            this._markdownLeafContentSnapshot.set(leaf, signature);
            if (prevSignature) sawModeChange = true;
          }
        }

        if (sawModeChange) {
          this._scheduleReadingViewRefresh(40);
        }
      } catch (e) {
        log.swallow("scan markdown mode changes", e);
      }
    };

    // Prime snapshots before starting interval.
    scanModes();
    this._readingModeWatcherInterval = window.setInterval(scanModes, 180);
    this.registerInterval(this._readingModeWatcherInterval);
  }

  async _runSync() {
    const res = await syncQuestionBank(this);

    const notice = formatSyncNotice("Sync complete", res, { includeDeleted: true });
    new Notice(notice);

    const tagsDeleted = Number((res as { tagsDeleted?: number }).tagsDeleted ?? 0);
    if (tagsDeleted > 0) {
      new Notice(this._tx("ui.main.notice.deletedUnusedTags", "Deleted {count}, unused tag{suffix}", {
        count: tagsDeleted,
        suffix: tagsDeleted === 1 ? "" : "s",
      }));
    }

    if (res.quarantinedCount > 0) {
      new ParseErrorModal(this.app, this, res.quarantinedIds).open();
    }
    this.notifyWidgetCardsSynced();
  }

  private _formatCurrentNoteSyncNotice(pageTitle: string, res: { newCount?: number; updatedCount?: number; removed?: number }): string {
    const updated = Number(res.updatedCount ?? 0);
    const created = Number(res.newCount ?? 0);
    const deleted = Number(res.removed ?? 0);
    const parts: string[] = [];

    if (updated > 0) parts.push(`${updated} updated`);
    if (created > 0) parts.push(`${created} new`);
    if (deleted > 0) parts.push(`${deleted} deleted`);

    if (parts.length === 0) return `Flashcards updated for page: ${pageTitle}: no changes.`;
    return `Flashcards updated for page: ${pageTitle}: ${parts.join(", ")}.`;
  }

  async _runSyncCurrentNote() {
    const file = this._getActiveMarkdownFile();
    if (!(file instanceof TFile)) {
      new Notice("No note is open.");
      return;
    }

    const res = await syncOneFile(this, file, { pruneGlobalOrphans: false });
    new Notice(this._formatCurrentNoteSyncNotice(file.basename, res));

    if (res.quarantinedCount > 0) {
      new ParseErrorModal(this.app, this, res.quarantinedIds).open();
    }

    this.notifyWidgetCardsSynced();
  }

  async saveAll() {
    // Queue through mutex to prevent concurrent read-modify-write races
    while (this._saving) await this._saving;
    this._saving = this._doSave();
    try { await this._saving; } finally { this._saving = null; }
  }

  private _getDataJsonPath(): string | null {
    const configDir = this.app?.vault?.configDir;
    const pluginId = this.manifest?.id;
    if (!configDir || !pluginId) return null;
    return joinPath(configDir, "plugins", pluginId, "data.json");
  }

  private _getConfigDirPath(): string | null {
    const configDir = this.app?.vault?.configDir;
    const pluginId = this.manifest?.id;
    if (!configDir || !pluginId) return null;
    return joinPath(configDir, "plugins", pluginId, "configuration");
  }

  private _getConfigFilePath(filename: string): string | null {
    const dir = this._getConfigDirPath();
    return dir ? joinPath(dir, filename) : null;
  }

  private _getApiKeysFilePath(): string | null {
    return this._getConfigFilePath("api-keys.json");
  }

  private _normaliseApiKeys(raw: unknown): StudyAssistantApiKeys {
    const obj = isPlainObject(raw) ? raw : {};
    const asApiKey = (value: unknown): string => {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value).trim();
      }
      return "";
    };
    return {
      openai: asApiKey(obj.openai),
      anthropic: asApiKey(obj.anthropic),
      deepseek: asApiKey(obj.deepseek),
      xai: asApiKey(obj.xai ?? obj.groq),
      google: asApiKey(obj.google),
      perplexity: asApiKey(obj.perplexity),
      openrouter: asApiKey(obj.openrouter),
      custom: asApiKey(obj.custom),
    };
  }

  private _hasAnyApiKey(apiKeys: StudyAssistantApiKeys): boolean {
    return Object.values(apiKeys).some((value) => String(value || "").trim().length > 0);
  }

  private _settingsWithoutApiKeys(): SproutSettings {
    const snapshot = clonePlain(this.settings);
    snapshot.studyAssistant.apiKeys = { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
    return snapshot;
  }

  private async _loadApiKeysFromDedicatedFile(): Promise<boolean> {
    const adapter = this.app?.vault?.adapter;
    const filePath = this._getApiKeysFilePath();
    if (!adapter || !filePath) return false;
    try {
      if (!(await adapter.exists(filePath))) return false;
      const raw = await adapter.read(filePath);
      const parsed = JSON.parse(raw) as unknown;
      this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(parsed);
      return true;
    } catch (e) {
      log.warn("Failed to read dedicated API key file; continuing with settings payload.", e);
      return false;
    }
  }

  private async _persistApiKeysToDedicatedFile(apiKeys: StudyAssistantApiKeys): Promise<boolean> {
    const adapter = this.app?.vault?.adapter;
    const dirPath = this._getConfigDirPath();
    const filePath = this._getApiKeysFilePath();
    if (!adapter || !dirPath || !filePath) return false;
    try {
      const hasAny = this._hasAnyApiKey(apiKeys);
      if (!hasAny) {
        if (await adapter.exists(filePath)) {
          await (adapter as { remove?: (path: string) => Promise<void> }).remove?.(filePath);
        }
        return true;
      }
      if (!(await adapter.exists(dirPath))) {
        await (adapter as { mkdir?: (path: string) => Promise<void> }).mkdir?.(dirPath);
      }
      await adapter.write(filePath, `${JSON.stringify(apiKeys, null, 2)}\n`);
      return true;
    } catch (e) {
      log.warn("Failed to write dedicated API key file.", e);
      return false;
    }
  }

  private async _initialiseDedicatedApiKeyStorage(): Promise<void> {
    this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
    const loadedFromDedicatedFile = await this._loadApiKeysFromDedicatedFile();
    if (loadedFromDedicatedFile) return;
    if (!this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) return;
    const migrated = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);
    if (migrated) log.info("Migrated study assistant API keys to configuration/api-keys.json");
  }

  // ── Generalised config-file persistence ─────────────────────────────

  /**
   * On startup, load each settings group from its dedicated config file.
   * Values are deep-merged into the already-initialised `this.settings`
   * so that new keys added in a version upgrade keep their defaults.
   */
  private async _loadSettingsFromConfigFiles(): Promise<void> {
    const adapter = this.app?.vault?.adapter;
    if (!adapter) return;

    for (const entry of SETTINGS_CONFIG_FILES) {
      const filePath = this._getConfigFilePath(entry.file);
      if (!filePath) continue;
      try {
        if (!(await adapter.exists(filePath))) continue;
        const raw = await adapter.read(filePath);
        const parsed = JSON.parse(raw) as unknown;
        if (!isPlainObject(parsed)) continue;

        const parsedObj = parsed;
        const s = this.settings as Record<string, unknown>;

        if (entry.keys.length === 1) {
          const key = entry.keys[0];
          s[key] = deepMerge(s[key] ?? {}, parsedObj);
        } else {
          for (const key of entry.keys) {
            if (isPlainObject(parsedObj[key])) {
                s[key] = deepMerge(s[key] ?? {}, parsedObj[key]);
            }
          }
        }
      } catch (e) {
        log.warn(`Failed to load config file ${entry.file}; using data.json/default values.`, e);
      }
    }
  }

  /**
   * Persist every settings group to its own config file inside
   * `configuration/`. Returns the set of settings keys that were
   * successfully written (so they can be stripped from data.json).
   */
  private async _persistSettingsToConfigFiles(): Promise<Set<keyof SproutSettings>> {
    const adapter = this.app?.vault?.adapter;
    const dirPath = this._getConfigDirPath();
    const written = new Set<keyof SproutSettings>();
    if (!adapter || !dirPath) return written;

    try {
      if (!(await adapter.exists(dirPath))) {
        await (adapter as { mkdir?: (path: string) => Promise<void> }).mkdir?.(dirPath);
      }
    } catch (e) {
      log.warn("Failed to create configuration directory.", e);
      return written;
    }

    for (const entry of SETTINGS_CONFIG_FILES) {
      const filePath = this._getConfigFilePath(entry.file);
      if (!filePath) continue;
      try {
        let payload: unknown;
        if (entry.keys.length === 1) {
          const key = entry.keys[0];
          let value = clonePlain((this.settings as Record<string, unknown>)[key]);
          // Strip API keys from assistant.json — they live in api-keys.json
          if (key === "studyAssistant" && isPlainObject(value)) {
            value.apiKeys = { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
          }
          payload = value;
        } else {
          const wrapper: Record<string, unknown> = {};
          for (const key of entry.keys) {
            wrapper[key] = clonePlain((this.settings as Record<string, unknown>)[key]);
          }
          payload = wrapper;
        }
        await adapter.write(filePath, `${JSON.stringify(payload, null, 2)}\n`);
        for (const key of entry.keys) written.add(key);
      } catch (e) {
        log.warn(`Failed to write config file ${entry.file}.`, e);
      }
    }
    return written;
  }

  private async _doSave() {
    if (this.store instanceof SqliteStore) {
      const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;

      this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
      const writtenKeys = await this._persistSettingsToConfigFiles();
      const apiKeyWriteOk = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);

      const fallbackSettings: Record<string, unknown> = {};
      const allKeys: (keyof SproutSettings)[] = [
        "general", "study", "studyAssistant", "reminders", "scheduling",
        "indexing", "cards", "imageOcclusion", "readingView", "storage", "audio",
      ];
      for (const key of allKeys) {
        if (!writtenKeys.has(key)) {
          fallbackSettings[key] = clonePlain((this.settings as Record<string, unknown>)[key]);
        }
      }

      if (!apiKeyWriteOk && this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
        log.error("API key dedicated file write failed; keys were NOT persisted this save.");
        new Notice("Sprout: failed to save API keys securely. Please check file permissions.", 8000);
      }

      if (fallbackSettings.studyAssistant && isPlainObject(fallbackSettings.studyAssistant)) {
        fallbackSettings.studyAssistant.apiKeys =
          { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
      }

      root.settings = Object.keys(fallbackSettings).length > 0 ? fallbackSettings : undefined;
      delete root.store;
      root.versionTracking = getVersionTrackingData();

      await this.saveData(root);
      await this.store.persist();
      return;
    }

    const adapter = this.app?.vault?.adapter ?? null;
    const dataPath = this._getDataJsonPath();
    const canStat = !!(adapter && dataPath);
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const mtimeBefore = canStat ? await safeStatMtime(adapter, dataPath) : 0;
      const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;

      // ── Persist-safety check ────────────────────────────────────────
      const diskStore = root?.store as Record<string, unknown> | undefined;
      const safety = this.store.assessPersistSafety(diskStore ?? null);

      if (!safety.allow) {
        log.warn(`_doSave: aborting — ${safety.reason}`);
        try { await createDataJsonBackupNow(this, "safety-before-empty-write"); } catch { /* best effort */ }
        return;
      }

      if (safety.backupFirst) {
        log.warn(`_doSave: ${safety.reason} Creating safety backup before writing.`);
        try { await createDataJsonBackupNow(this, "safety-regression"); } catch { /* best effort */ }
      }

      // ── Persist settings to dedicated config files ──────────────────
      this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
      const writtenKeys = await this._persistSettingsToConfigFiles();
      const apiKeyWriteOk = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);

      // Build the settings fallback for data.json: only include groups
      // whose config-file write failed, so data.json stays lean.
      const fallbackSettings: Record<string, unknown> = {};
      const allKeys: (keyof SproutSettings)[] = [
        "general", "study", "studyAssistant", "reminders", "scheduling",
        "indexing", "cards", "imageOcclusion", "readingView", "storage", "audio",
      ];
      for (const key of allKeys) {
        if (!writtenKeys.has(key)) {
          fallbackSettings[key] = clonePlain((this.settings as Record<string, unknown>)[key]);
        }
      }
      // If API key write failed, log a warning and notify the user — do NOT fall back to data.json
      if (!apiKeyWriteOk && this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
        log.error("API key dedicated file write failed; keys were NOT persisted this save.");
        new Notice("Sprout: failed to save API keys securely. Please check file permissions.", 8000);
      }
      if (fallbackSettings.studyAssistant && isPlainObject(fallbackSettings.studyAssistant)) {
        // Always strip real API keys from the data.json fallback
        fallbackSettings.studyAssistant.apiKeys =
          { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
      }

      root.settings = Object.keys(fallbackSettings).length > 0 ? fallbackSettings : undefined;
      root.store = this.store.data;
      root.versionTracking = getVersionTrackingData();

      if (canStat) {
        const mtimeBeforeWrite = await safeStatMtime(adapter, dataPath);
        if (mtimeBefore && mtimeBeforeWrite && mtimeBeforeWrite !== mtimeBefore) {
          // data.json changed during our read; retry with latest snapshot
          continue;
        }
      }

      await this.saveData(root);
      return;
    }

    // Last resort: write latest snapshot even if the file is churny.
    const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;
    this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
    const writtenKeys = await this._persistSettingsToConfigFiles();
    const apiKeyWriteOk = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);
    const fallbackSettings: Record<string, unknown> = {};
    const allKeys: (keyof SproutSettings)[] = [
      "general", "study", "studyAssistant", "reminders", "scheduling",
      "indexing", "cards", "imageOcclusion", "readingView", "storage", "audio",
    ];
    for (const key of allKeys) {
      if (!writtenKeys.has(key)) {
        fallbackSettings[key] = clonePlain((this.settings as Record<string, unknown>)[key]);
      }
    }
    if (!apiKeyWriteOk && this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
      log.error("API key dedicated file write failed; keys were NOT persisted this save.");
      new Notice("Sprout: failed to save API keys securely. Please check file permissions.", 8000);
    }
    if (fallbackSettings.studyAssistant && isPlainObject(fallbackSettings.studyAssistant)) {
      fallbackSettings.studyAssistant.apiKeys =
        { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
    }
    root.settings = Object.keys(fallbackSettings).length > 0 ? fallbackSettings : undefined;
    root.store = this.store.data;
    root.versionTracking = getVersionTrackingData();
    await this.saveData(root);
  }

  private _refreshOpenViews() {
    for (const type of this._refreshableViewTypes) {
      this.app.workspace.getLeavesOfType(type).forEach((leaf) => {
        const view = leaf.view as ItemView & { onRefresh?(): void };
        view.onRefresh?.();
      });
    }
  }

  async refreshGithubStars(force = false) {
    const s = this.settings;
    s.general ??= {} as SproutSettings["general"];
    s.general.githubStars ??= { count: null, fetchedAt: null };

    const lastAt = Number(s.general.githubStars.fetchedAt || 0);
    const staleMs = 6 * 60 * 60 * 1000;
    if (!force && lastAt && Date.now() - lastAt < staleMs) return;

    try {
      const res = await requestUrl({
        url: "https://api.github.com/repos/ctrlaltwill/sprout",
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
      });
      const json: unknown = res?.json;
      const jsonObj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      const countRaw = jsonObj?.stargazers_count;
      const count = Number(countRaw);
      if (Number.isFinite(count)) {
        s.general.githubStars.count = count;
        s.general.githubStars.fetchedAt = Date.now();
        await this.saveAll();
        this._refreshOpenViews();
      }
    } catch {
      // offline or rate-limited; keep last known value
    }
  }

  public async resetSettingsToDefaults(): Promise<void> {
    this.settings = clonePlain(DEFAULT_SETTINGS);
    this._normaliseSettingsInPlace();
    await this.saveAll();
    this._refreshOpenViews();
  }

  private _isCardStateLike(v: unknown): v is CardState {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;

    const stageOk =
      o.stage === "new" ||
      o.stage === "learning" ||
      o.stage === "review" ||
      o.stage === "relearning" ||
      o.stage === "suspended";

    if (!stageOk) return false;

    const numsOk =
      typeof o.due === "number" &&
      typeof o.scheduledDays === "number" &&
      typeof o.reps === "number" &&
      typeof o.lapses === "number" &&
      typeof o.learningStepIndex === "number";

    return numsOk;
  }

  private _resetCardStateMapInPlace(map: Record<string, unknown>, now: number): number {
    let count = 0;

    for (const [id, raw] of Object.entries(map)) {
      if (!this._isCardStateLike(raw)) continue;

      const prev: CardState = { id, ...(raw as Record<string, unknown>) } as CardState;
      map[id] = resetCardScheduling(prev, now);
      count++;
    }

    return count;
  }

  private _looksLikeCardStateMap(node: unknown): node is Record<string, unknown> {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return false;

    for (const v of Object.values(node)) {
      if (this._isCardStateLike(v)) return true;
    }
    return false;
  }

  async resetAllCardScheduling(): Promise<void> {
    const now = Date.now();
    let total = 0;

    const visited = new Set<object>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);

      if (this._looksLikeCardStateMap(node)) {
        total += this._resetCardStateMapInPlace(node, now);
      }

      for (const v of Object.values(node)) walk(v);
    };

    walk(this.store.data);

    await this.saveAll();
    this._refreshOpenViews();

    new Notice(this._tx("ui.main.notice.resetScheduling", "Reset scheduling for {count} cards.", { count: total }));
  }

  async resetAllAnalyticsData(): Promise<void> {
    // Clear analytics events and review log
    if (this.store.data.analytics) {
      this.store.data.analytics.events = [];
      this.store.data.analytics.seq = 0;
    }

    if (Array.isArray(this.store.data.reviewLog)) {
      this.store.data.reviewLog = [];
    }

    await this.saveAll();
    this._refreshOpenViews();

    new Notice(this._tx("ui.main.notice.analyticsCleared", "Analytics data cleared."));
  }

  async openReviewerTab(forceNew: boolean = false) {
    await this._openSingleTabView(VIEW_TYPE_REVIEWER, forceNew);
  }

  async openHomeTab(forceNew: boolean = false) {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_HOME);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return;
      }
    }

    // Fix: Open new tab after current active tab, then select it
    const ws = this.app.workspace;
    const activeLeaf = ws.getLeaf(false);
    const leaf = ws.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_HOME, active: true });
    // If possible, move the new tab after the active tab
    try {
      if (activeLeaf && activeLeaf !== leaf && typeof ws.moveLeaf === "function") {
        ws.moveLeaf(leaf, ws.getGroup(activeLeaf), (ws.getGroup(activeLeaf)?.index ?? 0) + 1);
      }
    } catch (e) { log.swallow("move leaf after active tab", e); }
    void ws.revealLeaf(leaf);
  }

  async openBrowserTab(forceNew: boolean = false) {
    await this._openSingleTabView(VIEW_TYPE_BROWSER, forceNew);
  }

  async openAnalyticsTab(forceNew: boolean = false) {
    await this._openSingleTabView(VIEW_TYPE_ANALYTICS, forceNew);
  }

  async openSettingsTab(forceNew: boolean = false, targetTab?: string) {
    const resolvedTargetTab = targetTab ?? "settings";

    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_SETTINGS);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        // Navigate to the target tab if specified
        const view = existing.view as SproutSettingsView | undefined;
        if (view && typeof view.navigateToTab === "function") {
          view.navigateToTab(resolvedTargetTab);
        }
        return;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_SETTINGS, active: true });
    void this.app.workspace.revealLeaf(leaf);

    // Navigate to the target tab after the view opens
    setTimeout(() => {
      const view = leaf.view as SproutSettingsView | undefined;
      if (view && typeof view.navigateToTab === "function") {
        view.navigateToTab(resolvedTargetTab);
      }
    }, 50);
  }

  openPluginSettingsInObsidian() {
    const settings = this.app.setting;
    if (!settings) {
      new Notice(this._tx("ui.main.notice.obsidianSettingsUnavailable", "Obsidian settings are unavailable."));
      return;
    }

    settings.open();
    const pluginId = this.manifest?.id || "sprout";

    try {
      if (typeof settings.openTabById === "function") settings.openTabById(pluginId);
      else if (typeof settings.openTab === "function") settings.openTab(pluginId);
    } catch (e) {
      log.warn("failed to open plugin settings tab", e);
    }
  }

  private async openWidgetSafe(): Promise<void> {
    try {
      await this.openWidget();
    } catch (e) {
      log.error(`failed to open widget`, e);
      new Notice(this._tx("ui.main.notice.widgetOpenFailed", "Failed to open widget. See console for details."));
    }
  }

  async openWidget() {
    const ws = this.app.workspace;
    let leaf: WorkspaceLeaf | null = ws.getRightLeaf(false);

    if (leaf) {
      ws.setActiveLeaf(leaf, { focus: false });
      leaf = ws.getLeaf(false) ?? leaf;
    } else {
      leaf = ws.getRightLeaf(true);
      if (leaf) ws.setActiveLeaf(leaf, { focus: false });
    }

    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_WIDGET, active: true, state: {} });
    void ws.revealLeaf(leaf);
  }

  private async openAssistantWidgetSafe(): Promise<void> {
    try {
      await this.openAssistantWidget();
    } catch (e) {
      log.error("failed to open assistant widget", e);
      new Notice(this._tx("ui.main.notice.assistantWidgetOpenFailed", "Failed to open assistant widget. See console for details."));
    }
  }

  async openAssistantWidget(): Promise<void> {
    const ws = this.app.workspace;
    let leaf: WorkspaceLeaf | null = ws.getRightLeaf(false);

    if (leaf) {
      ws.setActiveLeaf(leaf, { focus: false });
      leaf = ws.getLeaf(false) ?? leaf;
    } else {
      leaf = ws.getRightLeaf(true);
      if (leaf) ws.setActiveLeaf(leaf, { focus: false });
    }

    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_STUDY_ASSISTANT, active: true, state: {} });
    void ws.revealLeaf(leaf);
  }

  refreshReminderEngine() {
    this._reminderEngine?.refresh();
  }

  private _registerReminderDevConsoleCommands() {
    if (typeof window === "undefined") return;

    const target = window as unknown as Record<string, unknown>;

    target.sproutReminderLaunch = (force = false) => {
      const ok = this._reminderEngine?.triggerStartupReminder(!!force) ?? false;
      return ok ? "startup reminder triggered" : "startup reminder not shown";
    };

    target.sproutReminderRoutine = (force = false) => {
      const ok = this._reminderEngine?.triggerRoutineReminder(!!force) ?? false;
      return ok ? "routine reminder triggered" : "routine reminder not shown";
    };

    target.sproutReminderGatekeeper = (force = false) => {
      const ok = this._reminderEngine?.triggerGatekeeper(!!force) ?? false;
      return ok ? "gatekeeper popup opened" : "gatekeeper popup not opened";
    };
  }

  private _unregisterReminderDevConsoleCommands() {
    if (typeof window === "undefined") return;
    const target = window as unknown as Record<string, unknown>;
    for (const name of this._reminderDevConsoleCommandNames) {
      delete target[name];
    }
  }

  // --------------------------------
  // Ribbon icons (desktop + mobile)
  // --------------------------------

  private _registerRibbonIcons() {
    // Always use separate icons now (desktop and mobile).
    // Also: keep the editor context-menu for "Insert Flashcard".

    this._destroyRibbonIcons();

    const add = (icon: string, title: string, onClick: (ev: MouseEvent) => void) => {
      const el = this.addRibbonIcon(icon, title, onClick);
      el.addClass("sprout-ribbon-action");
      el.addClass("bc");
      this._ribbonEls.push(el);
      return el;
    };

    // 1) Home - single instance by default, multiple with Cmd/Ctrl+Click
    add(SPROUT_BRAND_ICON_KEY, BRAND, (ev: MouseEvent) => {
      const forceNew = ev.metaKey || ev.ctrlKey;
      void this.openHomeTab(forceNew);
    });
  }
}
