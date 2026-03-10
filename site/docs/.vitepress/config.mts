import { defineConfig } from "vitepress";

const titleOverrides = new Map<string, string>([
  ["Home", "Overview"],
  ["Support-Sprout", "About Sprout"],
  ["Assistant-Configuration", "Configuration"],
  ["Guide-for-Free-Usage", "Guide for Free Usage"],
  ["Assistant-Setting-Up", "Setting Up"],
  ["Assistant-Usage", "Usage"],
]);

function toPath(page: string): string {
  return `/${page}`;
}

function toTitle(page: string): string {
  return titleOverrides.get(page) ?? page.replace(/-/g, " ");
}

function escapeMustache(content: string): string {
  return String(content ?? "")
    .replace(/\{\{/g, "&#123;&#123;")
    .replace(/\}\}/g, "&#125;&#125;");
}

export default defineConfig({
  title: "Sprout",
  description: "Sprout documentation and user guides",
  base: "/Sprout/",
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
    siteTitle: "Sprout Docs",
    logo: {
      light: "/sprout-mark-light.svg",
      dark: "/sprout-mark-dark.svg",
      alt: "Sprout",
    },
    nav: [
      { text: "Docs", link: "/" },
      { text: "GitHub", link: "https://github.com/ctrlaltwill/Sprout" },
      { text: "Releases", link: "https://github.com/ctrlaltwill/Sprout/releases" },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "Home",
        items: [{ text: toTitle("Home"), link: toPath("Home") }],
      },
      {
        text: "Getting Started",
        items: [
          { text: toTitle("Installation"), link: toPath("Installation") },
          { text: toTitle("Syncing"), link: toPath("Syncing") },
        ],
      },
      {
        text: "Analytics",
        items: [
          { text: toTitle("Analytics"), link: toPath("Analytics") },
          { text: toTitle("Charts"), link: toPath("Charts") },
        ],
      },
      {
        text: "Assistant",
        items: [
          { text: toTitle("Assistant-Configuration"), link: toPath("Assistant-Configuration") },
          { text: toTitle("Guide-for-Free-Usage"), link: toPath("Guide-for-Free-Usage") },
          { text: toTitle("Assistant-Setting-Up"), link: toPath("Assistant-Setting-Up") },
          { text: toTitle("Assistant-Usage"), link: toPath("Assistant-Usage") },
        ],
      },
      {
        text: "Audio",
        items: [
          { text: toTitle("Text-to-Speech"), link: toPath("Text-to-Speech") },
          { text: toTitle("Language-Settings"), link: toPath("Language-Settings") },
        ],
      },
      {
        text: "Cards",
        items: [
          { text: toTitle("Cards"), link: toPath("Cards") },
          { text: toTitle("Card-Browser"), link: toPath("Card-Browser") },
          { text: toTitle("Creating-Cards"), link: toPath("Creating-Cards") },
          {
            text: "Reading View",
            items: [
              { text: toTitle("Reading-View"), link: toPath("Reading-View") },
              { text: toTitle("Reading-View-Styles"), link: toPath("Reading-View-Styles") },
              { text: toTitle("Custom-Reading-Styles"), link: toPath("Custom-Reading-Styles") },
            ],
          },
          {
            text: "Flags",
            items: [
              { text: toTitle("Flags"), link: toPath("Flags") },
              { text: toTitle("Flag-Codes"), link: toPath("Flag-Codes") },
            ],
          },
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
        ],
      },
      {
        text: "Maintenance",
        items: [
          { text: toTitle("AI-Usage-Policy"), link: toPath("AI-Usage-Policy") },
          { text: toTitle("Anki-Export-&-Import"), link: toPath("Anki-Export-&-Import") },
          { text: toTitle("Backups"), link: toPath("Backups") },
          { text: toTitle("Custom-Delimiters"), link: toPath("Custom-Delimiters") },
          { text: toTitle("Gatekeeper"), link: toPath("Gatekeeper") },
          { text: toTitle("Keyboard-Shortcuts"), link: toPath("Keyboard-Shortcuts") },
          { text: toTitle("Reminders"), link: toPath("Reminders") },
          { text: toTitle("Settings"), link: toPath("Settings") },
        ],
      },
      {
        text: "Study",
        items: [
          {
            text: "Review Flow",
            items: [
              { text: toTitle("Study-Sessions"), link: toPath("Study-Sessions") },
              { text: toTitle("Grading"), link: toPath("Grading") },
              { text: toTitle("Scheduling"), link: toPath("Scheduling") },
            ],
          },
          {
            text: "Card State",
            items: [
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
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/ctrlaltwill/Sprout" }],
    editLink: {
      pattern: "https://github.com/ctrlaltwill/Sprout/edit/main/site/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2026 William Guy",
    },
  },
});
