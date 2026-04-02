import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const exts = new Set([".ts", ".tsx", ".css"]);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (exts.has(path.extname(ent.name))) out.push(full);
  }
}

function replaceQuotedSprout(body) {
  return body
    .replace(/\.sprout-/g, ".learnkit-")
    .replace(/\.sprout\b/g, ".learnkit")
    .replace(/\bsprout-([a-z0-9_-]+)/gi, "learnkit-$1")
    .replace(/data-sprout-/g, "data-learnkit-");
}

function transformTs(content) {
  let out = content;

  out = out.replace(/(classList\.(?:add|remove|toggle|contains)\s*\([^)]*)(\))/g, (m, a, b) => replaceQuotedSprout(a) + b);
  out = out.replace(/((?:addClass|removeClass|toggleClass)\s*\([^)]*)(\))/g, (m, a, b) => replaceQuotedSprout(a) + b);

  // class/className/cls-ish assignments and option props.
  out = out.replace(/\b(className|class|cls|buttonClassName|rowClassName|leftClassName|stripClassName|controlClassName)\s*[:=]\s*(["'`])([\s\S]*?)\2/g,
    (m, key, q, body) => `${key}${m.includes(":") ? ":" : "="}${m.includes(":") ? " " : ""}${q}${replaceQuotedSprout(body)}${q}`);

  // query selector style strings.
  out = out.replace(/\b(querySelector|querySelectorAll|closest|matches|queryFirst)\s*\(\s*(["'`])([\s\S]*?)\2/g,
    (m, fn, q, body) => `${fn}(${q}${replaceQuotedSprout(body)}${q}`);

  // HTML snippets in template strings.
  out = out.replace(/class=(["'])([^"']*)\1/g, (m, q, body) => `class=${q}${replaceQuotedSprout(body)}${q}`);

  // data attributes in strings.
  out = out.replace(/data-sprout-/g, "data-learnkit-");
  // class token fallback in known utility helpers.
  out = out.replace(/\bsprout-(is-hidden|is-active|btn-toolbar|btn-filter|btn-control|btn-outline-muted|trend-badge|live-badge(?:-orange|-dark)?|analytics-badge|badge)\b/g, "learnkit-$1");

  return out;
}

function transformCss(content) {
  let out = content;
  out = out.replace(/\.sprout-/g, ".learnkit-");
  out = out.replace(/\.sprout\b/g, ".learnkit");
  out = out.replace(/\[data-sprout-/g, "[data-learnkit-");
  out = out.replace(/data-sprout-/g, "data-learnkit-");
  out = out.replace(/\[id\^="sprout-/g, '[id^="learnkit-');
  out = out.replace(/\[id\$="sprout-/g, '[id$="learnkit-');
  return out;
}

const files = [];
walk(ROOT, files);
let updated = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const ext = path.extname(file);
  const next = ext === ".css" ? transformCss(src) : transformTs(src);
  if (next !== src) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

console.log(`updated ${updated} files`);
