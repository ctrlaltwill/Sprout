// src/card-editor/card-editor.ts
import { Notice, setIcon } from "obsidian";
import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
import { buildAnswerOrOptionsFor, escapePipes } from "../reviewer/fields";

export type ColKey =
  | "id"
  | "type"
  | "stage"
  | "due"
  | "title"
  | "question"
  | "answer"
  | "info"
  | "location"
  | "groups";

export type CardType = "basic" | "cloze" | "mcq" | "io";

const CLOZE_TOOLTIP =
  "Cloze syntax: {{c1::hidden text}}.\nNew cloze: Cmd+Shift+C (Ctrl+Shift+C).\nSame cloze #: Cmd+Shift+Option+C (Ctrl+Shift+Alt+C).";
const PLACEHOLDER_TITLE = "Flashcard title";
const PLACEHOLDER_CLOZE =
  "Example: This is a {{c1::cloze}} and this is the same {{c1::group}}. This {{c2::cloze}} is hidden separately.";
const PLACEHOLDER_QUESTION = "Write the question prompt";
const PLACEHOLDER_ANSWER = "Write the answer";
const PLACEHOLDER_INFO = "Extra information shown on the back to add context";

type ClozeShortcut = "new" | "same";

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "");
}

function getClozeShortcut(ev: KeyboardEvent): ClozeShortcut | null {
  const key = String(ev.key || "").toLowerCase();
  if (key !== "c" && ev.code !== "KeyC") return null;
  const primary = isMacLike() ? ev.metaKey : ev.ctrlKey;
  if (!primary || !ev.shiftKey) return null;
  return ev.altKey ? "same" : "new";
}

function getClozeIndices(text: string): number[] {
  const out: number[] = [];
  const re = /\{\{c(\d+)::/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text))) {
    const idx = Number(match[1]);
    if (Number.isFinite(idx)) out.push(idx);
  }
  return out;
}

function applyClozeShortcut(textarea: HTMLTextAreaElement, mode: ClozeShortcut) {
  const value = String(textarea.value ?? "");
  const start = Number.isFinite(textarea.selectionStart) ? (textarea.selectionStart) : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? (textarea.selectionEnd) : value.length;
  const indices = getClozeIndices(value);
  const maxIdx = indices.length ? Math.max(...indices) : 0;
  const lastIdx = indices.length ? indices[indices.length - 1] : maxIdx;
  const clozeIdx = mode === "same" ? (lastIdx || 1) : maxIdx + 1;

  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);

  if (selected.length > 0) {
    const wrapped = `{{c${clozeIdx}::${selected}}}`;
    textarea.value = before + wrapped + after;
    const pos = before.length + wrapped.length;
    textarea.setSelectionRange(pos, pos);
  } else {
    const token = `{{c${clozeIdx}::}}`;
    textarea.value = before + token + after;
    const pos = before.length + `{{c${clozeIdx}::`.length;
    textarea.setSelectionRange(pos, pos);
  }

  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function attachClozeShortcuts(textarea: HTMLTextAreaElement) {
  textarea.addEventListener("keydown", (ev: KeyboardEvent) => {
    const shortcut = getClozeShortcut(ev);
    if (!shortcut) return;
    ev.preventDefault();
    ev.stopPropagation();
    applyClozeShortcut(textarea, shortcut);
  });
}

