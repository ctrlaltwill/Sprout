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
