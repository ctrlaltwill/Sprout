/**
 * @file src/modals/parse-error-modal.ts
 * @summary Displays a list of cards that failed to parse during sync and lets the user jump to the anchor in the source note or quick-edit the card directly from the modal. Each quarantined card is shown with its anchor reference, source note path, parsing errors, and action buttons for navigation and inline editing.
 *
 * @exports
 *  - ParseErrorModal — Obsidian Modal subclass that renders the quarantined-cards list with "Open at anchor" and "Quick edit" actions
 */

import { Modal, Notice, TFile, MarkdownView, setIcon, type App } from "obsidian";
import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
import { BRAND } from "../core/constants";
import { parseCardsFromText, type ParsedCard } from "../parser/parser";
import { CardEditModal, saveCardEdits } from "../reviewer/card-editor";

import {
  mkDangerCallout,
  isStringArray,
  setModalTitle,
  type CardRef,
} from "./modal-utils";

// ──────────────────────────────────────────────────────────────────────────────
// ParseErrorModal
// ──────────────────────────────────────────────────────────────────────────────

export class ParseErrorModal extends Modal {
  private plugin: SproutPlugin;
  private quarantinedIds: string[];

  constructor(app: App, plugin: SproutPlugin, quarantinedIds: string[]) {
    super(app);
    this.plugin = plugin;
    this.quarantinedIds = Array.isArray(quarantinedIds) ? quarantinedIds : [];
  }

  // ── Modal lifecycle ───────────────────────────────────────────────────────

