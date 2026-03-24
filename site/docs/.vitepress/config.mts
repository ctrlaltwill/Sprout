import { defineConfig } from "vitepress";

const DEFAULT_BASE = "/LearnKit/";

const titleOverrides = new Map<string, string>([
  ["Home", "Overview"],
  ["Support-LearnKit", "About LearnKit"],
  ["Settings-Explained", "Settings Explained"],
  ["Companion-Features", "Companion Features"],
  ["Companion-Configuration", "Configuration"],
  ["Guide-for-Free-Usage", "Guide for Free Usage"],
  ["Companion-Setting-Up", "Setting Up"],
  ["Companion-Usage", "Usage"],
  ["Anki-Export-&-Import", "Anki Import Export"],
  ["Cards", "Cards Overview"],
  ["Language-Settings", "Language Options"],
  ["Backups", "Back Up"],
  ["Flag-Codes", "Flag Codes"],
]);

function toPath(page: string): string {
  return `/${page}`;
}

function toTitle(page: string): string {
  return titleOverrides.get(page) ?? page.replace(/-/g, " ");
}

function normalizeBase(base: string): string {
  if (!base) return DEFAULT_BASE;
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function resolveDocsBase(): string {
  const envBase = process.env.VITEPRESS_BASE?.trim();
  if (envBase) return normalizeBase(envBase);

  const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1]?.trim();
  if (repoName) return normalizeBase(`/${repoName}/`);

  return DEFAULT_BASE;
}

function escapeMustache(content: string): string {
  return String(content ?? "")
    .replace(/\{\{/g, "&#123;&#123;")
    .replace(/\}\}/g, "&#125;&#125;");
}

