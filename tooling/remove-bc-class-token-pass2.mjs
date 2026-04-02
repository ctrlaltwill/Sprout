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

function stripTokenList(body) {
  return body
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t !== "bc")
    .join(" ");
}

function run(content) {
  let out = content;

  // addClass/removeClass/toggleClass/classList.* arg cleanup
  out = out.replace(/\.(addClass|removeClass|toggleClass)\(\s*(["'])bc\2\s*\);?/g, "");
  out = out.replace(/\.(addClass|removeClass|toggleClass)\(\s*(["'])bc\2\s*,\s*/g, ".${1}(");
  out = out.replace(/,\s*(["'])bc\1\s*(?=[,)])/g, "");
  out = out.replace(/\.classList\.(add|remove|toggle)\(\s*(["'])bc\2\s*,\s*/g, ".classList.$1(");
  out = out.replace(/\.classList\.(add|remove|toggle)\(\s*(["'])bc\2\s*\);?/g, "");

  // class/cls assignments in quoted strings
  out = out.replace(/(className\s*=\s*)(["'])([^"']*)(\2)/g, (m, pre, q, body, q2) => `${pre}${q}${stripTokenList(body)}${q2}`);
  out = out.replace(/(className\s*:\s*)(["'])([^"']*)(\2)/g, (m, pre, q, body, q2) => `${pre}${q}${stripTokenList(body)}${q2}`);
  out = out.replace(/(cls\s*:\s*)(["'])([^"']*)(\2)/g, (m, pre, q, body, q2) => `${pre}${q}${stripTokenList(body)}${q2}`);
  out = out.replace(/(class\s*:\s*)(["'])([^"']*)(\2)/g, (m, pre, q, body, q2) => `${pre}${q}${stripTokenList(body)}${q2}`);

  // JSX className with braces string: className={"..."}
  out = out.replace(/(className\s*=\s*\{\s*["'])([^"']*)(["']\s*\})/g, (m, pre, body, post) => `${pre}${stripTokenList(body)}${post}`);

  // Normalize accidental duplicate spaces inside remaining quoted classes
  out = out.replace(/(["'])([^"'\n]*\s{2,}[^"'\n]*)(\1)/g, (m, q1, body, q2) => `${q1}${body.replace(/\s+/g, " ").trim()}${q2}`);

  return out;
}

const files = [];
walk(ROOT, files);
let updated = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const next = run(src);
  if (next !== src) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}
console.log(`updated ${updated} files`);