  onOpen() {
    setModalTitle(this, `${BRAND}: parse errors`);

    this.containerEl.addClass("sprout-modal-container");
    this.containerEl.addClass("sprout-modal-dim");
    this.containerEl.addClass("sprout");
    this.modalEl.addClass("bc", "sprout-modals");
    this.contentEl.addClass("bc");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();


    const root = contentEl.createDiv({ cls: "bc flex flex-col gap-4" });

    // Callout with common parsing fixes
    mkDangerCallout(
      root,
      [
        "Typical fixes:",
        "• Ensure each card has exactly one start line: Q | ... |  or  MCQ | ... |  or  CQ | ... |  or  IO | ... |.",
        "• Pipe-format fields (T | ... |, A | ... |, I | ... |, etc.) must end with a closing | (unless intentionally multiline, then close later).",
        "• MCQ supports:",
        "  - New format: O | wrong | (>=1) and A | correct | (exactly 1)",
        "  - Legacy: O: opt1 | **correct** | opt3",
        "• Cloze requires at least one {{cN::...}} token.",
        "• IO requires a valid image embed on the IO line.",
        "",
        "Use Open to jump to the exact ^sprout- anchor, or Edit to quick-fix the card.",
      ].join("\n"),
    );

    // Render each quarantined card
    const list = root.createDiv({ cls: "bc flex flex-col gap-3" });

    for (const id of this.quarantinedIds) {
      const ref = this.resolveCardRef(id);

      const row = list.createDiv({ cls: "bc card p-3" });

      const top = row.createDiv({ cls: "bc flex items-center justify-between gap-3" });

      const left = top.createDiv({ cls: "bc flex flex-col gap-1" });
      left.createDiv({ text: `^sprout-${id}`, cls: "bc font-medium" });
      left.createDiv({
        text: ref?.sourceNotePath ? ref.sourceNotePath : "(note path unresolved; will try active note)",
        cls: "bc text-muted-foreground text-xs",
      });

      // Action buttons: open in note and quick edit
      const actions = top.createDiv({ cls: "bc flex items-center gap-2" });

      const openBtn = actions.createEl("button", { cls: "bc btn-icon-ghost", attr: { "data-tooltip": "Open at anchor" } });
      openBtn.type = "button";
      setIcon(openBtn, "arrow-up-right");
      openBtn.onclick = () => void this.openAtAnchor(id);

      const editBtn = actions.createEl("button", { cls: "bc btn-icon-ghost", attr: { "data-tooltip": "Quick edit" } });
      editBtn.type = "button";
      setIcon(editBtn, "edit-3");
      editBtn.onclick = () => void this.openQuickEdit(id);

      // Show error list if available
      const errs = (ref?.errors || []).filter(Boolean);
      if (errs.length) {
        const ul = row.createEl("ul", { cls: "bc text-sm sprout-parse-errors-list" });
        for (const e of errs) ul.createEl("li", { text: e });
      } else {
        row.createDiv({ text: "No error details available.", cls: "bc text-muted-foreground text-sm" });
      }
    }

    const footer = root.createDiv({ cls: "bc flex items-center justify-end gap-4 sprout-modal-footer" });
    const closeBtn = footer.createEl("button", {
      cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "data-tooltip": "Close this dialog" },
    });
    const closeBtnIcon = closeBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(closeBtnIcon, "x");
    closeBtn.createSpan({ text: "Close" });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.containerEl.removeClass("sprout-modal-container");
    this.containerEl.removeClass("sprout-modal-dim");
    this.modalEl.removeClass("bc", "sprout-modals");
    this.contentEl.removeClass("bc");
    this.contentEl.empty();
  }

  // ── Resolve a quarantined ID to source note details ───────────────────────

  /**
   * Searches the store (quarantine, cards, etc.) for any record matching `id`
   * and returns its source note path, start line and error messages.
   * Falls back to the currently-active file if nothing else can be resolved.
   */
  private resolveCardRef(id: string): CardRef | null {
    const storeRef = this.plugin.store;

    const tryGet = (obj: unknown): unknown => {
      if (!obj || typeof obj !== "object") return null;
      const rec = obj as Record<string, unknown>;
      return rec[id] ?? rec[String(id)] ?? null;
    };

    const candidates = [
      tryGet(storeRef?.data?.quarantine),
      tryGet((storeRef?.data as Record<string, unknown>)?.quarantined),
      tryGet((storeRef?.data as Record<string, unknown>)?.parseErrors),
      tryGet(storeRef?.data?.cards),
      tryGet((storeRef?.data as Record<string, unknown>)?.cardById),
      typeof (storeRef as unknown as Record<string, unknown> | undefined)?.getCard === "function" ? (storeRef as unknown as { getCard(id: string): unknown }).getCard(id) : null,
      typeof (storeRef as unknown as Record<string, unknown> | undefined)?.getCardRecord === "function" ? (storeRef as unknown as { getCardRecord(id: string): unknown }).getCardRecord(id) : null,
    ].filter(Boolean);

    const rec = candidates.length ? candidates[0] : null;
    if (rec && typeof rec === "object") {
      const r = rec as Record<string, unknown>;
      const path =
        typeof r.sourceNotePath === "string"
          ? r.sourceNotePath
          : typeof r.notePath === "string"
            ? r.notePath
            : "";
      const startLine = Number(r.sourceStartLine ?? 0);
      const reasonText =
        typeof r.reason === "string"
          ? r.reason
          : Array.isArray(r.reason)
            ? (r.reason as unknown[])
                .map((x) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : ""))
                .filter(Boolean)
                .join(";")
            : "";
      const errsRaw =
        r.errors ??
        (reasonText
          ? reasonText
              .split(";")
              .map((s: string) => s.trim())
          : []);

      const errors = isStringArray(errsRaw)
        ? errsRaw
        : Array.isArray(errsRaw)
          ? errsRaw.map((x) => String(x))
          : [];

      if (path) {
        return {
          id: String(id),
          sourceNotePath: path,
          sourceStartLine: Number.isFinite(startLine) ? startLine : 0,
          errors,
        };
      }
    }

    // Last resort: use whatever note is currently open
    const active = this.app.workspace.getActiveFile();
    const activePath = String(active?.path || "");
    if (activePath) {
      return { id: String(id), sourceNotePath: activePath, sourceStartLine: 0, errors: [] };
    }

    return null;
  }

  // ── Navigate to the anchor in the note ────────────────────────────────────

  /** Open the source note and scroll to the ^sprout-<id> anchor line. */
  private async openAtAnchor(id: string) {
    const ref = this.resolveCardRef(id);
    if (!ref?.sourceNotePath) {
      new Notice(`${BRAND}: cannot resolve note path for ^sprout-${id}`);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(ref.sourceNotePath);
    if (!(file instanceof TFile)) {
      new Notice(`${BRAND}: note not found (${ref.sourceNotePath})`);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);

    await leaf.setViewState(
      {
        type: "markdown",
        state: { file: file.path, mode: "source" },
        active: true,
      },
      { focus: true },
    );

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.editor) {
      // Fallback: open via link syntax which Obsidian interprets as anchor nav
      await this.app.workspace.openLinkText(`${ref.sourceNotePath}#^sprout-${id}`, ref.sourceNotePath, true);
      return;
    }

    const ed = view.editor;

    const needle = `^sprout-${id}`;
    const text = await this.app.vault.read(file);
    const lines = text.split(/\r?\n/);
    let lineNo = lines.findIndex((l) => (l || "").includes(needle));
    if (lineNo < 0) lineNo = Math.max(0, Number(ref.sourceStartLine ?? 0));

    // If the line is just the bare anchor, skip past blanks to the next content
    if (lines[lineNo] && lines[lineNo].trim() === needle) {
      let t = lineNo + 1;
      while (t < lines.length && (lines[t] || "").trim() === "") t++;
      if (t < lines.length) lineNo = t;
    }

    ed.setCursor({ line: lineNo, ch: 0 });
    ed.scrollIntoView({ from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: 0 } }, true);
    ed.focus();
  }

  // ── Quick edit (opens CardEditModal) ──────────────────────────────────────

  /** Re-parse the card from the note and open a CardEditModal for inline editing. */
  private async openQuickEdit(id: string) {
    const ref = this.resolveCardRef(id);
    if (!ref?.sourceNotePath) {
      new Notice(`${BRAND}: cannot resolve note path for ^sprout-${id}`);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(ref.sourceNotePath);
    if (!(file instanceof TFile)) {
      new Notice(`${BRAND}: note not found (${ref.sourceNotePath})`);
      return;
    }

    const txt = await this.app.vault.read(file);
    const parsed = parseCardsFromText(ref.sourceNotePath, txt, true);

    const found: ParsedCard | undefined = (parsed.cards || []).find((c) => String(c.id || "") === String(id));

    // Normalise groups into a comma-separated string
    const foundGroupsRaw: unknown = found ? found.groups ?? (found as Record<string, unknown>).g ?? (found as Record<string, unknown>).group ?? "" : "";
    const foundGroups =
      Array.isArray(foundGroupsRaw)
        ? foundGroupsRaw.map((x) => String(x)).filter(Boolean).join(", ")
        : typeof foundGroupsRaw === "string" ? foundGroupsRaw : "";

    const cardLike: Record<string, unknown> = found
      ? {
          id: String(found.id || id),
          type: String(found.type || "basic"),
          title: found.title || "",
          groups: foundGroups || "",
          q: found.q || "",
          a: found.a || "",
          clozeText: found.clozeText || "",
          stem: found.stem || "",
          options: Array.isArray(found.options) ? found.options : [],
          correctIndex: Number.isFinite(found.correctIndex) ? Number(found.correctIndex) : -1,
          prompt: found.prompt ?? "",
          lines: Array.isArray((found as Record<string, unknown>).lines) ? (found as Record<string, unknown>).lines as unknown[] : [],
          ioSrc: found.ioSrc ?? (found as Record<string, unknown>).src ?? "",
          info: found.info || "",
          sourceNotePath: ref.sourceNotePath,
        }
      : {
          id: String(id),
          type: "basic",
          title: "",
          groups: "",
          q: "",
          a: "",
          info: "",
          sourceNotePath: ref.sourceNotePath,
        };

    new CardEditModal(this.app, cardLike as CardRecord, async (payload) => {
      await saveCardEdits(this.plugin, cardLike as CardRecord, payload);
    }).open();
  }
}
