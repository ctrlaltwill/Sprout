/**
 * @file src/modals/modal-utils.ts
 * @summary Shared utility functions and internal types used by the modal classes (CardCreatorModal, ImageOcclusionCreatorModal, ParseErrorModal) and the bulk-edit overlay. Provides UI helpers (danger callouts, visibility toggles, modal title setters), text formatting (due dates, group paths, pipe escaping), platform detection, and a reusable card-editor factory for modal contexts.
 *
 * @exports
 *  - mkDangerCallout          — creates a styled danger/warning callout element
 *  - isStringArray            — type guard for string[]
 *  - nextFrame                — promise that resolves on the next animation frame
 *  - normaliseVaultPath       — normalises a vault-relative file path
 *  - normaliseFolderPath      — normalises a vault-relative folder path
 *  - isDesktop                — returns true on Obsidian desktop (non-mobile)
 *  - setDisabledUnder         — toggles disabled state for inputs under a container
 *  - parkBehind               — moves an element behind another in z-order
 *  - setVisible               — shows or hides an element via display style
 *  - typeLabelBrowser         — human-readable label for a card type
 *  - fmtDue                   — formats a due date relative to now
 *  - fmtLocation              — formats a card's vault file location string
 *  - titleCaseGroupPath       — title-cases each segment of a group path
 *  - parseGroupsInput         — parses a raw groups string into normalised paths
 *  - groupsToInput            — serialises group paths back to an editable string
 *  - ModalCardFieldKey        — type alias for field keys in modal card editors
 *  - ModalCardEditorConfig    — interface for modal card-editor configuration
 *  - ModalCardEditorResult    — interface for the value returned by createModalCardEditor
 *  - createModalCardEditor    — builds the card-editing form for a modal
 *  - focusFirstField          — focuses the first editable field in a card editor
 *  - escapePipeText           — escapes pipe characters in card field text
 *  - PipeKey                  — type alias for card field pipe keys (Q, A, T, etc.)
 *  - formatPipeField          — formats a field value with its pipe-key prefix
 *  - CardRef                  — type alias for a reference to a card in a file
 *  - ClipboardImage           — type alias for an image extracted from the clipboard
 *  - extFromMime              — derives a file extension from a MIME type
 *  - ensureParentFolder       — ensures the parent folder for a path exists in the vault
 *  - writeBinaryToVault       — writes binary data to a file in the vault
 *  - bestEffortAttachmentPath — resolves the best vault path for a pasted attachment
 *  - setModalTitle            — sets and styles a modal's title bar
 *  - hasClozeToken            — checks whether text contains a cloze deletion marker
 *  - createModalMcqSection    — builds the MCQ options UI section for a modal
 *  - scopeModalToWorkspace    — moves modal container to active leaf content for scoped display
 */

import { type Modal, Platform, TFile, setIcon, type App } from "obsidian";
import type SproutPlugin from "../main";
import {
  type CardType,
  createCardEditor,
} from "../card-editor/card-editor";
import type { CardRecord } from "../core/store";
import type { CardRecordType } from "../types/card";

// ──────────────────────────────────────────────────────────────────────────────
// DOM helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Renders a styled "danger callout" box (used by ParseErrorModal). */
export function mkDangerCallout(parent: HTMLElement, text: string) {
  const box = parent.createDiv({ cls: "bc rounded-lg p-3 text-sm sprout-danger-callout" });

  box.createEl("div", { text: "How to fix parse errors", cls: "bc font-medium mb-1" });
  box.createEl("div", { text, cls: "bc sprout-danger-callout-body" });

  return box;
}

/** Type-guard: is the value a `string[]`? */
export function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

/** Returns a promise that resolves after the next animation frame. */
export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

// ──────────────────────────────────────────────────────────────────────────────
// Path normalisation
// ──────────────────────────────────────────────────────────────────────────────

/** Normalise a vault-relative path (fix slashes, strip leading `./`). */
export function normaliseVaultPath(p: string): string {
  let s = String(p ?? "").trim();
  s = s.replace(/\\/g, "/");
  s = s.replace(/^\/+/, "");
  s = s.replace(/^\.\/+/, "");
  while (s.startsWith("../")) s = s.slice(3);
  s = s.replace(/\/{2,}/g, "/");
  return s;
}

