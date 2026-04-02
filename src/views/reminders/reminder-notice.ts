/**
 * @file src/views/reminders/reminder-notice.ts
 * @summary Module for reminder notice.
 *
 * @exports
 *  - showReminderNotice
 */

import { Notice } from "obsidian";

type ReminderNoticeArgs = {
  dueCount: number;
  customMessage: string;
  onClick?: (() => void) | null;
};

function formatReminderMessage(dueCount: number, customMessage: string): string {
  const trimmed = customMessage.trim();
  if (trimmed) return trimmed.split("{due}").join(String(dueCount));

  if (dueCount === 0) return "LearnKit – no cards due right now";
  if (dueCount === 1) return "LearnKit – 1 card is due. Click to open study.";
  return `LearnKit – ${dueCount} cards are due. Click to open study.`;
}

export function showReminderNotice(args: ReminderNoticeArgs): void {
  const notice = new Notice(formatReminderMessage(args.dueCount, args.customMessage), 8000);

  if (!args.onClick) return;

  const noticeEl = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
  if (!noticeEl) return;

  noticeEl.addClass("learnkit-reminder-clickable");
  noticeEl.setAttribute("role", "button");
  noticeEl.setAttribute("tabindex", "0");

  const invoke = () => {
    try {
      args.onClick?.();
    } catch {
      // ignore reminder click failures; notice already shown
    }
  };

  noticeEl.addEventListener("click", invoke, { once: true });
  noticeEl.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      invoke();
    },
    { once: true },
  );
}
