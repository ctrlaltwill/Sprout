const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");
const isProd = process.argv.includes("--prod");

const rootDir = path.resolve(__dirname, "..");
const outdir = path.join(rootDir, "dist");
const entry = path.join(rootDir, "src", "main.ts");

function writeInfo(message) {
  process.stdout.write(`${String(message)}\n`);
}

function writeError(error) {
  const text = error instanceof Error ? (error.stack || error.message) : String(error);
  process.stderr.write(`${text}\n`);
}

// Obsidian provides the "obsidian" module at runtime.
// Mark it external so esbuild doesn't try to bundle it.
// Also mark CSS as external so it doesn't generate main.css
const external = ["obsidian", "*.css"];

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

    // Replace process.env.NODE_ENV at build time so it works on mobile
    // (Obsidian mobile runs in a Capacitor WebView with no Node.js globals)
    define: {
      "process.env.NODE_ENV": isProd ? '"production"' : '"development"',
    },

    // ✅ Add these two lines anywhere inside this object
    jsx: "automatic",
    loader: { ".ts": "ts", ".tsx": "tsx", ".wasm": "binary", ".json": "json", ".svg": "text" },

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
    writeInfo("Watching... (dist/main.js)");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    writeInfo("Built: dist/main.js");
  }
}

build().catch((err) => {
  writeError(err);
  process.exit(1);
});