/** Normalise a folder path (ensures trailing `/`). */
export function normaliseFolderPath(p: string): string {
  let s = normaliseVaultPath(p);
  if (!s) return "";
  if (!s.endsWith("/")) s += "/";
  return s;
}

/** True when running on Obsidian desktop. */
export function isDesktop(): boolean {
  return !Platform.isMobileApp;
}

// ──────────────────────────────────────────────────────────────────────────────
// Modal layout helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Disable (or re-enable) every interactive element under `root`. */
export function setDisabledUnder(root: HTMLElement, disabled: boolean) {
  const els = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(
    "input, textarea, select, button",
  );
  els.forEach((el) => {
    try {
      el.disabled = disabled;
    } catch {
      // ignore
    }
  });
}

/**
 * Push a modal behind the IO editor overlay, or restore it.
 * Used when the IO editor opens on top of the card creator.
 */
export function parkBehind(modalEl: HTMLElement, behind: boolean) {
  if (behind) {
    modalEl.addClass("sprout-modal-behind-io-editor");
  } else {
    modalEl.removeClass("sprout-modal-behind-io-editor");
  }
}

/**
 * Toggle an element's visibility.
 *
 * IMPORTANT: some utility styles can override basic toggles, so we set
 * both `[hidden]` and `display:none !important` when hiding.
 */
export function setVisible(el: HTMLElement, visible: boolean) {
  if (visible) {
    el.removeAttribute("hidden");
    el.classList.remove("sprout-hidden-important");
  } else {
    el.setAttribute("hidden", "");
    el.classList.add("sprout-hidden-important");
  }
}

/** Human-readable card-type label (for the browser / bulk-edit views). */
export function typeLabelBrowser(t: string): string {
  const ty = String(t ?? "").toLowerCase();
  if (ty === "basic") return "Basic";
  if (ty === "reversed" || ty === "reversed-child") return "Basic (Reversed)";
  if (ty === "cloze" || ty === "cloze-child") return "Cloze";
  if (ty === "mcq") return "Multiple choice";
  if (ty === "io" || ty === "io-child") return "Image occlusion";
  return ty;
}

// ──────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Format a due-date timestamp as a short label (Today / Tomorrow / MM-DD). */
export function fmtDue(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) return "—";
  const date = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

/** Show just the filename from a full note path. */
export function fmtLocation(path: string | null | undefined): string {
  if (!path) return "—";
  const lastSlash = path.lastIndexOf("/");
  return lastSlash !== -1 ? path.substring(lastSlash + 1) : path;
}

// ──────────────────────────────────────────────────────────────────────────────
// Group-path helpers (title-case, normalise, parse/format)
// ──────────────────────────────────────────────────────────────────────────────

function titleCaseToken(token: string): string {
  if (!token) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function titleCaseSegment(seg: string): string {
  if (!seg) return seg;
  return seg
    .split(/([\s_-]+)/)
    .map((part) => (/^[\s_-]+$/.test(part) ? part : titleCaseToken(part)))
    .join("");
}

function normalizeGroupPathInput(path: string): string {
  if (!path) return "";
  return path
    .split("/")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .join("/");
}

/** Title-case every segment of a `/`-delimited group path. */
export function titleCaseGroupPath(path: string): string {
  const normalized = normalizeGroupPathInput(path);
  if (!normalized) return "";
  return normalized
    .split("/")
    .map((seg) => titleCaseSegment(seg.trim()))
    .filter(Boolean)
    .join("/");
}

/** Parse a comma-separated groups input string into an array of normalised paths. */
export function parseGroupsInput(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => titleCaseGroupPath(s.trim()))
    .filter(Boolean);
}

/** Format an array of groups back into a comma-separated input string. */
export function groupsToInput(groups: unknown): string {
  if (!Array.isArray(groups)) return "";
  return groups
    .map((g: unknown) => titleCaseGroupPath(String(g).trim()))
    .filter(Boolean)
    .join(", ");
}

// ──────────────────────────────────────────────────────────────────────────────
// Card editor helpers (shared by CardCreatorModal and bulk-edit)
// ──────────────────────────────────────────────────────────────────────────────

