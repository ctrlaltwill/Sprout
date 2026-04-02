/**
 * @file src/views/shared/search-popover-list.ts
 * @summary Module for search popover list.
 *
 * @exports
 *  - SearchPopoverOption
 *  - SearchPopoverListController
 *  - SearchPopoverListArgs
 *  - buildScopeSearchPlaceholder
 *  - mountSearchPopoverList
 */

import { setIcon } from "obsidian";

export type SearchPopoverOption = {
  id: string;
  label: string;
  selected: boolean;
  type?: "vault" | "folder" | "note" | "tag" | "property";
  searchTexts?: string[];
  propertyKey?: string;
  propertyValue?: string;
};

export type SearchPopoverListController = {
  render: () => void;
  close: () => void;
};

export type SearchPopoverListArgs = {
  searchInput: HTMLInputElement;
  popoverEl: HTMLElement;
  listEl: HTMLElement;
  getQuery: () => string;
  setQuery: (query: string) => void;
  getOptions: () => SearchPopoverOption[];
  onToggle: (id: string) => void;
  emptyTextWhenQuery: string;
  emptyTextWhenIdle: string;
  typeFilters?: Array<{ type: "vault" | "folder" | "note" | "tag" | "property"; label: string }>;
};

function normalizeSearchValue(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\btag:\s*/g, "")
    .replace(/#/g, "")
    .trim();
}

function optionMatchesQuery(option: SearchPopoverOption, query: string): boolean {
  const raw = String(query || "").trim().toLowerCase();
  if (!raw) return false;

  const normalizedQuery = normalizeSearchValue(raw);
  if (!normalizedQuery) return false;

  const haystacks = [option.label, ...(option.searchTexts ?? [])]
    .map((text) => String(text || "").toLowerCase())
    .filter(Boolean);

  for (const haystack of haystacks) {
    if (haystack.includes(raw)) return true;
    if (normalizeSearchValue(haystack).includes(normalizedQuery)) return true;
  }

  return false;
}

