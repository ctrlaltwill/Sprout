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
import { renderStudySessionHeader } from "./study-session-header";
import type { Scope, Session, Rating } from "./types";
import type { CardRecord } from "../../platform/core/store";
import { normalizeCardOptions } from "../../platform/core/store";
import { getCorrectIndices, isMultiAnswerMcq } from "../../platform/types/card";
import type { ClozeRenderOptions } from "./question-cloze";
import { openCardAnchorInNote } from "../../platform/core/open-card-anchor";
import { processClozeForMath, convertInlineDisplayMath, forceSingleLineDisplayMathInline } from "../../platform/core/shared-utils";
import { hydrateCircleFlagsInElement, processCircleFlagsInMarkdown } from "../../platform/flags/flag-tokens";
import { t } from "../../platform/translations/translator";
import { getRatingIntervalPreview } from "../../platform/core/grade-intervals";
import type { CardState, SchedulerSettings } from "../../platform/types/scheduler";

declare global {
  interface Window {
    sproutOpenCurrentCardNote?: () => void;
  }
}

type Args = {
  container: HTMLElement;
  interfaceLanguage?: string;

  session: Session;
  showAnswer: boolean;
  setShowAnswer: (v: boolean) => void;

  currentCard: () => CardRecord | null;

  // navigation
  backToDecks: () => void;
  nextCard: (userInitiated: boolean) => Promise<void> | void;

  // grading
  gradeCurrentRating: (rating: Rating, meta: Record<string, unknown> | null) => Promise<void>;
  answerMcq: (choiceIdx: number) => Promise<void>;
  answerMcqMulti?: (selectedIndices: number[]) => Promise<void>;
  mcqMultiSelected?: Set<number>;
  mcqMultiCardId?: string;
  syncMcqMultiSelect?: (origIdx: number, selected: boolean) => void;
  answerOq: (userOrder: number[]) => Promise<void>;

  // skip (session-only postpone; no scheduling changes)
  enableSkipButton?: boolean;
  skipEnabled?: boolean;
  skipCurrentCard: (meta?: Record<string, unknown>) => void;

  // bury / suspend
  canBurySuspend?: boolean;
  buryCurrentCard?: () => void;
  suspendCurrentCard?: () => void;

  // undo
  canUndo?: boolean;
  undoLast?: () => void;

  // practice empty-state (optional)
  practiceMode?: boolean;
  canStartPractice?: boolean;
  startPractice?: () => void;
  coachSessionMode?: boolean;
  coachEmptyTitle?: string;
  coachBackLabel?: string;

  // info / countdown
  showInfo: boolean;
  clearTimer: () => void;
  clearCountdown: () => void;
  getNextDueInScope: (scope: Scope) => number | null;
  startCountdown: (nextDue: number, lineEl: HTMLElement) => void;

  // cloze rendering
  renderClozeFront: (text: string, reveal: boolean, targetIndex?: number | null, opts?: ClozeRenderOptions) => HTMLElement;

  // markdown rendering
  renderMarkdownInto: (containerEl: HTMLElement, md: string, sourcePath: string) => Promise<void>;

  // ✅ IO rendering hook (provided by reviewer.ts)
  renderImageOcclusionInto?: (
    containerEl: HTMLElement,
    card: CardRecord,
    sourcePath: string,
    reveal: boolean,
  ) => Promise<void>;

  // MCQ option randomisation
  randomizeMcqOptions: boolean;
  randomizeOqOrder: boolean;

  // grading mode
  fourButtonMode?: boolean;
  showGradeIntervals?: boolean;
  schedulingSettings?: SchedulerSettings;
  getCardStateForPreview?: (cardId: string, now: number) => CardState | null;

  // edit modal
  openEditModal?: () => void;

  // AOS animation control
  applyAOS?: boolean;
  aosDelayMs?: number;

  // TTS replay
  ttsEnabled?: boolean;
  ttsReplayFront?: () => void;
  ttsReplayBack?: () => void;

  /** Hide the card-title topbar inside the session card. */
  hideSessionTopbar?: boolean;

  rerender: () => void;
};

/** Shared rendering context passed to per-card-type helpers. */
interface CardRenderCtx {
  section: HTMLElement;
  labelRow: (text: string, replayFn?: () => void) => HTMLElement;
  renderMdBlock: (cls: string, md: string) => HTMLElement;
  setupLinkHandlers: (rootEl: HTMLElement, srcPath: string) => void;
  args: Args;
  card: CardRecord;
  graded: { meta?: Record<string, unknown> } | null;
  sourcePath: string;
}

function applyInlineMarkdownWithFlags(target: HTMLElement, raw: string): void {
  applyInlineMarkdown(target, processCircleFlagsInMarkdown(raw));
  hydrateCircleFlagsInElement(target);
}

