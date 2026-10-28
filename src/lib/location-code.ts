// A storage location's code (#2191), built per level since #2235: each location sets the code of
// its own level only, and its **full code** is its levels' codes joined with dots from the top down
// (`A.B.C.1`) — the way its path `Cabinet › Shelf › Stockbook` is joined from their names. So the
// full code follows the tree: a move, or a parent's new code, changes it at once for the location
// and everything under it. A level's code is any text without a dot, kept as typed, and unique
// among its siblings regardless of case, which is what keeps the full codes unique. It stands in
// for the path where the path is too long or too private to print (the packing list, #2192), and
// is never part of a ref. No React / Prisma, so the location dialog proposes the same code the
// server would write.
//
// **The generator has a twin in SQL**: `20261028120000_location_level_codes` gave every existing
// location its level code by this same rule, so a change here is a change to what that backfill
// *meant*, not to what it wrote.

/** What joins the levels' codes into a location's full code. Not allowed inside one. */
export const LOCATION_CODE_SEPARATOR = ".";

/** How a typed code is stored: trimmed, otherwise kept as typed. */
export function normalizeLocationCode(raw: string): string {
  return raw.trim();
}

/** What two sibling codes are compared by: `a` beside `A` is a clash. */
export function locationCodeKey(code: string): string {
  return normalizeLocationCode(code).toLowerCase();
}

/** Why a (normalized) level code cannot be saved, or null when it can. Uniqueness among the
 * siblings is {@link locationCodeSibling}'s. */
export function locationCodeProblem(code: string): string | null {
  if (code === "") return "Code is required.";
  if (code.includes(LOCATION_CODE_SEPARATOR)) {
    return "A code cannot contain a dot — the dot joins the levels' codes.";
  }
  return null;
}

/** The fields a full code is built from. Structural, like `LocationPathNode`, so a server read can
 * pass the columns it selected. */
export interface LocationCodeNode {
  id: string;
  code: string;
  parentId: string | null;
}

/** The full code (`A.B.C.1`) from the root location to `locationId`, or null when unknown (mirrors
 * `buildLocationPath`). */
export function buildLocationCode(
  locations: readonly LocationCodeNode[],
  locationId: string | null
): string | null {
  if (!locationId) return null;
  const byId = new Map(locations.map((l) => [l.id, l]));
  const codes: string[] = [];
  let current = byId.get(locationId);
  let depth = 0;
  while (current && depth < 50) {
    codes.unshift(current.code);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return codes.length > 0 ? codes.join(LOCATION_CODE_SEPARATOR) : null;
}

/** The full code a location would have with `code` under `parentId` — what the dialog shows while
 * the code, or the parent, is being changed. */
export function joinLocationCode(
  locations: readonly LocationCodeNode[],
  parentId: string | null,
  code: string
): string {
  const parent = buildLocationCode(locations, parentId);
  return parent === null ? code : `${parent}${LOCATION_CODE_SEPARATOR}${code}`;
}

/** The sibling under `parentId` already holding `code` (case aside), or undefined. `locations`
 * should not hold the location being saved. */
export function locationCodeSibling<T extends LocationCodeNode>(
  locations: readonly T[],
  parentId: string | null,
  code: string
): T | undefined {
  const key = locationCodeKey(code);
  return locations.find(
    (l) => (l.parentId ?? null) === (parentId ?? null) && locationCodeKey(l.code) === key
  );
}

// Polish (and German) letters folded onto the ASCII a suggested code is written in. The SQL twin
// uses `translate` with these same two strings.
const FOLD_FROM = "ąćęłńóśźżäöüĄĆĘŁŃÓŚŹŻÄÖÜ";
const FOLD_TO = "acelnoszzaouACELNOSZZAOU";

function fold(word: string): string {
  let out = "";
  for (const ch of word) {
    const i = FOLD_FROM.indexOf(ch);
    out += i >= 0 ? FOLD_TO[i] : ch;
  }
  return out.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The code a name would be given before any clash: the initial of its **last** word, which is the
 * word that tells a location from its siblings (`Klaser A` → `A`), or that word whole when it is a
 * number (`Szafa 1` → `1`); `L` when the last word has no letter or digit in it. */
export function locationCodeBase(name: string): string {
  const words = name.trim().split(/\s+/);
  const word = fold(words[words.length - 1] ?? "");
  const token = /^[0-9]+$/.test(word) ? word : word.slice(0, 1);
  return token === "" ? "L" : token;
}

/** The first of `A`, `A2`, `A3`… that no sibling holds. `siblingCodes` are the codes of the
 * locations that would share the new one's parent. */
export function suggestLocationCode(name: string, siblingCodes: Iterable<string>): string {
  const taken = new Set(Array.from(siblingCodes, locationCodeKey));
  const base = locationCodeBase(name);
  if (!taken.has(locationCodeKey(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(locationCodeKey(candidate))) return candidate;
  }
}
