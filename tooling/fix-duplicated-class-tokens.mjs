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

function dedupeBody(body) {
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return body;
  const unique = [];
  const seen = new Set();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  if (unique.length === tokens.length) return body;
  return unique.join(" ");
}

function dedupeQuotedArgs(argText) {
  return argText.replace(/(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g, (m, q, body) => {
    const nextBody = dedupeBody(body);
    return `${q}${nextBody}${q}`;
  });
}

function transform(content) {
  let out = content;

  out = out.replace(/\b(addClass|removeClass|toggleClass)\s*\(([^)]*)\)/g, (m, fn, args) => {
    return `${fn}(${dedupeQuotedArgs(args)})`;
  });

  out = out.replace(/\bclassList\.(add|remove|toggle|contains)\s*\(([^)]*)\)/g, (m, fn, args) => {
    return `classList.${fn}(${dedupeQuotedArgs(args)})`;
  });

  out = out.replace(/(\bclassName\s*=\s*)(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\2/g, (m, pre, q, body) => {
    const nextBody = dedupeBody(body);
    return `${pre}${q}${nextBody}${q}`;
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
