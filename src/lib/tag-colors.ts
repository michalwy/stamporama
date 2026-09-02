/** The colour a dictionary entry can be given (#728) — today `StampCondition` and
 * `CertificateStatus`, both of which are drawn as chips on half the screens in the app.
 *
 * **A fixed vocabulary of hues, not a free colour.** The stored value is one of the keys below and
 * the chip is painted from `--color-tag-<hue>` / `-soft` / `-border`, which `globals.css` defines
 * twice — once for each theme — exactly as a disposition chip is painted. A stored hex would be a
 * single value asked to work on a white page and a near-black one, and half the picks a collector
 * would reach for cannot: mid-greys vanish on both, and anything bright enough to read on the dark
 * theme glares on the light one. Naming the hue instead lets the *theme* decide what that hue is
 * worth here, which is the same bargain every other colour in the app already makes.
 *
 * Pure — no Prisma, no React — because the seed, the server reads, the settings picker and every
 * chip all have to agree on the list. */

export const TAG_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
  "slate",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/** Membership test for untrusted input (form fields, rows written before this vocabulary). */
export function isTagColor(value: string | null | undefined): value is TagColor {
  return !!value && (TAG_COLORS as readonly string[]).includes(value);
}

/** Display name for the swatch's hover hint. The colour *is* the label everywhere else — a chip
 * says its abbreviation, not its hue — so this exists only where a swatch has to be named. */
export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  pink: "Pink",
  slate: "Slate",
};

/** The three custom properties a hue resolves to. Null — no colour chosen — resolves to the
 * neutral chip the app drew before #728, which is a real answer and not a missing one: a collector
 * who wants one condition to stand out wants the others quiet. */
export interface TagColorTokens {
  color: string;
  border: string;
  background: string;
}

export const NEUTRAL_TAG_TOKENS: TagColorTokens = {
  color: "var(--color-text-secondary)",
  border: "var(--color-border)",
  background: "var(--color-bg-page)",
};

export function tagColorTokens(color: string | null | undefined): TagColorTokens {
  if (!isTagColor(color)) return NEUTRAL_TAG_TOKENS;
  return {
    color: `var(--color-tag-${color})`,
    border: `var(--color-tag-${color}-border)`,
    background: `var(--color-tag-${color}-soft)`,
  };
}

/**
 * The hue to pre-select when a new entry is added: the first one nobody in this dictionary is
 * using, and — once every hue is taken — the one used least, by position, so the picker still
 * opens on something rather than on nothing.
 *
 * A new condition arriving grey would leave the collector to notice the colour field and pick,
 * which is the manual configuration #728 exists to avoid; offering a free hue costs one glance to
 * override and nothing to accept.
 */
export function nextTagColor(used: ReadonlyArray<string | null | undefined>): TagColor {
  const taken = new Set(used.filter(isTagColor));
  return TAG_COLORS.find((c) => !taken.has(c)) ?? TAG_COLORS[used.length % TAG_COLORS.length];
}
