// src/reviewer/renderSession.ts
import { setIcon } from "obsidian";
import { refreshAOS } from "../core/aos-loader";
import { renderStudySessionHeader } from "./StudySessionHeader";
import type { Scope, Session, Rating } from "./ImageOcclusionTypes";

type Args = {
  container: HTMLElement;

  session: Session;
  showAnswer: boolean;
  setShowAnswer: (v: boolean) => void;

  currentCard: () => any;

  // navigation
  backToDecks: () => void;
  nextCard: (userInitiated: boolean) => Promise<void> | void;

  // grading
  gradeCurrentRating: (rating: Rating, meta: any) => Promise<void>;
  answerMcq: (choiceIdx: number) => Promise<void>;

  // skip (session-only postpone; no scheduling changes)
  enableSkipButton?: boolean;
  skipEnabled?: boolean;
  skipCurrentCard: (meta?: any) => void;

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

  // info / countdown
  showInfo: boolean;
  clearTimer: () => void;
  clearCountdown: () => void;
  getNextDueInScope: (scope: Scope) => number | null;
  startCountdown: (nextDue: number, lineEl: HTMLElement) => void;

  // cloze rendering (legacy)
  renderClozeFront: (text: string, reveal: boolean, targetIndex?: number | null) => HTMLElement;

  // markdown rendering
  renderMarkdownInto: (containerEl: HTMLElement, md: string, sourcePath: string) => Promise<void>;

  // ✅ IO rendering hook (provided by reviewer.ts)
  renderImageOcclusionInto?: (
    containerEl: HTMLElement,
    card: any,
    sourcePath: string,
    reveal: boolean,
  ) => Promise<void>;

  // MCQ option randomisation
  randomizeMcqOptions: boolean;

  // grading mode
  fourButtonMode?: boolean;

  // edit modal
  openEditModal?: () => void;

  // AOS animation control
  applyAOS?: boolean;
  aosDelayMs?: number;

  rerender: () => void;
};

function formatBreadcrumbs(s: string): string {
  return String(s ?? "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNotePathForHeader(raw: any): string {
  let s = String(raw ?? "").trim();
  if (!s) return "Note";
  s = s.replace(/\\/g, "/").replace(/^\.\//, "");
  s = s.replace(/\.md$/i, "");
  return formatBreadcrumbs(s);
}

function extractInfoField(card: any): string | null {
  if (!card) return null;

  const pick = (v: any): string | null => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const s = v.filter((x) => typeof x === "string").join("\n").trim();
      return s ? s : null;
    }
    return null;
  };

  const direct = pick(card.info) ?? pick(card.information) ?? pick(card.i) ?? pick(card.I);
  if (direct) return direct;

  const fields = card.fields;
  if (fields && typeof fields === "object") {
    const fromFields = pick(fields.info) ?? pick(fields.information) ?? pick(fields.i) ?? pick(fields.I);
    if (fromFields) return fromFields;
  }

  return null;
}

function clozeToMarkdown(raw: string, reveal: boolean, targetIndex?: number | null): string {
  const s = String(raw ?? "");
  const re = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

  return s.replace(re, (_m, n, answer, hint) => {
    const idx = Number(n);
    const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;
    const a = String(answer ?? "");
    const h = String(hint ?? "");

    if (!isTarget) return a;

    if (reveal) {
      if (!a.includes("\n")) return `==${a}==`;
      return a;
    }

    if (h.trim()) return `____ _(${h.trim()})_`;
    return `____`;
  });
}

// --- Basecoat scoping --------------------------------------------------------

/**
 * IMPORTANT:
 * - Add `bc` to every element you want Basecoat to style.
 * - Your PostCSS scoper produces selectors like `.btn-outline.bc`, `div.card.bc`, etc.
 *   so the presence of class `bc` is required for those rules to match.
 */
function h(tag: string, className?: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className && className.trim() ? `bc ${className}` : "bc";
  if (typeof text === "string") node.textContent = text;
  return node;
}

