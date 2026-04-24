/**
 * @file src/platform/editor/flashcard-editor.ts
 * @summary Module for flashcard editor.
 *
 * @exports
 *  - applyClozeShortcutToEditor
 *  - registerMarkdownSourceClozeShortcuts
 *  - registerEditorContextMenu
 */
import { MarkdownView, Platform, TFile } from "obsidian";
import { log } from "../core/logger";
import { queryFirst } from "../core/ui";
export function applyClozeShortcutToEditor(editor, clozeIndex = 1) {
    var _a, _b;
    const selection = String((_b = (_a = editor.getSelection) === null || _a === void 0 ? void 0 : _a.call(editor)) !== null && _b !== void 0 ? _b : "");
    const tokenStart = `{{c${clozeIndex}::`;
    if (selection.length > 0) {
        editor.replaceSelection(`${tokenStart}${selection}}}`);
        return;
    }
    const cursor = editor.getCursor();
    editor.replaceSelection(`{{c${clozeIndex}::}}`);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + tokenStart.length });
}
export function registerMarkdownSourceClozeShortcuts(params) {
    const { app, registerDomEvent, applyClozeShortcut } = params;
    registerDomEvent("keydown", (ev) => {
        var _a;
        const key = String(ev.key || "").toLowerCase();
        if (key !== "c" && ev.code !== "KeyC")
            return;
        const primary = Platform.isMacOS ? ev.metaKey : ev.ctrlKey;
        if (!primary || !ev.shiftKey)
            return;
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== "source" || !view.editor)
            return;
        const target = ev.target;
        if (!target)
            return;
        if (!((_a = view.contentEl) === null || _a === void 0 ? void 0 : _a.contains(target)))
            return;
        if (!target.closest(".cm-editor"))
            return;
        ev.preventDefault();
        ev.stopPropagation();
        applyClozeShortcut(view.editor, 1);
    }, { capture: true });
}
export function registerEditorContextMenu(params) {
    const { app, registerEvent, tx, openAddFlashcardModal } = params;
    registerEvent(app.workspace.on("editor-menu", (menu, _editor, view) => {
        if (!(view instanceof MarkdownView))
            return;
        const mode = view.getMode();
        if (mode !== "source")
            return;
        if (!(view.file instanceof TFile))
            return;
        let itemDom = null;
        menu.addItem((item) => {
            var _a, _b;
            item.setTitle(tx("ui.main.menu.addFlashcard", "Add flashcard")).setIcon("plus");
            const submenu = (_a = item.setSubmenu) === null || _a === void 0 ? void 0 : _a.call(item);
            if (submenu) {
                submenu.addItem((subItem) => {
                    subItem.setTitle(tx("ui.main.menu.basic", "Basic")).setIcon("file-text").onClick(() => openAddFlashcardModal("basic"));
                });
                submenu.addItem((subItem) => {
                    subItem.setTitle(tx("ui.main.menu.basicReversed", "Basic (reversed)")).setIcon("file-text").onClick(() => openAddFlashcardModal("reversed"));
                });
                submenu.addItem((subItem) => {
                    subItem.setTitle(tx("ui.main.menu.cloze", "Cloze")).setIcon("file-minus").onClick(() => openAddFlashcardModal("cloze"));
                });
                submenu.addItem((subItem) => {
                    subItem.setTitle(tx("ui.main.menu.multipleChoice", "Multiple choice")).setIcon("list").onClick(() => openAddFlashcardModal("mcq"));
                });
                submenu.addItem((subItem) => {
                    subItem.setTitle(tx("ui.main.menu.orderedQuestion", "Ordered question")).setIcon("list-ordered").onClick(() => openAddFlashcardModal("oq"));
                });
                submenu.addItem((subItem) => {
                    subItem.setTitle(tx("ui.main.menu.imageOcclusion", "Image occlusion")).setIcon("image").onClick(() => openAddFlashcardModal("io"));
                });
            }
            itemDom = (_b = item === null || item === void 0 ? void 0 : item.dom) !== null && _b !== void 0 ? _b : null;
        });
        const positionAfterExternalLink = () => {
            var _a, _b;
            try {
                const menuDom = (_a = menu === null || menu === void 0 ? void 0 : menu.dom) !== null && _a !== void 0 ? _a : null;
                if (!menuDom || !itemDom)
                    return;
                let node = itemDom;
                while (node && node.parentElement && node.parentElement !== menuDom) {
                    node = node.parentElement;
                }
                if (!node || node.parentElement !== menuDom)
                    return;
                const menuItems = Array.from(menuDom.children);
                let externalLinkItem = null;
                for (const item of menuItems) {
                    const titleEl = queryFirst(item, ".menu-item-title");
                    if (titleEl && ((_b = titleEl.textContent) === null || _b === void 0 ? void 0 : _b.includes("Add external link"))) {
                        externalLinkItem = item;
                        break;
                    }
                }
                if (externalLinkItem && externalLinkItem.nextSibling) {
                    menuDom.insertBefore(node, externalLinkItem.nextSibling);
                }
                else if (externalLinkItem) {
                    menuDom.appendChild(node);
                }
                else {
                    if (menuDom.children.length > 1 && menuDom.children[1]) {
                        menuDom.insertBefore(node, menuDom.children[1]);
                    }
                }
            }
            catch (e) {
                log.swallow("reposition menu item", e);
            }
        };
        positionAfterExternalLink();
        setTimeout(positionAfterExternalLink, 0);
    }));
}
