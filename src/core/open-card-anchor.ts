import { type App, MarkdownView, TFile, type WorkspaceLeaf } from "obsidian";

type OpenCardAnchorOptions = {
  openInNewLeaf?: boolean;
  preferredLeaf?: WorkspaceLeaf;
};

function normalizeSproutAnchorId(cardId: string): string {
  const raw = String(cardId || "").trim();
  const noHash = raw.startsWith("#^") ? raw.slice(2) : raw;
  const noCaret = noHash.startsWith("^") ? noHash.slice(1) : noHash;
  if (!noCaret) return "";
  if (noCaret.startsWith("sprout-")) return noCaret;
  if (/^\d{9}$/.test(noCaret)) return `sprout-${noCaret}`;
  return noCaret;
}

export async function openCardAnchorInNote(
  app: App,
  sourceNotePath: string,
  cardId: string,
  opts?: OpenCardAnchorOptions,
): Promise<boolean> {
  const path = String(sourceNotePath || "").trim();
  const anchorId = normalizeSproutAnchorId(cardId);
  if (!path || !anchorId) return false;

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;

  const openInNewLeaf = opts?.openInNewLeaf ?? true;
  const leaf = opts?.preferredLeaf ?? app.workspace.getLeaf(openInNewLeaf);
  await leaf.setViewState(
    {
      type: "markdown",
      state: { file: file.path, mode: "source" },
      active: true,
    },
    { focus: true },
  );

  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return false;

  const waitForEditor = async () => {
    for (let i = 0; i < 30; i++) {
      const editor = view.editor;
      if (editor) return editor;
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  };

  const editor = await waitForEditor();
  if (!editor) return false;

  const needle = `^${anchorId}`;
  const text = await app.vault.read(file);
  const lines = text.split(/\r?\n/);

  let lineNo = lines.findIndex((line) => line.includes(needle));
  if (lineNo < 0) {
    await app.workspace.openLinkText(`${path}#^${anchorId}`, path, openInNewLeaf);
    return false;
  }

  if (lines[lineNo].trim() === needle) {
    let next = lineNo + 1;
    while (next < lines.length && lines[next].trim() === "") next += 1;
    if (next < lines.length) lineNo = next;
  }

  editor.setCursor({ line: lineNo, ch: 0 });
  editor.scrollIntoView({ from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: 0 } }, true);
  editor.focus();

  return true;
}
