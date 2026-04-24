/**
 * @file src/modals/parse-error-modal.ts
 * @summary Displays a list of cards that failed to parse during sync and lets the user jump to the anchor in the source note or quick-edit the card directly from the modal. Each quarantined card is shown with its anchor reference, source note path, parsing errors, and action buttons for navigation and inline editing.
 *
 * @exports
 *  - ParseErrorModal — Obsidian Modal subclass that renders the quarantined-cards list with "Open at anchor" and "Quick edit" actions
 */
import { Modal, Notice, TFile, MarkdownView, setIcon } from "obsidian";
import { t } from "../translations/translator";
import { parseCardsFromText } from "../../engine/parser/parser";
import { CardEditModal, saveCardEdits } from "../../views/reviewer/card-editor";
import { buildPrimaryCardAnchor, hasCardAnchorForId, } from "../core/identity";
import { mkDangerCallout, isStringArray, setModalTitle, scopeModalToWorkspace, } from "./modal-utils";
// ──────────────────────────────────────────────────────────────────────────────
// ParseErrorModal
// ──────────────────────────────────────────────────────────────────────────────
export class ParseErrorModal extends Modal {
    constructor(app, plugin, quarantinedIds) {
        super(app);
        this.plugin = plugin;
        this.quarantinedIds = Array.isArray(quarantinedIds) ? quarantinedIds : [];
    }
    _tx(token, fallback, vars) {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
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
        mkDangerCallout(root, [
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
        ].join("\n"));
        // Render each quarantined card
        const list = root.createDiv({ cls: "flex flex-col gap-3" });
        for (const id of this.quarantinedIds) {
            const ref = this.resolveCardRef(id);
            const row = list.createDiv({ cls: "card p-3" });
            const top = row.createDiv({ cls: "flex items-center justify-between gap-3" });
            const left = top.createDiv({ cls: "flex flex-col gap-1" });
            left.createDiv({ text: `^learnkit-${id}`, cls: "font-medium" });
            left.createDiv({
                text: (ref === null || ref === void 0 ? void 0 : ref.sourceNotePath) ? ref.sourceNotePath : "(note path unresolved; will try active note)",
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
            const errs = ((ref === null || ref === void 0 ? void 0 : ref.errors) || []).filter(Boolean);
            if (errs.length) {
                const ul = row.createEl("ul", { cls: "text-sm learnkit-parse-errors-list learnkit-parse-errors-list" });
                for (const e of errs)
                    ul.createEl("li", { text: e });
            }
            else {
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
    resolveCardRef(id) {
        var _a, _b, _c, _d, _e, _f, _g;
        const storeRef = this.plugin.store;
        const tryGet = (obj) => {
            var _a, _b;
            if (!obj || typeof obj !== "object")
                return null;
            const rec = obj;
            return (_b = (_a = rec[id]) !== null && _a !== void 0 ? _a : rec[String(id)]) !== null && _b !== void 0 ? _b : null;
        };
        const candidates = [
            tryGet((_a = storeRef === null || storeRef === void 0 ? void 0 : storeRef.data) === null || _a === void 0 ? void 0 : _a.quarantine),
            tryGet((_b = storeRef === null || storeRef === void 0 ? void 0 : storeRef.data) === null || _b === void 0 ? void 0 : _b.quarantined),
            tryGet((_c = storeRef === null || storeRef === void 0 ? void 0 : storeRef.data) === null || _c === void 0 ? void 0 : _c.parseErrors),
            tryGet((_d = storeRef === null || storeRef === void 0 ? void 0 : storeRef.data) === null || _d === void 0 ? void 0 : _d.cards),
            tryGet((_e = storeRef === null || storeRef === void 0 ? void 0 : storeRef.data) === null || _e === void 0 ? void 0 : _e.cardById),
            typeof (storeRef === null || storeRef === void 0 ? void 0 : storeRef.getCard) === "function" ? storeRef.getCard(id) : null,
            typeof (storeRef === null || storeRef === void 0 ? void 0 : storeRef.getCardRecord) === "function" ? storeRef.getCardRecord(id) : null,
        ].filter(Boolean);
        const rec = candidates.length ? candidates[0] : null;
        if (rec && typeof rec === "object") {
            const r = rec;
            const path = typeof r.sourceNotePath === "string"
                ? r.sourceNotePath
                : typeof r.notePath === "string"
                    ? r.notePath
                    : "";
            const startLine = Number((_f = r.sourceStartLine) !== null && _f !== void 0 ? _f : 0);
            const reasonText = typeof r.reason === "string"
                ? r.reason
                : Array.isArray(r.reason)
                    ? r.reason
                        .map((x) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : ""))
                        .filter(Boolean)
                        .join(";")
                    : "";
            const errsRaw = (_g = r.errors) !== null && _g !== void 0 ? _g : (reasonText
                ? reasonText
                    .split(";")
                    .map((s) => s.trim())
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
        const activePath = String((active === null || active === void 0 ? void 0 : active.path) || "");
        if (activePath) {
            return { id: String(id), sourceNotePath: activePath, sourceStartLine: 0, errors: [] };
        }
        return null;
    }
    // ── Navigate to the anchor in the note ────────────────────────────────────
    /** Open the source note and scroll to the ^sprout-<id> anchor line. */
    async openAtAnchor(id) {
        var _a;
        const ref = this.resolveCardRef(id);
        if (!(ref === null || ref === void 0 ? void 0 : ref.sourceNotePath)) {
            new Notice(this._tx("ui.parseError.cannotResolve", "Cannot resolve note path for {anchor}", { anchor: buildPrimaryCardAnchor(id) }));
            return;
        }
        const file = this.app.vault.getAbstractFileByPath(ref.sourceNotePath);
        if (!(file instanceof TFile)) {
            new Notice(this._tx("ui.parseError.noteNotFound", "Note not found ({path})", { path: ref.sourceNotePath }));
            return;
        }
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({
            type: "markdown",
            state: { file: file.path, mode: "source" },
            active: true,
        }, { focus: true });
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
        if (lineNo < 0)
            lineNo = Math.max(0, Number((_a = ref.sourceStartLine) !== null && _a !== void 0 ? _a : 0));
        // If the line is just the bare anchor, skip past blanks to the next content
        if (lineNo >= 0 && hasCardAnchorForId(lines[lineNo] || "", id)) {
            let t = lineNo + 1;
            while (t < lines.length && (lines[t] || "").trim() === "")
                t++;
            if (t < lines.length)
                lineNo = t;
        }
        ed.setCursor({ line: lineNo, ch: 0 });
        ed.scrollIntoView({ from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: 0 } }, true);
        ed.focus();
    }
    // ── Quick edit (opens CardEditModal) ──────────────────────────────────────
    /** Re-parse the card from the note and open a CardEditModal for inline editing. */
    async openQuickEdit(id) {
        var _a, _b, _c, _d, _e, _f;
        const ref = this.resolveCardRef(id);
        if (!(ref === null || ref === void 0 ? void 0 : ref.sourceNotePath)) {
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
        const found = (parsed.cards || []).find((c) => String(c.id || "") === String(id));
        // Normalise groups into a comma-separated string
        const foundGroupsRaw = found ? (_c = (_b = (_a = found.groups) !== null && _a !== void 0 ? _a : found.g) !== null && _b !== void 0 ? _b : found.group) !== null && _c !== void 0 ? _c : "" : "";
        const foundGroups = Array.isArray(foundGroupsRaw)
            ? foundGroupsRaw.map((x) => String(x)).filter(Boolean).join(", ")
            : typeof foundGroupsRaw === "string" ? foundGroupsRaw : "";
        const cardLike = found
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
                prompt: (_d = found.prompt) !== null && _d !== void 0 ? _d : "",
                lines: Array.isArray(found.lines) ? found.lines : [],
                ioSrc: (_f = (_e = found.ioSrc) !== null && _e !== void 0 ? _e : found.src) !== null && _f !== void 0 ? _f : "",
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
        new CardEditModal(this.app, cardLike, async (payload) => {
            await saveCardEdits(this.plugin, cardLike, payload);
        }).open();
    }
}
