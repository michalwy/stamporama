/**
 * Converts a display name into a URL-safe slug candidate.
 * "My First Collection" → "my-first-collection"
 */
export function nameToSlugBase(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