function clearNode(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

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

function titleCaseGroupPath(path: string): string {
  const normalized = normalizeGroupPathInput(path);
  if (!normalized) return "";
  return normalized
    .split("/")
    .map((seg) => titleCaseSegment(seg))
    .filter(Boolean)
    .join("/");
}

function formatGroupDisplay(path: string): string {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return "";
  return canonical.split("/").join(" / ");
}

function expandGroupAncestors(path: string): string[] {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return [];
  const parts = canonical.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

function parseGroupsInput(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => titleCaseGroupPath(s.trim()))
    .filter(Boolean);
}

function groupsToInput(groups: any): string {
  if (!Array.isArray(groups)) return "";
  return groups
    .map((g) => titleCaseGroupPath(String(g).trim()))
    .filter(Boolean)
    .join(", ");
}

function escapePipeText(s: string): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function pushPipeField(out: string[], key: string, value: string) {
  const raw = String(value ?? "");
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0) {
    out.push(`${key} | |`);
    return;
  }
  if (lines.length === 1) {
    out.push(`${key} | ${escapePipeText(lines[0])} |`);
    return;
  }
  out.push(`${key} | ${escapePipeText(lines[0])}`);
  for (let i = 1; i < lines.length - 1; i++) out.push(escapePipeText(lines[i]));
  out.push(`${escapePipeText(lines[lines.length - 1])} |`);
}

interface CardEditorConfig {
  plugin: SproutPlugin;
  cards: CardRecord[];
  locationTitle?: string;
  locationPath?: string;
  showReadOnlyFields?: boolean;
  forceType?: CardType;
}

export interface CardEditorResult {
  root: HTMLElement;
  inputEls: Partial<Record<ColKey, HTMLInputElement | HTMLTextAreaElement>>;
  buildMcqValue?: () => string | null;
  getGroupInputValue: () => string;
  fields: Array<{ key: ColKey; editable: boolean }>;
  isSingleMcq: boolean;
  mcqOriginalString?: string;
  getMcqOptions?: () => { correct: string; wrongs: string[] };
}