function hr() {
  // Use <hr> so Basecoat defaults can apply (scoped via `.bc`).
  const r = document.createElement("hr");
  r.className = "bc";
  r.style.setProperty("margin", "0", "important");
  return r;
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
  title?: string;
  className: string;
  onClick: () => void;
  kbd?: string;
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className.split(/\s+/).includes("bc") ? opts.className : `bc ${opts.className}`;
  btn.textContent = opts.label;
  if (opts.title) btn.title = opts.title;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });

  if (opts.kbd) appendKbdRight(btn, opts.kbd);
  return btn;
}

function makeIconButton(opts: {
  icon: string;
  label: string;
  title?: string;
  className: string;
  onClick: () => void;
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className.split(/\s+/).includes("bc") ? opts.className : `bc ${opts.className}`;
  btn.setAttribute("data-tooltip", opts.label);
  if (opts.title) btn.title = opts.title;

  // Basecoat icon buttons expect an SVG child; setIcon will inject it.
  setIcon(btn, opts.icon);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });

  return btn;
}

// --- IO helpers --------------------------------------------------------------

function ioChildKeyFromId(id: string): string | null {
  const m = String(id ?? "").match(/::io::(.+)$/);
  if (!m) return null;
  const k = String(m[1] ?? "").trim();
  return k ? k : null;
}

function getIoGroupKey(card: any): string | null {
  if (!card) return null;
  const direct =
    typeof card.groupKey === "string" && card.groupKey.trim()
      ? card.groupKey.trim()
      : typeof card.ioGroupKey === "string" && card.ioGroupKey.trim()
        ? card.ioGroupKey.trim()
        : typeof card.key === "string" && card.key.trim()
          ? card.key.trim()
          : null;
  if (direct) return direct;

  const id = String(card.id ?? "");
  return ioChildKeyFromId(id);
}

function isIoCard(card: any): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "io" || t === "io-child" || t === "io_child" || t === "iochild";
}

// --- MCQ option order --------------------------------------------------------

function ensureMcqOrderMap(session: Session): Record<string, number[]> {
  const s: any = session as any;
  if (!s.mcqOrderMap || typeof s.mcqOrderMap !== "object") s.mcqOrderMap = {};
  return s.mcqOrderMap as Record<string, number[]>;
}

function isPermutation(arr: any, n: number): boolean {
  if (!Array.isArray(arr) || arr.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const x of arr) {
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

function getMcqDisplayOrder(session: Session, card: any, enabled: boolean): number[] {
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

// --- Breadcrumbs -------------------------------------------------------------

function makeBreadcrumbs(parts: Array<{ label: string; onClick?: () => void }>) {
  const ol = document.createElement("ol");
  ol.className =
    "bc text-muted-foreground flex flex-wrap items-center gap-1.5 break-words text-sm sm:gap-2.5";

  const addSep = () => {
    const li = document.createElement("li");
    li.className = "bc";
    li.setAttribute("aria-hidden", "true");

    const sep = document.createElement("span");
    sep.className = "bc inline-flex items-center justify-center [&_svg]:size-3.5";
    setIcon(sep, "chevron-right");
    li.appendChild(sep);
    ol.appendChild(li);
  };

  parts.forEach((p, idx) => {
    if (idx > 0) addSep();

    const li = document.createElement("li");
    li.className = "bc inline-flex items-center";
    ol.appendChild(li);

    if (typeof p.onClick === "function") {
      // First item (Decks) should be an <a> tag
      const isFirstItem = idx === 0;
      if (isFirstItem) {
        const link = document.createElement("a");
        link.href = "#";
        link.className = "bc font-bold hover:text-foreground transition-colors cursor-pointer";
        link.textContent = p.label;
        link.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          p.onClick?.();
        });
        li.appendChild(link);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bc hover:text-foreground transition-colors";
        btn.textContent = p.label;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          p.onClick?.();
        });
        li.appendChild(btn);
      }
    } else {
      const span = document.createElement("span");
      span.className = "bc text-foreground";
      span.textContent = p.label;
      li.appendChild(span);
    }
  });

  return ol;
}

// --- Dropdown menu (optional header actions) ---------------------------------

