type GroupVariantStats = {
  count: number;
  firstSeen: number;
};

/** Normalise a group path like " /a//b/ c / " -> "a/b/c" */
export function normalizeGroupPath(raw: string): string | null {
  let normalizedPath = String(raw ?? "").trim();
  if (!normalizedPath) return null;

  normalizedPath = normalizedPath.replace(/\\/g, "/");
  normalizedPath = normalizedPath.replace(/::/g, "/");
  normalizedPath = normalizedPath.replace(/^\/+/, "").replace(/\/+$/, "");
  normalizedPath = normalizedPath.replace(/\/{2,}/g, "/");

  const segments = normalizedPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) return null;
  return segments.join("/");
}

export function normaliseGroupPath(raw: string): string | null {
  return normalizeGroupPath(raw);
}

function pickCanonicalGroupVariant(variants: Map<string, GroupVariantStats>): string {
  let canonicalVariant = "";
  let canonicalCount = -1;
  let canonicalFirstSeen = Number.POSITIVE_INFINITY;

  for (const [variant, stats] of variants) {
    if (
      stats.count > canonicalCount
      || (stats.count === canonicalCount && stats.firstSeen < canonicalFirstSeen)
      || (stats.count === canonicalCount
        && stats.firstSeen === canonicalFirstSeen
        && variant.localeCompare(canonicalVariant) < 0)
    ) {
      canonicalVariant = variant;
      canonicalCount = stats.count;
      canonicalFirstSeen = stats.firstSeen;
    }
  }

  return canonicalVariant;
}

export function buildCanonicalGroupCaseMap(rawGroups: Iterable<string>): Map<string, string> {
  const variantsByLowerKey = new Map<string, Map<string, GroupVariantStats>>();
  let seenIndex = 0;

  for (const rawGroup of rawGroups) {
    const normalizedGroup = normalizeGroupPath(rawGroup);
    if (!normalizedGroup) continue;

    const lowerKey = normalizedGroup.toLowerCase();
    let variants = variantsByLowerKey.get(lowerKey);
    if (!variants) {
      variants = new Map<string, GroupVariantStats>();
      variantsByLowerKey.set(lowerKey, variants);
    }

    const existing = variants.get(normalizedGroup);
    if (existing) {
      existing.count += 1;
    } else {
      variants.set(normalizedGroup, { count: 1, firstSeen: seenIndex });
    }

    seenIndex += 1;
  }

  const canonicalByLowerKey = new Map<string, string>();
  for (const [lowerKey, variants] of variantsByLowerKey) {
    canonicalByLowerKey.set(lowerKey, pickCanonicalGroupVariant(variants));
  }

  return canonicalByLowerKey;
}

export function canonicalizeGroups(rawGroups: Iterable<string>): string[] {
  return Array.from(buildCanonicalGroupCaseMap(rawGroups).values()).sort((a, b) => a.localeCompare(b));
}