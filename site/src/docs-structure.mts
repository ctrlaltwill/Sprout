type DocsPage = {
  page: string;
  text?: string;
};

type DocsGroup = {
  text: string;
  items: DocsNode[];
  collapsed?: boolean;
};

export type DocsNode = DocsPage | DocsGroup;

export const pageTitleOverrides = new Map<string, string>([
  ["What-LearnKit-Is", "What LearnKit Is"],
  ["Support-LearnKit", "Support LearnKit"],
  ["Settings-Explained", "Settings Explained"],
  ["Companion-Features", "Companion Features"],
  ["Companion-Configuration", "Configuration"],
  ["Guide-for-Free-Usage", "Guide for Free Usage"],
  ["Companion-Setting-Up", "Setting Up"],
  ["Companion-Usage", "Usage"],
  ["Import-From-Anki", "Import From Anki"],
  ["Language-Settings", "Language Options"],
  ["Flag-Codes", "Flag Codes"],
  ["Study-Sessions", "Study Sessions"],
]);

export function toTitle(page: string): string {
  return pageTitleOverrides.get(page) ?? page.replace(/-/g, " ");
}

export const docsSidebarTree: DocsGroup[] = [
  {
    text: "Home",
    items: [{ page: "What-LearnKit-Is" }],
  },
  {
    text: "Getting Started",
    items: [
      { page: "Getting-Started" },
      { page: "First-Review-in-5-Minutes", text: "First Review in 5 Minutes" },
      { page: "Installation" },
      { page: "Syncing" },
      { page: "Import-From-Anki" },
    ],
  },
  {
    text: "Flashcards",
    items: [
      { page: "Flashcards", text: "Overview" },
      { page: "Creating-Flashcards" },
      { page: "Editing-Flashcards" },
      { page: "Flashcard-Formatting" },
      { page: "Basic-&-Reversed-Flashcards" },
      { page: "Cloze-Flashcards" },
      { page: "Image-Occlusion" },
      { page: "Multiple-Choice-Questions" },
      { page: "Ordered-Questions" },
      { page: "Flags" },
      { page: "Flag-Codes" },
    ],
  },
  {
    text: "Studying",
    items: [
      { page: "Coach" },
      { page: "Flashcards" },
      { page: "Notes" },
      { page: "Tests" },
      { page: "Study-Sessions" },
      { page: "Grading" },
      { page: "Scheduling" },
      { page: "Burying-Flashcards" },
      { page: "Suspending-Flashcards" },
      { page: "Widget", text: "Overview" },
    ],
  },
  {
    text: "Tools",
    items: [
      { page: "Flashcard-Library", text: "Library" },
      { page: "Analytics" },
    ],
  },
  {
    text: "Companion",
    items: [
      { page: "Companion-Features" },
      { page: "Companion-Configuration" },
      { page: "Companion-Setting-Up" },
      { page: "Companion-Usage" },
      { page: "Guide-for-Free-Usage" },
    ],
  },
  {
    text: "Reading",
    items: [
      { page: "Reading-View" },
      { page: "Reading-View-Styles" },
    ],
  },
  {
    text: "Audio",
    items: [
      { page: "Text-to-Speech" },
      { page: "Language-Settings" },
    ],
  },
  {
    text: "Settings & Customisation",
    items: [
      { page: "Settings-Explained" },
      { page: "Settings" },
      { page: "Reminders" },
      { page: "Keyboard-Shortcuts" },
      { page: "Custom-Delimiters" },
      { page: "Gatekeeper" },
    ],
  },
  {
    text: "Maintenance",
    items: [{ page: "Backups" }, { page: "Localization-Debt" }],
  },
  {
    text: "Policies",
    items: [{ page: "AI-Usage-Policy" }],
  },
  {
    text: "Support",
    items: [{ page: "Support-LearnKit" }],
  },
];

function isDocsPage(node: DocsNode): node is DocsPage {
  return "page" in node;
}

export function toStarlightSidebar(nodes: DocsNode[]): Array<{ label: string; slug?: string; items?: Array<{ label: string; slug?: string; items?: unknown[]; collapsed?: boolean }>; collapsed?: boolean }> {
  return nodes.map((node) => {
    if (isDocsPage(node)) {
      return {
        label: node.text ?? toTitle(node.page),
        slug: node.page,
      };
    }

    return {
      label: node.text,
      collapsed: node.collapsed,
      items: toStarlightSidebar(node.items),
    };
  });
}