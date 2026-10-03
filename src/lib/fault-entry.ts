/**
 * Choosing a copy's faults in its edit dialog (#1557) — the rules the chip field and the save action
 * share.
 *
 * Pure, because the field decides what a typed name becomes as the collector types it and the server
 * has to reach the same answer when the dialog is saved: a client component cannot import
 * `faults.ts`, which is `server-only`.
 *
 * Shaped after the tag field (`tag-entry.ts`, #1192) with one difference that matters: **a fault's
 * name has spaces in it** (*Thinned gum*, *Hinge remnant*), so a space does not end a name the way
 * it ends a tag. A name is finished by picking it from the suggestions or by Enter.
 *
 * **A fault is born when the dialog is saved, never while it is typed.** A chip for a name the
 * dictionary does not hold is an entry with no `id`, and nothing is written until the copy's own save
 * carries it — so an abandoned dialog leaves no fault behind.
 */

/** One chip in the field. `id` null is a fault that does not exist yet and will be created on save. */
export interface FaultEntry {
  id: string | null;
  name: string;
}

/** The shape a dictionary row has to have to be matched against — `FaultSummary`, without importing
 *  the server module that declares it. */
interface DictionaryFault {
  id: string;
  name: string;
}

/**
 * The dictionary fault a name means, ignoring case — or null when there is none. An exact spelling
 * wins over a case-only match. Lower-casing rather than an accent-folding collation, for the tag
 * field's reason: `skaza` and `skaża` would be two different words.
 */
export function findFaultByName<T extends DictionaryFault>(
  dictionary: readonly T[],
  name: string
): T | null {
  const exact = dictionary.find((f) => f.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return dictionary.find((f) => f.name.toLowerCase() === lower) ?? null;
}

/**
 * Add one typed or picked name to the chips. A name the dictionary already holds, in any casing,
 * attaches **that** fault rather than a second one; a name already among the chips changes nothing;
 * anything else is a new fault.
 */
export function addFaultEntry(
  entries: readonly FaultEntry[],
  rawName: string,
  dictionary: readonly DictionaryFault[]
): FaultEntry[] {
  const name = rawName.trim();
  if (!name) return [...entries];
  const existing = findFaultByName(dictionary, name);
  if (existing) {
    if (entries.some((e) => e.id === existing.id)) return [...entries];
    return [...entries, { id: existing.id, name: existing.name }];
  }
  const lower = name.toLowerCase();
  if (entries.some((e) => e.name.toLowerCase() === lower)) return [...entries];
  return [...entries, { id: null, name }];
}

/**
 * The dictionary faults worth offering: not already chosen, name containing the text. **With no
 * text, every fault not yet chosen**, in the dictionary's own order — the list is short and set in
 * the order the collector checks a stamp in, so it is offered whole the way a multi-select would be.
 * With text, those whose name starts with it come first, and the dictionary order holds within each.
 */
export function suggestFaults<T extends DictionaryFault>(
  dictionary: readonly T[],
  query: string,
  entries: readonly FaultEntry[]
): T[] {
  const chosen = new Set(entries.map((e) => e.id).filter(Boolean));
  const open = dictionary.filter((f) => !chosen.has(f.id));
  const q = query.trim().toLowerCase();
  if (!q) return open;
  const matching = open.filter((f) => f.name.toLowerCase().includes(q));
  return [
    ...matching.filter((f) => f.name.toLowerCase().startsWith(q)),
    ...matching.filter((f) => !f.name.toLowerCase().startsWith(q)),
  ];
}

/**
 * The fault field's hidden input, read back by the save action.
 *
 * `undefined` means **the field was not submitted** and leaves the copy's faults alone — a different
 * answer from an empty list, which takes every fault off. Malformed JSON is also `undefined`, the
 * tag field's rule: a save is no place to fail over a field the collector cannot see. Entries are
 * resolved against the dictionary again on the server.
 */
export function parseFaultEntries(raw: FormDataEntryValue | null): FaultEntry[] | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return faultEntriesFrom(parsed);
}

/**
 * Fault chips as they arrive in a JSON argument rather than a form field — the run's per-tile faults
 * (#1558). The same reading as {@link parseFaultEntries}: anything that is not a list is
 * `undefined`, and an entry with neither an id nor a name is dropped.
 */
export function faultEntriesFrom(parsed: unknown): FaultEntry[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  const out: FaultEntry[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const { id, name } = row as Record<string, unknown>;
    const trimmed = typeof name === "string" ? name.trim() : "";
    const faultId = typeof id === "string" && id ? id : null;
    if (!faultId && !trimmed) continue;
    out.push({ id: faultId, name: trimmed });
  }
  return out;
}
