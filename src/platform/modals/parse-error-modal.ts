/**
 * @file src/modals/parse-error-modal.ts
 * @summary Displays a list of cards that failed to parse during sync and lets the user jump to the anchor in the source note or quick-edit the card directly from the modal. Each quarantined card is shown with its anchor reference, source note path, parsing errors, and action buttons for navigation and inline editing.
 *
 * @exports
 *  - ParseErrorModal — Obsidian Modal subclass that renders the quarantined-cards list with "Open at anchor" and "Quick edit" actions
 */

import { Modal, Notice, TFile, MarkdownView, setIcon, type App } from "obsidian";
import { t } from "../translations/translator";
import type LearnKitPlugin from "../../main";
import type { CardRecord } from "../core/store";
import { parseCardsFromText, type ParsedCard } from "../../engine/parser/parser";
import { CardEditModal, saveCardEdits } from "../../views/reviewer/card-editor";
import {
  buildPrimaryCardAnchor,
  hasCardAnchorForId,
} from "../core/identity";

import {
  mkDangerCallout,
  isStringArray,
  setModalTitle,
  scopeModalToWorkspace,
  type CardRef,
} from "./modal-utils";

// ──────────────────────────────────────────────────────────────────────────────
// ParseErrorModal
// ──────────────────────────────────────────────────────────────────────────────

export class ParseErrorModal extends Modal {
  private plugin: LearnKitPlugin;
  private quarantinedIds: string[];

  constructor(app: App, plugin: LearnKitPlugin, quarantinedIds: string[]) {
    super(app);
    this.plugin = plugin;
    this.quarantinedIds = Array.isArray(quarantinedIds) ? quarantinedIds : [];
  }
  private _tx(token: string, fallback: string, vars?: Record<string, string | number>): string {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }
  // ── Modal lifecycle ───────────────────────────────────────────────────────

  onOpen() {
    setModalTitle(this, `Sync errors`);

    scopeModalToWorkspace(this);
    this.containerEl.addClass("lk-modal-container");
    this.containerEl.addClass("lk-modal-dim");
    this.containerEl.addClass("learnkit");
    this.modalEl.addClass("lk-modals");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();


    const root = contentEl.createDiv({ cls: "flex flex-col gap-4" });

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
    const list = root.createDiv({ cls: "flex flex-col gap-3" });

    for (const id of this.quarantinedIds) {
      const ref = this.resolveCardRef(id);

      const row = list.createDiv({ cls: "card p-3" });

      const top = row.createDiv({ cls: "flex items-center justify-between gap-3" });

      const left = top.createDiv({ cls: "flex flex-col gap-1" });
      left.createDiv({ text: `^learnkit-${id}`, cls: "font-medium" });
      left.createDiv({
        text: ref?.sourceNotePath ? ref.sourceNotePath : "(note path unresolved; will try active note)",
        cls: "text-muted-foreground text-xs",
      });

      // Action buttons: open in note and quick edit
      const actions = top.createDiv({ cls: "flex items-center gap-2" });

      const openBtn = actions.createEl("button", { cls: "btn-icon-ghost", attr: { "aria-label": "Open at anchor" } });
      openBtn.type = "button";
      setIcon(openBtn, "arrow-up-right");
      openBtn.onclick = () => void this.openAtAnchor(id);

      const editBtn = actions.createEl("button", { cls: "btn-icon-ghost", attr: { "aria-label": "Quick edit" } });
      editBtn.type = "button";
      setIcon(editBtn, "edit-3");
      editBtn.onclick = () => void this.openQuickEdit(id);

      // Show error list if available
      const errs = (ref?.errors || []).filter(Boolean);
      if (errs.length) {
        const ul = row.createEl("ul", { cls: "text-sm learnkit-parse-errors-list learnkit-parse-errors-list" });
        for (const e of errs) ul.createEl("li", { text: e });
      } else {
        row.createDiv({ text: "No error details available.", cls: "text-muted-foreground text-sm" });
      }
    }

    const footer = root.createDiv({ cls: "flex items-center justify-end gap-4 lk-modal-footer" });
    const closeBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "aria-label": "Close this dialog" },
    });
    const closeBtnIcon = closeBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(closeBtnIcon, "x");
    closeBtn.createSpan({ text: "Close" });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.containerEl.removeClass("lk-modal-container");
    this.containerEl.removeClass("lk-modal-dim");
    this.modalEl.removeClass("lk-modals");
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
      new Notice(this._tx("ui.parseError.cannotResolve", "Cannot resolve note path for {anchor}", { anchor: buildPrimaryCardAnchor(id) }));
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(ref.sourceNotePath);
    if (!(file instanceof TFile)) {
      new Notice(this._tx("ui.parseError.noteNotFound", "Note not found ({path})", { path: ref.sourceNotePath }));
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
      await this.app.workspace.openLinkText(`${ref.sourceNotePath}#${buildPrimaryCardAnchor(id)}`, ref.sourceNotePath, true);
      return;
    }

    const ed = view.editor;

    const text = await this.app.vault.read(file);
    const lines = text.split(/\r?\n/);
    let lineNo = lines.findIndex((l) => hasCardAnchorForId(l || "", id));
    if (lineNo < 0) lineNo = Math.max(0, Number(ref.sourceStartLine ?? 0));

    // If the line is just the bare anchor, skip past blanks to the next content
    if (lineNo >= 0 && hasCardAnchorForId(lines[lineNo] || "", id)) {
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
      new Notice(this._tx("ui.parseError.cannotResolve", "Cannot resolve note path for {anchor}", { anchor: buildPrimaryCardAnchor(id) }));
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(ref.sourceNotePath);
    if (!(file instanceof TFile)) {
      new Notice(this._tx("ui.parseError.noteNotFound", "Note not found ({path})", { path: ref.sourceNotePath }));
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
