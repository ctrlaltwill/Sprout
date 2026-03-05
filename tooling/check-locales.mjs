#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const localesDir = path.join(root, "src", "platform", "translations", "locales");
const baseLocale = "en-gb";

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path.relative(root, filePath)} must be a JSON object.`);
  }
  return parsed;
}

function placeholdersOf(text) {
  const out = new Set();
  const rx = /\{([a-zA-Z0-9_.-]+)\}/g;
  let m;
  while ((m = rx.exec(text)) !== null) out.add(m[1]);
  return Array.from(out).sort();
}

if (!fs.existsSync(localesDir)) {
  throw new Error(`Locales directory not found: ${localesDir}`);
}

const files = fs
  .readdirSync(localesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (!files.length) {
  throw new Error("No locale files found in src/platform/translations/locales.");
}

const baseFile = `${baseLocale}.json`;
if (!files.includes(baseFile)) {
  throw new Error(`Missing base locale file ${baseFile}.`);
}

const byLocale = new Map();
for (const file of files) {
  const locale = file.replace(/\.json$/i, "");
  byLocale.set(locale, readJson(path.join(localesDir, file)));
}

const base = byLocale.get(baseLocale);
const baseKeys = Object.keys(base).sort();

let hasErrors = false;

for (const [locale, dict] of byLocale.entries()) {
  const keys = Object.keys(dict).sort();
  const missing = baseKeys.filter((k) => !(k in dict));
  const extra = keys.filter((k) => !(k in base));

  if (missing.length) {
    hasErrors = true;
    console.error(`[translations] ${locale}: missing keys:`);
    for (const k of missing) console.error(`  - ${k}`);
  }

  if (extra.length) {
    hasErrors = true;
    console.error(`[translations] ${locale}: unknown extra keys:`);
    for (const k of extra) console.error(`  - ${k}`);
  }

  for (const key of baseKeys) {
    const baseVal = String(base[key] ?? "");
    const curVal = String(dict[key] ?? "");
    const expected = placeholdersOf(baseVal);
    const actual = placeholdersOf(curVal);
    if (expected.join("|") !== actual.join("|")) {
      hasErrors = true;
      console.error(`[translations] ${locale}: placeholder mismatch for key '${key}'`);
      console.error(`  expected: {${expected.join("}, {")}}`);
      console.error(`  actual:   {${actual.join("}, {")}}`);
    }
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`[translations] OK (${files.length} locale file${files.length === 1 ? "" : "s"})`);
