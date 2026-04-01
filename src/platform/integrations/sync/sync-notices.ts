export function formatCurrentNoteSyncNotice(
  pageTitle: string,
  res: { newCount?: number; updatedCount?: number; removed?: number },
): string {
  const updated = Number(res.updatedCount ?? 0);
  const created = Number(res.newCount ?? 0);
  const deleted = Number(res.removed ?? 0);
  const parts: string[] = [];

  if (updated > 0) parts.push(`${updated} updated`);
  if (created > 0) parts.push(`${created} new`);
  if (deleted > 0) parts.push(`${deleted} deleted`);

  if (parts.length === 0) return `Flashcards updated for page - ${pageTitle} - no changes`;
  return `Flashcards updated for page - ${pageTitle} - ${parts.join(", ")}`;
}
