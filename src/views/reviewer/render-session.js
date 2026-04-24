/**
 * @file src/reviewer/render-session.ts
 * @summary Renders the active study-session view including the flashcard UI, grading buttons, MCQ option display, cloze blanks, image-occlusion cards, info panels, skip/undo controls, and the session header. This is the primary rendering entry point for the session mode of the reviewer.
 *
 * @exports
 *   - renderSessionMode — Builds and mounts the full session-mode DOM (card, buttons, header, menus) into the given container
 */
import { refreshAOS } from "../../platform/core/aos-loader";
import { log } from "../../platform/core/logger";
import { createOqReorderPreviewController } from "../../platform/core/oq-reorder-preview";
import { setCssProps } from "../../platform/core/ui";
import { applyInlineMarkdown } from "../../platform/integrations/anki/anki-mapper";
import { setIcon } from "obsidian";
import { bindTtsPlayingState, markTtsButtonActive } from "../../platform/integrations/tts/tts-service";
import { renderStudySessionHeader } from "./study-session-header";
import { normalizeCardOptions } from "../../platform/core/store";
import { getCorrectIndices, isMultiAnswerMcq } from "../../platform/types/card";
import { hydrateRenderedMathCloze } from "./question-cloze";
import { openCardAnchorInNote } from "../../platform/core/open-card-anchor";
import { processClozeForMath, convertInlineDisplayMath, forceSingleLineDisplayMathInline } from "../../platform/core/shared-utils";
import { hydrateCircleFlagsInElement, processCircleFlagsInMarkdown } from "../../platform/flags/flag-tokens";
import { t } from "../../platform/translations/translator";
import { getRatingIntervalPreview } from "../../platform/core/grade-intervals";
function applyInlineMarkdownWithFlags(target, raw) {
    applyInlineMarkdown(target, processCircleFlagsInMarkdown(raw));
    hydrateCircleFlagsInElement(target);
}
const QUESTION_NUMBER_WORDS = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
    "Twenty",
];
function toQuestionOrdinalWord(n) {
    var _a;
    const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    return (_a = QUESTION_NUMBER_WORDS[safe]) !== null && _a !== void 0 ? _a : String(safe);
}
function pageNameFromSourcePath(sourcePath) {
    const clean = String(sourcePath || "").trim().replace(/\\/g, "/");
    if (!clean)
        return "Page";
    const leaf = clean
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .pop() || "";
    const noExt = leaf.replace(/\.md$/i, "").trim();
    return noExt || "Page";
}
function questionNumberWithinNote(session, card) {
    const currentId = String(card.id || "");
    const sourcePath = String(card.sourceNotePath || "").trim().toLowerCase();
    if (!sourcePath)
        return 1;
    const noteCards = ((session === null || session === void 0 ? void 0 : session.queue) || [])
        .filter((entry) => String((entry === null || entry === void 0 ? void 0 : entry.sourceNotePath) || "").trim().toLowerCase() === sourcePath)
        .slice()
        .sort((a, b) => {
        const lineDelta = (Number(a === null || a === void 0 ? void 0 : a.sourceStartLine) || 0) - (Number(b === null || b === void 0 ? void 0 : b.sourceStartLine) || 0);
        if (lineDelta !== 0)
            return lineDelta;
        return String((a === null || a === void 0 ? void 0 : a.id) || "").localeCompare(String((b === null || b === void 0 ? void 0 : b.id) || ""));
    });
    const idx = noteCards.findIndex((entry) => String((entry === null || entry === void 0 ? void 0 : entry.id) || "") === currentId);
    return idx >= 0 ? idx + 1 : 1;
}
function fallbackQuestionTitle(session, card) {
    const page = pageNameFromSourcePath(String(card.sourceNotePath || ""));
    const questionWord = toQuestionOrdinalWord(questionNumberWithinNote(session, card));
    return `${page} \u2013 Question ${questionWord}`;
}
function extractInfoField(card) {
    if (!card)
        return null;
    const pick = (v) => {
        if (typeof v === "string" && v.trim())
            return v.trim();
        if (Array.isArray(v)) {
            const s = v.filter((x) => typeof x === "string").join("\n").trim();
            return s ? s : null;
        }
        return null;
    };
    return pick(card.info);
}
// --- Basecoat scoping --------------------------------------------------------
/**
 * IMPORTANT:
 * - Add `bc` to every element you want Basecoat to style.
 * - Your PostCSS scoper produces selectors like `.learnkit-btn-toolbar.bc`, `div.card.bc`, etc.
 *   so the presence of class `bc` is required for those rules to match.
 */
