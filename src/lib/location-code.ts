// A storage location's short code (#2191): a label of up to six letters and digits that stands in
// for the location's whole path wherever the path is too long or too private to print (the packing
// list, #2192). Unique within the collection and stable — moving or renaming a location keeps it,
// and only the collector changes it. Never part of a ref: `A503` is written on the card, the code is
// not. No React / Prisma, so the Add-location dialog proposes the same code the server would write.
//
// **The generator has a twin in SQL**: `20261026120000_location_codes` gave every existing location
// its code by this same rule, so a change here is a change to what that backfill *meant*, not to
// what it wrote.

export const LOCATION_CODE_MAX_LENGTH = 6;

const CODE_PATTERN = /^[A-Z0-9]+$/;

/** How a typed code is stored: trimmed and upper-cased, which is what makes `abx` and `ABX` the
 * same code to the unique index. */
export function normalizeLocationCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Why a (normalized) code cannot be saved, or null when it can. Uniqueness is the server's. */
export function locationCodeProblem(code: string): string | null {
  if (code === "") return "Code is required.";
  if (code.length > LOCATION_CODE_MAX_LENGTH) {
    return `A code is at most ${LOCATION_CODE_MAX_LENGTH} characters.`;
  }
  if (!CODE_PATTERN.test(code)) return "A code is letters and digits only.";
  return null;
}

// Polish (and German) letters folded onto the ASCII a code is written in. The SQL twin uses
// `translate` with these same two strings.
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

/** One level of the path's contribution: the initial of the name's **last** word, which is the word
 * that tells a location from its siblings (`Klaser A`, `Szafa 1`), or that word whole when it is a
 * number. Empty when the last word has no letter or digit in it. */
function levelToken(name: string): string {
  const words = name.trim().split(/\s+/);
  const word = fold(words[words.length - 1] ?? "");
  return /^[0-9]+$/.test(word) ? word : word.slice(0, 1);
}

function keepEnd(text: string, length: number): string {
  return text.slice(Math.max(0, text.length - length));
}

/** The code a path would be given before any clash: its levels' tokens root to leaf
 * (`Segment A › Shelf B › Stockbook X` → `ABX`), the leaf end kept when that runs past six. */
export function locationCodeBase(pathNames: readonly string[]): string {
  const base = keepEnd(pathNames.map(levelToken).join(""), LOCATION_CODE_MAX_LENGTH);
  return base === "" ? "L" : base;
}

/** The first of `ABX`, `ABX2`, `ABX3`… not already taken in the collection; the base gives up its
 * front characters so the number still fits in six. `taken` holds normalized codes. */
export function suggestLocationCode(
  pathNames: readonly string[],
  taken: ReadonlySet<string>
): string {
  const base = locationCodeBase(pathNames);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const candidate = keepEnd(base, LOCATION_CODE_MAX_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The names from the root down to a location that would sit under `parentId` with `name` — the
 * path a code is built from, for a location that may not exist yet. */
export function locationPathNames(
  locations: readonly { id: string; name: string; parentId: string | null }[],
  parentId: string | null,
  name: string
): string[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const names = [name];
  let current = parentId ? byId.get(parentId) : undefined;
  let depth = 0;
  while (current && depth < 50) {
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return names;
}
