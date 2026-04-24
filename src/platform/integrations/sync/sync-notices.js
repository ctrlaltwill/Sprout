/**
 * @file src/platform/integrations/sync/sync-notices.ts
 * @summary Module for sync notices.
 *
 * @exports
 *  - formatCurrentNoteSyncNotice
 */
export function formatCurrentNoteSyncNotice(pageTitle, res) {
    var _a, _b, _c;
    const updated = Number((_a = res.updatedCount) !== null && _a !== void 0 ? _a : 0);
    const created = Number((_b = res.newCount) !== null && _b !== void 0 ? _b : 0);
    const deleted = Number((_c = res.removed) !== null && _c !== void 0 ? _c : 0);
    const parts = [];
    if (updated > 0)
        parts.push(`${updated} updated`);
    if (created > 0)
        parts.push(`${created} new`);
    if (deleted > 0)
        parts.push(`${deleted} deleted`);
    if (parts.length === 0)
        return `Flashcards updated for page - ${pageTitle} - no changes`;
    return `Flashcards updated for page - ${pageTitle} - ${parts.join(", ")}`;
}
