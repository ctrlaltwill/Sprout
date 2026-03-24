/**
 * @file src/reviewer/render-deck.ts
 * @summary Renders the deck-browser mode of the reviewer, displaying a hierarchical tree of folders, notes, and groups with card-stage badges, expand/collapse controls, a group-scope combobox, and study-all/study-group actions.
 *
 * @exports
 *   - renderDeckMode — Builds and mounts the full deck-browser DOM (tree table, controls, badges) into the given container
 */

import type { App } from "obsidian";
import { setIcon } from "obsidian";
import { el, queryFirst, setCssProps } from "../../platform/core/ui";
import { createBodyPortalPopover } from "../../platform/core/popover";
import { buildDeckTree, type DeckNode } from "../../engine/deck/deck-tree";
import type SproutPlugin from "../../main";
import type { Scope } from "./types";
import { getGroupIndex, normaliseGroupPath } from "../../engine/indexing/group-index";
import { log } from "../../platform/core/logger";
import { t } from "../../platform/translations/translator";
import {
  clearNode,
  titleCaseGroupPath,
  expandGroupAncestors,
} from "../../platform/core/shared-utils";

type Args = {
  app: App;
  plugin: SproutPlugin;

  container: HTMLElement;
  applyAOS?: boolean;

  expanded: Set<string>;
  setExpanded: (s: Set<string>) => void;

  openSession: (scope: Scope) => void;
  resyncActiveFile: () => Promise<void>;

  rerender: () => void;
};

/** Format a group path for display (alias for formatGroupDisplay without title-casing). */
function prettifyGroupLabel(groupPath: string) {
  return groupPath.split("/").join(" / ");
}

function ensureBasecoatStartedOnce() {
  const bc = window?.basecoat;
  if (!bc) return;

  if (window.__sprout_started) return;

  try {
    if (typeof bc.start === "function") bc.start();
  } catch {
    // ignore
  }

  window.__sprout_started = true;
}



function makeIconButton(opts: {
  icon: string;
  label: string;
  title?: string;
  className?: string;
  labelClassName?: string;
  iconClassName?: string;
  iconAfterLabel?: boolean;
  onClick: () => void;
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className || "sprout-btn-toolbar";
  btn.setAttribute("aria-label", opts.title || opts.label);
  btn.setAttribute("data-tooltip-position", "top");

  const iconWrap = document.createElement("span");
  iconWrap.className = `inline-flex items-center justify-center${opts.iconClassName ? ` ${opts.iconClassName}` : ""}`;
  setIcon(iconWrap, opts.icon);
  queryFirst(iconWrap, "svg")?.classList.add("bc", "shrink-0");

  const text = document.createElement("span");
  text.textContent = opts.label;
  text.className = opts.labelClassName ?? "ml-2";

  if (opts.iconAfterLabel) {
    btn.appendChild(text);
    btn.appendChild(iconWrap);
  } else {
    btn.appendChild(iconWrap);
    btn.appendChild(text);
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    opts.onClick();
  });

  return btn;
}

