/**
 * @file src/views/settings/subpages/guide-content.ts
 * @summary Module for guide content.
 *
 * @exports
 *  - GUIDE_CATEGORIES
 *  - loadGuidePages
 *  - getGuideCategories
 *  - orderGuidePagesByNavigation
 *  - getGuidePageDisplayLabel
 *  - getGuideTooltipLabel
 */

import { type App, requestUrl } from "obsidian";
import type { GuideCategory, GuidePage } from "./types";
import { t } from "../../../platform/translations/translator";

const tx = (token: string, fallback: string) => t("en", token, fallback);

const GUIDE_DEMO_RELATIVE_PREFIX_RE = /^\.\.\/\.\.\/\.\.\/branding\/(?:Demo|demo)\/(.+)$/i;
const GUIDE_DEMO_RAW_BASE = "https://raw.githubusercontent.com/ctrlaltwill/LearnKit/main/site/branding/Demo/";

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join("/");
}

function rewriteGuideDemoImageLink(url: string): string {
  const trimmed = String(url ?? "").trim();
  const match = trimmed.match(GUIDE_DEMO_RELATIVE_PREFIX_RE);
  if (!match) return trimmed;
  const relativePath = String(match[1] ?? "").trim();
  if (!relativePath) return trimmed;
  return `${GUIDE_DEMO_RAW_BASE}${encodePathSegments(relativePath)}`;
}

function convertDocsLinksForObsidianGuide(markdown: string, options?: { rewriteDemoImagesToRaw?: boolean }): string {
  const rewriteDemoImagesToRaw = !!options?.rewriteDemoImagesToRaw;

  let converted = String(markdown ?? "")
    .replace(/\[([^\]]+)\]\(\.\/([^)#]+?)\.md(#[^)]+)?\)/g, (_m, text: string, target: string, _hash: string, offset: number, full: string) => {
      if (offset > 0 && full[offset - 1] === "!") return _m;
      const label = String(text ?? "").trim();
      const page = String(target ?? "").trim();
      if (!page) return _m;
      const defaultLabel = page.replace(/-/g, " ");
      return label && label !== defaultLabel ? `[[${page}|${label}]]` : `[[${page}]]`;
    })
    .replace(/\[([^\]]+)\]\(\/([^)#]+?)(#[^)]+)?\)/g, (_m, text: string, target: string, _hash: string, offset: number, full: string) => {
      if (offset > 0 && full[offset - 1] === "!") return _m;
      const label = String(text ?? "").trim();
      const page = String(target ?? "").trim();
      if (!page || /^https?:\/\//i.test(page)) return _m;
      const defaultLabel = page.replace(/-/g, " ");
      return label && label !== defaultLabel ? `[[${page}|${label}]]` : `[[${page}]]`;
    });

  if (rewriteDemoImagesToRaw) {
    converted = converted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
      const rewritten = rewriteGuideDemoImageLink(src);
      return `![${alt}](${rewritten})`;
    });
  }

  return converted;
}

const PREFERRED_GUIDE_FILES = [
  "What-LearnKit-Is.md",
  "Getting-Started.md",
  "First-Review-in-5-Minutes.md",
  "Installation.md",
  "Syncing.md",
  "Import-From-Anki.md",
  "Flashcards.md",
  "Notes.md",
  "Editing-Flashcards.md",
  "Flashcard-Formatting.md",
  "Companion-Configuration.md",
  "Companion-Features.md",
  "Companion-Model-Compatibility.md",
  "Guide-for-Free-Usage.md",
  "Companion-Setting-Up.md",
  "Companion-Usage.md",
  "Coach.md",
  "Tests.md",
  "Creating-Flashcards.md",
  "Decks-&-Organisation.md",
  "Flag-Codes.md",
  "Flags.md",
  "Basic-&-Reversed-Flashcards.md",
  "Cloze-Flashcards.md",
  "Image-Occlusion.md",
  "Hotspot-Cards.md",
  "Multiple-Choice-Questions.md",
  "Ordered-Questions.md",
  "Flashcard-Library.md",
  "Reading-View.md",
  "Reading-View-Styles.md",
  "Custom-Reading-Styles.md",
  "Study-Sessions.md",
  "Grading.md",
  "Scheduling.md",
  "Burying-Flashcards.md",
  "Suspending-Flashcards.md",
  "Widget.md",
  "Analytics.md",
  "Charts.md",
  "Text-to-Speech.md",
  "Language-Settings.md",
  "Settings-Explained.md",
  "Settings.md",
  "Reminders.md",
  "Gatekeeper.md",
  "Keyboard-Shortcuts.md",
  "Custom-Delimiters.md",
  "AI-Usage-Policy.md",
  "Backups.md",
  "Support-LearnKit.md",
];

