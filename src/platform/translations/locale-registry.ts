/**
 * @file src/platform/translations/locale-registry.ts
 * @summary Source of truth for interface locales supported by Sprout.
 */

export type InterfaceLocaleDefinition = {
  code: string;
  label: string;
  nativeLabel: string;
  flagCode?: string;
  status: "stable" | "community";
};

export const DEFAULT_INTERFACE_LOCALE = "en-gb";

const INTERFACE_LOCALE_REGISTRY: ReadonlyArray<InterfaceLocaleDefinition> = [
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

export function getSupportedInterfaceLocales(): InterfaceLocaleDefinition[] {
  return INTERFACE_LOCALE_REGISTRY.map((locale) => ({ ...locale }));
}

export function normaliseInterfaceLocale(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return `${value}`.trim().toLowerCase();
  return "";
}

export function resolveInterfaceLocale(value: unknown): string {
  const candidate = normaliseInterfaceLocale(value);
  if (candidate === "en") return "en-gb";
  return INTERFACE_LOCALE_SET.has(candidate) ? candidate : DEFAULT_INTERFACE_LOCALE;
}

export function getInterfaceLocaleLabel(code: string): string {
  const candidate = normaliseInterfaceLocale(code);
  const hit = INTERFACE_LOCALE_REGISTRY.find((locale) => locale.code === candidate);
  return (hit?.label ?? candidate) || DEFAULT_INTERFACE_LOCALE;
}
