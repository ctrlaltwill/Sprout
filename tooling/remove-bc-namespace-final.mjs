import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const exts = new Set([".ts", ".tsx", ".css"]);

const tokenMap = new Map([
  ["bc-q", "learnkit-q"],
  ["bc-a", "learnkit-a"],
  ["bc-info", "learnkit-info"],
  ["bc-cloze", "learnkit-cloze"],
  ["bc-mcq-correct", "learnkit-mcq-correct"],
  ["bc-mcq-wrong", "learnkit-mcq-wrong"],
  ["bc-io-host", "learnkit-io-host"],
  ["bc-session-card", "learnkit-session-card"],
  ["bc-menu-", "learnkit-menu-"],
  ["bc-widget-menu-", "learnkit-widget-menu-"],
]);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (exts.has(path.extname(ent.name))) out.push(full);
  }
}

function stripStandaloneBcClassTokens(text) {
  let out = text;
  // Standalone bc class in JSX/TS strings
  out = out.replace(/className\s*=\s*\{\s*(["'])bc\1\s*\}/g, 'className=""');
  out = out.replace(/className\s*=\s*(["'])bc\1/g, 'className=""');
  out = out.replace(/\bcls\s*:\s*(["'])bc\1/g, 'cls: ""');
  out = out.replace(/\bclass\s*:\s*(["'])bc\1/g, 'class: ""');

  // Remove add/remove/toggleClass("bc") and classList.add/remove/toggle("bc")
  out = out.replace(/^\s*[^\n]*\.(?:addClass|removeClass|toggleClass)\(\s*(["'])bc\1\s*\)\s*;?\s*$/gm, '');
  out = out.replace(/^\s*[^\n]*\.classList\.(?:add|remove|toggle)\(\s*(["'])bc\1\s*\)\s*;?\s*$/gm, '');

  // Remove bc from mixed class strings
  out = out.replace(/(["'`])([^"'`\n]*\bbc\b[^"'`\n]*)\1/g, (m, q, body) => {
    const next = body.split(/\s+/).filter(Boolean).filter((t) => t !== 'bc').join(' ');
    return `${q}${next}${q}`;
  });

  return out;
}

function transform(content) {
  let out = content;
  for (const [from, to] of tokenMap.entries()) out = out.split(from).join(to);
  out = stripStandaloneBcClassTokens(out);
  return out;
}

const files = [];
walk(ROOT, files);
let updated = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const next = transform(src);
  if (next !== src) {
    fs.writeFileSync(file, next, 'utf8');
    updated += 1;
  }
}

console.log(`updated ${updated} files`);