const QUESTION_NUMBER_WORDS: string[] = [
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

function toQuestionOrdinalWord(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  return QUESTION_NUMBER_WORDS[safe] ?? String(safe);
}

function pageNameFromSourcePath(sourcePath: string): string {
  const clean = String(sourcePath || "").trim().replace(/\\/g, "/");
  if (!clean) return "Page";
  const leaf = clean
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .pop() || "";
  const noExt = leaf.replace(/\.md$/i, "").trim();
  return noExt || "Page";
}

function questionNumberWithinNote(session: Session, card: CardRecord): number {
  const currentId = String(card.id || "");
  const sourcePath = String(card.sourceNotePath || "").trim().toLowerCase();
  if (!sourcePath) return 1;

  const noteCards = (session?.queue || [])
    .filter((entry) => String(entry?.sourceNotePath || "").trim().toLowerCase() === sourcePath)
    .slice()
    .sort((a, b) => {
      const lineDelta = (Number(a?.sourceStartLine) || 0) - (Number(b?.sourceStartLine) || 0);
      if (lineDelta !== 0) return lineDelta;
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });

  const idx = noteCards.findIndex((entry) => String(entry?.id || "") === currentId);
  return idx >= 0 ? idx + 1 : 1;
}

function fallbackQuestionTitle(session: Session, card: CardRecord): string {
  const page = pageNameFromSourcePath(String(card.sourceNotePath || ""));
  const questionWord = toQuestionOrdinalWord(questionNumberWithinNote(session, card));
  return `${page} \u2013 Question ${questionWord}`;
}

function extractInfoField(card: CardRecord): string | null {
  if (!card) return null;

  const pick = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim()) return v.trim();
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
 * - Your PostCSS scoper produces selectors like `.sprout-btn-toolbar.bc`, `div.card.bc`, etc.
 *   so the presence of class `bc` is required for those rules to match.
 */
function h(tag: string, className?: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className && className.trim() ? `bc ${className}` : "bc";
  if (typeof text === "string") node.textContent = text;
  return node;
}

function makeKbd(label: string) {
  const k = document.createElement("kbd");
  k.className = "bc kbd ml-2";
  k.textContent = label;
  return k;
}

function appendKbdRight(btn: HTMLElement, label: string) {
  btn.appendChild(makeKbd(label));
}

function makeTextButton(opts: {
  label: string;
  subtitle?: string;
  title?: string;
  className: string;
  onClick: () => void;
  kbd?: string;
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className.split(/\s+/).includes("bc") ? opts.className : `bc ${opts.className}`;
  if (btn.classList.contains("sprout-btn-toolbar")) {
    btn.classList.add("sprout-btn-filter");
  }
  if (opts.subtitle) {
    btn.classList.add("sprout-grade-btn-with-interval");
    const labelWrap = document.createElement("span");
    labelWrap.className = "bc sprout-grade-btn-label-wrap";

    const labelLine = document.createElement("span");
    labelLine.className = "bc sprout-grade-btn-label";
    labelLine.textContent = opts.label;

    const subtitleLine = document.createElement("span");
    subtitleLine.className = "bc sprout-grade-btn-subtitle";
    subtitleLine.textContent = opts.subtitle;

    labelWrap.appendChild(labelLine);
    labelWrap.appendChild(subtitleLine);
    btn.appendChild(labelWrap);
  } else {
    btn.textContent = opts.label;
  }
  btn.setAttribute("aria-label", opts.title || opts.label);
  btn.setAttribute("data-tooltip-position", "top");

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });

  if (opts.kbd) appendKbdRight(btn, opts.kbd);
  return btn;
}

// --- IO helpers --------------------------------------------------------------

function isIoCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "io" || t === "io-child";
}

// --- MCQ option order --------------------------------------------------------

function ensureMcqOrderMap(session: Session): Record<string, number[]> {
  if (!session.mcqOrderMap || typeof session.mcqOrderMap !== "object") session.mcqOrderMap = {};
  return session.mcqOrderMap;
}

function isPermutation(arr: unknown, n: number): boolean {
  if (!Array.isArray(arr) || arr.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const raw of arr) {
    const x = Number(raw);
    if (!Number.isInteger(x) || x < 0 || x >= n) return false;
    if (seen[x]) return false;
    seen[x] = true;
  }
  return true;
}

