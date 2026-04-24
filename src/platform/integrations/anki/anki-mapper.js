/**
 * @file src/anki/anki-mapper.ts
 * @summary Bidirectional type mapping between Sprout card/state types and Anki SQL rows.
 * Handles Basic, Cloze, and MCQ→Basic conversion for export, and Basic/Cloze detection
 * for import. Converts scheduling state, review log entries, and strips/adds HTML.
 *
 * @exports
 *  - cardRecordToAnkiNote  — Sprout CardRecord → AnkiNoteRow (export)
 *  - cardStateToAnkiCard   — Sprout CardState → AnkiCardRow (export)
 *  - reviewLogToAnkiRevlog — Sprout ReviewLogEntry → AnkiRevlogRow (export)
 *  - ankiNoteToCardRecord  — AnkiNoteRow → Sprout CardRecord (import)
 *  - ankiCardToCardState   — AnkiCardRow → Sprout CardState (import)
 *  - cleanHtmlToMarkdown   — basic HTML → markdown text conversion
 */
import { ANKI_FIELD_SEPARATOR, BASIC_MODEL_ID, CLOZE_MODEL_ID, } from "./anki-constants";
import { generateAnkiId, generateAnkiGuid, computeFieldChecksum, sproutStageToAnkiTypeQueue, ankiTypeQueueToSproutStage, fsrsDifficultyToAnkiFactor, ankiFactorToFsrsDifficulty, sproutDueToAnkiReviewDue, sproutDueToAnkiLearningDue, ankiReviewDueToSproutDue, ankiLearningDueToSproutDue, sproutGroupsToAnkiTags, ankiTagsToSproutGroups, sproutRatingToAnkiEase, ankiDeckToGroupPath, } from "./anki-utils";
import { State as FsrsState } from "ts-fsrs";
/** Derive a human-readable title from a vault file path. */
function titleFromFilePath(filePath) {
    const base = String(filePath !== null && filePath !== void 0 ? filePath : "").split("/").pop() || filePath;
    return base.replace(/\.md$/i, "").trim();
}
// ═══════════════════════════════════════════════════════════════════════════════
//  Export direction: Sprout → Anki
// ═══════════════════════════════════════════════════════════════════════════════
/** Convert a Sprout CardRecord to an Anki note row. */
export function cardRecordToAnkiNote(card, modelId) {
    const now = Math.floor(Date.now() / 1000);
    let flds;
    let mid;
    /** Convert inline markdown formatting to HTML for Anki fields. */
    const toHtml = (s) => markdownToHtml(s);
    if (card.type === "cloze" || card.type === "cloze-child") {
        // Cloze: Cloze | Explanation
        mid = modelId !== null && modelId !== void 0 ? modelId : CLOZE_MODEL_ID;
        const cloze = toHtml(card.clozeText || "");
        const explanation = toHtml(card.info || "");
        flds = [cloze, explanation].join(ANKI_FIELD_SEPARATOR);
    }
    else if (card.type === "mcq") {
        // MCQ → Basic: stem + options → Front, correct answer → Back, explanation → Explanation
        mid = modelId !== null && modelId !== void 0 ? modelId : BASIC_MODEL_ID;
        const stem = toHtml(card.stem || "");
        const options = Array.isArray(card.options) ? card.options : [];
        const correctIdx = Number.isFinite(card.correctIndex) ? card.correctIndex : -1;
        const lettered = options
            .map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            return opt ? `${letter}) ${toHtml(opt)}` : null;
        })
            .filter(Boolean)
            .join("<br>");
        const front = [stem, lettered].filter(Boolean).join("<br><br>");
        const back = correctIdx >= 0 && correctIdx < options.length
            ? `${String.fromCharCode(65 + correctIdx)}) ${toHtml(options[correctIdx])}`
            : "";
        const explanation = toHtml(card.info || "");
        flds = [front, back, explanation].join(ANKI_FIELD_SEPARATOR);
    }
    else {
        // Basic (default): Front | Back | Explanation
        mid = modelId !== null && modelId !== void 0 ? modelId : BASIC_MODEL_ID;
        const front = toHtml(card.q || "");
        const back = toHtml(card.a || "");
        const explanation = toHtml(card.info || "");
        flds = [front, back, explanation].join(ANKI_FIELD_SEPARATOR);
    }
    const sfld = flds.split(ANKI_FIELD_SEPARATOR)[0] || "";
    const tags = sproutGroupsToAnkiTags(card.groups);
    return {
        id: generateAnkiId(),
        guid: generateAnkiGuid(),
        mid,
        mod: now,
        usn: -1,
        tags,
        flds,
        sfld,
        csum: computeFieldChecksum(sfld),
        flags: 0,
        data: "",
    };
}
/** Convert a Sprout CardState to an Anki card row. */
export function cardStateToAnkiCard(state, noteId, deckId, ord, collectionCrtSec) {
    const now = Math.floor(Date.now() / 1000);
    const { type, queue } = sproutStageToAnkiTypeQueue(state.stage);
    let due;
    if (state.stage === "new") {
        due = 0;
    }
    else if (state.stage === "learning" || state.stage === "relearning") {
        due = sproutDueToAnkiLearningDue(state.due);
    }
    else {
        due = sproutDueToAnkiReviewDue(state.due, collectionCrtSec);
    }
    // Build the card data JSON with FSRS memory state.
    // Anki stores FSRS state in the card `data` column as JSON:
    //   s  = stability (days)
    //   d  = difficulty (0-10 scale in FSRS)
    //   dr = desired retention override for this card (optional)
    // See: rslib/src/storage/card/data.rs → CardData struct
    const cardData = {};
    if (state.stabilityDays != null && state.stabilityDays > 0) {
        cardData.s = state.stabilityDays;
    }
    if (state.difficulty != null && state.difficulty > 0) {
        cardData.d = state.difficulty;
    }
    const dataStr = Object.keys(cardData).length > 0 ? JSON.stringify(cardData) : "";
    return {
        id: generateAnkiId(),
        nid: noteId,
        did: deckId,
        ord,
        mod: now,
        usn: -1,
        type,
        queue,
        due,
        ivl: state.scheduledDays || 0,
        factor: fsrsDifficultyToAnkiFactor(state.difficulty),
        reps: state.reps || 0,
        lapses: state.lapses || 0,
        left: 0,
        odue: 0,
        odid: 0,
        flags: 0,
        data: dataStr,
    };
}
/** Convert a Sprout ReviewLogEntry to an Anki revlog row. */
export function reviewLogToAnkiRevlog(entry, cardId) {
    return {
        id: entry.at,
        cid: cardId,
        usn: -1,
        ease: sproutRatingToAnkiEase(entry.result),
        ivl: Math.floor(Math.max(0, entry.nextDue - entry.prevDue) / 86400000) || 0,
        lastIvl: 0,
        factor: 0,
        time: 0, // Sprout doesn't track review duration
        type: 0,
    };
}
/** Convert an Anki note + model into a Sprout CardRecord. */
export function ankiNoteToCardRecord(note, model, deckName, filePath, startLine, fieldMapping) {
    const rawFields = note.flds.split(ANKI_FIELD_SEPARATOR);
    const fields = rawFields.map((f) => cleanHtmlToMarkdown(f));
    const fieldNames = (model.flds || [])
        .sort((a, b) => a.ord - b.ord)
        .map((f) => f.name.toLowerCase());
    const getField = (name) => {
        const idx = fieldNames.indexOf(name.toLowerCase());
        return idx >= 0 && idx < fields.length ? fields[idx] : "";
    };
    const getFieldByIdx = (idx) => {
        return idx >= 0 && idx < fields.length ? fields[idx] : "";
    };
    const getFirstNonEmpty = (...vals) => {
        for (const v of vals) {
            const s = String(v !== null && v !== void 0 ? v : "").trim();
            if (s)
                return s;
        }
        return "";
    };
    const findFirstFieldByNames = (names) => {
        for (const n of names) {
            const v = getField(n);
            if (v && v.trim())
                return v;
        }
        return "";
    };
    const hasClozeSyntax = [...fields, ...rawFields].some((f) => /\{\{c\d+::/i.test(String(f !== null && f !== void 0 ? f : "")));
    const isCloze = fieldMapping
        ? fieldMapping.importAs === "cloze"
        : Number(model.type) === 1 || hasClozeSyntax;
    // Build groups from deck name + Anki tags (always include both)
    const groups = [];
    const groupPath = ankiDeckToGroupPath(deckName);
    if (groupPath)
        groups.push(groupPath);
    // Always convert Anki tags to groups
    const tagGroups = ankiTagsToSproutGroups(note.tags);
    for (const tg of tagGroups) {
        if (tg && !groups.includes(tg))
            groups.push(tg);
    }
    // Derive title from file path when none is available
    const autoTitle = titleFromFilePath(filePath);
    const now = Date.now();
    // ── User-provided field mapping (custom note types) ─────────────────────
    if (fieldMapping) {
        const qText = getFieldByIdx(fieldMapping.questionFieldIdx);
        const aText = fieldMapping.answerFieldIdx >= 0 ? getFieldByIdx(fieldMapping.answerFieldIdx) : "";
        const infoText = fieldMapping.infoFieldIdx >= 0 ? getFieldByIdx(fieldMapping.infoFieldIdx) : "";
        if (isCloze) {
            return {
                id: "",
                type: "cloze",
                title: autoTitle,
                clozeText: qText || null,
                info: infoText || aText || null,
                groups: groups.length ? groups : null,
                sourceNotePath: filePath,
                sourceStartLine: startLine,
                createdAt: now,
                updatedAt: now,
            };
        }
        return {
            id: "",
            type: "basic",
            title: autoTitle,
            q: qText || null,
            a: aText || null,
            info: infoText || null,
            groups: groups.length ? groups : null,
            sourceNotePath: filePath,
            sourceStartLine: startLine,
            createdAt: now,
            updatedAt: now,
        };
    }
    // ── Standard cloze ──────────────────────────────────────────────────────
    if (isCloze) {
        const clozeText = getFirstNonEmpty(findFirstFieldByNames(["cloze", "text", "front", "question", "prompt"]), fields[0], fields.find((f) => /\{\{c\d+::/i.test(f)) || "");
        const info = getFirstNonEmpty(findFirstFieldByNames(["explanation", "extra", "back", "answer", "notes", "comment"]), fields.length > 1 ? fields[1] : "", fields.length > 2 ? fields[2] : "");
        return {
            id: "",
            type: "cloze",
            title: autoTitle,
            clozeText: clozeText || null,
            info: info || null,
            groups: groups.length ? groups : null,
            sourceNotePath: filePath,
            sourceStartLine: startLine,
            createdAt: now,
            updatedAt: now,
        };
    }
    // ── Standard basic ──────────────────────────────────────────────────────
    const q = getFirstNonEmpty(findFirstFieldByNames(["front", "question", "q", "prompt", "text"]), fields[0]);
    const a = getFirstNonEmpty(findFirstFieldByNames(["back", "answer", "a", "response", "definition", "extra"]), fields.length > 1 ? fields[1] : "", fields.length > 2 ? fields[2] : "");
    const info = getFirstNonEmpty(findFirstFieldByNames(["explanation", "extra", "notes", "comment"]), fields.length > 2 ? fields[2] : "", fields.length > 3 ? fields[3] : "");
    return {
        id: "",
        type: "basic",
        title: autoTitle,
        q: q || null,
        a: a || null,
        info: info || null,
        groups: groups.length ? groups : null,
        sourceNotePath: filePath,
        sourceStartLine: startLine,
        createdAt: now,
        updatedAt: now,
    };
}
/** Convert an Anki card row to a Sprout CardState. */
export function ankiCardToCardState(card, sproutCardId, collectionCrtSec) {
    const stage = ankiTypeQueueToSproutStage(card.type, card.queue);
    let due;
    if (card.type === 0) {
        due = Date.now(); // new cards → due now
    }
    else if (card.type === 1 || card.type === 3) {
        due = ankiLearningDueToSproutDue(card.due);
    }
    else {
        due = ankiReviewDueToSproutDue(card.due, collectionCrtSec);
    }
    let fsrsState;
    switch (card.type) {
        case 0:
            fsrsState = FsrsState.New;
            break;
        case 1:
            fsrsState = FsrsState.Learning;
            break;
        case 2:
            fsrsState = FsrsState.Review;
            break;
        case 3:
            fsrsState = FsrsState.Relearning;
            break;
        default:
            fsrsState = FsrsState.New;
    }
    return {
        id: sproutCardId,
        stage,
        due,
        reps: card.reps,
        lapses: card.lapses,
        learningStepIndex: 0,
        stabilityDays: card.ivl > 0 ? card.ivl : undefined,
        difficulty: card.factor > 0 ? ankiFactorToFsrsDifficulty(card.factor) : undefined,
        scheduledDays: card.ivl || 0,
        fsrsState,
        suspendedDue: card.queue === -1 ? due : undefined,
    };
}
// ═══════════════════════════════════════════════════════════════════════════════
//  HTML ↔ Markdown helpers
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Convert Obsidian inline markdown formatting to HTML for Anki export.
 *
 *   **text**  → <b>text</b>      (bold)
 *   *text*    → <i>text</i>      (italic)
 *   _text_    → <i>text</i>      (italic — Obsidian standard)
 *   ~~text~~  → <s>text</s>      (strikethrough)
 *   ==text==  → <mark>text</mark> (highlight)
 *
 * Order matters: longer markers must be matched before their shorter prefixes.
 */
export function markdownToHtml(md) {
    if (!md)
        return "";
    let text = md;
    // Bold: **text** → <b>text</b>
    text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    // Italic: *text* → <i>text</i>  (single asterisk)
    text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
    // Italic: _text_ → <i>text</i>  (underscore — same as * in Obsidian)
    text = text.replace(/(?<![\w\\])_(.+?)_(?![\w])/g, "<i>$1</i>");
    // Strikethrough: ~~text~~ → <s>text</s>
    text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
    // Highlight: ==text== → <mark>text</mark>
    text = text.replace(/==(.+?)==/g, "<mark>$1</mark>");
    // Line breaks → <br>
    text = text.replace(/\n/g, "<br>");
    return text;
}
/**
 * Apply inline markdown formatting to a DOM element via innerHTML.
 * Uses standard Obsidian markdown conventions (no wiki-link or image handling).
 * Used by the reviewer and widget to render formatted text in cloze segments, titles, etc.
 */
export function applyInlineMarkdown(el, text) {
    if (!text) {
        el.textContent = "";
        return;
    }
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
    const tokens = [
        { type: "bold", regex: /\*\*(.+?)\*\*/ },
        { type: "italic", regex: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/ },
        { type: "italic", regex: /(?<![\w\\])_(.+?)_(?![\w])/ },
        { type: "strike", regex: /~~(.+?)~~/ },
        { type: "mark", regex: /==(.+?)==/ },
    ];
    const appendText = (parent, value) => {
        if (!value)
            return;
        parent.appendChild(document.createTextNode(value));
    };
    const appendInline = (parent, value) => {
        var _a;
        let remaining = value;
        while (remaining) {
            let nextMatch = null;
            let nextToken = null;
            let nextIndex = Infinity;
            for (const token of tokens) {
                const match = token.regex.exec(remaining);
                if (match && typeof match.index === "number" && match.index < nextIndex) {
                    nextIndex = match.index;
                    nextMatch = match;
                    nextToken = token;
                }
            }
            if (!nextMatch || !nextToken || nextIndex === Infinity) {
                appendText(parent, remaining);
                break;
            }
            if (nextIndex > 0) {
                appendText(parent, remaining.slice(0, nextIndex));
            }
            const content = (_a = nextMatch[1]) !== null && _a !== void 0 ? _a : "";
            let wrapper;
            switch (nextToken.type) {
                case "bold":
                    wrapper = document.createElement("strong");
                    break;
                case "italic":
                    wrapper = document.createElement("em");
                    break;
                case "strike":
                    wrapper = document.createElement("s");
                    break;
                case "mark":
                    wrapper = document.createElement("mark");
                    break;
            }
            appendInline(wrapper, content);
            parent.appendChild(wrapper);
            remaining = remaining.slice(nextIndex + nextMatch[0].length);
        }
    };
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
        appendInline(el, lines[i]);
        if (i < lines.length - 1) {
            el.appendChild(document.createElement("br"));
        }
    }
}
/** Strip HTML tags and convert to Markdown text (bold, italic, code, lists, etc.). */
export function cleanHtmlToMarkdown(html) {
    if (!html)
        return "";
    let text = html;
    // ── Block-level elements ────────────────────────────────────────────────
    // Headings: <h1>…</h1> → # …
    text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
        return "\n" + "#".repeat(Number(level)) + " " + content.trim() + "\n";
    });
    // Horizontal rules
    text = text.replace(/<hr\s*\/?>/gi, "\n---\n");
    // Blockquotes
    text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, content) => {
        const inner = content.replace(/<[^>]+>/g, "").trim();
        return "\n" + inner.split("\n").map((l) => "> " + l).join("\n") + "\n";
    });
    // Preformatted / code blocks
    text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, content) => {
        const inner = content.replace(/<[^>]+>/g, "");
        return "\n```\n" + inner.trim() + "\n```\n";
    });
    // Tables: simple row-based conversion
    text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableContent) => {
        const rows = [];
        const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        let isFirst = true;
        while ((trMatch = trRe.exec(tableContent)) !== null) {
            const cells = [];
            const cellRe = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
            let cellMatch;
            while ((cellMatch = cellRe.exec(trMatch[1])) !== null) {
                cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
            }
            if (cells.length) {
                rows.push("| " + cells.join(" | ") + " |");
                if (isFirst) {
                    rows.push("| " + cells.map(() => "---").join(" | ") + " |");
                    isFirst = false;
                }
            }
        }
        return rows.length ? "\n" + rows.join("\n") + "\n" : "";
    });
    // Ordered lists
    text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, listContent) => {
        let idx = 1;
        return "\n" + listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_lm, item) => {
            return `${idx++}. ${item.replace(/<[^>]+>/g, "").trim()}\n`;
        }).trim() + "\n";
    });
    // Unordered lists
    text = text.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, listContent) => {
        return "\n" + listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_lm, item) => {
            return `- ${item.replace(/<[^>]+>/g, "").trim()}\n`;
        }).trim() + "\n";
    });
    // ── Inline formatting (BEFORE line-break conversion) ───────────────────
    // Process inline tags first so they don't span across <br>-generated newlines.
    // Use replacer functions that pad spaces at word boundaries so markers
    // don't merge with adjacent text (e.g. "word<b>bold</b>word" → "word **bold** word").
    /** Build a replacer that wraps content with `marker`, padding spaces at word boundaries. */
    const inlineReplacer = (marker) => {
        return (match, content, offset, full) => {
            var _a;
            const inner = content.trim();
            if (!inner)
                return ""; // empty tag → drop entirely
            const charBefore = offset > 0 ? full[offset - 1] : "";
            const charAfter = (_a = full[offset + match.length]) !== null && _a !== void 0 ? _a : "";
            const spaceBefore = charBefore && /\w/.test(charBefore) ? " " : "";
            const spaceAfter = charAfter && /[\w([]/.test(charAfter) ? " " : "";
            return spaceBefore + marker + inner + marker + spaceAfter;
        };
    };
    // Convert inline tags to Obsidian markdown markers with boundary spacing
    text = text.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, inlineReplacer("**"));
    text = text.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, inlineReplacer("*"));
    text = text.replace(/<(?:s|strike|del)[^>]*>([\s\S]*?)<\/(?:s|strike|del)>/gi, inlineReplacer("~~"));
    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
    text = text.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, "==$1==");
    // <u>, <sub>, <sup> have no native Obsidian markdown syntax — keep as HTML passthrough
    // so they still render correctly in reading/preview mode
    // ── Line breaks & block boundaries ─────────────────────────────────────
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<\/div>\s*<div[^>]*>/gi, "\n");
    text = text.replace(/<\/?div[^>]*>/gi, "\n");
    text = text.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
    text = text.replace(/<\/?p[^>]*>/gi, "\n");
    // Images
    text = text.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, "![[$1]]");
    // Links
    text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
    // Preserve <u>, <sub>, <sup> tags (no native Obsidian markdown syntax) by
    // temporarily replacing angle brackets so they survive the strip-all pass.
    const preservedTagToken = "__SPROUT_PRESERVE_TAG__";
    const preservedTagTokenRe = preservedTagToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(/<(\/?)u>/gi, `${preservedTagToken}$1u${preservedTagToken}`);
    text = text.replace(/<(\/?)sub>/gi, `${preservedTagToken}$1sub${preservedTagToken}`);
    text = text.replace(/<(\/?)sup>/gi, `${preservedTagToken}$1sup${preservedTagToken}`);
    // Strip remaining HTML tags
    text = text.replace(/<[^>]+>/g, "");
    // Restore preserved tags
    text = text.replace(new RegExp(`${preservedTagTokenRe}(\\/?)u${preservedTagTokenRe}`, "g"), "<$1u>");
    text = text.replace(new RegExp(`${preservedTagTokenRe}(\\/?)sub${preservedTagTokenRe}`, "g"), "<$1sub>");
    text = text.replace(new RegExp(`${preservedTagTokenRe}(\\/?)sup${preservedTagTokenRe}`, "g"), "<$1sup>");
    // ── HTML entities ──────────────────────────────────────────────────────
    text = text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
    // ── Anki-style bullet points ───────────────────────────────────────────
    // Anki often uses "• " or "- " or "· " at start of lines (after <br>)
    // as pseudo-bullets. Normalise to Markdown "- ".
    text = text.replace(/^[•·●◦▪▸►]\s*/gm, "- ");
    // ── Clean up formatting artifacts ──────────────────────────────────────
    // Remove formatting markers that span across line breaks
    // e.g. "*\n*" or "**\n**" left by wrapping <i>/<b> around <br>-separated content
    text = text.replace(/\*{1,2}\s*\n\s*\*{1,2}/g, "\n");
    // Lines that are ONLY formatting markers (stray * or ** or *** or __ from broken tags)
    text = text.replace(/^\s*\*{1,3}\s*$/gm, "");
    text = text.replace(/^\s*_{1,2}\s*$/gm, "");
    // Truly empty marker pairs: runs of 4+ consecutive asterisks are always
    // artifacts of empty nested formatting (e.g. <b><i></i></b> → ******).
    text = text.replace(/\*{4,}/g, "");
    // Remove empty underline markers: __ with nothing between
    text = text.replace(/(?<!\w)__(?!\w)/g, "");
    // Collapsed nested bold+italic: ***text*** → **text** (prefer bold)
    text = text.replace(/\*{3}([^*\n]+?)\*{3}/g, "**$1**");
    // Trailing/leading stray asterisks stuck to words: "word***" → "word"
    // (3+ asterisks at word boundaries that aren't valid formatting)
    text = text.replace(/(\w)\*{3,}/g, "$1");
    text = text.replace(/\*{3,}(\w)/g, "$1");
    // Collapse multiple blank lines
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
}
