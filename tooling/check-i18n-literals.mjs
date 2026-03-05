#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const srcDir = path.join(root, "src");
const baselinePath = path.join(scriptDir, "i18n-literal-baseline.json");
const updateBaseline = process.argv.includes("--update-baseline");

const EXCLUDED_PATH_PARTS = [
  `${path.sep}platform${path.sep}translations${path.sep}locales${path.sep}`,
  `${path.sep}tests${path.sep}`,
];

const UI_LITERAL_PATTERNS = [
  {
    kind: "setting-label",
    regex: /\.set(?:Name|Desc|ButtonText|Placeholder|Title)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
    pickLiteral: (m) => m[2],
  },
  {
    kind: "notice",
    regex: /new\s+Notice\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
    pickLiteral: (m) => m[2],
  },
  {
    kind: "text-content",
    regex: /\b(?:textContent|innerText)\s*=\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
    pickLiteral: (m) => m[2],
  },
  {
    kind: "create-text",
    regex: /create(?:El|Div|Span)\([^\n]*\{[^\n]*\btext\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
    pickLiteral: (m) => m[2],
  },
  {
    kind: "a11y-attr",
    regex: /setAttribute\(\s*['"](?:aria-label|title|placeholder|alt)['"]\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
    pickLiteral: (m) => m[2],
  },
];

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!abs.endsWith(".ts") && !abs.endsWith(".tsx")) continue;
    if (EXCLUDED_PATH_PARTS.some((part) => abs.includes(part))) continue;
    out.push(abs);
  }
  return out;
}

function cleanLiteral(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

function collectFindings() {
  const files = walk(srcDir);
  const findings = [];

  for (const filePath of files) {
    const relPath = toPosix(path.relative(root, filePath));
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

    for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
      const line = lines[lineNo];
      if (!line) continue;
      if (line.includes("i18n-ignore-literal")) continue;
      if (line.includes(" t(") || line.includes("t(")) continue;

      for (const pattern of UI_LITERAL_PATTERNS) {
        pattern.regex.lastIndex = 0;
        let match;
        while ((match = pattern.regex.exec(line)) !== null) {
          const literal = cleanLiteral(pattern.pickLiteral(match));
          if (!literal) continue;

          const key = `${relPath}::${pattern.kind}::${literal}`;
          findings.push({
            key,
            file: relPath,
            line: lineNo + 1,
            kind: pattern.kind,
            literal,
          });
        }
      }
    }
  }

  findings.sort((a, b) => {
    if (a.file === b.file) return a.line - b.line;
    return a.file.localeCompare(b.file);
  });

  return findings;
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error("Invalid baseline format in tooling/i18n-literal-baseline.json");
  }
  return new Set(parsed.entries);
}

const findings = collectFindings();
const uniqueKeys = Array.from(new Set(findings.map((f) => f.key))).sort();

if (updateBaseline) {
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries: uniqueKeys,
  };
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[i18n-literals] Baseline updated with ${uniqueKeys.length} entries.`);
  process.exit(0);
}

const baseline = readBaseline();
if (!baseline.size) {
  console.error("[i18n-literals] Missing baseline. Run: node tooling/check-i18n-literals.mjs --update-baseline");
  process.exit(1);
}

const newFindings = findings.filter((f) => !baseline.has(f.key));
if (newFindings.length) {
  console.error(`[i18n-literals] Found ${newFindings.length} new hardcoded UI literal(s):`);
  for (const f of newFindings) {
    console.error(`  - ${f.file}:${f.line} [${f.kind}] \"${f.literal}\"`);
  }
  process.exit(1);
}

const staleEntries = Array.from(baseline).filter((key) => !uniqueKeys.includes(key));
if (staleEntries.length) {
  console.warn(`[i18n-literals] ${staleEntries.length} baseline entr${staleEntries.length === 1 ? "y is" : "ies are"} no longer present.`);
  console.warn("[i18n-literals] Run --update-baseline to refresh.");
}

console.log(`[i18n-literals] OK (${baseline.size} baseline entries; no new literals).`);
