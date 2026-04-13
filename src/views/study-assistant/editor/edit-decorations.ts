/**
 * @file src/views/study-assistant/editor/edit-decorations.ts
 * @summary CM6 extension that renders inline diff decorations for AI-proposed note edits.
 *
 * Shows each proposed change as:
 *  - Strikethrough + red-tinted background on the original text
 *  - A widget after the range showing the replacement text in green + ✓/✗ buttons
 *
 * Integrates with the assistant popup via StateEffects for dispatching
 * and clearing edit proposals.
 *
 * @exports
 *  - editDecorationExtension
 *  - setEditProposals
 *  - clearEditProposals
 *  - EditProposalEntry
 */

import {
  EditorView,
  Decoration,
  DecorationSet,
  WidgetType,
} from "@codemirror/view";
import { StateField, StateEffect, type Extension, type Range } from "@codemirror/state";
import { renderMarkdownPreviewInElement, setCssProps } from "../../../platform/core/ui";
import { t } from "../../../platform/translations/translator";

// ── Types ──

export type EditProposalEntry = {
  from: number;
  to: number;
  original: string;
  replacement: string;
};

// ── State effects ──

export const setEditProposals = StateEffect.define<EditProposalEntry[]>();
export const clearEditProposals = StateEffect.define<null>();
export const resolveEditProposal = StateEffect.define<{
  from: number;
  to: number;
  action: "accept" | "reject";
}>();

type ProposalRenderMode = "source" | "live-preview";

type SourceInlineContext = {
  textClasses?: string[];
};

const proposalModeObserverByRoot = new WeakMap<HTMLElement, MutationObserver>();

function disconnectProposalModeObserver(root: HTMLElement): void {
  const observer = proposalModeObserverByRoot.get(root);
  if (!observer) return;
  observer.disconnect();
  proposalModeObserverByRoot.delete(root);
}

function getProposalRenderMode(sourceViewEl: Element | null): ProposalRenderMode {
  return sourceViewEl?.classList.contains("is-live-preview") ? "live-preview" : "source";
}

function bindProposalContentToEditorMode(
  root: HTMLElement,
  contentEl: HTMLElement,
  view: EditorView,
  text: string,
): void {
  disconnectProposalModeObserver(root);

  const sourceViewEl = view.dom.closest(".markdown-source-view");
  const render = () => {
    const mode = getProposalRenderMode(sourceViewEl);
    renderProposalContent(root, contentEl, text, mode);
  };

  render();

  if (!sourceViewEl) return;

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName === "class") {
        render();
        return;
      }
    }
  });

  observer.observe(sourceViewEl, { attributes: true, attributeFilter: ["class"] });
  proposalModeObserverByRoot.set(root, observer);
}

function renderProposalContent(
  root: HTMLElement,
  contentEl: HTMLElement,
  text: string,
  mode: ProposalRenderMode,
): void {
  root.classList.toggle("is-source-mode", mode === "source");
  root.classList.toggle("is-live-preview-mode", mode === "live-preview");
  contentEl.classList.toggle("markdown-rendered", mode === "live-preview");
  contentEl.classList.toggle("learnkit-edit-proposal-source-fragment", mode === "source");

  if (mode === "live-preview") {
    renderMarkdownPreviewInElement(contentEl, text);
    return;
  }

  renderSourceProposalFragment(contentEl, text);
}

function renderSourceProposalFragment(contentEl: HTMLElement, text: string): void {
  const fragment = document.createDocumentFragment();
  const lines = text.split("\n");

  for (const line of lines) {
    fragment.appendChild(createSourceProposalLine(line));
  }

  contentEl.replaceChildren(fragment);
}