function makeDisclosureChevron(isOpen: boolean, onToggle: () => void, collapseLabel: string, expandLabel: string) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "sprout-deck-disclosure sprout-deck-disclosure-btn inline-flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:text-foreground";
  btn.setAttribute("aria-label", isOpen ? collapseLabel : expandLabel);
  btn.setAttribute("data-tooltip-position", "top");
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  btn.dataset.open = isOpen ? "true" : "false";

  const iconWrap = document.createElement("span");
  iconWrap.className = "sprout-deck-expand-icon inline-flex items-center justify-center [&_svg]:size-4";
  const renderIcon = (open: boolean) => {
    iconWrap.replaceChildren();
    setIcon(iconWrap, open ? "minus" : "plus");
    queryFirst(iconWrap, "svg")?.classList.add("bc");
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

export function renderDeckMode(args: Args) {
  const { app, plugin, container } = args;
  const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
    t(plugin.settings?.general?.interfaceLanguage, token, fallback, vars);

  ensureBasecoatStartedOnce();

  const animationsEnabled = plugin.settings?.general?.enableAnimations ?? true;
  const shouldAnimateOnce = animationsEnabled && !!args.applyAOS;
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
  root.className = "flex flex-col min-h-0 gap-0 sprout-deck-root";

  const titleRoot = container.closest(".lk-review-root, .sprout-review-root");
  const titleActionsHost = titleRoot?.querySelector<HTMLElement>(
    ".lk-review-title-timer-host, .sprout-review-title-timer-host",
  );

  // Tree early (needed for badges + expand/collapse all)
  const tree: DeckNode = buildDeckTree(cards, states, now, vaultName);
  let expandedState = new Set<string>(args.expanded);

  const getExpanded = () => expandedState;
  const setExpanded = (next: Set<string>) => {
    expandedState = new Set(next);
    args.setExpanded(new Set(next));
  };

  const topActions = document.createElement("div");
  topActions.className = "flex flex-row flex-wrap items-center gap-2 sprout-deck-title-actions";

  const studyAllBtn = makeIconButton({
    icon: "arrow-right",
    label: tx("ui.reviewer.deck.studyAll", "Study all"),
    title: tx("ui.reviewer.deck.studyAllTooltip", "Start a vault-wide session"),
    className:
      "bc sprout-btn-toolbar sprout-btn-accent h-9 w-full md:w-auto inline-flex items-center gap-2 equal-height-btn sprout-deck-study-all-btn",
    labelClassName: "",
    iconClassName: "sprout-btn-icon",
    iconAfterLabel: true,
    onClick: () => args.openSession({ type: "vault", key: "", name: vaultName }),
  });

  // ===== Group combobox (single select) =====
  const gx = getGroupIndex(plugin);

  const groupCombo = document.createElement("div");
  groupCombo.className = "relative w-full md:w-auto sprout-deck-group-combo";

  const comboTrigger = document.createElement("button");
  comboTrigger.type = "button";
  comboTrigger.className =
    "bc sprout-btn-toolbar sprout-btn-accent h-9 w-full md:w-auto inline-flex items-center gap-2 equal-height-btn sprout-deck-group-trigger";
  comboTrigger.setAttribute("aria-haspopup", "listbox");
  comboTrigger.setAttribute("aria-expanded", "false");

  const comboIcon = document.createElement("span");
  comboIcon.className = "sprout-btn-icon inline-flex items-center justify-center [&_svg]:size-3.5";
  setIcon(comboIcon, "arrow-right");

  const comboLabel = document.createElement("span");
  comboLabel.className = "truncate";
  comboLabel.textContent = tx("ui.reviewer.deck.studyGroup", "Study by group");
  comboTrigger.appendChild(comboLabel);
  comboTrigger.appendChild(comboIcon);
  // Trigger lives in the group combo container next to the standalone Study all button

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

  const groupPopover = createBodyPortalPopover({
    trigger: comboTrigger,
    align: "right",
    panelClasses: ["sprout-ss-panel", "sprout-header-menu-panel"],
    overlayClasses: ["sprout-ss-popover"],
    width: 320,
    buildContent(panel, close) {
      // ── Search input ──
      const searchWrap = document.createElement("div");
      searchWrap.className = "sprout-ss-search-wrap";
      panel.appendChild(searchWrap);

      const searchIcon = document.createElement("span");
      searchIcon.className = "sprout-ss-search-icon";
      setIcon(searchIcon, "search");
      searchWrap.appendChild(searchIcon);

      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "sprout-ss-search-input";
      searchInput.placeholder = tx("ui.reviewer.deck.searchGroups", "Search groups…");
      searchInput.setAttribute("autocomplete", "off");
      searchInput.setAttribute("autocorrect", "off");
      searchInput.spellcheck = false;
      searchWrap.appendChild(searchInput);

      // ── Options list (hidden until search text is entered) ──
      const listbox = document.createElement("div");
      listbox.setAttribute("role", "listbox");
      listbox.className = "sprout-ss-listbox";
      setCssProps(listbox, "display", "none");
      panel.appendChild(listbox);

      // ── Empty state ──
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "sprout-ss-empty";
      emptyMsg.textContent = tx("ui.reviewer.deck.noGroupsFound", "No groups found.");
      setCssProps(emptyMsg, "display", "none");
      panel.appendChild(emptyMsg);

      const renderList = () => {
        clearNode(listbox);
        const q = searchInput.value.trim().toLowerCase();

        // If nothing typed, hide list and empty message
        if (!q) {
          setCssProps(listbox, "display", "none");
          setCssProps(emptyMsg, "display", "none");
          return;
        }

        const options = allOptions.filter((t) => prettifyGroupLabel(t).toLowerCase().includes(q));

        if (!options.length) {
          setCssProps(listbox, "display", "none");
          setCssProps(emptyMsg, "display", "");
          return;
        }

        setCssProps(emptyMsg, "display", "none");
        setCssProps(listbox, "display", "");

        // "Study all" option
        const studyAllItem = document.createElement("div");
        studyAllItem.setAttribute("role", "option");
        studyAllItem.setAttribute("aria-selected", "false");
        studyAllItem.tabIndex = 0;
        studyAllItem.className = "sprout-ss-item";

        const studyAllText = document.createElement("div");
        studyAllText.className = "sprout-ss-item-text";
        const studyAllLabel = document.createElement("span");
        studyAllLabel.className = "sprout-ss-item-label";
        studyAllLabel.textContent = tx("ui.reviewer.deck.studyAll", "Study all");
        studyAllText.appendChild(studyAllLabel);
        studyAllItem.appendChild(studyAllText);

        studyAllItem.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          comboLabel.textContent = tx("ui.reviewer.deck.studyAll", "Study all");
          close();
          args.openSession({ type: "vault", key: "", name: vaultName });
        });
        listbox.appendChild(studyAllItem);

        // Group options
        const limitedOptions = options.slice(0, 5);
        for (const tag of limitedOptions) {
          const item = document.createElement("div");
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", "false");
          item.tabIndex = 0;
          item.className = "sprout-ss-item";

          const textWrap = document.createElement("div");
          textWrap.className = "sprout-ss-item-text";
          const label = document.createElement("span");
          label.className = "sprout-ss-item-label";
          label.textContent = prettifyGroupLabel(tag);
          textWrap.appendChild(label);
          item.appendChild(textWrap);

          item.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            comboLabel.textContent = prettifyGroupLabel(tag);
            close();
            args.openSession({ type: "group", key: tag, name: tag });
          });

          listbox.appendChild(item);
        }
      };

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

      const stopKey = (ev: KeyboardEvent) => {
        ev.stopPropagation();
        if (ev.key === "Escape") {
          ev.preventDefault();
          close();
          comboTrigger.focus();
        }
      };
      searchInput.addEventListener("keydown", stopKey);
      searchInput.addEventListener("keyup", stopKey);
      searchInput.addEventListener("keypress", stopKey as EventListener);

      // Focus search on open
      window.requestAnimationFrame(() => searchInput.focus());
    },
    onOpened(panel) {
      const input = panel.querySelector<HTMLInputElement>(".sprout-ss-search-input");
      if (input) input.focus();
    },
  });

  comboTrigger.addEventListener("pointerdown", (ev) => {
    if ((ev).button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    groupPopover.toggle();
  });

  // Controls order (standalone)
  topActions.appendChild(studyAllBtn);
  groupCombo.appendChild(comboTrigger);
  topActions.appendChild(groupCombo);

  if (titleActionsHost) {
    titleActionsHost.replaceChildren(topActions);
  } else {
    root.prepend(topActions);
  }

  // ===== Body (table) =====
  const bodyWrap = document.createElement("div");
  bodyWrap.className = "sprout-deck-body flex-1 min-h-0 overflow-hidden p-0";
  applyAos(bodyWrap, 0);
  root.appendChild(bodyWrap);

  if (!cards.length) {
    const empty = el("div", "text-muted-foreground", 'No cards found. Run “Sync Question Bank”.');
    (empty).classList.add(...("p-3 text-sm").split(" "));
    bodyWrap.appendChild(empty);
    container.appendChild(root);

    // Init after insertion (Obsidian view render cycle)
    return;
  }

  const tableOuter = document.createElement("div");
  tableOuter.className = "sprout-deck-table-wrap sprout-deck-table-outer w-full overflow-auto rounded-lg border";
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
      spacer.className = "sprout-deck-spacer";
      setCssProps(spacer, "--sprout-deck-spacer-size", "28px");
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
        tr.className = "deck-row sprout-deck-row";

        const tdName = document.createElement("td");
        tdName.className = "";

        const nameRow = document.createElement("div");
        nameRow.className = "flex items-center gap-2 min-w-0 sprout-deck-name-row";
        setCssProps(nameRow, "--sprout-deck-indent", `${depth * 14}px`);

        let disclosureChevron = null;
        if (child.type === "folder") {
          const isOpen = getExpanded().has(child.key);
          const toggle = makeDisclosureChevron(
            isOpen,
            () => {
            const next = new Set(getExpanded());
            if (next.has(child.key)) next.delete(child.key);
            else next.add(child.key);
            setExpanded(next);
            renderTable();
            },
            tx("ui.reviewer.deck.folder.collapse", "Collapse folder"),
            tx("ui.reviewer.deck.folder.expand", "Expand folder"),
          );
          toggle.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          });
          nameRow.appendChild(toggle);
          disclosureChevron = toggle;
        } else {
          const spacer = document.createElement("span");
          spacer.className = "sprout-deck-spacer";
          const toggleWidth = 28;
          setCssProps(spacer, "--sprout-deck-spacer-size", `${toggleWidth}px`);
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
          if (disclosureChevron && (ev.target === disclosureChevron || disclosureChevron.contains(ev.target as Node))) {
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

        if (child.type === "folder" && getExpanded().has(child.key) && child.children.size) {
          renderChildren(child, depth + 1);
        }
      }
    };

    renderChildren(tree, 0);
  };

  renderTable();
  container.appendChild(root);

  // Critical: init Basecoat AFTER insertion so it can wire events in the actual DOM.
}
