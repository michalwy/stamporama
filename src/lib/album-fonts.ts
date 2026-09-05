// The faces an album template can choose from (#766) — the set the app ships and **embeds** (#768).
//
// Pure data, no Prisma and no rendering: the Settings panel offers this list, the PDF looks a face
// up in it, and the editor canvas (#769) previews with the same stack. One list, so a template
// cannot name a face the renderer does not have.
//
// ## Why a fixed set rather than a font name
//
// AlbumEasy writes `ALBUM_DEFINE_FONT(HEADER "Times New Roman")` and gets away with naming a system
// face because it runs on the collector's own desktop. This renders on a server. A free-text font
// name there produces a PDF that is right on one machine and wrong on the next — or, worse, right
// today and missing its diacritics after a container rebuild. So the template picks an id from
// here, and #768 embeds the bytes behind it.
//
// ## A face is a family *and* a style
//
// `ALBUM_DEFINE_FONT` names exactly that unit — `"Times New Roman"`, `"Arial Bold Italic"` — and the
// collector's existing sources use five of them across their five roles. Modelling this as a family
// plus per-role weight and style flags would invent a second axis the source material does not
// have, so a "face" here is one row: family + style, chosen from one select.
//
// ## Why these two families
//
// **Liberation** is metrically compatible with Times New Roman and Arial under the SIL OFL. That is
// not an aesthetic preference: roughly 200 of the collector's album pages are already printed,
// mounted and in binders, every one of them set in those two faces, and Stamporama's pages will be
// filed beside them. Liberation is the only candidate under which a new card does not read as
// having come from somewhere else.
//
// **Noto** is the alternative for an album that is not continuing an existing binder — one family
// across every role, and the broadest script coverage of the candidates.
//
// There is deliberately **no monospaced face.** The case for one would be aligning columns of
// catalog numbers, and it does not survive contact with the material: text faces already advance
// every digit equally (Arial 1139 units, Times New Roman 1024 — measured on the faces these
// replace), catalog numbers are not pure digits anyway (`303a`, `Blok 5A (306)`), and box labels are
// centred under boxes of differing widths, so there is no column anywhere on an album page. The one
// real column of figures in the whole design is the hawid cutting list (#770), and that is an HTML
// screen printed through the browser, which never touches these faces.
//
// Related constraint, worth knowing before someone reaches for it: **pdf-lib exposes no OpenType
// feature selection**, so `tnum` and friends are unreachable — a face's default figures are the
// figures you get. Harmless for both families here, but "we can switch on tabular figures later" is
// not an available move.

/** The families the app ships. `label` is what the select shows as the group. */
export const ALBUM_FONT_FAMILIES = [
  {
    key: "liberation-serif",
    label: "Liberation Serif",
    /** What it stands in for, said plainly — this is the whole reason the family is here. */
    note: "Metric match for Times New Roman",
    /** Browser preview stack (#769). The metric twin is named first so a machine that has it
     *  previews at the printed measure; the generic keyword is the floor. */
    cssStack: '"Liberation Serif", "Times New Roman", Times, serif',
  },
  {
    key: "liberation-sans",
    label: "Liberation Sans",
    note: "Metric match for Arial",
    cssStack: '"Liberation Sans", Arial, Helvetica, sans-serif',
  },
  {
    key: "liberation-sans-narrow",
    label: "Liberation Sans Narrow",
    note: "Metric match for Arial Narrow — for labels under narrow boxes",
    cssStack: '"Liberation Sans Narrow", "Arial Narrow", Arial, sans-serif',
  },
  { key: "noto-serif", label: "Noto Serif", note: null, cssStack: '"Noto Serif", Georgia, serif' },
  { key: "noto-sans", label: "Noto Sans", note: null, cssStack: '"Noto Sans", Arial, sans-serif' },
  {
    key: "noto-sans-condensed",
    label: "Noto Sans Condensed",
    note: "For labels under narrow boxes",
    cssStack: '"Noto Sans Condensed", "Noto Sans", Arial, sans-serif',
  },
] as const;

export type AlbumFontFamilyKey = (typeof ALBUM_FONT_FAMILIES)[number]["key"];

/** The four styles every family here ships. Ordered as a select should read them. */
export const ALBUM_FONT_STYLES = [
  { key: "regular", label: "Regular", bold: false, italic: false },
  { key: "bold", label: "Bold", bold: true, italic: false },
  { key: "italic", label: "Italic", bold: false, italic: true },
  { key: "bold-italic", label: "Bold Italic", bold: true, italic: true },
] as const;

export type AlbumFontStyleKey = (typeof ALBUM_FONT_STYLES)[number]["key"];

/** One face as a template names it: a family and a style, resolved to everything a caller needs. */
export interface AlbumFace {
  /** Stored on the template, e.g. `liberation-sans-bold-italic`. Regular carries no style suffix,
   *  so the ordinary case reads as the family alone. */
  id: string;
  family: AlbumFontFamilyKey;
  style: AlbumFontStyleKey;
  /** How the select and a summary line name it: `Liberation Sans Bold Italic`. */
  label: string;
  familyLabel: string;
  cssStack: string;
  bold: boolean;
  italic: boolean;
}

function faceId(family: AlbumFontFamilyKey, style: AlbumFontStyleKey): string {
  return style === "regular" ? family : `${family}-${style}`;
}

/** Every face the app ships: each family in each of the four styles, family order then style order,
 *  which is the order the select renders. */
export const ALBUM_FACES: readonly AlbumFace[] = ALBUM_FONT_FAMILIES.flatMap((family) =>
  ALBUM_FONT_STYLES.map((style) => ({
    id: faceId(family.key, style.key),
    family: family.key,
    style: style.key,
    label: style.key === "regular" ? family.label : `${family.label} ${style.label}`,
    familyLabel: family.label,
    cssStack: family.cssStack,
    bold: style.bold,
    italic: style.italic,
  }))
);

const FACES_BY_ID = new Map(ALBUM_FACES.map((f) => [f.id, f]));

/** Look a stored face id up. Returns null for an id this build does not ship — which a caller has
 *  to handle rather than assume away: a template written against a face that a later release drops
 *  must report that, not silently print in something else. */
export function findAlbumFace(id: string): AlbumFace | null {
  return FACES_BY_ID.get(id) ?? null;
}

/** Whether `id` names a face this build ships — what the template parser validates against. */
export function isAlbumFaceId(id: string): boolean {
  return FACES_BY_ID.has(id);
}

/** How a face is named in a row or a summary, falling back to the raw id so a face that is no
 *  longer shipped is visible as itself rather than as a blank. */
export function albumFaceLabel(id: string): string {
  return findAlbumFace(id)?.label ?? id;
}
