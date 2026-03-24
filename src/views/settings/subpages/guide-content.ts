import { type App, requestUrl } from "obsidian";
import type { GuideCategory, GuidePage } from "./types";
import { t } from "../../../platform/translations/translator";

const tx = (token: string, fallback: string) => t("en", token, fallback);

function convertDocsLinksForObsidianGuide(markdown: string): string {
  return String(markdown ?? "")
    .replace(/\[([^\]]+)\]\(\.\/([^)#]+?)\.md(#[^)]+)?\)/g, (_m, text: string, target: string) => {
      const label = String(text ?? "").trim();
      const page = String(target ?? "").trim();
      if (!page) return _m;
      const defaultLabel = page.replace(/-/g, " ");
      return label && label !== defaultLabel ? `[[${page}|${label}]]` : `[[${page}]]`;
    })
    .replace(/\[([^\]]+)\]\(\/([^)#]+?)(#[^)]+)?\)/g, (_m, text: string, target: string) => {
      const label = String(text ?? "").trim();
      const page = String(target ?? "").trim();
      if (!page || /^https?:\/\//i.test(page)) return _m;
      const defaultLabel = page.replace(/-/g, " ");
      return label && label !== defaultLabel ? `[[${page}|${label}]]` : `[[${page}]]`;
    });
}

const PREFERRED_GUIDE_FILES = [
  "Home.md",
  "Wiki-Tree.md",
  "Getting-Started.md",
  "Installation.md",
  "Syncing.md",
  "Anki-Export-&-Import.md",
  "Flashcards.md",
  "Notes.md",
  "Editing-Cards.md",
  "Card-Formatting.md",
  "Companion-Configuration.md",
  "Companion-Features.md",
  "Guide-for-Free-Usage.md",
  "Companion-Setting-Up.md",
  "Companion-Usage.md",
  "Coach.md",
  "Tests.md",
  "Creating-Cards.md",
  "Cards.md",
  "Flag-Codes.md",
  "Flags.md",
  "Basic-&-Reversed-Cards.md",
  "Cloze-Cards.md",
  "Image-Occlusion.md",
  "Multiple-Choice-Questions.md",
  "Ordered-Questions.md",
  "Card-Browser.md",
  "Reading-View.md",
  "Reading-View-Styles.md",
  "Custom-Reading-Styles.md",
  "Study-Sessions.md",
  "Grading.md",
  "Scheduling.md",
  "Burying-Cards.md",
  "Suspending-Cards.md",
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
  "Localization-Debt.md",
  "Custom-Delimiters.md",
  "AI-Usage-Policy.md",
  "Backups.md",
  "Support-LearnKit.md",
];

export const GUIDE_CATEGORIES: GuideCategory[] = [
  { key: "home", label: tx("ui.guide.categories.home", "Home"), icon: "house", sections: [{ pageKeys: ["Home", "Wiki-Tree"] }] },
  {
    key: "getting-started",
    label: tx("ui.guide.categories.gettingStarted", "Getting Started"),
    icon: "rocket",
    sections: [{ pageKeys: ["Getting-Started", "Installation", "Syncing", "Anki-Export-&-Import"] }],
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
        pageKeys: ["Study-Sessions", "Grading", "Scheduling", "Burying-Cards", "Suspending-Cards"],
      },
      { title: tx("ui.guide.sections.scope", "Scope"), pageKeys: ["Widget"] },
    ],
  },
  {
    key: "cards",
    label: tx("ui.guide.categories.cards", "Cards"),
    icon: "square-stack",
    sections: [
      { pageKeys: ["Cards", "Creating-Cards", "Editing-Cards", "Card-Formatting"] },
      {
        title: tx("ui.guide.sections.cardTypes", "Card Types"),
        pageKeys: ["Basic-&-Reversed-Cards", "Cloze-Cards", "Image-Occlusion", "Multiple-Choice-Questions", "Ordered-Questions"],
      },
      { title: tx("ui.guide.sections.flags", "Flags"), pageKeys: ["Flags", "Flag-Codes"] },
    ],
  },
  {
    key: "tools",
    label: tx("ui.guide.categories.tools", "Tools"),
    icon: "table-2",
    sections: [
      { title: tx("ui.guide.sections.library", "Library"), pageKeys: ["Card-Browser"] },
      { title: tx("ui.guide.sections.analytics", "Analytics"), pageKeys: ["Analytics", "Charts"] },
    ],
  },
  {
    key: "companion",
    label: tx("ui.guide.categories.companion", "Companion"),
    icon: "sparkles",
    sections: [{ pageKeys: ["Companion-Features", "Companion-Configuration", "Companion-Setting-Up", "Companion-Usage", "Guide-for-Free-Usage"] }],
  },
  {
    key: "reading-audio",
    label: tx("ui.guide.categories.readingAudio", "Reading & Audio"),
    icon: "book-open",
    sections: [
      { title: tx("ui.guide.sections.readingView", "Reading View"), pageKeys: ["Reading-View", "Reading-View-Styles", "Custom-Reading-Styles"] },
      { title: tx("ui.guide.sections.audio", "Audio"), pageKeys: ["Text-to-Speech", "Language-Settings"] },
    ],
  },
  {
    key: "settings",
    label: tx("ui.guide.categories.settings", "Settings"),
    icon: "settings",
    sections: [{ pageKeys: ["Settings-Explained", "Settings", "Reminders", "Keyboard-Shortcuts", "Custom-Delimiters", "Gatekeeper"] }],
  },
  {
    key: "maintenance",
    label: tx("ui.guide.categories.maintenance", "Maintenance"),
    icon: "database",
    sections: [{ pageKeys: ["Backups", "Localization-Debt"] }],
  },
  {
    key: "policies",
    label: tx("ui.guide.categories.policies", "Policies"),
    icon: "shield-check",
    sections: [{ pageKeys: ["AI-Usage-Policy"] }],
  },
  {
    key: "reference",
    label: tx("ui.guide.categories.reference", "Reference"),
    icon: "library",
    sections: [{ pageKeys: ["Support-LearnKit"] }],
  },
];

