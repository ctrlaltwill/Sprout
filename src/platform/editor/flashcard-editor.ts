import { type App, type Editor, type EventRef, MarkdownView, type Menu, type MenuItem, Platform, TFile } from "obsidian";

import type { FlashcardType } from "../core/utils";
import { log } from "../core/logger";
import { queryFirst } from "../core/ui";

type TxFn = (token: string, fallback: string, vars?: Record<string, string | number>) => string;

export function applyClozeShortcutToEditor(editor: Editor, clozeIndex = 1): void {
  const selection = String(editor.getSelection?.() ?? "");
  const tokenStart = `{{c${clozeIndex}::`;

  if (selection.length > 0) {
    editor.replaceSelection(`${tokenStart}${selection}}}`);
    return;
  }

  const cursor = editor.getCursor();
  editor.replaceSelection(`{{c${clozeIndex}::}}`);
  editor.setCursor({ line: cursor.line, ch: cursor.ch + tokenStart.length });
}

export function registerMarkdownSourceClozeShortcuts(params: {
  app: App;
  registerDomEvent: (type: "keydown", callback: (ev: KeyboardEvent) => void, options?: AddEventListenerOptions) => void;
  applyClozeShortcut: (editor: Editor, clozeIndex: number) => void;
}): void {
  const { app, registerDomEvent, applyClozeShortcut } = params;

  registerDomEvent(
    "keydown",
    (ev: KeyboardEvent) => {
      const key = String(ev.key || "").toLowerCase();
      if (key !== "c" && ev.code !== "KeyC") return;

      const primary = Platform.isMacOS ? ev.metaKey : ev.ctrlKey;
      if (!primary || !ev.shiftKey) return;

      const view = app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() !== "source" || !view.editor) return;

      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (!view.contentEl?.contains(target)) return;
      if (!target.closest(".cm-editor")) return;

      ev.preventDefault();
      ev.stopPropagation();
      applyClozeShortcut(view.editor, 1);
    },
    { capture: true },
  );
}

export function registerEditorContextMenu(params: {
  app: App;
  registerEvent: (evt: EventRef) => void;
  tx: TxFn;
  openAddFlashcardModal: (forcedType?: FlashcardType) => void;
}): void {
  const { app, registerEvent, tx, openAddFlashcardModal } = params;

  registerEvent(
    app.workspace.on("editor-menu", (menu: Menu, _editor, view) => {
      if (!(view instanceof MarkdownView)) return;

      const mode = view.getMode();
      if (mode !== "source") return;

      if (!(view.file instanceof TFile)) return;

      let itemDom: HTMLElement | null = null;

      menu.addItem((item) => {
        item.setTitle(tx("ui.main.menu.addFlashcard", "Add flashcard")).setIcon("plus");

        const submenu = item.setSubmenu?.();
        if (submenu) {
          submenu.addItem((subItem: MenuItem) => {
            subItem.setTitle(tx("ui.main.menu.basic", "Basic")).setIcon("file-text").onClick(() => openAddFlashcardModal("basic"));
          });
          submenu.addItem((subItem: MenuItem) => {
            subItem.setTitle(tx("ui.main.menu.basicReversed", "Basic (reversed)")).setIcon("file-text").onClick(() => openAddFlashcardModal("reversed"));
          });
          submenu.addItem((subItem: MenuItem) => {
            subItem.setTitle(tx("ui.main.menu.cloze", "Cloze")).setIcon("file-minus").onClick(() => openAddFlashcardModal("cloze"));
          });
          submenu.addItem((subItem: MenuItem) => {
            subItem.setTitle(tx("ui.main.menu.multipleChoice", "Multiple choice")).setIcon("list").onClick(() => openAddFlashcardModal("mcq"));
          });
          submenu.addItem((subItem: MenuItem) => {
            subItem.setTitle(tx("ui.main.menu.orderedQuestion", "Ordered question")).setIcon("list-ordered").onClick(() => openAddFlashcardModal("oq"));
          });
          submenu.addItem((subItem: MenuItem) => {
            subItem.setTitle(tx("ui.main.menu.imageOcclusion", "Image occlusion")).setIcon("image").onClick(() => openAddFlashcardModal("io"));
          });
        }

        itemDom = item?.dom ?? null;
      });

      const positionAfterExternalLink = () => {
        try {
          const menuDom: HTMLElement | null = menu?.dom ?? null;
          if (!menuDom || !itemDom) return;

          let node: HTMLElement | null = itemDom;
          while (node && node.parentElement && node.parentElement !== menuDom) {
            node = node.parentElement;
          }
          if (!node || node.parentElement !== menuDom) return;

          const menuItems = Array.from(menuDom.children);
          let externalLinkItem: Element | null = null;

          for (const item of menuItems) {
            const titleEl = queryFirst(item, ".menu-item-title");
            if (titleEl && titleEl.textContent?.includes("Add external link")) {
              externalLinkItem = item;
              break;
            }
          }

          if (externalLinkItem && externalLinkItem.nextSibling) {
            menuDom.insertBefore(node, externalLinkItem.nextSibling);
          } else if (externalLinkItem) {
            menuDom.appendChild(node);
          } else {
            if (menuDom.children.length > 1 && menuDom.children[1]) {
              menuDom.insertBefore(node, menuDom.children[1]);
            }
          }
        } catch (e) {
          log.swallow("reposition menu item", e);
        }
      };

      positionAfterExternalLink();
      setTimeout(positionAfterExternalLink, 0);
    }),
  );
}
