/**
 * @file src/modals/anki-export-modal.ts
 * @summary Obsidian modal for exporting Sprout cards to an Anki .apkg file.
 * Single-page flow with scope selection (all / by deck / by group / current note),
 * options, and export button.
 *
 * @exports
 *  - AnkiExportModal — Obsidian Modal subclass
 */
import { Modal, Notice, setIcon } from "obsidian";
import { log } from "../core/logger";
import { exportToApkg } from "../../platform/integrations/anki/anki-export";
import { setModalTitle, createThemedDropdown, scopeModalToWorkspace } from "./modal-utils";
import { getGroupIndex } from "../../engine/indexing/group-index";
import { buildDeckTree } from "../../engine/deck/deck-tree";
import { t } from "../translations/translator";
import { txCommon } from "../translations/ui-common";
// ── Local helpers ─────────────────────────────────────────────────────────────
function clearNode(node) {
    while (node.firstChild)
        node.removeChild(node.firstChild);
}
function titleCaseSegment(seg) {
    if (!seg)
        return seg;
    return seg
        .split(/([\s_-]+)/)
        .map((part) => (/^[\s_-]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
        .join("");
}
function titleCaseGroupPath(path) {
    if (!path)
        return "";
    return path
        .split("/")
        .map((seg) => seg.trim())
        .filter(Boolean)
        .map((seg) => titleCaseSegment(seg))
        .join("/");
}
function formatGroupDisplay(path) {
    const canonical = titleCaseGroupPath(path);
    if (!canonical)
        return "";
    return canonical.split("/").join(" / ");
}
// ── Modal ─────────────────────────────────────────────────────────────────────
export class AnkiExportModal extends Modal {
    tx(token, fallback, vars) {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
    }
    constructor(plugin) {
        super(plugin.app);
        /** Cleanup functions for body-portal popovers. */
        this.disposers = [];
        this.plugin = plugin;
    }
    onOpen() {
        setModalTitle(this, "Export to Anki");
        scopeModalToWorkspace(this);
        this.containerEl.addClass("lk-modal-container");
        this.containerEl.addClass("lk-modal-dim");
        this.containerEl.addClass("learnkit");
        this.modalEl.addClass("lk-modals", "learnkit-anki-export-modal");
        // Escape key closes modal
        this.scope.register([], "Escape", () => { this.close(); return false; });
        const { contentEl } = this;
        contentEl.empty();
        this.renderExportForm(contentEl);
    }
    onClose() {
        for (const fn of this.disposers) {
            try {
                fn();
            }
            catch ( /* */_a) { /* */ }
        }
        this.disposers = [];
        this.containerEl.removeClass("lk-modal-container");
        this.containerEl.removeClass("lk-modal-dim");
        this.containerEl.removeClass("learnkit");
        this.modalEl.removeClass("lk-modals", "learnkit-anki-export-modal");
        this.contentEl.empty();
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    /** Label + control row. */
    mkField(parent, label, hint) {
        const wrapper = parent.createDiv({ cls: "flex flex-col gap-1" });
        const lbl = wrapper.createEl("label", { cls: "text-sm font-medium", text: label });
        if (hint)
            lbl.setAttribute("aria-label", hint);
        return wrapper;
    }
    /** Checkbox row with label and description. */
    mkToggleRow(parent, label, description, defaultChecked) {
        const row = parent.createDiv({ cls: "flex items-center justify-between gap-3 py-1" });
        const info = row.createDiv({ cls: "flex flex-col gap-0.5" });
        info.createDiv({ text: label, cls: "text-sm font-medium" });
        info.createDiv({ text: description, cls: "text-xs text-muted-foreground" });
        const toggle = row.createEl("input", { type: "checkbox", cls: "" });
        toggle.checked = defaultChecked;
        return toggle;
    }
    // ── Deck picker (single-select with search) ───────────────────────────────
    buildDeckPicker() {
        var _a, _b, _c;
        const allCards = this.plugin.store.getAllCards();
        const states = (_c = (_b = (_a = this.plugin.store).getAllStates) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : {};
        const tree = buildDeckTree(allCards, states, Date.now(), this.app.vault.getName());
        // Flatten to a list of { path, label }
        const deckPaths = [];
        const walk = (node, depth) => {
            if (node.key) {
                deckPaths.push({ path: node.key, label: "  ".repeat(Math.max(0, depth - 1)) + node.name + ` (${node.counts.total})` });
            }
            for (const child of Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
                walk(child, depth + 1);
            }
        };
        walk(tree, 0);
        let selectedDeck = "";
        const container = document.createElement("div");
        container.className = "relative learnkit-deck-picker";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input w-full";
        input.placeholder = "Search decks…";
        container.appendChild(input);
        // Popover
        const popover = document.createElement("div");
        popover.className = "learnkit-popover-dropdown";
        popover.setAttribute("aria-hidden", "true");
        container.appendChild(popover);
        const panel = document.createElement("div");
        panel.className = "rounded-md border border-border bg-popover text-popover-foreground p-0 flex flex-col learnkit-pointer-auto";
        popover.appendChild(panel);
        const list = document.createElement("div");
        list.className = "flex flex-col max-h-60 overflow-auto p-1";
        panel.appendChild(list);
        const renderList = () => {
            clearNode(list);
            const q = input.value.toLowerCase().trim();
            const filtered = deckPaths.filter((d) => d.path.toLowerCase().includes(q) || d.label.toLowerCase().includes(q));
            if (filtered.length === 0) {
                const empty = document.createElement("div");
                empty.className = "px-2 py-2 text-sm text-muted-foreground";
                empty.textContent = this.tx("ui.anki.export.noDecksFound", "No decks found");
                list.appendChild(empty);
                return;
            }
            for (const deck of filtered) {
                const row = document.createElement("div");
                row.setAttribute("role", "menuitem");
                row.setAttribute("aria-checked", deck.path === selectedDeck ? "true" : "false");
                row.tabIndex = 0;
                row.className =
                    "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";
                const txt = document.createElement("span");
                txt.textContent = deck.label;
                row.appendChild(txt);
                if (deck.path === selectedDeck) {
                    const check = document.createElement("span");
                    check.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
                    setIcon(check, "check");
                    row.appendChild(check);
                }
                else {
                    const spacer = document.createElement("span");
                    spacer.className = "inline-flex items-center justify-center [&_svg]:size-3 opacity-0";
                    setIcon(spacer, "check");
                    row.appendChild(spacer);
                }
                row.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    selectedDeck = deck.path;
                    input.value = deck.path;
                    closePopover();
                    input.dispatchEvent(new Event("change"));
                });
                row.addEventListener("keydown", (ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        ev.stopPropagation();
                        selectedDeck = deck.path;
                        input.value = deck.path;
                        closePopover();
                        input.dispatchEvent(new Event("change"));
                    }
                });
                list.appendChild(row);
            }
        };
        const openPopover = () => {
            renderList();
            popover.setAttribute("aria-hidden", "false");
            popover.classList.add("is-open");
        };
        const closePopover = () => {
            popover.setAttribute("aria-hidden", "true");
            popover.classList.remove("is-open");
        };
        input.addEventListener("focus", openPopover);
        input.addEventListener("input", renderList);
        const onDocPointerDown = (ev) => {
            if (!container.contains(ev.target))
                closePopover();
        };
        document.addEventListener("pointerdown", onDocPointerDown);
        this.disposers.push(() => document.removeEventListener("pointerdown", onDocPointerDown));
        return { element: container, getSelectedDeck: () => selectedDeck || input.value.trim() };
    }
    // ── Group picker (multi-select with badges, no creation) ──────────────────
    buildGroupPicker(onChanged) {
        const gx = getGroupIndex(this.plugin);
        const allOptions = gx.getAllGroups().sort((a, b) => formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)));
        let selected = [];
        const container = document.createElement("div");
        container.className = "relative learnkit-group-picker";
        const tagBox = document.createElement("div");
        tagBox.className = "textarea w-full learnkit-tag-box learnkit-export-tag-box";
        container.appendChild(tagBox);
        // Popover
        const popover = document.createElement("div");
        popover.className = "learnkit-popover-dropdown";
        popover.setAttribute("aria-hidden", "true");
        container.appendChild(popover);
        const panel = document.createElement("div");
        panel.className = "rounded-md border border-border bg-popover text-popover-foreground p-0 flex flex-col learnkit-pointer-auto";
        popover.appendChild(panel);
        const searchWrap = document.createElement("div");
        searchWrap.className = "flex items-center gap-1 border-b border-border pl-1 pr-0 w-full lk-browser-search-wrap min-h-[38px]";
        panel.appendChild(searchWrap);
        const searchIcon = document.createElement("span");
        searchIcon.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground learnkit-search-icon";
        searchIcon.setAttribute("aria-hidden", "true");
        setIcon(searchIcon, "search");
        searchWrap.appendChild(searchIcon);
        const search = document.createElement("input");
        search.type = "text";
        search.className = "bg-transparent text-sm flex-1 h-9 min-w-0 w-full learnkit-search-naked";
        search.placeholder = "Search groups";
        searchWrap.appendChild(search);
        const listEl = document.createElement("div");
        listEl.className = "flex flex-col max-h-60 overflow-auto p-1 learnkit-group-picker-results";
        panel.appendChild(listEl);
        const renderBadges = () => {
            clearNode(tagBox);
            if (!selected.length) {
                const placeholder = document.createElement("span");
                placeholder.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 learnkit-badge-placeholder";
                placeholder.textContent = this.tx("ui.anki.export.noGroupsSelected", "No groups selected");
                tagBox.appendChild(placeholder);
                return;
            }
            for (const tag of selected) {
                const badge = document.createElement("span");
                badge.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 learnkit-badge-inline lk-browser-tag-badge";
                const txt = document.createElement("span");
                txt.textContent = formatGroupDisplay(tag);
                badge.appendChild(txt);
                const removeBtn = document.createElement("span");
                removeBtn.className = "ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white";
                setIcon(removeBtn, "x");
                removeBtn.addEventListener("pointerdown", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
                removeBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    selected = selected.filter((t) => t !== tag);
                    renderBadges();
                    renderListItems();
                    onChanged === null || onChanged === void 0 ? void 0 : onChanged();
                });
                badge.appendChild(removeBtn);
                tagBox.appendChild(badge);
            }
        };
        const toggleTag = (tag) => {
            if (selected.includes(tag))
                selected = selected.filter((t) => t !== tag);
            else
                selected = [...selected, tag];
            renderBadges();
            renderListItems();
            onChanged === null || onChanged === void 0 ? void 0 : onChanged();
        };
        const renderListItems = () => {
            clearNode(listEl);
            const q = search.value.trim().toLowerCase();
            const options = allOptions.filter((t) => formatGroupDisplay(t).toLowerCase().includes(q));
            if (options.length === 0) {
                const empty = document.createElement("div");
                empty.className = "px-2 py-2 text-sm text-muted-foreground";
                empty.textContent = this.tx("ui.anki.export.noGroupsFound", "No groups found");
                listEl.appendChild(empty);
                return;
            }
            for (const opt of options) {
                const row = document.createElement("div");
                row.setAttribute("role", "menuitem");
                row.setAttribute("aria-checked", selected.includes(opt) ? "true" : "false");
                row.tabIndex = 0;
                row.className =
                    "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";
                const text = document.createElement("span");
                text.textContent = formatGroupDisplay(opt);
                row.appendChild(text);
                if (selected.includes(opt)) {
                    const check = document.createElement("span");
                    check.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
                    setIcon(check, "check");
                    row.appendChild(check);
                }
                else {
                    const spacer = document.createElement("span");
                    spacer.className = "inline-flex items-center justify-center [&_svg]:size-3 opacity-0";
                    setIcon(spacer, "check");
                    row.appendChild(spacer);
                }
                row.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); toggleTag(opt); });
                row.addEventListener("keydown", (ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        ev.stopPropagation();
                        toggleTag(opt);
                    }
                });
                listEl.appendChild(row);
            }
        };
        const openPopover = () => {
            renderListItems();
            popover.setAttribute("aria-hidden", "false");
            popover.classList.add("is-open");
        };
        const closePopover = () => {
            popover.setAttribute("aria-hidden", "true");
            popover.classList.remove("is-open");
        };
        search.addEventListener("input", renderListItems);
        const onDocPointerDown = (ev) => {
            if (!container.contains(ev.target))
                closePopover();
        };
        document.addEventListener("pointerdown", onDocPointerDown);
        this.disposers.push(() => document.removeEventListener("pointerdown", onDocPointerDown));
        container.addEventListener("click", (ev) => {
            ev.stopPropagation();
            openPopover();
        });
        renderBadges();
        return { element: container, getSelectedGroups: () => [...selected] };
    }
    // ── Form ──────────────────────────────────────────────────────────────────
    renderExportForm(root) {
        var _a, _b;
        const common = txCommon((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage);
        root.empty();
        root.removeClass("learnkit-export-result");
        const body = root.createDiv({ cls: "flex flex-col gap-4" });
        // ── Scope ─────────────────────────────────────────────────────────────────
        const scopeField = this.mkField(body, "Scope", "Which cards to include in the export");
        const scopeDropdown = createThemedDropdown([
            { value: "all", label: "All cards" },
            { value: "deck", label: "By deck" },
            { value: "group", label: "By group" },
            { value: "note", label: "Current note" },
        ], "all");
        scopeField.appendChild(scopeDropdown.element);
        // Deck picker (shown when scope = deck)
        const deckField = this.mkField(body, "Deck");
        deckField.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
        const deckPicker = this.buildDeckPicker();
        deckField.appendChild(deckPicker.element);
        // Group picker (shown when scope = group)
        const groupField = this.mkField(body, "Groups");
        groupField.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
        const groupPicker = this.buildGroupPicker(() => updateCount());
        groupField.appendChild(groupPicker.element);
        // Card count display
        const countRow = body.createDiv({ cls: "text-sm text-muted-foreground" });
        const updateCount = () => {
            const allCards = this.plugin.store.getAllCards();
            const scope = scopeDropdown.getValue();
            let count;
            if (scope === "deck") {
                const deckPath = deckPicker.getSelectedDeck();
                if (deckPath) {
                    count = allCards.filter((c) => {
                        var _a;
                        if (c.type === "io" || c.type === "io-child" || c.type === "cloze-child")
                            return false;
                        const sp = (_a = c.sourceNotePath) !== null && _a !== void 0 ? _a : "";
                        return sp.startsWith(deckPath + "/") || sp === deckPath || sp.replace(/\.md$/i, "") === deckPath;
                    }).length;
                }
                else {
                    count = allCards.filter((c) => c.type !== "io" && c.type !== "io-child" && c.type !== "cloze-child").length;
                }
            }
            else if (scope === "group") {
                const groups = groupPicker.getSelectedGroups();
                if (groups.length > 0) {
                    count = allCards.filter((c) => {
                        if (c.type === "io" || c.type === "io-child" || c.type === "cloze-child")
                            return false;
                        if (!Array.isArray(c.groups))
                            return false;
                        return groups.some((gk) => c.groups.some((g) => g.toLowerCase() === gk.toLowerCase() || g.toLowerCase().startsWith(gk.toLowerCase() + "/")));
                    }).length;
                }
                else {
                    count = 0;
                }
            }
            else if (scope === "note") {
                const activeFile = this.app.workspace.getActiveFile();
                const notePath = (activeFile === null || activeFile === void 0 ? void 0 : activeFile.path) || "";
                count = allCards.filter((c) => {
                    if (c.type === "io" || c.type === "io-child" || c.type === "cloze-child")
                        return false;
                    return c.sourceNotePath === notePath;
                }).length;
            }
            else {
                count = allCards.filter((c) => c.type !== "io" && c.type !== "io-child" && c.type !== "cloze-child").length;
            }
            countRow.textContent = this.tx("ui.anki.export.countWillBeExported", "{count} card(s) will be exported", { count });
        };
        scopeDropdown.onChange((val) => {
            deckField.classList.toggle("learnkit-is-hidden", val !== "deck");
            groupField.classList.toggle("learnkit-is-hidden", val !== "group");
            updateCount();
        });
        // Listen for deck picker changes
        const deckInput = deckPicker.element.querySelector("input");
        if (deckInput) {
            deckInput.addEventListener("change", () => updateCount());
            deckInput.addEventListener("input", () => updateCount());
        }
        updateCount();
        // ── MCQ Strategy ──────────────────────────────────────────────────────────
        const mcqField = this.mkField(body, "Multiple-choice handling", "Anki has no native multiple-choice type");
        const mcqDropdown = createThemedDropdown([
            { value: "convert-to-basic", label: "Convert to Basic" },
            { value: "skip", label: "Skip multiple-choice cards" },
        ], "convert-to-basic");
        mcqField.appendChild(mcqDropdown.element);
        // ── Default deck name ─────────────────────────────────────────────────────
        const defaultDeckField = this.mkField(body, "Default deck name", "Anki deck name for cards without a Sprout group");
        const deckNameInput = defaultDeckField.createEl("input", { type: "text", cls: "input w-full", value: "LearnKit Export" });
        // ── Toggles grid ──────────────────────────────────────────────────────────
        const togglesSection = body.createDiv({ cls: "flex flex-col gap-1 rounded-lg p-3" });
        const schedToggle = this.mkToggleRow(togglesSection, "Include scheduling data", "Export FSRS state so cards arrive in Anki with progress intact", true);
        const revlogToggle = this.mkToggleRow(togglesSection, "Include review history", "Export review log entries for Anki statistics", true);
        const mediaToggle = this.mkToggleRow(togglesSection, "Include media files", "Bundle referenced images into the .apkg", true);
        // ── FSRS info callout ──────────────────────────────────────────────────────
        const fsrsNote = body.createDiv({
            cls: "rounded-lg p-3 text-sm learnkit-danger-callout learnkit-danger-callout",
            attr: { style: "background: var(--background-modifier-message) !important;" },
        });
        fsrsNote.createDiv({
            text: "💡 Enable FSRS in Anki after import",
            cls: "font-medium mb-1",
        });
        fsrsNote.createDiv({
            text: "Your FSRS parameters and desired retention are included in the export, " +
                "but Anki requires you to enable FSRS once globally. After importing, go to " +
                "Deck Options → FSRS and toggle it on. Your scheduling data will be preserved.",
            cls: "text-muted-foreground",
        });
        // ── Footer ────────────────────────────────────────────────────────────────
        const footer = root.createDiv({ cls: "flex items-center justify-end gap-4 lk-modal-footer" });
        const cancelBtn = footer.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
            attr: { type: "button", "aria-label": "Cancel export" },
        });
        const cancelIcon = cancelBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
        setIcon(cancelIcon, "x");
        cancelBtn.createSpan({ text: common.cancel });
        cancelBtn.onclick = () => this.close();
        const exportBtn = footer.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
            attr: { type: "button", "aria-label": "Export cards to .apkg file" },
        });
        const exportIcon = exportBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
        setIcon(exportIcon, "download");
        exportBtn.createSpan({ text: this.tx("ui.anki.export.action.export", "Export") });
        exportBtn.onclick = async () => {
            var _a;
            exportBtn.disabled = true;
            const exportSpan = exportBtn.querySelector("span:last-child");
            if (exportSpan)
                exportSpan.textContent = this.tx("ui.anki.export.action.exporting", "Exporting") + "\u2026";
            const scope = scopeDropdown.getValue();
            const opts = {
                scope,
                groupKeys: scope === "group" ? groupPicker.getSelectedGroups() : undefined,
                deckPath: scope === "deck" ? deckPicker.getSelectedDeck() : undefined,
                noteKey: scope === "note" ? (((_a = this.app.workspace.getActiveFile()) === null || _a === void 0 ? void 0 : _a.path) || undefined) : undefined,
                includeScheduling: schedToggle.checked,
                includeRevlog: revlogToggle.checked,
                mcqStrategy: mcqDropdown.getValue(),
                defaultDeckName: deckNameInput.value.trim() || "LearnKit Export",
                includeMedia: mediaToggle.checked,
            };
            try {
                const result = await exportToApkg(this.plugin, opts);
                this.renderResult(root, result.apkgBytes, result.stats);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new Notice(this.tx("ui.anki.export.error.failed", "Export failed — {message}", { message: msg }));
                log.error("Anki export failed", err);
                exportBtn.disabled = false;
                if (exportSpan)
                    exportSpan.textContent = this.tx("ui.anki.export.action.export", "Export");
            }
        };
    }
    // ── Result screen ──────────────────────────────────────────────────────────
    renderResult(root, apkgBytes, stats) {
        root.empty();
        root.addClass("learnkit-export-result");
        // Update Obsidian modal header for result
        setModalTitle(this, "Export complete");
        const apkgBuffer = apkgBytes.buffer.slice(apkgBytes.byteOffset, apkgBytes.byteOffset + apkgBytes.byteLength);
        // ── Stats ───────────────────────────────────────────────────────────────
        const body = root.createDiv({ cls: "flex flex-col gap-1" });
        const addRow = (label, value) => {
            const row = body.createDiv({ cls: "flex justify-between text-sm py-1" });
            row.createSpan({ text: label });
            row.createEl("strong", { text: String(value) });
        };
        addRow("Notes exported", stats.notesExported);
        addRow("Cards exported", stats.cardsExported);
        if (stats.mcqConverted > 0)
            addRow("Multiple-choice → basic", stats.mcqConverted);
        if (stats.mcqSkipped > 0)
            addRow("Multiple-choice skipped", stats.mcqSkipped);
        if (stats.ioSkipped > 0)
            addRow("IO skipped", stats.ioSkipped);
        if (stats.revlogEntries > 0)
            addRow("Review log entries", stats.revlogEntries);
        if (stats.mediaFiles > 0)
            addRow("Media files", stats.mediaFiles);
        // ── Footer ──────────────────────────────────────────────────────────────
        const footer = root.createDiv({ cls: "flex items-center justify-end gap-4 lk-modal-footer" });
        const downloadBtn = footer.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
            attr: { type: "button", "aria-label": "Download .apkg file to your computer" },
        });
        const dlIcon = downloadBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
        setIcon(dlIcon, "download");
        downloadBtn.createSpan({ text: this.tx("ui.anki.export.action.download", "Download") });
        downloadBtn.onclick = () => {
            const blob = new Blob([apkgBuffer], { type: "application/octet-stream" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const timestamp = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `LearnKit-Export-${timestamp}.apkg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            new Notice(this.tx("ui.anki.export.notice.downloadStarted", "Download started"));
        };
        const saveBtn = footer.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
            attr: { type: "button", "aria-label": "Save .apkg file into your vault" },
        });
        const saveIcon = saveBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
        setIcon(saveIcon, "save");
        saveBtn.createSpan({ text: this.tx("ui.anki.export.action.saveToVault", "Save to vault") });
        saveBtn.onclick = async () => {
            var _a;
            const timestamp = new Date().toISOString().slice(0, 10);
            const fileName = `LearnKit-Export-${timestamp}.apkg`;
            try {
                const createBinary = (_a = this.app.vault.createBinary) === null || _a === void 0 ? void 0 : _a.bind(this.app.vault);
                if (!createBinary) {
                    new Notice(this.tx("ui.anki.export.error.binaryUnavailable", "Export failed — binary vault write is unavailable."));
                    return;
                }
                await createBinary(fileName, apkgBuffer);
                new Notice(this.tx("ui.anki.export.notice.savedToVaultRoot", "Saved {fileName} to vault root", { fileName }));
                this.close();
            }
            catch (err) {
                new Notice(this.tx("ui.anki.export.error.failedToSave", "Failed to save — {message}", {
                    message: err instanceof Error ? err.message : String(err),
                }));
            }
        };
        const doneBtn = footer.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
            attr: { type: "button", "aria-label": "Close this dialog" },
        });
        const doneIcon = doneBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
        setIcon(doneIcon, "check");
        doneBtn.createSpan({ text: this.tx("ui.anki.export.action.done", "Done") });
        doneBtn.onclick = () => this.close();
    }
}
