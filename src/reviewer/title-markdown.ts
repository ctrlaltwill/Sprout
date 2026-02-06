/**
 * @file src/reviewer/title-markdown.ts
 * @summary Renders Markdown content (such as Obsidian image embeds and shorthand image links) within a card's title element during review, unwrapping extraneous paragraph wrappers for clean inline display.
 *
 * @exports
 *   - renderTitleMarkdownIfNeeded — Detects embedded images in a card title and renders them via the Markdown pipeline
 */

import type { Session } from "./types";
import type { CardRecord } from "../types/card";
import { log } from "../core/logger";

export function renderTitleMarkdownIfNeeded(args: {
  rootEl: HTMLElement;
  session: Session;
  card: CardRecord;
  renderMarkdownInto: (containerEl: HTMLElement, md: string, sourcePath: string) => Promise<void>;
}) {
  const { rootEl, session, card, renderMarkdownInto } = args;
  if (!session || !card) return;

  const titleEl = rootEl.querySelector(".sprout-question-title") as HTMLElement | null;
  if (!titleEl) return;

  const titleText =
    (card).title ||
    ((card).type === "mcq"
      ? "MCQ"
      : (card).type === "cloze" || (card).type === "cloze-child"
        ? "Cloze"
        : "Basic");

  const s = String(titleText ?? "");

  const hasEmbed = /!\[\[[^\]]+\]\]/.test(s);
  const hasShorthand = /!\[[^\]]+\](?!\s*\()/.test(s);
  if (!hasEmbed && !hasShorthand) return;

  const sourcePath = String(card.sourceNotePath || session?.scope?.name || "");
  void renderMarkdownInto(titleEl, s, sourcePath);
  // Unwrap a single <p> wrapper inserted by the Markdown renderer to keep
  // content directly inside the <h2> without nested paragraphs.
  try {
    const children = Array.from(titleEl.children);
    if (children.length === 1 && children[0].tagName.toLowerCase() === "p") {
      const p = children[0] as HTMLElement;
      while (p.firstChild) {
        titleEl.insertBefore(p.firstChild, p);
      }
      titleEl.removeChild(p);
    }
  } catch (e) { log.swallow("titleMarkdown unwrap paragraph", e); }
}