function shuffleInPlace(a: number[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
}

function getMcqDisplayOrder(session: Session, card: CardRecord, enabled: boolean): number[] {
  const opts = card?.options || [];
  const n = Array.isArray(opts) ? opts.length : 0;
  const identity = Array.from({ length: n }, (_, i) => i);

  if (!enabled) return identity;
  if (!session) return identity;

  const id = String(card?.id ?? "");
  if (!id) return identity;

  const map = ensureMcqOrderMap(session);
  const existing = map[id];
  if (isPermutation(existing, n)) return existing;

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
function ensureOqOrderMap(session: Session): Record<string, number[]> {
  const s = session as unknown as { oqOrderMap?: Record<string, number[]> };
  if (!s.oqOrderMap || typeof s.oqOrderMap !== "object") s.oqOrderMap = {};
  return s.oqOrderMap;
}

/** Get a shuffled initial display order for OQ steps. */
function getOqShuffledOrder(session: Session, card: CardRecord, enabled: boolean): number[] {
  const steps = card?.oqSteps || [];
  const n = Array.isArray(steps) ? steps.length : 0;
  const identity = Array.from({ length: n }, (_, i) => i);

  if (!session || !n) return identity;

  const id = String(card?.id ?? "");
  if (!id) return identity;

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
      if (next[i] !== i) { same = false; break; }
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

function makeHeaderMenu(opts: {
  interfaceLanguage?: string;
  canUndo: boolean;
  onUndo: () => void;
  canSkip: boolean;
  onSkip: () => void;
  canBurySuspend: boolean;
  onBury: () => void;
  onSuspend: () => void;
  onExit: () => void;
  compactTrigger?: boolean;
}) {
  const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
    t(opts.interfaceLanguage, token, fallback, vars);
  const id = `bc-menu-${Math.random().toString(36).slice(2, 8)}`;

  const root = document.createElement("div");
  root.id = id;
  root.className = "bc relative inline-flex";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = `${id}-trigger`;
  trigger.className = "bc sprout-btn-toolbar sprout-btn-filter";
  trigger.dataset.bcAction = "reviewer-more-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", `${id}-menu`);
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", tx("ui.reviewer.more.tooltip", "More actions"));
  if (opts.compactTrigger) {
    trigger.classList.add("lk-review-more-icon-btn");
    trigger.setAttribute("aria-label", tx("ui.reviewer.more.tooltip", "More actions"));
    const iconWrap = document.createElement("span");
    iconWrap.className = "bc inline-flex items-center justify-center";
    setIcon(iconWrap, "menu");
    trigger.appendChild(iconWrap);
  } else {
    trigger.appendChild(document.createTextNode(tx("ui.reviewer.more.label", "More")));
    trigger.appendChild(makeKbd("M"));
  }
  root.appendChild(trigger);

  const popover = document.createElement("div");
  popover.id = `${id}-popover`;
  popover.className = "bc sprout";
  popover.setAttribute("aria-hidden", "true");
  popover.classList.add("sprout-popover-overlay");

  const panel = document.createElement("div");
  panel.className = "bc sprout rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 pointer-events-auto sprout-header-menu-panel sprout-session-more-popover";
  popover.appendChild(panel);

  const menu = document.createElement("div");
  menu.className = "bc sprout flex flex-col";
  menu.setAttribute("role", "menu");
  menu.id = `${id}-menu`;
  
  panel.appendChild(menu);

  const addItem = (label: string, hotkey: string | null, onClick: () => void, disabled = false) => {
    const item = document.createElement("div");
    item.className =
      "bc group sprout-session-more-item flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
    item.setAttribute("role", "menuitem");
    item.tabIndex = disabled ? -1 : 0;
    if (disabled) {
      item.classList.add("sprout-menu-item--disabled");
      item.setAttribute("aria-disabled", "true");
    }

    const labelSpan = document.createElement("span");
    labelSpan.className = "bc";
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    if (hotkey && !opts.compactTrigger) {
      const key = document.createElement("kbd");
      key.className = "bc kbd ml-auto text-xs text-muted-foreground tracking-widest";
      key.textContent = hotkey;
      item.appendChild(key);
    }

    const activate = () => {
      if (disabled) return;
      onClick();
      close();
    };

    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activate();
    });

    item.addEventListener("keydown", (e: KeyboardEvent) => {
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
  if (opts.canSkip) addItem("Skip card", "K", opts.onSkip);

  let cleanup: (() => void) | null = null;

  const place = () => {
    const r = trigger.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(200, Math.round(panel.getBoundingClientRect().width || 0));

    let left = r.right - width;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    if (left < margin) left = margin;

    const panelRect = panel.getBoundingClientRect();
    // Session More menu should open upward like Note Review.
    const top = Math.max(margin, r.top - panelRect.height - 6);

    setCssProps(popover, "--sprout-popover-left", `${left}px`);
    setCssProps(popover, "--sprout-popover-top", `${top}px`);
    setCssProps(popover, "--sprout-popover-width", `${width}px`);
  };

  const close = () => {
    trigger.setAttribute("aria-expanded", "false");
    popover.setAttribute("aria-hidden", "true");
    popover.classList.remove("is-open");

    try {
      cleanup?.();
    } catch (e) { log.swallow("render-session close cleanup", e); }
    cleanup = null;

    try {
      popover.remove();
    } catch (e) { log.swallow("render-session close popover.remove", e); }
  };

  const open = () => {
    trigger.setAttribute("aria-expanded", "true");
    popover.setAttribute("aria-hidden", "false");
    popover.classList.add("is-open");

    document.body.appendChild(popover);
    requestAnimationFrame(() => place());

    const onResizeOrScroll = () => place();
    const onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (root.contains(t) || popover.contains(t)) return;
      close();
    };
    const onDocKeydown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
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

  trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();

    const isOpen = trigger.getAttribute("aria-expanded") === "true";
    if (isOpen) close();
    else open();
  });

  return root;
}

// --- Main -------------------------------------------------------------------

/** Renders MCQ card content (single-answer and multi-answer). */
function renderMcqContent(ctx: CardRenderCtx): void {
  const { section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath } = ctx;
  section.appendChild(labelRow("Question"));
  section.appendChild(renderMdBlock("bc-q", convertInlineDisplayMath(card.stem || "")));
  const reveal = !!graded || !!args.showAnswer;
  const multiAnswer = isMultiAnswerMcq(card);
  const correctSet = new Set(getCorrectIndices(card));

  if (multiAnswer && !reveal) {
    section.appendChild(labelRow("Options (select all correct answers)"));
  } else {
    section.appendChild(labelRow(reveal ? "Answer" : "Options"));
  }

  // Only show MCQ options, not info, as answer options
  const opts = normalizeCardOptions(card.options);
  const gradedMeta = (graded?.meta);
  // Single-answer: mcqChoice; Multi-answer: mcqChoices
  const chosenOrigIdx = gradedMeta?.mcqChoice;
  const chosenOrigIndices: Set<number> = gradedMeta?.mcqChoices
    ? new Set((gradedMeta.mcqChoices as number[]))
    : typeof chosenOrigIdx === "number" ? new Set([chosenOrigIdx]) : new Set<number>();
  const order = getMcqDisplayOrder(args.session, card, !!args.randomizeMcqOptions);

  // Multi-answer: track current selections (before submit)
  const multiSelected = (multiAnswer && args.mcqMultiSelected && args.mcqMultiCardId === String(card.id))
    ? args.mcqMultiSelected
    : new Set<number>();

  const optionList = document.createElement("div");
  optionList.className = "bc flex flex-col gap-2 sprout-mcq-options";
  section.appendChild(optionList);

  // Multi-answer: show Submit button when not yet graded
  // (declare early so click handlers can reference it)
  let submitBtn: HTMLButtonElement | null = null;

  order.forEach((origIdx: number, displayIdx: number) => {
    const opt = opts[origIdx] ?? "";
    const text = typeof opt === "string" ? opt : "";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bc sprout-btn-toolbar w-full justify-start text-left h-auto py-2 mb-2";

    // Multi-answer selection state (before submit)
    if (multiAnswer && !reveal && multiSelected.has(origIdx)) {
      btn.classList.add("sprout-mcq-selected");
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
          btn.classList.add("bc-mcq-correct", "sprout-mcq-correct-highlight");
        } else if (isChosen) {
          btn.classList.add("bc-mcq-wrong", "sprout-mcq-wrong-highlight");
        }
      } else {
        // Single-answer highlighting (unchanged)
        const isChosenWrong = isChosen && !isCorrect;
        if (isCorrect) {
          btn.classList.add("bc-mcq-correct", "sprout-mcq-correct-highlight");
        }
        if (isChosenWrong) {
          btn.classList.add("bc-mcq-wrong", "sprout-mcq-wrong-highlight");
        }
      }
    }

    const left = document.createElement("span");
    left.className = "bc inline-flex items-center gap-2 min-w-0";

    const key = document.createElement("kbd");
    key.className = "bc kbd";
    key.textContent = String(displayIdx + 1);
    left.appendChild(key);

    // Render option text with markdown support for wiki links and LaTeX
    const textEl = document.createElement("span");
    textEl.className = "bc min-w-0 whitespace-pre-wrap break-words sprout-mcq-option-text";

    // Use markdown rendering if text contains wiki links or LaTeX
    if (text && (text.includes('[[') || text.includes('$') || text.includes('\\(') || text.includes('\\['))) {
      void args.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(text), sourcePath).then(() => setupLinkHandlers(textEl, sourcePath));
    } else if (text && text.includes("\n")) {
      text.split(/\n+/).forEach((line: string) => {
        const p = document.createElement("div");
        applyInlineMarkdownWithFlags(p, line);
        p.classList.add("sprout-mcq-option-line");
        textEl.appendChild(p);
      });
    } else {
      applyInlineMarkdownWithFlags(textEl, text);
    }
    left.appendChild(textEl);

    btn.appendChild(left);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (graded) return;
      if (multiAnswer) {
        // Toggle selection in-place (no full re-render)
        if (multiSelected.has(origIdx)) {
          multiSelected.delete(origIdx);
          btn.classList.remove("sprout-mcq-selected");
        } else {
          multiSelected.add(origIdx);
          btn.classList.add("sprout-mcq-selected");
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
            submitBtn.classList.remove("sprout-mcq-submit-tooltip-visible");
          }
        }
      } else {
        void args.answerMcq(origIdx);
      }
    });

    optionList.appendChild(btn);
  });

  // Multi-answer: show Submit button when not yet graded
  if (multiAnswer && !reveal) {
    const submitRow = document.createElement("div");
    submitRow.className = "bc flex justify-end mt-2";
    submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "bc btn-primary px-4 py-2 text-sm sprout-mcq-submit-btn";

    const submitLabel = document.createElement("span");
    submitLabel.textContent = t(args.interfaceLanguage, "ui.reviewer.submit", "Submit");
    submitBtn.appendChild(submitLabel);

    const submitKbd = document.createElement("kbd");
    submitKbd.className = "bc kbd ml-2 text-xs";
    submitKbd.textContent = "\u21B5";
    submitBtn.appendChild(submitKbd);

    submitBtn.disabled = multiSelected.size === 0;
    if (multiSelected.size === 0) {
      submitBtn.classList.add("opacity-50", "cursor-not-allowed");
    }
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (multiSelected.size > 0 && args.answerMcqMulti) {
        void args.answerMcqMulti([...multiSelected]);
      } else if (multiSelected.size === 0 && submitBtn) {
        submitBtn.classList.add("sprout-mcq-submit-shake");
        submitBtn.addEventListener("animationend", () => {
          submitBtn!.classList.remove("sprout-mcq-submit-shake");
        }, { once: true });
        // Show tooltip on second empty attempt
        if (submitBtn.dataset.emptyAttempt === "1") {
          submitBtn.setAttribute("aria-label", t(args.interfaceLanguage, "ui.reviewer.mcq.chooseOne", "Choose at least one answer to proceed"));
          submitBtn.setAttribute("data-tooltip-position", "top");
          submitBtn.classList.add("sprout-mcq-submit-tooltip-visible");
          setTimeout(() => {
            submitBtn!.classList.remove("sprout-mcq-submit-tooltip-visible");
          }, 2500);
        }
        submitBtn.dataset.emptyAttempt = String(Number(submitBtn.dataset.emptyAttempt || "0") + 1);
      }
    });
    submitRow.appendChild(submitBtn);
    optionList.appendChild(submitRow);
  }

  // Do not render separate Answer subtitle/content for MCQ.
}

