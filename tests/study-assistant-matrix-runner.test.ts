import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import { runStudyAssistantMatrix } from "../src/platform/integrations/ai/study-assistant-matrix-runner";
import type { SproutSettings } from "../src/platform/types/settings";
import {
  generateStudyAssistantChatReply,
  generateStudyAssistantSuggestions,
} from "../src/platform/integrations/ai/study-assistant-generator";

vi.mock("obsidian");
vi.mock("../src/platform/integrations/ai/study-assistant-generator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/platform/integrations/ai/study-assistant-generator")>();
  return {
    ...actual,
    generateStudyAssistantChatReply: vi.fn(),
    generateStudyAssistantSuggestions: vi.fn(),
  };
});

const mockedChatReply = vi.mocked(generateStudyAssistantChatReply);
const mockedSuggestions = vi.mocked(generateStudyAssistantSuggestions);

function makeStudyAssistantSettings(overrides: Partial<SproutSettings["studyAssistant"]> = {}): SproutSettings["studyAssistant"] {
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
    ...overrides,
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

function makeHostFixture(settings: SproutSettings["studyAssistant"]) {
  const textFiles = new Map<string, string>([
    [
      "offline/test-fixtures/test.md",
      [
        "# LearnKit matrix note",
        "",
        "Study methods are important and students should maybe do different things because some are better and some are worse and notes should probably be clearer and shorter.",
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
        "Supporting facts from the linked note help the runner compare context handling.",
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

  const app = {
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
  };

  return {
    app,
    host: {
      app: app as any,
      settings: { studyAssistant: settings } as any,
      _tx: (_token: string, fallback: string, vars?: Record<string, string | number>) => {
        let out = fallback;
        for (const [key, value] of Object.entries(vars || {})) {
          out = out.split(`{${key}}`).join(String(value));
        }
        return out;
      },
    },
  };
}

function makeRootTestFolderHostFixture(settings: SproutSettings["studyAssistant"]) {
  const textFiles = new Map<string, string>([
    [
      "Test/test.md",
      [
        "# LearnKit matrix note",
        "",
        "Study methods are important and students should maybe do different things because some are better and some are worse and notes should probably be clearer and shorter.",
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
      "Test/test-linked.md",
      [
        "# Linked note",
        "",
        "Supporting facts from the linked note help the runner compare context handling.",
      ].join("\n"),
    ],
  ]);
  const binaryFiles = new Map<string, ArrayBuffer>([
    ["Test/test.pdf", toArrayBuffer("pdf-binary")],
    ["Test/test.jpg", toArrayBuffer("jpg-binary")],
    ["Test/test.docx", toArrayBuffer("docx-binary")],
    ["Test/test.pptx", toArrayBuffer("pptx-binary")],
  ]);

  const files = new Map<string, TFile>();
  for (const path of [...textFiles.keys(), ...binaryFiles.keys()]) {
    files.set(path, makeFile(path));
  }

  const app = {
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
      getActiveFile: vi.fn(() => null),
    },
  };

  return {
    app,
    host: {
      app: app as any,
      settings: { studyAssistant: settings } as any,
      _tx: (_token: string, fallback: string, vars?: Record<string, string | number>) => {
        let out = fallback;
        for (const [key, value] of Object.entries(vars || {})) {
          out = out.split(`{${key}}`).join(String(value));
        }
        return out;
      },
    },
  };
}

describe("study assistant matrix runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedChatReply.mockImplementation(async ({ input }) => {
      const hasAttachments = (input.imageDataUrls?.length ?? 0) > 0 || (input.attachedFileDataUrls?.length ?? 0) > 0;
      const attachmentRoute = input.documentAttachmentMode === "force-fallback"
        ? "forced-fallback"
        : hasAttachments
          ? "native"
          : "none";

      if (input.mode === "edit") {
        return {
          reply: JSON.stringify({
            summary: "Rewrote the weak draft paragraph for revision.",
            edits: [{
              original: "students should maybe do different things",
              replacement: "students should use active recall and spaced repetition",
            }],
          }),
          attachmentRoute,
          payloadPreview: "edit-preview",
          rawResponseText: JSON.stringify({
            summary: "Rewrote the weak draft paragraph for revision.",
            edits: [{
              original: "students should maybe do different things",
              replacement: "students should use active recall and spaced repetition",
            }],
          }),
        };
      }

      if (input.mode === "review") {
        return {
          reply: [
            "## Strengths",
            "- Clear topic",
            "- Includes study guidance",
            "- Has concrete facts",
            "## Problems",
            "- Weak wording",
            "- Missing structure",
            "- Limited specificity",
            "## Fixes",
            "- Tighten phrasing",
            "- Add headings",
            "- Separate facts from advice",
          ].join("\n"),
          attachmentRoute,
          payloadPreview: "review-preview",
          rawResponseText: [
            "## Strengths",
            "- Clear topic",
            "- Includes study guidance",
            "- Has concrete facts",
            "## Problems",
            "- Weak wording",
            "- Missing structure",
            "- Limited specificity",
            "## Fixes",
            "- Tighten phrasing",
            "- Add headings",
            "- Separate facts from advice",
          ].join("\n"),
        };
      }

      const message = String(input.userMessage || "");
      if (message.includes("docTitle")) {
        const reply = JSON.stringify({
          status: "ok",
          docTitle: "LearnKit DOCX Attachment Test",
          facts: [
            "Mitochondria produce ATP during cellular respiration.",
            "Enzymes lower activation energy.",
            "Homeostasis helps maintain stable internal conditions.",
          ],
          summary: "The DOCX fixture contains three concise biology facts.",
        });
        return { reply, attachmentRoute, payloadPreview: "docx-preview", rawResponseText: reply };
      }
      if (message.includes("slideTexts")) {
        const reply = JSON.stringify({
          status: "ok",
          slideTexts: [
            "Capital of NZ is Wellington",
            "Capital of AU is Canberra",
          ],
          summary: "The slide states that Wellington is the capital of New Zealand and Canberra is the capital of Australia.",
        });
        return { reply, attachmentRoute, payloadPreview: "pptx-preview", rawResponseText: reply };
      }
      if (message.includes("pdfTitle")) {
        const reply = JSON.stringify({
          status: "ok",
          pdfTitle: "LearnKit PDF Attachment Test",
          facts: [
            "Water boils at 100 C at sea level.",
            "Sodium has the chemical symbol Na.",
            "Active recall is stronger than passive rereading.",
          ],
          summary: "The PDF fixture contains three short science and study facts.",
        });
        return { reply, attachmentRoute, payloadPreview: "pdf-preview", rawResponseText: reply };
      }
      if (message.includes("\"topic\"") && message.includes("\"labels\"")) {
        const reply = JSON.stringify({
          status: "ok",
          topic: "Arm veins diagram",
          labels: ["Subclavian", "Axillary", "Cephalic", "Basilic", "Median cubital"],
        });
        return { reply, attachmentRoute, payloadPreview: "image-preview", rawResponseText: reply };
      }
      if (message.includes("noteFacts")) {
        const reply = JSON.stringify({ status: "ok", noteFacts: ["Fact from note"], attachmentFacts: ["Fact from pdf"] });
        return { reply, attachmentRoute, payloadPreview: "grounding-preview", rawResponseText: reply };
      }
      if (message.includes("linked-note-only fact")) {
        const reply = [
          "## Overlap",
          "- Shared revision focus",
          "## Differences",
          "- Linked note adds metacognition and desirable difficulty context",
          "## Missing connections",
          "- Connect metacognition to active recall and feedback loops",
        ].join("\n");
        return { reply, attachmentRoute, payloadPreview: "linked-chat-preview", rawResponseText: reply };
      }
      if (message.includes("Attachment facts")) {
        const reply = [
          "## Note facts",
          "- Active recall helps retention",
          "## Attachment facts",
          "- Attachment adds supporting evidence",
          "## Combined takeaway",
          "- Use both note and attachment context",
        ].join("\n");
        return { reply, attachmentRoute, payloadPreview: "asset-chat-preview", rawResponseText: reply };
      }

      const reply = [
        "## Summary",
        "- Spaced repetition supports retention",
        "- Clear headings improve revision flow",
        "## Question",
        "- How would you turn this note into a study plan?",
      ].join("\n");
      return { reply, attachmentRoute, payloadPreview: "chat-preview", rawResponseText: reply };
    });

    mockedSuggestions.mockResolvedValue({
      suggestions: [
        { type: "basic", difficulty: 2, question: "What improves long-term retention?", answer: "Spaced repetition" },
        { type: "cloze", difficulty: 2, clozeText: "{{c1::Active recall}} is stronger than passive rereading." },
        { type: "mcq", difficulty: 2, question: "Which method is stronger than passive rereading?", options: ["Highlighting", "Active recall"], correctOptionIndexes: [1] },
        { type: "oq", difficulty: 2, question: "Put the study workflow in order", steps: ["Read the note", "Recall the key facts"] },
      ],
      attachmentRoute: "none",
      payloadPreview: "flashcards-preview",
      rawResponseText: "{\"suggestions\":[...]}",
    });
  });

  it("logs each model as it completes before the final aggregate summary", async () => {
    const { host } = makeRootTestFolderHostFixture(makeStudyAssistantSettings());
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    try {
      await runStudyAssistantMatrix(host as any, {
        models: [
          { provider: "openai", model: "gpt-4.1" },
          { provider: "openai", model: "gpt-4.1-mini" },
        ],
      });

      const debugMessages = debugSpy.mock.calls.map((call) => String(call[0] || ""));
      expect(debugMessages.some((msg) => msg.includes("openai:gpt-4.1 complete 12/24"))).toBe(true);
      expect(debugMessages.some((msg) => msg.includes("openai:gpt-4.1-mini complete 24/24"))).toBe(true);
      expect(debugMessages).toContain("LearnKit AI compatibility matrix (all models complete)");
      expect(debugMessages.some((msg) => msg.includes("# LearnKit AI compatibility summary"))).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("runs core and explicit attachment scenarios and reports passing rows", async () => {
    const { host } = makeHostFixture(makeStudyAssistantSettings());

    const result = await runStudyAssistantMatrix(host as any, {
      notePath: "offline/test-fixtures/test.md",
      models: [{ provider: "openai", model: "gpt-4.1-mini" }],
      scenarios: ["core-note", "explicit-pdf"],
      printToConsole: false,
    });

    expect(result.rows).toHaveLength(5);
    expect(result.rows.every((row) => row.status === "pass")).toBe(true);
    expect(result.rows.find((row) => row.feature === "edit")?.detail).toContain("Validated");
    expect(result.rows.find((row) => row.scenario === "explicit-pdf")?.attachmentRoute).toBe("native");
    expect(result.rows.find((row) => row.scenario === "explicit-pdf")?.attachmentRouting).toContain("native:1");
    expect(result.rows.find((row) => row.scenario === "explicit-pdf")?.detail).toContain("water boils at 100 C");
    expect(result.markdownSummary).toContain("LearnKit AI compatibility summary");
  });

  it("marks rows skipped when the selected provider has no API key", async () => {
    const { host } = makeHostFixture(makeStudyAssistantSettings({
      apiKeys: {
        openai: "",
        anthropic: "",
        deepseek: "",
        xai: "",
        google: "",
        perplexity: "",
        openrouter: "",
        custom: "",
      },
    }));

    const result = await runStudyAssistantMatrix(host as any, {
      notePath: "offline/test-fixtures/test.md",
      models: [{ provider: "anthropic", model: "claude-sonnet-4-6" }],
      scenarios: ["core-note"],
      printToConsole: false,
    });

    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((row) => row.status === "skipped")).toBe(true);
    expect(mockedChatReply).not.toHaveBeenCalled();
    expect(mockedSuggestions).not.toHaveBeenCalled();
  });

  it("runs the default matrix against four outputs plus linked note and each attachment type", async () => {
    const { host } = makeRootTestFolderHostFixture(makeStudyAssistantSettings());

    const result = await runStudyAssistantMatrix(host as any, {
      models: [{ provider: "openai", model: "gpt-4.1-mini" }],
      printToConsole: false,
    });

    expect(result.notePath).toBe("Test/test.md");
    expect(result.rows).toHaveLength(12);
    expect(result.rows.every((row) => row.status === "pass")).toBe(true);
    expect(result.rows.map((row) => `${row.scenario}:${row.feature}`)).toEqual([
      "core-note:chat",
      "core-note:review",
      "core-note:edit",
      "core-note:flashcards",
      "linked-note-context:chat",
      "explicit-docx:chat",
      "docx-fallback:chat",
      "explicit-pptx:chat",
      "pptx-fallback:chat",
      "explicit-pdf:chat",
      "pdf-fallback:chat",
      "explicit-image:chat",
    ]);
    expect(result.rows.find((row) => row.scenario === "linked-note-context")?.detail).toContain("desirable difficulty");
    expect(result.rows.find((row) => row.scenario === "explicit-docx")?.detail).toContain("mitochondria and ATP");
    expect(result.rows.find((row) => row.scenario === "explicit-docx")?.attachmentRoute).toBe("native");
    expect(result.rows.find((row) => row.scenario === "docx-fallback")?.attachmentRoute).toBe("forced-fallback");
    expect(result.rows.find((row) => row.scenario === "pptx-fallback")?.attachmentRoute).toBe("forced-fallback");
    expect(result.rows.find((row) => row.scenario === "pdf-fallback")?.attachmentRoute).toBe("forced-fallback");
    expect(result.rows.find((row) => row.scenario === "explicit-pptx")?.detail).toContain("Wellington");
    expect(result.rows.find((row) => row.scenario === "explicit-image")?.detail).toContain("subclavian");
  });
});