/**
 * @file src/platform/translations/locale-registry.ts
 * @summary Module for locale registry.
 *
 * @exports
 *  - InterfaceLocaleDefinition
 *  - DEFAULT_INTERFACE_LOCALE
 *  - getSupportedInterfaceLocales
 *  - normaliseInterfaceLocale
 *  - resolveInterfaceLocale
 *  - getInterfaceLocaleLabel
 */
export const DEFAULT_INTERFACE_LOCALE = "en-gb";
const INTERFACE_LOCALE_REGISTRY = [
    {
        code: "en-gb",
        label: "English (UK)",
        nativeLabel: "English (United Kingdom)",
        flagCode: "en-gb",
        status: "stable",
    },
    {
        code: "en-us",
        label: "English (US)",
        nativeLabel: "English (United States)",
        flagCode: "en-us",
        status: "stable",
    },
];
const INTERFACE_LOCALE_SET = new Set(INTERFACE_LOCALE_REGISTRY.map((locale) => locale.code));
export function getSupportedInterfaceLocales() {
    return INTERFACE_LOCALE_REGISTRY.map((locale) => ({ ...locale }));
}
export function normaliseInterfaceLocale(value) {
    if (typeof value === "string")
        return value.trim().toLowerCase();
    if (typeof value === "number" || typeof value === "boolean")
        return `${value}`.trim().toLowerCase();
    return "";
}
export function resolveInterfaceLocale(value) {
    const candidate = normaliseInterfaceLocale(value);
    if (candidate === "en")
        return "en-gb";
    return INTERFACE_LOCALE_SET.has(candidate) ? candidate : DEFAULT_INTERFACE_LOCALE;
}
export function getInterfaceLocaleLabel(code) {
    var _a;
    const candidate = normaliseInterfaceLocale(code);
    const hit = INTERFACE_LOCALE_REGISTRY.find((locale) => locale.code === candidate);
    return ((_a = hit === null || hit === void 0 ? void 0 : hit.label) !== null && _a !== void 0 ? _a : candidate) || DEFAULT_INTERFACE_LOCALE;
}