function makeHeaderMenu(opts: {
  canUndo: boolean;
  onUndo: () => void;
  canSkip: boolean;
  onSkip: () => void;
  canBurySuspend: boolean;
  onBury: () => void;
  onSuspend: () => void;
  onExit: () => void;
}) {
  const id = `bc-menu-${Math.random().toString(36).slice(2, 8)}`;

  const root = document.createElement("div");
  root.id = id;
  root.className = "bc relative inline-flex";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = `${id}-trigger`;
  trigger.className = "bc btn-outline";
  trigger.dataset.bcAction = "reviewer-more-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", `${id}-menu`);
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("data-tooltip", "More actions");
  trigger.appendChild(document.createTextNode("More"));
  trigger.appendChild(makeKbd("M"));
  root.appendChild(trigger);

  const popover = document.createElement("div");
  popover.id = `${id}-popover`;
  popover.className = "bc sprout";
  popover.setAttribute("aria-hidden", "true");
  popover.style.setProperty("position", "fixed", "important");
  popover.style.setProperty("z-index", "999999", "important");
  popover.style.setProperty("display", "none", "important");
  popover.style.setProperty("pointer-events", "auto", "important");

  const panel = document.createElement("div");
  panel.className = "bc sprout rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1";
  panel.style.setProperty("pointer-events", "auto", "important");
  popover.appendChild(panel);

  const menu = document.createElement("div");
  menu.className = "bc sprout flex flex-col";
  menu.setAttribute("role", "menu");
  menu.id = `${id}-menu`;
  
  panel.appendChild(menu);

  const addItem = (label: string, hotkey: string | null, onClick: () => void, disabled = false) => {
    const item = document.createElement("div");
    item.className =
      "bc group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
    item.setAttribute("role", "menuitem");
    item.tabIndex = disabled ? -1 : 0;
    if (disabled) {
      item.style.opacity = "0.5";
      item.style.cursor = "not-allowed";
      item.setAttribute("aria-disabled", "true");
    }

    const labelSpan = document.createElement("span");
    labelSpan.className = "bc";
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    if (hotkey) {
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

  const addSeparator = () => {
    const sep = document.createElement("hr");
    sep.setAttribute("role", "separator");
    sep.className = "bc h-px bg-border my-2";
    menu.appendChild(sep);
  };

  // Open Note button
  if (window.sproutOpenCurrentCardNote) {
    addItem("Open", "O", window.sproutOpenCurrentCardNote, false);
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
    let top = r.bottom + 6;
    if (top + panelRect.height > window.innerHeight - margin) {
      top = Math.max(margin, r.top - panelRect.height - 6);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.width = `${width}px`;
  };

  const close = () => {
    trigger.setAttribute("aria-expanded", "false");
    popover.setAttribute("aria-hidden", "true");
    popover.style.setProperty("display", "none", "important");

    try {
      cleanup?.();
    } catch {}
    cleanup = null;

    try {
      popover.remove();
    } catch {}
  };

  const open = () => {
    trigger.setAttribute("aria-expanded", "true");
    popover.setAttribute("aria-hidden", "false");
    popover.style.setProperty("display", "block", "important");

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

export function renderSessionMode(args: Args) {
  const skipEnabled = !!((args as any).enableSkipButton ?? (args as any).skipEnabled);
  const practiceMode = !!args.practiceMode;
  const four = !!args.fourButtonMode;
  const applyAOS = !!args.applyAOS;
  const delayMs = Number.isFinite(args.aosDelayMs) ? Number(args.aosDelayMs) : applyAOS ? 100 : 0;

  const canUndo = !!args.canUndo && typeof args.undoLast === "function";
  const hasStartPractice = typeof args.startPractice === "function";
  const canStartPractice = !practiceMode && (!!args.canStartPractice || hasStartPractice);

  const card = args.currentCard();
  const id = card ? String(card.id) : "";
  const graded = args.session?.graded?.[id] || null;

  // ===== Render Study Session header (persists across all card renders) =====
  renderStudySessionHeader(args.container, applyAOS);

  // ===== Root card (Basecoat) =====
  const wrap = document.createElement("div");
  wrap.className = "bc card w-full";
  // Optional: keep a plugin hook class for any small overrides you still want.
  wrap.classList.add("bc-session-card", "sprout-session-card");
  wrap.style.margin = "0";
  const resetAosState = () => {
    wrap.classList.remove("aos-init", "aos-animate");
    wrap.style.removeProperty("opacity");
    wrap.style.removeProperty("transform");
    wrap.style.removeProperty("transition");
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
      wrap.style.opacity = "1";
      wrap.style.transform = "none";
      wrap.style.transition = "none";
    }
  }, 350);

  // Reset deck browser aos-once attribute if present
  if (args.container?.dataset?.deckBrowserAosOnce === "1") {
    args.container.dataset.deckBrowserAosOnce = "0";
  }

  // ===== Quit button: Lucide X icon in top right =====
  const quitBtn = document.createElement("button");
  quitBtn.type = "button";
  quitBtn.className = "bc btn-icon sprout-quit-btn";
  quitBtn.setAttribute("data-tooltip", "Quit study session");
  quitBtn.style.position = "absolute";
  quitBtn.style.top = "16px";
  quitBtn.style.right = "16px";
  quitBtn.style.padding = "8px";
  quitBtn.style.zIndex = "10";
  quitBtn.style.background = "none";
  quitBtn.style.border = "none";
  quitBtn.style.outline = "none";
  quitBtn.style.boxShadow = "none";
  quitBtn.style.borderRadius = "6px";
  quitBtn.style.cursor = "pointer";
  quitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--foreground)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  quitBtn.addEventListener("click", () => args.backToDecks());

  // Create section once for both empty and card-present states
  const section = document.createElement("section");
  section.className = "bc flex flex-col gap-3";

  // ===== Empty state rendered like a normal card =====
  if (!card) {
    args.clearTimer();
    args.clearCountdown();

    // Header
    const header = document.createElement("header");
    header.className = "bc flex flex-col gap-4 pt-4 p-6";
    wrap.appendChild(header);

    const locationRaw = args.session?.scope?.name || "Home";
    const location = formatNotePathForHeader(locationRaw);

    const locationRow = document.createElement("div");
    locationRow.className = "bc flex items-center justify-center gap-2 min-w-0 px-4";
    header.appendChild(locationRow);

    const locationEl = document.createElement("div");
    locationEl.className = "bc text-muted-foreground pt-4 text-xs text-center";
    locationEl.style.fontStyle = "italic";
    locationEl.textContent = location || "Home";
    locationRow.appendChild(locationEl);
    // Always append quit button to header row for correct positioning
    locationRow.appendChild(quitBtn);

    const titleEl = document.createElement("h2");
    titleEl.className =
      "bc text-lg font-bold leading-none whitespace-pre-wrap break-words text-center px-4 bc-question-title";
    titleEl.textContent = practiceMode ? "Practice complete" : "No cards are due";
    header.appendChild(titleEl);

    // Section: Practice session message (centered, no alert wrapper)
    if (practiceMode) {
      const d1 = document.createElement("div");
      d1.className = "bc text-base text-center";
      d1.textContent = "Practice session complete";
      const d2 = document.createElement("div");
      d2.className = "bc text-sm text-center";
      d2.textContent =
        "This was a practice session. Scheduling was not changed. You cannot bury or suspend cards in this mode.";
      section.appendChild(d1);
      section.appendChild(d2);
    } else {
      const d1 = document.createElement("div");
      d1.className = "bc text-base text-center";
      d1.textContent = "Would you like to start a practice session?";
      const d2 = document.createElement("div");
      d2.className = "bc text-sm text-center";
      d2.textContent =
        "Practice session reviews all cards in this deck, including ones that are not due. It does not affect scheduling. You cannot bury or suspend cards while in this mode";
      section.appendChild(d1);
      section.appendChild(d2);
    }
    wrap.appendChild(section);

    // Footer: single primary action; no Undo or More
    const footer = document.createElement("footer");
    footer.className = "bc flex flex-row items-center justify-center gap-3 p-10";
    wrap.appendChild(footer);
    const footerCenter = document.createElement("div");
    footerCenter.className = "bc flex flex-wrap gap-2 items-center";
    footer.appendChild(footerCenter);

    if (practiceMode) {
      const backBtn = makeTextButton({
        label: "Return to Decks",
        className: "btn-outline",
        onClick: () => args.backToDecks(),
        kbd: "Q",
      });
      footerCenter.appendChild(backBtn);
    } else if (canStartPractice && hasStartPractice) {
      const backBtn = makeTextButton({
        label: "Return to Decks",
        className: "btn-outline",
        onClick: () => args.backToDecks(),
        kbd: "Q",
      });
      footerCenter.appendChild(backBtn);

      const startBtn = makeTextButton({
        label: "Start Practice",
        className: "btn",
        onClick: () => args.startPractice?.(),
        kbd: "↵",
      });
      startBtn.style.setProperty("background-color", "rgb(0, 0, 0)", "important");
      startBtn.style.setProperty("color", "white", "important");
      footerCenter.appendChild(startBtn);
    }

    args.container.appendChild(wrap);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          refreshAOS();
        } catch {}
      });
    });
    return;
  }

  // Card present
  args.clearCountdown();

  // ===== Header =====
  const header = document.createElement("header");
  header.className = "bc flex flex-col gap-4 pt-4 p-6";
  wrap.appendChild(header);

  const locationRaw = card.sourceNotePath || card.location || card.sourcePath || args.session?.scope?.name || "Note";
  const location = formatNotePathForHeader(locationRaw);

  // Location row
  const locationRow = document.createElement("div");
  locationRow.className = "bc flex items-center gap-2 min-w-0 px-4";
  header.appendChild(locationRow);

  const locationEl = document.createElement("div");
  locationEl.className = "bc text-muted-foreground pt-4 text-xs text-center";
  locationEl.style.fontStyle = "italic";
  locationEl.textContent = location || "Note";
  locationRow.appendChild(locationEl);
  locationRow.appendChild(quitBtn);

  // Title below location
  const ioLike = isIoCard(card);
  let displayTitle = card.title || "";

  // Remove cloze number suffix (e.g., " • c1", " • c2", etc.) from cloze cards
  if (card.type === "cloze" || card.type === "cloze-child") {
    displayTitle = displayTitle.replace(/\s*•\s*c\d+\s*$/, "");
  }

  const titleText =
    displayTitle ||
    (card.type === "mcq"
      ? "MCQ"
      : card.type === "cloze" || card.type === "cloze-child"
        ? "Cloze"
        : ioLike
          ? (() => {
              const k = getIoGroupKey(card);
              return k ? `Image Occlusion • ${k}` : "Image Occlusion";
            })()
          : "Basic");

  const titleEl = document.createElement("h2");
  titleEl.className =
    "bc text-lg font-bold leading-none whitespace-pre-wrap break-words text-center px-4 bc-question-title";
  header.appendChild(titleEl);
  // Render title as markdown to support wiki links and LaTeX
  const titleMd = String(titleText ?? "");
  if (titleMd.includes('[[') || titleMd.includes('$')) {
    void args.renderMarkdownInto(titleEl, titleMd, sourcePath).then(() => setupLinkHandlers(titleEl, sourcePath));
  } else {
    titleEl.textContent = titleMd;
  }

  const sourcePath = String(card.sourceNotePath || card.location || card.sourcePath || args.session?.scope?.name || "");

  // ===== Content =====
  const mutedLabel = (s: string) => h("div", "text-muted-foreground text-sm font-medium", s);

  const setupLinkHandlers = (rootEl: HTMLElement, srcPath: string) => {
    const app = (window as any)?.app;
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
          app.workspace.openLinkText(href, srcPath || "", true);
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
    block.className = `bc ${cls} whitespace-pre-wrap break-words`;
    block.style.setProperty("font-size", "14px", "important");
    block.style.setProperty("line-height", "1.75", "important");
    void args.renderMarkdownInto(block, md ?? "", sourcePath).then(() => setupLinkHandlers(block, sourcePath));
    return block;
  };

  if (card.type === "basic") {
    section.appendChild(mutedLabel("Question"));
    section.appendChild(renderMdBlock("bc-q", card.q || ""));

    if (args.showAnswer || graded) {
      section.appendChild(mutedLabel("Answer"));
      section.appendChild(renderMdBlock("bc-a", card.a || ""));
    }
  } else if (card.type === "cloze" || card.type === "cloze-child") {
    const text = String(card.clozeText || "");
    const reveal = args.showAnswer || !!graded;
    const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;

    section.appendChild(mutedLabel(reveal ? "Answer" : "Question"));
    const clozContainer = document.createElement("div");
    clozContainer.className = "bc bc-cloze whitespace-pre-wrap break-words";
    clozContainer.style.setProperty("font-size", "14px", "important");
    clozContainer.style.setProperty("line-height", "1.75", "important");
    const clozeContent = args.renderClozeFront(text, reveal, targetIndex);
    if (reveal) {
      const span = document.createElement("span");
      span.className = "bc whitespace-pre-wrap break-words";
      span.appendChild(clozeContent);
      clozContainer.appendChild(span);
    } else {
      clozContainer.appendChild(clozeContent);
    }
    section.appendChild(clozContainer);
  } else if (card.type === "mcq") {
    section.appendChild(mutedLabel("Question"));
    section.appendChild(renderMdBlock("bc-q", card.stem || ""));
    const reveal = !!graded || !!args.showAnswer;
    section.appendChild(mutedLabel(reveal ? "Answer" : "Options"));

    // Only show MCQ options, not info, as answer options
    const opts = (card.options || []).filter(opt => !opt.isCorrect || (opt.isCorrect && (card.a || "").trim() === opt.text.trim()));
    const chosenOrigIdx = graded?.meta?.mcqChoice;
    const order = getMcqDisplayOrder(args.session, card, !!args.randomizeMcqOptions);

    const optionList = document.createElement("div");
    optionList.className = "bc flex flex-col gap-2";
    // Add extra spacing between the "Options" subtitle and the options list
    optionList.style.marginTop = "10px";
    section.appendChild(optionList);

    order.forEach((origIdx: number, displayIdx: number) => {
      const opt = opts[origIdx] ?? {};
      const text = typeof opt === "string" ? opt : (opt && typeof opt.text === "string" ? opt.text : "");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bc btn-outline w-full justify-start text-left h-auto py-2";
      btn.style.marginBottom = "8px";

      // Apply correctness styles on back of card (revealed).
      // Show green border on the correct option, red border on all non-correct options.
      // If graded, the chosen wrong option is also explicitly marked.
      if (reveal) {
        const isCorrect = origIdx === card.correctIndex;
        const isChosen = !!graded && typeof chosenOrigIdx === "number" && chosenOrigIdx === origIdx;
        const isChosenWrong = isChosen && chosenOrigIdx !== card.correctIndex;

        if (isCorrect) {
          btn.classList.add("bc-mcq-correct");
          btn.style.setProperty("border-color", "rgb(34, 197, 94)", "important"); // green
          btn.style.setProperty("background-color", "rgb(220, 252, 231)", "important"); // light green
          btn.style.borderWidth = "2px";
          btn.style.borderStyle = "solid";
        }

        if (isChosenWrong) {
          btn.classList.add("bc-mcq-wrong");
          btn.style.setProperty("border-color", "rgb(239, 68, 68)", "important"); // red
          btn.style.setProperty("background-color", "rgb(254, 226, 226)", "important"); // light red
          btn.style.borderWidth = "2px";
          btn.style.borderStyle = "solid";
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
      textEl.className = "bc min-w-0 whitespace-pre-wrap break-words";
      textEl.style.lineHeight = "1.75";
      textEl.style.display = "block";
      textEl.style.setProperty("font-size", "14px", "important");
      
      // Use markdown rendering if text contains wiki links or LaTeX
      if (text && (text.includes('[[') || text.includes('$'))) {
        void args.renderMarkdownInto(textEl, text, sourcePath).then(() => setupLinkHandlers(textEl, sourcePath));
      } else if (text && text.includes("\n")) {
        text.split(/\n+/).forEach(line => {
          const p = document.createElement("div");
          p.textContent = line;
          p.style.lineHeight = "1.75";
          p.style.marginBottom = "2px";
          textEl.appendChild(p);
        });
      } else {
        textEl.textContent = text;
      }
      left.appendChild(textEl);

      btn.appendChild(left);

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!graded) void args.answerMcq(origIdx);
      });

      optionList.appendChild(btn);
    });

    // Do not render separate Answer subtitle/content for MCQ.
  } else if (ioLike) {
    const reveal = !!graded || !!args.showAnswer;

    const ioHost = document.createElement("div");
    ioHost.className = "bc bc-io-host";
    ioHost.dataset.sproutIoWidget = "1";
    section.appendChild(ioHost);

    if (typeof args.renderImageOcclusionInto === "function") {
      void args.renderImageOcclusionInto(ioHost, card, sourcePath, reveal);
    } else {
      const md = String((card as any).ioSrc ?? (card as any).src ?? (card as any).image ?? (card as any).imageRef ?? "");
      if (md.trim()) void args.renderMarkdownInto(ioHost, md, sourcePath).then(() => setupLinkHandlers(ioHost, sourcePath));
      else ioHost.appendChild(h("div", "text-muted-foreground text-sm", "IO card missing image source."));
    }
  }

  const infoText = extractInfoField(card);
  const isBack = !!graded || !!args.showAnswer;
  const shouldShowInfo =
    (card.type === "basic" && isBack && !!infoText) || ((args.showInfo || graded) && !!infoText);
  if (shouldShowInfo) {
    section.appendChild(mutedLabel("Extra information"));
    section.appendChild(renderMdBlock("bc-info", infoText));
  }

  // Append section to wrap
  wrap.appendChild(section);

  // ===== Footer (actions) =====
  const footer = document.createElement("footer");
  footer.className = "bc flex flex-row items-center justify-between gap-4 p-10";
  wrap.appendChild(footer);

  // Left: Edit button
  const footerLeft = document.createElement("div");
  footerLeft.className = "bc flex items-center gap-2";

  const editBtn = makeTextButton({
    label: "Edit",
    className: "btn-outline",
    onClick: () => {
      args.openEditModal?.();
    },
    kbd: "E",
  });
  footerLeft.appendChild(editBtn);
  footer.appendChild(footerLeft);

  // Center: Reveal/Grade/Next buttons
  const footerCenter = document.createElement("div");
  footerCenter.className = "bc flex flex-wrap gap-2 items-center";
  footer.appendChild(footerCenter);

  const canGradeNow =
    !graded &&
    ((card.type === "basic" || card.type === "cloze" || card.type === "cloze-child" || ioLike) && !!args.showAnswer);

  // Basic/Cloze/IO: reveal gate
  if (
    (card.type === "basic" || card.type === "cloze" || card.type === "cloze-child" || ioLike) &&
    !args.showAnswer &&
    !graded
  ) {
    footerCenter.appendChild(
      makeTextButton({
        label: "Reveal",
        className: "btn",
        onClick: () => {
          args.setShowAnswer(true);
          args.rerender();
        },
        kbd: "↵",
      }),
    );
  }

  // Grading / next buttons (in center)
  const mainRow = document.createElement("div");
  mainRow.className = "bc flex flex-wrap items-center gap-2";
  let hasMainRowContent = false;

  if (!graded) {
    if (canGradeNow) {
      const goNext = () => void args.nextCard(true);

      // Practice mode: single Continue button
      if (practiceMode) {
        const continueBtn = makeTextButton({
          label: "Continue",
          className: "btn",
          onClick: goNext,
          kbd: "↵",
        });
        continueBtn.style.setProperty("background-color", "var(--sprout-easy-bg)", "important");
        continueBtn.style.setProperty("color", "var(--sprout-easy-fg)", "important");
        mainRow.appendChild(continueBtn);
        hasMainRowContent = true;
      } else {
        // Normal mode: grading buttons
        const group = document.createElement("div");
        group.className = "bc flex flex-wrap gap-2";
        mainRow.appendChild(group);
        hasMainRowContent = true;

        const againBtn = makeTextButton({
          label: "Again",
          className: "btn-destructive",
          onClick: () => args.gradeCurrentRating("again" as any, {}).then(goNext),
          kbd: "1",
        });
        againBtn.style.setProperty("background-color", "var(--sprout-again-bg)", "important");
        againBtn.style.setProperty("color", "var(--sprout-again-fg)", "important");
        group.appendChild(againBtn);

        if (four) {
          const hardBtn = makeTextButton({
            label: "Hard",
            className: "btn",
            onClick: () => args.gradeCurrentRating("hard" as any, {}).then(goNext),
            kbd: "2",
          });
          hardBtn.style.setProperty("background-color", "var(--sprout-hard-bg)", "important");
          hardBtn.style.setProperty("color", "var(--sprout-hard-fg)", "important");
          group.appendChild(hardBtn);

          const goodBtn = makeTextButton({
            label: "Good",
            className: "btn",
            onClick: () => args.gradeCurrentRating("good" as any, {}).then(goNext),
            kbd: "3",
          });
          goodBtn.style.setProperty("background-color", "var(--sprout-good-bg)", "important");
          goodBtn.style.setProperty("color", "var(--sprout-good-fg)", "important");
          group.appendChild(goodBtn);

          const easyBtn = makeTextButton({
            label: "Easy",
            className: "btn",
            onClick: () => args.gradeCurrentRating("easy" as any, {}).then(goNext),
            kbd: "4",
          });
          easyBtn.style.setProperty("background-color", "var(--sprout-easy-bg)", "important");
          easyBtn.style.setProperty("color", "var(--sprout-easy-fg)", "important");
          group.appendChild(easyBtn);
        } else {
          const goodBtn = makeTextButton({
            label: "Good",
            className: "btn",
            onClick: () => args.gradeCurrentRating("good" as any, {}).then(goNext),
            kbd: "2",
          });
          goodBtn.style.setProperty("background-color", "var(--sprout-good-bg)", "important");
          goodBtn.style.setProperty("color", "var(--sprout-good-fg)", "important");
          group.appendChild(goodBtn);
        }
      }

      if (skipEnabled) {
        const skipBtn = makeTextButton({
          label: "Skip",
          className: "btn-outline",
          onClick: () => args.skipCurrentCard({ uiSource: "skip-btn", uiKey: 13, uiButtons: four ? 4 : 2 }),
          kbd: "↵",
        });
        (skipBtn as any).dataset.bcAction = "skip-card";
        skipBtn.title = "Skip (↵)";
        mainRow.appendChild(skipBtn);
      }
    } else if (card.type === "mcq") {
      const optCount = (card.options || []).length;
      mainRow.appendChild(h("div", "text-muted-foreground text-sm", `Choose 1–${optCount}.`));
      hasMainRowContent = true;
    } else if (ioLike && !args.showAnswer) {
      mainRow.appendChild(h("div", "text-muted-foreground text-sm", "Press Enter to reveal the image."));
      hasMainRowContent = true;
    }
  } else {
    mainRow.appendChild(
      makeTextButton({
        label: "Next",
        className: "btn",
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
  footerRight.className = "bc flex items-center gap-2";

  // Provide open note handler globally for menu
  window.sproutOpenCurrentCardNote = () => {
    if (!card) return;
    const filePath = card.sourceNotePath || card.location || card.sourcePath;
    if (!filePath) return;
    const anchor = card.anchor || card.blockId || card.id;
    const anchorStr = anchor ? `#^${anchor}` : "";
    // @ts-ignore
    const app = window.app || (window.require && window.require('obsidian').app);
    if (app && app.workspace && typeof app.workspace.openLinkText === 'function') {
      app.workspace.openLinkText(filePath + anchorStr, filePath, true);
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
    }),
  );
  footer.appendChild(footerRight);

  args.container.appendChild(wrap);
  // Always refresh AOS to ensure animations work across the page
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        refreshAOS();
      } catch {}
    });
  });
}
