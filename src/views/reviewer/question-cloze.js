/**
 * @file src/reviewer/question-cloze.ts
 * @summary Renders cloze-deletion flashcard fronts for the reviewer. Parses {{cN::answer}} tokens
 *   in the card text and replaces them with styled blanks (standard mode) or typed inputs (typed mode).
 *
 * @exports
 *   - renderClozeFront — Creates a DOM element rendering a cloze card's text with blanks or revealed answers
 *   - ClozeRenderOptions — Options for cloze rendering (mode, colours, typed-answer state)
 */
import { el, setCssProps } from "../../platform/core/ui";
import { getClozeRenderOccurrences, splitClozeAnswerAndHint } from "../../platform/core/shared-utils";
import { applyInlineMarkdown } from "../../platform/integrations/anki/anki-mapper";
import { hydrateCircleFlagsInElement, processCircleFlagsInMarkdown } from "../../platform/flags/flag-tokens";
function makeTypedAnswerKey(clozeIndex, occurrence) {
    return `${clozeIndex}#${occurrence}`;
}
/**
 * Strips inline-markdown markers to produce plain text for comparison.
 * Removes bold, italic, code, and strikethrough formatting.
 */
function stripInlineMarkdown(s) {
    return s
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        .replace(/~~(.+?)~~/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .trim();
}
function measureClozeTextWidthPx(host, text) {
    const normalizedText = text.trim();
    if (!normalizedText)
        return 0;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx)
        return normalizedText.length * 8;
    ctx.font = `500 14px ${getComputedStyle(host).fontFamily}`;
    return ctx.measureText(normalizedText).width;
}
function buildTypedClozeInput(host, clozeIndex, occurrence, answer, hint, opts) {
    var _a;
    const typedAnswers = (_a = opts === null || opts === void 0 ? void 0 : opts.typedAnswers) !== null && _a !== void 0 ? _a : new Map();
    const plainAns = stripInlineMarkdown(answer);
    const plainHint = stripInlineMarkdown(hint || "");
    const answerKey = makeTypedAnswerKey(clozeIndex, occurrence);
    const wrap = document.createElement("span");
    wrap.className = "learnkit-cloze-typed-wrap";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "learnkit-cloze-typed-input";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("data-cloze-index", String(clozeIndex));
    if (plainHint)
        input.placeholder = plainHint;
    const textW = Math.max(measureClozeTextWidthPx(host, plainAns), measureClozeTextWidthPx(host, plainHint));
    setCssProps(input, "width", `${Math.max(60, Math.ceil(textW) + 68)}px`);
    const prev = typedAnswers.get(answerKey);
    if (prev) {
        input.value = prev;
        updateTypedInputState(input, prev, plainAns);
    }
    input.addEventListener("input", () => {
        var _a;
        const v = input.value;
        typedAnswers.set(answerKey, v);
        (_a = opts === null || opts === void 0 ? void 0 : opts.onTypedInput) === null || _a === void 0 ? void 0 : _a.call(opts, answerKey, clozeIndex, v);
        updateTypedInputState(input, v, plainAns);
    });
    input.addEventListener("keydown", (e) => {
        var _a;
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            (_a = opts === null || opts === void 0 ? void 0 : opts.onTypedSubmit) === null || _a === void 0 ? void 0 : _a.call(opts);
        }
    });
    wrap.appendChild(input);
    return wrap;
}
export function hydrateRenderedMathCloze(container, text, reveal, targetIndex, opts) {
    if (reveal || ((opts === null || opts === void 0 ? void 0 : opts.mode) || "standard") !== "typed") {
        return;
    }
    const placeholders = Array.from(container.querySelectorAll(".learnkit-cloze-blank.hidden-cloze"));
    if (!placeholders.length) {
        return;
    }
    const targets = getClozeRenderOccurrences(text, targetIndex).filter((occurrence) => occurrence.isTarget && !occurrence.inMath);
    targets.forEach((occurrence, index) => {
        const placeholder = placeholders[index];
        if (!placeholder) {
            return;
        }
        const host = placeholder.parentElement instanceof HTMLElement ? placeholder.parentElement : container;
        const typedWrap = buildTypedClozeInput(host, occurrence.clozeIndex, occurrence.occurrence, occurrence.answer, occurrence.hint, opts);
        placeholder.replaceWith(typedWrap);
    });
        const firstInput = container.querySelector(".learnkit-cloze-typed-input");
        if (firstInput) {
        const inputToFocus = firstInput;
        setTimeout(() => inputToFocus.focus(), 50);
    }
}
export function renderClozeFront(text, reveal, targetIndex, opts) {
    var _a, _b, _c, _d, _e;
    const mode = (_a = opts === null || opts === void 0 ? void 0 : opts.mode) !== null && _a !== void 0 ? _a : "standard";
    const typedAnswers = (_b = opts === null || opts === void 0 ? void 0 : opts.typedAnswers) !== null && _b !== void 0 ? _b : new Map();
    const container = el("div", "");
    container.className = "whitespace-pre-wrap break-words";
    // Wrap cloze content in a <p dir="auto"> so it matches MarkdownRenderer output
    // (and therefore matches spacing/margins between basic vs cloze cards).
    const p = document.createElement("p");
    p.setAttribute("dir", "auto");
    p.className = "whitespace-pre-wrap break-words";
    container.appendChild(p);
    const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
    const clozeOccurrences = new Map();
    let last = 0;
    let m;
    const measureChPx = () => {
        const probe = document.createElement("span");
        probe.className = "learnkit-cloze-probe";
        probe.textContent = "0000000000";
        p.appendChild(probe);
        const px = probe.getBoundingClientRect().width / 10;
        probe.remove();
        return px || 8;
    };
    const chPx = measureChPx();
    const subtractCh = Math.max(0, Math.round(20 / chPx)); // ~20px in ch units
    const computeBlankWidthPx = (content) => {
        const plainContent = stripInlineMarkdown(content);
        const widthChars = Math.max(4, Math.min(40, (plainContent.length || 6)));
        const widthAdjusted = Math.max(1, widthChars - subtractCh);
        return Math.max(30, widthAdjusted * chPx);
    };
    const ensureSpaceBeforeBlank = () => {
        var _a;
        const lastNode = p.lastChild;
        if (lastNode && lastNode.nodeType === Node.TEXT_NODE) {
            const t = (_a = lastNode.textContent) !== null && _a !== void 0 ? _a : "";
            if (/\s$/.test(t))
                return;
            lastNode.textContent = t + " ";
            return;
        }
        if (lastNode)
            p.appendChild(document.createTextNode(" "));
    };
    const applyInlineMarkdownWithFlags = (target, raw) => {
        applyInlineMarkdown(target, processCircleFlagsInMarkdown(raw));
        hydrateCircleFlagsInElement(target);
    };
    /** Append a text segment with inline markdown formatting (bold, italic, etc.) */
    const appendFormattedText = (parent, text) => {
        const span = document.createElement("span");
        applyInlineMarkdownWithFlags(span, text);
        parent.appendChild(span);
    };
    /** Track first typed input for auto-focus */
    let firstTypedInput = null;
    while ((m = re.exec(text))) {
        if (m.index > last) {
            appendFormattedText(p, text.slice(last, m.index));
        }
        const idx = Number(m[1]);
        const rawContent = (_c = m[2]) !== null && _c !== void 0 ? _c : "";
        const { answer, hint } = splitClozeAnswerAndHint(rawContent);
        const plainAns = stripInlineMarkdown(answer);
        const plainHint = stripInlineMarkdown(hint || "");
        const occurrence = ((_d = clozeOccurrences.get(idx)) !== null && _d !== void 0 ? _d : 0) + 1;
        clozeOccurrences.set(idx, occurrence);
        const answerKey = makeTypedAnswerKey(idx, occurrence);
        const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;
        if (!isTarget) {
            // Non-target clozes: always show answer text inline
            appendFormattedText(p, answer);
        }
        else if (reveal) {
            // ── BACK (revealed) ──────────────────────────────
            if (mode === "typed") {
                // Typed mode back: compare what was typed to the expected answer
                const typed = ((_e = typedAnswers.get(answerKey)) !== null && _e !== void 0 ? _e : "").trim();
                const isCorrect = typed.toLowerCase() === plainAns.toLowerCase();
                if (isCorrect) {
                    // Correct: green pill with answer text
                    const span = document.createElement("span");
                    span.className = "learnkit-cloze-revealed learnkit-cloze-typed-correct";
                    applyInlineMarkdownWithFlags(span, answer);
                    p.appendChild(span);
                }
                else {
                    // Wrong (or blank): always show a red pill first, then the green correct answer.
                    const wrongSpan = document.createElement("span");
                    wrongSpan.className = "learnkit-cloze-revealed learnkit-cloze-typed-wrong";
                    wrongSpan.textContent = typed || "\u00A0\u00A0\u00A0";
                    p.appendChild(wrongSpan);
                    p.appendChild(document.createTextNode(" "));
                    const correctSpan = document.createElement("span");
                    correctSpan.className = "learnkit-cloze-revealed learnkit-cloze-typed-correct";
                    applyInlineMarkdownWithFlags(correctSpan, answer);
                    p.appendChild(correctSpan);
                }
            }
            else {
                // Standard mode back: normal accent-coloured reveal
                const answerSpan = document.createElement("span");
                answerSpan.className = "learnkit-cloze-revealed";
                applyInlineMarkdownWithFlags(answerSpan, answer);
                // Apply custom colours if provided (standard mode only)
                if (opts === null || opts === void 0 ? void 0 : opts.clozeBgColor) {
                    setCssProps(answerSpan, "background-color", opts.clozeBgColor);
                }
                if (opts === null || opts === void 0 ? void 0 : opts.clozeTextColor) {
                    setCssProps(answerSpan, "--learnkit-cloze-color", opts.clozeTextColor);
                }
                else {
                    // Auto-contrast detection
                    setTimeout(() => {
                        var _a;
                        const bg = getComputedStyle(answerSpan).backgroundColor;
                        const rgb = (_a = bg.match(/\d+/g)) === null || _a === void 0 ? void 0 : _a.map(Number);
                        if (rgb && rgb.length >= 3) {
                            const [r, g, b] = rgb;
                            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                            setCssProps(answerSpan, "--learnkit-cloze-color", luminance > 0.7 ? "#111" : "#fff");
                        }
                    }, 0);
                }
                p.appendChild(answerSpan);
            }
        }
        else {
            // ── FRONT (unrevealed) ───────────────────────────
            if (mode === "typed") {
                ensureSpaceBeforeBlank();
                const wrap = buildTypedClozeInput(p, idx, occurrence, answer, hint, opts);
                p.appendChild(wrap);
                if (!firstTypedInput)
                    firstTypedInput = wrap.querySelector("input");
            }
            else if (hint) {
                const hintSpan = document.createElement("span");
                hintSpan.className = "learnkit-cloze-hint";
                applyInlineMarkdownWithFlags(hintSpan, hint);
                setCssProps(hintSpan, "width", `${computeBlankWidthPx(plainAns || plainHint)}px`);
                p.appendChild(hintSpan);
            }
            else {
                ensureSpaceBeforeBlank();
                // Standard mode: blank underline
                const blank = document.createElement("span");
                blank.className = "learnkit-cloze-blank hidden-cloze";
                blank.textContent = "";
                setCssProps(blank, "--learnkit-cloze-width", `${computeBlankWidthPx(plainAns)}px`);
                p.appendChild(blank);
            }
        }
        last = m.index + m[0].length;
    }
    if (last < text.length) {
        appendFormattedText(p, text.slice(last));
    }
    // Auto-focus the first typed input when in typed mode
    if (firstTypedInput) {
        const inputToFocus = firstTypedInput;
        setTimeout(() => inputToFocus.focus(), 50);
    }
    return container;
}
/**
 * Updates the visual state of a typed cloze input based on current value vs expected answer.
 * - Empty: neutral (no state class)
 * - Partial match from start: yellow ("partial")
 * - Full match: green ("correct")
 * - Mismatch: red ("wrong")
 */
function updateTypedInputState(input, typed, expected) {
    input.classList.remove("learnkit-cloze-typed--partial", "learnkit-cloze-typed--partial", "learnkit-cloze-typed--correct", "learnkit-cloze-typed--correct", "learnkit-cloze-typed--wrong", "learnkit-cloze-typed--wrong");
    if (!typed)
        return; // empty → neutral
    const tLower = typed.toLowerCase();
    const eLower = expected.toLowerCase();
    if (tLower === eLower) {
        input.classList.add("learnkit-cloze-typed--correct", "learnkit-cloze-typed--correct");
    }
    else if (eLower.startsWith(tLower)) {
        input.classList.add("learnkit-cloze-typed--partial", "learnkit-cloze-typed--partial");
    }
    else {
        input.classList.add("learnkit-cloze-typed--wrong", "learnkit-cloze-typed--wrong");
    }
}
