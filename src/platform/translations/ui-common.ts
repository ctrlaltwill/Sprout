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
  answer: string;
  back: string;
  cancel: string;
  close: string;
  confirm: string;
  delete: string;
  done: string;
  edit: string;
  home: string;
  next: string;
  previous: string;
  question: string;
  reset: string;
  save: string;
  study: string;
  title: string;
};

/**
 * Centralized helper for frequently reused UI action labels.
 */
export function txCommon(locale: InterfaceLocale): CommonUiText {
  return {
    answer: t(locale, "ui.common.answer", "Answer"),
    back: t(locale, "ui.common.back", "Back"),
    cancel: t(locale, "ui.common.cancel", "Cancel"),
    close: t(locale, "ui.common.close", "Close"),
    confirm: t(locale, "ui.common.confirm", "Confirm"),
    delete: t(locale, "ui.common.delete", "Delete"),
    done: t(locale, "ui.common.done", "Done"),
    edit: t(locale, "ui.common.edit", "Edit"),
    home: t(locale, "ui.common.home", "Home"),
    next: t(locale, "ui.common.next", "Next"),
    previous: t(locale, "ui.common.previous", "Previous"),
    question: t(locale, "ui.common.question", "Question"),
    reset: t(locale, "ui.common.reset", "Reset"),
    save: t(locale, "ui.common.save", "Save"),
    study: t(locale, "ui.common.study", "Study"),
    title: t(locale, "ui.common.title", "Title"),
  };
}
