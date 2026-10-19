// The order a photo list is drawn in — front, back, then the extras by their own order — and the
// roles it ranks. Pure, so a pure module can rank photos too (the phone's thumbnail rule, #2075);
// `photos.ts` re-exports both for its many callers.

/** Reserved single-image slots plus the null "extra" role. Copies use `front` / `back`; stamps
 * (#137) use a single `main` slot instead. Each is a singleton per owner (partial-unique on
 * `(owner, role)`); which slots an owner actually uses is a UI concern. */
export type PhotoRole = "front" | "back" | "main" | null;

const VALID_ROLES = new Set(["front", "back", "main"]);

export function normalizeRole(role: unknown): PhotoRole {
  return typeof role === "string" && VALID_ROLES.has(role)
    ? (role as PhotoRole)
    : null;
}

const ROLE_ORDER: Record<string, number> = { main: 0, front: 0, back: 1 };

/** Shared front→back→extras(by sortOrder) ordering for photo lists. */
export function sortPhotos(
  a: { role: PhotoRole; sortOrder: number },
  b: { role: PhotoRole; sortOrder: number }
): number {
  const ra = a.role ? ROLE_ORDER[a.role] : 2;
  const rb = b.role ? ROLE_ORDER[b.role] : 2;
  if (ra !== rb) return ra - rb;
  return a.sortOrder - b.sortOrder;
}