export type ModalCardFieldKey = "title" | "question" | "answer" | "info" | "location" | "groups" | "id" | "type" | "stage" | "due";

export interface ModalCardEditorConfig {
  type: CardType;
  locationPath: string;
  locationTitle: string;
  plugin: SproutPlugin;
}

export interface ModalCardEditorResult {
  root: HTMLElement;
  inputEls: Partial<Record<ModalCardFieldKey, HTMLInputElement | HTMLTextAreaElement>>;
  getGroupInputValue: () => string;
  getMcqOptions?: () => { correct: string; corrects: string[]; wrongs: string[] };
  getOqSteps?: () => string[];
  buildMcqValue?: () => string | null;
}

/**
 * Build the shared card editor widget used inside the card-creator modal.
 * Returns the root element, input map, and helpers for groups/MCQ.
 */
export function createModalCardEditor(config: ModalCardEditorConfig): ModalCardEditorResult {
  const { type, locationPath, locationTitle, plugin } = config;

  // Build a minimal card record so the editor component can render
  const dummyCard: CardRecord = {
    id: "",
    type: type as CardRecordType,
    title: null,
    q: null,
    a: null,
    info: null,
    groups: null,
    clozeText: type === "cloze" ? null : undefined,
    stem: type === "mcq" ? null : undefined,
    options: type === "mcq" ? [] : undefined,
    correctIndex: type === "mcq" ? 0 : undefined,
    oqSteps: type === "oq" ? [] : undefined,
    sourceNotePath: locationPath || "",
    sourceStartLine: 0,
  };

  const editor = createCardEditor({
    cards: [dummyCard],
    plugin,
    locationPath: locationPath || "",
    locationTitle: locationTitle || "",
    showReadOnlyFields: false,
    forceType: type,
  });

  return {
    root: editor.root,
    inputEls: editor.inputEls,
    getGroupInputValue: editor.getGroupInputValue,
    getMcqOptions: editor.getMcqOptions,
    getOqSteps: editor.getOqSteps,
    buildMcqValue: editor.buildMcqValue,
  };
}

/** Focus the first visible form control in `el`. */
export function focusFirstField(el: HTMLElement) {
  const first = el.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input:not([type='hidden']), textarea, select",
  );
  first?.focus?.();
}

// ──────────────────────────────────────────────────────────────────────────────
// Delimiter-format helpers (must match parser delimiter semantics)
// ──────────────────────────────────────────────────────────────────────────────

import { escapeDelimiterText, formatDelimitedField } from "../core/delimiter";

/** Escape delimiter characters for the Sprout delimited format. */
export function escapePipeText(s: string): string {
  return escapeDelimiterText(s);
}

export type PipeKey =
  | "T"
  | "Q"
  | "RQ"
  | "A"
  | "CQ"
  | "MCQ"
  | "OQ"
  | "IO"
  | "I"
  | "O"
  | "G"
  | "K"
  | "C"
  | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18" | "19" | "20";

/**
 * Format a single delimited field. Multi-line values are split across
 * multiple output lines (the closing delimiter is on the last line).
 */
export function formatPipeField(key: PipeKey, value: string): string[] {
  return formatDelimitedField(key, value);
}

/** Reference to a card in the quarantine (used by ParseErrorModal). */
export type CardRef = {
  id: string;
  sourceNotePath: string;
  sourceStartLine: number;
  errors: string[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Clipboard image helper (best-effort; Electron permissions vary)
// ──────────────────────────────────────────────────────────────────────────────

export type ClipboardImage = { mime: string; data: ArrayBuffer };

/** Map an image MIME type to a file extension. */
export function extFromMime(mime: string): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "png";
}

// ──────────────────────────────────────────────────────────────────────────────
// Vault binary I/O
// ──────────────────────────────────────────────────────────────────────────────

/** Ensure the parent folder of a vault path exists. */
export async function ensureParentFolder(app: App, vaultPath: string) {
  const parts = vaultPath.split("/").filter(Boolean);
  if (parts.length <= 1) return;

  const parent = parts.slice(0, -1).join("/");
  const adapter = app.vault?.adapter;
  if (!adapter?.exists || !adapter?.mkdir) return;

  const exists = await adapter.exists(parent);
  if (!exists) await adapter.mkdir(parent);
}

/** Write binary data to a vault path (create or overwrite). */
export async function writeBinaryToVault(app: App, vaultPath: string, data: ArrayBuffer) {
  const vault = app.vault;
  const path = normaliseVaultPath(vaultPath);

  await ensureParentFolder(app, path);

  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    if (typeof vault?.modifyBinary === "function") {
      await vault.modifyBinary(existing, data);
      return;
    }
  }

  if (typeof vault?.createBinary === "function") {
    await vault.createBinary(path, data);
    return;
  }

  const adapter = vault?.adapter;
  if (adapter?.writeBinary) {
    await adapter.writeBinary(path, data);
    return;
  }

  throw new Error("No supported binary write method available.");
}

