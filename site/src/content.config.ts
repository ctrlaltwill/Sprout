import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

function preserveDocsPath(entry) {
  const normalized = String(entry).replace(/\\/g, "/");
  const withoutExtension = normalized.replace(/\.(markdown|mdown|mkdn|mkd|mdwn|md|mdx)$/i, "");
  return withoutExtension.replace(/\/index$/i, "");
}

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: "./src/content/docs",
      pattern: "**/[^_]*.{markdown,mdown,mkdn,mkd,mdwn,md,mdx}",
      generateId: ({ entry, data }) => {
        if (typeof data.slug === "string" && data.slug.length > 0) {
          return data.slug;
        }

        return preserveDocsPath(entry);
      },
    }),
    schema: docsSchema(),
  }),
};