function h(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className && className.trim() ? `bc ${className}` : "bc";
    if (typeof text === "string")
        node.textContent = text;
    return node;
}
function makeKbd(label) {
    const k = document.createElement("kbd");
    k.className = "kbd ml-2";
    k.textContent = label;
    return k;
}
function appendKbdRight(btn, label) {
    btn.appendChild(makeKbd(label));
}
function makeTextButton(opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.className.split(/\s+/).includes("bc") ? opts.className : `bc ${opts.className}`;
    if (btn.classList.contains("learnkit-btn-toolbar")) {
        btn.classList.add("learnkit-btn-filter", "learnkit-btn-filter");
    }
    if (opts.subtitle) {
        btn.classList.add("learnkit-grade-btn-with-interval", "learnkit-grade-btn-with-interval");
        const labelWrap = document.createElement("span");
        labelWrap.className = "learnkit-grade-btn-label-wrap";
        const labelLine = document.createElement("span");
        labelLine.className = "learnkit-grade-btn-label";
        labelLine.textContent = opts.label;
        const subtitleLine = document.createElement("span");
        subtitleLine.className = "learnkit-grade-btn-subtitle";
        subtitleLine.textContent = opts.subtitle;
        labelWrap.appendChild(labelLine);
        labelWrap.appendChild(subtitleLine);
        btn.appendChild(labelWrap);
    }
    else {
        btn.textContent = opts.label;
    }
    btn.setAttribute("aria-label", opts.title || opts.label);
    btn.setAttribute("data-tooltip-position", "top");
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onClick();
    });
    if (opts.kbd)
        appendKbdRight(btn, opts.kbd);
    return btn;
}
// --- IO helpers --------------------------------------------------------------
function isIoCard(card) {
    var _a;
    const t = String((_a = card === null || card === void 0 ? void 0 : card.type) !== null && _a !== void 0 ? _a : "").toLowerCase();
    return t === "io" || t === "io-child";
}
// --- MCQ option order --------------------------------------------------------
function ensureMcqOrderMap(session) {
    if (!session.mcqOrderMap || typeof session.mcqOrderMap !== "object")
        session.mcqOrderMap = {};
    return session.mcqOrderMap;
}
function isPermutation(arr, n) {
    if (!Array.isArray(arr) || arr.length !== n)
        return false;
    const seen = new Array(n).fill(false);
    for (const raw of arr) {
        const x = Number(raw);
        if (!Number.isInteger(x) || x < 0 || x >= n)
            return false;
        if (seen[x])
            return false;
        seen[x] = true;
    }
    return true;
}
function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
}
function getMcqDisplayOrder(session, card, enabled) {
    var _a;
    const opts = (card === null || card === void 0 ? void 0 : card.options) || [];
    const n = Array.isArray(opts) ? opts.length : 0;
    const identity = Array.from({ length: n }, (_, i) => i);
    if (!enabled)
        return identity;
    if (!session)
        return identity;
    const id = String((_a = card === null || card === void 0 ? void 0 : card.id) !== null && _a !== void 0 ? _a : "");
    if (!id)
        return identity;
    const map = ensureMcqOrderMap(session);
    const existing = map[id];
    if (isPermutation(existing, n))
        return existing;
    const next = identity.slice();
    shuffleInPlace(next);
    // Avoid identity permutation
    if (n >= 2) {
        let same = true;
        for (let i = 0; i < n; i++) {
            if (next[i] !== i) {
                same = false;
                break;
            }
        }
        if (same) {
            const tmp = next[0];
            next[0] = next[1];
            next[1] = tmp;
        }
    }
    map[id] = next;
    return next;
}
// --- OQ (Ordering Question) helpers ------------------------------------------
/** Ensures session has an oqOrderMap. */
function ensureOqOrderMap(session) {
    const s = session;
    if (!s.oqOrderMap || typeof s.oqOrderMap !== "object")
        s.oqOrderMap = {};
    return s.oqOrderMap;
}
/** Get a shuffled initial display order for OQ steps. */
function getOqShuffledOrder(session, card, enabled) {
    var _a;
    const steps = (card === null || card === void 0 ? void 0 : card.oqSteps) || [];
    const n = Array.isArray(steps) ? steps.length : 0;
    const identity = Array.from({ length: n }, (_, i) => i);
    if (!session || !n)
        return identity;
    const id = String((_a = card === null || card === void 0 ? void 0 : card.id) !== null && _a !== void 0 ? _a : "");
    if (!id)
        return identity;
    const map = ensureOqOrderMap(session);
    if (!enabled) {
        map[id] = identity;
        return identity;
    }
    // Shuffle, ensuring not identity
    const next = identity.slice();
    shuffleInPlace(next);
    if (n >= 2) {
        let same = true;
        for (let i = 0; i < n; i++) {
            if (next[i] !== i) {
                same = false;
                break;
            }
        }
        if (same) {
            const tmp = next[0];
            next[0] = next[1];
            next[1] = tmp;
        }
    }
    map[id] = next;
    return next;
}
// --- Dropdown menu (optional header actions) ---------------------------------
function makeHeaderMenu(opts) {
    const tx = (token, fallback, vars) => t(opts.interfaceLanguage, token, fallback, vars);
    const id = `learnkit-menu-${Math.random().toString(36).slice(2, 8)}`;
    const root = document.createElement("div");
    root.id = id;
    root.className = "relative inline-flex";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = `${id}-trigger`;
    trigger.className = "learnkit-btn-toolbar learnkit-btn-filter";
    trigger.dataset.bcAction = "reviewer-more-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-controls", `${id}-menu`);
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", tx("ui.reviewer.more.tooltip", "More actions"));
    if (opts.compactTrigger) {
        trigger.classList.add("lk-review-more-icon-btn");
        trigger.setAttribute("aria-label", tx("ui.reviewer.more.tooltip", "More actions"));
        const iconWrap = document.createElement("span");
        iconWrap.className = "inline-flex items-center justify-center";
        setIcon(iconWrap, "menu");
        trigger.appendChild(iconWrap);
    }
    else {
        trigger.appendChild(document.createTextNode(tx("ui.reviewer.more.label", "More")));
        trigger.appendChild(makeKbd("M"));
    }
    root.appendChild(trigger);
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.className = "learnkit";
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay");
    const panel = document.createElement("div");
    panel.className = "learnkit rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 pointer-events-auto learnkit-header-menu-panel learnkit-session-more-popover";
    popover.appendChild(panel);
    const menu = document.createElement("div");
    menu.className = "learnkit flex flex-col";
    menu.setAttribute("role", "menu");
    menu.id = `${id}-menu`;
    panel.appendChild(menu);
    const addItem = (label, hotkey, onClick, disabled = false) => {
        const item = document.createElement("div");
        item.className =
            "group learnkit-session-more-item flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
        item.setAttribute("role", "menuitem");
        item.tabIndex = disabled ? -1 : 0;
        if (disabled) {
            item.classList.add("learnkit-menu-item--disabled", "learnkit-menu-item--disabled");
            item.setAttribute("aria-disabled", "true");
        }
        const labelSpan = document.createElement("span");
        labelSpan.className = "";
        labelSpan.textContent = label;
        item.appendChild(labelSpan);
        if (hotkey && !opts.compactTrigger) {
            const key = document.createElement("kbd");
            key.className = "kbd ml-auto text-xs text-muted-foreground tracking-widest";
            key.textContent = hotkey;
            item.appendChild(key);
        }
        const activate = () => {
            if (disabled)
                return;
            onClick();
            close();
        };
        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            activate();
        });
        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                activate();
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
                trigger.focus();
            }
        });
        menu.appendChild(item);
    };
    // Open Note button
    if (window.sproutOpenCurrentCardNote) {
        addItem("Open in Note", "O", window.sproutOpenCurrentCardNote, false);
    }
    addItem("Bury", "B", opts.onBury, !opts.canBurySuspend);
    addItem("Suspend", "S", opts.onSuspend, !opts.canBurySuspend);
    addItem("Undo last grade", "U", opts.onUndo, !opts.canUndo);
    addItem("Exit to Decks", "Q", opts.onExit);
    if (opts.canSkip)
        addItem("Skip card", "K", opts.onSkip);
    let cleanup = null;
    const place = () => {
        const r = trigger.getBoundingClientRect();
        const margin = 8;
        const width = Math.max(200, Math.round(panel.getBoundingClientRect().width || 0));
        let left = r.right - width;
        if (left + width > window.innerWidth - margin) {
            left = Math.max(margin, window.innerWidth - width - margin);
        }
        if (left < margin)
            left = margin;
        const panelRect = panel.getBoundingClientRect();
        // Session More menu should open upward like Note Review.
        const top = Math.max(margin, r.top - panelRect.height - 6);
        setCssProps(popover, "--learnkit-popover-left", `${left}px`);
        setCssProps(popover, "--learnkit-popover-top", `${top}px`);
        setCssProps(popover, "--learnkit-popover-width", `${width}px`);
    };
    const close = () => {
        trigger.setAttribute("aria-expanded", "false");
        popover.setAttribute("aria-hidden", "true");
        popover.classList.remove("is-open");
        try {
            cleanup === null || cleanup === void 0 ? void 0 : cleanup();
        }
        catch (e) {
            log.swallow("render-session close cleanup", e);
        }
        cleanup = null;
        try {
            popover.remove();
        }
        catch (e) {
            log.swallow("render-session close popover.remove", e);
        }
    };
    const open = () => {
        trigger.setAttribute("aria-expanded", "true");
        popover.setAttribute("aria-hidden", "false");
        popover.classList.add("is-open");
        document.body.appendChild(popover);
        requestAnimationFrame(() => place());
        const onResizeOrScroll = () => place();
        const onDocPointerDown = (ev) => {
            const t = ev.target;
            if (!t)
                return;
            if (root.contains(t) || popover.contains(t))
                return;
            close();
        };
        const onDocKeydown = (ev) => {
            if (ev.key !== "Escape")
                return;
            ev.preventDefault();
            ev.stopPropagation();
            close();
            trigger.focus();
        };
        window.addEventListener("resize", onResizeOrScroll, true);
        window.addEventListener("scroll", onResizeOrScroll, true);
        const tid = window.setTimeout(() => {
            document.addEventListener("pointerdown", onDocPointerDown, true);
            document.addEventListener("keydown", onDocKeydown, true);
        }, 0);
        cleanup = () => {
            window.clearTimeout(tid);
            window.removeEventListener("resize", onResizeOrScroll, true);
            window.removeEventListener("scroll", onResizeOrScroll, true);
            document.removeEventListener("pointerdown", onDocPointerDown, true);
            document.removeEventListener("keydown", onDocKeydown, true);
        };
    };
    trigger.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0)
            return;
        ev.preventDefault();
        ev.stopPropagation();
        const isOpen = trigger.getAttribute("aria-expanded") === "true";
        if (isOpen)
            close();
        else
            open();
    });
    return root;
}
// --- Main -------------------------------------------------------------------
/** Renders MCQ card content (single-answer and multi-answer). */
function renderMcqContent(ctx) {
    const { section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath } = ctx;
    section.appendChild(labelRow("Question", args.ttsReplayMcqQuestion, "mcq-question"));
    section.appendChild(renderMdBlock("learnkit-q", convertInlineDisplayMath(card.stem || "")));
    const reveal = !!graded || !!args.showAnswer;
    const multiAnswer = isMultiAnswerMcq(card);
    const correctSet = new Set(getCorrectIndices(card));
    if (multiAnswer && !reveal) {
        section.appendChild(labelRow("Options (select all correct answers)", args.ttsReplayMcqOptions, "mcq-options"));
    }
    else {
        section.appendChild(labelRow(reveal ? "Answer" : "Options", reveal ? args.ttsReplayMcqAnswer : args.ttsReplayMcqOptions, reveal ? "mcq-answer" : "mcq-options"));
    }
    // Only show MCQ options, not info, as answer options
    const opts = normalizeCardOptions(card.options);
    const gradedMeta = (graded === null || graded === void 0 ? void 0 : graded.meta);
    // Single-answer: mcqChoice; Multi-answer: mcqChoices
    const chosenOrigIdx = gradedMeta === null || gradedMeta === void 0 ? void 0 : gradedMeta.mcqChoice;
    const chosenOrigIndices = (gradedMeta === null || gradedMeta === void 0 ? void 0 : gradedMeta.mcqChoices)
        ? new Set(gradedMeta.mcqChoices)
        : typeof chosenOrigIdx === "number" ? new Set([chosenOrigIdx]) : new Set();
    const order = getMcqDisplayOrder(args.session, card, !!args.randomizeMcqOptions);
    // Multi-answer: track current selections (before submit)
    const multiSelected = (multiAnswer && args.mcqMultiSelected && args.mcqMultiCardId === String(card.id))
        ? args.mcqMultiSelected
        : new Set();
    const optionList = document.createElement("div");
    optionList.className = "flex flex-col gap-2 learnkit-mcq-options";
    section.appendChild(optionList);
    // Multi-answer: show Submit button when not yet graded
    // (declare early so click handlers can reference it)
    let submitBtn = null;
    order.forEach((origIdx, displayIdx) => {
        var _a;
        const opt = (_a = opts[origIdx]) !== null && _a !== void 0 ? _a : "";
        const text = typeof opt === "string" ? opt : "";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "learnkit-btn-toolbar w-full justify-start text-left h-auto py-1 mb-2";
        // Multi-answer selection state (before submit)
        if (multiAnswer && !reveal && multiSelected.has(origIdx)) {
            btn.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
        }
        // Apply correctness styles on back of card (revealed).
        if (reveal) {
            const isCorrect = correctSet.has(origIdx);
            const isChosen = chosenOrigIndices.has(origIdx);
            if (multiAnswer) {
                // Multi-answer highlighting on reveal:
                // - Any correct option is green
                // - Any incorrect selected option is red
                if (isCorrect) {
                    btn.classList.add("learnkit-mcq-correct", "learnkit-mcq-correct-highlight", "learnkit-mcq-correct-highlight");
                }
                else if (isChosen) {
                    btn.classList.add("learnkit-mcq-wrong", "learnkit-mcq-wrong-highlight", "learnkit-mcq-wrong-highlight");
                }
            }
            else {
                // Single-answer highlighting (unchanged)
                const isChosenWrong = isChosen && !isCorrect;
                if (isCorrect) {
                    btn.classList.add("learnkit-mcq-correct", "learnkit-mcq-correct-highlight", "learnkit-mcq-correct-highlight");
                }
                if (isChosenWrong) {
                    btn.classList.add("learnkit-mcq-wrong", "learnkit-mcq-wrong-highlight", "learnkit-mcq-wrong-highlight");
                }
            }
        }
        const left = document.createElement("span");
        left.className = "inline-flex items-center gap-2 min-w-0";
        const key = document.createElement("kbd");
        key.className = "kbd";
        key.textContent = String(displayIdx + 1);
        left.appendChild(key);
        // Render option text with markdown support for wiki links and LaTeX
        const textEl = document.createElement("span");
        textEl.className = "min-w-0 whitespace-pre-wrap break-words learnkit-mcq-option-text";
        // Use markdown rendering if text contains wiki links or LaTeX
        if (text && (text.includes('[[') || text.includes('$') || text.includes('\\(') || text.includes('\\['))) {
            void args.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(text), sourcePath).then(() => setupLinkHandlers(textEl, sourcePath));
        }
        else if (text && text.includes("\n")) {
            text.split(/\n+/).forEach((line) => {
                const p = document.createElement("div");
                applyInlineMarkdownWithFlags(p, line);
                p.classList.add("learnkit-mcq-option-line", "learnkit-mcq-option-line");
                textEl.appendChild(p);
            });
        }
        else {
            applyInlineMarkdownWithFlags(textEl, text);
        }
        left.appendChild(textEl);
        btn.appendChild(left);
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (graded)
                return;
            if (multiAnswer) {
                // Toggle selection in-place (no full re-render)
                if (multiSelected.has(origIdx)) {
                    multiSelected.delete(origIdx);
                    btn.classList.remove("learnkit-mcq-selected", "learnkit-mcq-selected");
                }
                else {
                    multiSelected.add(origIdx);
                    btn.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
                }
                // Sync the backing state so keyboard/render stays in sync.
                // Use set/delete (idempotent) — NOT toggle — because after a
                // re-render multiSelected may be the same reference as the
                // backing set, and toggling twice would cancel itself out.
                if (args.syncMcqMultiSelect) {
                    args.syncMcqMultiSelect(origIdx, multiSelected.has(origIdx));
                }
                // Update submit button enabled state
                if (submitBtn) {
                    submitBtn.disabled = multiSelected.size === 0;
                    submitBtn.classList.toggle("opacity-50", multiSelected.size === 0);
                    submitBtn.classList.toggle("cursor-not-allowed", multiSelected.size === 0);
                    // Reset empty-attempt counter when selection changes
                    if (multiSelected.size > 0) {
                        delete submitBtn.dataset.emptyAttempt;
                        submitBtn.removeAttribute("aria-label");
                        submitBtn.classList.remove("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                    }
                }
            }
            else {
                void args.answerMcq(origIdx);
            }
        });
        optionList.appendChild(btn);
    });
    // Multi-answer: create the Submit button here, then move it into the footer action row later.
    if (multiAnswer && !reveal) {
        submitBtn = makeTextButton({
            label: t(args.interfaceLanguage, "ui.reviewer.submit", "Submit"),
            title: t(args.interfaceLanguage, "ui.reviewer.submit", "Submit"),
            className: "learnkit-btn-toolbar learnkit-mcq-submit-btn",
            onClick: () => {
                if (multiSelected.size > 0 && args.answerMcqMulti) {
                    void args.answerMcqMulti([...multiSelected]);
                }
                else if (multiSelected.size === 0 && submitBtn) {
                    submitBtn.classList.add("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
                    submitBtn.addEventListener("animationend", () => {
                        submitBtn.classList.remove("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
                    }, { once: true });
                    // Show tooltip on second empty attempt
                    if (submitBtn.dataset.emptyAttempt === "1") {
                        submitBtn.setAttribute("aria-label", t(args.interfaceLanguage, "ui.reviewer.mcq.chooseOne", "Choose at least one answer to proceed"));
                        submitBtn.setAttribute("data-tooltip-position", "top");
                        submitBtn.classList.add("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                        setTimeout(() => {
                            submitBtn.classList.remove("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                        }, 2500);
                    }
                    submitBtn.dataset.emptyAttempt = String(Number(submitBtn.dataset.emptyAttempt || "0") + 1);
                }
            },
            kbd: "\u21B5",
        });
        submitBtn.disabled = multiSelected.size === 0;
        if (multiSelected.size === 0) {
            submitBtn.classList.add("opacity-50", "cursor-not-allowed");
        }
        optionList.appendChild(submitBtn);
    }
    // Do not render separate Answer subtitle/content for MCQ.
}
/** Renders OQ (ordering question) card content. */
function renderOqContent(ctx) {
    const { section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath } = ctx;
    // ── Ordering Question ──────────────────────────────────────────────
    section.appendChild(labelRow("Question", args.ttsReplayOqQuestion, "oq-question"));
    section.appendChild(renderMdBlock("learnkit-q", convertInlineDisplayMath(card.q || "")));
    const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
    const reveal = !!graded || !!args.showAnswer;
    const oqMeta = ((graded === null || graded === void 0 ? void 0 : graded.meta) || {});
    const userOrder = Array.isArray(oqMeta.oqUserOrder) ? oqMeta.oqUserOrder : [];
    if (!reveal) {
        // ── Front: drag-to-reorder interface ──
        section.appendChild(labelRow("Order the steps", args.ttsReplayOqSteps, "oq-steps"));
        const shuffled = getOqShuffledOrder(args.session, card, !!args.randomizeOqOrder);
        const currentOrder = shuffled.slice();
        const listWrap = document.createElement("div");
        listWrap.className = "flex flex-col gap-2 learnkit-oq-step-list";
        section.appendChild(listWrap);
        const previewController = createOqReorderPreviewController(listWrap);
        const commitReorder = (fromIdx, toIdx) => {
            if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx)
                return;
            const item = currentOrder[fromIdx];
            currentOrder.splice(fromIdx, 1);
            currentOrder.splice(toIdx, 0, item);
            // Also update the session order map
            const oqMap = ensureOqOrderMap(args.session);
            oqMap[String(card.id)] = currentOrder.slice();
            renderSteps();
        };
        listWrap.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer)
                e.dataTransfer.dropEffect = "move";
            previewController.updatePointer(e.clientY);
        });
        listWrap.addEventListener("drop", (e) => {
            e.preventDefault();
            const pending = previewController.getPendingMove();
            previewController.endDrag();
            if (!pending)
                return;
            commitReorder(pending.fromIdx, pending.toIdx);
        });
        const renderSteps = () => {
            listWrap.innerHTML = "";
            currentOrder.forEach((origIdx, displayIdx) => {
                const stepText = steps[origIdx] || "";
                const row = document.createElement("div");
                row.className = "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 learnkit-oq-step-row";
                row.draggable = true;
                row.dataset.oqIdx = String(displayIdx);
                // Grip handle
                const grip = document.createElement("span");
                grip.className = "learnkit-oq-grip inline-flex items-center justify-center text-muted-foreground cursor-grab";
                grip.draggable = false;
                setIcon(grip, "grip-vertical");
                row.appendChild(grip);
                // Step number badge
                const badge = document.createElement("kbd");
                badge.className = "kbd";
                badge.textContent = String(displayIdx + 1);
                row.appendChild(badge);
                // Step text
                const textEl = document.createElement("span");
                textEl.className = "min-w-0 whitespace-pre-wrap break-words flex-1 learnkit-oq-step-text";
                if (stepText.includes("[[") || stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[")) {
                    void args.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath).then(() => setupLinkHandlers(textEl, sourcePath));
                }
                else {
                    applyInlineMarkdownWithFlags(textEl, stepText);
                }
                row.appendChild(textEl);
                // ── Drag and drop ──
                row.addEventListener("dragstart", (e) => {
                    previewController.beginDrag({
                        fromIdx: displayIdx,
                        row,
                        dataTransfer: e.dataTransfer,
                        setDragImage: true,
                    });
                });
                row.addEventListener("dragend", () => {
                    previewController.endDrag();
                });
                // Touch drag support for mobile
                row.addEventListener("touchstart", (e) => {
                    const touch = e.touches[0];
                    if (!touch)
                        return;
                    previewController.beginDrag({
                        fromIdx: displayIdx,
                        row,
                    });
                    previewController.updatePointer(touch.clientY);
                }, { passive: true });
                row.addEventListener("touchmove", (e) => {
                    const touch = e.touches[0];
                    if (!touch)
                        return;
                    e.preventDefault();
                    previewController.updatePointer(touch.clientY);
                }, { passive: false });
                row.addEventListener("touchend", () => {
                    const pending = previewController.getPendingMove();
                    previewController.endDrag();
                    if (!pending)
                        return;
                    commitReorder(pending.fromIdx, pending.toIdx);
                });
                row.addEventListener("touchcancel", () => {
                    previewController.endDrag();
                });
                listWrap.appendChild(row);
            });
        };
        renderSteps();
    }
    else {
        // ── Back: show user order with correctness highlighting ──
        section.appendChild(labelRow("Your Order", args.ttsReplayOqAnswer, "oq-answer"));
        const answerList = document.createElement("div");
        answerList.className = "flex flex-col gap-2 learnkit-oq-answer-list";
        section.appendChild(answerList);
        const identity = Array.from({ length: steps.length }, (_, i) => i);
        const displayOrder = userOrder.length === steps.length ? userOrder : identity;
        displayOrder.forEach((origIdx, displayIdx) => {
            const stepText = steps[origIdx] || "";
            const wasInCorrectPosition = origIdx === displayIdx;
            const row = document.createElement("div");
            row.className = "flex items-center gap-2 rounded-lg border px-3 py-1 learnkit-oq-answer-row";
            if (wasInCorrectPosition) {
                row.classList.add("learnkit-oq-correct", "learnkit-oq-correct", "learnkit-oq-correct-highlight", "learnkit-oq-correct-highlight");
            }
            else {
                row.classList.add("learnkit-oq-wrong", "learnkit-oq-wrong", "learnkit-oq-wrong-highlight", "learnkit-oq-wrong-highlight");
            }
            const badge = document.createElement("kbd");
            badge.className = "kbd";
            badge.textContent = String(origIdx + 1);
            row.appendChild(badge);
            const textEl = document.createElement("span");
            textEl.className = "min-w-0 whitespace-pre-wrap break-words flex-1 learnkit-oq-step-text";
            if (stepText.includes("[[") || stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[")) {
                void args.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath).then(() => setupLinkHandlers(textEl, sourcePath));
            }
            else {
                applyInlineMarkdownWithFlags(textEl, stepText);
            }
            row.appendChild(textEl);
            answerList.appendChild(row);
        });
    }
}
export function renderSessionMode(args) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const tx = (token, fallback, vars) => t(args.interfaceLanguage, token, fallback, vars);
    const skipEnabled = !!((_a = args.enableSkipButton) !== null && _a !== void 0 ? _a : args.skipEnabled);
    const practiceMode = !!args.practiceMode;
    const four = !!args.fourButtonMode;
    const isPhoneMobile = document.body.classList.contains("is-phone");
    const applyAOS = !!args.applyAOS;
    const delayMs = Number.isFinite(args.aosDelayMs) ? Number(args.aosDelayMs) : applyAOS ? 100 : 0;
    const canUndo = !!args.canUndo && typeof args.undoLast === "function";
    const hasStartPractice = typeof args.startPractice === "function";
    const canStartPractice = !practiceMode && (!!args.canStartPractice || hasStartPractice);
    const hasCardsInScope = args.hasCardsInScope !== false;
    const card = args.currentCard();
    const id = card ? String(card.id) : "";
    const graded = ((_c = (_b = args.session) === null || _b === void 0 ? void 0 : _b.graded) === null || _c === void 0 ? void 0 : _c[id]) || null;
    const isFlashcardStudyMode = ((_d = args.session) === null || _d === void 0 ? void 0 : _d.mode) === "scheduled" || ((_e = args.session) === null || _e === void 0 ? void 0 : _e.mode) === "practice";
    // ===== Render Study Session header (persists across all card renders) =====
    renderStudySessionHeader(args.container, args.interfaceLanguage, applyAOS, {
        titleToken: "ui.reviewer.session.header.title",
        titleFallback: "Flashcards",
    });
    // ===== Root card (Basecoat) =====
    const wrap = document.createElement("div");
    wrap.className = "card w-full";
    // Optional: keep a plugin hook class for any small overrides you still want.
    wrap.classList.add("learnkit-session-card", "lk-session-card", "m-0");
    wrap.classList.toggle("learnkit-session-answer-revealed", !!args.showAnswer || !!graded);
    const resetAosState = () => {
        wrap.classList.remove("aos-init", "aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
    };
    // Always render the card, but only apply AOS for front side (not revealed)
    if (applyAOS && !args.showAnswer && !graded) {
        resetAosState();
        wrap.setAttribute("data-aos", "fade-up");
        wrap.setAttribute("data-aos-delay", String(Math.max(0, Math.floor(delayMs))));
    }
    else {
        // Remove AOS attributes if present and reset state
        wrap.removeAttribute("data-aos");
        wrap.removeAttribute("data-aos-delay");
        resetAosState();
    }
    // Fallback: force visible if AOS fails or never initializes
    setTimeout(() => {
        if (!wrap)
            return;
        const style = getComputedStyle(wrap);
        if (style.opacity === "0") {
            wrap.classList.add("learnkit-aos-fallback", "learnkit-aos-fallback");
        }
    }, 350);
    // Reset deck browser aos-once attribute if present
    if (((_g = (_f = args.container) === null || _f === void 0 ? void 0 : _f.dataset) === null || _g === void 0 ? void 0 : _g.deckBrowserAosOnce) === "1") {
        args.container.dataset.deckBrowserAosOnce = "0";
    }
    // Create section once for both empty and card-present states
    const section = document.createElement("section");
    section.className = "flex flex-col gap-3";
    // ===== Empty state rendered like a normal card =====
    if (!card) {
        section.classList.add("learnkit-session-practice-prompt", "learnkit-session-practice-prompt");
        args.clearTimer();
        args.clearCountdown();
        // Header
        const header = document.createElement("header");
        header.className = "learnkit-session-topbar";
        wrap.appendChild(header);
        const titleWrap = document.createElement("div");
        titleWrap.className = "learnkit-session-topbar-title learnkit-question-title";
        titleWrap.textContent = practiceMode
            ? tx("ui.reviewer.session.practiceComplete", "Practice complete")
            : hasCardsInScope
                ? tx("ui.reviewer.session.noCardsDue", "No cards are due")
                : tx("ui.reviewer.session.noCardsInScope", "No cards exist in this deck");
        header.appendChild(titleWrap);
        // Section: Practice session message (centered, no alert wrapper)
        if (practiceMode) {
            const d1 = document.createElement("div");
            d1.className = "text-base text-center";
            d1.textContent = tx("ui.reviewer.session.practiceSessionComplete", "Practice session complete");
            const d2 = document.createElement("div");
            d2.className = "text-sm text-center learnkit-session-practice-prompt-subtext";
            d2.textContent =
                "This was a practice session. Scheduling was not changed. You cannot bury or suspend cards in this mode.";
            section.appendChild(d1);
            section.appendChild(d2);
        }
        else {
            const d1 = document.createElement("div");
            d1.className = "text-base text-center";
            d1.textContent = hasCardsInScope
                ? tx("ui.reviewer.session.askStartPractice", "Would you like to start a practice session?")
                : tx("ui.reviewer.session.noCardsInScopeHint", "Add a card in this deck to start reviewing.");
            section.appendChild(d1);
            if (hasCardsInScope) {
                const d2 = document.createElement("div");
                d2.className = "text-sm text-center learnkit-session-practice-prompt-subtext";
                d2.textContent =
                    "Practice session reviews all cards in this deck, including ones that are not due. It does not affect scheduling. You cannot bury or suspend cards while in this mode";
                section.appendChild(d2);
            }
        }
        wrap.appendChild(section);
        // Footer: practice/return actions centered in the study dock layout
        const footer = document.createElement("footer");
        footer.className = "learnkit-session-study-dock";
        wrap.appendChild(footer);
        const footerLeft = document.createElement("div");
        footerLeft.className = "flex items-center gap-2 learnkit-session-study-dock-left";
        footer.appendChild(footerLeft);
        const footerCenter = document.createElement("div");
        footerCenter.className = "flex flex-wrap gap-2 items-center justify-center learnkit-session-study-dock-center";
        footer.appendChild(footerCenter);
        const footerRight = document.createElement("div");
        footerRight.className = "flex items-center gap-2 learnkit-session-study-dock-right";
        footer.appendChild(footerRight);
        const backBtn = makeTextButton({
            label: tx("ui.reviewer.session.returnToDecks", "Return to Decks"),
            className: "learnkit-btn-toolbar",
            onClick: () => args.backToDecks(),
            kbd: isPhoneMobile ? undefined : "Q",
        });
        const canShowPracticeStart = hasCardsInScope && hasStartPractice && (canStartPractice || practiceMode);
        if (canShowPracticeStart) {
            const startBtn = makeTextButton({
                label: tx("ui.reviewer.session.startPractice", "Start Practice"),
                className: "learnkit-btn-toolbar",
                onClick: () => { var _a; return (_a = args.startPractice) === null || _a === void 0 ? void 0 : _a.call(args); },
                kbd: isPhoneMobile ? undefined : "↵",
            });
            // For two-action empty-state footers, keep actions split left/right.
            footerLeft.appendChild(backBtn);
            footerRight.appendChild(startBtn);
        }
        else {
            // Single-action empty-state footer keeps action centered.
            footerCenter.appendChild(backBtn);
        }
        args.container.appendChild(wrap);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                try {
                    refreshAOS();
                }
                catch (e) {
                    log.swallow("render-session refreshAOS empty", e);
                }
            });
        });
        return;
    }
    // Card present
    args.clearCountdown();
    if (isFlashcardStudyMode)
        wrap.classList.add("learnkit-session-has-dock", "learnkit-session-has-dock");
    const sourcePath = card.sourceNotePath || "";
    // ===== Header =====
    const header = document.createElement("header");
    header.className = "learnkit-session-topbar";
    if (args.hideSessionTopbar)
        header.classList.add("learnkit-session-topbar-hidden", "learnkit-session-topbar-hidden");
    wrap.appendChild(header);
    // Title in topbar
    const ioLike = isIoCard(card);
    let displayTitle = card.title || "";
    // Remove cloze number suffix (e.g., " • c1", " • c2", etc.) from cloze cards
    if (card.type === "cloze" || card.type === "cloze-child") {
        displayTitle = displayTitle.replace(/\s*•\s*c\d+\s*$/, "");
    }
    // Remove direction suffix (e.g., " • Q→A", " • A→Q") from reversed-child cards
    if (card.type === "reversed-child") {
        displayTitle = displayTitle.replace(/\s*•\s*[AQ]\u2192[AQ]\s*$/, "");
    }
    // Hide title if it is just the card-type label (not a real user-provided title)
    const TYPE_LABELS = new Set(["basic", "basic (reversed)", "cloze", "multiple choice", "image occlusion", "ordered question", "flashcard"]);
    if (TYPE_LABELS.has(displayTitle.toLowerCase()))
        displayTitle = "";
    const titleText = displayTitle || fallbackQuestionTitle(args.session, card);
    const titleWrap = document.createElement("div");
    titleWrap.className = "learnkit-session-topbar-title learnkit-question-title";
    header.appendChild(titleWrap);
    const titleEl = titleWrap;
    // Render title as markdown to support wiki links and LaTeX
    const titleMd = String(titleText !== null && titleText !== void 0 ? titleText : "");
    if (titleMd.includes('[[') || titleMd.includes('$')) {
        void args.renderMarkdownInto(titleEl, titleMd, sourcePath).then(() => setupLinkHandlers(titleEl, sourcePath));
    }
    else {
        applyInlineMarkdownWithFlags(titleEl, titleMd);
    }
    // ===== Content =====
    const mutedLabel = (s) => h("div", "text-muted-foreground text-sm font-medium", s);
    /** Build a "Question" or "Answer" label row with an optional TTS replay button. */
    const labelRow = (text, replayFn, ttsField) => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between learnkit-label-row";
        row.appendChild(mutedLabel(text));
        if (args.ttsEnabled && replayFn) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn-icon learnkit-tts-replay-btn";
            btn.setAttribute("aria-label", t(args.interfaceLanguage, "ui.reviewer.tts.readAloud", "Read {text} aloud", { text: text.toLowerCase() }));
            btn.setAttribute("data-tooltip-position", "top");
            if (ttsField)
                btn.setAttribute("data-tts-field", ttsField);
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                markTtsButtonActive(btn);
                replayFn();
            });
            row.appendChild(btn);
            bindTtsPlayingState(btn);
        }
        return row;
    };
    const setupLinkHandlers = (rootEl, srcPath) => {
        const app = window === null || window === void 0 ? void 0 : window.app;
        const links = rootEl.querySelectorAll("a");
        links.forEach((link) => {
            link.addEventListener("click", (e) => {
                var _a;
                const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
                if (!href)
                    return;
                e.preventDefault();
                e.stopPropagation();
                const isExternal = /^(https?:|mailto:|tel:)/i.test(href);
                if (isExternal) {
                    window.open(href, "_blank", "noopener");
                    return;
                }
                if ((_a = app === null || app === void 0 ? void 0 : app.workspace) === null || _a === void 0 ? void 0 : _a.openLinkText) {
                    void app.workspace.openLinkText(href, srcPath || "", true);
                }
                else {
                    window.open(href, "_blank", "noopener");
                }
            });
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "noopener");
        });
    };
    const renderMdBlock = (cls, md) => {
        const block = document.createElement("div");
        block.className = `bc ${cls} whitespace-pre-wrap break-words learnkit-md-block`;
        void args.renderMarkdownInto(block, md !== null && md !== void 0 ? md : "", sourcePath).then(() => setupLinkHandlers(block, sourcePath));
        return block;
    };
    if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") {
        // For reversed-child with direction "back", swap content (A→Q)
        const isBackDirection = card.type === "reversed-child" && card.reversedDirection === "back";
        const isOldReversed = card.type === "reversed";
        const frontContent = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
        const backContent = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
        const replayFront = card.type === "basic" ? args.ttsReplayFront : undefined;
        const replayBack = card.type === "basic" ? args.ttsReplayBack : undefined;
        section.appendChild(labelRow("Question", replayFront));
        section.appendChild(renderMdBlock("learnkit-q", convertInlineDisplayMath(frontContent)));
        if (args.showAnswer || graded) {
            section.appendChild(labelRow("Answer", replayBack));
            section.appendChild(renderMdBlock("learnkit-a", convertInlineDisplayMath(backContent)));
        }
    }
    else if (card.type === "cloze" || card.type === "cloze-child") {
        const text = String(card.clozeText || "");
        const reveal = args.showAnswer || !!graded;
        const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;
        section.appendChild(labelRow(reveal ? "Answer" : "Question", reveal ? args.ttsReplayBack : args.ttsReplayFront));
        const clozContainer = document.createElement("div");
        clozContainer.className = "learnkit-cloze whitespace-pre-wrap break-words learnkit-md-block";
        if (text.includes("$") || text.includes("\\(") || text.includes("\\[") || text.includes("[[")) {
            const clozeOpts = args.getClozeRenderOptions();
            const processedText = processClozeForMath(text, reveal, targetIndex, {
                blankClassName: "learnkit-cloze-blank hidden-cloze",
                useHintText: clozeOpts.mode !== "typed",
            });
            void args.renderMarkdownInto(clozContainer, processedText, sourcePath).then(() => {
                setupLinkHandlers(clozContainer, sourcePath);
                hydrateRenderedMathCloze(clozContainer, text, reveal, targetIndex, clozeOpts);
            });
        }
        else {
            const clozeContent = args.renderClozeFront(text, reveal, targetIndex, undefined);
            if (reveal) {
                const span = document.createElement("span");
                span.className = "whitespace-pre-wrap break-words";
                span.appendChild(clozeContent);
                clozContainer.appendChild(span);
            }
            else {
                clozContainer.appendChild(clozeContent);
            }
        }
        section.appendChild(clozContainer);
    }
    else if (card.type === "mcq") {
        renderMcqContent({ section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath });
    }
    else if (card.type === "oq") {
        renderOqContent({ section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath });
    }
    else if (ioLike) {
        const reveal = !!graded || !!args.showAnswer;
        const ioHost = document.createElement("div");
        ioHost.className = "learnkit-io-host";
        ioHost.dataset.sproutIoWidget = "1";
        section.appendChild(ioHost);
        if (typeof args.renderImageOcclusionInto === "function") {
            void args.renderImageOcclusionInto(ioHost, card, sourcePath, reveal);
        }
        else {
            const md = String((_h = card.imageRef) !== null && _h !== void 0 ? _h : "");
            if (md.trim())
                void args.renderMarkdownInto(ioHost, md, sourcePath).then(() => setupLinkHandlers(ioHost, sourcePath));
            else
                ioHost.appendChild(h("div", "text-muted-foreground text-sm", "IO card missing image source."));
        }
    }
    const infoText = extractInfoField(card);
    const isBack = !!graded || !!args.showAnswer;
    const shouldShowInfo = ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") && isBack && !!infoText) || ((args.showInfo || graded) && !!infoText);
    if (shouldShowInfo) {
        section.appendChild(labelRow("Extra information"));
        section.appendChild(renderMdBlock("learnkit-info", infoText));
    }
    // Append section to wrap
    wrap.appendChild(section);
    // ===== Footer (actions) =====
    const footer = document.createElement("footer");
    footer.className = "learnkit-session-study-dock";
    wrap.appendChild(footer);
    // Left: Edit button
    const footerLeft = document.createElement("div");
    footerLeft.className = "flex items-center gap-2 learnkit-session-study-dock-left";
    const editBtn = isPhoneMobile
        ? makeTextButton({
            label: "",
            title: t(args.interfaceLanguage, "ui.reviewer.edit", "Edit"),
            className: "learnkit-btn-toolbar lk-review-edit-icon-btn",
            onClick: () => {
                var _a;
                (_a = args.openEditModal) === null || _a === void 0 ? void 0 : _a.call(args);
            },
        })
        : makeTextButton({
            label: t(args.interfaceLanguage, "ui.reviewer.edit", "Edit"),
            className: "learnkit-btn-toolbar",
            onClick: () => {
                var _a;
                (_a = args.openEditModal) === null || _a === void 0 ? void 0 : _a.call(args);
            },
            kbd: "E",
        });
    if (isPhoneMobile) {
        editBtn.setAttribute("aria-label", t(args.interfaceLanguage, "ui.reviewer.edit", "Edit"));
        const iconWrap = document.createElement("span");
        iconWrap.className = "inline-flex items-center justify-center";
        setIcon(iconWrap, "pencil");
        editBtn.appendChild(iconWrap);
        const editLabel = document.createElement("span");
        editLabel.className = "";
        editLabel.setAttribute("data-learnkit-mobile-label", "true");
        editLabel.textContent = t(args.interfaceLanguage, "ui.reviewer.edit", "Edit");
        editBtn.appendChild(editLabel);
    }
    footerLeft.appendChild(editBtn);
    footer.appendChild(footerLeft);
    // Center: Reveal/Grade/Next buttons
    const footerCenter = document.createElement("div");
    footerCenter.className = "flex flex-wrap gap-2 items-center justify-center learnkit-session-study-dock-center";
    footer.appendChild(footerCenter);
    const canGradeNow = !graded &&
        ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || card.type === "cloze" || card.type === "cloze-child" || ioLike) && !!args.showAnswer);
    // Grading / next buttons (in center)
    const mainRow = document.createElement("div");
    mainRow.className = "flex flex-wrap items-center justify-center gap-2 learnkit-session-study-dock-buttons";
    let hasMainRowContent = false;
    // Basic/Cloze/IO: reveal gate
    if ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || card.type === "cloze" || card.type === "cloze-child" || ioLike) &&
        !args.showAnswer &&
        !graded) {
        mainRow.appendChild(makeTextButton({
            label: "Reveal",
            className: "learnkit-btn-toolbar",
            onClick: () => {
                args.setShowAnswer(true);
                args.rerender();
            },
            kbd: isPhoneMobile ? undefined : "↵",
        }));
        hasMainRowContent = true;
    }
    if (!graded) {
        if (canGradeNow) {
            const goNext = () => void args.nextCard(true);
            const showIntervals = !!args.showGradeIntervals &&
                !!args.schedulingSettings &&
                !!args.getCardStateForPreview;
            const previewNow = Date.now();
            const previewState = showIntervals
                ? (_k = (_j = args.getCardStateForPreview) === null || _j === void 0 ? void 0 : _j.call(args, String(card.id), previewNow)) !== null && _k !== void 0 ? _k : null
                : null;
            const getSubtitle = (rating) => {
                var _a;
                if (!previewState || !args.schedulingSettings)
                    return undefined;
                return ((_a = getRatingIntervalPreview({
                    state: previewState,
                    rating,
                    now: previewNow,
                    scheduling: args.schedulingSettings,
                })) !== null && _a !== void 0 ? _a : undefined);
            };
            // Practice mode: single Continue button
            if (practiceMode) {
                const continueBtn = makeTextButton({
                    label: "Continue",
                    className: "learnkit-btn-toolbar",
                    onClick: goNext,
                    kbd: isPhoneMobile ? undefined : "↵",
                });
                mainRow.appendChild(continueBtn);
                hasMainRowContent = true;
            }
            else {
                // Normal mode: grading buttons
                const group = document.createElement("div");
                group.className = "flex flex-wrap justify-center gap-2 learnkit-session-study-dock-grade-group";
                mainRow.appendChild(group);
                hasMainRowContent = true;
                const againBtn = makeTextButton({
                    label: "Again",
                    subtitle: getSubtitle("again"),
                    title: "Grade question as again (1)",
                    className: "btn-destructive",
                    onClick: () => void args.gradeCurrentRating("again", {}).then(goNext),
                    kbd: "1",
                });
                againBtn.classList.add("learnkit-btn-again", "learnkit-btn-again");
                group.appendChild(againBtn);
                if (four) {
                    const hardBtn = makeTextButton({
                        label: "Hard",
                        subtitle: getSubtitle("hard"),
                        title: "Grade question as hard (2)",
                        className: "btn",
                        onClick: () => void args.gradeCurrentRating("hard", {}).then(goNext),
                        kbd: "2",
                    });
                    hardBtn.classList.add("learnkit-btn-hard", "learnkit-btn-hard");
                    group.appendChild(hardBtn);
                    const goodBtn = makeTextButton({
                        label: "Good",
                        subtitle: getSubtitle("good"),
                        title: "Grade question as good (3)",
                        className: "btn",
                        onClick: () => void args.gradeCurrentRating("good", {}).then(goNext),
                        kbd: "3",
                    });
                    goodBtn.classList.add("learnkit-btn-good", "learnkit-btn-good");
                    group.appendChild(goodBtn);
                    const easyBtn = makeTextButton({
                        label: "Easy",
                        subtitle: getSubtitle("easy"),
                        title: "Grade question as easy (4)",
                        className: "btn",
                        onClick: () => void args.gradeCurrentRating("easy", {}).then(goNext),
                        kbd: "4",
                    });
                    easyBtn.classList.add("learnkit-btn-easy", "learnkit-btn-easy");
                    group.appendChild(easyBtn);
                }
                else {
                    const goodBtn = makeTextButton({
                        label: "Good",
                        subtitle: getSubtitle("good"),
                        title: "Grade question as good (2)",
                        className: "btn",
                        onClick: () => void args.gradeCurrentRating("good", {}).then(goNext),
                        kbd: "2",
                    });
                    goodBtn.classList.add("learnkit-btn-good", "learnkit-btn-good");
                    group.appendChild(goodBtn);
                }
            }
            if (skipEnabled) {
                const skipBtn = makeTextButton({
                    label: "Skip",
                    title: "Skip card (↵)",
                    className: "learnkit-btn-toolbar",
                    onClick: () => args.skipCurrentCard({ uiSource: "skip-btn", uiKey: 13, uiButtons: four ? 4 : 2 }),
                    kbd: "↵",
                });
                skipBtn.dataset.bcAction = "skip-card";
                mainRow.appendChild(skipBtn);
            }
        }
        else if (card.type === "mcq") {
            const multiAnswerMcq = isMultiAnswerMcq(card);
            const mcqSubmitBtn = multiAnswerMcq && !graded && !args.showAnswer
                ? section.querySelector(".learnkit-mcq-submit-btn")
                : null;
            if (mcqSubmitBtn) {
                mainRow.appendChild(mcqSubmitBtn);
                hasMainRowContent = true;
            }
            else if (!multiAnswerMcq) {
                const optCount = (card.options || []).length;
                mainRow.appendChild(h("div", "text-muted-foreground text-sm", `Choose 1–${optCount}.`));
                hasMainRowContent = true;
            }
        }
        else if (card.type === "oq") {
            const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
            const n = steps.length;
            const identity = Array.from({ length: n }, (_, i) => i);
            mainRow.appendChild(makeTextButton({
                label: t(args.interfaceLanguage, "ui.reviewer.oq.submitOrder", "Submit order"),
                className: "learnkit-btn-toolbar",
                onClick: () => {
                    const oqMap = ensureOqOrderMap(args.session);
                    const currentOrder = oqMap[String(card.id)];
                    const orderToSubmit = isPermutation(currentOrder, n) ? currentOrder.slice() : identity;
                    void args.answerOq(orderToSubmit);
                },
                kbd: "↵",
            }));
            hasMainRowContent = true;
        }
        else if (ioLike && !args.showAnswer) {
            mainRow.appendChild(h("div", "text-muted-foreground text-sm", "Press Enter to reveal the image."));
            hasMainRowContent = true;
        }
    }
    else {
        mainRow.appendChild(makeTextButton({
            label: "Next",
            className: "learnkit-btn-toolbar",
            onClick: () => void args.nextCard(true),
            kbd: "↵",
        }));
        hasMainRowContent = true;
    }
    // Only append mainRow if it has content
    if (hasMainRowContent) {
        footerCenter.appendChild(mainRow);
    }
    // Right: More menu
    const footerRight = document.createElement("div");
    footerRight.className = "flex items-center gap-2 learnkit-session-study-dock-right";
    // Provide open note handler globally for menu
    window.sproutOpenCurrentCardNote = () => {
        var _a;
        if (!card)
            return;
        const filePath = card.sourceNotePath;
        if (!filePath)
            return;
        const app = window.app;
        if (app) {
            void openCardAnchorInNote(app, filePath, String((_a = card.id) !== null && _a !== void 0 ? _a : ""));
        }
    };
    footerRight.appendChild(makeHeaderMenu({
        canUndo,
        onUndo: () => { var _a; return (_a = args.undoLast) === null || _a === void 0 ? void 0 : _a.call(args); },
        canBurySuspend: !!args.canBurySuspend,
        onBury: () => { var _a; return (_a = args.buryCurrentCard) === null || _a === void 0 ? void 0 : _a.call(args); },
        onSuspend: () => { var _a; return (_a = args.suspendCurrentCard) === null || _a === void 0 ? void 0 : _a.call(args); },
        canSkip: skipEnabled && !!card && !graded,
        onSkip: () => args.skipCurrentCard({ uiSource: "footer-menu" }),
        onExit: () => args.backToDecks(),
        compactTrigger: isPhoneMobile,
        interfaceLanguage: args.interfaceLanguage,
    }));
    if (isPhoneMobile) {
        const moreBtn = footerRight.querySelector(".lk-review-more-icon-btn");
        if (moreBtn && !moreBtn.querySelector("[data-learnkit-mobile-label]")) {
            const menuLabel = document.createElement("span");
            menuLabel.className = "";
            menuLabel.setAttribute("data-learnkit-mobile-label", "true");
            menuLabel.textContent = t(args.interfaceLanguage, "ui.reviewer.more.label", "Menu");
            moreBtn.appendChild(menuLabel);
        }
    }
    footer.appendChild(footerRight);
    args.container.appendChild(wrap);
    // Always refresh AOS to ensure animations work across the page
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try {
                refreshAOS();
            }
            catch (e) {
                log.swallow("render-session refreshAOS card", e);
            }
        });
    });
}
