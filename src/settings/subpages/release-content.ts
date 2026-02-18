import { type App, requestUrl } from "obsidian";
import { RELEASE_NOTES } from "../../modals/whats-new-modal/release-notes";
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
    return await app.vault.adapter.read(`${pluginDir ?? `${configDir}/plugins/sprout`}/wiki/Support-Sprout.md`);
  } catch {
    return `# About Sprout

## Our Story

Sprout was built by William Guy, a final-year medical student in New Zealand. Designed to bring modern spaced-repetition directly into your Obsidian vault — so your flashcards, notes, and study sessions all live in one place.

- [Find out more about Will](https://www.linkedin.com/in/williamguy/)

## Feedback & Issues

Found a bug? Have an idea for a feature? We'd love to hear from you. Sprout uses GitHub issue templates to keep things organised — just pick the right one and fill it in.

- [Report a bug](https://github.com/ctrlaltwill/Sprout/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/ctrlaltwill/Sprout/issues/new?template=feature_request.yml)
- [Browse open issues](https://github.com/ctrlaltwill/Sprout/issues)

## Support the Project

You can support Sprout by starring the repo, sharing it with friends, or caffeinating the dev!

- [⭐ Star on GitHub](https://github.com/ctrlaltwill/Sprout)
- [📋 Share Sprout](https://github.com/ctrlaltwill/Sprout)
- [☕ Buy me a coffee](https://buymeacoffee.com/williamguy)
`;
  }
}