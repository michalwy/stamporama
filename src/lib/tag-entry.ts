import { isTagColor, nextTagColor, type TagColor } from "./tag-colors";

/**
 * Typing tags into an edit dialog (#1192) — the rules the chip field and the save actions share.
 *
 * Pure, because the field decides what a typed word becomes as the collector types it, and the
 * server has to reach the same answer when the dialog is saved: a client component cannot import
 * `tags.ts`, which is `server-only`.
 *
 * **A tag is born when the dialog is saved, never while it is typed.** A chip for a name nobody has
 * used yet is an entry with no `id`, and nothing is written until the thing's own save carries it —
 * so a dialog abandoned half-way leaves no tag behind that nothing carries.
 */

/** One chip in the field. `id` null is a tag that does not exist yet and will be created on save,
 *  in the colour the chip already shows. */
export interface TagEntry {
  id: string | null;
  name: string;
  color: TagColor | null;
}

/** The shape a dictionary row has to have to be matched against — `TagSummary`, without importing
 *  the server module that declares it. */
interface DictionaryTag {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Split what is in the text field into the names it commits and the word still being typed.
 *
 * **Space separates one tag from the next** (#1192), so every run of non-space characters followed
 * by a space is a finished name, and whatever follows the last space is not finished yet. A pasted
 * `birds  to-check ` commits both and leaves nothing behind.
 */
export function splitTagInput(text: string): { names: string[]; rest: string } {
  const parts = text.split(/\s/);
  const rest = parts.pop() ?? "";
  return { names: parts.filter((p) => p.length > 0), rest };
}

/**
 * The dictionary tag a name means, ignoring case — or null when there is none.
 *
 * An exact spelling wins over a case-only match, so a dictionary that already holds both `Birds` and
 * `birds` (the database index alone does not forbid it) still attaches the one the collector typed.
 * Lower-casing rather than a `base`-sensitivity collation, because that would also fold accents, and
 * `żółw` and `zolw` are two different words.
 */
export function findTagByName<T extends DictionaryTag>(dictionary: readonly T[], name: string): T | null {
  const exact = dictionary.find((t) => t.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return dictionary.find((t) => t.name.toLowerCase() === lower) ?? null;
}

/**
 * Add one typed name to the chips.
 *
 * A name the dictionary already holds, in any casing, attaches **that** tag rather than a second one
 * — without this every typo would become a near-duplicate that only shows up much later. A name
 * already among the chips, existing or new, changes nothing. Anything else is a new tag, coloured
 * at once from the palette with the first hue neither the dictionary nor the other new chips are
 * using (`nextTagColor`, the colour Settings would have offered).
 */
export function addTagEntry(
  entries: readonly TagEntry[],
  rawName: string,
  dictionary: readonly DictionaryTag[]
): TagEntry[] {
  const name = rawName.trim();
  if (!name) return [...entries];
  const existing = findTagByName(dictionary, name);
  if (existing) {
    if (entries.some((e) => e.id === existing.id)) return [...entries];
    const color = isTagColor(existing.color) ? existing.color : null;
    return [...entries, { id: existing.id, name: existing.name, color }];
  }
  const lower = name.toLowerCase();
  if (entries.some((e) => e.name.toLowerCase() === lower)) return [...entries];
  const color = nextTagColor([
    ...dictionary.map((t) => t.color),
    ...entries.filter((e) => e.id === null).map((e) => e.color),
  ]);
  return [...entries, { id: null, name, color }];
}

/** Every name the text commits, and the unfinished word as well — what a Save carries when the
 *  collector typed a last name and pressed Save without a space after it. */
export function commitTagInput(
  entries: readonly TagEntry[],
  text: string,
  dictionary: readonly DictionaryTag[]
): TagEntry[] {
  const { names, rest } = splitTagInput(text);
  return [...names, rest].reduce<TagEntry[]>((acc, n) => addTagEntry(acc, n, dictionary), [
    ...entries,
  ]);
}

/**
 * The dictionary tags worth offering for what is being typed: not already on the thing, name
 * containing the text, those that **start** with it first, then alphabetical.
 *
 * This is also the only way to reach a tag whose name carries a space — the field cannot type one —
 * so a match anywhere in the name counts, not just at its start.
 */
export function suggestTags<T extends DictionaryTag>(
  dictionary: readonly T[],
  query: string,
  entries: readonly TagEntry[],
  limit = 8
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const chosen = new Set(entries.map((e) => e.id).filter(Boolean));
  return dictionary
    .filter((t) => !chosen.has(t.id) && t.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .slice(0, limit);
}

/**
 * The tag field's hidden input, read back by a save action.
 *
 * `undefined` means **the field was not submitted** — a caller that does not render it, or a stamp
 * whose stored tags had not loaded yet — and leaves the thing's tags alone; that is a different
 * answer from an empty list, which takes every tag off. Malformed JSON is also `undefined`, the
 * rule `parseItemStamps` follows: a save is no place to fail over a field the collector cannot see.
 * Entries are re-validated here and resolved against the dictionary again on the server.
 */
export function parseTagEntries(raw: FormDataEntryValue | null): TagEntry[] | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const out: TagEntry[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const { id, name, color } = row as Record<string, unknown>;
    const trimmed = typeof name === "string" ? name.trim() : "";
    const tagId = typeof id === "string" && id ? id : null;
    if (!tagId && !trimmed) continue;
    out.push({ id: tagId, name: trimmed, color: typeof color === "string" && isTagColor(color) ? color : null });
  }
  return out;
}
