/**
 * @file src/platform/translations/ui-common.ts
 * @summary Module for ui common.
 *
 * @exports
 *  - CommonUiText
 *  - txCommon
 */

import { t } from "./translator";

type InterfaceLocale = unknown;

export type CommonUiText = {
  cancel: string;
  save: string;
  next: string;
  previous: string;
  back: string;
  close: string;
};

/**
 * Centralized helper for frequently reused UI action labels.
 */
export function txCommon(locale: InterfaceLocale): CommonUiText {
  return {
    cancel: t(locale, "ui.common.cancel", "Cancel"),
    save: t(locale, "ui.common.save", "Save"),
    next: t(locale, "ui.common.next", "Next"),
    previous: t(locale, "ui.common.previous", "Previous"),
    back: t(locale, "ui.common.back", "Back"),
    close: t(locale, "ui.common.close", "Close"),
  };
}
