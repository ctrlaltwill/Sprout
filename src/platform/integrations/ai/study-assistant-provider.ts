/**
 * @file src/platform/integrations/ai/study-assistant-provider.ts
 * @summary Module for study assistant provider.
 *
 * @exports
 *  - requestStudyAssistantCompletionDetailed
 *  - requestStudyAssistantCompletion
 *  - deleteStudyAssistantConversation
 */

import { requestUrl } from "obsidian";
import type { SproutSettings } from "../../types/settings";
import type { StudyAssistantProvider } from "./study-assistant-types";
import { getTextAttachmentLimits, type ContextLimitPreset } from "./study-assistant-types";
import { splitTextLikeAttachmentDataUrls } from "./attachment-helpers";

type CompletionMode = "text" | "json";

type CompletionResult = {
  text: string;
  conversationId?: string;
};

type DeleteConversationResult = {
  deleted: boolean;
  unsupported?: boolean;
  status?: number;
  detail?: string;
};

type ProviderRequestError = Error & {
  provider?: StudyAssistantProvider;
  status?: number;
  detail?: string;
  code?: string;
  errorType?: string;
  endpoint?: string;
  responseText?: string;
  responseJson?: unknown;
  originalError?: unknown;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function providerBaseUrl(settings: SproutSettings["studyAssistant"]): string {
  const override = String(settings.endpointOverride || "").trim();
  if (settings.provider === "custom" && override) {
    if (!isValidHttpUrl(override)) {
      throw new Error(`Invalid endpoint URL: must start with https:// or http://`);
    }
    return trimTrailingSlash(override);
  }

  if (settings.provider === "custom") return "";

  if (settings.provider === "openai") return "https://api.openai.com/v1";
  if (settings.provider === "anthropic") return "https://api.anthropic.com/v1";
  if (settings.provider === "deepseek") return "https://api.deepseek.com/v1";
  if (settings.provider === "xai") return "https://api.x.ai/v1";
  if (settings.provider === "google") return "https://generativelanguage.googleapis.com/v1beta/openai";
  if (settings.provider === "perplexity") return "https://api.perplexity.ai";
  if (settings.provider === "openrouter") return "https://openrouter.ai/api/v1";
  return "";
}

function providerApiKey(
  provider: StudyAssistantProvider,
  apiKeys: SproutSettings["studyAssistant"]["apiKeys"],
): string {
  if (provider === "openai") return String(apiKeys.openai || "").trim();
  if (provider === "anthropic") return String(apiKeys.anthropic || "").trim();
  if (provider === "deepseek") return String(apiKeys.deepseek || "").trim();
  if (provider === "xai") return String(apiKeys.xai || "").trim();
  if (provider === "google") return String(apiKeys.google || "").trim();
  if (provider === "perplexity") return String(apiKeys.perplexity || "").trim();
  if (provider === "openrouter") return String(apiKeys.openrouter || "").trim();
  return String(apiKeys.custom || "").trim();
}

function parseJsonFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

const POISONED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeJsonResponse(value: unknown, depth = 0): unknown {
  if (depth > 20) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonResponse(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (POISONED_KEYS.has(key)) continue;
      out[key] = sanitizeJsonResponse((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  return value;
}

function assertOpenAiLikeResponseShape(json: Record<string, unknown>): void {
  if (!Array.isArray(json.choices)) {
    throw new Error("Invalid response from provider: missing 'choices' array.");
  }
}

function assertAnthropicResponseShape(json: Record<string, unknown>): void {
  if (!Array.isArray(json.content)) {
    throw new Error("Invalid response from Anthropic: missing 'content' array.");
  }
}

function shouldOmitTemperature(provider: StudyAssistantProvider, model: string): boolean {
  if (provider !== "openai") return false;
  const m = String(model || "").trim().toLowerCase();
  // Some OpenAI model families enforce fixed/default sampling behavior.
  return m.startsWith("gpt-5") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

function openRouterAlternateModelId(model: string): string {
  const value = String(model || "").trim();
  if (!value) return "";
  return /:free$/i.test(value) ? value.replace(/:free$/i, "") : `${value}:free`;
}

function providerErrorDetail(res: { json?: unknown; text?: string }): string {
  const json = parseJsonFromUnknown(res.json);
  const err = parseJsonFromUnknown(json?.error);
  const message = typeof err?.message === "string" ? err.message.trim() : "";
  if (message) return message;
  const rawText = typeof res.text === "string" ? res.text.trim() : "";
  return rawText;
}

function providerErrorCode(res: { json?: unknown; text?: string }): string {
  const json = parseJsonFromUnknown(res.json);
  const err = parseJsonFromUnknown(json?.error);
  const code = typeof err?.code === "string" ? err.code.trim() : "";
  if (code) return code;
  const type = typeof err?.type === "string" ? err.type.trim() : "";
  if (type) return type;
  const status = typeof json?.status === "string" ? json.status.trim() : "";
  if (status) return status;
  const rawText = typeof res.text === "string" ? res.text.trim() : "";
  const fromText = rawText.match(/\b([A-Z_]{3,}|[a-z_]{3,}(?:_error|_exceeded|_found|_denied|_quota))\b/);
  return fromText?.[1] ? fromText[1].trim() : "";
}

function providerErrorType(res: { json?: unknown }): string {
  const json = parseJsonFromUnknown(res.json);
  const err = parseJsonFromUnknown(json?.error);
  const type = typeof err?.type === "string" ? err.type.trim() : "";
  return type;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function statusFromUnknownError(err: unknown): number | null {
  const obj = recordFromUnknown(err);
  const statusRaw = obj?.status;
  const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw);
  if (Number.isFinite(status) && status >= 100 && status <= 599) return Math.floor(status);

  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const fromMessage = message.match(/status\s+(\d{3})/i)?.[1];
  if (fromMessage) {
    const parsed = Number(fromMessage);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function responseTextFromUnknownError(err: unknown): string {
  const obj = recordFromUnknown(err);
  const candidates: unknown[] = [
    obj?.text,
    recordFromUnknown(obj?.response)?.text,
    obj?.body,
    recordFromUnknown(obj?.response)?.body,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return "";
}

function responseJsonFromUnknownError(err: unknown): unknown {
  const obj = recordFromUnknown(err);
  const direct = obj?.json;
  if (direct !== undefined) return direct;

  const responseObj = recordFromUnknown(obj?.response);
  if (responseObj?.json !== undefined) return responseObj.json;

  const rawText = responseTextFromUnknownError(err);
  if (!rawText) return undefined;
  try {
    return JSON.parse(rawText);
  } catch {
    return undefined;
  }
}

function buildProviderRequestError(args: {
  provider: StudyAssistantProvider;
  endpoint: string;
  status: number;
  detail?: string;
  code?: string;
  errorType?: string;
  responseText?: string;
  responseJson?: unknown;
  originalError?: unknown;
}): ProviderRequestError {
  const { provider, endpoint, status, detail = "", code = "", errorType = "", responseText = "", responseJson, originalError } = args;
  const err = new Error(`${provider} request failed (${status})`) as ProviderRequestError;
  err.provider = provider;
  err.endpoint = endpoint;
  err.status = status;
  if (detail) err.detail = detail;
  if (code) err.code = code;
  if (errorType) err.errorType = errorType;
  if (responseText) err.responseText = responseText;
  if (responseJson !== undefined) err.responseJson = responseJson;
  if (originalError !== undefined) err.originalError = originalError;
  return err;
}

function extractTextFromOpenAiLikeResponse(json: Record<string, unknown>): string {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const firstChoice = parseJsonFromUnknown(choices[0]);
  const message = parseJsonFromUnknown(firstChoice?.message);
  const content = message?.content;

  if (typeof content === "string") return content;

  if (content && typeof content === "object" && !Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      // ignore
    }
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      const obj = parseJsonFromUnknown(block);
      if (typeof obj?.text === "string") parts.push(obj.text);
    }
    if (parts.length) return parts.join("\n");
  }

  const functionCall = parseJsonFromUnknown(message?.function_call);
  if (typeof functionCall?.arguments === "string" && functionCall.arguments.trim()) {
    return functionCall.arguments.trim();
  }

  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (const toolCall of toolCalls) {
    const toolObj = parseJsonFromUnknown(toolCall);
    const fn = parseJsonFromUnknown(toolObj?.function);
    if (typeof fn?.arguments === "string" && fn.arguments.trim()) {
      return fn.arguments.trim();
    }
  }

  return "";
}

function extractTextFromAnthropicResponse(json: Record<string, unknown>): string {
  const content = Array.isArray(json.content) ? json.content : [];
  const parts: string[] = [];

  for (const block of content) {
    const obj = parseJsonFromUnknown(block);
    if (!obj) continue;
    if (obj.type === "text" && typeof obj.text === "string") {
      parts.push(obj.text);
    }
  }

  return parts.join("\n").trim();
}

function extractConversationIdFromResponse(json: Record<string, unknown> | null): string | null {
  if (!json) return null;

  const directKeys = ["conversation_id", "conversationId", "thread_id", "threadId"] as const;
  for (const key of directKeys) {
    const value = json[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const nestedConversation = parseJsonFromUnknown(json.conversation);
  if (nestedConversation && typeof nestedConversation.id === "string" && nestedConversation.id.trim()) {
    return nestedConversation.id.trim();
  }

  const nestedThread = parseJsonFromUnknown(json.thread);
  if (nestedThread && typeof nestedThread.id === "string" && nestedThread.id.trim()) {
    return nestedThread.id.trim();
  }

  return null;
}

type ParsedAttachment = {
  kind: "image" | "document";
  mimeType: string;
  base64: string;
  dataUrl: string;
};

function parseAttachmentDataUrls(urls: string[]): ParsedAttachment[] {
  const out: ParsedAttachment[] = [];
  for (const raw of urls) {
    const url = String(raw || "").trim();
    const match = url.match(/^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=]+)$/i);
    if (!match) continue;
    const mime = match[1];
    const base64 = match[2];
    const kind = mime.startsWith("image/") ? "image" : "document";
    out.push({ kind, mimeType: mime, base64, dataUrl: url });
  }
  return out;
}

function buildAnthropicContentBlocks(attachments: ParsedAttachment[]): unknown[] {
  return attachments
    .map((att) => ({
      type: att.kind === "image" ? "image" : "document",
      source: { type: "base64", media_type: att.mimeType, data: att.base64 },
    }))
    .filter((block) => block.source.data);
}

function buildOpenAiContentBlocks(attachments: ParsedAttachment[]): unknown[] {
  return attachments.map((att) => {
    if (att.kind === "image") {
      return { type: "image_url", image_url: { url: att.dataUrl } };
    }
    // Documents (PDF, docx, pptx, xlsx, csv, txt, md) — use the OpenAI file
    // content block format supported by GPT-4o and compatible providers.
    const extGuess = att.mimeType.split("/").pop()?.replace(/^vnd\..+\./, "") || "file";
    return { type: "file", file: { filename: `attachment.${extGuess}`, file_data: att.dataUrl } };
  });
}

function buildTextAttachmentContext(dataUrls: string[], preset?: ContextLimitPreset): {
  binaryDataUrls: string[];
  textContext: string;
} {
  const { binaryDataUrls, textBlocks } = splitTextLikeAttachmentDataUrls(dataUrls || []);
  if (!textBlocks.length) return { binaryDataUrls, textContext: "" };

  const limits = getTextAttachmentLimits(preset);
  const { maxFiles, maxCharsPerFile, maxCharsTotal } = limits;
  let total = 0;
  const lines: string[] = [
    "Additional attached text context:",
  ];

  for (let i = 0; i < textBlocks.length && i < maxFiles; i += 1) {
    const block = textBlocks[i];
    const remaining = maxCharsTotal - total;
    if (remaining <= 0) break;

    const normalized = String(block.text || "").trim();
    if (!normalized) continue;
    const capped = normalized.slice(0, Math.min(maxCharsPerFile, remaining));
    if (!capped) continue;

    lines.push(`\n[Attached text file ${i + 1} - ${block.mimeType}]`);
    lines.push(capped);
    total += capped.length;
  }

  return {
    binaryDataUrls,
    textContext: lines.length > 1 ? lines.join("\n") : "",
  };
}

export async function requestStudyAssistantCompletionDetailed(params: {
  settings: SproutSettings["studyAssistant"];
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls?: string[];
  attachedFileDataUrls?: string[];
  mode?: CompletionMode;
  conversationId?: string;
  onConversationResolved?: (conversationId: string) => void;
}): Promise<CompletionResult> {
  const {
    settings,
    systemPrompt,
    userPrompt,
    imageDataUrls = [],
    attachedFileDataUrls = [],
    mode = "text",
    conversationId,
    onConversationResolved,
  } = params;

  const apiKey = providerApiKey(settings.provider, settings.apiKeys);
  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${settings.provider}`);
  }

  const base = providerBaseUrl(settings);
  const model = String(settings.model || "").trim();

  if (!base) {
    throw new Error("Missing endpoint override for custom provider.");
  }

  if (!model) throw new Error("Missing model name in Study Companion settings.");

  const textAttachmentPrep = buildTextAttachmentContext(attachedFileDataUrls, settings.privacy.textAttachmentContextLimit);
  const effectiveUserPrompt = textAttachmentPrep.textContext
    ? `${userPrompt}\n\n${textAttachmentPrep.textContext}`
    : userPrompt;
  const allDataUrls = [...imageDataUrls, ...textAttachmentPrep.binaryDataUrls];
  const attachments = parseAttachmentDataUrls(allDataUrls);

  if (settings.provider === "anthropic") {
    const endpoint = `${base}/messages`;
    let res: Awaited<ReturnType<typeof requestUrl>>;
    try {
      res = await requestUrl({
        url: endpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2500,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: attachments.length
              ? [
                  { type: "text", text: effectiveUserPrompt },
                  ...buildAnthropicContentBlocks(attachments),
                ]
              : effectiveUserPrompt,
          }],
        }),
      });
    } catch (err) {
      const status = statusFromUnknownError(err) ?? 0;
      if (status > 0) {
        const responseText = responseTextFromUnknownError(err);
        const responseJson = responseJsonFromUnknownError(err);
        const detail = providerErrorDetail({ json: responseJson, text: responseText });
        const code = providerErrorCode({ json: responseJson, text: responseText });
        const errorType = providerErrorType({ json: responseJson });
        throw buildProviderRequestError({
          provider: settings.provider,
          endpoint,
          status,
          detail,
          code,
          errorType,
          responseText,
          responseJson,
          originalError: err,
        });
      }
      throw err;
    }

    if (res.status < 200 || res.status >= 300) {
      const detail = providerErrorDetail(res);
      const code = providerErrorCode(res);
      const errorType = providerErrorType(res);
      throw buildProviderRequestError({
        provider: settings.provider,
        endpoint,
        status: res.status,
        detail,
        code,
        errorType,
        responseText: typeof res.text === "string" ? res.text : "",
        responseJson: res.json,
      });
    }

    const json = parseJsonFromUnknown(sanitizeJsonResponse(res.json));
    if (!json) throw new Error("Anthropic response was not a valid object.");
    assertAnthropicResponseShape(json);
    const text = extractTextFromAnthropicResponse(json);
    if (!text) throw new Error("Anthropic response did not include text content.");
    const resolvedConversationId = extractConversationIdFromResponse(json);
    if (resolvedConversationId && typeof onConversationResolved === "function") {
      onConversationResolved(resolvedConversationId);
    }
    return { text, conversationId: resolvedConversationId ?? conversationId };
  }

  const endpoint = `${base}/chat/completions`;
  const shouldUseStructuredJsonResponse = mode === "json" && settings.provider !== "openrouter";

  const requestOpenAiLike = async (requestModel: string): Promise<Awaited<ReturnType<typeof requestUrl>>> => {
    try {
      return await requestUrl({
        url: endpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: requestModel,
          max_tokens: 2500,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: attachments.length
                ? [
                    { type: "text", text: effectiveUserPrompt },
                    ...buildOpenAiContentBlocks(attachments),
                  ]
                : effectiveUserPrompt,
            },
          ],
          ...(settings.provider === "custom" && typeof conversationId === "string" && conversationId.trim()
            ? { conversation_id: conversationId.trim() }
            : {}),
          ...(shouldOmitTemperature(settings.provider, requestModel) ? {} : { temperature: 0.4 }),
          ...(shouldUseStructuredJsonResponse ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (err) {
      const status = statusFromUnknownError(err) ?? 0;
      if (status > 0) {
        const responseText = responseTextFromUnknownError(err);
        const responseJson = responseJsonFromUnknownError(err);
        const detail = providerErrorDetail({ json: responseJson, text: responseText });
        const code = providerErrorCode({ json: responseJson, text: responseText });
        const errorType = providerErrorType({ json: responseJson });
        throw buildProviderRequestError({
          provider: settings.provider,
          endpoint,
          status,
          detail,
          code,
          errorType,
          responseText,
          responseJson,
          originalError: err,
        });
      }
      throw err;
    }
  };

  const assertOkOrThrow = (response: Awaited<ReturnType<typeof requestUrl>>): void => {
    if (response.status < 200 || response.status >= 300) {
      const detail = providerErrorDetail(response);
      const code = providerErrorCode(response);
      const errorType = providerErrorType(response);
      throw buildProviderRequestError({
        provider: settings.provider,
        endpoint,
        status: response.status,
        detail,
        code,
        errorType,
        responseText: typeof response.text === "string" ? response.text : "",
        responseJson: response.json,
      });
    }
  };

  let res: Awaited<ReturnType<typeof requestUrl>>;
  try {
    res = await requestOpenAiLike(model);
    assertOkOrThrow(res);
  } catch (err) {
    const status = statusFromUnknownError(err) ?? (recordFromUnknown(err)?.status as number | undefined) ?? 0;
    const canRetryOpenRouterModelAlias = settings.provider === "openrouter" && status === 404;
    if (!canRetryOpenRouterModelAlias) throw err;

    const alternateModel = openRouterAlternateModelId(model);
    if (!alternateModel || alternateModel.toLowerCase() === model.toLowerCase()) throw err;

    res = await requestOpenAiLike(alternateModel);
    assertOkOrThrow(res);
  }

  const json = parseJsonFromUnknown(sanitizeJsonResponse(res.json));
  if (!json) throw new Error(`${settings.provider} response was not a valid object.`);
  assertOpenAiLikeResponseShape(json);
  const text = extractTextFromOpenAiLikeResponse(json);
  if (!text) throw new Error(`${settings.provider} response did not include text content.`);
  const resolvedConversationId = extractConversationIdFromResponse(json);
  if (resolvedConversationId && typeof onConversationResolved === "function") {
    onConversationResolved(resolvedConversationId);
  }
  return { text, conversationId: resolvedConversationId ?? conversationId };
}

export async function requestStudyAssistantCompletion(params: {
  settings: SproutSettings["studyAssistant"];
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls?: string[];
  attachedFileDataUrls?: string[];
  mode?: CompletionMode;
  conversationId?: string;
  onConversationResolved?: (conversationId: string) => void;
}): Promise<string> {
  const result = await requestStudyAssistantCompletionDetailed(params);
  return result.text;
}

export async function deleteStudyAssistantConversation(params: {
  settings: SproutSettings["studyAssistant"];
  conversationId: string;
}): Promise<DeleteConversationResult> {
  const { settings } = params;
  const conversationId = String(params.conversationId || "").trim();
  if (!conversationId) return { deleted: false, unsupported: true, detail: "Missing conversation id." };

  if (settings.provider !== "custom") {
    return {
      deleted: false,
      unsupported: true,
      detail: "Remote conversation deletion is currently only supported for Custom provider endpoints.",
    };
  }

  const apiKey = providerApiKey(settings.provider, settings.apiKeys);
  if (!apiKey) {
    return { deleted: false, status: 401, detail: `Missing API key for provider: ${settings.provider}` };
  }

  const base = providerBaseUrl(settings);
  if (!base) return { deleted: false, status: 400, detail: "Missing endpoint override for custom provider." };

  const encoded = encodeURIComponent(conversationId);
  const candidates = [
    `${base}/conversations/${encoded}`,
    `${base}/threads/${encoded}`,
    `${base}/sessions/${encoded}`,
  ];

  let unsupportedHits = 0;
  for (const endpoint of candidates) {
    try {
      const res = await requestUrl({
        url: endpoint,
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (res.status >= 200 && res.status < 300) {
        return { deleted: true, status: res.status };
      }

      if (res.status === 404 || res.status === 405 || res.status === 501) {
        unsupportedHits += 1;
        continue;
      }

      return {
        deleted: false,
        status: res.status,
        detail: providerErrorDetail(res) || `Delete request failed (${res.status}).`,
      };
    } catch (err) {
      const status = statusFromUnknownError(err) ?? 0;
      if (status === 404 || status === 405 || status === 501) {
        unsupportedHits += 1;
        continue;
      }
      return {
        deleted: false,
        status: status || undefined,
        detail: responseTextFromUnknownError(err)
          || (err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Unknown error"),
      };
    }
  }

  if (unsupportedHits >= candidates.length) {
    return {
      deleted: false,
      unsupported: true,
      detail: "Custom endpoint did not expose a supported delete conversation route.",
    };
  }

  return { deleted: false, detail: "Conversation was not deleted." };
}
