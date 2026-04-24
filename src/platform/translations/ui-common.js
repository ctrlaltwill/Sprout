/**
 * @file src/platform/translations/ui-common.ts
 * @summary Module for ui common.
 *
 * @exports
 *  - CommonUiText
 *  - txCommon
 */
import { t } from "./translator";
/**
 * Centralized helper for frequently reused UI action labels.
 */
export function txCommon(locale) {
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
