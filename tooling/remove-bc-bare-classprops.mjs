import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const exts = new Set([".ts", ".tsx"]);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (exts.has(path.extname(ent.name))) out.push(full);
  }
}

function stripBc(body) {
  return body.split(/\s+/).filter(Boolean).filter((t) => t !== "bc").join(" ");
}

function transform(content) {
  let out = content;
  out = out.replace(/className\s*=\s*\{\s*(["'])bc\1\s*\}/g, 'className=""');
  out = out.replace(/className\s*=\s*(["'])bc\1/g, 'className=""');
  out = out.replace(/\bcls\s*:\s*(["'])bc\1/g, 'cls: ""');

  out = out.replace(/(className\s*=\s*\{\s*["'])([^"']*)(["']\s*\})/g, (m, a, b, c) => `${a}${stripBc(b)}${c}`);
  out = out.replace(/(className\s*=\s*["'])([^"']*)(["'])/g, (m, a, b, c) => `${a}${stripBc(b)}${c}`);
  out = out.replace(/(\bcls\s*:\s*["'])([^"']*)(["'])/g, (m, a, b, c) => `${a}${stripBc(b)}${c}`);
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
    updated++;
  }
}
console.log(`updated ${updated} files`);
