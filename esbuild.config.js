/* eslint-disable no-console */
const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");
const isProd = process.argv.includes("--prod");

const outdir = path.join(__dirname, "dist");
const entry = path.join(__dirname, "src", "main.ts");

// Obsidian provides the "obsidian" module at runtime.
// Mark it external so esbuild doesn't try to bundle it.
const external = ["obsidian", "sql.js"];

async function build() {
  const ctx = await esbuild.context({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    target: "es2018",
    platform: "node",
    sourcemap: "external",
    minify: isProd,
    outfile: path.join(outdir, "main.js"),
    external,
    logLevel: "info",

    // ✅ Add these two lines anywhere inside this object
    jsx: "automatic",
    loader: { ".ts": "ts", ".tsx": "tsx" },

    banner: {
      js:
        "/*\n" +
        "  Sprout — Obsidian Plugin (bundled with esbuild)\n" +
        "  Output: dist/main.js\n" +
        "*/",
    },
  });

  if (isWatch) {
    await ctx.watch();
    console.log("Watching... (dist/main.js)");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("Built: dist/main.js");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