/**
 * Determine the best vault path for saving an attachment.
 *
 * For IO images: uses `plugin.settings.storage.imageOcclusionFolderPath`.
 * For card attachments (Q/A/Info fields): uses `plugin.settings.storage.cardAttachmentFolderPath`.
 * Falls back to the Obsidian fileManager or the active note's parent folder.
 */
export function bestEffortAttachmentPath(plugin: SproutPlugin, active: TFile, baseName: string, type: "io" | "card" = "io"): string {
  const folderRaw = type === "card"
    ? (plugin.settings.storage.cardAttachmentFolderPath ?? "")
    : (plugin.settings.storage.imageOcclusionFolderPath ?? "");
  const folder = normaliseFolderPath(folderRaw);

  if (folder) return normaliseVaultPath(`${folder}${baseName}`);

  const fm = plugin.app.fileManager;
  if (fm?.getAvailablePathForAttachment) {
    try {
      const p = fm.getAvailablePathForAttachment(baseName, active.path) as unknown as string;
      if (p && p.length) return normaliseVaultPath(p);
    } catch {
      // fall through
    }
  }

  const parent = active.parent?.path ? String(active.parent.path) : "";
  const fallback = parent ? `${parent}/${baseName}` : baseName;
  return normaliseVaultPath(fallback);
}

/** Set a modal's title text (cross-version compatibility). */
export function setModalTitle(modal: Modal, title: string) {
  if (typeof modal.setTitle === "function") modal.setTitle(title);
  else if (modal.titleEl) modal.titleEl.textContent = title;
}

