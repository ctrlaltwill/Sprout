/**
 * @file src/core/ids.ts
 * @summary Unique ID generator for Sprout flashcards. Produces random 9-digit numeric
 * strings and checks them against an existing set to guarantee uniqueness. Used during
 * sync to assign stable ^sprout-XXXXXXXXX anchors to new cards.
 *
 * @exports
 *   - generateUniqueId — generate a unique 9-digit numeric ID string not present in the given set
 */

function random9(): string {
  return String(Math.floor(100000000 + Math.random() * 900000000));
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
