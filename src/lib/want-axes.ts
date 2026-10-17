// What would satisfy a want, as words (#532) — one rule for every screen that states it: the stamp
// page's Wants card and the phone stamp screen (#2003). Pure, so the unit suite holds it and a
// server page can use it as well as a client card.

/** The collection's own names for the three axes a want is stated on. */
export interface WantAxisDictionaries {
  conditions: readonly { id: string; name: string; abbreviation: string }[];
  certificateStatuses: readonly { id: string; name: string }[];
  formats: readonly { id: string; name: string }[];
}

/** One axis as text: the members joined, or `anyLabel` when the set is empty — the want list row's
 *  own rule, so a want reads the same on every screen. An empty axis says "any" out loud, because a
 *  blank one and an unanswered one look identical and mean opposite things (ADR-0032 §1). */
function axisText(
  ids: readonly (string | null)[],
  nameFor: (id: string | null) => string,
  anyLabel: string
): string {
  return ids.length === 0 ? anyLabel : ids.map(nameFor).join(", ");
}

/** A want's three acceptance sets, each as the words a chip prints. `null` is each axis's own
 *  "none" value — *No certificate*, *Single* — never "any" (ADR-0032 §3). */
export function wantAxisTexts(
  want: {
    conditionIds: readonly string[];
    certificateStatusIds: readonly (string | null)[];
    formatIds: readonly (string | null)[];
  },
  dictionaries: WantAxisDictionaries
): { condition: string; certificate: string; format: string } {
  const condition = (id: string | null) => {
    const c = dictionaries.conditions.find((x) => x.id === id);
    return c ? c.abbreviation || c.name : "?";
  };
  const certificate = (id: string | null) =>
    id === null
      ? "No certificate"
      : (dictionaries.certificateStatuses.find((c) => c.id === id)?.name ?? "?");
  const format = (id: string | null) =>
    id === null ? "Single" : (dictionaries.formats.find((f) => f.id === id)?.name ?? "?");
  return {
    condition: axisText(want.conditionIds, condition, "Any condition"),
    certificate: axisText(want.certificateStatusIds, certificate, "Certificate: any"),
    format: axisText(want.formatIds, format, "Any format"),
  };
}
