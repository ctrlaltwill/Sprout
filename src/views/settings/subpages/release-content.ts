/**
 * @file src/views/settings/subpages/release-content.ts
 * @summary Module for release content.
 *
 * @exports
 *  - formatReleaseDate
 *  - compareSemverDesc
 *  - normaliseReleaseBodyMarkdown
 *  - getBundledReleasePages
 *  - fetchGithubReleasePages
 *  - readSupportMarkdown
 */

import { type App, requestUrl } from "obsidian";
import { RELEASE_NOTES } from "../../../platform/core/release-notes";
import { getPluginDirCandidates } from "../../../platform/core/identity";
import type { GithubReleaseApiItem, ReleaseNotesPage } from "./types";

export function formatReleaseDate(input?: string): string {
  const d = input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) return "Unknown";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function compareSemverDesc(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => Number(n));
  const pb = b.replace(/^v/i, "").split(".").map((n) => Number(n));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na !== nb) return nb - na;
  }
  return 0;
}

export function normaliseReleaseBodyMarkdown(markdown: string): string {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const out: string[] = [];
  let skipNextReleaseDateLine = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#\s+/i.test(trimmed) && /release|changelog|what'?s changed|what'?s new/i.test(trimmed)) continue;
    if (/^##\s+/i.test(trimmed) && /v?\d+\.\d+\.\d+/i.test(trimmed)) continue;
    if (/^last (updated|modified)\s*:/i.test(trimmed)) continue;

    if (/^###\s+release date\s*$/i.test(trimmed)) {
      skipNextReleaseDateLine = true;
      continue;
    }
    if (skipNextReleaseDateLine) {
      if (trimmed.length === 0) continue;
      skipNextReleaseDateLine = false;
      continue;
    }

    out.push(line);
  }

  return out.join("\n").replace(/^\s+|\s+$/g, "");
}

export function getBundledReleasePages(): ReleaseNotesPage[] {
  const versions = Object.keys(RELEASE_NOTES).sort((a, b) => compareSemverDesc(a, b));
  return versions.map((version) => ({
    key: `release-${version.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()}`,
    label: version,
    version,
    modifiedDate: RELEASE_NOTES[version].releaseDate ?? formatReleaseDate(undefined),
    markdown: normaliseReleaseBodyMarkdown(RELEASE_NOTES[version].content),
  }));
}

export async function fetchGithubReleasePages(): Promise<ReleaseNotesPage[]> {
  try {
    const res = await requestUrl({
      url: "https://api.github.com/repos/ctrlaltwill/Sprout/releases?per_page=100",
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status !== 200 || !res.text) return getBundledReleasePages();

    const parsed = JSON.parse(res.text) as unknown;
    if (!Array.isArray(parsed)) return getBundledReleasePages();

    const releases = (parsed as GithubReleaseApiItem[])
      .filter((r) => !r.draft && !r.prerelease && !!r.tag_name)
      .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime());

    if (!releases.length) return getBundledReleasePages();

    return releases.map((r) => {
      const version = String(r.tag_name ?? "").replace(/^v/i, "").trim();
      const fallback = RELEASE_NOTES[version]?.content ?? "No release notes available.";
      const body = normaliseReleaseBodyMarkdown(String(r.body ?? "").trim() || fallback);
      const updated = formatReleaseDate(r.published_at);
      const source = r.html_url ? `\n\n---\n\n[View on GitHub](${r.html_url})` : "";
      return {
        key: `release-${version.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()}`,
        label: version,
        version,
        modifiedDate: updated,
        markdown: `${body}${source}`,
      };
    });
  } catch {
    return getBundledReleasePages();
  }
}

export async function readSupportMarkdown(app: App, pluginDir?: string): Promise<string> {
  try {
    const configDir = app.vault.configDir;
    const bases = pluginDir ? [pluginDir] : getPluginDirCandidates(configDir);
    for (const base of bases) {
      try {
        return await app.vault.adapter.read(`${base}/site/docs/Support-LearnKit.md`);
      } catch {
        // try next candidate
      }
    }
    throw new Error("support markdown not found");
  } catch {
    return `# About LearnKit

## Our Story

  LearnKit was built by William Guy, a final-year medical student in New Zealand, to bring modern spaced-repetition directly into your Obsidian vault. Flashcards are at the heart of LearnKit, but the goal is bigger: to be the memory layer for Obsidian - linking your notes to review, recall, and long-term retention in one system.

  LearnKit is proudly open source and will always remain free. No hidden fees. No subscriptions. Learning tools should not lock your knowledge behind paywalls, and your notes and data should stay entirely under your control.

  Companion, the AI companion introduced in LearnKit 1.10, runs on a bring-your-own API key model. You choose which provider to use and pay only for what you use, not a fixed monthly fee set by us.

- [Find out more about Will](https://www.linkedin.com/in/williamguy/)

## Feedback & Issues

Found a bug? Have an idea for a feature? We'd love to hear from you. LearnKit uses GitHub issue templates to keep things organised - just pick the right one and fill it in.

- [Request a feature](https://github.com/ctrlaltwill/Sprout/issues/new?template=feature_request.yml)
- [Browse open issues](https://github.com/ctrlaltwill/Sprout/issues)

## Support the Project

- [📋 Share LearnKit](https://github.com/ctrlaltwill/Sprout)
- [❤️ Sponsor development](https://buymeacoffee.com/williamguy)
`;
  }
}