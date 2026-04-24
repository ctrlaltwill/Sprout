const SPROUT_BASECOAT_PATCHED = "__sproutPatchedNullGuards";
/**
 * Returns a valid BasecoatApi from `window.basecoat`, or `null` if the global
 * is missing or lacks the required `init`/`initAll` + `start` methods.
 */
export function getBasecoatApi() {
    const bc = window === null || window === void 0 ? void 0 : window.basecoat;
    if (!bc)
        return null;
    const hasInit = typeof bc.initAll === "function" || typeof bc.init === "function";
    const hasStart = typeof bc.start === "function";
    if (!hasInit || !hasStart)
        return null;
    return bc;
}
/**
 * Patches known null-dereference bugs in Basecoat's dropdown/select initializers
 * (present in basecoat-css@0.3.10) by re-registering guarded versions.
 */
export function patchBasecoatNullGuards(api) {
    const bc = api;
    if (bc[SPROUT_BASECOAT_PATCHED])
        return;
    if (typeof bc.register !== "function")
        return;
    const safeInitDropdownMenu = (dropdownMenuComponent) => {
        const trigger = dropdownMenuComponent.querySelector(":scope > button");
        const popover = dropdownMenuComponent.querySelector(":scope > [data-popover]");
        const menu = popover ? popover.querySelector("[role=\"menu\"]") : null;
        if (!trigger || !menu || !popover)
            return;
        let menuItems = [];
        let activeIndex = -1;
        const setActiveItem = (index) => {
            if (activeIndex > -1 && menuItems[activeIndex]) {
                menuItems[activeIndex].classList.remove("active");
            }
            activeIndex = index;
            if (activeIndex > -1 && menuItems[activeIndex]) {
                const activeItem = menuItems[activeIndex];
                activeItem.classList.add("active");
                if (activeItem.id)
                    trigger.setAttribute("aria-activedescendant", activeItem.id);
            }
            else {
                trigger.removeAttribute("aria-activedescendant");
            }
        };
        const closePopover = (focusOnTrigger = true) => {
            if (trigger.getAttribute("aria-expanded") === "false")
                return;
            trigger.setAttribute("aria-expanded", "false");
            trigger.removeAttribute("aria-activedescendant");
            popover.setAttribute("aria-hidden", "true");
            if (focusOnTrigger)
                trigger.focus();
            setActiveItem(-1);
        };
        const openPopover = (initialSelection = false) => {
            document.dispatchEvent(new CustomEvent("basecoat:popover", { detail: { source: dropdownMenuComponent } }));
            trigger.setAttribute("aria-expanded", "true");
            popover.setAttribute("aria-hidden", "false");
            menuItems = Array.from(menu.querySelectorAll("[role^=\"menuitem\"]")).filter((item) => !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true");
            if (menuItems.length > 0 && initialSelection) {
                setActiveItem(initialSelection === "first" ? 0 : menuItems.length - 1);
            }
        };
        trigger.addEventListener("click", () => {
            const isExpanded = trigger.getAttribute("aria-expanded") === "true";
            if (isExpanded)
                closePopover();
            else
                openPopover(false);
        });
        dropdownMenuComponent.addEventListener("keydown", (event) => {
            var _a;
            const keyEvent = event;
            const isExpanded = trigger.getAttribute("aria-expanded") === "true";
            if (keyEvent.key === "Escape") {
                if (isExpanded)
                    closePopover();
                return;
            }
            if (!isExpanded) {
                if (["Enter", " "].includes(keyEvent.key)) {
                    keyEvent.preventDefault();
                    openPopover(false);
                }
                else if (keyEvent.key === "ArrowDown") {
                    keyEvent.preventDefault();
                    openPopover("first");
                }
                else if (keyEvent.key === "ArrowUp") {
                    keyEvent.preventDefault();
                    openPopover("last");
                }
                return;
            }
            if (menuItems.length === 0)
                return;
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
                    (_a = menuItems[activeIndex]) === null || _a === void 0 ? void 0 : _a.click();
                    closePopover();
                    return;
                default:
                    break;
            }
            if (nextIndex !== activeIndex)
                setActiveItem(nextIndex);
        });
        menu.addEventListener("mousemove", (event) => {
            var _a;
            const target = event.target;
            const menuItem = (_a = target === null || target === void 0 ? void 0 : target.closest("[role^=\"menuitem\"]")) !== null && _a !== void 0 ? _a : null;
            if (menuItem && menuItems.includes(menuItem)) {
                const index = menuItems.indexOf(menuItem);
                if (index !== activeIndex)
                    setActiveItem(index);
            }
        });
        menu.addEventListener("mouseleave", () => setActiveItem(-1));
        menu.addEventListener("click", (event) => {
            const target = event.target;
            if (target === null || target === void 0 ? void 0 : target.closest("[role^=\"menuitem\"]"))
                closePopover();
        });
        document.addEventListener("click", (event) => {
            const target = event.target;
            if (!target || !dropdownMenuComponent.contains(target))
                closePopover();
        });
        document.addEventListener("basecoat:popover", (event) => {
            var _a;
            const source = (_a = event.detail) === null || _a === void 0 ? void 0 : _a.source;
            if (source !== dropdownMenuComponent)
                closePopover(false);
        });
        dropdownMenuComponent.dataset.dropdownMenuInitialized = "true";
        dropdownMenuComponent.dispatchEvent(new CustomEvent("basecoat:initialized"));
    };
    bc.register("dropdown-menu", ".dropdown-menu:not([data-dropdown-menu-initialized])", safeInitDropdownMenu);
    bc[SPROUT_BASECOAT_PATCHED] = true;
}