const GUIDE_LABEL_MAP: Record<string, string> = {
  "Companion-Configuration": "Configuration",
  "Companion-Features": "Companion Features",
  "Guide-for-Free-Usage": "Guide for Free Usage",
  "Companion-Setting-Up": "Setting Up",
  "Companion-Usage": "Usage",
  "Getting-Started": "Getting Started",
  "Anki-Export-&-Import": "Anki Import Export",
  Flashcards: "Flashcards",
  Notes: "Notes",
  Cards: "Cards Overview",
  "Editing-Cards": "Editing Cards",
  "Language-Settings": "Language Options",
  "Settings-Explained": "Settings Explained",
  Backups: "Back Up",
  "Localization-Debt": "Localization Debt",
  "Support-LearnKit": "About LearnKit",
  "Reading-View-Styles": "Reading View Styles",
  "Custom-Reading-Styles": "Custom Reading Styles",
  "Card-Browser": "Library (Card Browser)",
  Reminders: "Reminders",
  Gatekeeper: "Gatekeeper",
  "Flag-Codes": "Flag Codes",
};

const GUIDE_ICON_MAP: Record<string, string> = {
  Home: "house",
  "Wiki-Tree": "git-branch",
  "Getting-Started": "rocket",
  Installation: "download",
  "Anki-Export-&-Import": "arrow-right-left",
  Flashcards: "star",
  Notes: "notebook-text",
  "Editing-Cards": "file-pen-line",
  "Card-Formatting": "braces",
  "Companion-Features": "sparkles",
  "Companion-Configuration": "settings-2",
  "Guide-for-Free-Usage": "piggy-bank",
  "Companion-Setting-Up": "key-round",
  "Companion-Usage": "messages-square",
  Coach: "target",
  Tests: "clipboard-check",
  "Creating-Cards": "plus-circle",
  Cards: "square-stack",
  "Custom-Delimiters": "separator-vertical",
  "Keyboard-Shortcuts": "keyboard",
  "Basic-&-Reversed-Cards": "repeat",
  "Cloze-Cards": "text-cursor-input",
  "Multiple-Choice-Questions": "list-checks",
  "Ordered-Questions": "list-ordered",
  "Image-Occlusion": "image",
  "Study-Sessions": "graduation-cap",
  Grading: "check-check",
  Scheduling: "calendar-clock",
  "Burying-Cards": "archive",
  "Suspending-Cards": "pause-circle",
  Widget: "panel-right",
  "Card-Browser": "table-2",
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
  "Localization-Debt": "languages",
  "Settings-Explained": "sliders-horizontal",
  "Support-LearnKit": "book-open-text",
  Flags: "flag",
  "Flag-Codes": "list",
};

export async function loadGuidePages(app: App, pluginDir?: string): Promise<GuidePage[]> {
  const pagesFromRepoRaw: GuidePage[] = [];
  for (const fileName of PREFERRED_GUIDE_FILES) {
    try {
      const res = await requestUrl({
        url: `https://raw.githubusercontent.com/ctrlaltwill/LearnKit/main/site/docs/${encodeURIComponent(fileName)}`,
        method: "GET",
      });
      if (res.status !== 200 || !res.text) continue;
      const key = fileName.replace(/\.md$/i, "");
      pagesFromRepoRaw.push({
        key,
        label: key.replace(/-/g, " "),
        markdown: convertDocsLinksForObsidianGuide(res.text),
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
      const relPath = `site/docs/${fileName}`;
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

  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("site/docs/"));
  if (!files.length) {
    return [{
      key: "guide-unavailable",
      label: "Guide",
      markdown: "# Guide\n\nGuide pages were not found.",
      sourcePath: "",
    }];
  }

  const order = [
    "Home",
    "Wiki-Tree",
    "Getting-Started",
    "Installation",
    "Syncing",
    "Anki-Export-&-Import",
    "Coach",
    "Flashcards",
    "Notes",
    "Tests",
    "Study-Sessions",
    "Grading",
    "Scheduling",
    "Burying-Cards",
    "Suspending-Cards",
    "Widget",
    "Creating-Cards",
    "Editing-Cards",
    "Card-Formatting",
    "Cards",
    "Basic-&-Reversed-Cards",
    "Cloze-Cards",
    "Image-Occlusion",
    "Multiple-Choice-Questions",
    "Ordered-Questions",
    "Flags",
    "Flag-Codes",
    "Card-Browser",
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
    "Localization-Debt",
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
  if (pageKey === "Home") return "Home";
  return getGuidePageDisplayLabel(pageKey);
}

export function getGuidePageIcon(pageKey: string): string {
  return GUIDE_ICON_MAP[pageKey] ?? "file-text";
}