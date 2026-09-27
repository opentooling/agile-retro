/**
 * Tags are stored as one comma-separated string per board, so the distinct
 * tags across a set of boards have to be worked out here rather than in SQL —
 * the same way both backends do it, so their suggestions cannot drift apart.
 */
export function splitTags(tagStrings: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const line of tagStrings) {
    for (const raw of (line ?? "").split(",")) {
      const tag = raw.trim();
      if (tag) seen.add(tag);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