export const GUIDE_CATEGORIES: GuideCategory[] = [
  { key: "home", label: tx("ui.guide.categories.home", "Home"), icon: "house", sections: [{ pageKeys: ["What-LearnKit-Is"] }] },
  {
    key: "companion",
    label: tx("ui.guide.categories.companion", "Companion"),
    icon: "sparkles",
    sections: [{ pageKeys: ["Companion-Configuration", "Companion-Features", "Companion-Model-Compatibility", "Companion-Setting-Up", "Companion-Usage", "Guide-for-Free-Usage"] }],
  },
  {
    key: "cards",
    label: tx("ui.guide.categories.cards", "Flashcards"),
    icon: "square-stack",
    sections: [
      { pageKeys: ["Creating-Flashcards", "Decks-&-Organisation", "Editing-Flashcards", "Flashcard-Formatting", "Flashcards"] },
      {
        title: tx("ui.guide.sections.cardTypes", "Flashcard Types"),
        pageKeys: ["Basic-&-Reversed-Flashcards", "Cloze-Flashcards", "Image-Occlusion", "Hotspot-Cards", "Multiple-Choice-Questions", "Ordered-Questions"],
      },
      { title: tx("ui.guide.sections.flags", "Flags"), pageKeys: ["Flag-Codes", "Flags"] },
    ],
  },
  {
    key: "getting-started",
    label: tx("ui.guide.categories.gettingStarted", "Getting Started"),
    icon: "rocket",
    sections: [{ pageKeys: ["First-Review-in-5-Minutes", "Getting-Started", "Import-From-Anki", "Installation", "Syncing"] }],
  },
  {
    key: "maintenance",
    label: tx("ui.guide.categories.maintenance", "Maintenance"),
    icon: "database",
    sections: [{ pageKeys: ["Backups"] }],
  },
  {
    key: "policies",
    label: tx("ui.guide.categories.policies", "Policies"),
    icon: "shield-check",
    sections: [{ pageKeys: ["AI-Usage-Policy"] }],
  },
  {
    key: "reading-audio",
    label: tx("ui.guide.categories.readingAudio", "Reading & Audio"),
    icon: "book-open",
    sections: [
      { title: tx("ui.guide.sections.audio", "Audio"), pageKeys: ["Language-Settings", "Text-to-Speech"] },
      { title: tx("ui.guide.sections.readingView", "Reading View"), pageKeys: ["Custom-Reading-Styles", "Reading-View", "Reading-View-Styles"] },
    ],
  },
  {
    key: "reference",
    label: tx("ui.guide.categories.reference", "Reference"),
    icon: "library",
    sections: [{ pageKeys: ["Support-LearnKit"] }],
  },
  {
    key: "settings",
    label: tx("ui.guide.categories.settings", "Settings"),
    icon: "settings",
    sections: [{ pageKeys: ["Custom-Delimiters", "Gatekeeper", "Keyboard-Shortcuts", "Reminders", "Settings", "Settings-Explained"] }],
  },
  {
    key: "study-review",
    label: tx("ui.guide.categories.studyReview", "Study & Review"),
    icon: "star",
    sections: [
      {
        title: tx("ui.guide.sections.headerNavigation", "Header Navigation"),
        pageKeys: ["Coach", "Flashcards", "Notes", "Tests"],
      },
      {
        title: tx("ui.guide.sections.reviewFlow", "Review Flow"),
        pageKeys: ["Burying-Flashcards", "Grading", "Scheduling", "Study-Sessions", "Suspending-Flashcards"],
      },
      { title: tx("ui.guide.sections.scope", "Scope"), pageKeys: ["Widget"] },
    ],
  },
  {
    key: "tools",
    label: tx("ui.guide.categories.tools", "Tools"),
    icon: "table-2",
    sections: [
      { title: tx("ui.guide.sections.analytics", "Analytics"), pageKeys: ["Analytics", "Charts"] },
      { title: tx("ui.guide.sections.library", "Library"), pageKeys: ["Flashcard-Library"] },
    ],
  },
];

