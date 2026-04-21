import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import { buildStudyAssistantNoteContext } from "../src/platform/integrations/ai/study-assistant-note-context";
import type { SproutSettings } from "../src/platform/types/settings";

vi.mock("obsidian");

function makeStudyAssistantSettings(): SproutSettings["studyAssistant"] {
  return {
    enabled: true,
    location: "modal",
    modalButtonVisibility: "always",
    voiceChat: false,
    provider: "openai",
    openRouterTier: "free",
    model: "gpt-4.1-mini",
    endpointOverride: "",
    apiKeys: {
      openai: "sk-openai",
      anthropic: "",
      deepseek: "",
      xai: "",
      google: "",
      perplexity: "",
      openrouter: "",
      custom: "",
    },
    prompts: {
      assistant: "Keep outputs concise.",
      noteReview: "",
      generator: "",
      tests: "",
    },
    generatorTypes: {
      basic: true,
      reversed: false,
      cloze: true,
      mcq: true,
      oq: true,
      io: false,
    },
    generatorTargetCount: 5,
    generatorOutput: {
      includeTitle: false,
      includeInfo: false,
      includeGroups: false,
    },
    privacy: {
      autoSendOnOpen: false,
      includeImagesInAsk: true,
      includeImagesInReview: true,
      includeImagesInFlashcard: true,
      includeAttachmentsInCompanion: true,
      includeLinkedNotesInCompanion: true,
      includeLinkedAttachmentsInCompanion: true,
      includeAttachmentsInExam: false,
      includeLinkedNotesInExam: false,
      includeLinkedAttachmentsInExam: false,
      linkedContextLimit: "standard",
      textAttachmentContextLimit: "standard",
      previewPayload: false,
      saveChatHistory: false,
      syncDeletesToProvider: false,
    },
  };
}

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").pop() || path;
  file.basename = file.name.replace(/\.[^.]+$/u, "");
  file.extension = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
  return file;
}

function toArrayBuffer(text: string): ArrayBuffer {
  const bytes = Uint8Array.from(Buffer.from(text, "utf8"));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function resolveRelativePath(sourceNotePath: string, link: string): string[] {
  const sourceParts = sourceNotePath.split("/");
  sourceParts.pop();
  const baseDir = sourceParts.join("/");
  return [
    `${baseDir}/${link}`,
    `${baseDir}/${link}.md`,
    link,
    `${link}.md`,
  ];
}

function makeAppFixture() {
  const textFiles = new Map<string, string>([
    [
      "offline/test-fixtures/test.md",
      [
        "# Test note",
        "",
        "Related material: [[test-linked]]",
        "",
        "![[test.pdf]]",
        "![[test.jpg]]",
        "",
        "- [DOCX fixture](test.docx)",
        "- [PPTX fixture](test.pptx)",
      ].join("\n"),
    ],
    [
      "offline/test-fixtures/test-linked.md",
      [
        "# Linked note",
        "",
        "This linked note adds supporting facts for the runner.",
      ].join("\n"),
    ],
  ]);
  const binaryFiles = new Map<string, ArrayBuffer>([
    ["offline/test-fixtures/test.pdf", toArrayBuffer("pdf-binary")],
    ["offline/test-fixtures/test.jpg", toArrayBuffer("jpg-binary")],
    ["offline/test-fixtures/test.docx", toArrayBuffer("docx-binary")],
    ["offline/test-fixtures/test.pptx", toArrayBuffer("pptx-binary")],
  ]);

  const files = new Map<string, TFile>();
  for (const path of [...textFiles.keys(), ...binaryFiles.keys()]) {
    files.set(path, makeFile(path));
  }

  return {
    app: {
      vault: {
        read: vi.fn(async (file: TFile) => textFiles.get(file.path) || ""),
        cachedRead: vi.fn(async (file: TFile) => textFiles.get(file.path) || ""),
        readBinary: vi.fn(async (file: TFile) => binaryFiles.get(file.path) || new ArrayBuffer(0)),
        getAbstractFileByPath: vi.fn((path: string) => files.get(path) || null),
      },
      metadataCache: {
        getFirstLinkpathDest: vi.fn((link: string, sourceNotePath: string) => {
          for (const candidate of resolveRelativePath(sourceNotePath, link)) {
            const file = files.get(candidate);
            if (file) return file;
          }
          return null;
        }),
      },
      workspace: {
        getActiveFile: vi.fn(() => files.get("offline/test-fixtures/test.md") || null),
      },
    },
    noteFile: files.get("offline/test-fixtures/test.md") as TFile,
  };
}

describe("study assistant note context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers noteContentOverride for live editor content", async () => {
    const { app, noteFile } = makeAppFixture();
    const settings = makeStudyAssistantSettings();
    const override = [
      "# Unsaved draft",
      "",
      "This content is newer than disk.",
      "",
      "Related material: [[test-linked]]",
    ].join("\n");

    const context = await buildStudyAssistantNoteContext({
      app: app as any,
      file: noteFile,
      settings,
      mode: "ask",
      noteContentOverride: override,
    });

    expect(context.noteContent).toBe(override);
    expect(context.noteContentForAi).toContain("This content is newer than disk.");
    expect(context.linkedNotesContext).toContain("Linked note");
    expect(app.vault.read).not.toHaveBeenCalled();
  });

  it("collects linked note text, embedded image data, and linked attachment data for ask mode", async () => {
    const { app, noteFile } = makeAppFixture();
    const settings = makeStudyAssistantSettings();

    const context = await buildStudyAssistantNoteContext({
      app: app as any,
      file: noteFile,
      settings,
      mode: "ask",
    });

    expect(context.linkedNotesContext).toContain("Linked note");
    expect(context.linkedContextStats.included).toBe(1);
    expect(context.imageRefs).toEqual(["test.jpg"]);
    expect(context.imageDescriptors).toEqual([
      expect.objectContaining({
        ref: "test.jpg",
        order: 1,
        heading: "Test note",
        headingPath: "Test note",
      }),
    ]);
    expect(context.imageDescriptors[0]?.contextSnippet).toContain("Related material:");
    expect(context.imageDataUrls).toHaveLength(1);
    expect(context.attachedFileDataUrls).toHaveLength(3);
    expect(context.noteContentForAi).toContain("Additional Companion custom instructions");
  });

  it("keeps edit mode limited to note content and images", async () => {
    const { app, noteFile } = makeAppFixture();
    const settings = makeStudyAssistantSettings();

    const context = await buildStudyAssistantNoteContext({
      app: app as any,
      file: noteFile,
      settings,
      mode: "edit",
    });

    expect(context.imageDataUrls).toHaveLength(1);
    expect(context.attachedFileDataUrls).toHaveLength(0);
    expect(context.linkedNotesContext).toBe("");
    expect(context.noteContentForAi).not.toContain("Additional Companion custom instructions");
  });
});