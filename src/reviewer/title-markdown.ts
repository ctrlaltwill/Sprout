// src/reviewer/titleMarkdown.ts
import type { Session } from "./image-occlusion-types";

export function renderTitleMarkdownIfNeeded(args: {
  rootEl: HTMLElement;
  session: Session;
  card: any;
  renderMarkdownInto: (containerEl: HTMLElement, md: string, sourcePath: string) => any;
}) {
  const { rootEl, session, card, renderMarkdownInto } = args;
  if (!session || !card) return;

  const titleEl = rootEl.querySelector(".sprout-question-title") as HTMLElement | null;
  if (!titleEl) return;

  const titleText =
    (card as any).title ||
    ((card as any).type === "mcq"
      ? "MCQ"
      : (card as any).type === "cloze" || (card as any).type === "cloze-child"
        ? "Cloze"
        : "Basic");

  const s = String(titleText ?? "");

  const hasEmbed = /!\[\[[^\]]+\]\]/.test(s);
  const hasShorthand = /!\[[^\]]+\](?!\s*\()/.test(s);
  if (!hasEmbed && !hasShorthand) return;

  const sourcePath = String((card as any).sourceNotePath || (session as any)?.scope?.name || "");
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
  } catch {}
}