export function createCardEditor(config: CardEditorConfig): CardEditorResult {
  const { cards, plugin } = config;
  const safeCards = Array.isArray(cards) ? cards : [];
  const normalizedTypes = safeCards.map((card) => String(card?.type ?? "").toLowerCase());
  if (!normalizedTypes.length && config.forceType) normalizedTypes.push(config.forceType);
  const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
  const hasMcq = normalizedTypes.some((type) => type === "mcq");
  const answerLabel = hasMcq ? "Answer / Options" : "Answer";
  const isClozeOnly = normalizedTypes.length > 0 && normalizedTypes.every((type) => type === "cloze");

  const isSingleMcq = safeCards.length === 1 && normalizedTypes[0] === "mcq";
  const showReadOnlyFields = config.showReadOnlyFields ?? true;

  const root = document.createElement("div");
  root.className = "bc flex flex-col gap-3";

  const formFields: Array<{ key: ColKey; label: string; editable: boolean }> = [];

  if (showReadOnlyFields) {
    formFields.push({ key: "id", label: "ID", editable: false });
    formFields.push({ key: "type", label: "Type", editable: false });
    formFields.push({ key: "location", label: "Location", editable: false });
    formFields.push({ key: "stage", label: "Stage", editable: false });
    formFields.push({ key: "due", label: "Due", editable: false });
  }

  formFields.push({ key: "title", label: "Title", editable: true });

  // Skip question/answer for IO cards
  const isIoCard = normalizedTypes.length === 1 && normalizedTypes[0] === "io";
  if (!isIoCard) {
    formFields.push({ key: "question", label: "Question", editable: true });
    if (hasNonCloze) {
      formFields.push({ key: "answer", label: answerLabel, editable: true });
    }
  }

  formFields.push({ key: "info", label: "Extra information", editable: true });
  formFields.push({ key: "groups", label: "Groups", editable: true });

  if (isSingleMcq) {
    const answerIdx = formFields.findIndex((f) => f.key === "answer");
    if (answerIdx >= 0) formFields.splice(answerIdx, 1);
  }

  const inputEls: Partial<Record<ColKey, HTMLInputElement | HTMLTextAreaElement>> = {};

  const sharedValue = (key: ColKey, predicate?: (card: CardRecord) => boolean) => {
    const matches = safeCards.filter((card) => (predicate ? predicate(card) : true));
    if (!matches.length) return "";
    const values = matches.map((card) => getFieldValue(card, key));
    const candidate = values[0];
    if (values.every((val) => val === candidate)) return candidate;
    return "";
  };

  const appendField = (field: { key: ColKey; label: string; editable: boolean }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "bc flex flex-col gap-1";

    const label = document.createElement("label");
    label.className = "bc text-sm font-medium";
    label.textContent = field.label;
    if (field.key === "question") {
      const required = document.createElement("span");
      required.className = "bc text-destructive ml-1";
      required.textContent = "*";
      label.appendChild(required);
    }
    if (field.key === "answer" && !isSingleMcq) {
      const required = document.createElement("span");
      required.className = "bc text-destructive ml-1";
      required.textContent = "*";
      label.appendChild(required);
    }
    if (field.key === "question" && isClozeOnly) {
      label.className = "bc text-sm font-medium inline-flex items-center gap-1";
      const infoIcon = document.createElement("span");
      infoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
      infoIcon.setAttribute("data-tooltip", CLOZE_TOOLTIP);
      infoIcon.style.position = "relative";
      infoIcon.style.zIndex = "1000001";
      infoIcon.style.transform = "scale(0.9)";
      setIcon(infoIcon, "info");
      label.appendChild(infoIcon);
    }
    wrapper.appendChild(label);

    if (field.key === "groups") {
      const groupField = createGroupPickerField(sharedValue(field.key), cards.length, plugin);
      wrapper.appendChild(groupField.element);
      wrapper.appendChild(groupField.hiddenInput);
      inputEls[field.key] = groupField.hiddenInput;
      root.appendChild(wrapper);
      return;
    }

    let input: HTMLInputElement | HTMLTextAreaElement;
    const predicate =
      field.key === "answer"
        ? (card: CardRecord) => String(card.type ?? "").toLowerCase() !== "cloze"
        : undefined;
    const value = sharedValue(field.key, predicate);

    if (field.editable && ["title", "question", "answer", "info"].includes(field.key)) {
      const textarea = document.createElement("textarea");
      textarea.className = "bc textarea w-full";
      textarea.rows = 3;
      textarea.value = value;
      textarea.style.resize = "none";
      textarea.style.minHeight = "80px";
      if (field.key === "title") textarea.placeholder = PLACEHOLDER_TITLE;
      if (field.key === "question") textarea.placeholder = isClozeOnly ? PLACEHOLDER_CLOZE : PLACEHOLDER_QUESTION;
      if (field.key === "answer") textarea.placeholder = PLACEHOLDER_ANSWER;
      if (field.key === "info") textarea.placeholder = PLACEHOLDER_INFO;
      input = textarea;
    } else {
      const txt = document.createElement("input");
      txt.type = "text";
      txt.className = "bc input w-full";
      txt.value = value;
      txt.disabled = !field.editable;
      input = txt;
    }

    if (cards.length > 1 && field.editable) {
      const overwriteNotice = document.createElement("div");
      overwriteNotice.className = "bc text-xs text-muted-foreground";
      const cardCount = cards.length;
      const cardLabel = cardCount === 1 ? "card" : "cards";
      overwriteNotice.textContent = `You have selected ${cardCount} ${cardLabel}. Any input in this field will overwrite all ${cardCount} ${cardLabel}. To leave all cards in their current form, leave this field blank.`;
      overwriteNotice.style.display = "none";

      const updateOverwriteNotice = () => {
        const value = String(input.value ?? "").trim();
        overwriteNotice.style.display = value.length ? "" : "none";
      };
      input.addEventListener("input", updateOverwriteNotice);
      updateOverwriteNotice();
      wrapper.appendChild(overwriteNotice);
    }

    wrapper.appendChild(input);
    inputEls[field.key] = input;
    if (field.key === "question" && input instanceof HTMLTextAreaElement && isClozeOnly) {
      attachClozeShortcuts(input);
    }
    root.appendChild(wrapper);
  };

  formFields.forEach(appendField);

  let buildMcqValue: (() => string | null) | undefined;
  let getMcqOptions: (() => { correct: string; wrongs: string[] }) | undefined;
  if (isSingleMcq) {
    const mcqSection = createMcqEditor(safeCards[0]);
    if (mcqSection) {
      root.appendChild(mcqSection.element);
      buildMcqValue = mcqSection.buildValue;
      getMcqOptions = mcqSection.getOptions;
    }
  }

  return {
    root,
    inputEls,
    buildMcqValue,
    getMcqOptions,
    getGroupInputValue: () => {
      const el = inputEls.groups;
      return el ? (el.value ?? "") : "";
    },
    fields: formFields.map((field) => ({ key: field.key, editable: field.editable })),
    isSingleMcq,
    mcqOriginalString: isSingleMcq ? buildAnswerOrOptionsFor(safeCards[0]) : undefined,
  };
}

