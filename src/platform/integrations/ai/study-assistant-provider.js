/**
 * @file src/platform/integrations/ai/study-assistant-provider.ts
 * @summary Module for study assistant provider.
 *
 * @exports
 *  - requestStudyAssistantCompletionDetailed
 *  - requestStudyAssistantCompletion
 *  - requestStudyAssistantStreamingCompletion
 *  - deleteStudyAssistantConversation
 */
import { requestUrl } from "obsidian";
import { getTextAttachmentLimits, } from "./study-assistant-types";
import { extractDocxTextFromDataUrl, extractPdfTextFromDataUrl, extractPptxTextFromDataUrl, splitTextLikeAttachmentDataUrls, } from "./attachment-helpers";
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const REASONING_MAX_OUTPUT_TOKENS = 25000;
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function isValidHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    }
    catch (_a) {
        return false;
    }
}
function providerBaseUrl(settings) {
    const override = String(settings.endpointOverride || "").trim();
    if (settings.provider === "custom" && override) {
        if (!isValidHttpUrl(override)) {
            throw new Error(`Invalid endpoint URL: must start with https:// or http://`);
        }
        return trimTrailingSlash(override);
    }
    if (settings.provider === "custom")
        return "";
    if (settings.provider === "openai")
        return "https://api.openai.com/v1";
    if (settings.provider === "anthropic")
        return "https://api.anthropic.com/v1";
    // DeepSeek's OpenAI-compatible endpoint is /chat/completions without a /v1 prefix.
    if (settings.provider === "deepseek")
        return "https://api.deepseek.com";
    if (settings.provider === "xai")
        return "https://api.x.ai/v1";
    if (settings.provider === "google")
        return "https://generativelanguage.googleapis.com/v1beta/openai";
    if (settings.provider === "perplexity")
        return "https://api.perplexity.ai/v1";
    if (settings.provider === "openrouter")
        return "https://openrouter.ai/api/v1";
    return "";
}
export function providerApiKey(provider, apiKeys) {
    if (provider === "openai")
        return String(apiKeys.openai || "").trim();
    if (provider === "anthropic")
        return String(apiKeys.anthropic || "").trim();
    if (provider === "deepseek")
        return String(apiKeys.deepseek || "").trim();
    if (provider === "xai")
        return String(apiKeys.xai || "").trim();
    if (provider === "google")
        return String(apiKeys.google || "").trim();
    if (provider === "perplexity")
        return String(apiKeys.perplexity || "").trim();
    if (provider === "openrouter")
        return String(apiKeys.openrouter || "").trim();
    return String(apiKeys.custom || "").trim();
}
function parseJsonFromUnknown(value) {
    if (!value || typeof value !== "object")
        return null;
    return value;
}
const POISONED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function sanitizeJsonResponse(value, depth = 0) {
    if (depth > 20)
        return value;
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeJsonResponse(item, depth + 1));
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value)) {
            if (POISONED_KEYS.has(key))
                continue;
            out[key] = sanitizeJsonResponse(value[key], depth + 1);
        }
        return out;
    }
    return value;
}
function assertOpenAiLikeResponseShape(json) {
    if (!Array.isArray(json.choices) && !Array.isArray(json.output)) {
        throw new Error("Invalid response from provider: missing 'choices' or 'output' array.");
    }
}
function assertAnthropicResponseShape(json) {
    if (!Array.isArray(json.content)) {
        throw new Error("Invalid response from Anthropic: missing 'content' array.");
    }
}
/**
 * Returns true when the model identifier looks like a reasoning / thinking
 * model regardless of provider.  Used to conditionally strip parameters that
 * reasoning models reject (temperature, response_format, etc.).
 */
