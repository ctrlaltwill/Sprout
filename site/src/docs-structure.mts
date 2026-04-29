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
  ["Study-Sessions", "Study Sessions"]
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
    text: "Audio",
    items: [
      { page: "Language-Settings" },
      { page: "Text-to-Speech" },
    ],
  },
  {
    text: "Companion",
    items: [
      { page: "Companion-Configuration" },
      { page: "Companion-Features" },
      { page: "Companion-Model-Compatibility" },
      { page: "Companion-Setting-Up" },
      { page: "Companion-Usage" },
      { page: "Guide-for-Free-Usage" },
    ],
  },
  {
    text: "Flashcards",
    items: [
      { page: "Basic-&-Reversed-Flashcards" },
      { page: "Cloze-Flashcards" },
      { page: "Creating-Flashcards" },
      { page: "Decks-&-Organisation" },
      { page: "Editing-Flashcards" },
      { page: "Flag-Codes" },
      { page: "Flags" },
      { page: "Flashcard-Formatting" },
      { page: "Flashcards", text: "Overview" },
      { page: "Image-Occlusion" },
      { page: "Hotspot-Cards" },
      { page: "Multiple-Choice-Questions" },
      { page: "Ordered-Questions" },
    ],
  },
  {
    text: "Getting Started",
    items: [
      { page: "First-Review-in-5-Minutes", text: "First Review in 5 Minutes" },
      { page: "Getting-Started" },
      { page: "Import-From-Anki" },
      { page: "Installation" },
      { page: "Syncing" },
    ],
  },
  {
    text: "Maintenance",
    items: [{ page: "Backups" }],
  },
  {
    text: "Policies",
    items: [{ page: "AI-Usage-Policy" }],
  },
  {
    text: "Reading",
    items: [
      { page: "Reading-View" },
      { page: "Reading-View-Styles" },
    ],
  },
  {
    text: "Settings & Customisation",
    items: [
      { page: "Custom-Delimiters" },
      { page: "Gatekeeper" },
      { page: "Keyboard-Shortcuts" },
      { page: "Reminders" },
      { page: "Settings" },
      { page: "Settings-Explained" },
    ],
  },
  {
    text: "Studying",
    items: [
      { page: "Burying-Flashcards" },
      { page: "Coach" },
      { page: "Flashcards" },
      { page: "Grading" },
      { page: "Notes" },
      { page: "Scheduling" },
      { page: "Study-Sessions" },
      { page: "Suspending-Flashcards" },
      { page: "Tests" },
      { page: "Widget", text: "Study Widget" },
    ],
  },
  {
    text: "Support",
    items: [{ page: "Support-LearnKit" }],
  },
  {
    text: "Tools",
    items: [
      { page: "Analytics" },
      { page: "Flashcard-Library", text: "Library" },
    ],
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