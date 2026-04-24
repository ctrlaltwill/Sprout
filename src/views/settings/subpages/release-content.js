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
import { requestUrl } from "obsidian";
import { RELEASE_NOTES } from "../../../platform/core/release-notes";
import { getPluginDirCandidates } from "../../../platform/core/identity";
export function formatReleaseDate(input) {
    const d = input ? new Date(input) : new Date();
    if (Number.isNaN(d.getTime()))
        return "Unknown";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}
export function compareSemverDesc(a, b) {
    const pa = a.replace(/^v/i, "").split(".").map((n) => Number(n));
    const pb = b.replace(/^v/i, "").split(".").map((n) => Number(n));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = Number.isFinite(pa[i]) ? pa[i] : 0;
        const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
        if (na !== nb)
            return nb - na;
    }
    return 0;
}
export function normaliseReleaseBodyMarkdown(markdown) {
    const lines = String(markdown !== null && markdown !== void 0 ? markdown : "").split(/\r?\n/);
    const out = [];
    let skipNextReleaseDateLine = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^#\s+/i.test(trimmed) && /release|changelog|what'?s changed|what'?s new/i.test(trimmed))
            continue;
        if (/^##\s+/i.test(trimmed) && /v?\d+\.\d+\.\d+/i.test(trimmed))
            continue;
        if (/^last (updated|modified)\s*:/i.test(trimmed))
            continue;
        if (/^###\s+release date\s*$/i.test(trimmed)) {
            skipNextReleaseDateLine = true;
            continue;
        }
        if (skipNextReleaseDateLine) {
            if (trimmed.length === 0)
                continue;
            skipNextReleaseDateLine = false;
            continue;
        }
        out.push(line);
    }
    return out.join("\n").replace(/^\s+|\s+$/g, "");
}
export function getBundledReleasePages() {
    const versions = Object.keys(RELEASE_NOTES).sort((a, b) => compareSemverDesc(a, b));
    return versions.map((version) => {
        var _a;
        return ({
            key: `release-${version.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()}`,
            label: version,
            version,
            modifiedDate: (_a = RELEASE_NOTES[version].releaseDate) !== null && _a !== void 0 ? _a : formatReleaseDate(undefined),
            markdown: normaliseReleaseBodyMarkdown(RELEASE_NOTES[version].content),
        });
    });
}
export async function fetchGithubReleasePages() {
    try {
        const res = await requestUrl({
            url: "https://api.github.com/repos/ctrlaltwill/Sprout/releases?per_page=100",
            method: "GET",
            headers: { Accept: "application/vnd.github+json" },
        });
        if (res.status !== 200 || !res.text)
            return getBundledReleasePages();
        const parsed = JSON.parse(res.text);
        if (!Array.isArray(parsed))
            return getBundledReleasePages();
        const releases = parsed
            .filter((r) => !r.draft && !r.prerelease && !!r.tag_name)
            .sort((a, b) => { var _a, _b; return new Date((_a = b.published_at) !== null && _a !== void 0 ? _a : 0).getTime() - new Date((_b = a.published_at) !== null && _b !== void 0 ? _b : 0).getTime(); });
        if (!releases.length)
            return getBundledReleasePages();
        return releases.map((r) => {
            var _a, _b, _c, _d;
            const version = String((_a = r.tag_name) !== null && _a !== void 0 ? _a : "").replace(/^v/i, "").trim();
            const fallback = (_c = (_b = RELEASE_NOTES[version]) === null || _b === void 0 ? void 0 : _b.content) !== null && _c !== void 0 ? _c : "No release notes available.";
            const body = normaliseReleaseBodyMarkdown(String((_d = r.body) !== null && _d !== void 0 ? _d : "").trim() || fallback);
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
    }
    catch (_a) {
        return getBundledReleasePages();
    }
}
export async function readSupportMarkdown(app, pluginDir) {
    try {
        const configDir = app.vault.configDir;
        const bases = pluginDir ? [pluginDir] : getPluginDirCandidates(configDir);
        for (const base of bases) {
            try {
                return await app.vault.adapter.read(`${base}/site/docs/Support-LearnKit.md`);
            }
            catch (_a) {
                // try next candidate
            }
        }
        throw new Error("support markdown not found");
    }
    catch (_b) {
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
