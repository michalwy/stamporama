// The four stamp-attribute dictionaries (#71/#72) — colour, watermark, paper, printing method — as
// one closed set, so the domain module, the actions and the Settings panel are written once and
// dispatch over a kind rather than existing four times. Pure: no Prisma, no React, no
// `server-only`, so the panel can read the labels and the domain module the kinds.

export const STAMP_ATTRIBUTE_KINDS = ["color", "watermark", "paper", "printing"] as const;

export type StampAttributeKind = (typeof STAMP_ATTRIBUTE_KINDS)[number];

/** How each dictionary is named on screen. `noun` is the thing a row is ("colour"), used in
 * buttons, dialog titles and error messages; `heading` heads its section on the Attributes tab;
 * `field` labels the one value a stamp has, on the stamp form and its detail card. */
export const STAMP_ATTRIBUTE_LABELS: Readonly<
  Record<
    StampAttributeKind,
    { noun: string; plural: string; heading: string; field: string; example: string }
  >
> = {
  color: {
    noun: "colour",
    plural: "colours",
    heading: "Colours",
    field: "Colour",
    example: "e.g. Carmine",
  },
  watermark: {
    noun: "watermark",
    plural: "watermarks",
    heading: "Watermarks",
    field: "Watermark",
    example: "e.g. Lozenges",
  },
  paper: {
    noun: "paper",
    plural: "papers",
    heading: "Papers",
    field: "Paper",
    example: "e.g. Thin paper",
  },
  printing: {
    noun: "printing method",
    plural: "printing methods",
    heading: "Printing methods",
    field: "Printing method",
    example: "e.g. Photogravure",
  },
};

export function isStampAttributeKind(value: unknown): value is StampAttributeKind {
  return typeof value === "string" && (STAMP_ATTRIBUTE_KINDS as readonly string[]).includes(value);
}

/** The two attributes that are **not** dictionaries (#71): printed facts about one stamp, stored as
 * printed and never translated. Named here beside the four kinds so the six read as one set
 * wherever they are entered or shown. */
export const STAMP_TEXT_ATTRIBUTES = ["denomination", "perforation"] as const;

export type StampTextAttribute = (typeof STAMP_TEXT_ATTRIBUTES)[number];

export const STAMP_TEXT_ATTRIBUTE_LABELS: Readonly<
  Record<StampTextAttribute, { field: string; example: string }>
> = {
  denomination: { field: "Denomination", example: "e.g. 10 gr" },
  perforation: { field: "Perforation", example: "e.g. 11½" },
};

/**
 * A stamp's six attributes resolved for **display** — the dictionary references already turned into
 * the names they point at. What every read model carries and every screen draws, so a row, a tree
 * node and a detail card cannot each resolve a `colorId` their own way. Null is the normal value.
 */
export interface StampAttributeLabels {
  denomination: string | null;
  perforation: string | null;
  color: string | null;
  watermark: string | null;
  paper: string | null;
  printing: string | null;
}

export const NO_STAMP_ATTRIBUTES: StampAttributeLabels = {
  denomination: null,
  perforation: null,
  color: null,
  watermark: null,
  paper: null,
  printing: null,
};

/** Display order and field label of the six, in one place: the form's fields, the detail card's
 * rows and the list line's values all walk this, so they cannot disagree about what an attribute is
 * called or where it comes in the reading. Denomination and perforation lead because they are what
 * a catalogue prints first. */
export const STAMP_ATTRIBUTE_FIELDS: readonly {
  key: keyof StampAttributeLabels;
  label: string;
}[] = [
  { key: "denomination", label: STAMP_TEXT_ATTRIBUTE_LABELS.denomination.field },
  { key: "perforation", label: STAMP_TEXT_ATTRIBUTE_LABELS.perforation.field },
  ...STAMP_ATTRIBUTE_KINDS.map((kind) => ({
    key: kind as keyof StampAttributeLabels,
    label: STAMP_ATTRIBUTE_LABELS[kind].field,
  })),
];

/** The attributes the stamp actually states, in display order — what a card lists and a row line
 * draws. Empty means the stamp states none, which is the case a caller omits itself for. */
export function statedStampAttributes(
  attributes: StampAttributeLabels | null | undefined
): { key: keyof StampAttributeLabels; label: string; value: string }[] {
  if (!attributes) return [];
  return STAMP_ATTRIBUTE_FIELDS.flatMap(({ key, label }) => {
    const value = attributes[key];
    return value ? [{ key, label, value }] : [];
  });
}

/**
 * The six as a write takes them (#736). `undefined` leaves the stored value untouched — the form
 * did not render that field, which is what a dictionary with no entries and a not-yet-loaded dialog
 * both look like — `null` clears it, a string sets it.
 */
export interface StampAttributeInput {
  denomination?: string | null;
  perforation?: string | null;
  colorId?: string | null;
  watermarkId?: string | null;
  paperId?: string | null;
  printingId?: string | null;
}

/** The six column names a write and a form both address them by. */
export const STAMP_ATTRIBUTE_INPUT_FIELDS = [
  ...STAMP_TEXT_ATTRIBUTES,
  ...STAMP_ATTRIBUTE_KINDS.map((kind) => `${kind}Id` as const),
] as const satisfies readonly (keyof StampAttributeInput)[];

/** The stamp form's six fields off a submitted `FormData` (#736), parsed once for both the add and
 * the edit action so the two cannot read the same form differently. A field the form did not render
 * is left out entirely rather than read as a blank. */
export function parseStampAttributes(formData: FormData): StampAttributeInput {
  const input: StampAttributeInput = {};
  for (const field of STAMP_ATTRIBUTE_INPUT_FIELDS) {
    if (!formData.has(field)) continue;
    input[field] = ((formData.get(field) as string | null) ?? "").trim() || null;
  }
  return input;
}

/** The subset of {@link StampAttributeInput} a caller actually supplied, as a Prisma `data` patch:
 * a key left `undefined` is dropped, so a write that does not manage the attributes cannot blank
 * them. The same rule `colnectId` follows on the stamp update. */
export function pickStampAttributeWrites(input: StampAttributeInput): StampAttributeInput {
  const writes: StampAttributeInput = {};
  for (const field of STAMP_ATTRIBUTE_INPUT_FIELDS) {
    if (input[field] !== undefined) writes[field] = input[field] || null;
  }
  return writes;
}

/** The list filters the four dictionaries get (#737), keyed the way the URL, the query hook and
 * `StampListFilterOpts` all name them. Denomination and perforation are absent on purpose: they are
 * free text and are matched by the list's own search box. */
export const STAMP_ATTRIBUTE_FILTER_KEYS = STAMP_ATTRIBUTE_KINDS.map(
  (kind) => `${kind}Ids` as const
);

export type StampAttributeFilterKey = (typeof STAMP_ATTRIBUTE_FILTER_KEYS)[number];

export type StampAttributeFilters = Partial<Record<StampAttributeFilterKey, string[]>>;

/** The four filters off a query string, each a comma-joined id list. An absent or empty param is
 * *no filter*, which is what an empty `MultiSelectFilter` selection means everywhere else. */
export function stampAttributeFiltersFromParams(
  sp: URLSearchParams | { get(key: string): string | null }
): StampAttributeFilters {
  const filters: StampAttributeFilters = {};
  for (const key of STAMP_ATTRIBUTE_FILTER_KEYS) {
    const ids = (sp.get(key) ?? "").split(",").filter(Boolean);
    if (ids.length > 0) filters[key] = ids;
  }
  return filters;
}