/** Does the string contain at least one `{{cN::…}}` cloze token? */
export function hasClozeToken(s: string): boolean {
  return /\{\{c\d+::/i.test(String(s || ""));
}

// ──────────────────────────────────────────────────────────────────────────────
// MCQ section builder (used by CardCreatorModal)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the MCQ answer options input section for creating MCQ cards.
 * Each option has a checkbox to mark it as correct.
 * Returns the container element and a `getOptions()` accessor.
 */
export function createModalMcqSection() {
  const container = document.createElement("div");
  container.className = "bc flex flex-col gap-1";

  const label = document.createElement("label");
  label.className = "bc text-sm font-medium inline-flex items-center gap-1";
  label.textContent = "Answers and options";
  const mcqInfoIcon = document.createElement("span");
  mcqInfoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
  mcqInfoIcon.setAttribute("data-tooltip", "Check the box next to each correct answer. At least one correct and one incorrect option required.");
  mcqInfoIcon.setAttribute("data-tooltip-position", "top");
  setIcon(mcqInfoIcon, "info");
  label.appendChild(mcqInfoIcon);
  container.appendChild(label);

  const optionsContainer = document.createElement("div");
  optionsContainer.className = "bc flex flex-col gap-2";
  container.appendChild(optionsContainer);

  type OptionRowEntry = { row: HTMLElement; input: HTMLInputElement; checkbox: HTMLInputElement; removeBtn: HTMLButtonElement };
  const optionRows: OptionRowEntry[] = [];

  const updateRemoveButtons = () => {
    const disable = optionRows.length <= 2;
    for (const entry of optionRows) {
      entry.removeBtn.disabled = disable;
      entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
      entry.removeBtn.classList.toggle("is-disabled", disable);
    }
  };

  const addOptionRow = (value: string, isCorrect: boolean) => {
    const row = document.createElement("div");
    row.className = "bc flex items-center gap-2 sprout-edit-mcq-option-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isCorrect;
    checkbox.className = "bc sprout-mcq-correct-checkbox";
    checkbox.setAttribute("data-tooltip", "Mark as correct answer");
    checkbox.setAttribute("data-tooltip-position", "top");
    row.appendChild(checkbox);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "bc input flex-1 text-sm sprout-input-fixed";
    input.placeholder = "Enter an answer option";
    input.value = value;
    row.appendChild(input);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "bc inline-flex items-center justify-center h-9 w-9 p-0 sprout-remove-btn-ghost";
    removeBtn.setAttribute("data-tooltip", "Remove option");
    removeBtn.setAttribute("data-tooltip-position", "top");
    const xIcon = document.createElement("span");
    xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(xIcon, "x");
    removeBtn.appendChild(xIcon);
    removeBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (optionRows.length <= 2) return;
      const idx = optionRows.findIndex((entry) => entry.input === input);
      if (idx === -1) return;
      optionRows[idx].row.remove();
      optionRows.splice(idx, 1);
      updateRemoveButtons();
    });
    row.appendChild(removeBtn);

    optionsContainer.appendChild(row);
    optionRows.push({ row, input, checkbox, removeBtn });
    updateRemoveButtons();
  };

  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.className = "bc input flex-1 text-sm sprout-input-fixed";
  addInput.placeholder = "Add another option (press enter)";
  addInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      const value = addInput.value.trim();
      if (!value) return;
      addOptionRow(value, false);
      addInput.value = "";
    }
  });
  addInput.addEventListener("blur", () => {
    const value = addInput.value.trim();
    if (!value) return;
    addOptionRow(value, false);
    addInput.value = "";
  });

  const addInputWrap = document.createElement("div");
  addInputWrap.className = "bc flex items-center gap-2";
  addInputWrap.appendChild(addInput);
  container.appendChild(addInputWrap);

  // Start with one correct and one wrong row
  addOptionRow("", true);
  addOptionRow("", false);

  const getOptions = () => {
    const allOpts = optionRows
      .map((entry) => ({ text: String(entry.input.value || "").trim(), isCorrect: entry.checkbox.checked }))
      .filter((opt) => opt.text.length > 0);
    const corrects = allOpts.filter((o) => o.isCorrect).map((o) => o.text);
    const wrongs = allOpts.filter((o) => !o.isCorrect).map((o) => o.text);
    return {
      correct: corrects[0] || "",
      corrects,
      wrongs,
    };
  };

  return { element: container, getOptions };
}

// ──────────────────────────────────────────────────────────────────────────────
// Themed dropdown (replaces native <select> with styled popover)
// ──────────────────────────────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
}

export interface ThemedDropdownResult {
  /** The outer container element to append to the DOM. */
  element: HTMLElement;
  /** Get the currently selected value. */
  getValue: () => string;
  /** Programmatically set the value and update the label. */
  setValue: (value: string) => void;
  /** Register a change callback. */
  onChange: (cb: (value: string) => void) => void;
}

export interface ThemedDropdownConfig {
  /** When true (default), the trigger and container stretch to full width. */
  fullWidth?: boolean;
  /** Trigger size preset. Defaults to "md". */
  buttonSize?: "md" | "sm";
  /** How to justify trigger contents. Defaults to "between" for fullWidth, otherwise "start". */
  buttonJustify?: "between" | "start";
  /** Extra classes applied to the outer container. */
  containerClassName?: string;
  /** Extra classes applied to the trigger button. */
  buttonClassName?: string;
}

/**
 * Build a themed popover dropdown that replaces a native `<select>`.
 * Opens below the trigger button with radio-dot indicators.
 */
