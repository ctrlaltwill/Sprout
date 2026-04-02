import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const exts = new Set([".ts", ".tsx", ".css"]);

const mappings = [
  ["sprout-btn-toolbar", "learnkit-btn-toolbar"],
  ["sprout-btn-control", "learnkit-btn-control"],
  ["sprout-btn-filter", "learnkit-btn-filter"],
  ["sprout-btn-outline-muted", "learnkit-btn-outline-muted"],
  ["sprout-btn-accent", "learnkit-btn-accent"],
  ["sprout-is-hidden", "learnkit-is-hidden"],
  ["sprout-is-active", "learnkit-is-active"],
  ["sprout-trend-badge", "learnkit-trend-badge"],
  ["sprout-live-badge-orange", "learnkit-live-badge-orange"],
  ["sprout-live-badge-dark", "learnkit-live-badge-dark"],
  ["sprout-live-badge", "learnkit-live-badge"],
  ["sprout-analytics-badge", "learnkit-analytics-badge"],
  ["sprout-badge", "learnkit-badge"],
  ["data-sprout-label", "data-learnkit-label"],
  ["data-sprout-expand-collapse", "data-learnkit-expand-collapse"],
  ["data-sprout-sync", "data-learnkit-sync"],
  ["data-sprout-toolbar", "data-learnkit-toolbar"],
  ["data-sprout-mobile-label", "data-learnkit-mobile-label"],
];

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (exts.has(path.extname(ent.name))) out.push(full);
  }
}

function applyMappings(text) {
  let out = text;
  for (const [oldToken, newToken] of mappings) {
    out = out.split(oldToken).join(newToken);
  }
  return out;
}

const files = [];
walk(ROOT, files);
let updated = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const next = applyMappings(src);
  if (next !== src) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

console.log(`updated ${updated} files`);
