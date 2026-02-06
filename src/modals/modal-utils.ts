/**
 * modals/modal-utils.ts
 * ---------------------------------------------------------------------------
 * Shared utility functions and internal types used by the various modal
 * classes (CardCreatorModal, ImageOcclusionCreatorModal, ParseErrorModal)
 * and the bulk-edit overlay.
 *
 * Nothing in this file is part of the public API — consumer code should
 * import from the barrel at `src/modals.ts` (or the specific modal file).
 * ---------------------------------------------------------------------------
 */

import { Modal, Notice, Platform, TFile, setIcon, type App } from "obsidian";
import type SproutPlugin from "../main";
import { BRAND } from "../core/constants";
import {
  createGroupPickerField as createGroupPickerFieldImpl,
  type CardType,
  createCardEditor,
} from "../card-editor/card-editor";
import type { CardRecord } from "../core/store";
import { generateUniqueId } from "../core/ids";

// ──────────────────────────────────────────────────────────────────────────────
// DOM helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Renders a styled "danger callout" box (used by ParseErrorModal). */
export function mkDangerCallout(parent: HTMLElement, text: string) {
  const box = parent.createDiv({ cls: "bc rounded-lg border p-3 text-sm" });
  box.style.borderColor = "rgba(220, 38, 38, 0.35)";
  box.style.background = "rgba(220, 38, 38, 0.08)";

  box.createEl("div", { text: "How to fix parse errors", cls: "bc font-medium mb-1" });
  const body = box.createEl("div", { text, cls: "bc" });
  body.style.whiteSpace = "pre-wrap";
  body.style.lineHeight = "1.35";

  return box;
}