function listWithAnd(items: string[]): string {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function buildScopeSearchPlaceholder(terms: string[]): string {
  const scopedTerms = terms.filter((term) => String(term || "").trim().length > 0);
  if (!scopedTerms.length || scopedTerms.length >= 3) return "Search...";
  return `Search for ${listWithAnd(scopedTerms)}`;
}

function getPropertyDisplayKey(option: SearchPopoverOption): string {
  if (option.propertyKey) return String(option.propertyKey).trim();
  const label = String(option.label || "").trim();
  const match = /^Property:\s*([^:]+)\s*:/i.exec(label);
  if (match?.[1]) return match[1].trim();
  const generic = /^([^:]+)\s*:/.exec(label);
  if (generic?.[1]) return generic[1].trim();
  return label || "Property";
}

function pluralizeLabel(input: string): string {
  const label = String(input || "").trim();
  if (!label) return "Properties";
  if (/ies$/i.test(label) || /s$/i.test(label)) return label;
  if (/(x|z|ch|sh)$/i.test(label)) return `${label}es`;
  if (/y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

function iconForType(type: SearchPopoverOption["type"]): string {
  if (type === "vault") return "database";
  if (type === "folder") return "folder";
  if (type === "note") return "sticky-note";
  if (type === "tag") return "tag";
  if (type === "property") return "braces";
  return "dot";
}

function renderScopeItemIcon(target: HTMLElement, type: SearchPopoverOption["type"]): void {
  if (type !== "folder") {
    setIcon(target, iconForType(type));
    return;
  }

  target.empty();
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("xmlns", ns);
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "svg-icon lucide-folder");

  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z");
  svg.appendChild(path);
  target.appendChild(svg);
}

export function mountSearchPopoverList(args: SearchPopoverListArgs): SearchPopoverListController {
  let filteredOptions: SearchPopoverOption[] = [];
  let activeIndex = -1;
  const typeFilterDefs = args.typeFilters ?? [];
  const visibleTypeFilterDefs = typeFilterDefs.filter((entry) => entry.type !== "property" && entry.type !== "vault");
  const enabledTypes = new Set(typeFilterDefs.map((entry) => entry.type));
  const enabledPropertyKeys = new Set<string>();
  let typeFilterOpen = false;

  const searchWrap = args.searchInput.parentElement;
  const filterPopoverId = `sprout-scope-type-filter-listbox-${Math.random().toString(36).slice(2, 9)}`;
  const typeFilterBtn = typeFilterDefs.length
    ? searchWrap?.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-type-filter-btn learnkit-scope-type-filter-btn",
      attr: {
        type: "button",
        "aria-label": "Filter scope item types",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
        "aria-controls": filterPopoverId,
      },
    })
    : null;
  const typeFilterPopover = typeFilterDefs.length
    ? searchWrap?.createDiv({ cls: "learnkit-scope-type-filter-popover learnkit-scope-type-filter-popover dropdown-menu hidden" })
    : null;
  const typeFilterList = typeFilterPopover?.createDiv({
    cls: "learnkit-coach-scope-list learnkit-coach-scope-list min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-pointer-auto learnkit-header-menu-panel learnkit-header-menu-panel",
  }) ?? null;
  if (typeFilterList) {
    typeFilterList.setAttr("id", filterPopoverId);
    typeFilterList.setAttr("role", "listbox");
  }

  const typeFilterBtnLabel = typeFilterBtn
    ? typeFilterBtn.createSpan({ cls: "", text: "Filters" })
    : null;
  if (typeFilterBtn) {
    const typeFilterIcon = typeFilterBtn.createSpan({ cls: "inline-flex items-center justify-center" });
    setIcon(typeFilterIcon, "filter");
    typeFilterBtn.insertBefore(typeFilterIcon, typeFilterBtnLabel);
  }

  const applyTypeFilterLabel = (): void => {
    if (!typeFilterBtn || !typeFilterBtnLabel) return;
    typeFilterBtnLabel.setText("Filters");
  };

  const renderTypeFilterList = (): void => {
    if (!typeFilterList) return;
    typeFilterList.empty();

    const propertyOptions = args
      .getOptions()
      .filter((option) => option.type === "property")
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

    const propertyGroups = new Map<string, { display: string; ids: Set<string> }>();
    for (const option of propertyOptions) {
      const keyDisplay = getPropertyDisplayKey(option);
      const groupKey = keyDisplay.toLowerCase();
      const existing = propertyGroups.get(groupKey);
      if (existing) {
        existing.ids.add(option.id);
      } else {
        propertyGroups.set(groupKey, { display: keyDisplay, ids: new Set([option.id]) });
      }
    }

    for (const existingKey of Array.from(enabledPropertyKeys)) {
      if (!propertyGroups.has(existingKey)) enabledPropertyKeys.delete(existingKey);
    }

    const propertyGroupList = Array.from(propertyGroups.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.display.localeCompare(b.display, undefined, { sensitivity: "base" }));

    if (visibleTypeFilterDefs.length) {
      typeFilterList.createDiv({ cls: "learnkit-coach-scope-section-title learnkit-coach-scope-section-title", text: "Filters", attr: { role: "presentation" } });
    }

    for (const entry of visibleTypeFilterDefs) {
      const selected = enabledTypes.has(entry.type);
      const item = typeFilterList.createEl("button", {
        cls: "learnkit-coach-scope-item learnkit-coach-scope-item group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      });
      item.type = "button";
      item.setAttr("role", "menuitemcheckbox");
      item.setAttr("aria-checked", selected ? "true" : "false");
      const iconWrap = item.createSpan({ cls: "learnkit-coach-scope-item-icon learnkit-coach-scope-item-icon" });
      renderScopeItemIcon(iconWrap, entry.type);
      const dotWrap = item.createSpan({ cls: "learnkit-coach-scope-item-dot-wrap learnkit-coach-scope-item-dot-wrap" });
      dotWrap.createSpan({ cls: `learnkit-coach-scope-item-dot${selected ? " is-selected" : ""}` });
      item.createSpan({ cls: "learnkit-coach-scope-item-label learnkit-coach-scope-item-label", text: entry.label });
      if (selected) item.classList.add("is-selected");
      item.addEventListener("mousedown", (evt) => evt.preventDefault());
      item.addEventListener("click", () => {
        if (enabledTypes.has(entry.type)) enabledTypes.delete(entry.type);
        else enabledTypes.add(entry.type);
        renderTypeFilterList();
        applyTypeFilterLabel();
        render();
      });
    }

    if (propertyGroupList.length) {
      if (visibleTypeFilterDefs.length) {
        typeFilterList.createDiv({ cls: "learnkit-coach-scope-separator learnkit-coach-scope-separator", attr: { role: "separator" } });
      }
      typeFilterList.createDiv({ cls: "learnkit-coach-scope-section-title learnkit-coach-scope-section-title", text: "Properties", attr: { role: "presentation" } });
      for (const group of propertyGroupList) {
        const selected = enabledPropertyKeys.has(group.key);
        const item = typeFilterList.createEl("button", {
          cls: "learnkit-coach-scope-item learnkit-coach-scope-item group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        });
        item.type = "button";
        item.setAttr("role", "menuitemcheckbox");
        item.setAttr("aria-checked", selected ? "true" : "false");
        item.setAttr("aria-label", pluralizeLabel(group.display));
        const iconWrap = item.createSpan({ cls: "learnkit-coach-scope-item-icon learnkit-coach-scope-item-icon" });
        renderScopeItemIcon(iconWrap, "property");
        const dotWrap = item.createSpan({ cls: "learnkit-coach-scope-item-dot-wrap learnkit-coach-scope-item-dot-wrap" });
        dotWrap.createSpan({ cls: `learnkit-coach-scope-item-dot${selected ? " is-selected" : ""}` });
        item.createSpan({ cls: "learnkit-coach-scope-item-label learnkit-coach-scope-item-label", text: pluralizeLabel(group.display) });
        if (selected) item.classList.add("is-selected");
        item.addEventListener("mousedown", (evt) => evt.preventDefault());
        item.addEventListener("click", () => {
          if (enabledPropertyKeys.has(group.key)) enabledPropertyKeys.delete(group.key);
          else enabledPropertyKeys.add(group.key);
          renderTypeFilterList();
          render();
        });
      }
    }
  };

  const applySearchIconOffset = (): void => {
    if (!searchWrap || !typeFilterBtn) return;
    const offset = typeFilterBtn.offsetWidth + 6;
    searchWrap.style.setProperty("--learnkit-scope-filter-offset", `${offset}px`);
  };

  const applyPlaceholder = (): void => {
    const enabledTypeLabels = visibleTypeFilterDefs
      .filter((entry) => enabledTypes.has(entry.type))
      .map((entry) => entry.label.toLowerCase());

    const allPropertyOptions = args.getOptions().filter((option) => option.type === "property");
    const selectedPropertyKeys = Array.from(enabledPropertyKeys);
    const propertyNames = selectedPropertyKeys
      .slice(0, 2)
      .map((key) => {
        const match = allPropertyOptions.find((option) => getPropertyDisplayKey(option).toLowerCase() === key);
        return pluralizeLabel(match ? getPropertyDisplayKey(match) : key).toLowerCase();
      });

    if (selectedPropertyKeys.length > 2) propertyNames.push("properties");

    const visibleTypeCount = visibleTypeFilterDefs.length;
    const allVisibleTypesEnabled = visibleTypeCount > 0 && enabledTypeLabels.length === visibleTypeCount;
    const scopedTypeTerms = allVisibleTypesEnabled ? [] : enabledTypeLabels;
    const terms = [...scopedTypeTerms, ...propertyNames];

    args.searchInput.placeholder = buildScopeSearchPlaceholder(terms);
  };

  const setTypeFilterOpen = (open: boolean): void => {
    typeFilterOpen = open;
    typeFilterBtn?.setAttr("aria-expanded", open ? "true" : "false");
    if (!typeFilterPopover) return;
    if (open) typeFilterPopover.classList.remove("hidden");
    else typeFilterPopover.classList.add("hidden");
  };

  let outsideListenerBound = false;
  const handleOutsideTypeFilterClick = (evt: MouseEvent): void => {
    if (!typeFilterOpen) return;
    const target = evt.target as Node | null;
    if (!target) return;
    if (typeFilterPopover?.contains(target)) return;
    if (typeFilterBtn?.contains(target)) return;
    setTypeFilterOpen(false);
  };

  const bindOutsideListener = (): void => {
    if (outsideListenerBound) return;
    document.addEventListener("mousedown", handleOutsideTypeFilterClick, true);
    outsideListenerBound = true;
  };

  const unbindOutsideListener = (): void => {
    if (!outsideListenerBound) return;
    document.removeEventListener("mousedown", handleOutsideTypeFilterClick, true);
    outsideListenerBound = false;
  };

  const setTypeFilterOpenWithOutsideListener = (open: boolean): void => {
    setTypeFilterOpen(open);
    if (open) bindOutsideListener();
    else unbindOutsideListener();
  };

  if (typeFilterBtn && searchWrap) {
    searchWrap.classList.add("learnkit-coach-search-wrap-has-filters", "learnkit-coach-search-wrap-has-filters");
    searchWrap.insertBefore(typeFilterBtn, args.searchInput);
    applySearchIconOffset();
    typeFilterBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      setTypeFilterOpenWithOutsideListener(!typeFilterOpen);
      if (typeFilterOpen) renderTypeFilterList();
    });
    window.setTimeout(applySearchIconOffset, 0);
  }

  const close = (): void => {
    args.popoverEl.classList.add("hidden");
  };

  const open = (): void => {
    args.popoverEl.classList.remove("hidden");
  };

  const shouldOpen = (): boolean => {
    if (!args.getQuery().trim()) return false;
    const active = document.activeElement as Node | null;
    return active === args.searchInput || (active ? args.popoverEl.contains(active) : false);
  };

  const render = (): void => {
    const query = args.getQuery();
    applySearchIconOffset();
    applyPlaceholder();
    args.listEl.empty();

    filteredOptions = args
      .getOptions()
      .filter((option) => {
        if (!visibleTypeFilterDefs.length) return true;
        if (!option.type) return true;
        if (option.type === "vault") return true;
        if (option.type === "property") {
          return enabledPropertyKeys.has(getPropertyDisplayKey(option).toLowerCase());
        }
        return enabledTypes.has(option.type);
      })
      .filter((option) => optionMatchesQuery(option, query))
      .slice(0, 200);

    if (!filteredOptions.length) {
      activeIndex = -1;
      const empty = args.listEl.createDiv({
        cls: "learnkit-coach-scope-empty learnkit-coach-scope-empty",
        text: query.trim() ? args.emptyTextWhenQuery : args.emptyTextWhenIdle,
      });
      empty.setAttr("role", "status");
    } else {
      if (activeIndex < 0) activeIndex = 0;
      if (activeIndex >= filteredOptions.length) activeIndex = filteredOptions.length - 1;

      for (let idx = 0; idx < filteredOptions.length; idx += 1) {
        const option = filteredOptions[idx];
        const item = args.listEl.createEl("button", {
          cls: "learnkit-coach-scope-item learnkit-coach-scope-item group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        });
        item.type = "button";
        item.setAttr("role", "menuitemcheckbox");
        item.setAttr("aria-checked", option.selected ? "true" : "false");
        item.setAttr("aria-label", option.label);
        item.tabIndex = idx === activeIndex ? 0 : -1;
        const iconWrap = item.createSpan({ cls: "learnkit-coach-scope-item-icon learnkit-coach-scope-item-icon" });
        renderScopeItemIcon(iconWrap, option.type);
        item.createSpan({ cls: "learnkit-coach-scope-item-label learnkit-coach-scope-item-label", text: option.label });

        if (idx === activeIndex) item.classList.add("is-active");
        if (option.selected) item.classList.add("is-selected");

        item.addEventListener("mousedown", (evt) => {
          evt.preventDefault();
        });

        item.addEventListener("mouseenter", () => {
          const prev = args.listEl.querySelector(".learnkit-coach-scope-item.is-active");
          if (prev instanceof HTMLElement) {
            prev.classList.remove("is-active");
            prev.tabIndex = -1;
          }
          activeIndex = idx;
          item.classList.add("is-active");
          item.tabIndex = 0;
        });

        item.addEventListener("click", () => {
          args.onToggle(option.id);
        });
      }
    }

    if (shouldOpen()) open();
    else close();
  };

  args.searchInput.addEventListener("input", () => {
    args.setQuery(String(args.searchInput.value || ""));
    render();
  });

  args.searchInput.addEventListener("focus", () => {
    setTypeFilterOpenWithOutsideListener(false);
    if (args.getQuery().trim()) render();
  });

  args.searchInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!shouldOpen()) close();
    }, 120);
  });

  args.searchInput.addEventListener("keydown", (evt) => {
    if ((evt.key === "ArrowDown" || evt.key === "ArrowUp") && args.getQuery().trim()) {
      evt.preventDefault();
      const max = filteredOptions.length;
      if (!max) return;
      if (evt.key === "ArrowDown") activeIndex = (activeIndex + 1 + max) % max;
      else activeIndex = (activeIndex - 1 + max) % max;
      render();
      const activeItem = args.listEl.querySelector(".learnkit-coach-scope-item.is-active");
      if (activeItem instanceof HTMLElement) activeItem.focus();
      return;
    }

    if (evt.key === "Enter" && args.getQuery().trim()) {
      if (filteredOptions.length && activeIndex >= 0) {
        evt.preventDefault();
        const active = filteredOptions[activeIndex];
        if (active) args.onToggle(active.id);
      }
      return;
    }

    if (evt.key === "Escape") {
      evt.preventDefault();
      close();
      setTypeFilterOpenWithOutsideListener(false);
    }
  });

  applyTypeFilterLabel();
  applyPlaceholder();
  return { render, close };
}
