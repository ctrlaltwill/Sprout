/**
 * @file src/modals/bulk-edit.ts
 * @summary Full-screen "Edit flashcard" modal used by the Reviewer, Reading, and Widget views.
 * Extends Obsidian's Modal class for consistent lifecycle, z-index, and paint behaviour.
 * Supports single-card editing for basic, reversed, cloze, MCQ, and OQ types with read-only
 * metadata fields and editable content fields including a dynamic MCQ options list, OQ step
 * reordering, and group tag-picker.
 *
 * @exports
 *  - BulkEditCardModal — Obsidian Modal subclass for editing card records
 *  - openBulkEditModalForCards — convenience wrapper that creates and opens BulkEditCardModal
 */
import { Modal, Notice, setIcon } from "obsidian";
import { t } from "../translations/translator";
import { normalizeCardOptions, getCorrectIndices } from "../core/store";
import { buildAnswerOrOptionsFor, escapePipes, parseMcqOptionsFromCell, } from "../../views/reviewer/fields";
import { stageLabel } from "../../views/reviewer/labels";
import { createGroupPickerField as createGroupPickerFieldImpl } from "../card-editor/card-editor";
import { typeLabelBrowser, fmtDue, fmtLocation, parseGroupsInput, createThemedDropdown, setModalTitle, scopeModalToWorkspace, } from "./modal-utils";
import { coerceGroups } from "../../engine/indexing/group-format";
import { renderMarkdownPreviewInElement, setCssProps } from "../core/ui";
import { handleTabInTextarea } from "../card-editor/card-editor";
const CLOZE_TOOLTIP = "Use cloze syntax to hide text in your prompt.\n{{c1::text}} creates the first blank.\nUse {{c2::text}} for a different blank, or reuse {{c1::text}} to reveal together.\nShortcuts: Cmd/Ctrl+Shift+C (new blank), Cmd/Ctrl+Shift+Alt/Option+C (same blank number).";
const MCQ_TOOLTIP = "Check the box next to each correct answer. At least one correct and one incorrect option required.";
const OQ_TOOLTIP = "Write the steps in the correct order.\nYou must have at least 2 steps.\nDrag the grip handles to reorder steps.\nSteps are shuffled during review.";
// ──────────────────────────────────────────────────────────────────────────────
// Helpers (private to this module)
// ──────────────────────────────────────────────────────────────────────────────
/** Convert a groups value (string | string[] | null) to a display string. */
function formatGroupsForInput(groups) {
    if (!groups || !groups.length)
        return "";
    return groups.join(" / ");
}
function fieldMinHeightPx(field) {
    return 50;
}
function fieldMaxHeightPx(field) {
    return 150;
}
function getSharedEditableFieldValue(cards, field) {
    const cardsForField = cards.filter((card) => {
        var _a;
        if (field === "answer")
            return String((_a = card.type) !== null && _a !== void 0 ? _a : "").toLowerCase() !== "cloze";
        return true;
    });
    if (!cardsForField.length)
        return "";
    const values = cardsForField.map((card) => {
        if (field === "title")
            return String(card.title || "");
        if (field === "question") {
            if (card.type === "basic" || card.type === "reversed")
                return String(card.q || "");
            if (card.type === "mcq")
                return String(card.stem || "");
            if (card.type === "oq")
                return String(card.q || "");
            if (card.type === "cloze")
                return String(card.clozeText || "");
        }
        if (field === "answer") {
            if (card.type === "basic" || card.type === "reversed")
                return String(card.a || "");
            if (card.type === "mcq")
                return buildAnswerOrOptionsFor(card);
        }
        if (field === "info")
            return String(card.info || "");
        if (field === "groups")
            return formatGroupsForInput(coerceGroups(card.groups));
        return "";
    });
    const firstValue = values[0];
    return values.every((value) => value === firstValue) ? firstValue : "";
}
// ──────────────────────────────────────────────────────────────────────────────
// BulkEditCardModal
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Obsidian Modal subclass for editing one or more card records in review mode.
 * Supports basic, reversed, cloze, MCQ, and OQ cards. IO cards are excluded.
 */
