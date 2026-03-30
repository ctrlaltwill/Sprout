import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { docsSidebarTree, toStarlightSidebar } from "./src/docs-structure.mts";

const DEFAULT_BASE = "/LearnKit";
const DEFAULT_SITE = "https://ctrlaltwill.github.io";

function normalizeBase(base) {
  if (!base) return DEFAULT_BASE;
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function resolveBase() {
  const envBase = process.env.ASTRO_BASE?.trim();
  if (envBase) return normalizeBase(envBase);

  const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1]?.trim();
  if (repoName) return normalizeBase(`/${repoName}`);

  return DEFAULT_BASE;
}

function resolveSite() {
  const envSite = process.env.ASTRO_SITE?.trim();
  if (envSite) return envSite;
  return DEFAULT_SITE;
}

export default defineConfig({
  site: resolveSite(),
  base: resolveBase(),
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
  integrations: [
    starlight({
      title: "LearnKit",
      description: "LearnKit documentation and user guides",
      sidebar: toStarlightSidebar(docsSidebarTree),
      editLink: {
        baseUrl: "https://github.com/ctrlaltwill/LearnKit/edit/main/site/src/content/docs/",
      },
      lastUpdated: true,
      pagination: true,
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 3,
      },
    }),
  ],
});