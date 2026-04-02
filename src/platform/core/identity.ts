/**
 * @file src/platform/core/identity.ts
 * @summary Module for identity.
 *
 * @exports
 *  - CURRENT_PLUGIN_ID
 *  - LEGACY_PLUGIN_ID
 *  - PRIMARY_CARD_ANCHOR_PREFIX
 *  - LEGACY_CARD_ANCHOR_PREFIXES
 *  - CARD_ANCHOR_PREFIX_PATTERN
 *  - CARD_ANCHOR_LINE_RE
 */
export const CURRENT_PLUGIN_ID = "learnkit";
export const LEGACY_PLUGIN_ID = "sprout";

export const PRIMARY_CARD_ANCHOR_PREFIX = "learnkit";
export const LEGACY_CARD_ANCHOR_PREFIXES = ["sprout"] as const;

const ALL_CARD_ANCHOR_PREFIXES = [PRIMARY_CARD_ANCHOR_PREFIX, ...LEGACY_CARD_ANCHOR_PREFIXES];

export const CARD_ANCHOR_PREFIX_PATTERN = `(?:${ALL_CARD_ANCHOR_PREFIXES.join("|")})`;
export const CARD_ANCHOR_LINE_RE = new RegExp(`^\\^${CARD_ANCHOR_PREFIX_PATTERN}-(\\d{9})\\s*$`);
export const CARD_ANCHOR_INLINE_RE = new RegExp(`\\^${CARD_ANCHOR_PREFIX_PATTERN}-(\\d{6,12})`);

function escapeRegex(lit: string): string {
  return lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createCardAnchorGlobalRe(): RegExp {
  return new RegExp(CARD_ANCHOR_INLINE_RE.source, "g");
}

export function buildCardAnchor(id: string, prefix = PRIMARY_CARD_ANCHOR_PREFIX): string {
  return `^${prefix}-${String(id).trim()}`;
}

export function buildPrimaryCardAnchor(id: string): string {
  return buildCardAnchor(id, PRIMARY_CARD_ANCHOR_PREFIX);
}

export function extractCardAnchorId(line: string): string | null {
  const m = CARD_ANCHOR_LINE_RE.exec(String(line || "").trim());
  return m?.[1] ?? null;
}

export function hasCardAnchorForId(line: string, id: string): boolean {
  const safeId = escapeRegex(String(id || "").trim());
  if (!safeId) return false;
  const re = new RegExp(`\\^${CARD_ANCHOR_PREFIX_PATTERN}-${safeId}\\b`);
  return re.test(String(line || ""));
}

export function getPluginDirCandidates(configDir: string, manifestId?: string | null): string[] {
  const out: string[] = [];
  const push = (id: string | null | undefined) => {
    const v = String(id || "").trim();
    if (!v) return;
    const p = `${configDir}/plugins/${v}`;
    if (!out.includes(p)) out.push(p);
  };

  push(manifestId);
  push(CURRENT_PLUGIN_ID);
  push(LEGACY_PLUGIN_ID);

  return out;
}