export class BulkEditCardModal extends Modal {
    constructor(app, plugin, cards, onSave) {
        super(app);
        this.closeCleanup = [];
        this.plugin = plugin;
        this.cards = cards.filter((c) => !["io", "io-child"].includes(String(c.type || "")));
        this.onSaveCallback = onSave;
    }
    _tx(token, fallback, vars) {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
    }
    onOpen() {
        const { plugin, cards, onSaveCallback: onSave } = this;
        if (!cards.length) {
            this.close();
            return;
        }
        // ── Modal chrome ──────────────────────────────────────────────────────
        setModalTitle(this, "Edit flashcard");
        // Apply all CSS classes and z-index BEFORE scoping to workspace.
        // scopeModalToWorkspace forces a repaint, which only works if the
        // positioning CSS (position:absolute, z-index, etc.) is already active.
        this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "learnkit");
        setCssProps(this.containerEl, "z-index", "2147483000");
        this.modalEl.addClass("lk-modals", "learnkit-bulk-edit-panel");
        setCssProps(this.modalEl, "z-index", "2147483001");
        scopeModalToWorkspace(this);
        this.contentEl.addClass("learnkit-bulk-edit-content");
        // Escape key closes modal
        this.scope.register([], "Escape", () => { this.close(); return false; });
        const { contentEl } = this;
        contentEl.empty();
        const headerEl = this.modalEl.querySelector(":scope > .modal-header");
        const closeBtn = this.modalEl.querySelector(":scope > .modal-close-button");
        if (closeBtn)
            closeBtn.remove();
        if (headerEl) {
            const close = document.createElement("button");
            close.type = "button";
            close.className = "learnkit-btn-toolbar learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-card-creator-close-btn learnkit-bulk-edit-close-btn";
            close.setAttribute("aria-label", this._tx("ui.common.close", "Close"));
            close.setAttribute("data-tooltip-position", "top");
            const closeIcon = document.createElement("span");
            closeIcon.className = "inline-flex items-center justify-center";
            setIcon(closeIcon, "x");
            close.appendChild(closeIcon);
            close.addEventListener("click", () => this.close());
            headerEl.appendChild(close);
            if (headerEl.parentElement !== this.modalEl) {
                this.modalEl.insertBefore(headerEl, contentEl);
            }
        }
        // Reset cleanup handlers for this modal instance and collect teardown work
        // (currently observers, and future global listeners if added).
        this.closeCleanup = [];
        const registerCloseCleanup = (fn) => {
            this.closeCleanup.push(fn);
        };
        // ── Form body ─────────────────────────────────────────────────────────────
        const form = document.createElement("div");
        form.className = "flex flex-col gap-4";
        const normalizedTypes = cards.map((c) => { var _a; return String((_a = c === null || c === void 0 ? void 0 : c.type) !== null && _a !== void 0 ? _a : "").toLowerCase(); });
        const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
        const isClozeOnly = normalizedTypes.length > 0 && normalizedTypes.every((type) => type === "cloze");
        const isSingleMcq = cards.length === 1 && normalizedTypes[0] === "mcq";
        const isSingleOq = cards.length === 1 && normalizedTypes[0] === "oq";
        const isSingleEdit = cards.length === 1;
        // Map of input elements by field key
        const inputEls = {};
        const attachFlagPreviewOverlay = (control, minControlHeight = 100, maxControlHeight = Number.POSITIVE_INFINITY) => {
            const wrap = document.createElement("div");
            wrap.className = `bc learnkit-flag-editor-wrap${control instanceof HTMLTextAreaElement ? " learnkit-flag-editor-wrap--multiline" : ""}`;
            const overlay = document.createElement("div");
            overlay.className = `bc learnkit-flag-editor-overlay${control instanceof HTMLTextAreaElement ? " learnkit-flag-editor-overlay--multiline" : ""}`;
            control.classList.add("learnkit-flag-editor-control", "learnkit-flag-editor-control");
            if (control instanceof HTMLTextAreaElement) {
                // Start compact and allow user-resize up to max height.
                control.rows = 1;
                setCssProps(control, {
                    "min-height": `${minControlHeight}px`,
                    height: `${minControlHeight}px`,
                    "max-height": `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`,
                    resize: "vertical",
                    "overflow-y": "auto",
                });
            }
            const measureControlHeight = () => {
                return Math.max(minControlHeight, Math.ceil(control.getBoundingClientRect().height || 0));
            };
            const applyControlHeight = (height) => {
                setCssProps(control, "min-height", `${height}px`);
                setCssProps(control, "height", `${height}px`);
                if (Number.isFinite(maxControlHeight)) {
                    setCssProps(control, "max-height", `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`);
                }
                if (control instanceof HTMLInputElement) {
                    setCssProps(control, "max-height", `${height}px`);
                }
            };
            let pendingSyncRaf = 0;
            let lastPreviewHeight = 0;
            const syncPreviewHeight = () => {
                const controlHeight = measureControlHeight();
                const rawPreviewHeight = Math.max(minControlHeight, controlHeight);
                const previewHeight = Number.isFinite(maxControlHeight)
                    ? Math.min(Math.max(minControlHeight, Math.floor(maxControlHeight)), rawPreviewHeight)
                    : rawPreviewHeight;
                if (previewHeight === lastPreviewHeight)
                    return;
                lastPreviewHeight = previewHeight;
                wrap.style.setProperty("--learnkit-flag-preview-height", `${previewHeight}px`);
                if (Number.isFinite(maxControlHeight)) {
                    wrap.style.setProperty("--learnkit-flag-preview-max-height", `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`);
                }
                applyControlHeight(previewHeight);
            };
            const queueSyncPreviewHeight = () => {
                if (pendingSyncRaf)
                    return;
                pendingSyncRaf = window.requestAnimationFrame(() => {
                    pendingSyncRaf = 0;
                    syncPreviewHeight();
                });
            };
            const renderOverlay = () => {
                var _a;
                renderMarkdownPreviewInElement(overlay, String((_a = control.value) !== null && _a !== void 0 ? _a : ""));
                syncPreviewHeight();
                window.requestAnimationFrame(syncPreviewHeight);
                window.setTimeout(syncPreviewHeight, 80);
            };
            const focusEditorFromPreview = (ev) => {
                control.focus({ preventScroll: true });
                if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
                    const end = control.value.length;
                    control.setSelectionRange(end, end);
                }
            };
            wrap.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0)
                    return;
                if (document.activeElement === control)
                    return;
                focusEditorFromPreview(ev);
            });
            overlay.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0)
                    return;
                if (document.activeElement === control)
                    return;
                focusEditorFromPreview(ev);
            }, true);
            overlay.addEventListener("click", (ev) => {
                if (document.activeElement === control)
                    return;
                focusEditorFromPreview(ev);
            });
            control.addEventListener("focus", () => {
                wrap.classList.add("learnkit-flag-editor--focused", "learnkit-flag-editor--focused");
                syncPreviewHeight();
            });
            control.addEventListener("blur", () => {
                wrap.classList.remove("learnkit-flag-editor--focused", "learnkit-flag-editor--focused");
                renderOverlay();
            });
            control.addEventListener("input", () => {
                syncPreviewHeight();
                if (!wrap.classList.contains("learnkit-flag-editor--focused"))
                    renderOverlay();
            });
            if (control instanceof HTMLTextAreaElement) {
                control.addEventListener("keydown", (ev) => {
                    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && String(ev.key).toLowerCase() === "a") {
                        ev.stopPropagation();
                    }
                });
            }
            if (typeof ResizeObserver !== "undefined") {
                const ro = new ResizeObserver(() => {
                    queueSyncPreviewHeight();
                });
                ro.observe(overlay);
                registerCloseCleanup(() => {
                    if (pendingSyncRaf) {
                        window.cancelAnimationFrame(pendingSyncRaf);
                        pendingSyncRaf = 0;
                    }
                    ro.disconnect();
                });
            }
            renderOverlay();
            wrap.appendChild(control);
            wrap.appendChild(overlay);
            return wrap;
        };
        const attachSingleEditBlurPreview = (textarea, minControlHeight = 80, maxControlHeight = 80) => {
            const wrap = document.createElement("div");
            wrap.className = "learnkit-single-edit-markdown-field";
            const preview = document.createElement("div");
            preview.className = "learnkit-single-edit-markdown-preview markdown-rendered";
            setCssProps(preview, {
                "min-height": `${minControlHeight}px`,
                height: `${minControlHeight}px`,
                "max-height": `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`,
            });
            setCssProps(textarea, {
                "min-height": `${minControlHeight}px`,
                height: `${minControlHeight}px`,
                "max-height": `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`,
                resize: "none",
                "overflow-y": "auto",
            });
            let isEditing = false;
            let lastSyncedHeight = minControlHeight;
            let suppressOutsideCloseUntil = 0;
            let allowEditorFocusUntil = 0;
            let keepEditorFocusUntil = 0;
            const clampHeight = (height) => {
                const floorMin = Math.max(minControlHeight, Math.ceil(height || 0));
                if (!Number.isFinite(maxControlHeight))
                    return floorMin;
                return Math.min(Math.max(minControlHeight, Math.floor(maxControlHeight)), floorMin);
            };
            const applyModeVisibility = (editing) => {
                if (editing) {
                    setCssProps(textarea, "display", "block");
                    setCssProps(preview, "display", "none");
                }
                else {
                    setCssProps(textarea, "display", "none");
                    setCssProps(preview, "display", "block");
                }
            };
            const applyHeight = (rawHeight) => {
                const targetHeight = clampHeight(rawHeight);
                lastSyncedHeight = targetHeight;
                setCssProps(textarea, {
                    "min-height": `${targetHeight}px`,
                    "height": `${targetHeight}px`,
                    "max-height": `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`,
                });
                setCssProps(preview, {
                    "min-height": `${targetHeight}px`,
                    height: `${targetHeight}px`,
                    "max-height": `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`,
                });
                setCssProps(wrap, "--learnkit-single-edit-height", `${targetHeight}px`);
            };
            const syncFieldHeights = () => {
                const textareaVisible = textarea.style.display !== "none";
                const renderedTextareaHeight = textareaVisible
                    ? Math.ceil(textarea.getBoundingClientRect().height || 0)
                    : lastSyncedHeight;
                const rawTargetHeight = Math.max(minControlHeight, renderedTextareaHeight || lastSyncedHeight);
                applyHeight(rawTargetHeight);
            };
            const captureRenderedEditorHeight = () => {
                if (textarea.style.display === "none")
                    return;
                const renderedHeight = Math.ceil(textarea.getBoundingClientRect().height || 0);
                const offsetHeight = Math.ceil(textarea.offsetHeight || 0);
                const inlineHeight = Math.ceil(Number.parseFloat(textarea.style.height || "0") || 0);
                const measured = Math.max(renderedHeight, offsetHeight, inlineHeight);
                if (measured > 0) {
                    applyHeight(measured);
                }
                else {
                    applyHeight(lastSyncedHeight);
                }
            };
            const renderPreview = () => {
                var _a;
                renderMarkdownPreviewInElement(preview, String((_a = textarea.value) !== null && _a !== void 0 ? _a : ""));
                applyHeight(lastSyncedHeight);
            };
            const showPreview = () => {
                if (!isEditing)
                    return;
                isEditing = false;
                captureRenderedEditorHeight();
                renderPreview();
                wrap.classList.add("is-preview");
                applyModeVisibility(false);
                if (document.activeElement === textarea)
                    textarea.blur();
            };
            const showEditor = () => {
                isEditing = true;
                wrap.classList.remove("is-preview");
                applyModeVisibility(true);
                textarea.focus();
                applyHeight(lastSyncedHeight);
            };
            const focusEditor = () => {
                var _a, _b;
                textarea.focus({ preventScroll: true });
                const valueLength = (_b = (_a = textarea.value) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
                textarea.setSelectionRange(valueLength, valueLength);
            };
            const activateEditFromPreview = () => {
                suppressOutsideCloseUntil = performance.now() + 180;
                allowEditorFocusUntil = performance.now() + 800;
                keepEditorFocusUntil = performance.now() + 350;
                showEditor();
                window.requestAnimationFrame(() => {
                    focusEditor();
                    window.setTimeout(() => {
                        focusEditor();
                    }, 0);
                });
            };
            const handleDocumentPointerDown = (ev) => {
                if (!isEditing)
                    return;
                if (performance.now() < suppressOutsideCloseUntil)
                    return;
                const target = ev.target;
                if (!(target instanceof Node))
                    return;
                if (wrap.contains(target))
                    return;
                showPreview();
            };
            document.addEventListener("pointerdown", handleDocumentPointerDown, true);
            registerCloseCleanup(() => {
                document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
            });
            preview.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0)
                    return;
                ev.preventDefault();
                ev.stopPropagation();
                activateEditFromPreview();
            }, true);
            preview.addEventListener("touchstart", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                activateEditFromPreview();
            }, { capture: true, passive: false });
            textarea.addEventListener("focus", () => {
                if (!isEditing && performance.now() > allowEditorFocusUntil) {
                    textarea.blur();
                    wrap.classList.add("is-preview");
                    applyModeVisibility(false);
                    return;
                }
                isEditing = true;
                wrap.classList.remove("is-preview");
                applyModeVisibility(true);
                setCssProps(wrap, "overflow", "visible");
                applyHeight(lastSyncedHeight);
            });
            textarea.addEventListener("blur", (ev) => {
                if (!isEditing)
                    return;
                const related = ev.relatedTarget;
                if (related instanceof Node && wrap.contains(related))
                    return;
                if (performance.now() < keepEditorFocusUntil) {
                    window.requestAnimationFrame(() => {
                        if (isEditing)
                            focusEditor();
                    });
                    return;
                }
                // Keep edit mode active on blur; exit is controlled by outside pointerdown only.
            });
            textarea.addEventListener("input", syncFieldHeights);
            textarea.addEventListener("keydown", (ev) => {
                if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && String(ev.key).toLowerCase() === "a") {
                    ev.stopPropagation();
                }
            });
            renderPreview();
            applyHeight(minControlHeight);
            wrap.classList.add("is-preview");
            setCssProps(wrap, "overflow", "hidden");
            applyModeVisibility(false);
            wrap.appendChild(textarea);
            wrap.appendChild(preview);
            return wrap;
        };
        /** Creates a label + textarea pair for an editable field. */
        const createEditableTextareaField = (label, field) => {
            const wrapper = document.createElement("div");
            wrapper.className = "flex flex-col gap-1 learnkit-card-meta-field";
            const labelEl = document.createElement("label");
            labelEl.className = "text-sm font-medium";
            labelEl.textContent = label;
            if (field === "question" && isClozeOnly) {
                labelEl.className = "text-sm font-medium inline-flex items-center gap-1";
                const infoIcon = document.createElement("span");
                infoIcon.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground learnkit-info-icon-elevated";
                infoIcon.setAttribute("aria-label", CLOZE_TOOLTIP);
                infoIcon.setAttribute("data-tooltip-position", "top");
                setIcon(infoIcon, "info");
                labelEl.appendChild(infoIcon);
            }
            wrapper.appendChild(labelEl);
            const textarea = document.createElement("textarea");
            textarea.className = "w-full learnkit-textarea-fixed";
            textarea.rows = 3;
            textarea.value = getSharedEditableFieldValue(cards, field);
            setCssProps(textarea, {
                resize: "vertical",
                "overflow-y": "auto",
            });
            textarea.addEventListener("keydown", (ev) => {
                handleTabInTextarea(textarea, ev);
            });
            // Single-card edit: show textarea while editing and rendered markdown on blur.
            if (isSingleEdit) {
                setCssProps(textarea, {
                    "min-height": "80px",
                    height: "80px",
                    "max-height": "80px",
                    resize: "none",
                });
                wrapper.appendChild(attachSingleEditBlurPreview(textarea, 80, 80));
            }
            else {
                wrapper.appendChild(attachFlagPreviewOverlay(textarea, fieldMinHeightPx(field), fieldMaxHeightPx(field)));
            }
            inputEls[field] = textarea;
            return wrapper;
        };
        /** Creates a label + disabled input pair for a read-only field. */
        const createReadonlyField = (label, value, inputClass = "") => {
            const wrapper = document.createElement("div");
            wrapper.className = "flex flex-col gap-1";
            const labelEl = document.createElement("label");
            labelEl.className = "text-sm font-medium";
            labelEl.textContent = label;
            wrapper.appendChild(labelEl);
            const input = document.createElement("input");
            input.type = "text";
            input.className = `bc input w-full ${inputClass}`.trim();
            input.value = value;
            input.disabled = true;
            wrapper.appendChild(input);
            return wrapper;
        };
        // ── Top metadata grid (read-only) ───────────────────────────────────────
        const topGrid = document.createElement("div");
        topGrid.className = "grid grid-cols-1 gap-3 md:grid-cols-2 learnkit-card-meta-grid";
        const card0 = cards[0];
        const state0 = plugin.store.getState(card0.id);
        topGrid.appendChild(createReadonlyField("ID", card0.id));
        // For basic/reversed cards, allow toggling between the two types
        const isBasicOrReversed = card0.type === "basic" || card0.type === "reversed";
        let selectedType = card0.type;
        if (isBasicOrReversed) {
            const typeWrapper = document.createElement("div");
            typeWrapper.className = "flex flex-col gap-1 learnkit-card-meta-field";
            const typeLabelEl = document.createElement("label");
            typeLabelEl.className = "text-sm font-medium";
            typeLabelEl.textContent = "Type";
            typeWrapper.appendChild(typeLabelEl);
            const typeDropdown = createThemedDropdown([
                { value: "basic", label: "Basic" },
                { value: "reversed", label: "Basic (Reversed)" },
            ], card0.type, undefined, {
                fullWidth: false,
                buttonSize: "sm",
                buttonJustify: "start",
                buttonClassName: "cursor-pointer learnkit-card-meta-type-btn",
            });
            typeDropdown.onChange((value) => { selectedType = value; });
            typeWrapper.appendChild(typeDropdown.element);
            topGrid.appendChild(typeWrapper);
        }
        else {
            topGrid.appendChild(createReadonlyField("Type", typeLabelBrowser(card0.type)));
        }
        topGrid.appendChild(createReadonlyField("Stage", stageLabel(String((state0 === null || state0 === void 0 ? void 0 : state0.stage) || "new"))));
        topGrid.appendChild(createReadonlyField("Due", state0 && Number.isFinite(state0.due) ? fmtDue(state0.due) : "—"));
        form.appendChild(topGrid);
        // ── Editable fields ───────────────────────────────────────────────────────
        form.appendChild(createEditableTextareaField("Title", "title"));
        form.appendChild(createEditableTextareaField("Question", "question"));
        // Answer field (only for non-cloze, skip for MCQ/OQ which have their own editors)
        if (hasNonCloze && !isSingleMcq && !isSingleOq) {
            form.appendChild(createEditableTextareaField("Answer", "answer"));
        }
        // ── MCQ-specific editor ─────────────────────────────────────────────────
        let mcqSection = null;
        const mcqOptionRows = [];
        if (isSingleMcq) {
            const mcqCard = cards[0];
            const options = normalizeCardOptions(mcqCard.options);
            const correctIdxSet = new Set(getCorrectIndices(mcqCard));
            mcqSection = document.createElement("div");
            mcqSection.className = "flex flex-col gap-2";
            const mcqLabel = document.createElement("label");
            mcqLabel.className = "text-sm font-medium inline-flex items-center gap-1";
            mcqLabel.textContent = "Answers and options";
            const mcqInfoIcon = document.createElement("span");
            mcqInfoIcon.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground learnkit-info-icon-elevated";
            mcqInfoIcon.setAttribute("aria-label", MCQ_TOOLTIP);
            mcqInfoIcon.setAttribute("data-tooltip-position", "top");
            setIcon(mcqInfoIcon, "info");
            mcqLabel.appendChild(mcqInfoIcon);
            mcqSection.appendChild(mcqLabel);
            const optionsContainer = document.createElement("div");
            optionsContainer.className = "flex flex-col gap-2";
            mcqSection.appendChild(optionsContainer);
            const updateRemoveButtons = () => {
                const disable = mcqOptionRows.length <= 2;
                for (const entry of mcqOptionRows) {
                    entry.removeBtn.disabled = disable;
                    entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
                    entry.removeBtn.classList.toggle("is-disabled", disable);
                }
            };
            const addOptionRow = (value, isCorrect) => {
                const row = document.createElement("div");
                row.className = "flex items-center gap-2 learnkit-edit-mcq-option-row";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = isCorrect;
                checkbox.className = "learnkit-mcq-correct-checkbox";
                checkbox.setAttribute("aria-label", this._tx("ui.cardEditor.mcq.markCorrect", "Mark as correct answer"));
                checkbox.setAttribute("data-tooltip-position", "top");
                row.appendChild(checkbox);
                const input = document.createElement("textarea");
                input.className = "textarea flex-1 text-sm learnkit-input-fixed learnkit-textarea-fixed";
                input.rows = 1;
                input.placeholder = "Enter an answer option";
                input.value = value;
                input.addEventListener("keydown", (ev) => {
                    if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        return;
                    }
                    handleTabInTextarea(input, ev);
                });
                row.appendChild(attachFlagPreviewOverlay(input, 36, 36));
                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "inline-flex items-center justify-center h-9 w-9 p-0 learnkit-remove-btn-ghost";
                removeBtn.setAttribute("aria-label", this._tx("ui.cardEditor.mcq.removeOption", "Remove option"));
                removeBtn.setAttribute("data-tooltip-position", "top");
                const xIcon = document.createElement("span");
                xIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
                setIcon(xIcon, "x");
                removeBtn.appendChild(xIcon);
                removeBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (mcqOptionRows.length <= 2)
                        return;
                    const idx = mcqOptionRows.findIndex((entry) => entry.input === input);
                    if (idx === -1)
                        return;
                    mcqOptionRows[idx].row.remove();
                    mcqOptionRows.splice(idx, 1);
                    updateRemoveButtons();
                });
                row.appendChild(removeBtn);
                optionsContainer.appendChild(row);
                mcqOptionRows.push({ row, input, checkbox, removeBtn });
                updateRemoveButtons();
            };
            // Seed with existing options
            for (let i = 0; i < options.length; i++) {
                addOptionRow(options[i] || "", correctIdxSet.has(i));
            }
            // Ensure at least 2 rows
            if (options.length < 2) {
                const seeded = options.length;
                if (seeded === 0) {
                    addOptionRow("", true);
                    addOptionRow("", false);
                }
                else if (seeded === 1) {
                    addOptionRow("", !correctIdxSet.has(0));
                }
            }
            // "Add another option" input
            const addInput = document.createElement("textarea");
            addInput.className = "textarea flex-1 text-sm learnkit-input-fixed learnkit-textarea-fixed";
            addInput.rows = 1;
            addInput.placeholder = "Add another option (press enter)";
            addInput.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const value = addInput.value.trim();
                    if (!value)
                        return;
                    addOptionRow(value, false);
                    addInput.value = "";
                    return;
                }
                handleTabInTextarea(addInput, ev);
            });
            addInput.addEventListener("blur", () => {
                const value = addInput.value.trim();
                if (!value)
                    return;
                addOptionRow(value, false);
                addInput.value = "";
            });
            const addInputWrap = document.createElement("div");
            addInputWrap.className = "flex items-center gap-2 learnkit-mcq-add-row";
            addInputWrap.appendChild(attachFlagPreviewOverlay(addInput, 36, 36));
            mcqSection.appendChild(addInputWrap);
            form.appendChild(mcqSection);
        }
        // ── OQ-specific editor (reorderable steps) ──────────────────────────────
        let oqListContainer = null;
        const oqStepRows = [];
        if (isSingleOq) {
            const oqCard = cards[0];
            const initialSteps = Array.isArray(oqCard.oqSteps) ? [...oqCard.oqSteps] : ["", ""];
            const oqSection = document.createElement("div");
            oqSection.className = "flex flex-col gap-2";
            const oqLabel = document.createElement("label");
            oqLabel.className = "text-sm font-medium inline-flex items-center gap-1";
            oqLabel.textContent = "Steps (correct order)";
            oqLabel.appendChild(Object.assign(document.createElement("span"), { className: "text-destructive", textContent: "*" }));
            const oqInfoIcon = document.createElement("span");
            oqInfoIcon.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground learnkit-info-icon-elevated";
            oqInfoIcon.setAttribute("aria-label", OQ_TOOLTIP);
            oqInfoIcon.setAttribute("data-tooltip-position", "top");
            setIcon(oqInfoIcon, "info");
            oqLabel.appendChild(oqInfoIcon);
            oqSection.appendChild(oqLabel);
            const oqHint = document.createElement("div");
            oqHint.className = "text-xs text-muted-foreground";
            oqHint.textContent = "Enter the steps in their correct order. Drag the grip handles to reorder. Steps are shuffled during review.";
            oqSection.appendChild(oqHint);
            oqListContainer = document.createElement("div");
            oqListContainer.className = "flex flex-col gap-2 learnkit-oq-editor-list";
            oqSection.appendChild(oqListContainer);
            const renumberOq = () => {
                oqStepRows.forEach((entry, i) => {
                    entry.badge.textContent = String(i + 1);
                });
            };
            const updateOqRemoveButtons = () => {
                const disable = oqStepRows.length <= 2;
                for (const entry of oqStepRows) {
                    const delBtn = entry.row.querySelector(".learnkit-oq-del-btn");
                    if (delBtn) {
                        delBtn.disabled = disable;
                        delBtn.setAttribute("aria-disabled", disable ? "true" : "false");
                        delBtn.classList.toggle("is-disabled", disable);
                    }
                }
            };
            const addOqStepRow = (value) => {
                const idx = oqStepRows.length;
                const row = document.createElement("div");
                row.className = "flex items-center gap-2 learnkit-oq-editor-row";
                row.draggable = false;
                // Drag grip
                const grip = document.createElement("span");
                grip.className = "inline-flex items-center justify-center text-muted-foreground cursor-grab learnkit-oq-grip";
                grip.draggable = true;
                setIcon(grip, "grip-vertical");
                row.appendChild(grip);
                // Number badge
                const badge = document.createElement("span");
                badge.className = "inline-flex items-center justify-center text-xs font-medium text-muted-foreground w-5 h-9 leading-none shrink-0";
                badge.textContent = String(idx + 1);
                row.appendChild(badge);
                // Text input
                const input = document.createElement("textarea");
                input.className = "textarea flex-1 text-sm learnkit-oq-step-input";
                input.rows = 1;
                input.placeholder = `Step ${idx + 1}`;
                input.value = value;
                setCssProps(input, {
                    "min-height": "36px",
                    height: "36px",
                    "max-height": "36px",
                });
                input.addEventListener("keydown", (ev) => {
                    if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        return;
                    }
                    handleTabInTextarea(input, ev);
                });
                row.appendChild(attachFlagPreviewOverlay(input, 36, 36));
                // Delete button
                const delBtn = document.createElement("button");
                delBtn.type = "button";
                delBtn.className = "inline-flex items-center justify-center p-0 learnkit-remove-btn-ghost learnkit-oq-del-btn";
                delBtn.setAttribute("aria-label", this._tx("ui.cardEditor.oq.removeStep", "Remove step"));
                delBtn.setAttribute("data-tooltip-position", "top");
                const xIcon = document.createElement("span");
                xIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
                setIcon(xIcon, "x");
                delBtn.appendChild(xIcon);
                delBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (oqStepRows.length <= 2)
                        return;
                    const pos = oqStepRows.findIndex((e) => e.input === input);
                    if (pos < 0)
                        return;
                    oqStepRows[pos].row.remove();
                    oqStepRows.splice(pos, 1);
                    renumberOq();
                    updateOqRemoveButtons();
                });
                row.appendChild(delBtn);
                // HTML5 DnD for reordering
                row.addEventListener("dragstart", (ev) => {
                    var _a;
                    (_a = ev.dataTransfer) === null || _a === void 0 ? void 0 : _a.setData("text/plain", String(oqStepRows.findIndex((e) => e.row === row)));
                    row.classList.add("learnkit-oq-row-dragging", "learnkit-oq-row-dragging");
                });
                row.addEventListener("dragend", () => {
                    row.classList.remove("learnkit-oq-row-dragging", "learnkit-oq-row-dragging");
                });
                row.addEventListener("dragover", (ev) => {
                    ev.preventDefault();
                    ev.dataTransfer.dropEffect = "move";
                });
                row.addEventListener("drop", (ev) => {
                    var _a;
                    ev.preventDefault();
                    const fromStr = (_a = ev.dataTransfer) === null || _a === void 0 ? void 0 : _a.getData("text/plain");
                    if (fromStr === undefined || fromStr === null)
                        return;
                    const fromIdx = parseInt(fromStr, 10);
                    const toIdx = oqStepRows.findIndex((e) => e.row === row);
                    if (isNaN(fromIdx) || fromIdx < 0 || toIdx < 0 || fromIdx === toIdx)
                        return;
                    const [moved] = oqStepRows.splice(fromIdx, 1);
                    oqStepRows.splice(toIdx, 0, moved);
                    oqListContainer.innerHTML = "";
                    for (const entry of oqStepRows)
                        oqListContainer.appendChild(entry.row);
                    renumberOq();
                });
                oqListContainer.appendChild(row);
                oqStepRows.push({ row, input, badge });
                updateOqRemoveButtons();
            };
            const seed = initialSteps.length >= 2 ? initialSteps : ["", ""];
            for (const s of seed)
                addOqStepRow(s);
            renumberOq();
            updateOqRemoveButtons();
            // "Add step" input
            const addOqRow = document.createElement("div");
            addOqRow.className = "flex items-center gap-2 learnkit-oq-add-row";
            const addOqInput = document.createElement("textarea");
            addOqInput.className = "textarea flex-1 text-sm learnkit-input-fixed learnkit-textarea-fixed";
            addOqInput.rows = 1;
            addOqInput.placeholder = "Add another step (press enter)";
            addOqInput.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const val = addOqInput.value.trim();
                    if (!val)
                        return;
                    if (oqStepRows.length >= 20) {
                        new Notice("Maximum 20 steps.");
                        return;
                    }
                    addOqStepRow(val);
                    renumberOq();
                    addOqInput.value = "";
                    return;
                }
                handleTabInTextarea(addOqInput, ev);
            });
            addOqInput.addEventListener("blur", () => {
                const val = addOqInput.value.trim();
                if (!val)
                    return;
                if (oqStepRows.length >= 20)
                    return;
                addOqStepRow(val);
                renumberOq();
                addOqInput.value = "";
            });
            addOqRow.appendChild(attachFlagPreviewOverlay(addOqInput, 36, 36));
            oqSection.appendChild(addOqRow);
            form.appendChild(oqSection);
        }
        // Extra information
        form.appendChild(createEditableTextareaField("Extra information", "info"));
        // ── Groups field (Basecoat tag picker) ────────────────────────────────────
        const groupsWrapper = document.createElement("div");
        groupsWrapper.className = "flex flex-col gap-1";
        const groupsLabel = document.createElement("label");
        groupsLabel.className = "text-sm font-medium";
        groupsLabel.textContent = "Groups";
        groupsWrapper.appendChild(groupsLabel);
        const createGroupPickerField = createGroupPickerFieldImpl;
        const groupField = createGroupPickerField(getSharedEditableFieldValue(cards, "groups"), cards.length, plugin);
        groupsWrapper.appendChild(groupField.element);
        groupsWrapper.appendChild(groupField.hiddenInput);
        inputEls["groups"] = groupField.hiddenInput;
        form.appendChild(groupsWrapper);
        // Location (read-only)
        form.appendChild(createReadonlyField("Location", fmtLocation(card0.sourceNotePath), "sprout-location-input"));
        contentEl.appendChild(form);
        // ── Footer buttons ────────────────────────────────────────────────────────
        const footer = document.createElement("div");
        footer.className = "flex items-center justify-end gap-4 lk-modal-footer learnkit-card-creator-footer";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "learnkit-btn-toolbar learnkit-btn-filter inline-flex items-center gap-2 h-9 px-3 text-sm";
        const cancelText = document.createElement("span");
        cancelText.textContent = "Cancel";
        cancel.appendChild(cancelText);
        const save = document.createElement("button");
        save.type = "button";
        save.className = "learnkit-btn-toolbar learnkit-btn-accent learnkit-bulk-edit-save-btn inline-flex items-center gap-2 h-9 px-3 text-sm";
        const saveIcon = document.createElement("span");
        saveIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
        setIcon(saveIcon, "check");
        const saveText = document.createElement("span");
        saveText.textContent = "Save";
        save.appendChild(saveIcon);
        save.appendChild(saveText);
        footer.appendChild(cancel);
        footer.appendChild(save);
        this.modalEl.appendChild(footer);
        cancel.addEventListener("click", () => this.close());
        // ── Save handler ──────────────────────────────────────────────────────────
        save.addEventListener("click", () => {
            void (async () => {
                var _a;
                const updates = {};
                // Collect editable field values
                for (const field of ["title", "question", "answer", "info", "groups"]) {
                    const el = inputEls[field];
                    if (!el)
                        continue;
                    const val = String((_a = el.value) !== null && _a !== void 0 ? _a : "").trim();
                    // In single-card edit mode, an empty text field means "clear this field".
                    // In multi-card bulk edit, empty means "leave existing values unchanged".
                    if (isSingleEdit && (field === "title" || field === "question" || field === "answer")) {
                        updates[field] = val;
                        continue;
                    }
                    // Optional fields should be cleared when empty
                    if (field === "info" || field === "groups") {
                        updates[field] = val;
                        continue;
                    }
                    if (val)
                        updates[field] = val;
                }
                // Handle MCQ if single MCQ selected
                if (isSingleMcq) {
                    const allOpts = mcqOptionRows
                        .map((entry) => ({ text: String(entry.input.value || "").trim(), isCorrect: entry.checkbox.checked }))
                        .filter((opt) => opt.text.length > 0);
                    const corrects = allOpts.filter((o) => o.isCorrect).map((o) => o.text);
                    const wrongs = allOpts.filter((o) => !o.isCorrect).map((o) => o.text);
                    if (corrects.length < 1) {
                        new Notice("At least one correct answer is required.");
                        return;
                    }
                    if (wrongs.length < 1) {
                        new Notice("Multiple-choice cards require at least one wrong option.");
                        return;
                    }
                    // Reconstruct legacy pipe-format answer string (bold = correct)
                    const rendered = allOpts.map((opt) => opt.isCorrect ? `**${escapePipes(opt.text)}**` : escapePipes(opt.text));
                    updates.answer = rendered.join(" | ");
                }
                // Handle OQ if single OQ selected
                let oqStepsResult = null;
                if (isSingleOq) {
                    const steps = oqStepRows.map((e) => String(e.input.value || "").trim()).filter(Boolean);
                    if (steps.length < 2) {
                        new Notice("Ordering requires at least 2 steps.");
                        return;
                    }
                    if (steps.length > 20) {
                        new Notice("Ordering supports a maximum of 20 steps.");
                        return;
                    }
                    oqStepsResult = steps;
                }
                if (!Object.keys(updates).length && !oqStepsResult && !(isBasicOrReversed && selectedType !== card0.type)) {
                    new Notice("Enter a value for at least one field.");
                    return;
                }
                try {
                    // Apply updates to card records
                    const updatedCards = [];
                    for (const card of cards) {
                        const updated = JSON.parse(JSON.stringify(card));
                        // Apply type change (only basic ↔ reversed)
                        if (isBasicOrReversed && selectedType !== updated.type) {
                            updated.type = selectedType;
                        }
                        if (updates.title !== undefined)
                            updated.title = updates.title;
                        if (updates.question !== undefined) {
                            if (updated.type === "basic" || updated.type === "reversed")
                                updated.q = updates.question;
                            else if (updated.type === "mcq")
                                updated.stem = updates.question;
                            else if (updated.type === "oq")
                                updated.q = updates.question;
                            else if (updated.type === "cloze")
                                updated.clozeText = updates.question;
                        }
                        if (oqStepsResult && updated.type === "oq") {
                            updated.oqSteps = oqStepsResult;
                        }
                        if (updates.answer !== undefined) {
                            if (updated.type === "basic" || updated.type === "reversed") {
                                updated.a = updates.answer;
                            }
                            else if (updated.type === "mcq") {
                                const parsed = parseMcqOptionsFromCell(updates.answer);
                                updated.options = parsed.options;
                                updated.correctIndex = parsed.correctIndex;
                            }
                        }
                        if (updates.info !== undefined)
                            updated.info = updates.info || null;
                        if (updates.groups !== undefined) {
                            const groups = parseGroupsInput(updates.groups);
                            updated.groups = groups.length ? groups : null;
                        }
                        updatedCards.push(updated);
                    }
                    await onSave(updatedCards);
                    this.close();
                }
                catch (err) {
                    new Notice(`${err instanceof Error ? err.message : String(err)}`);
                }
            })();
        });
    }
    onClose() {
        for (const fn of this.closeCleanup.splice(0)) {
            try {
                fn();
            }
            catch (_a) {
                // Best-effort teardown; avoid blocking modal close.
            }
        }
        this.contentEl.empty();
    }
}
// ── Convenience wrapper ────────────────────────────────────
/**
 * Creates and opens a BulkEditCardModal for the given cards.
 * Drop-in replacement for the old function-based overlay.
 */
export function openBulkEditModalForCards(plugin, cards, onSave) {
    if (!cards.length)
        return;
    const filtered = cards.filter((c) => !["io", "io-child"].includes(String(c.type || "")));
    if (!filtered.length)
        return;
    new BulkEditCardModal(plugin.app, plugin, filtered, onSave).open();
}