function createSourceProposalLine(line: string): HTMLElement {
  if (!line.length) {
    const emptyLine = createSourceProposalLineEl("cm-line learnkit-edit-proposal-source-line", "auto");
    emptyLine.appendChild(document.createElement("br"));
    return emptyLine;
  }

  const trimmed = line.trim();
  if (/^-{3,}$/.test(trimmed)) {
    const hrLine = createSourceProposalLineEl(
      "HyperMD-hr HyperMD-hr-bg cm-line learnkit-edit-proposal-source-line learnkit-edit-proposal-source-hr",
    );
    hrLine.appendChild(createSpan("cm-hr", trimmed));
    return hrLine;
  }

  const headingMatch = line.match(/^(#{1,6})(\s+)(.*)$/);
  if (headingMatch) {
    const [, hashes, spacing, body] = headingMatch;
    const level = hashes.length;
    const headerLine = createSourceProposalLineEl(
      `HyperMD-header HyperMD-header-${level} cm-line learnkit-edit-proposal-source-line`,
    );
    headerLine.appendChild(
      createSpan(
        `cm-formatting cm-formatting-header cm-formatting-header-${level} cm-header cm-header-${level}`,
        `${hashes}${spacing}`,
      ),
    );
    const contentWrap = createSourceContentWrap([`cm-header`, `cm-header-${level}`]);
    appendSourceInlineContent(contentWrap, body, { textClasses: [`cm-header`, `cm-header-${level}`] });
    headerLine.appendChild(contentWrap);
    return headerLine;
  }

  const listMatch = line.match(/^([\t ]*)([-+*]|\d+[.)])(\s+)(.*)$/);
  if (listMatch) {
    const [, indent, marker, spacing, body] = listMatch;
    const depth = getSourceListDepth(indent);
    const level = depth + 1;
    const isOrdered = /^\d/.test(marker);
    const listLine = createSourceProposalLineEl(
      `HyperMD-list-line HyperMD-list-line-${level} cm-line learnkit-edit-proposal-source-line learnkit-edit-proposal-source-list-line`,
    );

    if (depth > 0) {
      const indentWrap = document.createElement("span");
      indentWrap.className = `learnkit-edit-proposal-source-indent-spacer cm-hmd-list-indent cm-hmd-list-indent-${depth}`;
      setCssProps(indentWrap, {
        "--learnkit-edit-proposal-indent-width": `${depth * 32}px`,
      });
      indentWrap.appendChild(createSpan("cm-indent", "\t".repeat(depth)));
      listLine.appendChild(indentWrap);
    }

    listLine.appendChild(
      createSpan(
        `learnkit-edit-proposal-source-marker cm-formatting cm-formatting-list ${isOrdered ? "cm-formatting-list-ol" : "cm-formatting-list-ul"} cm-list-${level}`,
        `${marker}${spacing}`,
      ),
    );
    const contentWrap = createSourceContentWrap([`cm-list-${level}`]);
    appendSourceInlineContent(contentWrap, body, { textClasses: [`cm-list-${level}`] });
    listLine.appendChild(contentWrap);
    return listLine;
  }

  const plainLine = createSourceProposalLineEl("cm-line learnkit-edit-proposal-source-line");
  const contentWrap = createSourceContentWrap();
  appendSourceInlineContent(contentWrap, line);
  plainLine.appendChild(contentWrap);
  return plainLine;
}

function createSourceProposalLineEl(className: string, dir = "ltr"): HTMLElement {
  const lineEl = document.createElement("div");
  lineEl.className = className;
  lineEl.setAttribute("dir", dir);
  return lineEl;
}

function createSourceContentWrap(classes: string[] = []): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = joinClasses(["learnkit-edit-proposal-source-content", ...classes]);
  return wrap;
}

function getSourceListDepth(indent: string): number {
  const tabCount = indent.split("\t").length - 1;
  const spaceCount = indent.replace(/\t/g, "").length;
  return tabCount + Math.floor(spaceCount / 2);
}

function appendSourceInlineContent(parent: HTMLElement, text: string, context: SourceInlineContext = {}): void {
  const tokenRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<![\w\\])_(.+?)_(?![\w])|`([^`]+)`|~~(.+?)~~|==(.+?)==/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(text)) !== null) {
    appendSourceTextSegment(parent, text.slice(lastIndex, match.index), context.textClasses);

    if (match[1]) {
      const target = match[1];
      const display = match[2] || target;
      parent.appendChild(createSourceInternalLink(target, display));
    } else if (match[3] || match[4]) {
      appendWrappedSourceToken(parent, "**", match[3] ?? match[4] ?? "", context, "cm-strong");
    } else if (match[5] || match[6]) {
      appendWrappedSourceToken(parent, match[5] ? "*" : "_", match[5] ?? match[6] ?? "", context, "cm-em");
    } else if (match[7]) {
      appendWrappedSourceToken(parent, "`", match[7], context, "cm-inline-code");
    } else if (match[8]) {
      appendWrappedSourceToken(parent, "~~", match[8], context, "cm-strikethrough");
    } else if (match[9]) {
      appendWrappedSourceToken(parent, "==", match[9], context, "cm-highlight");
    }

    lastIndex = match.index + match[0].length;
  }

  appendSourceTextSegment(parent, text.slice(lastIndex), context.textClasses);
}

