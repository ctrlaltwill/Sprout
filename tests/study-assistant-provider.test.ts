import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import {
  requestStudyAssistantCompletionDetailed,
  requestStudyAssistantStreamingCompletion,
} from "../src/platform/integrations/ai/study-assistant-provider";
import type { SproutSettings } from "../src/platform/types/settings";

vi.mock("obsidian");

function makeApiKeys(overrides: Partial<SproutSettings["studyAssistant"]["apiKeys"]> = {}) {
  return {
    openai: "",
    anthropic: "",
    deepseek: "",
    xai: "",
    google: "",
    perplexity: "",
    openrouter: "",
    custom: "",
    ...overrides,
  } as SproutSettings["studyAssistant"]["apiKeys"];
}

function makeStudyAssistant(
  overrides: Partial<SproutSettings["studyAssistant"]> = {},
): SproutSettings["studyAssistant"] {
  return {
    enabled: true,
    location: "modal",
    modalButtonVisibility: "always",
    voiceChat: false,
    provider: "openai",
    openRouterTier: "free",
    model: "gpt-4.1-mini",
    endpointOverride: "",
    apiKeys: makeApiKeys({ openai: "sk-openai" }),
    prompts: {
      assistant: "",
      noteReview: "",
      generator: "",
      tests: "",
    },
    generatorTypes: {
      basic: true,
      reversed: true,
      cloze: true,
      mcq: true,
      oq: true,
      io: true,
    },
    generatorTargetCount: 5,
    generatorOutput: {
      includeTitle: true,
      includeInfo: true,
      includeGroups: true,
    },
    privacy: {
      autoSendOnOpen: false,
      includeImagesInAsk: true,
      includeImagesInReview: true,
      includeImagesInFlashcard: true,
      includeAttachmentsInCompanion: true,
      includeLinkedNotesInCompanion: true,
      includeLinkedAttachmentsInCompanion: true,
      includeAttachmentsInExam: true,
      includeLinkedNotesInExam: true,
      includeLinkedAttachmentsInExam: true,
      linkedContextLimit: "standard",
      textAttachmentContextLimit: "standard",
      previewPayload: false,
      saveChatHistory: false,
      syncDeletesToProvider: false,
    },
    ...overrides,
  } as SproutSettings["studyAssistant"];
}

function makeResponsesSuccessResponse(text = "ok") {
  return {
    status: 200,
    json: {
      output: [{
        type: "message",
        content: [{ type: "output_text", text }],
      }],
    },
    text: "",
    headers: {},
  } as any;
}

function makeChatSuccessResponse(text = "ok") {
  return {
    status: 200,
    json: {
      choices: [{ message: { content: text } }],
    },
    text: "",
    headers: {},
  } as any;
}

function makeAnthropicSuccessResponse(text = "ok") {
  return {
    status: 200,
    json: {
      content: [{ type: "text", text }],
    },
    text: "",
    headers: {},
  } as any;
}

function makeProviderErrorResponse(status = 400, message = "Bad request") {
  return {
    status,
    json: {
      error: {
        message,
      },
    },
    text: message,
    headers: {},
  } as any;
}

function makeOpenRouterModelsResponse(models: Array<Record<string, unknown>>) {
  return {
    status: 200,
    json: {
      data: models,
    },
    text: "",
    headers: {},
  } as any;
}

function makeStreamingFetchResponse(chunks: string[], status = 200, headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status,
      headers: {
        "content-type": "text/event-stream",
        ...headers,
      },
    },
  );
}

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makeFlatePdfDataUrl(lines: string[]): string {
  const contentLines = ["BT", "/F1 14 Tf", "72 720 Td"];
  lines.forEach((line, index) => {
    if (index > 0) contentLines.push("0 -24 Td");
    contentLines.push(`(${escapePdfLiteral(line)}) Tj`);
  });
  contentLines.push("ET");

  const stream = Buffer.from(contentLines.join("\n"), "latin1");
  const compressed = deflateSync(stream);
  const prefix = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
    "latin1",
  );
  const suffix = Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1");
  return `data:application/pdf;base64,${Buffer.concat([prefix, compressed, suffix]).toString("base64")}`;
}

