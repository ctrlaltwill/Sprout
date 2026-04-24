/**
 * @file src/views/study-assistant/popup/assistant-popup-error.ts
 * @summary Module for assistant popup error.
 *
 * @exports
 *  - AssistantErrorContext
 *  - assistantConsoleErrorDetails
 *  - logAssistantRequestError
 *  - formatAssistantError
 */
import { log } from "../../../platform/core/logger";
import { safeText } from "./assistant-popup-helpers";
import { formatProviderLabel } from "./assistant-popup-provider";
export function assistantConsoleErrorDetails(error) {
    const details = {};
    if (error instanceof Error) {
        details.name = error.name;
        details.message = error.message;
        if (error.stack)
            details.stack = error.stack;
    }
    if (error && typeof error === "object") {
        const map = error;
        const keys = [
            "provider",
            "status",
            "detail",
            "code",
            "errorType",
            "endpoint",
            "responseText",
            "responseJson",
            "originalError",
        ];
        for (const key of keys) {
            if (map[key] !== undefined)
                details[key] = map[key];
        }
    }
    return details;
}
function asRecord(value) {
    if (!value || typeof value !== "object")
        return null;
    return value;
}
function toCodeText(value) {
    return safeText(value).trim();
}
function titleCaseWords(value) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
function humanizeCodeLabel(code) {
    const raw = toCodeText(code).replace(/[.]/g, " ").trim();
    if (!raw)
        return "request error";
    if (/^[A-Z0-9_]+$/.test(raw))
        return titleCaseWords(raw.replace(/_/g, " ").toLowerCase());
    return raw
        .replace(/[_-]+/g, " ")
        .replace(/\berror\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
function extractProviderErrorInfo(error) {
    const map = asRecord(error);
    if (!map)
        return null;
    const provider = toCodeText(map.provider).toLowerCase();
    const statusRaw = map.status;
    const parsedStatus = typeof statusRaw === "number" ? statusRaw : Number(statusRaw);
    const status = Number.isFinite(parsedStatus) ? Math.floor(parsedStatus) : null;
    const detail = toCodeText(map.detail);
    const code = toCodeText(map.code);
    const errorType = toCodeText(map.errorType);
    if (!provider && !status && !detail && !code && !errorType)
        return null;
    return { provider, status, detail, code, errorType };
}
function summarizeProviderError(info) {
    const primaryCode = info.code || info.errorType;
    if (primaryCode)
        return humanizeCodeLabel(primaryCode);
    if (info.status)
        return `HTTP ${info.status}`;
    if (info.detail)
        return info.detail;
    return "request error";
}
function containsAny(text, terms) {
    return terms.some((term) => text.includes(term));
}
function providerLikelyCauses(info) {
    const provider = info.provider;
    const code = `${info.code} ${info.errorType}`.toLowerCase();
    const detail = info.detail.toLowerCase();
    const combined = `${code} ${detail}`;
    const causes = [];
    const add = (value) => {
        if (!causes.includes(value))
            causes.push(value);
    };
    if (containsAny(combined, ["attachment", "attachments", "image", "file", "multimodal", "vision"])) {
        add("you attached files/images to a model that does not support attachments");
    }
    if (containsAny(combined, ["invalid_request", "invalid argument", "invalid_argument", "bad request", "unprocessable"])) {
        add("the prompt payload format was invalid for this provider or model");
    }
    if (containsAny(combined, ["model_not_found", "not found", "unknown model"])) {
        add("the selected model id is not available for this provider or API key");
    }
    if (containsAny(combined, ["context_length", "token", "too long", "max context", "prompt too large"])) {
        add("the message or attachments exceeded the model context/token limits");
    }
    if (containsAny(combined, ["rate_limit", "resource_exhausted", "too many requests", "overloaded"])) {
        add("the provider is rate-limiting requests or temporarily overloaded");
    }
    if (containsAny(combined, ["insufficient_quota", "quota", "billing", "payment", "credit"])) {
        add("the account has no remaining credits/quota or billing is not enabled");
    }
    if (containsAny(combined, ["permission", "forbidden", "access denied"])) {
        add("the API key does not have permission for this model or endpoint");
    }
    if (info.status === 401 || containsAny(combined, ["unauthorized", "unauthenticated", "invalid api key"])) {
        add("the API key is missing, invalid, or sent to the wrong provider endpoint");
    }
    if (info.status === 404) {
        add("the model or endpoint path could not be found");
    }
    if (info.status === 429) {
        add("too many requests were sent in a short time");
    }
    if (provider === "anthropic" && containsAny(combined, ["request_too_large"])) {
        add("the request body (including attachments) is too large for Anthropic limits");
    }
    if (provider === "google" && containsAny(combined, ["failed_precondition"])) {
        add("the selected model may not support the requested response or attachment format");
    }
    if (provider === "openrouter" && containsAny(combined, ["provider_error", "no available provider"])) {
        add("no upstream model provider was available for this request at that time");
    }
    if (!causes.length) {
        add("the selected model, endpoint, or request format is incompatible");
        add("the provider returned a temporary error and a retry may succeed");
    }
    return causes.slice(0, 3);
}
function formatCauseList(causes) {
    if (!causes.length)
        return "the request could not be validated by the provider";
    if (causes.length === 1)
        return causes[0];
    if (causes.length === 2)
        return `${causes[0]}, or ${causes[1]}`;
    return `${causes[0]}, ${causes[1]}, or ${causes[2]}`;
}
export function logAssistantRequestError(context, error, userMessage) {
    log.error(`[Study Companion] ${context} request failed`, error, {
        userMessage,
        ...assistantConsoleErrorDetails(error),
    });
}
export function formatAssistantError(error, tx) {
    const raw = safeText(error instanceof Error ? error.message : error)
        .replace(/^error:\s*/i, "")
        .trim();
    const providerInfo = extractProviderErrorInfo(error);
    if (!raw) {
        return tx("ui.studyAssistant.error.generic", "Error: AI request failed. Please try again.");
    }
    const unknownProvider = () => tx("ui.studyAssistant.provider.unknown", "AI provider");
    const missingKey = raw.match(/^Missing API key for provider:\s*([a-z0-9_-]+)$/i);
    if (missingKey === null || missingKey === void 0 ? void 0 : missingKey[1]) {
        return tx("ui.studyAssistant.error.missingApiKey", "Error: API key missing for {provider}. Add it in Study Companion settings.", { provider: formatProviderLabel(missingKey[1], unknownProvider) });
    }
    if (/^Missing endpoint override for custom provider\.?$/i.test(raw)) {
        return tx("ui.studyAssistant.error.missingEndpoint", "Error: Endpoint missing for Custom provider. Set an endpoint URL in Study Companion settings.");
    }
    if (/^Missing model name in Study Companion settings\.?$/i.test(raw)) {
        return tx("ui.studyAssistant.error.missingModel", "Error: Model missing. Choose a model in Study Companion settings.");
    }
    if (providerInfo) {
        const provider = formatProviderLabel(providerInfo.provider, unknownProvider);
        const summary = summarizeProviderError(providerInfo);
        const causes = formatCauseList(providerLikelyCauses(providerInfo));
        return tx("ui.studyAssistant.error.providerHumanized", "Error received from AI provider ({provider}): {summary}. This might happen because {causes}.", { provider, summary, causes });
    }
    const httpFailure = raw.match(/^([a-z0-9_-]+) request failed \((\d{3})\)$/i);
    if ((httpFailure === null || httpFailure === void 0 ? void 0 : httpFailure[1]) && (httpFailure === null || httpFailure === void 0 ? void 0 : httpFailure[2])) {
        const provider = formatProviderLabel(httpFailure[1], unknownProvider);
        const status = httpFailure[2];
        return tx("ui.studyAssistant.error.http", "Error received from AI provider ({provider}): HTTP {status}. This might happen because the API key, model, or endpoint configuration is invalid.", { provider, status });
    }
    const emptyText = raw.match(/^([a-z0-9_-]+) response did not include text content\.?$/i);
    if (emptyText === null || emptyText === void 0 ? void 0 : emptyText[1]) {
        return tx("ui.studyAssistant.error.emptyResponse", "Error: AI returned an empty response from {provider}. Try again or switch models.", { provider: formatProviderLabel(emptyText[1], unknownProvider) });
    }
    return tx("ui.studyAssistant.error.withDetails", "Error: AI request failed. {details}", { details: raw });
}