function appendWrappedSourceToken(
  parent: HTMLElement,
  token: string,
  content: string,
  context: SourceInlineContext,
  emphasisClass: string,
): void {
  const formattingClasses = joinClasses(["cm-formatting", ...context.textClasses ?? [], emphasisClass]);
  const contentClasses = joinClasses([...(context.textClasses ?? []), emphasisClass]);
  parent.appendChild(createSpan(formattingClasses, token));
  parent.appendChild(createSpan(contentClasses, content));
  parent.appendChild(createSpan(formattingClasses, token));
}

function appendSourceTextSegment(parent: HTMLElement, text: string, classes?: string[]): void {
  if (!text) return;
  if (!classes?.length) {
    parent.appendChild(document.createTextNode(text));
    return;
  }

  parent.appendChild(createSpan(joinClasses(classes), text));
}

function createSourceInternalLink(target: string, display: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "glossary-entry virtual-link virtual-link-span virtual-link-default";
  wrap.contentEditable = "false";

  const link = document.createElement("a");
  link.className = "internal-link virtual-link-a";
  link.href = "#";
  link.textContent = display;
  link.setAttribute("data-href", target);
  link.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  wrap.appendChild(link);
  return wrap;
}

function createSpan(className: string, text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function joinClasses(classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// ── Widget ──

/** Single-line edit: shows replacement text + ✓/✗ inline below the original */
class EditReplacementWidget extends WidgetType {
  constructor(
    readonly replacement: string,
    readonly from: number,
    readonly to: number,
    readonly original: string,
  ) {
    super();
  }

  eq(other: EditReplacementWidget): boolean {
    return this.from === other.from && this.to === other.to && this.replacement === other.replacement;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "learnkit-edit-proposal-widget";

    // Replacement text preview – render markdown so bold, links, lists etc. display naturally
    const replacementEl = document.createElement("span");
    replacementEl.className = "learnkit-edit-proposal-replacement";
    const previewText = this.replacement.length > 200
      ? `${this.replacement.slice(0, 200)}…`
      : this.replacement;
    bindProposalContentToEditorMode(wrap, replacementEl, view, previewText);
    wrap.appendChild(replacementEl);

    // Accept button
    const acceptBtn = document.createElement("button");
    acceptBtn.className = "learnkit-edit-proposal-action-btn is-accept";
    acceptBtn.type = "button";
    acceptBtn.textContent = "✓";
    acceptBtn.title = t("en", "ui.editProposal.accept", "Accept this change");
    acceptBtn.setAttribute("aria-label", t("en", "ui.editProposal.accept", "Accept this change"));
    acceptBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._accept(view);
    });
    wrap.appendChild(acceptBtn);

    // Reject button
    const rejectBtn = document.createElement("button");
    rejectBtn.className = "learnkit-edit-proposal-action-btn is-reject";
    rejectBtn.type = "button";
    rejectBtn.textContent = "✗";
    rejectBtn.title = t("en", "ui.editProposal.discard", "Discard this change");
    rejectBtn.setAttribute("aria-label", t("en", "ui.editProposal.discard", "Discard this change"));
    rejectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._reject(view);
    });
    wrap.appendChild(rejectBtn);

    return wrap;
  }

  private _accept(view: EditorView): void {
    // Apply the replacement
    view.dispatch({
      changes: { from: this.from, to: this.to, insert: this.replacement },
      effects: resolveEditProposal.of({ from: this.from, to: this.to, action: "accept" }),
    });
  }

  private _reject(view: EditorView): void {
    // Just remove the decoration without changing text
    view.dispatch({
      effects: resolveEditProposal.of({ from: this.from, to: this.to, action: "reject" }),
    });
  }

  ignoreEvent(): boolean {
    return false;
  }

  destroy(dom: HTMLElement): void {
    disconnectProposalModeObserver(dom);
  }
}

/** Multi-line / block edit: shows old content (red) + new content (green) as stacked blocks */
class EditBlockCompareWidget extends WidgetType {
  constructor(
    readonly replacement: string,
    readonly from: number,
    readonly to: number,
    readonly original: string,
  ) {
    super();
  }

