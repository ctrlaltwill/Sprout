/**
 * @file src/reviewer/title-markdown.ts
 * @summary Renders Markdown content (such as Obsidian image embeds and shorthand image links) within a card's title element during review, unwrapping extraneous paragraph wrappers for clean inline display.
 *
 * @exports
 *   - renderTitleMarkdownIfNeeded — Detects embedded images in a card title and renders them via the Markdown pipeline
 */
import { queryFirst } from "../../platform/core/ui";
import { log } from "../../platform/core/logger";
export function renderTitleMarkdownIfNeeded(args) {
    var _a;
    const { rootEl, session, card, renderMarkdownInto } = args;
    if (!session || !card)
        return;
    const titleEl = queryFirst(rootEl, ".learnkit-question-title");
    if (!titleEl)
        return;
    const titleText = (card).title || "";
    if (!titleText)
        return;
    const s = String(titleText !== null && titleText !== void 0 ? titleText : "");
    const hasEmbed = /!\[\[[^\]]+\]\]/.test(s);
    const hasShorthand = /!\[[^\]]+\](?!\s*\()/.test(s);
    if (!hasEmbed && !hasShorthand)
        return;
    const sourcePath = String(card.sourceNotePath || ((_a = session === null || session === void 0 ? void 0 : session.scope) === null || _a === void 0 ? void 0 : _a.name) || "");
    void renderMarkdownInto(titleEl, s, sourcePath);
    // Unwrap a single <p> wrapper inserted by the Markdown renderer to keep
    // content directly inside the <h2> without nested paragraphs.
    try {
        const children = Array.from(titleEl.children);
        if (children.length === 1 && children[0].tagName.toLowerCase() === "p") {
            const p = children[0];
            while (p.firstChild) {
                titleEl.insertBefore(p.firstChild, p);
            }
            titleEl.removeChild(p);
        }
    }
    catch (e) {
        log.swallow("titleMarkdown unwrap paragraph", e);
    }
}
