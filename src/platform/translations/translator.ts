/**
 * @file src/platform/translations/translator.ts
 * @summary Module for translator.
 *
 * @exports
 *  - t
 */

import { DEFAULT_INTERFACE_LOCALE, resolveInterfaceLocale } from "./locale-registry";
import EN_GB_MESSAGES_JSON from "./locales/en-gb.json";
import EN_US_MESSAGES_JSON from "./locales/en-us.json";

type TranslationVars = Record<string, string | number>;

const EN_GB_MESSAGES = EN_GB_MESSAGES_JSON as Readonly<Record<string, string>>;
const EN_US_MESSAGES = EN_US_MESSAGES_JSON as Readonly<Record<string, string>>;

const MESSAGE_BUNDLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "en-gb": EN_GB_MESSAGES,
  "en-us": EN_US_MESSAGES,
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
  const primary = MESSAGE_BUNDLES[resolvedLocale]?.[token];
  const english = MESSAGE_BUNDLES[DEFAULT_INTERFACE_LOCALE]?.[token];
  const chosen = primary ?? english ?? fallback;
  return interpolate(chosen, vars);
}