  eq(other: EditBlockCompareWidget): boolean {
    return this.from === other.from && this.to === other.to
      && this.replacement === other.replacement && this.original === other.original;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "learnkit-edit-block-compare";

    // NEW block (green) — rendered markdown preview of the replacement
    const newBlock = document.createElement("div");
    newBlock.className = "learnkit-edit-block-new";
    bindProposalContentToEditorMode(wrap, newBlock, view, this.replacement);
    wrap.appendChild(newBlock);

    // Buttons row
    const btnRow = document.createElement("div");
    btnRow.className = "learnkit-edit-block-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "learnkit-edit-proposal-action-btn is-accept";
    acceptBtn.type = "button";
    acceptBtn.textContent = "✓";
    acceptBtn.title = t("en", "ui.editProposal.accept", "Accept this change");
    acceptBtn.setAttribute("aria-label", t("en", "ui.editProposal.accept", "Accept this change"));
    acceptBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.replacement },
        effects: resolveEditProposal.of({ from: this.from, to: this.to, action: "accept" }),
      });
    });
    btnRow.appendChild(acceptBtn);

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "learnkit-edit-proposal-action-btn is-reject";
    rejectBtn.type = "button";
    rejectBtn.textContent = "✗";
    rejectBtn.title = t("en", "ui.editProposal.discard", "Discard this change");
    rejectBtn.setAttribute("aria-label", t("en", "ui.editProposal.discard", "Discard this change"));
    rejectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        effects: resolveEditProposal.of({ from: this.from, to: this.to, action: "reject" }),
      });
    });
    btnRow.appendChild(rejectBtn);

    wrap.appendChild(btnRow);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }

  destroy(dom: HTMLElement): void {
    disconnectProposalModeObserver(dom);
  }
}

type EditProposalState = {
  entries: EditProposalEntry[];
  decorations: DecorationSet;
};

const editProposalField = StateField.define<EditProposalState>({
  create() {
    return { entries: [], decorations: Decoration.none };
  },

  update({ entries }, tr) {
    let updated = entries;

    for (const effect of tr.effects) {
      if (effect.is(setEditProposals)) {
        updated = effect.value;
      } else if (effect.is(clearEditProposals)) {
        updated = [];
      } else if (effect.is(resolveEditProposal)) {
        const { from, to } = effect.value;
        updated = updated.filter(e => !(e.from === from && e.to === to));
      }
    }

    // Remap positions through document changes (if user edits doc while proposals are pending)
    if (tr.docChanged && updated.length) {
      updated = updated
        .map(entry => {
          const newFrom = tr.changes.mapPos(entry.from, 1);
          const newTo = tr.changes.mapPos(entry.to, -1);
          if (newFrom >= newTo) return null; // Range collapsed, discard
          return { ...entry, from: newFrom, to: newTo };
        })
        .filter((e): e is EditProposalEntry => e !== null);
    }

    const decorations = (updated !== entries || tr.docChanged)
      ? buildDecorations(updated, tr.state.doc)
      : buildDecorations(updated, tr.state.doc);

    return { entries: updated, decorations };
  },

  provide(field) {
    return EditorView.decorations.from(field, (val) => val.decorations);
  },
});

// ── Decoration builder ──

function buildDecorations(entries: EditProposalEntry[], doc: import("@codemirror/state").Text): DecorationSet {
  if (!entries.length) return Decoration.none;

  const sorted = [...entries].sort((a, b) => a.from - b.from);
  const decorations: Range<Decoration>[] = [];

  for (const entry of sorted) {
    const isMultiLine = entry.original.includes("\n");

    if (isMultiLine) {
      // Multi-line edit (e.g. tables): highlight every original line with a red
      // background (preserving native CM6 markdown rendering), then show the
      // replacement in a green block widget below.
      const startLine = doc.lineAt(entry.from).number;
      const endLine = doc.lineAt(entry.to).number;
      for (let ln = startLine; ln <= endLine; ln++) {
        const lineStart = doc.line(ln).from;
        decorations.push(
          Decoration.line({ class: "learnkit-edit-proposal-original-line" }).range(lineStart),
        );
      }

      decorations.push(
        Decoration.widget({
          widget: new EditBlockCompareWidget(entry.replacement, entry.from, entry.to, entry.original),
          side: 1,
          block: true,
        }).range(doc.lineAt(entry.to).to),
      );
    } else {
      // Single-line edit: line highlight + inline widget below
      const startLine = doc.lineAt(entry.from).number;
      const endLine = doc.lineAt(entry.to).number;
      for (let ln = startLine; ln <= endLine; ln++) {
        const lineStart = doc.line(ln).from;
        decorations.push(
          Decoration.line({ class: "learnkit-edit-proposal-original-line" }).range(lineStart),
        );
      }

      decorations.push(
        Decoration.widget({
          widget: new EditReplacementWidget(entry.replacement, entry.from, entry.to, entry.original),
          side: 1,
          block: true,
        }).range(doc.lineAt(entry.to).to),
      );
    }
  }

  return Decoration.set(decorations, true);
}

// ── Public extension ──

export const editDecorationExtension: Extension = [
  editProposalField,
];