function getFieldValue(card: CardRecord, key: ColKey): string {
  switch (key) {
    case "id":
      return String(card.id);
    case "type":
      return String(card.type ?? "");
    case "stage":
      return String((card as any).stage ?? "");
    case "due":
      return String((card as any).due ?? "");
    case "title":
      return (card.title || "").split(/\r?\n/)[0] || "";
    case "question":
      if (card.type === "basic") return card.q || "";
      if (card.type === "mcq") return card.stem || "";
      return card.clozeText || "";
    case "answer":
      if (card.type === "basic") return card.a || "";
      if (card.type === "mcq") {
        const options = Array.isArray(card.options) ? card.options : [];
        const correct = Number.isFinite(card.correctIndex) ? (card.correctIndex as number) : -1;
        return options
          .map((opt, idx) => {
            const t = escapePipes((opt || "").trim());
            return idx === correct ? `**${t}**` : t;
          })
          .join(" | ");
      }
      return "";
    case "info":
      return card.info || "";
    case "location":
      return String(card.sourceNotePath || "");
    case "groups":
      return (card as any).groups
        ? Array.isArray((card as any).groups)
          ? (card as any).groups.join(", ")
          : String((card as any).groups)
        : "";
    default:
      return "";
  }
}

export function createGroupPickerField(initialValue: string, cardsCount: number, plugin: SproutPlugin) {
  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.value = initialValue;

  const container = document.createElement("div");
  container.className = "bc relative";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "4px";

  const tagBox = document.createElement("div");
  tagBox.className = "bc textarea w-full";
  tagBox.style.height = `38px`;
  tagBox.style.minHeight = `38px`;
  tagBox.style.maxHeight = `38px`;
  tagBox.style.overflow = "auto";
  tagBox.style.padding = "6px 8px";
  tagBox.style.boxSizing = "border-box";
  tagBox.style.display = "flex";
  tagBox.style.flexWrap = "wrap";
  tagBox.style.columnGap = "6px";
  tagBox.style.rowGap = "2px";
  tagBox.style.alignContent = "flex-start";
  container.appendChild(tagBox);

  let overwriteNotice: HTMLDivElement | null = null;
  if (cardsCount > 1) {
    overwriteNotice = document.createElement("div");
    overwriteNotice.className = "bc text-xs text-muted-foreground";
    overwriteNotice.textContent =
      "Typing here will overwrite this field for every selected card; leave it blank to keep existing values.";
    overwriteNotice.style.display = "none";
    container.appendChild(overwriteNotice);
  }

  let selected = parseGroupsInput(initialValue);

  const optionSet = new Set<string>();
  for (const c of plugin.store.getAllCards() || []) {
    const groups = Array.isArray((c as any)?.groups) ? (c as any).groups : [];
    for (const g of groups.map((path: any) => titleCaseGroupPath(String(path).trim())).filter(Boolean)) {
      for (const ancestor of expandGroupAncestors(g)) optionSet.add(ancestor);
    }
  }
  let allOptions = Array.from(optionSet).sort((a, b) =>
    formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
  );

  const list = document.createElement("div");
  list.className = "bc flex flex-col max-h-60 overflow-auto p-1";

  const searchWrap = document.createElement("div");
  searchWrap.className = "bc flex items-center gap-1 border-b border-border pl-1 pr-0";
  searchWrap.style.width = "100%";

  const searchIcon = document.createElement("span");
  searchIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
  searchIcon.setAttribute("aria-hidden", "true");
  setIcon(searchIcon, "search");
  searchWrap.appendChild(searchIcon);

  const search = document.createElement("input");
  search.type = "text";
  search.className = "bc bg-transparent text-sm flex-1 h-9";
  search.style.minWidth = "0";
  search.style.width = "100%";
  search.style.border = "none";
  search.style.boxShadow = "none";
  search.style.outline = "none";
  search.placeholder = "Search or add group";
  searchWrap.appendChild(search);

  const panel = document.createElement("div");
  panel.className = "bc rounded-lg border border-border bg-popover text-popover-foreground p-0 flex flex-col";
  panel.style.pointerEvents = "auto";
  panel.appendChild(searchWrap);
  panel.appendChild(list);

  const popover = document.createElement("div");
  popover.style.position = "absolute";
  popover.style.bottom = "calc(100% + 6px)";
  popover.style.left = "0";
  popover.style.right = "auto";
  popover.style.zIndex = "10000";
  popover.style.width = "100%";
  popover.style.display = "none";
  popover.style.pointerEvents = "auto";
  popover.setAttribute("aria-hidden", "true");
  popover.appendChild(panel);
  container.appendChild(popover);

  const renderBadges = () => {
    clearNode(tagBox);
    if (!selected.length) {
      const placeholder = document.createElement("span");
      placeholder.className = "bc badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6";
      placeholder.textContent = "No groups";
      placeholder.style.display = "inline-flex";
      placeholder.style.color = "#fff";
      tagBox.appendChild(placeholder);
      return;
    }
    for (const tag of selected) {
      const badge = document.createElement("span");
      badge.className = "bc badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6";
      badge.style.display = "inline-flex";

      const txt = document.createElement("span");
      txt.textContent = formatGroupDisplay(tag);
      badge.appendChild(txt);

      const removeBtn = document.createElement("span");
      removeBtn.className =
        "bc ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white";
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = selected.filter((t) => t !== tag);
        renderBadges();
        renderList();
        commit();
      });
      badge.appendChild(removeBtn);
      tagBox.appendChild(badge);
    }
  };

  const updateOverwriteNotice = () => {
    const value = groupsToInput(selected).trim();
    if (overwriteNotice) overwriteNotice.style.display = cardsCount > 1 && value ? "" : "none";
  };

  const commit = () => {
    hiddenInput.value = groupsToInput(selected);
    updateOverwriteNotice();
  };

  const toggleTag = (tag: string) => {
    const next = titleCaseGroupPath(tag);
    if (!next) return;
    if (selected.includes(next)) selected = selected.filter((t) => t !== next);
    else selected = [...selected, next];
    renderBadges();
    renderList();
    commit();
  };

  const renderList = () => {
    clearNode(list);
    const raw = search.value.trim();
    const rawTitle = titleCaseGroupPath(raw);
    const rawDisplay = formatGroupDisplay(rawTitle);
    const q = raw.toLowerCase();
    const options = allOptions.filter((t) => formatGroupDisplay(t).toLowerCase().includes(q));
    const exact =
      raw && allOptions.some((t) => formatGroupDisplay(t).toLowerCase() === rawDisplay.toLowerCase());

    const addRow = (label: string, value: string, isAdd = false) => {
      const row = document.createElement("div");
      row.setAttribute("role", "menuitem");
      row.setAttribute("aria-checked", selected.includes(value) ? "true" : "false");
      row.tabIndex = 0;
      row.className =
        "bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";

      const text = document.createElement("span");
      text.textContent = label;
      row.appendChild(text);

      if (selected.includes(value) && !isAdd) {
        const check = document.createElement("span");
        check.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
        setIcon(check, "check");
        row.appendChild(check);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "bc inline-flex items-center justify-center [&_svg]:size-3 opacity-0";
        setIcon(spacer, "check");
        row.appendChild(spacer);
      }

      const handleActivate = () => {
        if (isAdd) {
          const next = titleCaseGroupPath(value);
          toggleTag(next);
          if (next) {
            allOptions = Array.from(new Set([...allOptions, next])).sort((a, b) =>
              formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
            );
          }
          search.value = "";
          renderList();
          return;
        }
        toggleTag(value);
      };

      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        handleActivate();
      });
      row.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          handleActivate();
        }
      });

      list.appendChild(row);
    };

    if (raw && !exact) addRow(`Add “${rawDisplay || rawTitle}”`, rawTitle || raw, true);
    if (allOptions.length === 0 && !raw && selected.length === 0) {
      list.style.maxHeight = "none";
      list.style.overflow = "visible";
      const empty = document.createElement("div");
      empty.className = "bc px-2 py-2 text-sm text-muted-foreground whitespace-normal break-words";
      empty.textContent = "Type a keyword above to save this flashcard to a group.";
      list.appendChild(empty);
      return;
    }

    for (const opt of options) addRow(formatGroupDisplay(opt), opt);
  };

  const commitSearch = () => {
    const raw = search.value.trim();
    if (!raw) return;
    toggleTag(raw);
    search.value = "";
    renderList();
  };

  search.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      commitSearch();
    }
  });

  search.addEventListener("blur", () => {
    commitSearch();
  });

  const openPopover = () => {
    renderList();
    popover.setAttribute("aria-hidden", "false");
    popover.style.display = "block";
  };

  const closePopover = () => {
    popover.setAttribute("aria-hidden", "true");
    popover.style.display = "none";
  };

  renderBadges();
  renderList();

  document.addEventListener("pointerdown", (ev) => {
    if (!container.contains(ev.target as Node)) closePopover();
  });

  container.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openPopover();
  });

  return {
    element: container,
    hiddenInput,
  };
}

