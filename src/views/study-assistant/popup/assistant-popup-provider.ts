/**
 * @file src/views/study-assistant/popup/assistant-popup-provider.ts
 * @summary Module for assistant popup provider.
 *
 * @exports
 *  - formatProviderLabel
 */

export function formatProviderLabel(
  raw: string,
  txUnknown: () => string,
): string {
  const provider = String(raw || "").trim().toLowerCase();
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "xai") return "xAI";
  if (provider === "google") return "Google";
  if (provider === "perplexity") return "Perplexity";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "custom") return "Custom provider";
  if (!provider) return txUnknown();
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
