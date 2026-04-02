#!/usr/bin/env node
/*
 * Phase 1 class namespace migration:
 * - Keep existing sprout* classes for compatibility
 * - Add learnkit* class aliases in generator contexts only
 * - Avoid touching selectors/query strings and persistence-sensitive tokens
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const TARGET_EXT = new Set([".ts", ".tsx"]);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!Array.from(TARGET_EXT).some((ext) => full.endsWith(ext))) continue;
    out.push(full);
  }
}

function unique(items) {
  return [...new Set(items)];
}

function toLearnKitToken(token) {
  if (token === "sprout") return "learnkit";
  if (token.startsWith("sprout-")) return `learnkit-${token.slice("sprout-".length)}`;
  return null;
}

function augmentTokenString(raw) {
  // Preserve spacing loosely while ensuring deterministic output.
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (!parts.some((p) => p === "sprout" || p.startsWith("sprout-"))) return raw;

  const expanded = [];
  for (const p of parts) {
    expanded.push(p);
    const alias = toLearnKitToken(p);
    if (alias) expanded.push(alias);
  }
  return unique(expanded).join(" ");
}

function hasQuotedArg(argList, token) {
  return argList.includes(`"${token}"`) || argList.includes(`'${token}'`);
}

function augmentClassListArgs(argList) {
  let changed = false;

  const replaced = argList.replace(/(["'])(sprout(?:-[A-Za-z0-9_-]+)?)(\1)/g, (m, q, token) => {
    const alias = toLearnKitToken(token);
    if (!alias || hasQuotedArg(argList, alias)) return m;
    changed = true;
    return `${m}, ${q}${alias}${q}`;
  });

  return { changed, value: replaced };
}

function processFile(filePath) {
  const before = readFileSync(filePath, "utf8");
  let text = before;

  // cls: "..."
  text = text.replace(/(\bcls\s*:\s*["'])([^"'\n]*sprout[^"'\n]*)(["'])/g, (_m, pre, body, post) => {
    return `${pre}${augmentTokenString(body)}${post}`;
  });

  // className = "..."
  text = text.replace(/(\bclassName\s*=\s*["'])([^"'\n]*sprout[^"'\n]*)(["'])/g, (_m, pre, body, post) => {
    return `${pre}${augmentTokenString(body)}${post}`;
  });

  // setAttr("class", "...")
  text = text.replace(/(\bsetAttr\(\s*["']class["']\s*,\s*["'])([^"'\n]*sprout[^"'\n]*)(["'])/g, (_m, pre, body, post) => {
    return `${pre}${augmentTokenString(body)}${post}`;
  });

  // .addClass("...") / .removeClass("...")
  text = text.replace(/(\.(?:addClass|removeClass)\(\s*["'])([^"'\n]*sprout[^"'\n]*)(["']\s*\))/g, (_m, pre, body, post) => {
    return `${pre}${augmentTokenString(body)}${post}`;
  });

  // classList.add/remove(...)
  text = text.replace(/(\bclassList\.(?:add|remove)\s*\()([^\)]*)(\))/g, (_m, pre, args, post) => {
    if (!args.includes("sprout")) return `${pre}${args}${post}`;
    const { changed, value } = augmentClassListArgs(args);
    return changed ? `${pre}${value}${post}` : `${pre}${args}${post}`;
  });

  if (text !== before) {
    writeFileSync(filePath, text, "utf8");
    return true;
  }
  return false;
}

function main() {
  const files = [];
  walk(SRC, files);

  let updated = 0;
  for (const f of files) {
    if (processFile(f)) updated += 1;
  }

  console.log(`Updated ${updated} files`);
}

main();
