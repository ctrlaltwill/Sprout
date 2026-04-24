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
const EN_BASE = EN_BASE_JSON;
const TOKEN_ALIASES = TOKEN_ALIASES_JSON;
function mergeLocale(overrides) {
    if (Object.keys(overrides).length === 0)
        return EN_BASE;
    return { ...EN_BASE, ...overrides };
}
const MESSAGE_BUNDLES = {
    "en-gb": mergeLocale(EN_GB_OVERRIDES_JSON),
    "en-us": mergeLocale(EN_US_OVERRIDES_JSON),
};
function interpolate(template, vars) {
    if (!vars)
        return template;
    return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, key) => {
        const v = vars[key];
        return v == null ? `{${key}}` : String(v);
    });
}
export function t(locale, token, fallback, vars) {
    var _a, _b, _c, _d;
    const resolvedLocale = resolveInterfaceLocale(locale);
    const resolvedToken = (_a = TOKEN_ALIASES[token]) !== null && _a !== void 0 ? _a : token;
    const primary = (_b = MESSAGE_BUNDLES[resolvedLocale]) === null || _b === void 0 ? void 0 : _b[resolvedToken];
    const english = (_c = MESSAGE_BUNDLES[DEFAULT_INTERFACE_LOCALE]) === null || _c === void 0 ? void 0 : _c[resolvedToken];
    const chosen = (_d = primary !== null && primary !== void 0 ? primary : english) !== null && _d !== void 0 ? _d : fallback;
    return interpolate(chosen, vars);
}
/**
 * Returns "s" when count !== 1, "" otherwise.
 * Convenience for English-style plurals — translators for other languages
 * can override the full string via `tPlural` instead.
 */
export function pluralSuffix(count) {
    return count === 1 ? "" : "s";
}
/**
 * Translate with automatic plural suffix injection.
 * Adds `{count}` and `{suffix}` ("" or "s") to the vars automatically.
 * Translators for non-English locales can override the template entirely
 * using their own grammar rules since the full phrase is a single token.
 */
export function tPlural(locale, token, fallback, count, vars) {
    return t(locale, token, fallback, {
        ...vars,
        count,
        suffix: pluralSuffix(count),
    });
}