const GUIDE_LABEL_MAP: Record<string, string> = {
  "Companion-Configuration": "Configuration",
  "Companion-Features": "Companion Features",
  "Guide-for-Free-Usage": "Guide for Free Usage",
  "Companion-Setting-Up": "Setting Up",
  "Companion-Usage": "Usage",
  "What-LearnKit-Is": "What LearnKit Is",
  "Getting-Started": "Getting Started",
  "Import-From-Anki": "Import From Anki",
  Flashcards: "Flashcards",
  Notes: "Notes",
  "Creating-Flashcards": "Creating Flashcards",
  "Decks-&-Organisation": "Decks & Organisation",
  "Editing-Flashcards": "Editing Flashcards",
  "Flashcard-Formatting": "Flashcard Formatting",
  "Language-Settings": "Language Options",
  "Settings-Explained": "Settings Explained",
  Backups: "Back Up",
  "Support-LearnKit": "About LearnKit",
  "Reading-View-Styles": "Reading View Styles",
  "Custom-Reading-Styles": "Custom Reading Styles",
  "Flashcard-Library": "Flashcard Library",
  Reminders: "Reminders",
  Gatekeeper: "Gatekeeper",
  "Flag-Codes": "Flag Codes",
  "Companion-Model-Compatibility": "Companion Model Compatibility",
  "First-Review-in-5-Minutes": "First Review in 5 Minutes",
};

const GUIDE_ICON_MAP: Record<string, string> = {
  "What-LearnKit-Is": "house",
  "Getting-Started": "rocket",
  Installation: "download",
  "Import-From-Anki": "arrow-right-left",
  Flashcards: "star",
  Notes: "notebook-text",
  "Editing-Flashcards": "file-pen-line",
  "Flashcard-Formatting": "braces",
  "Companion-Features": "sparkles",
  "Companion-Configuration": "settings-2",
  "Guide-for-Free-Usage": "piggy-bank",
  "Companion-Setting-Up": "key-round",
  "Companion-Usage": "messages-square",
  Coach: "target",
  Tests: "clipboard-check",
  "Creating-Flashcards": "plus-circle",
  "Decks-&-Organisation": "folder-tree",
  "Custom-Delimiters": "separator-vertical",
  "Keyboard-Shortcuts": "keyboard",
  "Basic-&-Reversed-Flashcards": "repeat",
  "Cloze-Flashcards": "text-cursor-input",
  "Multiple-Choice-Questions": "list-checks",
  "Ordered-Questions": "list-ordered",
  "Image-Occlusion": "image",
  "Hotspot-Cards": "map-pin",
  "Study-Sessions": "graduation-cap",
  Grading: "check-check",
  Scheduling: "calendar-clock",
  "Burying-Flashcards": "archive",
  "Suspending-Flashcards": "pause-circle",
  Widget: "panel-right",
  "Flashcard-Library": "table-2",
  "Reading-View": "book-open",
  "Reading-View-Styles": "palette",
  "Custom-Reading-Styles": "paintbrush",
  Analytics: "chart-spline",
  Charts: "chart-line",
  "Text-to-Speech": "volume-2",
  "Language-Settings": "languages",
  Reminders: "bell",
  Gatekeeper: "shield-alert",
  "AI-Usage-Policy": "shield-check",
  Settings: "settings",
  Syncing: "refresh-cw",
  Backups: "database",
  "Settings-Explained": "sliders-horizontal",
  "Support-LearnKit": "book-open-text",
  Flags: "flag",
  "Flag-Codes": "list",
  "Companion-Model-Compatibility": "git-compare-arrows",
  "First-Review-in-5-Minutes": "timer",
};

