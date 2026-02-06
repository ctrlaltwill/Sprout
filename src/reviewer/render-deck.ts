// src/reviewer/renderDeck.ts
import type { App } from "obsidian";
import { setIcon } from "obsidian";
import { el } from "../core/ui";
import { buildDeckTree, type DeckNode } from "../deck/deck-tree";
import type SproutPlugin from "../main";
import type { Scope } from "./image-occlusion-types";
import { getGroupIndex, normaliseGroupPath } from "../indexes/group-index";
import { log } from "../core/logger";

type Args = {
  app: App;
  plugin: SproutPlugin;

  container: HTMLElement;

  expanded: Set<string>;
  setExpanded: (s: Set<string>) => void;

  openSession: (scope: Scope) => void;
  resyncActiveFile: () => Promise<void>;

  rerender: () => void;
};

function clearNode(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function prettifyGroupLabel(groupPath: string) {
  return groupPath.split("/").join(" / ");
}

function ensureBasecoatStartedOnce() {
  const bc = window?.basecoat;
  if (!bc) return;

  if (window.__bc_bootcamp_started) return;

  try {
    if (typeof bc.start === "function") bc.start();
  } catch {
    // ignore
  }

  window.__bc_bootcamp_started = true;
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
    .map((seg) => titleCaseSegment(seg.trim()))
    .filter(Boolean)
    .join("/");
}

function expandGroupAncestors(path: string): string[] {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return [];
  const parts = canonical.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

function makeIconButton(opts: {
  icon: string;
  label: string;
  title?: string;
  className?: string;
  labelClassName?: string;
  iconClassName?: string;
  onClick: () => void;
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className || "btn-outline";
  btn.title = opts.title || "";
  btn.setAttribute("aria-label", opts.label);

  const iconWrap = document.createElement("span");
  iconWrap.className = `inline-flex items-center justify-center${opts.iconClassName ? ` ${opts.iconClassName}` : ""}`;
  setIcon(iconWrap, opts.icon);
  iconWrap.querySelector("svg")?.classList.add("bc", "shrink-0");
  btn.appendChild(iconWrap);

  const text = document.createElement("span");
  text.textContent = opts.label;
  text.className = opts.labelClassName ?? "ml-2";
  btn.appendChild(text);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    opts.onClick();
  });

  return btn;
}

function makeIconOnlyButton(opts: {
  icon: string;
  label: string;
  title?: string;
  className?: string;
  onClick: () => void;
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className || "btn-icon-outline";
  btn.title = opts.title || "";
  btn.setAttribute("aria-label", opts.label);

  const iconWrap = document.createElement("span");
  iconWrap.className = "inline-flex items-center justify-center";
  setIcon(iconWrap, opts.icon);
  iconWrap.querySelector("svg")?.classList.add("bc", "shrink-0");
  btn.appendChild(iconWrap);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });

  return btn;
}

function makeDisclosureChevron(isOpen: boolean, onToggle: () => void) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "sprout-deck-disclosure inline-flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:text-foreground";
  btn.style.setProperty("border", "none", "important");
  btn.style.setProperty("background", "transparent", "important");
  btn.style.setProperty("box-shadow", "none", "important");
  btn.style.setProperty("padding", "0", "important");
  btn.style.setProperty("width", "28px", "important");
  btn.style.setProperty("height", "28px", "important");
  btn.style.setProperty("min-width", "28px", "important");
  btn.style.setProperty("min-height", "28px", "important");
  btn.setAttribute("aria-label", isOpen ? "Collapse folder" : "Expand folder");
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  btn.dataset.open = isOpen ? "true" : "false";

  const iconWrap = document.createElement("span");
  iconWrap.className = "sprout-deck-expand-icon inline-flex items-center justify-center [&_svg]:size-4";
  const renderIcon = (open: boolean) => {
    iconWrap.innerHTML = "";
    setIcon(iconWrap, open ? "minus" : "plus");
    iconWrap.querySelector("svg")?.classList.add("bc");
  };
  renderIcon(isOpen);
  btn.appendChild(iconWrap);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  });

  return btn;
}

