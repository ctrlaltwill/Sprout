// tests/__mocks__/obsidian.ts
// ---------------------------------------------------------------------------
// Minimal shim for the "obsidian" module so that source files which
// `import { TFile, Notice, ... } from "obsidian"` can be loaded by Vitest
// without the real Obsidian runtime.
// ---------------------------------------------------------------------------

export class TFile {
  name = "";
  path = "";
  basename = "";
  extension = "";
}

export class TFolder {
  name = "";
  path = "";
  children: any[] = [];
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export class Plugin {
  app: any = {};
  manifest: any = {};
  async loadData() { return {}; }
  async saveData(_data: any) {}
}

export class ItemView {
  app: any = {};
  containerEl: any = { empty() {}, createDiv() { return {}; } };
}

export class MarkdownRenderer {
  static renderMarkdown() { return Promise.resolve(); }
}
