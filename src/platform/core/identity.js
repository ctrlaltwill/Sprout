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
export const LEGACY_CARD_ANCHOR_PREFIXES = ["sprout"];
const ALL_CARD_ANCHOR_PREFIXES = [PRIMARY_CARD_ANCHOR_PREFIX, ...LEGACY_CARD_ANCHOR_PREFIXES];
export const CARD_ANCHOR_PREFIX_PATTERN = `(?:${ALL_CARD_ANCHOR_PREFIXES.join("|")})`;
export const CARD_ANCHOR_LINE_RE = new RegExp(`^\\^${CARD_ANCHOR_PREFIX_PATTERN}-(\\d{9})\\s*$`);
export const CARD_ANCHOR_INLINE_RE = new RegExp(`\\^${CARD_ANCHOR_PREFIX_PATTERN}-(\\d{6,12})`);
function escapeRegex(lit) {
    return lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function createCardAnchorGlobalRe() {
    return new RegExp(CARD_ANCHOR_INLINE_RE.source, "g");
}
export function buildCardAnchor(id, prefix = PRIMARY_CARD_ANCHOR_PREFIX) {
    return `^${prefix}-${String(id).trim()}`;
}
export function buildPrimaryCardAnchor(id) {
    return buildCardAnchor(id, PRIMARY_CARD_ANCHOR_PREFIX);
}
export function extractCardAnchorId(line) {
    var _a;
    const m = CARD_ANCHOR_LINE_RE.exec(String(line || "").trim());
    return (_a = m === null || m === void 0 ? void 0 : m[1]) !== null && _a !== void 0 ? _a : null;
}
export function hasCardAnchorForId(line, id) {
    const safeId = escapeRegex(String(id || "").trim());
    if (!safeId)
        return false;
    const re = new RegExp(`\\^${CARD_ANCHOR_PREFIX_PATTERN}-${safeId}\\b`);
    return re.test(String(line || ""));
}
export function getPluginDirCandidates(configDir, manifestId) {
    const out = [];
    const push = (id) => {
        const v = String(id || "").trim();
        if (!v)
            return;
        const p = `${configDir}/plugins/${v}`;
        if (!out.includes(p))
            out.push(p);
    };
    push(manifestId);
    push(CURRENT_PLUGIN_ID);
    push(LEGACY_PLUGIN_ID);
    return out;
}