/** Type-guard: is the value a `string[]`? */
export function isStringArray(x: any): x is string[] {
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

/** Strip Obsidian embed syntax `![[foo|bar]]` → `foo`. */
export function stripEmbedSyntax(raw: string): string {
  let s = String(raw ?? "").trim();
  if (s.startsWith("![[") && s.endsWith("]]")) s = s.slice(3, -2).trim();
  if (s.includes("|")) s = s.split("|")[0].trim();
  return normaliseVaultPath(s);
}

/**
 * Resolve an IO image reference (embed syntax or plain path) to a vault TFile.
 * Tries metadataCache link resolution first, then direct path lookup.
 */
export function resolveIoImageFile(app: App, sourceNotePath: string, imageRef: string): TFile | null {
  const link = stripEmbedSyntax(imageRef);
  if (!link) return null;

  const cache: any = (app as any).metadataCache;
  const dest = cache?.getFirstLinkpathDest?.(link, sourceNotePath);
  if (dest instanceof TFile) return dest;

  const af = app.vault.getAbstractFileByPath(link);
  if (af instanceof TFile) return af;

  return null;
}

/** Map a file extension to its MIME type (for IO image handling). */
export function mimeFromExt(ext: string): string {
  const e = String(ext || "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return "image/png";
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
      (el as any).disabled = disabled;
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
    (modalEl.style as any).pointerEvents = "none";
    (modalEl.style as any).zIndex = "0";
  } else {
    modalEl.removeClass("sprout-modal-behind-io-editor");
    (modalEl.style as any).pointerEvents = "";
    (modalEl.style as any).zIndex = "";
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
    el.style.removeProperty("display");
  } else {
    el.setAttribute("hidden", "");
    el.style.setProperty("display", "none", "important");
  }
}

/** Human-readable card-type label (for the browser / bulk-edit views). */
export function typeLabelBrowser(t: string): string {
  const ty = String(t ?? "").toLowerCase();
  if (ty === "basic") return "Basic";
  if (ty === "cloze") return "Cloze";
  if (ty === "mcq") return "MCQ";
  if (ty === "io") return "Image Occlusion";
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
export function groupsToInput(groups: any): string {
  if (!Array.isArray(groups)) return "";
  return groups
    .map((g) => titleCaseGroupPath(String(g).trim()))
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
  getMcqOptions?: () => { correct: string; wrongs: string[] };
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
    type: type as any,
    title: null,
    q: null,
    a: null,
    info: null,
    groups: null,
    clozeText: type === "cloze" ? null : undefined,
    stem: type === "mcq" ? null : undefined,
    options: type === "mcq" ? [] : undefined,
    correctIndex: type === "mcq" ? 0 : undefined,
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
    inputEls: editor.inputEls as any,
    getGroupInputValue: editor.getGroupInputValue,
    getMcqOptions: editor.getMcqOptions,
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
// Pipe-format helpers (must match parser pipe semantics)
// ──────────────────────────────────────────────────────────────────────────────

/** Escape pipe characters for the Sprout pipe format. */
export function escapePipeText(s: string): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export type PipeKey =
  | "T"
  | "Q"
  | "A"
  | "CQ"
  | "MCQ"
  | "IO"
  | "I"
  | "O"
  | "G"
  | "K"
  | "C";

/**
 * Format a single pipe-delimited field. Multi-line values are split across
 * multiple output lines (the closing `|` is on the last line).
 */
export function formatPipeField(key: PipeKey, value: string): string[] {
  const raw = String(value ?? "");
  const parts = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (parts.length <= 1) {
    return [`${key} | ${escapePipeText(parts[0] ?? "")} |`];
  }

  const out: string[] = [];
  out.push(`${key} | ${escapePipeText(parts[0] ?? "")}`);
  for (let i = 1; i < parts.length - 1; i++) out.push(escapePipeText(parts[i] ?? ""));
  out.push(`${escapePipeText(parts[parts.length - 1] ?? "")} |`);
  return out;
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

/** Try to read an image from the system clipboard. Returns `null` on failure. */
export async function readClipboardImage(): Promise<ClipboardImage | null> {
  try {
    const navAny: any = navigator as any;
    if (!navAny?.clipboard?.read) return null;

    const items: any[] = await navAny.clipboard.read();
    for (const item of items) {
      const types: string[] = Array.isArray(item?.types) ? item.types : [];
      const imgType = types.find((t) => typeof t === "string" && t.startsWith("image/"));
      if (!imgType) continue;

      const blob: Blob = await item.getType(imgType);
      const data = await blob.arrayBuffer();
      return { mime: imgType, data };
    }
    return null;
  } catch {
    return null;
  }
}

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
  const adapter: any = (app.vault as any)?.adapter;
  if (!adapter?.exists || !adapter?.mkdir) return;

  const exists = await adapter.exists(parent);
  if (!exists) await adapter.mkdir(parent);
}

/** Write binary data to a vault path (create or overwrite). */
export async function writeBinaryToVault(app: App, vaultPath: string, data: ArrayBuffer) {
  const vaultAny: any = app.vault as any;
  const path = normaliseVaultPath(vaultPath);

  await ensureParentFolder(app, path);

  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    if (typeof vaultAny?.modifyBinary === "function") {
      await vaultAny.modifyBinary(existing, data);
      return;
    }
  }

  if (typeof vaultAny?.createBinary === "function") {
    await vaultAny.createBinary(path, data);
    return;
  }

  const adapter: any = vaultAny?.adapter;
  if (adapter?.writeBinary) {
    await adapter.writeBinary(path, data);
    return;
  }

  throw new Error("No supported binary write method available.");
}

/**
 * Determine the best vault path for saving an attachment.
 *
 * For IO images: uses `plugin.settings.imageOcclusion.attachmentFolderPath`.
 * For card attachments (Q/A/Info fields): uses `plugin.settings.cardAttachments.attachmentFolderPath`.
 * Falls back to the Obsidian fileManager or the active note's parent folder.
 */
export function bestEffortAttachmentPath(plugin: SproutPlugin, active: TFile, baseName: string, type: "io" | "card" = "io"): string {
  const folderRaw = type === "card"
    ? ((plugin.settings as any)?.cardAttachments?.attachmentFolderPath ?? "")
    : ((plugin.settings as any)?.imageOcclusion?.attachmentFolderPath ?? "");
  const folder = normaliseFolderPath(folderRaw);

  if (folder) return normaliseVaultPath(`${folder}${baseName}`);

  const fm: any = (plugin.app as any)?.fileManager;
  if (fm?.getAvailablePathForAttachment) {
    try {
      const p = fm.getAvailablePathForAttachment(baseName, active.path);
      if (typeof p === "string" && p.length) return normaliseVaultPath(p);
    } catch {
      // fall through
    }
  }

  const parent = active.parent?.path ? String(active.parent.path) : "";
  const fallback = parent ? `${parent}/${baseName}` : baseName;
  return normaliseVaultPath(fallback);
}

// ──────────────────────────────────────────────────────────────────────────────
// ID reservation (so IO can use ^sprout-ID immediately, before sync)
// ──────────────────────────────────────────────────────────────────────────────

/** Collect all `^sprout-NNNNNNNNN` anchor IDs from a text string. */
export function collectAnchorIdsFromText(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\^sprout-(\d{9})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

/**
 * Generate a new unique Sprout card ID that doesn't collide with any
 * existing IDs in the store or in the note's anchor references.
 */
export async function reserveNewBcId(plugin: SproutPlugin, file: TFile): Promise<string> {
  const storeAny: any = (plugin as any)?.store;
  const used = new Set<string>();

  try {
    for (const k of Object.keys(storeAny?.data?.cards || {})) used.add(String(k));
    for (const k of Object.keys(storeAny?.data?.quarantine || {})) used.add(String(k));
    for (const k of Object.keys(storeAny?.data?.cardById || {})) used.add(String(k));
  } catch {
    // ignore
  }

  try {
    const txt = await plugin.app.vault.read(file);
    for (const id of collectAnchorIdsFromText(txt)) used.add(id);
  } catch {
    // ignore
  }

  const id = String((generateUniqueId as any)(used)).trim();
  return id;
}

// ──────────────────────────────────────────────────────────────────────────────
// IO markdown helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the markdown block for an IO card (pipe-format lines).
 * The `^sprout-ID` anchor is added by sync, not here.
 */
export function buildIoMarkdownWithAnchor(params: {
  id: string;
  title?: string;
  groups?: string;
  ioEmbed: string;
  occlusionsJson?: string | null;
  maskMode?: "solo" | "all" | null;
  info?: string;
}): string[] {
  const out: string[] = [];
  if (params.title?.trim()) out.push(...formatPipeField("T", params.title.trim()));
  if (params.groups?.trim()) out.push(...formatPipeField("G", params.groups.trim()));
  out.push(...formatPipeField("IO", params.ioEmbed));
  // O (occlusions) and C (maskMode) are stored in store.io only, not in markdown
  if (params.info?.trim()) out.push(...formatPipeField("I", params.info.trim()));
  out.push("");
  return out;
}

/** Set a modal's title text (cross-version compatibility). */
export function setModalTitle(modal: Modal, title: string) {
  const anyModal: any = modal as any;
  if (typeof anyModal?.setTitle === "function") anyModal.setTitle(title);
  else if (anyModal?.titleEl && typeof anyModal.titleEl.setText === "function") anyModal.titleEl.setText(title);
  else if (anyModal?.titleEl) anyModal.titleEl.textContent = title;
}

/** Does the string contain at least one `{{cN::…}}` cloze token? */
export function hasClozeToken(s: string): boolean {
  return /\{\{c\d+::/i.test(String(s || ""));
}

// ──────────────────────────────────────────────────────────────────────────────
// MCQ section builder (used by CardCreatorModal)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the "correct answer + wrong options" input section for MCQ cards.
 * Returns the container element and a `getOptions()` accessor.
 */
export function createModalMcqSection() {
  const container = document.createElement("div");
  container.className = "bc flex flex-col gap-1";

  const label = document.createElement("label");
  label.className = "bc text-sm font-medium";
  label.textContent = "Answer";
  container.appendChild(label);

  const correctWrapper = document.createElement("div");
  correctWrapper.className = "bc flex flex-col gap-1";
  const correctLabel = document.createElement("div");
  correctLabel.className = "bc text-xs text-muted-foreground inline-flex items-center gap-1";
  correctLabel.textContent = "Correct answer";
  correctLabel.appendChild(Object.assign(document.createElement("span"), { className: "bc text-destructive", textContent: "*" }));
  correctWrapper.appendChild(correctLabel);
  const correctInput = document.createElement("input");
  correctInput.type = "text";
  correctInput.className = "bc input w-full";
  correctInput.placeholder = "Correct option";
  correctInput.style.minHeight = "38px";
  correctInput.style.maxHeight = "38px";
  correctInput.style.height = "38px";
  correctWrapper.appendChild(correctInput);
  container.appendChild(correctWrapper);

  const wrongLabel = document.createElement("div");
  wrongLabel.className = "bc text-xs text-muted-foreground inline-flex items-center gap-1";
  wrongLabel.textContent = "Wrong options";
  wrongLabel.appendChild(Object.assign(document.createElement("span"), { className: "bc text-destructive", textContent: "*" }));
  container.appendChild(wrongLabel);

  const wrongContainer = document.createElement("div");
  wrongContainer.className = "bc flex flex-col gap-2";
  container.appendChild(wrongContainer);

  type WrongRowEntry = { row: HTMLElement; input: HTMLInputElement; removeBtn: HTMLButtonElement };
  const wrongRows: WrongRowEntry[] = [];

  const updateRemoveButtons = () => {
    const disable = wrongRows.length <= 1;
    for (const entry of wrongRows) {
      entry.removeBtn.disabled = disable;
      entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
      entry.removeBtn.style.setProperty("opacity", disable ? "0.35" : "1", "important");
      entry.removeBtn.style.cursor = disable ? "default" : "pointer";
    }
  };

  const addWrongRow = (value: string) => {
    const row = document.createElement("div");
    row.className = "bc flex items-center gap-2";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "bc input flex-1 text-sm";
    input.placeholder = "Wrong option";
    input.value = value;
    input.style.minHeight = "38px";
    input.style.maxHeight = "38px";
    input.style.height = "38px";
    row.appendChild(input);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "bc inline-flex items-center justify-center";
    removeBtn.style.setProperty("border", "none", "important");
    removeBtn.style.setProperty("background", "transparent", "important");
    removeBtn.style.setProperty("padding", "0", "important");
    removeBtn.style.setProperty("box-shadow", "none", "important");
    removeBtn.style.setProperty("outline", "none", "important");
    removeBtn.style.setProperty("color", "var(--muted-foreground)", "important");
    const xIcon = document.createElement("span");
    xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-[0.8rem]";
    setIcon(xIcon, "x");
    removeBtn.appendChild(xIcon);
    removeBtn.addEventListener("mouseenter", () => {
      if (removeBtn.disabled) return;
      removeBtn.style.setProperty("color", "var(--foreground)", "important");
    });
    removeBtn.addEventListener("mouseleave", () => {
      removeBtn.style.setProperty("color", "var(--muted-foreground)", "important");
    });
    removeBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (wrongRows.length <= 1) return;
      const idx = wrongRows.findIndex((entry) => entry.input === input);
      if (idx === -1) return;
      wrongRows[idx].row.remove();
      wrongRows.splice(idx, 1);
      updateRemoveButtons();
    });
    row.appendChild(removeBtn);

    wrongContainer.appendChild(row);
    wrongRows.push({ row, input, removeBtn });
    updateRemoveButtons();
  };

  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.className = "bc input flex-1 text-sm";
  addInput.placeholder = "Add another wrong option";
  addInput.style.minHeight = "38px";
  addInput.style.maxHeight = "38px";
  addInput.style.height = "38px";
  addInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      const value = addInput.value.trim();
      if (!value) return;
      addWrongRow(value);
      addInput.value = "";
    }
  });
  addInput.addEventListener("blur", () => {
    const value = addInput.value.trim();
    if (!value) return;
    addWrongRow(value);
    addInput.value = "";
  });

  const addInputWrap = document.createElement("div");
  addInputWrap.className = "bc flex items-center gap-2";
  addInputWrap.appendChild(addInput);
  container.appendChild(addInputWrap);

  addWrongRow("");

  const getOptions = () => ({
    correct: String(correctInput.value || "").trim(),
    wrongs: wrongRows.map((entry) => String(entry.input.value || "").trim()).filter(Boolean),
  });

  return { element: container, getOptions };
}
