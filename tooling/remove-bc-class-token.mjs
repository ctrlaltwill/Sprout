import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const exts = new Set([".ts", ".tsx"]);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (exts.has(path.extname(ent.name))) out.push(full);
  }
}

function stripBcToken(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const next = tokens.filter((t) => t !== "bc");
  return next.join(" ");
}

function processQuotedClasses(content) {
  let out = content;

  const rewriteQuoted = (body) => stripBcToken(body);

  // className="..." / className='...'
  out = out.replace(/(className\s*=\s*)(["'])([^"']*)\2/g, (m, pre, q, body) => `${pre}${q}${rewriteQuoted(body)}${q}`);
  // className: "..." / cls: "..." / class: "..."
  out = out.replace(/\b(className|cls|class)\s*:\s*(["'])([^"']*)\2/g, (m, key, q, body) => `${key}: ${q}${rewriteQuoted(body)}${q}`);
  // createDiv/createEl option maps with cls string in object literal
  out = out.replace(/(\bcls\s*:\s*)(["'])([^"']*)(\2)/g, (m, pre, q, body, q2) => `${pre}${q}${rewriteQuoted(body)}${q2}`);

  return out;
}

function processApiCalls(content) {
  let out = content;

  // Remove standalone bc argument from addClass/removeClass/classList.add/remove/toggle
  out = out.replace(/\.(addClass|removeClass|toggleClass)\(\s*(["'])bc\2\s*\);/g, ".${1}();");
  out = out.replace(/\.(addClass|removeClass|toggleClass)\(\s*(["'])bc\2\s*,\s*/g, ".${1}(");
  out = out.replace(/,\s*(["'])bc\1\s*(?=[,)])/g, "");

  out = out.replace(/\.classList\.(add|remove|toggle)\(\s*(["'])bc\2\s*,\s*/g, ".classList.$1(");
  out = out.replace(/\.classList\.(add|remove|toggle)\(\s*(["'])bc\2\s*\)/g, ".classList.$1()");

  return out;
}

function cleanup(content) {
  let out = content;
  // remove empty no-op class calls introduced by removal
  out = out.replace(/\.(addClass|removeClass|toggleClass|classList\.(?:add|remove|toggle))\(\s*\)\s*;?/g, "");
  // normalize repeated whitespace inside quoted class strings again
  out = out.replace(/(className\s*=\s*["'])([^"']*)(["'])/g, (m, a, b, c) => `${a}${stripBcToken(b)}${c}`);
  out = out.replace(/(\b(?:className|cls|class)\s*:\s*["'])([^"']*)(["'])/g, (m, a, b, c) => `${a}${stripBcToken(b)}${c}`);
  return out;
}

const files = [];
walk(ROOT, files);
let updated = 0;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  let next = src;
  next = processQuotedClasses(next);
  next = processApiCalls(next);
  next = cleanup(next);
  if (next !== src) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

console.log(`updated ${updated} files`);