export async function loadGuidePages(app: App, pluginDir?: string): Promise<GuidePage[]> {
  const pagesFromRepoRaw: GuidePage[] = [];
  for (const fileName of PREFERRED_GUIDE_FILES) {
    try {
      const res = await requestUrl({
        url: `https://raw.githubusercontent.com/ctrlaltwill/LearnKit/main/site/src/content/docs/${encodeURIComponent(fileName)}`,
        method: "GET",
      });
      if (res.status !== 200 || !res.text) continue;
      const key = fileName.replace(/\.md$/i, "");
      pagesFromRepoRaw.push({
        key,
        label: key.replace(/-/g, " "),
        markdown: convertDocsLinksForObsidianGuide(res.text, { rewriteDemoImagesToRaw: true }),
        sourcePath: "",
      });
    } catch {
      // Ignore and continue to next fallback source
    }
  }

  if (pagesFromRepoRaw.length) return pagesFromRepoRaw;

  const pagesFromPluginDir: GuidePage[] = [];
  if (pluginDir) {
    for (const fileName of PREFERRED_GUIDE_FILES) {
      const relPath = `site/src/content/docs/${fileName}`;
      try {
        const markdown = await app.vault.adapter.read(`${pluginDir}/${relPath}`);
        const key = fileName.replace(/\.md$/i, "");
        pagesFromPluginDir.push({
          key,
          label: key.replace(/-/g, " "),
          markdown: convertDocsLinksForObsidianGuide(markdown),
          sourcePath: `${pluginDir}/${relPath}`,
        });
      } catch {
        // File might not exist in this build; ignore and continue.
      }
    }
  }

  if (pagesFromPluginDir.length) return pagesFromPluginDir;

  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("site/src/content/docs/"));
  if (!files.length) {
    return [{
      key: "guide-unavailable",
      label: "Guide",
      markdown: "# Guide\n\nGuide pages were not found.",
      sourcePath: "",
    }];
  }

  const order = [
    "What-LearnKit-Is",
    "Getting-Started",
    "Installation",
    "Syncing",
    "Import-From-Anki",
    "Coach",
    "Flashcards",
    "Notes",
    "Tests",
    "Study-Sessions",
    "Grading",
    "Scheduling",
    "Burying-Flashcards",
    "Suspending-Flashcards",
    "Widget",
    "Creating-Flashcards",
    "Editing-Flashcards",
    "Flashcard-Formatting",
    "Basic-&-Reversed-Flashcards",
    "Cloze-Flashcards",
    "Image-Occlusion",
    "Hotspot-Cards",
    "Multiple-Choice-Questions",
    "Ordered-Questions",
    "Flags",
    "Flag-Codes",
    "Flashcard-Library",
    "Analytics",
    "Charts",
    "Companion-Features",
    "Companion-Configuration",
    "Companion-Setting-Up",
    "Companion-Usage",
    "Guide-for-Free-Usage",
    "Reading-View",
    "Reading-View-Styles",
    "Custom-Reading-Styles",
    "Text-to-Speech",
    "Language-Settings",
    "Settings-Explained",
    "Settings",
    "Reminders",
    "Keyboard-Shortcuts",
    "Custom-Delimiters",
    "Gatekeeper",
    "Backups",
    "AI-Usage-Policy",
    "Support-LearnKit",
  ];
  const rank = new Map(order.map((name, index) => [name.toLowerCase(), index]));

  const pages: GuidePage[] = [];
  for (const file of files) {
    const key = file.basename;
    const label = key.replace(/-/g, " ");
    const markdown = convertDocsLinksForObsidianGuide(await app.vault.read(file));
    pages.push({ key, label, markdown, sourcePath: file.path });
  }

  pages.sort((a, b) => {
    const ra = rank.get(a.key.toLowerCase());
    const rb = rank.get(b.key.toLowerCase());
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.label.localeCompare(b.label);
  });

  return pages;
}

export function getGuideCategories(): GuideCategory[] {
  return GUIDE_CATEGORIES;
}

export function orderGuidePagesByNavigation(pages: GuidePage[]): GuidePage[] {
  if (!pages.length) return [];

  const byKey = new Map(pages.map((page) => [page.key, page]));
  const ordered: GuidePage[] = [];
  const seen = new Set<string>();

  for (const category of GUIDE_CATEGORIES) {
    for (const section of category.sections) {
      for (const key of section.pageKeys) {
        const page = byKey.get(key);
        if (!page || seen.has(page.key)) continue;
        ordered.push(page);
        seen.add(page.key);
      }
    }
  }

  for (const page of pages) {
    if (seen.has(page.key)) continue;
    ordered.push(page);
    seen.add(page.key);
  }

  return ordered;
}

export function getGuidePageDisplayLabel(pageKey: string): string {
  return GUIDE_LABEL_MAP[pageKey] ?? pageKey.replace(/-/g, " ");
}

export function getGuideTooltipLabel(pageKey: string): string {
  if (pageKey === "What-LearnKit-Is") return "What LearnKit Is";
  return getGuidePageDisplayLabel(pageKey);
}

export function getGuidePageIcon(pageKey: string): string {
  return GUIDE_ICON_MAP[pageKey] ?? "file-text";
}