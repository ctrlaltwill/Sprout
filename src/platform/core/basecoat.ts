/**
 * @file src/core/basecoat.ts
 * @summary Basecoat UI runtime helpers. Provides the `BasecoatApi` type and a safe accessor
 * for the global `window.basecoat` object used to initialise/start the Basecoat observer.
 *
 * @exports
 *   - BasecoatApi    — shape of the global basecoat runtime
 *   - getBasecoatApi — returns the global Basecoat API or null if unavailable
 */
export type BasecoatApi = {
  register?: (group: string, selector: string, init: (el: Element) => void) => void;
  init?: (group: string) => void;
  initAll?: () => void;
  start?: () => void;
  stop?: () => void;
};

const SPROUT_BASECOAT_PATCHED = "__sproutPatchedNullGuards";

type BasecoatRuntimeWithMarker = BasecoatApi & {
  [SPROUT_BASECOAT_PATCHED]?: boolean;
};

/**
 * Returns a valid BasecoatApi from `window.basecoat`, or `null` if the global
 * is missing or lacks the required `init`/`initAll` + `start` methods.
 */
export function getBasecoatApi(): BasecoatApi | null {
  const bc = window?.basecoat as BasecoatApi | undefined;
  if (!bc) return null;
  const hasInit = typeof bc.initAll === "function" || typeof bc.init === "function";
  const hasStart = typeof bc.start === "function";
  if (!hasInit || !hasStart) return null;
  return bc;
}

/**
 * Patches known null-dereference bugs in Basecoat's dropdown/select initializers
 * (present in basecoat-css@0.3.10) by re-registering guarded versions.
 */
export function patchBasecoatNullGuards(api: BasecoatApi): void {
  const bc = api as BasecoatRuntimeWithMarker;
  if (bc[SPROUT_BASECOAT_PATCHED]) return;
  if (typeof bc.register !== "function") return;

  const safeInitDropdownMenu = (dropdownMenuComponent: Element) => {
    const trigger = dropdownMenuComponent.querySelector<HTMLElement>(":scope > button");
    const popover = dropdownMenuComponent.querySelector<HTMLElement>(":scope > [data-popover]");
    const menu = popover ? popover.querySelector<HTMLElement>("[role=\"menu\"]") : null;

    if (!trigger || !menu || !popover) return;

    let menuItems: HTMLElement[] = [];
    let activeIndex = -1;

    const setActiveItem = (index: number) => {
      if (activeIndex > -1 && menuItems[activeIndex]) {
        menuItems[activeIndex].classList.remove("active");
      }
      activeIndex = index;
      if (activeIndex > -1 && menuItems[activeIndex]) {
        const activeItem = menuItems[activeIndex];
        activeItem.classList.add("active");
        if (activeItem.id) trigger.setAttribute("aria-activedescendant", activeItem.id);
      } else {
        trigger.removeAttribute("aria-activedescendant");
      }
    };

    const closePopover = (focusOnTrigger = true) => {
      if (trigger.getAttribute("aria-expanded") === "false") return;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      popover.setAttribute("aria-hidden", "true");
      if (focusOnTrigger) trigger.focus();
      setActiveItem(-1);
    };

    const openPopover = (initialSelection: false | "first" | "last" = false) => {
      document.dispatchEvent(new CustomEvent("basecoat:popover", { detail: { source: dropdownMenuComponent } }));
      trigger.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      menuItems = Array.from(menu.querySelectorAll<HTMLElement>("[role^=\"menuitem\"]")).filter(
        (item) => !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true",
      );
      if (menuItems.length > 0 && initialSelection) {
        setActiveItem(initialSelection === "first" ? 0 : menuItems.length - 1);
      }
    };

    trigger.addEventListener("click", () => {
      const isExpanded = trigger.getAttribute("aria-expanded") === "true";
      if (isExpanded) closePopover();
      else openPopover(false);
    });

    dropdownMenuComponent.addEventListener("keydown", (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      const isExpanded = trigger.getAttribute("aria-expanded") === "true";
      if (keyEvent.key === "Escape") {
        if (isExpanded) closePopover();
        return;
      }
      if (!isExpanded) {
        if (["Enter", " "].includes(keyEvent.key)) {
          keyEvent.preventDefault();
          openPopover(false);
        } else if (keyEvent.key === "ArrowDown") {
          keyEvent.preventDefault();
          openPopover("first");
        } else if (keyEvent.key === "ArrowUp") {
          keyEvent.preventDefault();
          openPopover("last");
        }
        return;
      }
      if (menuItems.length === 0) return;

      let nextIndex = activeIndex;
      switch (keyEvent.key) {
        case "ArrowDown":
          keyEvent.preventDefault();
          nextIndex = activeIndex === -1 ? 0 : Math.min(activeIndex + 1, menuItems.length - 1);
          break;
        case "ArrowUp":
          keyEvent.preventDefault();
          nextIndex = activeIndex === -1 ? menuItems.length - 1 : Math.max(activeIndex - 1, 0);
          break;
        case "Home":
          keyEvent.preventDefault();
          nextIndex = 0;
          break;
        case "End":
          keyEvent.preventDefault();
          nextIndex = menuItems.length - 1;
          break;
        case "Enter":
        case " ":
          keyEvent.preventDefault();
          menuItems[activeIndex]?.click();
          closePopover();
          return;
        default:
          break;
      }
      if (nextIndex !== activeIndex) setActiveItem(nextIndex);
    });

    menu.addEventListener("mousemove", (event: MouseEvent) => {
      const target = event.target as Element | null;
      const menuItem = target?.closest<HTMLElement>("[role^=\"menuitem\"]") ?? null;
      if (menuItem && menuItems.includes(menuItem)) {
        const index = menuItems.indexOf(menuItem);
        if (index !== activeIndex) setActiveItem(index);
      }
    });

    menu.addEventListener("mouseleave", () => setActiveItem(-1));
    menu.addEventListener("click", (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[role^=\"menuitem\"]")) closePopover();
    });

    document.addEventListener("click", (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !dropdownMenuComponent.contains(target)) closePopover();
    });

    document.addEventListener("basecoat:popover", (event: Event) => {
      const source = (event as CustomEvent<{ source?: unknown }>).detail?.source;
      if (source !== dropdownMenuComponent) closePopover(false);
    });

    (dropdownMenuComponent as HTMLElement).dataset.dropdownMenuInitialized = "true";
    dropdownMenuComponent.dispatchEvent(new CustomEvent("basecoat:initialized"));
  };

  bc.register("dropdown-menu", ".dropdown-menu:not([data-dropdown-menu-initialized])", safeInitDropdownMenu);
  bc[SPROUT_BASECOAT_PATCHED] = true;
}