export default defineConfig({
  title: "LearnKit",
  description: "LearnKit documentation and user guides",
  base: resolveDocsBase(),
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    config(md) {
      md.core.ruler.after("inline", "sprout-preserve-cloze", (state) => {
        for (const token of state.tokens) {
          if (["fence", "code_block", "html_block"].includes(token.type)) {
            token.content = escapeMustache(token.content);
            continue;
          }

          if (token.type === "inline" && token.children) {
            for (const child of token.children) {
              if (["text", "code_inline", "html_inline"].includes(child.type)) {
                child.content = escapeMustache(child.content);
              }
            }
          }
        }
      });
    },
  },
  themeConfig: {
    siteTitle: "LearnKit Docs",
    logo: {
      light: "/learnkit-mark-light.svg",
      dark: "/learnkit-mark-dark.svg",
      alt: "LearnKit",
    },
    nav: [
      { text: "Docs", link: "/" },
      { text: "GitHub", link: "https://github.com/ctrlaltwill/LearnKit" },
      { text: "Releases", link: "https://github.com/ctrlaltwill/LearnKit/releases" },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "Home",
        items: [
          { text: toTitle("Home"), link: toPath("Home") },
          { text: toTitle("Wiki-Tree"), link: toPath("Wiki-Tree") },
        ],
      },
      {
        text: "Getting Started",
        items: [
          { text: toTitle("Getting-Started"), link: toPath("Getting-Started") },
          { text: toTitle("Installation"), link: toPath("Installation") },
          { text: toTitle("Syncing"), link: toPath("Syncing") },
          { text: toTitle("Anki-Export-&-Import"), link: toPath("Anki-Export-&-Import") },
        ],
      },
      {
        text: "Study & Review",
        items: [
          {
            text: "Header Navigation",
            items: [
              { text: toTitle("Coach"), link: toPath("Coach") },
              { text: toTitle("Flashcards"), link: toPath("Flashcards") },
              { text: toTitle("Notes"), link: toPath("Notes") },
              { text: toTitle("Tests"), link: toPath("Tests") },
            ],
          },
          {
            text: "Review Flow",
            items: [
              { text: toTitle("Study-Sessions"), link: toPath("Study-Sessions") },
              { text: toTitle("Grading"), link: toPath("Grading") },
              { text: toTitle("Scheduling"), link: toPath("Scheduling") },
              { text: toTitle("Burying-Cards"), link: toPath("Burying-Cards") },
              { text: toTitle("Suspending-Cards"), link: toPath("Suspending-Cards") },
            ],
          },
          {
            text: "Scope",
            items: [{ text: toTitle("Widget"), link: toPath("Widget") }],
          },
        ],
      },
      {
        text: "Cards",
        items: [
          { text: toTitle("Cards"), link: toPath("Cards") },
          { text: toTitle("Creating-Cards"), link: toPath("Creating-Cards") },
          { text: toTitle("Editing-Cards"), link: toPath("Editing-Cards") },
          { text: toTitle("Card-Formatting"), link: toPath("Card-Formatting") },
          {
            text: "Card Types",
            items: [
              { text: toTitle("Basic-&-Reversed-Cards"), link: toPath("Basic-&-Reversed-Cards") },
              { text: toTitle("Cloze-Cards"), link: toPath("Cloze-Cards") },
              { text: toTitle("Image-Occlusion"), link: toPath("Image-Occlusion") },
              { text: toTitle("Multiple-Choice-Questions"), link: toPath("Multiple-Choice-Questions") },
              { text: toTitle("Ordered-Questions"), link: toPath("Ordered-Questions") },
            ],
          },
          {
            text: "Flags",
            items: [
              { text: toTitle("Flags"), link: toPath("Flags") },
              { text: toTitle("Flag-Codes"), link: toPath("Flag-Codes") },
            ],
          },
        ],
      },
      {
        text: "Tools",
        items: [
          {
            text: "Library",
            items: [{ text: toTitle("Card-Browser"), link: toPath("Card-Browser") }],
          },
          {
            text: "Analytics",
            items: [
              { text: toTitle("Analytics"), link: toPath("Analytics") },
              { text: toTitle("Charts"), link: toPath("Charts") },
            ],
          },
        ],
      },
      {
        text: "Companion",
        items: [
          { text: toTitle("Companion-Features"), link: toPath("Companion-Features") },
          { text: toTitle("Companion-Configuration"), link: toPath("Companion-Configuration") },
          { text: toTitle("Companion-Setting-Up"), link: toPath("Companion-Setting-Up") },
          { text: toTitle("Companion-Usage"), link: toPath("Companion-Usage") },
          { text: toTitle("Guide-for-Free-Usage"), link: toPath("Guide-for-Free-Usage") },
        ],
      },
      {
        text: "Reading & Audio",
        items: [
          {
            text: "Reading View",
            items: [
              { text: toTitle("Reading-View"), link: toPath("Reading-View") },
              { text: toTitle("Reading-View-Styles"), link: toPath("Reading-View-Styles") },
              { text: toTitle("Custom-Reading-Styles"), link: toPath("Custom-Reading-Styles") },
            ],
          },
          {
            text: "Audio",
            items: [
              { text: toTitle("Text-to-Speech"), link: toPath("Text-to-Speech") },
              { text: toTitle("Language-Settings"), link: toPath("Language-Settings") },
            ],
          },
        ],
      },
      {
        text: "Settings",
        items: [
          { text: toTitle("Settings-Explained"), link: toPath("Settings-Explained") },
          { text: toTitle("Settings"), link: toPath("Settings") },
          { text: toTitle("Reminders"), link: toPath("Reminders") },
          { text: toTitle("Keyboard-Shortcuts"), link: toPath("Keyboard-Shortcuts") },
          { text: toTitle("Custom-Delimiters"), link: toPath("Custom-Delimiters") },
          { text: toTitle("Gatekeeper"), link: toPath("Gatekeeper") },
        ],
      },
      {
        text: "Maintenance",
        items: [
          { text: toTitle("Backups"), link: toPath("Backups") },
          { text: toTitle("Localization-Debt"), link: toPath("Localization-Debt") },
        ],
      },
      {
        text: "Policies",
        items: [
          { text: toTitle("AI-Usage-Policy"), link: toPath("AI-Usage-Policy") },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: toTitle("Support-LearnKit"), link: toPath("Support-LearnKit") },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/ctrlaltwill/LearnKit" }],
    editLink: {
      pattern: "https://github.com/ctrlaltwill/LearnKit/edit/main/site/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2026 William Guy",
    },
  },
});