describe("study assistant provider attachments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", undefined);
  });

  it("uses Responses API input_file blocks for OpenAI document attachments", async () => {
    vi.mocked(requestUrl).mockResolvedValue(makeResponsesSuccessResponse("done"));

    const settings = makeStudyAssistant({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKeys: makeApiKeys({ openai: "sk-openai" }),
    });

    const result = await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Summarize this file.",
      attachedFileDataUrls: [
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,QUJD",
      ],
    });

    expect(result.text).toBe("done");
    expect(requestUrl).toHaveBeenCalledOnce();

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.openai.com/v1/responses");

    const body = JSON.parse(call.body);
    expect(body.instructions).toBe("You are helpful.");
    expect(body.input[0].content[0]).toEqual({ type: "input_text", text: "Summarize this file." });
    expect(body.input[0].content[1]).toEqual({
      type: "input_file",
      filename: "attachment.docx",
      file_data: "QUJD",
    });
  });

  it("uses Responses API file inputs for Perplexity OpenAI-compatible models", async () => {
    vi.mocked(requestUrl).mockResolvedValue(makeResponsesSuccessResponse("done"));

    const settings = makeStudyAssistant({
      provider: "perplexity",
      model: "openai/gpt-5.4",
      apiKeys: makeApiKeys({ perplexity: "pplx-key" }),
    });

    await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Summarize this file.",
      attachedFileDataUrls: [
        "data:application/pdf;base64,JVBERi0x",
      ],
    });

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.perplexity.ai/v1/responses");

    const body = JSON.parse(call.body);
    expect(body.input[0].content[1]).toEqual({
      type: "input_file",
      filename: "attachment.pdf",
      file_data: "JVBERi0x",
    });
  });

  it("keeps PDFs native for Anthropic while falling unsupported docs back to text", async () => {
    vi.mocked(requestUrl).mockResolvedValue(makeAnthropicSuccessResponse("done"));

    const settings = makeStudyAssistant({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKeys: makeApiKeys({ anthropic: "sk-anthropic" }),
    });

    await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Summarize these files.",
      attachedFileDataUrls: [
        "data:application/pdf;base64,JVBERi0x",
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA",
      ],
    });

    expect(requestUrl).toHaveBeenCalledOnce();

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");

    const body = JSON.parse(call.body);
    const content = body.messages[0].content as any[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Note: 1 attached document file(s) could not be sent natively");
    expect(content[1]).toEqual({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: "JVBERi0x",
      },
    });
    expect(content).toHaveLength(2);
  });

  it("uses native DOCX and PPTX blocks for DeepSeek while falling PDF back to text", async () => {
    vi.mocked(requestUrl).mockResolvedValue(makeChatSuccessResponse("done"));

    const settings = makeStudyAssistant({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKeys: makeApiKeys({ deepseek: "sk-deepseek" }),
    });

    await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Summarize these files.",
      attachedFileDataUrls: [
        makeFlatePdfDataUrl([
          "PDF Fact 1: Water boils at 100 C at sea level.",
          "PDF Fact 2: Sodium has the chemical symbol Na.",
        ]),
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA",
        "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,BBBB",
      ],
    });

    expect(requestUrl).toHaveBeenCalledOnce();

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.deepseek.com/chat/completions");

    const body = JSON.parse(call.body);
    expect(Array.isArray(body.messages[1].content)).toBe(true);
    expect(body.messages[1].content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("PDF Fact 1: Water boils at 100 C at sea level."),
    });
    expect(body.messages[1].content[0].text).toContain("PDF Fact 2: Sodium has the chemical symbol Na.");
    expect(body.messages[1].content[0].text).toContain("Additional attachment context (text-extracted fallback for document attachments):");
    expect(body.messages[1].content[0].text).not.toContain("could not be sent natively and were omitted from the request");
    expect(body.messages[1].content[1]).toEqual({
      type: "file",
      file: {
        filename: "attachment.docx",
        file_data: "AAAA",
      },
    });
    expect(body.messages[1].content[2]).toEqual({
      type: "file",
      file: {
        filename: "attachment.pptx",
        file_data: "BBBB",
      },
    });
  });

  it("uses DeepSeek reasoner with inline system instructions and native DOCX blocks", async () => {
    vi.mocked(requestUrl).mockResolvedValue(makeChatSuccessResponse("done"));

    const settings = makeStudyAssistant({
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKeys: makeApiKeys({ deepseek: "sk-deepseek" }),
    });

    await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Review this note.",
      attachedFileDataUrls: [
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA",
      ],
    });

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    const body = JSON.parse(call.body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("System instructions:\nYou are helpful.\n\nReview this note."),
    });
    expect(body.messages[0].content[1]).toEqual({
      type: "file",
      file: {
        filename: "attachment.docx",
        file_data: "AAAA",
      },
    });
    expect(body.temperature).toBeUndefined();
  });

  it("retries DeepSeek JSON requests with a minimal compatibility body after HTTP 400", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(makeProviderErrorResponse(400, "Bad request"))
      .mockResolvedValueOnce(makeChatSuccessResponse('{"suggestions":[]}'));

    const settings = makeStudyAssistant({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKeys: makeApiKeys({ deepseek: "sk-deepseek" }),
    });

    const result = await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Generate a JSON response.",
      mode: "json",
    });

    expect(result.text).toBe('{"suggestions":[]}');
    expect(requestUrl).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((vi.mocked(requestUrl).mock.calls[0][0] as any).body);
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(firstBody.temperature).toBe(0.4);

    const secondBody = JSON.parse((vi.mocked(requestUrl).mock.calls[1][0] as any).body);
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.temperature).toBeUndefined();
    expect(secondBody.max_tokens).toBe(4096);
  });

  it("retries OpenAI Responses JSON requests with a compatibility body after HTTP 400", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(makeProviderErrorResponse(400, "Unsupported parameter: text.format"))
      .mockResolvedValueOnce(makeResponsesSuccessResponse('{"questions":[]}'));

    const settings = makeStudyAssistant({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKeys: makeApiKeys({ openai: "sk-openai" }),
    });

    const result = await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Generate a JSON response.",
      mode: "json",
    });

    expect(result.text).toBe('{"questions":[]}');
    expect(requestUrl).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((vi.mocked(requestUrl).mock.calls[0][0] as any).body);
    expect(firstBody.instructions).toBe("You are helpful.");
    expect(firstBody.text).toEqual({ format: { type: "json_object" } });
    expect(firstBody.temperature).toBe(0.4);

    const secondBody = JSON.parse((vi.mocked(requestUrl).mock.calls[1][0] as any).body);
    expect(secondBody.instructions).toBeUndefined();
    expect(secondBody.text).toBeUndefined();
    expect(secondBody.temperature).toBeUndefined();
    expect(secondBody.input[0].content[0]).toEqual({
      type: "input_text",
      text: "System instructions:\nYou are helpful.\n\nGenerate a JSON response.",
    });
  });

  it("retries OpenRouter chat JSON requests with a compatibility body after HTTP 400", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(makeProviderErrorResponse(400, "Unsupported parameter: temperature"))
      .mockResolvedValueOnce(makeChatSuccessResponse('{"questions":[]}'));

    const settings = makeStudyAssistant({
      provider: "openrouter",
      model: "meta-llama/llama-3.1-70b-instruct",
      apiKeys: makeApiKeys({ openrouter: "sk-or-test" }),
    });

    const result = await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Generate a JSON response.",
      mode: "json",
    });

    expect(result.text).toBe('{"questions":[]}');
    expect(requestUrl).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((vi.mocked(requestUrl).mock.calls[0][0] as any).body);
  expect(firstBody.response_format).toBeUndefined();
    expect(firstBody.temperature).toBe(0.4);
    expect(firstBody.messages[0]).toEqual({ role: "system", content: "You are helpful." });

    const secondBody = JSON.parse((vi.mocked(requestUrl).mock.calls[1][0] as any).body);
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.temperature).toBeUndefined();
    expect(secondBody.messages).toEqual([
      {
        role: "user",
        content: "System instructions:\nYou are helpful.\n\nGenerate a JSON response.",
      },
    ]);
  });

  it("keeps xAI on Responses API but falls document binaries back to text", async () => {
    vi.mocked(requestUrl).mockResolvedValue(makeResponsesSuccessResponse("done"));

    const settings = makeStudyAssistant({
      provider: "xai",
      model: "grok-4-0709",
      apiKeys: makeApiKeys({ xai: "xai-key" }),
    });

    await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Summarize this file.",
      attachedFileDataUrls: [
        "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,AAAA",
      ],
    });

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.x.ai/v1/responses");

    const body = JSON.parse(call.body);
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: expect.stringContaining("could not be sent natively and were omitted from the request") },
    ]);
  });

  it("retries OpenRouter chat requests with the current model id from the catalog after HTTP 404", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(makeProviderErrorResponse(404, "model_not_found"))
      .mockResolvedValueOnce(makeOpenRouterModelsResponse([
        {
          id: "openai/gpt-5",
          canonical_slug: "openai/gpt-5.4",
          name: "OpenAI: GPT-5",
        },
      ]))
      .mockResolvedValueOnce(makeChatSuccessResponse("done"));

    const settings = makeStudyAssistant({
      provider: "openrouter",
      model: "openai/gpt-5.4",
      apiKeys: makeApiKeys({ openrouter: "sk-or-test" }),
    });

    const result = await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Say hello.",
    });

    expect(result.text).toBe("done");
    expect(requestUrl).toHaveBeenCalledTimes(3);

    const firstCall = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(firstCall.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(firstCall.body).model).toBe("openai/gpt-5.4");

    const secondCall = vi.mocked(requestUrl).mock.calls[1][0] as any;
    expect(secondCall.url).toBe("https://openrouter.ai/api/v1/models");

    const thirdCall = vi.mocked(requestUrl).mock.calls[2][0] as any;
    expect(thirdCall.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(thirdCall.body).model).toBe("openai/gpt-5");
  });

  it("streams Responses API text deltas from fetch chunks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamingFetchResponse([
      'data: {"type":"response.output_text.delta","delta":"Hel',
      '"}\n',
      'data: {"type":"response.output_text.delta","delta":"lo"}\n',
      'data: {"type":"response.completed","response":{"id":"resp_123"}}\n',
      'data: [DONE]\n',
    ])));

    const settings = makeStudyAssistant({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKeys: makeApiKeys({ openai: "sk-openai" }),
    });

    const chunks: string[] = [];
    const result = await requestStudyAssistantStreamingCompletion({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Say hello.",
      onChunk: (token) => chunks.push(token),
    });

    expect(result.text).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(requestUrl).not.toHaveBeenCalled();

    const call = vi.mocked(globalThis.fetch as typeof fetch).mock.calls[0] as any[];
    expect(call[0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(call[1]?.body || "{}"));
    expect(body.input[0].content[0]).toEqual({ type: "input_text", text: "Say hello." });
  });

  it("falls back to buffered requestUrl when fetch transport fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      json: {},
      headers: {},
      text: [
        'data: {"type":"response.output_text.delta","delta":"Hel"}',
        'data: {"type":"response.output_text.delta","delta":"lo"}',
        'data: {"type":"response.completed","response":{"id":"resp_123"}}',
        "data: [DONE]",
      ].join("\n"),
    } as any);

    const settings = makeStudyAssistant({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKeys: makeApiKeys({ openai: "sk-openai" }),
    });

    const chunks: string[] = [];
    const result = await requestStudyAssistantStreamingCompletion({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Say hello.",
      onChunk: (token) => chunks.push(token),
    });

    expect(result.text).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(requestUrl).toHaveBeenCalledOnce();

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(call.body);
    expect(body.input[0].content[0]).toEqual({ type: "input_text", text: "Say hello." });
  });

  it("retries DeepSeek streaming requests with a minimal compatibility body after HTTP 400", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(makeProviderErrorResponse(400, "Bad request"))
      .mockResolvedValueOnce({
        status: 200,
        json: {},
        headers: {},
        text: [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}',
          'data: {"choices":[{"delta":{"content":"lo"}}]}',
          "data: [DONE]",
        ].join("\n"),
      } as any);

    const settings = makeStudyAssistant({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKeys: makeApiKeys({ deepseek: "sk-deepseek" }),
    });

    const chunks: string[] = [];
    const result = await requestStudyAssistantStreamingCompletion({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Say hello.",
      onChunk: (token) => chunks.push(token),
    });

    expect(result.text).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(requestUrl).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((vi.mocked(requestUrl).mock.calls[0][0] as any).body);
    expect(firstBody.temperature).toBe(0.4);

    const secondBody = JSON.parse((vi.mocked(requestUrl).mock.calls[1][0] as any).body);
    expect(secondBody.temperature).toBeUndefined();
    expect(secondBody.max_tokens).toBe(4096);
  });

  it("retries OpenRouter streaming requests after HTTP 404 using a catalog name match", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(makeProviderErrorResponse(404, "model_not_found"))
      .mockResolvedValueOnce(makeOpenRouterModelsResponse([
        {
          id: "anthropic/claude-sonnet-4-5",
          canonical_slug: "anthropic/claude-sonnet-4.6",
          name: "Anthropic: Claude Sonnet 4.6",
        },
      ]))
      .mockResolvedValueOnce({
        status: 200,
        json: {},
        headers: {},
        text: [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}',
          'data: {"choices":[{"delta":{"content":"lo"}}]}',
          'data: [DONE]',
        ].join("\n"),
      } as any);

    const settings = makeStudyAssistant({
      provider: "openrouter",
      model: "Anthropic: Claude Sonnet 4.6",
      apiKeys: makeApiKeys({ openrouter: "sk-or-test" }),
    });

    const chunks: string[] = [];
    const result = await requestStudyAssistantStreamingCompletion({
      settings,
      systemPrompt: "You are helpful.",
      userPrompt: "Say hello.",
      onChunk: (token) => chunks.push(token),
    });

    expect(result.text).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(requestUrl).toHaveBeenCalledTimes(3);

    const firstCall = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(JSON.parse(firstCall.body).model).toBe("Anthropic: Claude Sonnet 4.6");

    const thirdCall = vi.mocked(requestUrl).mock.calls[2][0] as any;
    expect(JSON.parse(thirdCall.body).model).toBe("anthropic/claude-sonnet-4-5");
  });
});