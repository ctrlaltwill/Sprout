// scripts/scope-css.mjs
import fs from "node:fs/promises";
import postcss from "postcss";
import prefixer from "postcss-prefix-selector";

// Optional (add later only if you truly need it)
// import important from "postcss-important";

const inFile = process.argv[2] ?? "plugin/styles.unscoped.css";
const outFile = process.argv[3] ?? "plugin/styles.css";

// Use the wrapper you actually mount your view into:
const prefix = ".sprout-root";

const css = await fs.readFile(inFile, "utf8");

const processor = postcss([
  prefixer({
    prefix,
    transform(_prefix, selector, prefixedSelector) {
      const s = selector.trim();

      // These MUST map to the root container, not a descendant selector
      // (because you cannot have ".sprout-root body", ".sprout-root html", etc.).
      if (s === "html" || s === "body" || s === ":root" || s === ":host") return prefix;

      // Common Tailwind v4 patterns
      if (s === "html,:host" || s === ":root,:host") return prefix;

      // Cannot scope backdrop meaningfully; leave as-is.
      if (s === "::backdrop") return s;

      // Default: normal prefixing
      return prefixedSelector;
    },
  }),

  // If later you decide you must win against Obsidian specificity everywhere:
  // important({ remove: false }),
]);

const result = await processor.process(css, { from: inFile, to: outFile, map: false });
await fs.writeFile(outFile, result.css, "utf8");

console.log(`Wrote ${outFile} (${result.css.length} bytes)`);
