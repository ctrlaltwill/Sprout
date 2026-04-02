import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const exts = new Set([".ts", ".tsx"]);

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

function replaceSproutClassToken(input) {
  return input.replace(/(^|[^\\w-])sprout-([a-z0-9_-]+)/gi, (_m, p1, p2) => `${p1}learnkit-${p2}`);
}

function replaceQuotedSproutClasses(input) {
  return input.replace(/(["'`])([\s\S]*?)\1/g, (m, q, body) => {
    if (!/sprout-/.test(body)) return m;
    return `${q}${replaceSproutClassToken(body)}${q}`;
  });
}

function transform(content) {
  let out = content;

  // Selector + CSS variable + data attribute migration used in query selectors and inline CSS strings.
  out = out.replace(/\.sprout-/g, ".learnkit-");
  out = out.replace(/\.sprout\b/g, ".learnkit");
  out = out.replace(/--sprout-/g, "--learnkit-");
  out = out.replace(/data-sprout-/g, "data-learnkit-");

  // classList/addClass/removeClass argument lists.
  out = out.replace(/(classList\\.(?:add|remove|toggle|contains)\\s*\\()([^)]*)(\\))/g, (_m, pre, args, post) => {
    return `${pre}${replaceQuotedSproutClasses(args)}${post}`;
  });
  out = out.replace(/((?:addClass|removeClass)\\s*\\()([^)]*)(\\))/g, (_m, pre, args, post) => {
    return `${pre}${replaceQuotedSproutClasses(args)}${post}`;
  });

  // Common class assignment surfaces.
  out = out.replace(/(className\\s*=\\s*)(["'`])([\\s\\S]*?)\\2/g, (_m, pre, q, body) => {
    return `${pre}${q}${replaceSproutClassToken(body)}${q}`;
  });
  out = out.replace(/(\\bcls\\s*:\\s*)(["'`])([\\s\\S]*?)\\2/g, (_m, pre, q, body) => {
    return `${pre}${q}${replaceSproutClassToken(body)}${q}`;
  });
  out = out.replace(/(\\bclass\\s*:\\s*)(["'`])([\\s\\S]*?)\\2/g, (_m, pre, q, body) => {
    return `${pre}${q}${replaceSproutClassToken(body)}${q}`;
  });

  return out;
}

const files = [];
walk(ROOT, files);
let updated = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const next = transform(src);
  if (next !== src) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

console.log(`updated ${updated} TS/TSX files`);
