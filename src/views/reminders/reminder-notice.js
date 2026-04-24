/**
 * @file src/views/reminders/reminder-notice.ts
 * @summary Module for reminder notice.
 *
 * @exports
 *  - showReminderNotice
 */
import { Notice } from "obsidian";
function formatReminderMessage(dueCount, customMessage) {
    const trimmed = customMessage.trim();
    if (trimmed)
        return trimmed.split("{due}").join(String(dueCount));
    if (dueCount === 0)
        return "LearnKit – no cards due right now";
    if (dueCount === 1)
        return "LearnKit – 1 card is due. Click to open study.";
    return `LearnKit – ${dueCount} cards are due. Click to open study.`;
}
export function showReminderNotice(args) {
    const notice = new Notice(formatReminderMessage(args.dueCount, args.customMessage), 8000);
    if (!args.onClick)
        return;
    const noticeEl = notice.noticeEl;
    if (!noticeEl)
        return;
    noticeEl.addClass("learnkit-reminder-clickable");
    noticeEl.setAttribute("role", "button");
    noticeEl.setAttribute("tabindex", "0");
    const invoke = () => {
        var _a;
        try {
            (_a = args.onClick) === null || _a === void 0 ? void 0 : _a.call(args);
        }
        catch (_b) {
            // ignore reminder click failures; notice already shown
        }
    };
    noticeEl.addEventListener("click", invoke, { once: true });
    noticeEl.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ")
            return;
        ev.preventDefault();
        invoke();
    }, { once: true });
}
