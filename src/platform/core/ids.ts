/**
 * @file src/core/ids.ts
 * @summary Unique ID generator for Sprout flashcards. Produces random 9-digit numeric
 * strings and checks them against an existing set to guarantee uniqueness. Used during
 * sync to assign stable ^sprout-XXXXXXXXX anchors to new cards.
 *
 * @exports
 *   - generateUniqueId — generate a unique 9-digit numeric ID string not present in the given set
 */

const ID_MIN = 100000000;
const ID_RANGE = 900000000;
const UINT32_MAX = 0xffffffff;
const REJECTION_THRESHOLD = UINT32_MAX - (UINT32_MAX % ID_RANGE);

function random9(): string {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("Secure random generator unavailable.");
  }

  const buffer = new Uint32Array(1);
  let value = UINT32_MAX;
  while (value >= REJECTION_THRESHOLD) {
    cryptoObj.getRandomValues(buffer);
    value = buffer[0];
  }
  return String(ID_MIN + (value % ID_RANGE));
}

export function generateUniqueId(usedSet: Set<string>): string {
  for (let i = 0; i < 10000; i++) {
    const id = random9();
    if (!usedSet.has(id)) {
      usedSet.add(id);
      return id;
    }
  }
  throw new Error("Unable to generate unique 9-digit ID after many attempts.");
}