function createMcqEditor(card: CardRecord) {
  const options = Array.isArray(card.options) ? [...card.options] : [];
  const correctIndex: number = Number.isFinite(card.correctIndex) ? (card.correctIndex as number) : 0;
  const correctValue = options[correctIndex] ?? "";
  const wrongValues = options.filter((_, idx) => idx !== correctIndex);

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
  correctInput.value = correctValue;
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

  const wrongRows: Array<{ row: HTMLElement; input: HTMLInputElement; removeBtn: HTMLButtonElement }> = [];

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
    xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
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
    });
    row.appendChild(removeBtn);
    wrongContainer.appendChild(row);
    wrongRows.push({ row, input, removeBtn });
    updateRemoveButtons();
  };

  const updateRemoveButtons = () => {
    const disable = wrongRows.length <= 1;
    for (const entry of wrongRows) {
      entry.removeBtn.disabled = disable;
      entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
      entry.removeBtn.style.setProperty("opacity", disable ? "0.35" : "1", "important");
      entry.removeBtn.style.cursor = disable ? "default" : "pointer";
    }
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

  const initialWrongs = wrongValues.length ? wrongValues : [""];
  for (const value of initialWrongs) addWrongRow(value);
  updateRemoveButtons();

  const buildValue = () => {
    const correct = correctInput.value.trim();
    if (!correct) {
      new Notice("Correct MCQ answer cannot be empty.");
      return null;
    }
    const wrongs = wrongRows.map((entry) => entry.input.value.trim()).filter((opt) => opt.length > 0);
    if (wrongs.length < 1) {
      new Notice("MCQ requires at least one wrong option.");
      return null;
    }
    const optionsList = [correct, ...wrongs];
    const rendered = optionsList.map((opt, idx) => (idx === 0 ? `**${escapePipeText(opt)}**` : escapePipeText(opt)));
    return rendered.join(" | ");
  };

  const getOptions = () => ({
    correct: String(correctInput.value || "").trim(),
    wrongs: wrongRows.map((entry) => String(entry.input.value || "").trim()).filter(Boolean),
  });

  return {
    element: container,
    buildValue,
    getOptions,
  };
}
