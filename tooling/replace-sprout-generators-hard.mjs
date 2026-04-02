#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const exts = new Set(['.ts', '.tsx']);
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if ([...exts].some((e) => full.endsWith(e))) files.push(full);
  }
}

const replToken = (s) => s
  .replace(/\bsprout\b/g, 'learnkit')
  .replace(/sprout-/g, 'learnkit-')
  .replace(/data-sprout-/g, 'data-learnkit-')
  .replace(/--sprout-/g, '--learnkit-');

walk(SRC);
let updated = 0;

for (const f of files) {
  const before = readFileSync(f, 'utf8');
  let text = before;

  // cls: "..."
  text = text.replace(/(\bcls\s*:\s*["'])([^"'\n]*)(["'])/g, (m, a, b, c) => {
    if (!/sprout/.test(b)) return m;
    return `${a}${replToken(b)}${c}`;
  });

  // className = "..."
  text = text.replace(/(\bclassName\s*=\s*["'])([^"'\n]*)(["'])/g, (m, a, b, c) => {
    if (!/sprout/.test(b)) return m;
    return `${a}${replToken(b)}${c}`;
  });

  // .addClass("...") / .removeClass("...")
  text = text.replace(/(\.(?:addClass|removeClass)\(\s*["'])([^"'\n]*)(["']\s*\))/g, (m, a, b, c) => {
    if (!/sprout/.test(b)) return m;
    return `${a}${replToken(b)}${c}`;
  });

  // classList.add/remove(...quoted args...)
  text = text.replace(/(\bclassList\.(?:add|remove)\s*\()([^\)]*)(\))/g, (m, a, b, c) => {
    if (!/sprout/.test(b)) return m;
    const replaced = b
      .replace(/(["'])sprout(["'])/g, '$1learnkit$2')
      .replace(/(["'])sprout-([^"']+)(["'])/g, '$1learnkit-$2$3');
    return `${a}${replaced}${c}`;
  });

  if (text !== before) {
    writeFileSync(f, text, 'utf8');
    updated++;
  }
}

console.log(`updated ${updated} TS/TSX files`);
