/**
 * @file src/platform/translations/translator.ts
 * @summary Module for translator.
 *
 * @exports
 *  - t
 *  - tPlural
 *  - pluralSuffix
 */

import { DEFAULT_INTERFACE_LOCALE, resolveInterfaceLocale } from "./locale-registry";
import EN_BASE_JSON from "./locales/en-base.json";
import EN_GB_OVERRIDES_JSON from "./locales/en-gb.json";
import EN_US_OVERRIDES_JSON from "./locales/en-us.json";
import TOKEN_ALIASES_JSON from "./locales/token-aliases.json";

type TranslationVars = Record<string, string | number>;

const EN_BASE = EN_BASE_JSON as Readonly<Record<string, string>>;
const TOKEN_ALIASES = TOKEN_ALIASES_JSON as Readonly<Record<string, string>>;

function mergeLocale(
  overrides: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (Object.keys(overrides).length === 0) return EN_BASE;
  return { ...EN_BASE, ...overrides };
}

const MESSAGE_BUNDLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "en-gb": mergeLocale(EN_GB_OVERRIDES_JSON as Readonly<Record<string, string>>),
  "en-us": mergeLocale(EN_US_OVERRIDES_JSON as Readonly<Record<string, string>>),
};

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, key: string) => {
    const v = vars[key];
    return v == null ? `{${key}}` : String(v);
  });
}

export function t(
  locale: unknown,
  token: string,
  fallback: string,
  vars?: TranslationVars,
): string {
  const resolvedLocale = resolveInterfaceLocale(locale);
  const resolvedToken = TOKEN_ALIASES[token] ?? token;
  const primary = MESSAGE_BUNDLES[resolvedLocale]?.[resolvedToken];
  const english = MESSAGE_BUNDLES[DEFAULT_INTERFACE_LOCALE]?.[resolvedToken];
  const chosen = primary ?? english ?? fallback;
  return interpolate(chosen, vars);
}

/**
 * Returns "s" when count !== 1, "" otherwise.
 * Convenience for English-style plurals — translators for other languages
 * can override the full string via `tPlural` instead.
 */
export function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

/**
 * Translate with automatic plural suffix injection.
 * Adds `{count}` and `{suffix}` ("" or "s") to the vars automatically.
 * Translators for non-English locales can override the template entirely
 * using their own grammar rules since the full phrase is a single token.
 */
export function tPlural(
  locale: unknown,
  token: string,
  fallback: string,
  count: number,
  vars?: TranslationVars,
): string {
  return t(locale, token, fallback, {
    ...vars,
    count,
    suffix: pluralSuffix(count),
  });
}
