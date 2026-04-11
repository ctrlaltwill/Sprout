#!/usr/bin/env node
/**
 * Non-blocking locale health report.
 *
 * Reports:
 *  1. Duplicate-value hotspots (top repeated values in en-base.json)
 *  2. Near-duplicate strings (values differing only by case or trailing punctuation)
 *  3. Containment clusters (short values embedded inside longer ones)
 *
 * Exit code is always 0 — this is advisory, not a gate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const basePath = path.join(
  root,
  "src",
  "platform",
  "translations",
  "locales",
  "en-base.json",
);

if (!fs.existsSync(basePath)) {
  console.error("en-base.json not found.");
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
const entries = Object.entries(base);

// ── 1. Duplicate-value hotspots ──────────────────────────────────────────
const valueCounts = new Map();
for (const [key, val] of entries) {
  const s = String(val);
  if (!valueCounts.has(s)) valueCounts.set(s, []);
  valueCounts.get(s).push(key);
}

const duplicates = [...valueCounts.entries()]
  .filter(([, keys]) => keys.length >= 3)
  .sort((a, b) => b[1].length - a[1].length);

console.log("═══ Locale Health Report ═══\n");
console.log(`Total keys: ${entries.length}\n`);

if (duplicates.length) {
  console.log(`── Duplicate-value hotspots (value used ≥3 times) ──`);
  for (const [val, keys] of duplicates) {
    console.log(`  ×${keys.length}  ${JSON.stringify(val)}`);
    for (const k of keys) console.log(`       ${k}`);
  }
  console.log();
} else {
  console.log("── No duplicate-value hotspots (≥3) ──\n");
}

// ── 2. Near-duplicate strings ────────────────────────────────────────────
function normalise(s) {
  return s.toLowerCase().replace(/[.:!?]+$/g, "").trim();
}

const normMap = new Map();
for (const [key, val] of entries) {
  const s = String(val);
  if (s.length < 2) continue;
  const n = normalise(s);
  if (!normMap.has(n)) normMap.set(n, []);
  normMap.get(n).push({ key, val: s });
}

const nearDups = [...normMap.entries()]
  .filter(([, group]) => {
    if (group.length < 2) return false;
    const vals = new Set(group.map((g) => g.val));
    return vals.size > 1;
  })
  .sort((a, b) => b[1].length - a[1].length);

if (nearDups.length) {
  console.log(`── Near-duplicate strings (differ only by case/punctuation) ──`);
  for (const [, group] of nearDups.slice(0, 20)) {
    const vals = [...new Set(group.map((g) => g.val))];
    console.log(`  ${vals.map((v) => JSON.stringify(v)).join(" / ")}`);
    for (const g of group) console.log(`       ${g.key}`);
  }
  if (nearDups.length > 20) console.log(`  … and ${nearDups.length - 20} more`);
  console.log();
} else {
  console.log("── No near-duplicate strings ──\n");
}

// ── 3. Containment clusters ─────────────────────────────────────────────
const shortValues = entries
  .map(([k, v]) => ({ key: k, val: String(v) }))
  .filter((e) => e.val.length >= 3 && e.val.length <= 20);

const longValues = entries
  .map(([k, v]) => ({ key: k, val: String(v) }))
  .filter((e) => e.val.length > 20);

let containmentCount = 0;
const containmentExamples = [];

for (const short of shortValues) {
  let hits = 0;
  for (const long of longValues) {
    if (long.val.includes(short.val)) hits++;
  }
  if (hits >= 5) {
    containmentCount++;
    if (containmentExamples.length < 15) {
      containmentExamples.push({ val: short.val, key: short.key, hits });
    }
  }
}

containmentExamples.sort((a, b) => b.hits - a.hits);

if (containmentCount) {
  console.log(`── Containment clusters (short value found in ≥5 longer strings) ──`);
  for (const ex of containmentExamples) {
    console.log(`  ×${ex.hits}  ${JSON.stringify(ex.val)}  (${ex.key})`);
  }
  if (containmentCount > 15) console.log(`  … and ${containmentCount - 15} more`);
  console.log();
} else {
  console.log("── No containment clusters ──\n");
}

console.log("═══ End of report ═══");