export function createThemedDropdown(
  options: DropdownOption[],
  initialValue?: string,
  extraCls?: string,
  config?: ThemedDropdownConfig,
): ThemedDropdownResult {
  let currentValue = initialValue ?? options[0]?.value ?? "";
  let changeCb: ((value: string) => void) | null = null;

  const fullWidth = config?.fullWidth ?? true;
  const buttonSize = config?.buttonSize ?? "md";
  const buttonJustify = config?.buttonJustify ?? (fullWidth ? "between" : "start");

  const container = document.createElement("div");
  container.className = [
    "bc sprout relative inline-flex",
    fullWidth ? "w-full" : "",
    extraCls ?? "",
    config?.containerClassName ?? "",
  ].filter(Boolean).join(" ");

  // Trigger button
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = [
    "bc btn-outline text-sm inline-flex items-center gap-2",
    buttonSize === "sm" ? "h-7 px-2" : "h-9 px-3",
    fullWidth ? "w-full" : "",
    buttonJustify === "between" ? "justify-between" : "",
    config?.buttonClassName ?? "",
  ].filter(Boolean).join(" ");
  btn.setAttribute("data-tooltip", "Open menu");
  btn.setAttribute("data-tooltip-position", "top");
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  container.appendChild(btn);

  const btnText = document.createElement("span");
  btnText.className = "bc truncate";
  btn.appendChild(btnText);

  const btnIcon = document.createElement("span");
  btnIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3";
  setIcon(btnIcon, "chevron-down");
  btn.appendChild(btnIcon);

  // Popover dropdown
  const popover = document.createElement("div");
  popover.className = "sprout-popover-dropdown sprout-popover-dropdown-below";
  popover.setAttribute("aria-hidden", "true");
  container.appendChild(popover);

  const panel = document.createElement("div");
  panel.className = "bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto";
  popover.appendChild(panel);

  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.className = "bc flex flex-col";
  panel.appendChild(menu);

  const updateLabel = () => {
    const opt = options.find((o) => o.value === currentValue);
    btnText.textContent = opt?.label ?? currentValue;
  };

  let isOpen = false;

  const close = () => {
    btn.setAttribute("aria-expanded", "false");
    popover.setAttribute("aria-hidden", "true");
    popover.classList.remove("is-open");
    isOpen = false;
  };

  const buildMenu = () => {
    while (menu.firstChild) menu.removeChild(menu.firstChild);
    for (const opt of options) {
      const item = document.createElement("div");
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", opt.value === currentValue ? "true" : "false");
      item.tabIndex = 0;
      item.className =
        "bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

      const dotWrap = document.createElement("div");
      dotWrap.className = "bc size-4 flex items-center justify-center";
      item.appendChild(dotWrap);

      const dot = document.createElement("div");
      dot.className = "bc size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
      dot.setAttribute("aria-hidden", "true");
      dotWrap.appendChild(dot);

      const txt = document.createElement("span");
      txt.className = "bc";
      txt.textContent = opt.label;
      item.appendChild(txt);

      const activate = () => {
        currentValue = opt.value;
        updateLabel();
        close();
        changeCb?.(currentValue);
      };

      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        activate();
      });

      item.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          close();
          btn.focus();
        }
      });

      menu.appendChild(item);
    }
  };

  const open = () => {
    buildMenu();
    btn.setAttribute("aria-expanded", "true");
    popover.setAttribute("aria-hidden", "false");
    popover.classList.add("is-open");
    isOpen = true;

    const onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (container.contains(t)) return;
      close();
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };

    window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
    }, 0);
  };

  btn.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (isOpen) close();
    else open();
  });

  updateLabel();

  return {
    element: container,
    getValue: () => currentValue,
    setValue: (value: string) => {
      currentValue = value;
      updateLabel();
    },
    onChange: (cb) => { changeCb = cb; },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Workspace-scoped modal positioning
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Moves a modal's containerEl to the active workspace leaf content area so it only covers
 * the active leaf and allows users to interact with sidebars, switch tabs, etc.
 * This should be called in the modal's onOpen() after the modal is created.
 * 
 * @param modal - The Obsidian Modal instance
 */
export function scopeModalToWorkspace(modal: Modal) {
  // Find the active workspace leaf content
  const activeLeaf = document.querySelector(".workspace-leaf.mod-active");
  const leafContent = activeLeaf?.querySelector(".workspace-leaf-content");
  
  if (!leafContent || !modal.containerEl) {
    return; // Fallback to default behavior if leaf content not found
  }

  // Move the modal container from document.body to leaf content
  try {
    leafContent.appendChild(modal.containerEl);
  } catch {
    // If the element is already in the leaf content or fails to move, continue silently
  }
}