function isReasoningModelId(model) {
    const m = String(model || "")
        .trim()
        .toLowerCase()
        .replace(/^[^/]+\//, "")
        .replace(/:free$/i, "");
    return (m.startsWith("o1") ||
        m.startsWith("o3") ||
        m.startsWith("o4") ||
        m.startsWith("gpt-5") ||
        m.startsWith("deepseek-reasoner") ||
        m.includes("deepseek-r1"));
}
function shouldOmitTemperature(provider, model) {
    if (provider === "openai" || provider === "deepseek" || provider === "perplexity") {
        return isReasoningModelId(model);
    }
    // OpenRouter model IDs embed the upstream model name
    // (e.g. "deepseek/deepseek-r1:free"), so the same check works.
    if (provider === "openrouter")
        return isReasoningModelId(model);
    return false;
}
function completionTokenBudget(provider, model) {
    const isReasoning = (provider === "openai"
        || provider === "deepseek"
        || provider === "openrouter"
        || provider === "perplexity")
        && isReasoningModelId(model);
    return isReasoning ? REASONING_MAX_OUTPUT_TOKENS : DEFAULT_MAX_OUTPUT_TOKENS;
}
function inlineSystemPromptIntoUserPrompt(systemPrompt, userPrompt) {
    return `System instructions:\n${systemPrompt}\n\n${userPrompt}`;
}
function shouldInlineSystemPromptForOpenAiLike(provider, model, variant = "default") {
    if (variant === "compatibility")
        return true;
    // DeepSeek reasoner is more reliable when instructions are in the user turn.
    if (provider !== "deepseek")
        return false;
    const m = String(model || "").trim().toLowerCase();
    return m.startsWith("deepseek-reasoner");
}
function openRouterAlternateModelId(model) {
    const value = String(model || "").trim();
    if (!value)
        return "";
    return /:free$/i.test(value) ? value.replace(/:free$/i, "") : `${value}:free`;
}
let openRouterCatalogCache = null;
let openRouterCatalogPromise = null;
function cleanOpenRouterModelDisplayName(value) {
    return String(value || "")
        .replace(/\s*\(free\)\s*$/i, "")
        .replace(/:free\s*$/i, "")
        .trim();
}
function formatOpenRouterModelLabel(model) {
    const input = String(model || "").trim();
    if (!input)
        return "";
    const base = input.includes("/") ? input.split("/").slice(1).join("/") : input;
    const clean = base.replace(/:free$/i, "");
    const parts = clean.split(/[\s._:/-]+/g).filter(Boolean);
    const acronyms = new Map([
        ["gpt", "GPT"],
        ["ai", "AI"],
        ["api", "API"],
        ["r1", "R1"],
        ["vl", "VL"],
        ["llama", "Llama"],
        ["qwen", "Qwen"],
        ["sonnet", "Sonnet"],
        ["opus", "Opus"],
        ["haiku", "Haiku"],
        ["gemini", "Gemini"],
        ["deepseek", "DeepSeek"],
    ]);
    return parts
        .map((part) => {
        const lower = part.toLowerCase();
        const mapped = acronyms.get(lower);
        if (mapped)
            return mapped;
        if (/^[0-9]+[a-z]?$/i.test(part))
            return part.toUpperCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
        .join(" ");
}
function normaliseOpenRouterLookupKey(value) {
    return cleanOpenRouterModelDisplayName(value)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}
function openRouterCatalogLookupKeys(model) {
    const keys = new Set();
    const add = (value) => {
        const key = normaliseOpenRouterLookupKey(value);
        if (key)
            keys.add(key);
    };
    add(model.id);
    add(model.canonicalSlug);
    add(model.name);
    add(formatOpenRouterModelLabel(model.id));
    if (model.canonicalSlug)
        add(formatOpenRouterModelLabel(model.canonicalSlug));
    return [...keys];
}
async function loadOpenRouterCatalogModels(forceReload = false) {
    if (!forceReload && openRouterCatalogCache)
        return openRouterCatalogCache;
    if (!forceReload && openRouterCatalogPromise)
        return openRouterCatalogPromise;
    if (forceReload) {
        openRouterCatalogCache = null;
        openRouterCatalogPromise = null;
    }
    openRouterCatalogPromise = (async () => {
        try {
            const res = await requestUrl({
                url: "https://openrouter.ai/api/v1/models",
                method: "GET",
                headers: { Accept: "application/json" },
            });
            if (res.status < 200 || res.status >= 300)
                return [];
            const rawJson = parseJsonFromUnknown(res.json);
            const rawModels = Array.isArray(rawJson === null || rawJson === void 0 ? void 0 : rawJson.data) ? rawJson.data : [];
            const parsed = [];
            for (const entry of rawModels) {
                const model = parseJsonFromUnknown(entry);
                if (!model)
                    continue;
                const id = stringValueFromUnknown(model.id).trim();
                if (!id)
                    continue;
                parsed.push({
                    id,
                    canonicalSlug: stringValueFromUnknown(model.canonical_slug).trim(),
                    name: cleanOpenRouterModelDisplayName(stringValueFromUnknown(model.name)),
                });
            }
            openRouterCatalogCache = parsed;
            return parsed;
        }
        catch (_a) {
            return [];
        }
        finally {
            openRouterCatalogPromise = null;
        }
    })();
    return openRouterCatalogPromise;
}
async function resolveOpenRouterCurrentModelId(model) {
    const lookup = normaliseOpenRouterLookupKey(model);
    if (!lookup)
        return "";
    const findMatch = (models) => {
        if (!models.length)
            return "";
        const exactId = models.find((entry) => entry.id.toLowerCase() === String(model || "").trim().toLowerCase());
        if (exactId)
            return exactId.id;
        const exactCanonical = models.find((entry) => entry.canonicalSlug.toLowerCase() === String(model || "").trim().toLowerCase());
        if (exactCanonical)
            return exactCanonical.id;
        for (const entry of models) {
            if (openRouterCatalogLookupKeys(entry).includes(lookup)) {
                return entry.id;
            }
        }
        return "";
    };
    const cachedMatch = findMatch(await loadOpenRouterCatalogModels());
    if (cachedMatch)
        return cachedMatch;
    return findMatch(await loadOpenRouterCatalogModels(true));
}
async function getOpenRouterRetryModelIds(model) {
    const candidates = [];
    const seen = new Set();
    const push = (value) => {
        const trimmed = String(value || "").trim();
        if (!trimmed)
            return;
        const key = trimmed.toLowerCase();
        if (seen.has(key))
            return;
        seen.add(key);
        candidates.push(trimmed);
    };
    const resolvedModel = await resolveOpenRouterCurrentModelId(model);
    push(resolvedModel);
    push(openRouterAlternateModelId(model));
    if (resolvedModel)
        push(openRouterAlternateModelId(resolvedModel));
    return candidates.filter((candidate) => candidate.toLowerCase() !== String(model || "").trim().toLowerCase());
}
function providerUsesResponsesApi(provider) {
    return provider === "openai" || provider === "xai" || provider === "perplexity";
}
function shouldRetryOpenAiLikeCompatibility(provider, err) {
    var _a, _b, _c;
    const supportsCompatibilityRetry = providerUsesResponsesApi(provider)
        || provider === "openrouter"
        || provider === "google"
        || provider === "custom";
    if (!supportsCompatibilityRetry)
        return false;
    const status = (_c = (_a = statusFromUnknownError(err)) !== null && _a !== void 0 ? _a : (_b = recordFromUnknown(err)) === null || _b === void 0 ? void 0 : _b.status) !== null && _c !== void 0 ? _c : 0;
    if (status !== 400 && status !== 422)
        return false;
    const obj = recordFromUnknown(err) || {};
    const combined = [
        stringValueFromUnknown(obj.detail),
        stringValueFromUnknown(obj.code),
        stringValueFromUnknown(obj.errorType),
        stringValueFromUnknown(obj.message),
        responseTextFromUnknownError(err),
    ].join(" ").toLowerCase();
    if (/(attachment|attachments|file_data|input_file|multimodal|mime|media|document|image_url|vision|pdf|docx|pptx)/.test(combined)) {
        return false;
    }
    if (/(invalid api key|unauthorized|permission|forbidden|quota|billing|credit|insufficient_quota|rate limit|too many requests|model_not_found|unknown model|not found|context length|too long|max context|token limit|safety|content policy)/.test(combined)) {
        return false;
    }
    return true;
}
export function providerSupportsNativeDocumentAttachment(provider, mimeType) {
    const mime = String(mimeType || "").toLowerCase();
    if (!mime || mime.startsWith("image/"))
        return false;
    if (provider === "openai" || provider === "perplexity")
        return true;
    if (provider === "anthropic")
        return mime === PDF_MIME_TYPE;
    if (provider === "deepseek")
        return mime === DOCX_MIME_TYPE || mime === PPTX_MIME_TYPE;
    return false;
}
function shouldRetryDeepSeekCompatibility(provider, err) {
    var _a;
    if (provider !== "deepseek")
        return false;
    const status = (_a = statusFromUnknownError(err)) !== null && _a !== void 0 ? _a : 0;
    return status === 400 || status === 415 || status === 422;
}
function deepSeekCompatibilityTokenBudget(model) {
    const tokenBudget = completionTokenBudget("deepseek", model);
    return isReasoningModelId(model)
        ? Math.min(tokenBudget, 8192)
        : Math.min(tokenBudget, 4096);
}
function providerErrorDetail(res) {
    const json = parseJsonFromUnknown(res.json);
    const err = parseJsonFromUnknown(json === null || json === void 0 ? void 0 : json.error);
    const message = typeof (err === null || err === void 0 ? void 0 : err.message) === "string" ? err.message.trim() : "";
    if (message)
        return message;
    const rawText = typeof res.text === "string" ? res.text.trim() : "";
    return rawText;
}
function providerErrorCode(res) {
    const json = parseJsonFromUnknown(res.json);
    const err = parseJsonFromUnknown(json === null || json === void 0 ? void 0 : json.error);
    const code = typeof (err === null || err === void 0 ? void 0 : err.code) === "string" ? err.code.trim() : "";
    if (code)
        return code;
    const type = typeof (err === null || err === void 0 ? void 0 : err.type) === "string" ? err.type.trim() : "";
    if (type)
        return type;
    const status = typeof (json === null || json === void 0 ? void 0 : json.status) === "string" ? json.status.trim() : "";
    if (status)
        return status;
    const rawText = typeof res.text === "string" ? res.text.trim() : "";
    const fromText = rawText.match(/\b([A-Z_]{3,}|[a-z_]{3,}(?:_error|_exceeded|_found|_denied|_quota))\b/);
    return (fromText === null || fromText === void 0 ? void 0 : fromText[1]) ? fromText[1].trim() : "";
}
function providerErrorType(res) {
    const json = parseJsonFromUnknown(res.json);
    const err = parseJsonFromUnknown(json === null || json === void 0 ? void 0 : json.error);
    const type = typeof (err === null || err === void 0 ? void 0 : err.type) === "string" ? err.type.trim() : "";
    return type;
}
function recordFromUnknown(value) {
    if (!value || typeof value !== "object")
        return null;
    return value;
}
function stringValueFromUnknown(value) {
    if (typeof value === "string")
        return value.trim();
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    return "";
}
function errorFromUnknown(err) {
    if (err instanceof Error)
        return err;
    const obj = recordFromUnknown(err);
    const detail = stringValueFromUnknown(obj === null || obj === void 0 ? void 0 : obj.detail)
        || stringValueFromUnknown(obj === null || obj === void 0 ? void 0 : obj.message)
        || responseTextFromUnknownError(err);
    return new Error(detail || "Unknown error");
}
function statusFromUnknownError(err) {
    var _a;
    const obj = recordFromUnknown(err);
    const statusRaw = obj === null || obj === void 0 ? void 0 : obj.status;
    const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw);
    if (Number.isFinite(status) && status >= 100 && status <= 599)
        return Math.floor(status);
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const fromMessage = (_a = message.match(/status\s+(\d{3})/i)) === null || _a === void 0 ? void 0 : _a[1];
    if (fromMessage) {
        const parsed = Number(fromMessage);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return null;
}
function responseTextFromUnknownError(err) {
    var _a, _b;
    const obj = recordFromUnknown(err);
    const candidates = [
        obj === null || obj === void 0 ? void 0 : obj.text,
        (_a = recordFromUnknown(obj === null || obj === void 0 ? void 0 : obj.response)) === null || _a === void 0 ? void 0 : _a.text,
        obj === null || obj === void 0 ? void 0 : obj.body,
        (_b = recordFromUnknown(obj === null || obj === void 0 ? void 0 : obj.response)) === null || _b === void 0 ? void 0 : _b.body,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim())
            return candidate.trim();
    }
    return "";
}
function responseJsonFromUnknownError(err) {
    const obj = recordFromUnknown(err);
    const direct = obj === null || obj === void 0 ? void 0 : obj.json;
    if (direct !== undefined)
        return direct;
    const responseObj = recordFromUnknown(obj === null || obj === void 0 ? void 0 : obj.response);
    if ((responseObj === null || responseObj === void 0 ? void 0 : responseObj.json) !== undefined)
        return responseObj.json;
    const rawText = responseTextFromUnknownError(err);
    if (!rawText)
        return undefined;
    try {
        return JSON.parse(rawText);
    }
    catch (_a) {
        return undefined;
    }
}
function buildProviderRequestError(args) {
    const { provider, endpoint, status, attachmentRoute, detail = "", code = "", errorType = "", responseText = "", responseJson, originalError } = args;
    const err = new Error(`${provider} request failed (${status})`);
    err.provider = provider;
    err.endpoint = endpoint;
    err.status = status;
    if (attachmentRoute)
        err.attachmentRoute = attachmentRoute;
    if (detail)
        err.detail = detail;
    if (code)
        err.code = code;
    if (errorType)
        err.errorType = errorType;
    if (responseText)
        err.responseText = responseText;
    if (responseJson !== undefined)
        err.responseJson = responseJson;
    if (originalError !== undefined)
        err.originalError = originalError;
    return err;
}
function createAbortError() {
    const err = new Error("Streaming request was aborted.");
    err.name = "AbortError";
    return err;
}
function throwIfStreamingAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted)
        throw createAbortError();
}
function tryParseJsonText(text) {
    const rawText = String(text || "").trim();
    if (!rawText)
        return undefined;
    try {
        return JSON.parse(rawText);
    }
    catch (_a) {
        return undefined;
    }
}
async function requestStreamingTransport(params) {
    var _a;
    const { url, method, headers, body, signal } = params;
    const fetchImpl = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
    if (fetchImpl) {
        try {
            throwIfStreamingAborted(signal);
            const response = await fetchImpl(url, {
                method,
                headers,
                body,
                signal,
            });
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });
            if (response.status < 200 || response.status >= 300) {
                const responseText = await response.text();
                return {
                    status: response.status,
                    text: responseText,
                    json: tryParseJsonText(responseText),
                    headers: responseHeaders,
                    body: null,
                };
            }
            if (!response.body || typeof response.body.getReader !== "function") {
                const responseText = await response.text();
                return {
                    status: response.status,
                    text: responseText,
                    json: tryParseJsonText(responseText),
                    headers: responseHeaders,
                    body: null,
                };
            }
            return {
                status: response.status,
                text: "",
                headers: responseHeaders,
                body: response.body,
            };
        }
        catch (err) {
            if ((signal === null || signal === void 0 ? void 0 : signal.aborted) || (err instanceof Error && err.name === "AbortError")) {
                throw createAbortError();
            }
        }
    }
    const fallback = await requestUrl({
        url,
        method,
        headers,
        body,
    });
    return {
        status: fallback.status,
        text: typeof fallback.text === "string" ? fallback.text : "",
        json: fallback.json,
        headers: (_a = fallback.headers) !== null && _a !== void 0 ? _a : {},
        body: null,
    };
}
function appendStreamingPayloads(args) {
    const { extractDelta, onChunk, signal } = args;
    const parsed = parseSSELines(args.buffer);
    let fullText = args.fullText;
    for (const payload of parsed.events) {
        throwIfStreamingAborted(signal);
        const token = extractDelta(payload);
        if (!token)
            continue;
        fullText += token;
        onChunk(token);
    }
    return {
        buffer: parsed.remainder,
        fullText,
    };
}
async function readStreamingResponseText(args) {
    const { response, extractDelta, onChunk, signal } = args;
    if (!response.body || typeof response.body.getReader !== "function") {
        const responseText = typeof response.text === "string" ? response.text : "";
        if (!responseText.trim())
            throw new Error("Streaming response body is not readable.");
        return appendStreamingPayloads({
            buffer: `${responseText}\n`,
            extractDelta,
            onChunk,
            signal,
            fullText: "",
        }).fullText;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    try {
        while (true) {
            throwIfStreamingAborted(signal);
            const chunk = await reader.read();
            if (chunk.done)
                break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const parsed = appendStreamingPayloads({
                buffer,
                extractDelta,
                onChunk,
                signal,
                fullText,
            });
            buffer = parsed.buffer;
            fullText = parsed.fullText;
        }
        buffer += decoder.decode();
        if (buffer) {
            const parsed = appendStreamingPayloads({
                buffer: `${buffer}\n`,
                extractDelta,
                onChunk,
                signal,
                fullText,
            });
            fullText = parsed.fullText;
        }
    }
    catch (err) {
        if ((signal === null || signal === void 0 ? void 0 : signal.aborted) || (err instanceof Error && err.name === "AbortError")) {
            throw createAbortError();
        }
        throw err;
    }
    finally {
        try {
            reader.releaseLock();
        }
        catch (_a) {
            // Ignore reader cleanup errors.
        }
    }
    return fullText;
}
function attachAttachmentRouteToError(err, attachmentRoute) {
    err.attachmentRoute = attachmentRoute;
    return err;
}
function extractTextFromOpenAiLikeResponse(json) {
    if (typeof json.output_text === "string" && json.output_text.trim()) {
        return json.output_text.trim();
    }
    // Reasoning models (o-series, gpt-5) may use an "output" array instead of "choices".
    // Each output item has { type: "message", content: [{ type: "output_text", text }] }.
    if (Array.isArray(json.output)) {
        const parts = [];
        for (const item of json.output) {
            const obj = parseJsonFromUnknown(item);
            if (!obj)
                continue;
            if (obj.type === "message" && Array.isArray(obj.content)) {
                for (const block of obj.content) {
                    const b = parseJsonFromUnknown(block);
                    if ((b === null || b === void 0 ? void 0 : b.type) === "output_text" && typeof b.text === "string")
                        parts.push(b.text);
                }
            }
        }
        if (parts.length)
            return parts.join("\n");
    }
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const firstChoice = parseJsonFromUnknown(choices[0]);
    const message = parseJsonFromUnknown(firstChoice === null || firstChoice === void 0 ? void 0 : firstChoice.message);
    const content = message === null || message === void 0 ? void 0 : message.content;
    if (typeof content === "string")
        return content;
    if (content && typeof content === "object" && !Array.isArray(content)) {
        try {
            return JSON.stringify(content);
        }
        catch (_a) {
            // ignore
        }
    }
    if (Array.isArray(content)) {
        const parts = [];
        for (const block of content) {
            const obj = parseJsonFromUnknown(block);
            if (typeof (obj === null || obj === void 0 ? void 0 : obj.text) === "string")
                parts.push(obj.text);
        }
        if (parts.length)
            return parts.join("\n");
    }
    const functionCall = parseJsonFromUnknown(message === null || message === void 0 ? void 0 : message.function_call);
    if (typeof (functionCall === null || functionCall === void 0 ? void 0 : functionCall.arguments) === "string" && functionCall.arguments.trim()) {
        return functionCall.arguments.trim();
    }
    const toolCalls = Array.isArray(message === null || message === void 0 ? void 0 : message.tool_calls) ? message.tool_calls : [];
    for (const toolCall of toolCalls) {
        const toolObj = parseJsonFromUnknown(toolCall);
        const fn = parseJsonFromUnknown(toolObj === null || toolObj === void 0 ? void 0 : toolObj.function);
        if (typeof (fn === null || fn === void 0 ? void 0 : fn.arguments) === "string" && fn.arguments.trim()) {
            return fn.arguments.trim();
        }
    }
    return "";
}
function extractTextFromAnthropicResponse(json) {
    const content = Array.isArray(json.content) ? json.content : [];
    const parts = [];
    for (const block of content) {
        const obj = parseJsonFromUnknown(block);
        if (!obj)
            continue;
        if (obj.type === "text" && typeof obj.text === "string") {
            parts.push(obj.text);
        }
    }
    return parts.join("\n").trim();
}
function extractConversationIdFromResponse(json) {
    if (!json)
        return null;
    const directKeys = ["conversation_id", "conversationId", "thread_id", "threadId"];
    for (const key of directKeys) {
        const value = json[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
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
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME_TYPE = "application/pdf";
const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MIME_EXTENSION_MAP = {
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
    "text/html": "html",
    "application/json": "json",
    "application/xml": "xml",
    "application/x-yaml": "yaml",
    "application/javascript": "js",
    "application/typescript": "ts",
    "application/sql": "sql",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
function fileExtensionFromMimeType(mimeType) {
    const mime = String(mimeType || "").toLowerCase().trim();
    if (!mime)
        return "bin";
    const mapped = MIME_EXTENSION_MAP[mime];
    if (mapped)
        return mapped;
    const slash = mime.lastIndexOf("/");
    const tail = slash >= 0 ? mime.slice(slash + 1) : mime;
    const normalized = tail.replace(/^vnd\.[^.]+\./, "").replace(/[^a-z0-9]+/g, "");
    return normalized || "bin";
}
function parseDataUrlMimeType(raw) {
    const match = String(raw || "").trim().match(/^data:([^;,]+);base64,/i);
    return String((match === null || match === void 0 ? void 0 : match[1]) || "").toLowerCase();
}
function isDocumentDataUrl(raw) {
    const mimeType = parseDataUrlMimeType(raw);
    return !!mimeType && !mimeType.startsWith("image/");
}
function hasDocumentDataUrls(urls) {
    return (urls || []).some((value) => isDocumentDataUrl(value));
}
function extractTextFallbackFromDataUrl(dataUrl) {
    const mimeType = parseDataUrlMimeType(dataUrl);
    if (!mimeType)
        return "";
    if (mimeType === DOCX_MIME_TYPE)
        return extractDocxTextFromDataUrl(dataUrl);
    if (mimeType === PDF_MIME_TYPE)
        return extractPdfTextFromDataUrl(dataUrl);
    if (mimeType === PPTX_MIME_TYPE)
        return extractPptxTextFromDataUrl(dataUrl);
    return "";
}
function fallbackLabelForMimeType(mimeType) {
    if (mimeType === DOCX_MIME_TYPE)
        return "DOCX";
    if (mimeType === PDF_MIME_TYPE)
        return "PDF";
    if (mimeType === PPTX_MIME_TYPE)
        return "PPTX";
    return "FILE";
}
function isAttachmentRelatedRequestError(err) {
    var _a;
    const status = (_a = statusFromUnknownError(err)) !== null && _a !== void 0 ? _a : 0;
    const obj = recordFromUnknown(err) || {};
    const detail = (stringValueFromUnknown(obj.detail)
        || responseTextFromUnknownError(err)
        || stringValueFromUnknown(obj.message)).toLowerCase();
    const code = stringValueFromUnknown(obj.code).toLowerCase();
    const errorType = stringValueFromUnknown(obj.errorType).toLowerCase();
    const combined = `${detail} ${code} ${errorType}`;
    if (status === 415 || status === 422)
        return true;
    if (status === 400 && /(attachment|file|docx|mime|media|content block|multimodal|invalid)/.test(combined))
        return true;
    return false;
}
function buildDocumentFallbackContext(userPrompt, dataUrls, preset, shouldFallback = (dataUrl) => isDocumentDataUrl(dataUrl)) {
    const limits = getTextAttachmentLimits(preset);
    const maxFiles = Math.max(1, limits.maxFiles);
    const maxCharsPerFile = Math.max(500, limits.maxCharsPerFile);
    const maxCharsTotal = Math.max(2000, limits.maxCharsTotal);
    let fileCount = 0;
    let totalChars = 0;
    let removedAttachmentCount = 0;
    const textBlocks = [];
    const filteredDataUrls = [];
    for (const raw of dataUrls || []) {
        if (!shouldFallback(raw)) {
            filteredDataUrls.push(raw);
            continue;
        }
        removedAttachmentCount += 1;
        if (fileCount >= maxFiles || totalChars >= maxCharsTotal)
            continue;
        const extracted = extractTextFallbackFromDataUrl(raw);
        if (!extracted)
            continue;
        const mimeType = parseDataUrlMimeType(raw);
        const label = fallbackLabelForMimeType(mimeType);
        const remaining = maxCharsTotal - totalChars;
        if (remaining <= 0)
            continue;
        const capped = extracted.slice(0, Math.min(maxCharsPerFile, remaining)).trim();
        if (!capped)
            continue;
        fileCount += 1;
        totalChars += capped.length;
        textBlocks.push(`\n[${label} attachment ${fileCount}]\n${capped}`);
    }
    if (!removedAttachmentCount) {
        return { applied: false, userPrompt, dataUrls };
    }
    const noteLines = [];
    if (textBlocks.length) {
        noteLines.push("Additional attachment context (text-extracted fallback for document attachments):", textBlocks.join("\n"));
    }
    const omittedCount = Math.max(0, removedAttachmentCount - textBlocks.length);
    if (omittedCount > 0) {
        noteLines.push(`Note: ${omittedCount} attached document file(s) could not be sent natively and were omitted from the request.`);
    }
    const fallbackPrompt = noteLines.length ? `${userPrompt}\n\n${noteLines.join("\n")}` : userPrompt;
    return { applied: true, userPrompt: fallbackPrompt, dataUrls: filteredDataUrls };
}
function prepareProviderAttachmentPayload(args) {
    var _a, _b;
    const { provider, userPrompt, imageDataUrls, attachedFileDataUrls, preset, documentAttachmentMode = "auto", } = args;
    const hadAnyAttachments = ((_a = imageDataUrls === null || imageDataUrls === void 0 ? void 0 : imageDataUrls.length) !== null && _a !== void 0 ? _a : 0) > 0 || ((_b = attachedFileDataUrls === null || attachedFileDataUrls === void 0 ? void 0 : attachedFileDataUrls.length) !== null && _b !== void 0 ? _b : 0) > 0;
    const textAttachmentPrep = buildTextAttachmentContext(attachedFileDataUrls, preset);
    let nextUserPrompt = textAttachmentPrep.textContext
        ? `${userPrompt}\n\n${textAttachmentPrep.textContext}`
        : userPrompt;
    let nextDataUrls = [...imageDataUrls, ...textAttachmentPrep.binaryDataUrls];
    let attachmentRoute = hadAnyAttachments ? "native" : "none";
    if (textAttachmentPrep.textContext) {
        attachmentRoute = "forced-fallback";
    }
    if (documentAttachmentMode === "force-fallback") {
        const forcedFallback = buildDocumentFallbackContext(nextUserPrompt, nextDataUrls, preset);
        if (forcedFallback.applied) {
            nextUserPrompt = forcedFallback.userPrompt;
            nextDataUrls = forcedFallback.dataUrls;
            attachmentRoute = "forced-fallback";
        }
    }
    else if (provider !== "custom") {
        const proactiveFallback = buildDocumentFallbackContext(nextUserPrompt, nextDataUrls, preset, (dataUrl) => {
            const mimeType = parseDataUrlMimeType(dataUrl);
            return !!mimeType
                && !mimeType.startsWith("image/")
                && !providerSupportsNativeDocumentAttachment(provider, mimeType);
        });
        if (proactiveFallback.applied) {
            nextUserPrompt = proactiveFallback.userPrompt;
            nextDataUrls = proactiveFallback.dataUrls;
            attachmentRoute = "forced-fallback";
        }
    }
    return {
        userPrompt: nextUserPrompt,
        dataUrls: nextDataUrls,
        attachments: parseAttachmentDataUrls(nextDataUrls),
        attachmentRoute,
    };
}
function parseAttachmentDataUrls(urls) {
    const out = [];
    for (const raw of urls) {
        const url = String(raw || "").trim();
        const match = url.match(/^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=]+)$/i);
        if (!match)
            continue;
        const mime = match[1];
        const base64 = match[2];
        const kind = mime.startsWith("image/") ? "image" : "document";
        out.push({ kind, mimeType: mime, base64, dataUrl: url });
    }
    return out;
}
function buildAnthropicContentBlocks(attachments) {
    return attachments
        .map((att) => ({
        type: att.kind === "image" ? "image" : "document",
        source: { type: "base64", media_type: att.mimeType, data: att.base64 },
    }))
        .filter((block) => block.source.data);
}
function buildAnthropicUserContent(userPrompt, attachments) {
    if (!attachments.length)
        return userPrompt;
    return [
        { type: "text", text: userPrompt },
        ...buildAnthropicContentBlocks(attachments),
    ];
}
function buildChatCompletionsContentBlocks(provider, attachments) {
    return attachments.map((att) => {
        if (att.kind === "image") {
            return { type: "image_url", image_url: { url: att.dataUrl } };
        }
        const ext = fileExtensionFromMimeType(att.mimeType);
        return {
            type: "file",
            file: {
                filename: `attachment.${ext}`,
                file_data: provider === "deepseek" ? att.base64 : att.dataUrl,
            },
        };
    });
}
function buildResponsesContentBlocks(attachments) {
    return attachments.map((att) => {
        if (att.kind === "image") {
            return { type: "input_image", image_url: att.dataUrl };
        }
        const ext = fileExtensionFromMimeType(att.mimeType);
        return { type: "input_file", filename: `attachment.${ext}`, file_data: att.base64 };
    });
}
function buildChatCompletionsMessages(args) {
    const { provider, model, systemPrompt, userPrompt, attachments, variant = "default" } = args;
    const inlineSystemPrompt = shouldInlineSystemPromptForOpenAiLike(provider, model, variant);
    const effectiveUserContent = inlineSystemPrompt
        ? inlineSystemPromptIntoUserPrompt(systemPrompt, userPrompt)
        : userPrompt;
    const systemRole = provider === "openai" && isReasoningModelId(model) && variant === "default" ? "developer" : "system";
    if (inlineSystemPrompt) {
        return [{
                role: "user",
                content: attachments.length
                    ? [{ type: "text", text: effectiveUserContent }, ...buildChatCompletionsContentBlocks(provider, attachments)]
                    : effectiveUserContent,
            }];
    }
    return [
        { role: systemRole, content: systemPrompt },
        {
            role: "user",
            content: attachments.length
                ? [{ type: "text", text: effectiveUserContent }, ...buildChatCompletionsContentBlocks(provider, attachments)]
                : effectiveUserContent,
        },
    ];
}
function buildChatCompletionsBody(args) {
    const { provider, model, systemPrompt, userPrompt, attachments, mode, conversationId, variant = "default", stream = false, } = args;
    const useMaxCompletionTokens = provider === "openai" && isReasoningModelId(model);
    const tokenBudget = provider === "deepseek" && variant === "deepseek-compat"
        ? deepSeekCompatibilityTokenBudget(model)
        : completionTokenBudget(provider, model);
    const useJsonResponseFormat = variant === "default" &&
        mode === "json" &&
        provider !== "openrouter" &&
        !isReasoningModelId(model);
    const omitTemperature = variant === "compatibility"
        || shouldOmitTemperature(provider, model)
        || (provider === "deepseek" && variant === "deepseek-compat");
    return {
        model,
        ...(stream ? { stream: true } : {}),
        ...(useMaxCompletionTokens
            ? { max_completion_tokens: tokenBudget }
            : { max_tokens: tokenBudget }),
        messages: buildChatCompletionsMessages({
            provider,
            model,
            systemPrompt,
            userPrompt,
            attachments,
            variant,
        }),
        ...(provider === "custom" && typeof conversationId === "string" && conversationId.trim()
            ? { conversation_id: conversationId.trim() }
            : {}),
        ...(omitTemperature ? {} : { temperature: 0.4 }),
        ...(useJsonResponseFormat ? { response_format: { type: "json_object" } } : {}),
    };
}
function buildResponsesInput(userPrompt, attachments) {
    return [{
            role: "user",
            content: [
                { type: "input_text", text: userPrompt },
                ...buildResponsesContentBlocks(attachments),
            ],
        }];
}
function buildResponsesRequestBody(args) {
    const { provider, model, systemPrompt, userPrompt, attachments, mode, variant = "default", stream = false, } = args;
    const effectiveUserPrompt = variant === "compatibility"
        ? inlineSystemPromptIntoUserPrompt(systemPrompt, userPrompt)
        : userPrompt;
    const useJsonResponseFormat = variant === "default" && mode === "json" && !isReasoningModelId(model);
    const omitTemperature = variant === "compatibility" || shouldOmitTemperature(provider, model);
    return {
        model,
        ...(stream ? { stream: true } : {}),
        max_output_tokens: completionTokenBudget(provider, model),
        ...(variant === "compatibility" ? {} : { instructions: systemPrompt }),
        input: buildResponsesInput(effectiveUserPrompt, attachments),
        ...(omitTemperature ? {} : { temperature: 0.4 }),
        ...(useJsonResponseFormat ? { text: { format: { type: "json_object" } } } : {}),
    };
}
function buildTextAttachmentContext(dataUrls, preset) {
    const { binaryDataUrls, textBlocks } = splitTextLikeAttachmentDataUrls(dataUrls || []);
    if (!textBlocks.length)
        return { binaryDataUrls, textContext: "" };
    const limits = getTextAttachmentLimits(preset);
    const { maxFiles, maxCharsPerFile, maxCharsTotal } = limits;
    let total = 0;
    const lines = [
        "Additional attached text context:",
    ];
    for (let i = 0; i < textBlocks.length && i < maxFiles; i += 1) {
        const block = textBlocks[i];
        const remaining = maxCharsTotal - total;
        if (remaining <= 0)
            break;
        const normalized = String(block.text || "").trim();
        if (!normalized)
            continue;
        const capped = normalized.slice(0, Math.min(maxCharsPerFile, remaining));
        if (!capped)
            continue;
        lines.push(`\n[Attached text file ${i + 1} - ${block.mimeType}]`);
        lines.push(capped);
        total += capped.length;
    }
    return {
        binaryDataUrls,
        textContext: lines.length > 1 ? lines.join("\n") : "",
    };
}
export async function requestStudyAssistantCompletionDetailed(params) {
    var _a, _b, _c, _d, _e, _f, _g;
    const { settings, systemPrompt, userPrompt, imageDataUrls = [], attachedFileDataUrls = [], documentAttachmentMode = "auto", mode = "text", conversationId, onConversationResolved, } = params;
    const apiKey = providerApiKey(settings.provider, settings.apiKeys);
    if (!apiKey) {
        throw new Error(`Missing API key for provider: ${settings.provider}`);
    }
    const base = providerBaseUrl(settings);
    const model = String(settings.model || "").trim();
    if (!base) {
        throw new Error("Missing endpoint override for custom provider.");
    }
    if (!model)
        throw new Error("Missing model name in Study Companion settings.");
    const attachmentPayload = prepareProviderAttachmentPayload({
        provider: settings.provider,
        userPrompt,
        imageDataUrls,
        attachedFileDataUrls,
        preset: settings.privacy.textAttachmentContextLimit,
        documentAttachmentMode,
    });
    const effectiveUserPrompt = attachmentPayload.userPrompt;
    const allDataUrls = attachmentPayload.dataUrls;
    const attachments = attachmentPayload.attachments;
    let activeAttachmentRoute = attachmentPayload.attachmentRoute;
    if (settings.provider === "anthropic") {
        const endpoint = `${base}/messages`;
        const tokenBudget = completionTokenBudget(settings.provider, model);
        let res;
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
                    max_tokens: tokenBudget,
                    system: systemPrompt,
                    messages: [{
                            role: "user",
                            content: buildAnthropicUserContent(effectiveUserPrompt, attachments),
                        }],
                }),
            });
        }
        catch (err) {
            const status = (_a = statusFromUnknownError(err)) !== null && _a !== void 0 ? _a : 0;
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
                    attachmentRoute: activeAttachmentRoute,
                    detail,
                    code,
                    errorType,
                    responseText,
                    responseJson,
                    originalError: err,
                });
            }
            throw attachAttachmentRouteToError(errorFromUnknown(err), activeAttachmentRoute);
        }
        if (res.status < 200 || res.status >= 300) {
            const detail = providerErrorDetail(res);
            const code = providerErrorCode(res);
            const errorType = providerErrorType(res);
            throw buildProviderRequestError({
                provider: settings.provider,
                endpoint,
                status: res.status,
                attachmentRoute: activeAttachmentRoute,
                detail,
                code,
                errorType,
                responseText: typeof res.text === "string" ? res.text : "",
                responseJson: res.json,
            });
        }
        const json = parseJsonFromUnknown(sanitizeJsonResponse(res.json));
        if (!json)
            throw new Error("Anthropic response was not a valid object.");
        assertAnthropicResponseShape(json);
        const text = extractTextFromAnthropicResponse(json);
        if (!text)
            throw new Error("Anthropic response did not include text content.");
        const resolvedConversationId = extractConversationIdFromResponse(json);
        if (resolvedConversationId && typeof onConversationResolved === "function") {
            onConversationResolved(resolvedConversationId);
        }
        return {
            text,
            attachmentRoute: activeAttachmentRoute,
            conversationId: resolvedConversationId !== null && resolvedConversationId !== void 0 ? resolvedConversationId : conversationId,
        };
    }
    if (providerUsesResponsesApi(settings.provider)) {
        const endpoint = `${base}/responses`;
        const requestResponsesApi = async (requestModel, options) => {
            var _a, _b, _c;
            const requestUserPrompt = (_a = options === null || options === void 0 ? void 0 : options.userPromptOverride) !== null && _a !== void 0 ? _a : effectiveUserPrompt;
            const requestAttachments = (_b = options === null || options === void 0 ? void 0 : options.attachmentsOverride) !== null && _b !== void 0 ? _b : attachments;
            try {
                return await requestUrl({
                    url: endpoint,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(buildResponsesRequestBody({
                        provider: settings.provider,
                        model: requestModel,
                        systemPrompt,
                        userPrompt: requestUserPrompt,
                        attachments: requestAttachments,
                        mode,
                        variant: options === null || options === void 0 ? void 0 : options.variant,
                    })),
                });
            }
            catch (err) {
                const status = (_c = statusFromUnknownError(err)) !== null && _c !== void 0 ? _c : 0;
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
                        attachmentRoute: activeAttachmentRoute,
                        detail,
                        code,
                        errorType,
                        responseText,
                        responseJson,
                        originalError: err,
                    });
                }
                throw attachAttachmentRouteToError(errorFromUnknown(err), activeAttachmentRoute);
            }
        };
        const assertOkOrThrow = (response) => {
            if (response.status < 200 || response.status >= 300) {
                const detail = providerErrorDetail(response);
                const code = providerErrorCode(response);
                const errorType = providerErrorType(response);
                throw buildProviderRequestError({
                    provider: settings.provider,
                    endpoint,
                    status: response.status,
                    attachmentRoute: activeAttachmentRoute,
                    detail,
                    code,
                    errorType,
                    responseText: typeof response.text === "string" ? response.text : "",
                    responseJson: response.json,
                });
            }
        };
        let res;
        let activeUserPrompt = effectiveUserPrompt;
        let activeAttachments = attachments;
        let activeDataUrls = allDataUrls;
        let activeVariant = "default";
        try {
            res = await requestResponsesApi(model, {
                userPromptOverride: activeUserPrompt,
                attachmentsOverride: activeAttachments,
                variant: activeVariant,
            });
            assertOkOrThrow(res);
        }
        catch (err) {
            let retryError = err;
            if (hasDocumentDataUrls(activeDataUrls) && isAttachmentRelatedRequestError(err)) {
                const fallback = buildDocumentFallbackContext(activeUserPrompt, activeDataUrls, settings.privacy.textAttachmentContextLimit);
                if (fallback.applied) {
                    activeUserPrompt = fallback.userPrompt;
                    activeDataUrls = fallback.dataUrls;
                    activeAttachments = parseAttachmentDataUrls(activeDataUrls);
                    activeAttachmentRoute = "retry-fallback";
                    try {
                        res = await requestResponsesApi(model, {
                            userPromptOverride: activeUserPrompt,
                            attachmentsOverride: activeAttachments,
                            variant: activeVariant,
                        });
                        assertOkOrThrow(res);
                        retryError = null;
                    }
                    catch (fallbackErr) {
                        retryError = fallbackErr;
                    }
                }
            }
            if (retryError && shouldRetryOpenAiLikeCompatibility(settings.provider, retryError)) {
                activeVariant = "compatibility";
                try {
                    res = await requestResponsesApi(model, {
                        userPromptOverride: activeUserPrompt,
                        attachmentsOverride: activeAttachments,
                        variant: activeVariant,
                    });
                    assertOkOrThrow(res);
                    retryError = null;
                }
                catch (compatibilityErr) {
                    retryError = compatibilityErr;
                }
            }
            if (retryError)
                throw attachAttachmentRouteToError(errorFromUnknown(retryError), activeAttachmentRoute);
        }
        const json = parseJsonFromUnknown(sanitizeJsonResponse(res.json));
        if (!json)
            throw new Error(`${settings.provider} response was not a valid object.`);
        assertOpenAiLikeResponseShape(json);
        const text = extractTextFromOpenAiLikeResponse(json);
        if (!text)
            throw new Error(`${settings.provider} response did not include text content.`);
        const resolvedConversationId = extractConversationIdFromResponse(json);
        if (resolvedConversationId && typeof onConversationResolved === "function") {
            onConversationResolved(resolvedConversationId);
        }
        return {
            text,
            attachmentRoute: activeAttachmentRoute,
            conversationId: resolvedConversationId !== null && resolvedConversationId !== void 0 ? resolvedConversationId : conversationId,
        };
    }
    const endpoint = `${base}/chat/completions`;
    const requestOpenAiLike = async (requestModel, options) => {
        var _a, _b, _c;
        const requestUserPrompt = (_a = options === null || options === void 0 ? void 0 : options.userPromptOverride) !== null && _a !== void 0 ? _a : effectiveUserPrompt;
        const requestAttachments = (_b = options === null || options === void 0 ? void 0 : options.attachmentsOverride) !== null && _b !== void 0 ? _b : attachments;
        try {
            return await requestUrl({
                url: endpoint,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    Authorization: `Bearer ${apiKey}`,
                    ...(settings.provider === "openrouter"
                        ? { "HTTP-Referer": "https://github.com/ctrlaltwill/learnkit", "X-Title": "LearnKit" }
                        : {}),
                },
                body: JSON.stringify(buildChatCompletionsBody({
                    provider: settings.provider,
                    model: requestModel,
                    systemPrompt,
                    userPrompt: requestUserPrompt,
                    attachments: requestAttachments,
                    mode,
                    conversationId,
                    variant: options === null || options === void 0 ? void 0 : options.variant,
                })),
            });
        }
        catch (err) {
            const status = (_c = statusFromUnknownError(err)) !== null && _c !== void 0 ? _c : 0;
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
                    attachmentRoute: activeAttachmentRoute,
                    detail,
                    code,
                    errorType,
                    responseText,
                    responseJson,
                    originalError: err,
                });
            }
            throw attachAttachmentRouteToError(errorFromUnknown(err), activeAttachmentRoute);
        }
    };
    const assertOkOrThrow = (response) => {
        if (response.status < 200 || response.status >= 300) {
            const detail = providerErrorDetail(response);
            const code = providerErrorCode(response);
            const errorType = providerErrorType(response);
            throw buildProviderRequestError({
                provider: settings.provider,
                endpoint,
                status: response.status,
                attachmentRoute: activeAttachmentRoute,
                detail,
                code,
                errorType,
                responseText: typeof response.text === "string" ? response.text : "",
                responseJson: response.json,
            });
        }
    };
    let res;
    let activeUserPrompt = effectiveUserPrompt;
    let activeAttachments = attachments;
    let activeDataUrls = allDataUrls;
    let activeModel = model;
    let activeVariant = "default";
    try {
        res = await requestOpenAiLike(activeModel, {
            userPromptOverride: activeUserPrompt,
            attachmentsOverride: activeAttachments,
            variant: activeVariant,
        });
        assertOkOrThrow(res);
    }
    catch (err) {
        let retryError = err;
        if (hasDocumentDataUrls(activeDataUrls) && isAttachmentRelatedRequestError(err)) {
            const fallback = buildDocumentFallbackContext(activeUserPrompt, activeDataUrls, settings.privacy.textAttachmentContextLimit);
            if (fallback.applied) {
                activeUserPrompt = fallback.userPrompt;
                activeDataUrls = fallback.dataUrls;
                activeAttachments = parseAttachmentDataUrls(activeDataUrls);
                activeAttachmentRoute = "retry-fallback";
                try {
                    res = await requestOpenAiLike(model, {
                        userPromptOverride: activeUserPrompt,
                        attachmentsOverride: activeAttachments,
                        variant: activeVariant,
                    });
                    assertOkOrThrow(res);
                    retryError = null;
                }
                catch (fallbackErr) {
                    retryError = fallbackErr;
                }
            }
        }
        if (retryError && shouldRetryDeepSeekCompatibility(settings.provider, retryError)) {
            const fallback = buildDocumentFallbackContext(activeUserPrompt, activeDataUrls, settings.privacy.textAttachmentContextLimit);
            if (fallback.applied) {
                activeUserPrompt = fallback.userPrompt;
                activeDataUrls = fallback.dataUrls;
                activeAttachments = parseAttachmentDataUrls(activeDataUrls);
                activeAttachmentRoute = "retry-fallback";
            }
            activeVariant = "deepseek-compat";
            try {
                res = await requestOpenAiLike(model, {
                    userPromptOverride: activeUserPrompt,
                    attachmentsOverride: activeAttachments,
                    variant: activeVariant,
                });
                assertOkOrThrow(res);
                retryError = null;
            }
            catch (deepSeekErr) {
                retryError = deepSeekErr;
            }
        }
        if (retryError && shouldRetryOpenAiLikeCompatibility(settings.provider, retryError)) {
            activeVariant = "compatibility";
            try {
                res = await requestOpenAiLike(activeModel, {
                    userPromptOverride: activeUserPrompt,
                    attachmentsOverride: activeAttachments,
                    variant: activeVariant,
                });
                assertOkOrThrow(res);
                retryError = null;
            }
            catch (compatibilityErr) {
                retryError = compatibilityErr;
            }
        }
        if (retryError) {
            const status = (_d = (_b = statusFromUnknownError(retryError)) !== null && _b !== void 0 ? _b : (_c = recordFromUnknown(retryError)) === null || _c === void 0 ? void 0 : _c.status) !== null && _d !== void 0 ? _d : 0;
            const canRetryOpenRouterModelAlias = settings.provider === "openrouter" && status === 404;
            if (!canRetryOpenRouterModelAlias) {
                throw attachAttachmentRouteToError(errorFromUnknown(retryError), activeAttachmentRoute);
            }
            const retryModels = await getOpenRouterRetryModelIds(activeModel);
            if (!retryModels.length) {
                throw attachAttachmentRouteToError(errorFromUnknown(retryError), activeAttachmentRoute);
            }
            let resolved = false;
            let latestRetryError = retryError;
            for (const retryModel of retryModels) {
                try {
                    res = await requestOpenAiLike(retryModel, {
                        userPromptOverride: activeUserPrompt,
                        attachmentsOverride: activeAttachments,
                        variant: activeVariant,
                    });
                    assertOkOrThrow(res);
                    activeModel = retryModel;
                    resolved = true;
                    break;
                }
                catch (candidateErr) {
                    latestRetryError = candidateErr;
                    const candidateStatus = (_g = (_e = statusFromUnknownError(candidateErr)) !== null && _e !== void 0 ? _e : (_f = recordFromUnknown(candidateErr)) === null || _f === void 0 ? void 0 : _f.status) !== null && _g !== void 0 ? _g : 0;
                    if (candidateStatus !== 404)
                        break;
                }
            }
            if (!resolved) {
                throw attachAttachmentRouteToError(errorFromUnknown(latestRetryError), activeAttachmentRoute);
            }
        }
    }
    const json = parseJsonFromUnknown(sanitizeJsonResponse(res.json));
    if (!json)
        throw new Error(`${settings.provider} response was not a valid object.`);
    assertOpenAiLikeResponseShape(json);
    const text = extractTextFromOpenAiLikeResponse(json);
    if (!text)
        throw new Error(`${settings.provider} response did not include text content.`);
    const resolvedConversationId = extractConversationIdFromResponse(json);
    if (resolvedConversationId && typeof onConversationResolved === "function") {
        onConversationResolved(resolvedConversationId);
    }
    return {
        text,
        attachmentRoute: activeAttachmentRoute,
        conversationId: resolvedConversationId !== null && resolvedConversationId !== void 0 ? resolvedConversationId : conversationId,
    };
}
export async function requestStudyAssistantCompletion(params) {
    const result = await requestStudyAssistantCompletionDetailed(params);
    return result.text;
}
// ---------------------------------------------------------------------------
//  Streaming completion (SSE)
// ---------------------------------------------------------------------------
function parseSSELines(buffer) {
    const events = [];
    let remainder = buffer;
    while (true) {
        const idx = remainder.indexOf("\n");
        if (idx === -1)
            break;
        const line = remainder.slice(0, idx).replace(/\r$/, "");
        remainder = remainder.slice(idx + 1);
        if (line.startsWith("data:")) {
            const payload = line.slice(5).trimStart();
            if (payload === "[DONE]")
                continue;
            events.push(payload);
        }
    }
    return { events, remainder };
}
function extractDeltaTextOpenAiLike(payload) {
    try {
        const json = JSON.parse(payload);
        const choices = Array.isArray(json.choices) ? json.choices : [];
        const first = parseJsonFromUnknown(choices[0]);
        const delta = parseJsonFromUnknown(first === null || first === void 0 ? void 0 : first.delta);
        if (typeof (delta === null || delta === void 0 ? void 0 : delta.content) === "string")
            return delta.content;
    }
    catch (_a) {
        // Malformed chunk — skip
    }
    return "";
}
function extractDeltaTextResponses(payload) {
    try {
        const json = JSON.parse(payload);
        if ((json.type === "response.output_text.delta" || json.type === "response.text.delta")
            && typeof json.delta === "string") {
            return json.delta;
        }
    }
    catch (_a) {
        // Malformed chunk — skip
    }
    return "";
}
function extractDeltaTextAnthropic(payload) {
    try {
        const json = JSON.parse(payload);
        if (json.type === "content_block_delta") {
            const delta = parseJsonFromUnknown(json.delta);
            if (typeof (delta === null || delta === void 0 ? void 0 : delta.text) === "string")
                return delta.text;
        }
    }
    catch (_a) {
        // Malformed chunk — skip
    }
    return "";
}
export async function requestStudyAssistantStreamingCompletion(params) {
    var _a, _b, _c;
    const { settings, systemPrompt, userPrompt, mode = "text", imageDataUrls = [], attachedFileDataUrls = [], documentAttachmentMode = "auto", conversationId, onChunk, signal, } = params;
    const apiKey = providerApiKey(settings.provider, settings.apiKeys);
    if (!apiKey)
        throw new Error(`Missing API key for provider: ${settings.provider}`);
    const base = providerBaseUrl(settings);
    const model = String(settings.model || "").trim();
    if (!base)
        throw new Error("Missing endpoint override for custom provider.");
    if (!model)
        throw new Error("Missing model name in Study Companion settings.");
    const attachmentPayload = prepareProviderAttachmentPayload({
        provider: settings.provider,
        userPrompt,
        imageDataUrls,
        attachedFileDataUrls,
        preset: settings.privacy.textAttachmentContextLimit,
        documentAttachmentMode,
    });
    const effectiveUserPrompt = attachmentPayload.userPrompt;
    const allDataUrls = attachmentPayload.dataUrls;
    const attachments = attachmentPayload.attachments;
    let activeAttachmentRoute = attachmentPayload.attachmentRoute;
    const requestFamily = settings.provider === "anthropic"
        ? "anthropic"
        : providerUsesResponsesApi(settings.provider)
            ? "responses"
            : "chat";
    const endpoint = requestFamily === "anthropic"
        ? `${base}/messages`
        : requestFamily === "responses"
            ? `${base}/responses`
            : `${base}/chat/completions`;
    let headers;
    let body;
    let activeUserPrompt = effectiveUserPrompt;
    let activeAttachments = attachments;
    let activeDataUrls = allDataUrls;
    let activeModel = model;
    let activeResponsesVariant = "default";
    let activeVariant = "default";
    const buildResponsesStreamingBody = (requestModel, userPromptForRequest, attachmentsForRequest, variant = "default") => JSON.stringify(buildResponsesRequestBody({
        provider: settings.provider,
        model: requestModel,
        systemPrompt,
        userPrompt: userPromptForRequest,
        attachments: attachmentsForRequest,
        mode,
        variant,
        stream: true,
    }));
    const buildChatStreamingBody = (requestModel, userPromptForRequest, attachmentsForRequest, variant = "default") => JSON.stringify(buildChatCompletionsBody({
        provider: settings.provider,
        model: requestModel,
        systemPrompt,
        userPrompt: userPromptForRequest,
        attachments: attachmentsForRequest,
        mode,
        conversationId,
        variant,
        stream: true,
    }));
    if (requestFamily === "anthropic") {
        headers = {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        };
        body = JSON.stringify({
            model,
            max_tokens: completionTokenBudget(settings.provider, model),
            stream: true,
            system: systemPrompt,
            messages: [{
                    role: "user",
                    content: buildAnthropicUserContent(activeUserPrompt, activeAttachments),
                }],
        });
    }
    else if (requestFamily === "responses") {
        headers = {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${apiKey}`,
        };
        body = buildResponsesStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeResponsesVariant);
    }
    else {
        headers = {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${apiKey}`,
            ...(settings.provider === "openrouter"
                ? { "HTTP-Referer": "https://github.com/ctrlaltwill/learnkit", "X-Title": "LearnKit" }
                : {}),
        };
        body = buildChatStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeVariant);
    }
    throwIfStreamingAborted(signal);
    const sendStreamingRequest = async (requestBody) => requestStreamingTransport({
        url: endpoint,
        method: "POST",
        headers,
        body: requestBody,
        signal,
    });
    let response;
    try {
        response = await sendStreamingRequest(body);
    }
    catch (err) {
        let latestError = err;
        let retryResponse = null;
        if (requestFamily !== "anthropic" && hasDocumentDataUrls(activeDataUrls) && isAttachmentRelatedRequestError(latestError)) {
            const fallback = buildDocumentFallbackContext(activeUserPrompt, activeDataUrls, settings.privacy.textAttachmentContextLimit);
            if (fallback.applied) {
                activeUserPrompt = fallback.userPrompt;
                activeDataUrls = fallback.dataUrls;
                activeAttachments = parseAttachmentDataUrls(activeDataUrls);
                activeAttachmentRoute = "retry-fallback";
                const fallbackBody = requestFamily === "responses"
                    ? buildResponsesStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                    : buildChatStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeVariant);
                try {
                    retryResponse = await sendStreamingRequest(fallbackBody);
                }
                catch (fallbackErr) {
                    latestError = fallbackErr;
                }
            }
        }
        if (!retryResponse && shouldRetryDeepSeekCompatibility(settings.provider, latestError)) {
            const fallback = buildDocumentFallbackContext(activeUserPrompt, activeDataUrls, settings.privacy.textAttachmentContextLimit);
            if (fallback.applied) {
                activeUserPrompt = fallback.userPrompt;
                activeDataUrls = fallback.dataUrls;
                activeAttachments = parseAttachmentDataUrls(activeDataUrls);
                activeAttachmentRoute = "retry-fallback";
            }
            activeVariant = "deepseek-compat";
            const fallbackBody = requestFamily === "responses"
                ? buildResponsesStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                : buildChatStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeVariant);
            try {
                retryResponse = await sendStreamingRequest(fallbackBody);
            }
            catch (fallbackErr) {
                latestError = fallbackErr;
            }
        }
        if (!retryResponse && shouldRetryOpenAiLikeCompatibility(settings.provider, latestError)) {
            if (requestFamily === "responses")
                activeResponsesVariant = "compatibility";
            else
                activeVariant = "compatibility";
            const compatibilityBody = requestFamily === "responses"
                ? buildResponsesStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                : buildChatStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeVariant);
            try {
                retryResponse = await sendStreamingRequest(compatibilityBody);
            }
            catch (compatibilityErr) {
                latestError = compatibilityErr;
            }
        }
        if (!retryResponse && settings.provider === "openrouter") {
            const status = (_a = statusFromUnknownError(latestError)) !== null && _a !== void 0 ? _a : 0;
            if (status === 404) {
                const retryModels = await getOpenRouterRetryModelIds(activeModel);
                for (const retryModel of retryModels) {
                    const retryBody = requestFamily === "responses"
                        ? buildResponsesStreamingBody(retryModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                        : buildChatStreamingBody(retryModel, activeUserPrompt, activeAttachments, activeVariant);
                    try {
                        retryResponse = await sendStreamingRequest(retryBody);
                        if (retryResponse.status >= 200 && retryResponse.status < 300) {
                            activeModel = retryModel;
                            break;
                        }
                        latestError = retryResponse;
                        if (retryResponse.status !== 404)
                            break;
                    }
                    catch (candidateErr) {
                        latestError = candidateErr;
                        const candidateStatus = (_b = statusFromUnknownError(candidateErr)) !== null && _b !== void 0 ? _b : 0;
                        if (candidateStatus !== 404)
                            break;
                    }
                }
            }
        }
        if (retryResponse) {
            response = retryResponse;
        }
        else {
            const status = (_c = statusFromUnknownError(latestError)) !== null && _c !== void 0 ? _c : 0;
            if (status > 0) {
                const responseText = responseTextFromUnknownError(latestError);
                const responseJson = responseJsonFromUnknownError(latestError);
                const detail = providerErrorDetail({ json: responseJson, text: responseText });
                const code = providerErrorCode({ json: responseJson, text: responseText });
                const errorType = providerErrorType({ json: responseJson });
                throw buildProviderRequestError({
                    provider: settings.provider,
                    endpoint,
                    status,
                    attachmentRoute: activeAttachmentRoute,
                    detail,
                    code,
                    errorType,
                    responseText,
                    responseJson,
                    originalError: latestError,
                });
            }
            throw attachAttachmentRouteToError(errorFromUnknown(latestError), activeAttachmentRoute);
        }
    }
    if (response.status < 200 || response.status >= 300) {
        if (requestFamily !== "anthropic" && hasDocumentDataUrls(activeDataUrls)) {
            const detail = providerErrorDetail(response);
            const code = providerErrorCode(response);
            const errorType = providerErrorType(response);
            if (isAttachmentRelatedRequestError({ status: response.status, detail, code, errorType })) {
                const fallback = buildDocumentFallbackContext(activeUserPrompt, activeDataUrls, settings.privacy.textAttachmentContextLimit);
                if (fallback.applied) {
                    activeUserPrompt = fallback.userPrompt;
                    activeDataUrls = fallback.dataUrls;
                    activeAttachments = parseAttachmentDataUrls(activeDataUrls);
                    activeAttachmentRoute = "retry-fallback";
                    const fallbackBody = requestFamily === "responses"
                        ? buildResponsesStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                        : buildChatStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeVariant);
                    response = await sendStreamingRequest(fallbackBody);
                }
            }
        }
        if (response.status >= 400 && shouldRetryDeepSeekCompatibility(settings.provider, response)) {
            const fallback = buildDocumentFallbackContext(activeUserPrompt, activeDataUrls, settings.privacy.textAttachmentContextLimit);
            if (fallback.applied) {
                activeUserPrompt = fallback.userPrompt;
                activeDataUrls = fallback.dataUrls;
                activeAttachments = parseAttachmentDataUrls(activeDataUrls);
                activeAttachmentRoute = "retry-fallback";
            }
            activeVariant = "deepseek-compat";
            const fallbackBody = requestFamily === "responses"
                ? buildResponsesStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                : buildChatStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeVariant);
            response = await sendStreamingRequest(fallbackBody);
        }
        if (response.status >= 400 && shouldRetryOpenAiLikeCompatibility(settings.provider, response)) {
            if (requestFamily === "responses")
                activeResponsesVariant = "compatibility";
            else
                activeVariant = "compatibility";
            const compatibilityBody = requestFamily === "responses"
                ? buildResponsesStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                : buildChatStreamingBody(activeModel, activeUserPrompt, activeAttachments, activeVariant);
            response = await sendStreamingRequest(compatibilityBody);
        }
        if (response.status === 404 && settings.provider === "openrouter") {
            const retryModels = await getOpenRouterRetryModelIds(activeModel);
            for (const retryModel of retryModels) {
                const retryBody = requestFamily === "responses"
                    ? buildResponsesStreamingBody(retryModel, activeUserPrompt, activeAttachments, activeResponsesVariant)
                    : buildChatStreamingBody(retryModel, activeUserPrompt, activeAttachments, activeVariant);
                response = await sendStreamingRequest(retryBody);
                if (response.status >= 200 && response.status < 300) {
                    activeModel = retryModel;
                    break;
                }
                if (response.status !== 404)
                    break;
            }
        }
        if (response.status >= 200 && response.status < 300) {
            // Fallback retry produced a successful stream response.
        }
        else {
            const detail = providerErrorDetail(response);
            const code = providerErrorCode(response);
            const errorType = providerErrorType(response);
            throw buildProviderRequestError({
                provider: settings.provider,
                endpoint,
                status: response.status,
                attachmentRoute: activeAttachmentRoute,
                detail,
                code,
                errorType,
                responseText: typeof response.text === "string" ? response.text : "",
                responseJson: response.json,
            });
        }
    }
    throwIfStreamingAborted(signal);
    const extractDelta = requestFamily === "anthropic"
        ? extractDeltaTextAnthropic
        : requestFamily === "responses"
            ? extractDeltaTextResponses
            : extractDeltaTextOpenAiLike;
    const fullText = await readStreamingResponseText({
        response,
        extractDelta,
        onChunk,
        signal,
    });
    if (!fullText.trim())
        throw new Error(`${settings.provider} streaming response did not include text content.`);
    return {
        text: fullText,
        attachmentRoute: activeAttachmentRoute,
        conversationId,
    };
}
export async function deleteStudyAssistantConversation(params) {
    var _a;
    const { settings } = params;
    const conversationId = String(params.conversationId || "").trim();
    if (!conversationId)
        return { deleted: false, unsupported: true, detail: "Missing conversation id." };
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
    if (!base)
        return { deleted: false, status: 400, detail: "Missing endpoint override for custom provider." };
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
        }
        catch (err) {
            const status = (_a = statusFromUnknownError(err)) !== null && _a !== void 0 ? _a : 0;
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
