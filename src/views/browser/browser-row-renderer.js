/**
 * @file src/browser/browser-row-renderer.ts
 * @summary Builds the <tbody> for the Flashcard Browser table, constructing one
 * <tr> per card with read-only cells (type, stage, due, ID badge), editable
 * textarea cells (title, question, answer, info), a groups tag-editor popover,
 * checkbox/shift-select logic per row, and an empty-state overlay. Extracted
 * from SproutCardBrowserView to keep the view class focused on orchestration.
 *
 * @exports
 *   - RowRendererContext — interface describing the callbacks and state the row renderer needs from its host view
 *   - buildPageTableBody — builds a <tbody> element containing one <tr> per row for the current page
 *   - renderEmptyState — shows a centred "No cards match" overlay inside the table scroll container
 *   - clearEmptyState — removes any existing empty-state overlay from the root element
 */
import { Notice, setIcon } from "obsidian";
import { normalizeCardOptions, getCorrectIndices } from "../../platform/core/store";
import { log } from "../../platform/core/logger";
import { placePopover, queryFirst, renderLatexMathInElement, renderMarkdownPreviewInElement, replaceChildrenWithHTML, setCssProps } from "../../platform/core/ui";
import { coerceGroups } from "../../engine/indexing/group-format";
import { buildAnswerOrOptionsFor, buildQuestionFor } from "../reviewer/fields";
import { stageLabel } from "../reviewer/labels";
import { t } from "../../platform/translations/translator";
import { handleTabInTextarea } from "../../platform/card-editor/card-editor";
import { buildPrimaryCardAnchor } from "../../platform/core/identity";
import { CLOZE_ANSWER_HELP, clearNode, forceWrapStyles, forceCellClip, fmtDue, fmtLocation, typeLabelBrowser, titleCaseGroupPath, formatGroupDisplay, expandGroupAncestors, parseGroupsInput, sortGroupPathsForDisplay, groupsToInput, buildIoImgHtml, buildIoOccludedHtml, getIoResolvedImage, extractImageRefs, renderMarkdownWithImages, } from "./browser-helpers";
// ── Helpers (module-private) ──────────────────────────────
const setColAttr = (td, col) => {
    td.setAttribute("data-col", col);
    return td;
};
const txFromCtx = (ctx, token, fallback, vars) => { var _a, _b; return t((_b = (_a = ctx.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars); };
// ── Main entry point ──────────────────────────────────────
/**
 * Build a `<tbody>` containing one `<tr>` per row in `pageRows`.
 * Returns the element ready to be `.replaceWith()` into the table.
 */
export function buildPageTableBody(pageRows, ctx) {
    const tbody = document.createElement("tbody");
    tbody.className = "";
    const quarantine = (ctx.plugin.store.data.quarantine || {});
    const pageRowCount = pageRows.length;
    // Pre-compute the shared group option set once for all rows on this page.
    const sharedOptionSet = new Set();
    for (const g of (ctx.plugin.store.getAllCards() || [])
        .flatMap((c) => (Array.isArray(c === null || c === void 0 ? void 0 : c.groups) ? c.groups : []))
        .map((g) => titleCaseGroupPath(String(g).trim()))
        .filter(Boolean)) {
        for (const tag of expandGroupAncestors(g))
            sharedOptionSet.add(tag);
    }
    for (const [rowIndex, { card, state, dueMs }] of pageRows.entries()) {
        const isQuarantined = !!quarantine[String(card.id)];
        const tr = document.createElement("tr");
        tr.className = "lk-browser-row";
        setCssProps(tr, "--learnkit-row-height", `${ctx.rowHeightPx}px`);
        // ── Checkbox cell ──
        const selTd = document.createElement("td");
        selTd.className = `align-middle flex items-center justify-center text-center ${ctx.cellWrapClass} lk-browser-cell`;
        forceCellClip(selTd);
        forceWrapStyles(selTd);
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.setAttribute("data-card-id", String(card.id));
        checkbox.className = "cursor-pointer accent-[var(--text-normal)]";
        checkbox.checked = ctx.selectedIds.has(String(card.id));
        checkbox.addEventListener("change", (ev) => {
            ev.stopPropagation();
            const checked = checkbox.checked;
            const shift = ev.shiftKey;
            if (shift && ctx.getLastShiftSelectionIndex() !== null) {
                const start = Math.min(ctx.getLastShiftSelectionIndex(), rowIndex);
                const end = Math.max(ctx.getLastShiftSelectionIndex(), rowIndex);
                let changed = false;
                for (let idx = start; idx <= end; idx += 1) {
                    const id = String(pageRows[idx].card.id);
                    if (checked) {
                        if (!ctx.selectedIds.has(id)) {
                            ctx.selectedIds.add(id);
                            changed = true;
                        }
                    }
                    else {
                        if (ctx.selectedIds.has(id)) {
                            ctx.selectedIds.delete(id);
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    ctx.syncRowCheckboxes();
                    ctx.updateSelectionIndicator();
                    ctx.updateSelectAllCheckboxState();
                }
            }
            else if (ctx.setSelection(String(card.id), checked)) {
                ctx.updateSelectionIndicator();
                ctx.updateSelectAllCheckboxState();
            }
            ctx.setLastShiftSelectionIndex(rowIndex);
        });
        selTd.appendChild(checkbox);
        tr.appendChild(selTd);
        // ── Muted text cell helper ──
        const tdMuted = (txt, col, title) => {
            const td = document.createElement("td");
            td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground lk-browser-cell`;
            td.textContent = txt;
            if (title)
                td.setAttribute("aria-label", title);
            forceWrapStyles(td);
            forceCellClip(td);
            setColAttr(td, col);
            return td;
        };
        // ── ID cell ──
        const idTd = document.createElement("td");
        idTd.className = `align-top ${ctx.cellWrapClass} lk-browser-cell`;
        forceCellClip(idTd);
        forceWrapStyles(idTd);
        setColAttr(idTd, "id");
        const isSuspended = String((state === null || state === void 0 ? void 0 : state.stage) || "") === "suspended";
        const sourceLink = `${card.sourceNotePath}#${buildPrimaryCardAnchor(String(card.id))}`;
        const idLink = document.createElement("a");
        idLink.href = sourceLink;
        idLink.className = "text-[var(--learnkit-font-2xs)] leading-none no-underline inline-flex items-center gap-1 text-normal relative z-0 hover:underline";
        if (isSuspended) {
            idLink.classList.add("text-red-500");
        }
        if (isQuarantined) {
            idLink.classList.add("text-red-500");
        }
        const idValue = document.createElement("span");
        idValue.textContent = String(card.id);
        idLink.appendChild(idValue);
        const linkIcon = document.createElement("span");
        linkIcon.setAttribute("aria-hidden", "true");
        linkIcon.className = "inline-flex items-center justify-center";
        let iconName = "link";
        if (isSuspended)
            iconName = "circle-pause";
        else if (isQuarantined)
            iconName = "alert-triangle";
        setIcon(linkIcon, iconName);
        try {
            const scale = isSuspended || isQuarantined ? 0.7 : 0.75;
            linkIcon.classList.add("inline-flex", "relative", "z-0", "origin-center", "[transform:scale(var(--learnkit-scale,1))]");
            setCssProps(linkIcon, "--learnkit-scale", String(scale));
        }
        catch (e) {
            log.swallow("scale link icon", e);
        }
        idLink.appendChild(linkIcon);
        idLink.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void ctx.openSource(card);
        });
        idTd.appendChild(idLink);
        tr.appendChild(idTd);
        // ── Type cell ──
        tr.appendChild(tdMuted(isQuarantined ? txFromCtx(ctx, "ui.browser.row.quarantined", "Quarantined") : typeLabelBrowser(card.type), "type"));
        // ── Stage cell ──
        const stage = isQuarantined ? "quarantined" : String((state === null || state === void 0 ? void 0 : state.stage) || "new");
        if (stage === "suspended") {
            const td = document.createElement("td");
            td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground lk-browser-cell`;
            forceWrapStyles(td);
            forceCellClip(td);
            setColAttr(td, "stage");
            const label = document.createElement("div");
            label.textContent = stageLabel(stage);
            td.appendChild(label);
            tr.appendChild(td);
        }
        else if (stage === "quarantined") {
            tr.appendChild(tdMuted(txFromCtx(ctx, "ui.browser.row.quarantined", "Quarantined"), "stage"));
        }
        else {
            tr.appendChild(tdMuted(stageLabel(stage), "stage"));
        }
        // ── Due cell ──
        if (stage === "suspended") {
            tr.appendChild(makeReadOnlyFieldCell(txFromCtx(ctx, "ui.browser.row.due.suspended", "Card currently suspended (no due data)."), "due", ctx));
        }
        else if (stage === "quarantined") {
            tr.appendChild(makeReadOnlyFieldCell(txFromCtx(ctx, "ui.browser.row.due.quarantined", "Card currently quarantined (no due data)."), "due", ctx));
        }
        else {
            tr.appendChild(tdMuted(fmtDue(dueMs), "due"));
        }
        // ── Editable cells ──
        tr.appendChild(makeEditorCell("title", card, isQuarantined, ctx));
        tr.appendChild(makeEditorCell("question", card, isQuarantined, ctx));
        tr.appendChild(makeEditorCell("answer", card, isQuarantined, ctx));
        tr.appendChild(makeEditorCell("info", card, isQuarantined, ctx));
        // ── Location cell ──
        tr.appendChild(tdMuted(fmtLocation(card.sourceNotePath), "location", card.sourceNotePath));
        // ── Groups editor cell ──
        tr.appendChild(makeGroupsEditorCell(card, isQuarantined, rowIndex, pageRowCount, pageRows, ctx, sharedOptionSet));
        // ── Row click → checkbox toggle ──
        tr.addEventListener("pointerdown", (ev) => {
            const target = ev.target;
            if (!target)
                return;
            if (target instanceof HTMLInputElement)
                return;
            if (target instanceof HTMLButtonElement)
                return;
            if (target instanceof HTMLTextAreaElement)
                return;
            if (target instanceof HTMLSelectElement)
                return;
            const interactive = target instanceof Element ? target.closest('input, button, textarea, select, [role="button"], [data-interactive]') : null;
            if (interactive)
                return;
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0)
                return;
            if (ev.button !== 0)
                return;
            const wasChecked = checkbox.checked;
            const shift = ev.shiftKey;
            if (shift && ctx.getLastShiftSelectionIndex() !== null) {
                const start = Math.min(ctx.getLastShiftSelectionIndex(), rowIndex);
                const end = Math.max(ctx.getLastShiftSelectionIndex(), rowIndex);
                let changed = false;
                for (let idx = start; idx <= end; idx += 1) {
                    const id = String(pageRows[idx].card.id);
                    if (!wasChecked) {
                        if (!ctx.selectedIds.has(id)) {
                            ctx.selectedIds.add(id);
                            changed = true;
                        }
                    }
                    else {
                        if (ctx.selectedIds.has(id)) {
                            ctx.selectedIds.delete(id);
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    ctx.syncRowCheckboxes();
                    ctx.updateSelectionIndicator();
                    ctx.updateSelectAllCheckboxState();
                }
            }
            else {
                checkbox.checked = !wasChecked;
                if (ctx.setSelection(String(card.id), !wasChecked)) {
                    ctx.updateSelectionIndicator();
                    ctx.updateSelectAllCheckboxState();
                }
            }
            ctx.setLastShiftSelectionIndex(rowIndex);
        });
        tbody.appendChild(tr);
    }
    return tbody;
}
// ── Empty state ───────────────────────────────────────────
/**
 * Show a centred "No cards match your filters" overlay inside the
 * table scroll container. Returns a cleanup function.
 */
export function renderEmptyState(rootEl, total) {
    // Remove any previous error message
    const prevError = rootEl ? queryFirst(rootEl, ".lk-browser-empty-message") : null;
    if (prevError)
        prevError.remove();
    const wrap = rootEl
        ? queryFirst(rootEl, ".bc.rounded-lg.border.border-border.overflow-auto")
        : null;
    if (!wrap)
        return { cleanup: null };
    const msg = document.createElement("div");
    msg.className =
        "lk-browser-empty-message flex items-center justify-center text-center text-muted-foreground text-base py-8 px-4 w-full";
    msg.textContent = total === 0 ? "No cards match your filters." : "No rows on this page.";
    wrap.appendChild(msg);
    const headerHeight = 44;
    const place = () => {
        const msgRect = msg.getBoundingClientRect();
        const availableHeight = Math.max(0, wrap.clientHeight - headerHeight);
        const top = wrap.scrollTop + headerHeight + Math.max(0, (availableHeight - msgRect.height) / 2);
        setCssProps(msg, "--learnkit-empty-left", `${wrap.scrollLeft}px`);
        setCssProps(msg, "--learnkit-empty-top", `${Math.round(top)}px`);
        setCssProps(msg, "--learnkit-empty-width", `${wrap.clientWidth}px`);
    };
    const onScroll = () => place();
    wrap.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, true);
    requestAnimationFrame(place);
    const cleanup = () => {
        wrap.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll, true);
    };
    return { cleanup };
}
/**
 * Remove any existing empty-state overlay from the root.
 */
export function clearEmptyState(rootEl) {
    const prev = rootEl ? queryFirst(rootEl, ".lk-browser-empty-message") : null;
    if (prev)
        prev.remove();
}
// ── Private cell builders ─────────────────────────────────
function makeReadOnlyFieldCell(value, col, ctx, title) {
    if (col === "due") {
        const td = document.createElement("td");
        td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground lk-browser-cell`;
        td.textContent = value;
        if (title)
            td.setAttribute("aria-label", title);
        forceWrapStyles(td);
        forceCellClip(td);
        setColAttr(td, col);
        return td;
    }
    const td = document.createElement("td");
    td.className = `align-top ${ctx.cellWrapClass} lk-browser-cell`;
    forceCellClip(td);
    forceWrapStyles(td);
    setColAttr(td, col);
    const ta = document.createElement("textarea");
    ta.className = `textarea w-full ${ctx.readonlyTextClass} lk-browser-textarea lk-browser-textarea--readonly`;
    ta.value = value;
    ta.readOnly = true;
    if (title)
        ta.setAttribute("aria-label", title);
    const h = `${ctx.editorHeightPx}px`;
    setCssProps(ta, "--learnkit-editor-height", h);
    td.appendChild(ta);
    return td;
}
function makeImageEditorCell(col, card, ctx, initial) {
    const td = document.createElement("td");
    td.className = `align-top ${ctx.cellWrapClass} lk-browser-cell lk-browser-cell-with-images`;
    forceCellClip(td);
    setColAttr(td, col);
    const h = `${ctx.editorHeightPx}px`;
    const sourcePath = String(card.sourceNotePath || "");
    /* ── wrapper that stacks textarea behind overlay ── */
    const wrap = document.createElement("div");
    wrap.className = "lk-browser-img-editor-wrap";
    setCssProps(wrap, "--learnkit-editor-height", h);
    /* ── real textarea (holds raw markdown, shown when focused) ── */
    const ta = document.createElement("textarea");
    ta.className = `textarea w-full ${ctx.cellTextClass} lk-browser-textarea lk-browser-textarea--editable lk-browser-img-textarea`;
    ta.value = initial;
    setCssProps(ta, "--learnkit-editor-height", h);
    /* ── overlay (rendered HTML with images, shown when NOT focused) ── */
    const overlay = document.createElement("div");
    overlay.className = `lk-browser-img-overlay`;
    const renderOverlay = (md) => {
        replaceChildrenWithHTML(overlay, renderMarkdownWithImages(ctx.app, md, sourcePath).replace(/\n/g, "<br>"));
        renderLatexMathInElement(overlay);
    };
    renderOverlay(initial);
    /* Click on the overlay focuses the textarea */
    overlay.addEventListener("click", () => { ta.focus(); });
    const key = `${card.id}:${col}`;
    let baseline = initial;
    ta.addEventListener("focus", () => {
        baseline = ta.value;
        wrap.classList.add("lk-browser-img-editor--focused");
    });
    ta.addEventListener("keydown", (ev) => {
        if (handleTabInTextarea(ta, ev))
            return;
        if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            ta.value = baseline;
            renderOverlay(baseline);
            ta.blur();
        }
    });
    ta.addEventListener("blur", () => {
        wrap.classList.remove("lk-browser-img-editor--focused");
        void (async () => {
            const nextVal = ta.value;
            if (nextVal === baseline) {
                renderOverlay(baseline);
                return;
            }
            if (ctx.saving.has(key))
                return;
            ctx.saving.add(key);
            try {
                const updated = ctx.applyValueToCard(card, col, nextVal);
                await ctx.writeCardToMarkdown(updated);
                baseline = nextVal;
                renderOverlay(nextVal);
            }
            catch (err) {
                new Notice(`${err instanceof Error ? err.message : String(err)}`);
                ta.value = baseline;
                renderOverlay(baseline);
            }
            finally {
                ctx.saving.delete(key);
            }
        })();
    });
    wrap.appendChild(ta);
    wrap.appendChild(overlay);
    td.appendChild(wrap);
    return td;
}
function wrapBrowserFlagPreviewInput(input) {
    const wrap = document.createElement("div");
    wrap.className = "lk-browser-flag-editor-wrap";
    const overlay = document.createElement("div");
    overlay.className = "lk-browser-flag-overlay";
    const renderOverlay = () => {
        var _a;
        renderMarkdownPreviewInElement(overlay, String((_a = input.value) !== null && _a !== void 0 ? _a : ""));
    };
    overlay.addEventListener("click", () => input.focus());
    input.classList.add("lk-browser-flag-input");
    input.addEventListener("focus", () => {
        wrap.classList.add("lk-browser-flag-editor--focused");
    });
    input.addEventListener("blur", () => {
        wrap.classList.remove("lk-browser-flag-editor--focused");
        renderOverlay();
    });
    input.addEventListener("input", () => {
        if (!wrap.classList.contains("lk-browser-flag-editor--focused"))
            renderOverlay();
    });
    renderOverlay();
    wrap.appendChild(input);
    wrap.appendChild(overlay);
    return wrap;
}
function makeFlagPreviewEditorCell(col, card, ctx, initial) {
    const td = document.createElement("td");
    td.className = `align-top ${ctx.cellWrapClass} lk-browser-cell`;
    forceCellClip(td);
    setColAttr(td, col);
    const h = `${ctx.editorHeightPx}px`;
    const wrap = document.createElement("div");
    wrap.className = "lk-browser-flag-editor-wrap lk-browser-flag-editor-wrap--multiline";
    setCssProps(wrap, "--learnkit-editor-height", h);
    const ta = document.createElement("textarea");
    ta.className = `textarea w-full ${ctx.cellTextClass} lk-browser-textarea lk-browser-textarea--editable lk-browser-flag-textarea`;
    ta.value = initial;
    setCssProps(ta, "--learnkit-editor-height", h);
    const overlay = document.createElement("div");
    overlay.className = "lk-browser-flag-overlay lk-browser-flag-overlay--multiline";
    const renderOverlay = (txt) => {
        renderMarkdownPreviewInElement(overlay, txt);
    };
    renderOverlay(initial);
    overlay.addEventListener("click", () => ta.focus());
    const key = `${card.id}:${col}`;
    let baseline = initial;
    ta.addEventListener("focus", () => {
        baseline = ta.value;
        wrap.classList.add("lk-browser-flag-editor--focused");
    });
    ta.addEventListener("keydown", (ev) => {
        if (handleTabInTextarea(ta, ev))
            return;
        if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            ta.value = baseline;
            renderOverlay(baseline);
            ta.blur();
        }
    });
    ta.addEventListener("blur", () => {
        wrap.classList.remove("lk-browser-flag-editor--focused");
        void (async () => {
            const nextVal = ta.value;
            if (nextVal === baseline) {
                renderOverlay(baseline);
                return;
            }
            if (ctx.saving.has(key))
                return;
            ctx.saving.add(key);
            try {
                const updated = ctx.applyValueToCard(card, col, nextVal);
                await ctx.writeCardToMarkdown(updated);
                baseline = nextVal;
                renderOverlay(nextVal);
            }
            catch (err) {
                new Notice(`${err instanceof Error ? err.message : String(err)}`);
                ta.value = baseline;
                renderOverlay(baseline);
            }
            finally {
                ctx.saving.delete(key);
            }
        })();
    });
    wrap.appendChild(ta);
    wrap.appendChild(overlay);
    td.appendChild(wrap);
    return td;
}
// ──────────────────────────────────────────────────────────────────────────────
// MCQ answer cell — multiple inputs for correct + wrong options
// ──────────────────────────────────────────────────────────────────────────────
function makeMcqAnswerCell(card, isQuarantined, ctx) {
    const td = document.createElement("td");
    td.className = `align-top ${ctx.cellWrapClass} lk-browser-cell`;
    forceCellClip(td);
    setColAttr(td, "answer");
    if (isQuarantined) {
        td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground lk-browser-cell`;
        td.textContent = buildAnswerOrOptionsFor(card) || txFromCtx(ctx, "ui.common.na", "—");
        forceWrapStyles(td);
        return td;
    }
    const options = normalizeCardOptions(card.options);
    const correctIdxSet = new Set(getCorrectIndices(card));
    const wrap = document.createElement("div");
    wrap.className = "flex flex-col gap-1 lk-browser-mcq-cell";
    const h = `${ctx.editorHeightPx}px`;
    setCssProps(wrap, "--learnkit-editor-height", h);
    const rows = [];
    const key = `${card.id}:answer`;
    let saving = false;
    const commitMcq = async () => {
        var _a;
        if (saving)
            return;
        if (ctx.saving.has(key))
            return;
        // Collect current values
        const liveOptions = [];
        const liveCorrectIndices = [];
        for (const r of rows) {
            const val = r.input.value.trim();
            if (!val)
                continue;
            if (r.checkbox.checked)
                liveCorrectIndices.push(liveOptions.length);
            liveOptions.push(val);
        }
        // Must have at least 1 option
        if (liveOptions.length < 1)
            return;
        // Check if anything changed
        const origOptions = normalizeCardOptions(card.options);
        const origCorrectSet = new Set(getCorrectIndices(card));
        const liveCorrectSet = new Set(liveCorrectIndices);
        if (liveOptions.length === origOptions.length &&
            liveOptions.every((v, i) => v === origOptions[i]) &&
            liveCorrectSet.size === origCorrectSet.size &&
            [...liveCorrectSet].every((i) => origCorrectSet.has(i)))
            return;
        saving = true;
        ctx.saving.add(key);
        try {
            const draft = JSON.parse(JSON.stringify(card));
            draft.options = liveOptions;
            draft.correctIndex = (_a = liveCorrectIndices[0]) !== null && _a !== void 0 ? _a : 0;
            draft.correctIndices = liveCorrectIndices.length > 1 ? liveCorrectIndices : null;
            await ctx.writeCardToMarkdown(draft);
        }
        catch (err) {
            new Notice(`${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            saving = false;
            ctx.saving.delete(key);
        }
    };
    const pruneEmptyRows = () => {
        // Remove empty non-focused rows (but keep min 1 option total)
        const toRemove = [];
        for (const r of rows) {
            if (r.input === document.activeElement)
                continue;
            if (r.input.value.trim() === "")
                toRemove.push(r);
        }
        // Keep at least 1 row
        const remaining = rows.length - toRemove.length;
        if (remaining < 1) {
            if (toRemove.length > 0)
                toRemove.shift();
        }
        for (const r of toRemove) {
            const idx = rows.indexOf(r);
            if (idx < 0)
                continue;
            rows.splice(idx, 1);
            r.row.remove();
        }
    };
    const addMcqInputRow = (value, isCorrect) => {
        const row = document.createElement("div");
        row.className = "flex items-center gap-1 lk-browser-mcq-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isCorrect;
        checkbox.className = "learnkit-mcq-correct-checkbox";
        checkbox.setAttribute("aria-label", txFromCtx(ctx, "ui.browser.row.mcq.markCorrect", "Mark as correct answer"));
        checkbox.setAttribute("data-tooltip-position", "top");
        row.appendChild(checkbox);
        checkbox.addEventListener("change", () => {
            // Commit on checkbox toggle so the change is persisted
            void commitMcq();
        });
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input flex-1 learnkit-input-fixed lk-browser-mcq-input";
        input.placeholder = txFromCtx(ctx, "ui.browser.row.mcq.answerOption", "Answer option");
        input.value = value;
        row.appendChild(wrapBrowserFlagPreviewInput(input));
        const entry = { row, input, checkbox };
        rows.push(entry);
        input.addEventListener("blur", () => {
            // Defer so we can check if focus moved to another input in this cell
            setTimeout(() => {
                pruneEmptyRows();
                const focusedInCell = rows.some((r) => r.input === document.activeElement);
                if (!focusedInCell)
                    void commitMcq();
            }, 0);
        });
        wrap.appendChild(row);
        return entry;
    };
    // Seed with existing options
    for (let i = 0; i < options.length; i++) {
        addMcqInputRow(options[i] || "", correctIdxSet.has(i));
    }
    if (options.length === 0) {
        addMcqInputRow("", true);
    }
    // "Add option" input at bottom
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "input w-full learnkit-input-fixed lk-browser-mcq-add";
    addInput.placeholder = txFromCtx(ctx, "ui.browser.row.mcq.addOption", "+ add option");
    addInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            const val = addInput.value.trim();
            if (!val)
                return;
            const entry = addMcqInputRow(val, false);
            addInput.value = "";
            entry.input.focus();
        }
    });
    addInput.addEventListener("blur", () => {
        const val = addInput.value.trim();
        if (!val)
            return;
        addMcqInputRow(val, false);
        addInput.value = "";
        // Commit since focus left the cell
        setTimeout(() => {
            const focusedInCell = rows.some((r) => r.input === document.activeElement);
            if (!focusedInCell)
                void commitMcq();
        }, 0);
    });
    wrap.appendChild(wrapBrowserFlagPreviewInput(addInput));
    td.appendChild(wrap);
    return td;
}
// ──────────────────────────────────────────────────────────────────────────────
// OQ steps cell — numbered draggable inputs for ordered question steps
// ──────────────────────────────────────────────────────────────────────────────
function makeOqStepsCell(card, isQuarantined, ctx) {
    const td = document.createElement("td");
    td.className = `align-top ${ctx.cellWrapClass} lk-browser-cell`;
    forceCellClip(td);
    setColAttr(td, "answer");
    if (isQuarantined) {
        td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground lk-browser-cell`;
        td.textContent = buildAnswerOrOptionsFor(card) || txFromCtx(ctx, "ui.common.na", "—");
        forceWrapStyles(td);
        return td;
    }
    const steps = Array.isArray(card.oqSteps)
        ? card.oqSteps.filter((step) => typeof step === "string")
        : [];
    const wrap = document.createElement("div");
    wrap.className = "flex flex-col gap-1 lk-browser-oq-cell";
    const h = `${ctx.editorHeightPx}px`;
    setCssProps(wrap, "--learnkit-editor-height", h);
    const oqRows = [];
    let draggingRow = null;
    const key = `${card.id}:answer`;
    let saving = false;
    const renumber = () => {
        oqRows.forEach((entry, i) => {
            entry.badge.textContent = String(i + 1);
            entry.input.placeholder = `Step ${i + 1}`;
        });
    };
    const commitOq = async () => {
        if (saving)
            return;
        if (ctx.saving.has(key))
            return;
        const liveSteps = oqRows.map((r) => r.input.value.trim()).filter(Boolean);
        if (liveSteps.length < 2)
            return;
        // Check if changed
        const orig = Array.isArray(card.oqSteps)
            ? card.oqSteps.filter((step) => typeof step === "string")
            : [];
        if (liveSteps.length === orig.length && liveSteps.every((v, i) => v === orig[i]))
            return;
        saving = true;
        ctx.saving.add(key);
        try {
            const draft = JSON.parse(JSON.stringify(card));
            draft.oqSteps = liveSteps;
            await ctx.writeCardToMarkdown(draft);
        }
        catch (err) {
            new Notice(`${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            saving = false;
            ctx.saving.delete(key);
        }
    };
    const pruneEmptyRows = () => {
        const toRemove = [];
        for (const r of oqRows) {
            if (r.input === document.activeElement)
                continue;
            if (r.input.value.trim() === "")
                toRemove.push(r);
        }
        // Keep at least 2 rows
        const remaining = oqRows.length - toRemove.length;
        const deficit = 2 - remaining;
        if (deficit > 0) {
            // Keep some empties to meet minimum
            toRemove.splice(0, deficit);
        }
        for (const r of toRemove) {
            const idx = oqRows.indexOf(r);
            if (idx < 0)
                continue;
            oqRows.splice(idx, 1);
            r.row.remove();
        }
        renumber();
    };
    // The add-step input is wrapped for flag preview, so we need a direct child
    // anchor node of `wrap` when inserting/reordering OQ rows.
    const getAddAnchor = () => {
        const addInput = wrap.querySelector(".lk-browser-oq-add");
        if (!addInput)
            return null;
        if (addInput.parentElement === wrap)
            return addInput;
        const wrapped = addInput.closest(".lk-browser-flag-editor-wrap");
        if (wrapped && wrapped.parentElement === wrap)
            return wrapped;
        return null;
    };
    const addOqInputRow = (value) => {
        const idx = oqRows.length;
        const row = document.createElement("div");
        row.className = "flex items-center gap-1 lk-browser-oq-row";
        row.draggable = false;
        // Drag grip
        const grip = document.createElement("span");
        grip.className = "inline-flex items-center justify-center text-muted-foreground cursor-grab learnkit-oq-grip-sm";
        grip.draggable = true;
        setIcon(grip, "grip-vertical");
        row.appendChild(grip);
        // Number badge
        const badge = document.createElement("span");
        badge.className = "text-xs font-medium text-muted-foreground w-4 shrink-0 text-center";
        badge.textContent = String(idx + 1);
        row.appendChild(badge);
        // Text input
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input flex-1 learnkit-input-fixed lk-browser-oq-input";
        input.placeholder = `Step ${idx + 1}`;
        input.value = value;
        row.appendChild(wrapBrowserFlagPreviewInput(input));
        const entry = { row, input, badge };
        oqRows.push(entry);
        // ── DnD reordering ──
        row.addEventListener("dragstart", (ev) => {
            draggingRow = entry;
            if (ev.dataTransfer) {
                const fromIdx = oqRows.findIndex((e) => e.row === row);
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", String(fromIdx));
            }
            row.classList.add("learnkit-oq-row-dragging", "learnkit-oq-row-dragging");
        });
        row.addEventListener("dragend", () => {
            draggingRow = null;
            row.classList.remove("learnkit-oq-row-dragging", "learnkit-oq-row-dragging");
        });
        row.addEventListener("dragover", (ev) => {
            ev.preventDefault();
            if (ev.dataTransfer)
                ev.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("drop", (ev) => {
            ev.preventDefault();
            const fromIdx = draggingRow ? oqRows.indexOf(draggingRow) : -1;
            const toIdx = oqRows.findIndex((e) => e.row === row);
            if (isNaN(fromIdx) || fromIdx < 0 || toIdx < 0 || fromIdx === toIdx)
                return;
            const [moved] = oqRows.splice(fromIdx, 1);
            oqRows.splice(toIdx, 0, moved);
            // Reorder DOM
            const listEl = wrap;
            const addEl = getAddAnchor();
            for (const entry of oqRows) {
                if (addEl)
                    listEl.insertBefore(entry.row, addEl);
                else
                    listEl.appendChild(entry.row);
            }
            renumber();
            void commitOq();
        });
        input.addEventListener("blur", () => {
            setTimeout(() => {
                pruneEmptyRows();
                const focusedInCell = oqRows.some((r) => r.input === document.activeElement);
                if (!focusedInCell && !wrap.contains(document.activeElement))
                    void commitOq();
            }, 0);
        });
        // Insert before the "add" input
        const addEl = getAddAnchor();
        if (addEl)
            wrap.insertBefore(row, addEl);
        else
            wrap.appendChild(row);
        return entry;
    };
    // Seed with existing steps (min 2 rows)
    const seed = steps.length >= 2 ? steps : [...steps, ...Array(2 - steps.length).fill("")];
    for (const s of seed)
        addOqInputRow(s);
    renumber();
    // "Add step" input
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "input w-full learnkit-input-fixed lk-browser-oq-add";
    addInput.placeholder = txFromCtx(ctx, "ui.browser.row.oq.addStep", "+ add step");
    addInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            const val = addInput.value.trim();
            if (!val)
                return;
            if (oqRows.length >= 20) {
                new Notice(txFromCtx(ctx, "ui.common.maxSteps20", "Maximum 20 steps."));
                return;
            }
            const entry = addOqInputRow(val);
            renumber();
            addInput.value = "";
            entry.input.focus();
        }
    });
    addInput.addEventListener("blur", () => {
        const val = addInput.value.trim();
        if (!val)
            return;
        if (oqRows.length >= 20)
            return;
        addOqInputRow(val);
        renumber();
        addInput.value = "";
        setTimeout(() => {
            const focusedInCell = oqRows.some((r) => r.input === document.activeElement);
            if (!focusedInCell && !wrap.contains(document.activeElement))
                void commitOq();
        }, 0);
    });
    wrap.appendChild(wrapBrowserFlagPreviewInput(addInput));
    td.appendChild(wrap);
    return td;
}
function makeEditorCell(col, card, isQuarantined, ctx) {
    if (isQuarantined) {
        const initial = col === "title"
            ? (card.title || "")
            : col === "question"
                ? buildQuestionFor(card)
                : col === "answer"
                    ? buildAnswerOrOptionsFor(card)
                    : col === "info"
                        ? (card.info || "")
                        : "";
        return makeReadOnlyFieldCell(initial || "—", col, ctx);
    }
    if (col === "answer" && card.type === "cloze") {
        const td = document.createElement("td");
        td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground lk-browser-cell`;
        td.textContent = CLOZE_ANSWER_HELP;
        forceWrapStyles(td);
        forceCellClip(td);
        setColAttr(td, col);
        return td;
    }
    if (col === "answer" && card.type === "mcq") {
        return makeMcqAnswerCell(card, isQuarantined, ctx);
    }
    if (col === "answer" && card.type === "oq") {
        return makeOqStepsCell(card, isQuarantined, ctx);
    }
    if ((card.type === "io" || card.type === "io-child") && (col === "question" || col === "answer")) {
        return makeIoCell(col, card, ctx);
    }
    const initial = col === "title"
        ? (card.title || "")
        : col === "question"
            ? buildQuestionFor(card)
            : col === "answer"
                ? buildAnswerOrOptionsFor(card)
                : col === "info"
                    ? (card.info || "")
                    : "";
    // Check if content has images - if so, use contenteditable with image rendering
    const hasImages = extractImageRefs(initial).length > 0;
    if (hasImages && (col === "question" || col === "answer" || col === "info")) {
        return makeImageEditorCell(col, card, ctx, initial);
    }
    return makeFlagPreviewEditorCell(col, card, ctx, initial);
}
function makeIoCell(col, card, ctx) {
    var _a, _b, _c;
    const td = document.createElement("td");
    td.className = `align-top ${ctx.cellWrapClass} lk-browser-cell lk-browser-io-cell`;
    forceCellClip(td);
    setColAttr(td, col);
    const io = getIoResolvedImage(ctx.app, card);
    if (!io.src || !io.displayRef) {
        return makeReadOnlyFieldCell("— (" + txFromCtx(ctx, "ui.browser.row.io.unresolved", "IO image not resolved") + ")", col, ctx);
    }
    /* Textarea-styled wrapper so the IO preview matches other cells */
    const box = document.createElement("div");
    box.className = "lk-browser-io-box";
    const h = `${ctx.editorHeightPx}px`;
    setCssProps(box, "--learnkit-editor-height", h);
    if (col === "question") {
        const ioMap = ((_a = ctx.plugin.store.data) === null || _a === void 0 ? void 0 : _a.io) || {};
        const parentId = card.type === "io" ? String(card.id) : String(card.parentId || "");
        const def = parentId ? ioMap[parentId] : null;
        const cardRec = card;
        const rects = Array.isArray(def === null || def === void 0 ? void 0 : def.rects) ? def.rects : ((_c = (_b = cardRec.occlusions) !== null && _b !== void 0 ? _b : cardRec.rects) !== null && _c !== void 0 ? _c : null);
        let maskedRects = rects;
        if (card.type === "io-child" && Array.isArray(rects)) {
            const rectIds = Array.isArray(card.rectIds) ? card.rectIds.map((r) => String(r)) : [];
            maskedRects = rectIds.length
                ? rects.filter((r) => rectIds.includes(String(r.rectId)))
                : rects;
        }
        replaceChildrenWithHTML(box, buildIoOccludedHtml(io.src, io.displayRef, maskedRects, `IO (occluded) — ${buildPrimaryCardAnchor(String(card.id))}`));
    }
    else {
        replaceChildrenWithHTML(box, buildIoImgHtml(io.src, io.displayRef, `IO (original) — ${buildPrimaryCardAnchor(String(card.id))}`));
    }
    /* DOMPurify strips app:// protocol URLs from src attributes.
       Re-apply the resolved src directly via DOM so Obsidian vault
       resource paths survive sanitisation. */
    for (const img of Array.from(box.querySelectorAll("img"))) {
        if (!img.getAttribute("src"))
            img.src = io.src;
    }
    box.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ctx.openIoEditor(card.id);
    });
    td.appendChild(box);
    return td;
}
// ── Groups editor cell (tag-picker with popover) ──────────
function makeGroupsEditorCell(card, isQuarantined, rowIndex, pageRowCount, _pageRows, ctx, sharedOptionSet) {
    if (isQuarantined) {
        return makeReadOnlyFieldCell("—", "groups", ctx);
    }
    const wrap = ctx.tableWrapEl;
    const td = document.createElement("td");
    td.className = "align-top lk-browser-cell lk-browser-tag-cell";
    forceCellClip(td);
    setColAttr(td, "groups");
    const key = `${card.id}:groups`;
    let baseline = groupsToInput(card.groups);
    let selected = sortGroupPathsForDisplay(coerceGroups(card.groups)
        .map((g) => titleCaseGroupPath(String(g).trim()))
        .filter(Boolean));
    const tagBox = document.createElement("div");
    tagBox.className = `textarea w-full ${ctx.cellTextClass} lk-browser-tag-box`;
    setCssProps(tagBox, "--learnkit-editor-height", `${ctx.editorHeightPx}px`);
    td.appendChild(tagBox);
    const isCompact = ctx.densityMode === "compact";
    const renderBadges = () => {
        clearNode(tagBox);
        if (selected.length === 0) {
            const empty = document.createElement("span");
            if (isCompact) {
                empty.className = "text-muted-foreground lk-browser-tag-empty-compact";
                empty.textContent = "—";
            }
            else {
                empty.className =
                    "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 learnkit-badge-placeholder learnkit-badge-inline lk-browser-tag-empty";
                empty.textContent = txFromCtx(ctx, "ui.browser.groups.empty", "No groups");
            }
            tagBox.appendChild(empty);
            return;
        }
        if (isCompact) {
            const text = document.createElement("span");
            text.className = "lk-browser-tag-compact-text";
            text.textContent = selected.map((g) => formatGroupDisplay(g)).join(", ");
            tagBox.appendChild(text);
            return;
        }
        for (const tag of selected) {
            const badge = document.createElement("span");
            badge.className =
                "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 learnkit-badge-placeholder learnkit-badge-inline lk-browser-tag-badge";
            const txt = document.createElement("span");
            txt.textContent = formatGroupDisplay(tag);
            badge.appendChild(txt);
            const removeBtn = document.createElement("span");
            removeBtn.className =
                "ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer lk-browser-tag-remove";
            setIcon(removeBtn, "x");
            removeBtn.addEventListener("pointerdown", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            });
            removeBtn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                selected = sortGroupPathsForDisplay(selected.filter((t) => t !== tag));
                renderBadges();
                renderList();
                void commit();
            });
            badge.appendChild(removeBtn);
            tagBox.appendChild(badge);
        }
    };
    const commit = async () => {
        const nextVal = groupsToInput(selected);
        if (nextVal === baseline)
            return;
        if (ctx.saving.has(key))
            return;
        ctx.saving.add(key);
        try {
            const updated = ctx.applyValueToCard(card, "groups", nextVal);
            await ctx.writeCardToMarkdown(updated);
            ctx.plugin.store.upsertCard(updated);
            baseline = nextVal;
        }
        catch (err) {
            new Notice(`${err instanceof Error ? err.message : String(err)}`);
            selected = sortGroupPathsForDisplay(parseGroupsInput(baseline));
            renderBadges();
        }
        finally {
            ctx.saving.delete(key);
        }
    };
    // ── Popover ──
    const popover = document.createElement("div");
    popover.className = "learnkit learnkit-popover-overlay";
    popover.setAttribute("aria-hidden", "true");
    const panel = document.createElement("div");
    panel.className =
        "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 learnkit-pointer-auto";
    popover.appendChild(panel);
    const searchWrap = document.createElement("div");
    searchWrap.className = "flex items-center gap-1 border-b border-border pl-1 pr-0 lk-browser-search-wrap min-h-[38px]";
    panel.appendChild(searchWrap);
    const searchIcon = document.createElement("span");
    searchIcon.className =
        "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground learnkit-search-icon";
    searchIcon.setAttribute("aria-hidden", "true");
    setIcon(searchIcon, "search");
    searchWrap.appendChild(searchIcon);
    const search = document.createElement("input");
    search.type = "text";
    search.className = "bg-transparent text-sm flex-1 h-9 min-w-0 w-full learnkit-search-naked";
    search.placeholder = txFromCtx(ctx, "ui.browser.groups.searchOrAdd", "Search or add group");
    searchWrap.appendChild(search);
    const list = document.createElement("div");
    list.className = "flex flex-col max-h-60 overflow-auto p-1 learnkit-group-picker-results";
    panel.appendChild(list);
    let cleanup = null;
    const optionSet = new Set(sharedOptionSet);
    let allOptions = Array.from(optionSet).sort((a, b) => formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)));
    const addOption = (tag) => {
        let changed = false;
        for (const t of expandGroupAncestors(tag)) {
            if (!optionSet.has(t)) {
                optionSet.add(t);
                changed = true;
            }
        }
        if (changed) {
            allOptions = Array.from(optionSet).sort((a, b) => formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)));
        }
    };
    const toggleTag = (tag) => {
        const next = titleCaseGroupPath(tag);
        if (!next)
            return;
        if (selected.includes(next))
            selected = sortGroupPathsForDisplay(selected.filter((t) => t !== next));
        else
            selected = sortGroupPathsForDisplay([...selected, next]);
        renderBadges();
        renderList();
    };
    const shouldDropUp = rowIndex >= Math.max(0, pageRowCount - 2);
    const place = () => placePopover({
        trigger: tagBox, panel, popoverEl: popover,
        width: Math.round(tagBox.getBoundingClientRect().width || tagBox.clientWidth || 240),
        dropUp: shouldDropUp,
    });
    const renderList = () => {
        clearNode(list);
        const raw = search.value.trim();
        const rawTitle = titleCaseGroupPath(raw);
        const rawDisplay = formatGroupDisplay(rawTitle);
        const q = raw.toLowerCase();
        const options = allOptions.filter((t) => formatGroupDisplay(t).toLowerCase().includes(q));
        const exact = raw && allOptions.some((t) => formatGroupDisplay(t).toLowerCase() === rawDisplay.toLowerCase());
        const addRow = (label, value, isAdd = false) => {
            const row = document.createElement("div");
            row.setAttribute("role", "menuitem");
            row.setAttribute("aria-checked", selected.includes(value) ? "true" : "false");
            row.tabIndex = 0;
            row.className =
                "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";
            const text = document.createElement("span");
            text.textContent = label;
            row.appendChild(text);
            if (selected.includes(value) && !isAdd) {
                const check = document.createElement("span");
                check.className =
                    "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
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
                if (isAdd) {
                    const next = titleCaseGroupPath(value);
                    toggleTag(next);
                    if (next)
                        addOption(next);
                    search.value = "";
                    renderList();
                    return;
                }
                toggleTag(value);
            });
            row.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (isAdd) {
                        const next = titleCaseGroupPath(value);
                        toggleTag(next);
                        if (next)
                            addOption(next);
                        search.value = "";
                        renderList();
                        return;
                    }
                    toggleTag(value);
                }
            });
            list.appendChild(row);
        };
        if (raw && !exact)
            addRow(`Add "${rawDisplay || rawTitle}"`, rawTitle || raw, true);
        if (allOptions.length === 0 && !raw && selected.length === 0) {
            list.classList.add("learnkit-list-unbounded", "learnkit-list-unbounded");
            const empty = document.createElement("div");
            empty.className = "px-2 py-2 text-sm text-muted-foreground whitespace-normal break-words";
            empty.textContent = txFromCtx(ctx, "ui.browser.groups.emptyHint", "Type a keyword above to save this flashcard to a group.");
            list.appendChild(empty);
            return;
        }
        list.classList.remove("learnkit-list-unbounded", "learnkit-list-unbounded");
        for (const opt of options)
            addRow(formatGroupDisplay(opt), opt);
        if (shouldDropUp) {
            requestAnimationFrame(() => place());
            requestAnimationFrame(() => place());
        }
    };
    let closing = false;
    const close = () => {
        if (closing)
            return;
        closing = true;
        popover.setAttribute("aria-hidden", "true");
        popover.classList.remove("is-open");
        try {
            cleanup === null || cleanup === void 0 ? void 0 : cleanup();
        }
        catch (e) {
            log.swallow("popover cleanup", e);
        }
        cleanup = null;
        try {
            popover.remove();
        }
        catch (e) {
            log.swallow("remove popover", e);
        }
        void commit();
        renderBadges();
    };
    const open = () => {
        popover.setAttribute("aria-hidden", "false");
        popover.classList.add("is-open");
        document.body.appendChild(popover);
        requestAnimationFrame(() => place());
        requestAnimationFrame(() => place());
        renderList();
        search.focus();
        const onResizeOrScroll = () => place();
        const onDocPointerDown = (ev) => {
            const t = ev.target;
            if (!t)
                return;
            if (tagBox.contains(t) || popover.contains(t))
                return;
            close();
        };
        const onDocKeydown = (ev) => {
            if (ev.key !== "Escape")
                return;
            ev.preventDefault();
            ev.stopPropagation();
            close();
        };
        window.addEventListener("resize", onResizeOrScroll, true);
        window.addEventListener("scroll", onResizeOrScroll, true);
        wrap === null || wrap === void 0 ? void 0 : wrap.addEventListener("scroll", onResizeOrScroll, { passive: true });
        let detachObserver = null;
        if (document.body) {
            detachObserver = new MutationObserver(() => {
                if (!tagBox.isConnected || !popover.isConnected) {
                    close();
                }
            });
            detachObserver.observe(document.body, { childList: true, subtree: true });
        }
        const tid = window.setTimeout(() => {
            document.addEventListener("pointerdown", onDocPointerDown, true);
            document.addEventListener("keydown", onDocKeydown, true);
        }, 0);
        cleanup = () => {
            window.clearTimeout(tid);
            window.removeEventListener("resize", onResizeOrScroll, true);
            window.removeEventListener("scroll", onResizeOrScroll, true);
            wrap === null || wrap === void 0 ? void 0 : wrap.removeEventListener("scroll", onResizeOrScroll);
            document.removeEventListener("pointerdown", onDocPointerDown, true);
            document.removeEventListener("keydown", onDocKeydown, true);
            detachObserver === null || detachObserver === void 0 ? void 0 : detachObserver.disconnect();
            detachObserver = null;
        };
    };
    tagBox.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0)
            return;
        ev.preventDefault();
        ev.stopPropagation();
        open();
    });
    search.addEventListener("input", () => renderList());
    search.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === ",") {
            ev.preventDefault();
            ev.stopPropagation();
            const raw = search.value.replace(/,$/, "").trim();
            if (raw) {
                const next = titleCaseGroupPath(raw);
                toggleTag(next);
                if (next)
                    addOption(next);
                search.value = "";
                renderList();
            }
        }
    });
    renderBadges();
    return td;
}