function makeBadge(label: string, value: number, variant: "outline" | "secondary" = "outline") {
  const wrap = document.createElement("span");
  wrap.className = "inline-flex items-center";

  const badge = document.createElement("span");
  badge.className = variant === "secondary" ? "badge-secondary" : "badge-outline";

  const lab = document.createElement("span");
  lab.className = "text-xs text-muted-foreground";
  lab.textContent = label;

  const val = document.createElement("span");
  val.className = "ml-2 font-medium";
  val.textContent = String(value);

  badge.appendChild(lab);
  badge.appendChild(val);
  wrap.appendChild(badge);
  return wrap;
}

export function renderDeckMode(args: Args) {
  const { app, plugin, container } = args;

  ensureBasecoatStartedOnce();

  const animationsEnabled = plugin.settings?.appearance?.enableAnimations ?? true;
  const shouldAnimateOnce = animationsEnabled && container.dataset.deckBrowserAosOnce !== "1";
  const applyAos = (el: HTMLElement, delay?: number, animation = "fade-up") => {
    if (!shouldAnimateOnce) return;
    el.setAttribute("data-aos", animation);
    if (Number.isFinite(delay)) el.setAttribute("data-aos-delay", String(delay));
  };

  const now = Date.now();
  const cards = plugin.store.getAllCards();
  const states = plugin.store.data.states || {};
  const vaultName = app?.vault?.getName?.() || "Vault";

  const root = document.createElement("div");
  root.className = "flex flex-col min-h-0";
  root.style.gap = "10px";

  const title = document.createElement("div");
  title.className = "text-xl font-semibold tracking-tight";
  applyAos(title, 0);
  title.textContent = "Deck Browser";
  root.appendChild(title);

  // Tree early (needed for badges + expand/collapse all)
  const tree: DeckNode = buildDeckTree(cards, states, now, vaultName);

  const collectFolderKeys = (node: DeckNode, out: Set<string>) => {
    for (const child of node.children.values()) {
      if (child.type === "folder") {
        out.add(child.key);
        if (child.children.size) collectFolderKeys(child, out);
      }
    }
  };

  // ===== Header (badges -> controls -> table) =====
  const header = document.createElement("div");
  header.className = "flex flex-col gap-2";
  applyAos(header, 200);
  header.style.flex = "0 0 auto";
  root.appendChild(header);

  // Controls row
  const controlsRow = document.createElement("div");
  controlsRow.className = "flex flex-row flex-wrap items-center gap-2";
  header.appendChild(controlsRow);

  const studyAllBtn = makeIconButton({
    icon: "play",
    label: "Study all",
    title: "Start a vault-wide session",
    className: "btn-outline h-9 w-full md:w-auto flex items-center gap-2 equal-height-btn",
    labelClassName: "",
    iconClassName: "sprout-deck-control-icon",
    onClick: () => args.openSession({ type: "vault", key: "", name: vaultName }),
  });
  studyAllBtn.style.setProperty("padding", "7px 15px", "important");

  // ===== Group combobox (single select) =====
  const gx = getGroupIndex(plugin);

  const groupCombo = document.createElement("div");
  groupCombo.className = "relative w-full md:w-auto";
  groupCombo.style.flex = "0 1 auto";

  const comboTrigger = document.createElement("button");
  comboTrigger.type = "button";
  comboTrigger.className = "btn-outline h-9 w-full md:w-auto inline-flex items-center gap-2 equal-height-btn";
  comboTrigger.setAttribute("aria-haspopup", "listbox");
  comboTrigger.setAttribute("aria-expanded", "false");

  const comboIcon = document.createElement("span");
  comboIcon.className = "sprout-deck-control-icon inline-flex items-center justify-center";
  setIcon(comboIcon, "tag");
  comboTrigger.appendChild(comboIcon);

  const comboLabel = document.createElement("span");
  comboLabel.className = "truncate";
  comboLabel.textContent = "Study group";
  comboTrigger.appendChild(comboLabel);
  comboTrigger.style.setProperty("padding", "7px 15px", "important");
  // Trigger will live inside a button-group wrapper

  const popover = document.createElement("div");
  popover.className = "sprout-group-select-popover sprout-dropdown-shadow rounded-lg border border-border bg-popover text-popover-foreground";
  popover.style.position = "absolute";
  popover.style.left = "0";
  popover.style.top = "calc(100% + 6px)";
  popover.style.width = "360px";
  popover.style.zIndex = "1000";
  popover.style.display = "none";
  popover.style.overflow = "hidden";

  const popHeader = document.createElement("div");
  popHeader.className = "sprout-group-select-header flex items-center gap-2 border-b border-border";
  popover.appendChild(popHeader);

  const searchSvgHost = document.createElement("span");
  searchSvgHost.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
  setIcon(searchSvgHost, "search");
  popHeader.appendChild(searchSvgHost);

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search groups…";
  searchInput.autocomplete = "off";
  searchInput.setAttribute("autocorrect", "off");
  searchInput.spellcheck = false;
  searchInput.className = "sprout-group-search-input text-sm flex-1 h-9";
  searchInput.style.minWidth = "0";
  popHeader.appendChild(searchInput);

  const listbox = document.createElement("div");
  listbox.className = "flex flex-col max-h-60 overflow-auto p-1";
  listbox.setAttribute("role", "listbox");
  popover.appendChild(listbox);

  const getAllGroups = (): string[] => {
    try {
      return gx.getAllGroups();
    } catch {
      // ignore
    }

    // Fallback: derive from cards (best-effort)
    const out = new Set<string>();
    for (const c of cards) {
      if (Array.isArray(c.groups)) for (const g of c.groups) if (typeof g === "string" && g) out.add(g);
    }
    return Array.from(out);
  };

  const allOptions = Array.from(
    new Set(
      getAllGroups()
        .map((g) => normaliseGroupPath(String(g)) || String(g))
        .filter(Boolean)
        .flatMap((g) => expandGroupAncestors(g)),
    ),
  )
    .map((g) => titleCaseGroupPath(g))
    .filter(Boolean)
    .sort((a, b) => prettifyGroupLabel(a).localeCompare(prettifyGroupLabel(b)));

  const renderList = () => {
    clearNode(listbox);
    const q = searchInput.value.trim().toLowerCase();
    const options = allOptions.filter((t) => prettifyGroupLabel(t).toLowerCase().includes(q));

    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "px-2 py-2 text-sm text-muted-foreground";
      empty.textContent = "No groups found.";
      listbox.appendChild(empty);
      return;
    }

    const studyAllRow = document.createElement("div");
    studyAllRow.setAttribute("role", "option");
    studyAllRow.className =
      "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";
    const studyAllSpan = document.createElement("span");
    studyAllSpan.textContent = "Study all";
    studyAllSpan.className = "text-muted-foreground";
    studyAllRow.appendChild(studyAllSpan);
    studyAllRow.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      comboLabel.textContent = "Study all";
      comboTrigger.setAttribute("aria-expanded", "false");
      closePopover();
      args.openSession({ type: "vault", key: "", name: vaultName });
    });
    listbox.appendChild(studyAllRow);

    const limitedOptions = options.slice(0, 5);
    for (const tag of limitedOptions) {
      const row = document.createElement("div");
      row.setAttribute("role", "option");
      row.className =
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";

      const text = document.createElement("span");
      text.textContent = prettifyGroupLabel(tag);
      row.appendChild(text);

      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        comboLabel.textContent = prettifyGroupLabel(tag);
        comboTrigger.setAttribute("aria-expanded", "false");
        closePopover();
        args.openSession({ type: "group", key: tag, name: tag });
      });

      listbox.appendChild(row);
    }
  };

  let cleanup: (() => void) | null = null;

  const closePopover = () => {
    popover.style.display = "none";
    comboTrigger.setAttribute("aria-expanded", "false");
    try {
      cleanup?.();
    } catch (e) { log.swallow("render-deck closePopover cleanup", e); }
    cleanup = null;
  };

  const openPopover = () => {
    popover.style.display = "block";
    comboTrigger.setAttribute("aria-expanded", "true");
    renderList();
    searchInput.focus();

    const onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (groupCombo.contains(t)) return;
      closePopover();
    };
    const onDocKeydown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      closePopover();
    };

    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeydown, true);

    cleanup = () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };
  };

  comboTrigger.addEventListener("pointerdown", (ev) => {
    if ((ev).button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    openPopover();
  });

  searchInput.addEventListener("input", () => {
    renderList();
    const value = searchInput.value;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== searchInput) searchInput.focus();
      try {
        searchInput.setSelectionRange(value.length, value.length);
      } catch (e) { log.swallow("render-deck searchInput setSelectionRange", e); }
    });
  });
  searchInput.addEventListener("blur", () => {
    if (popover.style.display !== "block") return;
    window.requestAnimationFrame(() => {
      if (popover.style.display === "block") searchInput.focus();
    });
  });
  const stopKey = (ev: KeyboardEvent) => {
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      closePopover();
      comboTrigger.focus();
    }
  };
  searchInput.addEventListener("keydown", stopKey);
  searchInput.addEventListener("keyup", stopKey);
  searchInput.addEventListener("keypress", stopKey as EventListener);

  // Controls order (grouped)
  const studyGroupButtons = document.createElement("div");
  studyGroupButtons.className = "button-group";
  studyGroupButtons.appendChild(studyAllBtn);
  studyGroupButtons.appendChild(comboTrigger);
  groupCombo.appendChild(studyGroupButtons);
  groupCombo.appendChild(popover);
  controlsRow.appendChild(groupCombo);

  // Expand all button
  const expandAllBtn = makeIconButton({
    icon: "plus",
    label: "Expand all",
    title: "Expand all folders",
    className: "btn-outline h-9 flex items-center gap-2 equal-height-btn",
    labelClassName: "",
    iconClassName: "sprout-deck-control-icon",
    onClick: () => {
      const all = new Set<string>([""]);
      collectFolderKeys(tree, all);
      args.setExpanded(all);
      args.rerender();
    },
  });
  const expandCollapseWrap = document.createElement("div");
  expandCollapseWrap.className = "button-group";
  expandCollapseWrap.appendChild(expandAllBtn);

  // Collapse all button
  const collapseAllBtn = makeIconButton({
    icon: "minus",
    label: "Collapse all",
    title: "Collapse all folders",
    className: "btn-outline h-9 flex items-center gap-2 equal-height-btn",
    labelClassName: "",
    iconClassName: "sprout-deck-control-icon",
    onClick: () => {
      args.setExpanded(new Set<string>([""]));
      args.rerender();
    },
  });
  expandCollapseWrap.appendChild(collapseAllBtn);
  controlsRow.appendChild(expandCollapseWrap);

  // --- Enable/disable expand/collapse ---
  function updateExpandCollapseState() {
    const allKeys = new Set<string>();
    collectFolderKeys(tree, allKeys);
    const expandedKeys = args.expanded;
    const isFullyCollapsed = expandedKeys.size === 1 && expandedKeys.has("");
    const isFullyExpanded = allKeys.size > 0 && allKeys.size === expandedKeys.size - 1;
    expandAllBtn.disabled = !!isFullyExpanded;
    collapseAllBtn.disabled = !!isFullyCollapsed;
  }
  updateExpandCollapseState();
  const origRerender = args.rerender;
  args.rerender = function () {
    origRerender.call(this);
    updateExpandCollapseState();
  };

  // ===== Body (table) =====
  const bodyWrap = document.createElement("div");
  bodyWrap.className = "mt-3";
  applyAos(bodyWrap, 400);
  bodyWrap.style.flex = "1 1 auto";
  bodyWrap.style.minHeight = "0";
  bodyWrap.style.overflow = "hidden";
  bodyWrap.style.padding = "0";
  root.appendChild(bodyWrap);

  if (!cards.length) {
    const empty = el("div", "text-muted-foreground", 'No cards found. Run “Sync Question Bank”.');
    (empty).classList.add(...("p-3 text-sm").split(" "));
    bodyWrap.appendChild(empty);
    container.appendChild(root);

    if (shouldAnimateOnce) container.dataset.deckBrowserAosOnce = "1";

    // Init after insertion (Obsidian view render cycle)
    return;
  }

  const tableOuter = document.createElement("div");
  tableOuter.className = "sprout-deck-table-wrap w-full overflow-auto rounded-lg border";
  tableOuter.style.borderColor = "var(--background-modifier-border)";
  tableOuter.style.height = "100%";
  bodyWrap.appendChild(tableOuter);

  const table = document.createElement("table");
  table.className = "sprout-deck-table table w-full";
  tableOuter.appendChild(table);

  const colgroup = document.createElement("colgroup");
  colgroup.className = "";

  const colDeck = document.createElement("col");
  colDeck.className = "";
  colgroup.appendChild(colDeck);

  const makeNumCol = () => {
    const c = document.createElement("col");
    c.className = "w-20";
    return c;
  };
  colgroup.appendChild(makeNumCol()); // Total
  colgroup.appendChild(makeNumCol()); // New
  colgroup.appendChild(makeNumCol()); // Relearning
  colgroup.appendChild(makeNumCol()); // Learning
  colgroup.appendChild(makeNumCol()); // Review

  table.appendChild(colgroup);

  const thead = document.createElement("thead");
  thead.className = "";

  const headRow = document.createElement("tr");
  headRow.className = "";

  const headers: Array<{ label: string; align?: "left" | "center" }> = [
    { label: "Deck", align: "left" },
    { label: "Total", align: "center" },
    { label: "New", align: "center" },
    { label: "Relearning", align: "center" },
    { label: "Learning", align: "center" },
    { label: "Review", align: "center" },
  ];

  for (const h of headers) {
    const th = document.createElement("th");
    th.className = `${h.align === "center" ? "text-center" : "text-left"} text-muted-foreground`;

    if (h.label === "Deck") {
      const flex = document.createElement("div");
      flex.className = "flex items-center gap-2 min-w-0";

      const spacer = document.createElement("span");
      spacer.className = "";
      spacer.style.display = "inline-block";
      spacer.style.width = "28px";
      spacer.style.height = "28px";
      flex.appendChild(spacer);

      const label = document.createElement("span");
      label.textContent = h.label;
      label.className = "truncate";
      flex.appendChild(label);

      th.appendChild(flex);
    } else {
      th.textContent = h.label;
    }

    headRow.appendChild(th);
  }

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.className = "";
  table.appendChild(tbody);

  const renderTable = () => {
    clearNode(tbody);

    const renderChildren = (node: DeckNode, depth = 0) => {
      const children = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));

      for (const child of children) {
        const tr = document.createElement("tr");
        tr.className = "deck-row";
        tr.style.borderRadius = "8px";
        tr.style.overflow = "hidden";
        tr.style.cursor = "pointer";

        const tdName = document.createElement("td");
        tdName.className = "";

        const nameRow = document.createElement("div");
        nameRow.className = "flex items-center gap-2 min-w-0";
        nameRow.style.paddingLeft = `${depth * 14}px`;

        let disclosureChevron = null;
        if (child.type === "folder") {
          const isOpen = args.expanded.has(child.key);
          const toggle = makeDisclosureChevron(isOpen, () => {
            const next = new Set(args.expanded);
            if (next.has(child.key)) next.delete(child.key);
            else next.add(child.key);
            args.setExpanded(next);
            args.rerender();
          });
          toggle.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          });
          nameRow.appendChild(toggle);
          disclosureChevron = toggle;
        } else {
          const spacer = document.createElement("span");
          spacer.className = "";
          const toggleWidth = 28;
          spacer.style.display = "inline-block";
          spacer.style.width = `${toggleWidth}px`;
          spacer.style.height = `${toggleWidth}px`;
          nameRow.appendChild(spacer);
        }

        const nameText = document.createElement("div");
        nameText.className = "truncate";
        nameText.textContent = child.name;
        nameRow.appendChild(nameText);

        tdName.appendChild(nameRow);
        tr.appendChild(tdName);

        const makeNumCell = (value: number) => {
          const td = document.createElement("td");
          td.className = "text-center";
          td.textContent = String(value);
          return td;
        };

        tr.appendChild(makeNumCell(child.counts.total));
        tr.appendChild(makeNumCell(child.counts.new));
        tr.appendChild(makeNumCell(child.counts.relearning));
        tr.appendChild(makeNumCell(child.counts.learning));
        tr.appendChild(makeNumCell(child.counts.review));

        // Make row clickable except for the disclosure chevron
        tr.addEventListener("click", (ev) => {
          if (disclosureChevron && (ev.target === disclosureChevron || disclosureChevron.contains(ev.target))) {
            // Do nothing, handled by chevron
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();
          if (child.type === "folder") {
            args.openSession({ type: "folder", key: child.key, name: child.name });
            return;
          }
          if (child.type === "note") {
            args.openSession({ type: "note", key: child.key, name: child.name });
          }
        });

        tbody.appendChild(tr);

        if (child.type === "folder" && args.expanded.has(child.key) && child.children.size) {
          renderChildren(child, depth + 1);
        }
      }
    };

    renderChildren(tree, 0);
  };

  renderTable();
  container.appendChild(root);

  if (shouldAnimateOnce) container.dataset.deckBrowserAosOnce = "1";

  // Critical: init Basecoat AFTER insertion so it can wire events in the actual DOM.
}