/** Renders OQ (ordering question) card content. */
function renderOqContent(ctx: CardRenderCtx): void {
  const { section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath } = ctx;
  // ── Ordering Question ──────────────────────────────────────────────
  section.appendChild(labelRow("Question"));
  section.appendChild(renderMdBlock("bc-q", convertInlineDisplayMath(card.q || "")));

  const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
  const reveal = !!graded || !!args.showAnswer;
  const oqMeta = (graded?.meta || {});
  const userOrder: number[] = Array.isArray(oqMeta.oqUserOrder) ? (oqMeta.oqUserOrder as number[]) : [];

  if (!reveal) {
    // ── Front: drag-to-reorder interface ──
    section.appendChild(labelRow("Order the steps"));

    const shuffled = getOqShuffledOrder(args.session, card, !!args.randomizeOqOrder);
    const currentOrder = shuffled.slice();

    const listWrap = document.createElement("div");
    listWrap.className = "bc flex flex-col gap-2 sprout-oq-step-list";
    section.appendChild(listWrap);

    const previewController = createOqReorderPreviewController(listWrap);

    const commitReorder = (fromIdx: number, toIdx: number) => {
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
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
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      previewController.updatePointer(e.clientY);
    });

    listWrap.addEventListener("drop", (e) => {
      e.preventDefault();
      const pending = previewController.getPendingMove();
      previewController.endDrag();
      if (!pending) return;
      commitReorder(pending.fromIdx, pending.toIdx);
    });

    const renderSteps = () => {
      listWrap.innerHTML = "";
      currentOrder.forEach((origIdx, displayIdx) => {
        const stepText = steps[origIdx] || "";
        const row = document.createElement("div");
        row.className = "bc flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 sprout-oq-step-row";
        row.draggable = true;
        row.dataset.oqIdx = String(displayIdx);

        // Grip handle
        const grip = document.createElement("span");
        grip.className = "bc sprout-oq-grip inline-flex items-center justify-center text-muted-foreground cursor-grab";
        grip.draggable = false;
        setIcon(grip, "grip-vertical");
        row.appendChild(grip);

        // Step number badge
        const badge = document.createElement("kbd");
        badge.className = "bc kbd";
        badge.textContent = String(displayIdx + 1);
        row.appendChild(badge);

        // Step text
        const textEl = document.createElement("span");
        textEl.className = "bc min-w-0 whitespace-pre-wrap break-words flex-1 sprout-oq-step-text";
        if (stepText.includes("[[") || stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[")) {
          void args.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath).then(() => setupLinkHandlers(textEl, sourcePath));
        } else {
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
          if (!touch) return;
          previewController.beginDrag({
            fromIdx: displayIdx,
            row,
          });
          previewController.updatePointer(touch.clientY);
        }, { passive: true });

        row.addEventListener("touchmove", (e) => {
          const touch = e.touches[0];
          if (!touch) return;
          e.preventDefault();
          previewController.updatePointer(touch.clientY);
        }, { passive: false });

        row.addEventListener("touchend", () => {
          const pending = previewController.getPendingMove();
          previewController.endDrag();
          if (!pending) return;
          commitReorder(pending.fromIdx, pending.toIdx);
        });

        row.addEventListener("touchcancel", () => {
          previewController.endDrag();
        });

        listWrap.appendChild(row);
      });
    };

    renderSteps();

  } else {
    // ── Back: show user order with correctness highlighting ──
    section.appendChild(labelRow("Your Order"));

    const answerList = document.createElement("div");
    answerList.className = "bc flex flex-col gap-2 sprout-oq-answer-list";
    section.appendChild(answerList);

    const identity = Array.from({ length: steps.length }, (_, i) => i);
    const displayOrder = userOrder.length === steps.length ? userOrder : identity;

    displayOrder.forEach((origIdx, displayIdx) => {
      const stepText = steps[origIdx] || "";
      const wasInCorrectPosition = origIdx === displayIdx;

      const row = document.createElement("div");
      row.className = "bc flex items-center gap-2 rounded-lg border px-3 py-2 sprout-oq-answer-row";
      if (wasInCorrectPosition) {
        row.classList.add("sprout-oq-correct", "sprout-oq-correct-highlight");
      } else {
        row.classList.add("sprout-oq-wrong", "sprout-oq-wrong-highlight");
      }

      const badge = document.createElement("kbd");
      badge.className = "bc kbd";
      badge.textContent = String(origIdx + 1);
      row.appendChild(badge);

      const textEl = document.createElement("span");
      textEl.className = "bc min-w-0 whitespace-pre-wrap break-words flex-1 sprout-oq-step-text";
      if (stepText.includes("[[") || stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[")) {
        void args.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath).then(() => setupLinkHandlers(textEl, sourcePath));
      } else {
        applyInlineMarkdownWithFlags(textEl, stepText);
      }
      row.appendChild(textEl);

      answerList.appendChild(row);
    });
  }
}

