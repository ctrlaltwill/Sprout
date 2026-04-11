#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const localesDir = path.join(root, "src", "platform", "translations", "locales");
const baseFile = "en-base.json";

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

if (!files.includes(baseFile)) {
  throw new Error(`Missing base locale file ${baseFile}.`);
}

const base = readJson(path.join(localesDir, baseFile));
const baseKeys = Object.keys(base).sort();

const overrideFiles = files.filter((f) => f !== baseFile && f !== "token-aliases.json");

let hasErrors = false;

// Validate override locale files: every key must exist in base, placeholders must match
for (const file of overrideFiles) {
  const locale = file.replace(/\.json$/i, "");
  const dict = readJson(path.join(localesDir, file));
  const keys = Object.keys(dict).sort();

  const extra = keys.filter((k) => !(k in base));
  if (extra.length) {
    hasErrors = true;
    console.error(`[translations] ${locale}: unknown extra keys (not in en-base):`);
    for (const k of extra) console.error(`  - ${k}`);
  }

  for (const key of keys) {
    if (!(key in base)) continue;
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

const overrideCount = overrideFiles.length;

// Validate token-aliases.json: every target must exist in base
const aliasFile = "token-aliases.json";
if (files.includes(aliasFile)) {
  const aliases = readJson(path.join(localesDir, aliasFile));
  for (const [oldKey, canonical] of Object.entries(aliases)) {
    if (!(canonical in base)) {
      hasErrors = true;
      console.error(`[translations] alias target missing: ${oldKey} → ${canonical}`);
    }
  }
  if (hasErrors) process.exit(1);
  console.log(
    `[translations] OK — base: ${baseKeys.length} keys, ${Object.keys(aliases).length} aliases, ${overrideCount} override file${overrideCount === 1 ? "" : "s"}`,
  );
} else {
  console.log(
    `[translations] OK — base: ${baseKeys.length} keys, ${overrideCount} override file${overrideCount === 1 ? "" : "s"}`,
  );
}