export function renderSessionMode(args: Args) {
  const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
    t(args.interfaceLanguage, token, fallback, vars);
  const skipEnabled = !!(args.enableSkipButton ?? args.skipEnabled);
  const practiceMode = !!args.practiceMode;
  const four = !!args.fourButtonMode;
  const isPhoneMobile = document.body.classList.contains("is-phone");
  const applyAOS = !!args.applyAOS;
  const delayMs = Number.isFinite(args.aosDelayMs) ? Number(args.aosDelayMs) : applyAOS ? 100 : 0;
  
  const canUndo = !!args.canUndo && typeof args.undoLast === "function";
  const hasStartPractice = typeof args.startPractice === "function";
  const canStartPractice = !practiceMode && (!!args.canStartPractice || hasStartPractice);
  
  const card = args.currentCard();
  const id = card ? String(card.id) : "";
  const graded = args.session?.graded?.[id] || null;
  const isFlashcardStudyMode = args.session?.mode === "scheduled" || args.session?.mode === "practice";

  // ===== Render Study Session header (persists across all card renders) =====
  renderStudySessionHeader(args.container, args.interfaceLanguage, applyAOS, {
    titleToken: "ui.reviewer.session.header.title",
    titleFallback: "Flashcards",
  });

  // ===== Root card (Basecoat) =====
  const wrap = document.createElement("div");
  wrap.className = "bc card w-full";
  // Optional: keep a plugin hook class for any small overrides you still want.
  wrap.classList.add("bc-session-card", "lk-session-card", "m-0");
  wrap.classList.toggle("sprout-session-answer-revealed", !!args.showAnswer || !!graded);
  const resetAosState = () => {
    wrap.classList.remove("aos-init", "aos-animate", "sprout-aos-fallback");
  };

  // Always render the card, but only apply AOS for front side (not revealed)
  if (applyAOS && !args.showAnswer && !graded) {
    resetAosState();
    wrap.setAttribute("data-aos", "fade-up");
    wrap.setAttribute("data-aos-delay", String(Math.max(0, Math.floor(delayMs))));
  } else {
    // Remove AOS attributes if present and reset state
    wrap.removeAttribute("data-aos");
    wrap.removeAttribute("data-aos-delay");
    resetAosState();
  }

  // Fallback: force visible if AOS fails or never initializes
  setTimeout(() => {
    if (!wrap) return;
    const style = getComputedStyle(wrap);
    if (style.opacity === "0") {
      wrap.classList.add("sprout-aos-fallback");
    }
  }, 350);

  // Reset deck browser aos-once attribute if present
  if (args.container?.dataset?.deckBrowserAosOnce === "1") {
    args.container.dataset.deckBrowserAosOnce = "0";
  }

  // Create section once for both empty and card-present states
  const section = document.createElement("section");
  section.className = "bc flex flex-col gap-3";

  // ===== Empty state rendered like a normal card =====
  if (!card) {
    section.classList.add("sprout-session-practice-prompt");
    args.clearTimer();
    args.clearCountdown();

    // Header
    const header = document.createElement("header");
    header.className = "bc sprout-session-topbar";
    wrap.appendChild(header);

    const titleWrap = document.createElement("div");
    titleWrap.className = "bc sprout-session-topbar-title sprout-question-title";
    titleWrap.textContent = practiceMode
      ? tx("ui.reviewer.session.practiceComplete", "Practice complete")
      : tx("ui.reviewer.session.noCardsDue", "No cards are due");
    header.appendChild(titleWrap);

    // Section: Practice session message (centered, no alert wrapper)
    if (practiceMode) {
      const d1 = document.createElement("div");
      d1.className = "bc text-base text-center";
      d1.textContent = tx("ui.reviewer.session.practiceSessionComplete", "Practice session complete");
      const d2 = document.createElement("div");
      d2.className = "bc text-sm text-center sprout-session-practice-prompt-subtext";
      d2.textContent =
        "This was a practice session. Scheduling was not changed. You cannot bury or suspend cards in this mode.";
      section.appendChild(d1);
      section.appendChild(d2);
    } else {
      const d1 = document.createElement("div");
      d1.className = "bc text-base text-center";
      d1.textContent = tx("ui.reviewer.session.askStartPractice", "Would you like to start a practice session?");
      const d2 = document.createElement("div");
      d2.className = "bc text-sm text-center sprout-session-practice-prompt-subtext";
      d2.textContent =
        "Practice session reviews all cards in this deck, including ones that are not due. It does not affect scheduling. You cannot bury or suspend cards while in this mode";
      section.appendChild(d1);
      section.appendChild(d2);
    }
    wrap.appendChild(section);

    // Footer: practice/return actions centered in the study dock layout
    const footer = document.createElement("footer");
    footer.className = "bc sprout-session-study-dock";
    wrap.appendChild(footer);

    const footerLeft = document.createElement("div");
    footerLeft.className = "bc flex items-center gap-2 sprout-session-study-dock-left";
    footer.appendChild(footerLeft);

    const footerCenter = document.createElement("div");
    footerCenter.className = "bc flex flex-wrap gap-2 items-center justify-center sprout-session-study-dock-center";
    footer.appendChild(footerCenter);

    const footerRight = document.createElement("div");
    footerRight.className = "bc flex items-center gap-2 sprout-session-study-dock-right";
    footer.appendChild(footerRight);

    const backBtn = makeTextButton({
      label: tx("ui.reviewer.session.returnToDecks", "Return to Decks"),
      className: "sprout-btn-toolbar",
      onClick: () => args.backToDecks(),
      kbd: isPhoneMobile ? undefined : "Q",
    });

    const canShowPracticeStart = hasStartPractice && (canStartPractice || practiceMode);
    if (canShowPracticeStart) {
      const startBtn = makeTextButton({
        label: tx("ui.reviewer.session.startPractice", "Start Practice"),
        className: "sprout-btn-toolbar",
        onClick: () => args.startPractice?.(),
        kbd: isPhoneMobile ? undefined : "↵",
      });

      // For two-action empty-state footers, keep actions split left/right.
      footerLeft.appendChild(backBtn);
      footerRight.appendChild(startBtn);
    } else {
      // Single-action empty-state footer keeps action centered.
      footerCenter.appendChild(backBtn);
    }

    args.container.appendChild(wrap);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          refreshAOS();
        } catch (e) { log.swallow("render-session refreshAOS empty", e); }
      });
    });
    return;
  }

  // Card present
  args.clearCountdown();
  if (isFlashcardStudyMode) wrap.classList.add("sprout-session-has-dock");

  const sourcePath = card.sourceNotePath || "";

  // ===== Header =====
  const header = document.createElement("header");
  header.className = "bc sprout-session-topbar";
  if (args.hideSessionTopbar) header.classList.add("sprout-session-topbar-hidden");
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
  if (TYPE_LABELS.has(displayTitle.toLowerCase())) displayTitle = "";

  const titleText = displayTitle || fallbackQuestionTitle(args.session, card);
  const titleWrap = document.createElement("div");
  titleWrap.className = "bc sprout-session-topbar-title sprout-question-title";
  header.appendChild(titleWrap);

  const titleEl = titleWrap;
  // Render title as markdown to support wiki links and LaTeX
  const titleMd = String(titleText ?? "");
  if (titleMd.includes('[[') || titleMd.includes('$')) {
    void args.renderMarkdownInto(titleEl, titleMd, sourcePath).then(() => setupLinkHandlers(titleEl, sourcePath));
  } else {
    applyInlineMarkdownWithFlags(titleEl, titleMd);
  }

  // ===== Content =====
  const mutedLabel = (s: string) => h("div", "text-muted-foreground text-sm font-medium", s);

  /** Build a "Question" or "Answer" label row with an optional TTS replay button. */
  const labelRow = (text: string, replayFn?: () => void) => {
    const row = document.createElement("div");
    row.className = "bc flex items-center justify-between sprout-label-row";
    row.appendChild(mutedLabel(text));
    if (args.ttsEnabled && replayFn) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bc btn-icon sprout-tts-replay-btn";
      btn.setAttribute("aria-label", `Read ${text.toLowerCase()} aloud`);
      btn.setAttribute("data-tooltip-position", "top");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", "18");
      svg.setAttribute("height", "18");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.classList.add("lucide", "lucide-volume-2");
      // Lucide volume-2 icon paths
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.setAttribute("points", "11 5 6 9 2 9 2 15 6 15 11 19 11 5");
      svg.appendChild(polygon);
      const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path1.setAttribute("d", "M15.54 8.46a5 5 0 0 1 0 7.07");
      svg.appendChild(path1);
      const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path2.setAttribute("d", "M19.07 4.93a10 10 0 0 1 0 14.14");
      svg.appendChild(path2);
      btn.appendChild(svg);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        replayFn();
      });
      row.appendChild(btn);
    }
    return row;
  };

  const setupLinkHandlers = (rootEl: HTMLElement, srcPath: string) => {
    const app = window?.app;
    const links = rootEl.querySelectorAll<HTMLAnchorElement>("a");
    links.forEach((link) => {
      link.addEventListener("click", (e) => {
        const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
        if (!href) return;
        e.preventDefault();
        e.stopPropagation();

        const isExternal = /^(https?:|mailto:|tel:)/i.test(href);
        if (isExternal) {
          window.open(href, "_blank", "noopener");
          return;
        }

        if (app?.workspace?.openLinkText) {
          void app.workspace.openLinkText(href, srcPath || "", true);
        } else {
          window.open(href, "_blank", "noopener");
        }
      });

      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
    });
  };

  const renderMdBlock = (cls: string, md: string) => {
    const block = document.createElement("div");
    block.className = `bc ${cls} whitespace-pre-wrap break-words sprout-md-block`;
    void args.renderMarkdownInto(block, md ?? "", sourcePath).then(() => setupLinkHandlers(block, sourcePath));
    return block;
  };

  if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") {
    // For reversed-child with direction "back", swap content (A→Q)
    const isBackDirection = card.type === "reversed-child" && (card as unknown as { reversedDirection?: string }).reversedDirection === "back";
    const isOldReversed = card.type === "reversed";
    const frontContent = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
    const backContent = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
    const replayFront = card.type === "basic" ? args.ttsReplayFront : undefined;
    const replayBack = card.type === "basic" ? args.ttsReplayBack : undefined;

    section.appendChild(labelRow("Question", replayFront));
    section.appendChild(renderMdBlock("bc-q", convertInlineDisplayMath(frontContent)));

    if (args.showAnswer || graded) {
      section.appendChild(labelRow("Answer", replayBack));
      section.appendChild(renderMdBlock("bc-a", convertInlineDisplayMath(backContent)));
    }
  } else if (card.type === "cloze" || card.type === "cloze-child") {
    const text = String(card.clozeText || "");
    const reveal = args.showAnswer || !!graded;
    const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;

    section.appendChild(labelRow(reveal ? "Answer" : "Question", reveal ? args.ttsReplayBack : args.ttsReplayFront));
    const clozContainer = document.createElement("div");
    clozContainer.className = "bc bc-cloze whitespace-pre-wrap break-words sprout-md-block";
    if (text.includes("$") || text.includes("\\(") || text.includes("\\[") || text.includes("[[")) {
      const processedText = processClozeForMath(text, reveal, targetIndex);
      void args.renderMarkdownInto(clozContainer, processedText, sourcePath).then(() => setupLinkHandlers(clozContainer, sourcePath));
    } else {
      const clozeContent = args.renderClozeFront(text, reveal, targetIndex, undefined);
      if (reveal) {
        const span = document.createElement("span");
        span.className = "bc whitespace-pre-wrap break-words";
        span.appendChild(clozeContent);
        clozContainer.appendChild(span);
      } else {
        clozContainer.appendChild(clozeContent);
      }
    }
    section.appendChild(clozContainer);
  } else if (card.type === "mcq") {
    renderMcqContent({ section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath });
  } else if (card.type === "oq") {
    renderOqContent({ section, labelRow, renderMdBlock, setupLinkHandlers, args, card, graded, sourcePath });
  } else if (ioLike) {
    const reveal = !!graded || !!args.showAnswer;

    const ioHost = document.createElement("div");
    ioHost.className = "bc bc-io-host";
    ioHost.dataset.sproutIoWidget = "1";
    section.appendChild(ioHost);

    if (typeof args.renderImageOcclusionInto === "function") {
      void args.renderImageOcclusionInto(ioHost, card, sourcePath, reveal);
    } else {
      const md = String(card.imageRef ?? "");
      if (md.trim()) void args.renderMarkdownInto(ioHost, md, sourcePath).then(() => setupLinkHandlers(ioHost, sourcePath));
      else ioHost.appendChild(h("div", "text-muted-foreground text-sm", "IO card missing image source."));
    }
  }

  const infoText = extractInfoField(card);
  const isBack = !!graded || !!args.showAnswer;
  const shouldShowInfo =
    ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") && isBack && !!infoText) || ((args.showInfo || graded) && !!infoText);
  if (shouldShowInfo) {
    section.appendChild(labelRow("Extra information"));
    section.appendChild(renderMdBlock("bc-info", infoText));
  }

  // Append section to wrap
  wrap.appendChild(section);

  // ===== Footer (actions) =====
  const footer = document.createElement("footer");
  footer.className = "bc sprout-session-study-dock";
  wrap.appendChild(footer);

  // Left: Edit button
  const footerLeft = document.createElement("div");
  footerLeft.className = "bc flex items-center gap-2 sprout-session-study-dock-left";

  const editBtn = isPhoneMobile
    ? makeTextButton({
      label: "",
      title: t(args.interfaceLanguage, "ui.reviewer.edit", "Edit"),
      className: "sprout-btn-toolbar lk-review-edit-icon-btn",
      onClick: () => {
        args.openEditModal?.();
      },
    })
    : makeTextButton({
      label: t(args.interfaceLanguage, "ui.reviewer.edit", "Edit"),
      className: "sprout-btn-toolbar",
      onClick: () => {
        args.openEditModal?.();
      },
      kbd: "E",
    });
  if (isPhoneMobile) {
    editBtn.setAttribute("aria-label", t(args.interfaceLanguage, "ui.reviewer.edit", "Edit"));
    const iconWrap = document.createElement("span");
    iconWrap.className = "bc inline-flex items-center justify-center";
    setIcon(iconWrap, "pencil");
    editBtn.appendChild(iconWrap);

    const editLabel = document.createElement("span");
    editLabel.className = "bc";
    editLabel.setAttribute("data-sprout-mobile-label", "true");
    editLabel.textContent = t(args.interfaceLanguage, "ui.reviewer.edit", "Edit");
    editBtn.appendChild(editLabel);
  }
  footerLeft.appendChild(editBtn);
  footer.appendChild(footerLeft);

  // Center: Reveal/Grade/Next buttons
  const footerCenter = document.createElement("div");
  footerCenter.className = "bc flex flex-wrap gap-2 items-center justify-center sprout-session-study-dock-center";
  footer.appendChild(footerCenter);

  const canGradeNow =
    !graded &&
    ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || card.type === "cloze" || card.type === "cloze-child" || ioLike) && !!args.showAnswer);

  // Grading / next buttons (in center)
  const mainRow = document.createElement("div");
  mainRow.className = "bc flex flex-wrap items-center justify-center gap-2 sprout-session-study-dock-buttons";
  let hasMainRowContent = false;

  // Basic/Cloze/IO: reveal gate
  if (
    (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || card.type === "cloze" || card.type === "cloze-child" || ioLike) &&
    !args.showAnswer &&
    !graded
  ) {
    mainRow.appendChild(
      makeTextButton({
        label: "Reveal",
        className: "sprout-btn-toolbar",
        onClick: () => {
          args.setShowAnswer(true);
          args.rerender();
        },
        kbd: isPhoneMobile ? undefined : "↵",
      }),
    );
    hasMainRowContent = true;
  }

  if (!graded) {
    if (canGradeNow) {
      const goNext = () => void args.nextCard(true);
      const showIntervals =
        !!args.showGradeIntervals &&
        !!args.schedulingSettings &&
        !!args.getCardStateForPreview;
      const previewNow = Date.now();
      const previewState = showIntervals
        ? args.getCardStateForPreview?.(String(card.id), previewNow) ?? null
        : null;
      const getSubtitle = (rating: Rating): string | undefined => {
        if (!previewState || !args.schedulingSettings) return undefined;
        return (
          getRatingIntervalPreview({
            state: previewState,
            rating,
            now: previewNow,
            scheduling: args.schedulingSettings,
          }) ?? undefined
        );
      };

      // Practice mode: single Continue button
      if (practiceMode) {
        const continueBtn = makeTextButton({
          label: "Continue",
          className: "sprout-btn-toolbar",
          onClick: goNext,
          kbd: isPhoneMobile ? undefined : "↵",
        });
        mainRow.appendChild(continueBtn);
        hasMainRowContent = true;
      } else {
        // Normal mode: grading buttons
        const group = document.createElement("div");
        group.className = "bc flex flex-wrap justify-center gap-2 sprout-session-study-dock-grade-group";
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
        againBtn.classList.add("sprout-btn-again");
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
          hardBtn.classList.add("sprout-btn-hard");
          group.appendChild(hardBtn);

          const goodBtn = makeTextButton({
            label: "Good",
            subtitle: getSubtitle("good"),
            title: "Grade question as good (3)",
            className: "btn",
            onClick: () => void args.gradeCurrentRating("good", {}).then(goNext),
            kbd: "3",
          });
          goodBtn.classList.add("sprout-btn-good");
          group.appendChild(goodBtn);

          const easyBtn = makeTextButton({
            label: "Easy",
            subtitle: getSubtitle("easy"),
            title: "Grade question as easy (4)",
            className: "btn",
            onClick: () => void args.gradeCurrentRating("easy", {}).then(goNext),
            kbd: "4",
          });
          easyBtn.classList.add("sprout-btn-easy");
          group.appendChild(easyBtn);
        } else {
          const goodBtn = makeTextButton({
            label: "Good",
            subtitle: getSubtitle("good"),
            title: "Grade question as good (2)",
            className: "btn",
            onClick: () => void args.gradeCurrentRating("good", {}).then(goNext),
            kbd: "2",
          });
          goodBtn.classList.add("sprout-btn-good");
          group.appendChild(goodBtn);
        }
      }

      if (skipEnabled) {
        const skipBtn = makeTextButton({
          label: "Skip",
          title: "Skip card (↵)",
          className: "sprout-btn-toolbar",
          onClick: () => args.skipCurrentCard({ uiSource: "skip-btn", uiKey: 13, uiButtons: four ? 4 : 2 }),
          kbd: "↵",
        });
        skipBtn.dataset.bcAction = "skip-card";
        mainRow.appendChild(skipBtn);
      }
    } else if (card.type === "mcq") {
      const optCount = (card.options || []).length;
      mainRow.appendChild(h("div", "text-muted-foreground text-sm", `Choose 1–${optCount}.`));
      hasMainRowContent = true;
    } else if (card.type === "oq") {
      const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
      const n = steps.length;
      const identity = Array.from({ length: n }, (_, i) => i);
      mainRow.appendChild(
        makeTextButton({
          label: t(args.interfaceLanguage, "ui.reviewer.oq.submitOrder", "Submit order"),
          className: "sprout-btn-toolbar",
          onClick: () => {
            const oqMap = ensureOqOrderMap(args.session);
            const currentOrder = oqMap[String(card.id)];
            const orderToSubmit = isPermutation(currentOrder, n) ? currentOrder.slice() : identity;
            void args.answerOq(orderToSubmit);
          },
          kbd: "↵",
        }),
      );
      hasMainRowContent = true;
    } else if (ioLike && !args.showAnswer) {
      mainRow.appendChild(h("div", "text-muted-foreground text-sm", "Press Enter to reveal the image."));
      hasMainRowContent = true;
    }
  } else {
    mainRow.appendChild(
      makeTextButton({
        label: "Next",
        className: "sprout-btn-toolbar",
        onClick: () => void args.nextCard(true),
        kbd: "↵",
      }),
    );
    hasMainRowContent = true;
  }

  // Only append mainRow if it has content
  if (hasMainRowContent) {
    footerCenter.appendChild(mainRow);
  }

  // Right: More menu
  const footerRight = document.createElement("div");
  footerRight.className = "bc flex items-center gap-2 sprout-session-study-dock-right";

  // Provide open note handler globally for menu
  window.sproutOpenCurrentCardNote = () => {
    if (!card) return;
    const filePath = card.sourceNotePath;
    if (!filePath) return;
    const app = window.app;
    if (app) {
      void openCardAnchorInNote(app, filePath, String(card.id ?? ""));
    }
  };
  footerRight.appendChild(
    makeHeaderMenu({
      canUndo,
      onUndo: () => args.undoLast?.(),
      canBurySuspend: !!args.canBurySuspend,
      onBury: () => args.buryCurrentCard?.(),
      onSuspend: () => args.suspendCurrentCard?.(),
      canSkip: skipEnabled && !!card && !graded,
      onSkip: () => args.skipCurrentCard({ uiSource: "footer-menu" }),
      onExit: () => args.backToDecks(),
      compactTrigger: isPhoneMobile,
      interfaceLanguage: args.interfaceLanguage,
    }),
  );

  if (isPhoneMobile) {
    const moreBtn = footerRight.querySelector<HTMLButtonElement>(".lk-review-more-icon-btn");
    if (moreBtn && !moreBtn.querySelector("[data-sprout-mobile-label]")) {
      const menuLabel = document.createElement("span");
      menuLabel.className = "bc";
      menuLabel.setAttribute("data-sprout-mobile-label", "true");
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
      } catch (e) { log.swallow("render-session refreshAOS card", e); }
    });
  });
}
