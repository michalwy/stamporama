import { formatSizeMm, parseSizeMm, type StampSize } from "./stamp-size";

// The pure half of the stamp size presets' screens (#805, #806; ADR-0048) — how a preset reads, how
// the picker's filter matches one, when the fields beside it hold something worth saving, and how
// the apply dialog states its counts. `stamp-size-presets.ts` is `server-only` and touches Prisma, so
// none of this can live there and still be reached by a unit test (#861).

/** A preset as these rules need one — `StampSizePresetData` without the bookkeeping. */
export interface StampSizePresetLike extends StampSize {
  name: string | null;
}

/** `25 × 30 mm`, the pair a preset *is*. */
export function stampSizePresetPair(pair: StampSize): string {
  return `${formatSizeMm(pair.widthMm)} × ${formatSizeMm(pair.heightMm)} mm`;
}

/** `25 × 30 mm · Germania`, or plain `25 × 30 mm` — ADR-0048 §3's wording for a picker entry. The
 *  pair leads because it is the identity; a preset without a name is complete, not unlabelled. */
export function stampSizePresetLabel(preset: StampSizePresetLike): string {
  const pair = stampSizePresetPair(preset);
  return preset.name ? `${pair} · ${preset.name}` : pair;
}

const FIGURE = /^\d+(\.\d+)?$/;

/**
 * The picker's filter: every word of the query must match, a figure against the pair and anything
 * else against the name (#805: *"filtering on both the name and the figures"*).
 *
 * - A **figure matches as a prefix** of either dimension as the field shows it, so typing `2` narrows
 *   to the 2x-millimetre presets and `25` to 25 and 25.5 — the list shortens as the number is typed,
 *   which is what a filter over numbers has to do. A figure also matches inside the name, since
 *   *Germania 1900* is a name a collector may search by its year.
 * - The query is read **the way a size is written**: `25x30`, `25 × 30`, `25*30` and `25 30` are the
 *   same two figures, a comma is a decimal point (`parseSizeMm`'s rule, so `25,5` finds what the
 *   field would have stored), and a trailing `mm` is noise.
 * - The collector's dragged order is kept. A filter narrows the list; it never re-ranks it, or the
 *   order ADR-0048 keeps for muscle memory would be gone the moment anything is typed.
 */
export function filterStampSizePresets<T extends StampSizePresetLike>(
  presets: readonly T[],
  query: string
): T[] {
  const words = query
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/(\d)\s*[×x*]\s*(?=\d)/g, "$1 ")
    .replace(/(\d)mm\b/g, "$1")
    .split(/\s+/)
    .filter((w) => w !== "" && w !== "×" && w !== "x" && w !== "*" && w !== "mm");
  if (words.length === 0) return [...presets];
  return presets.filter((preset) => {
    const name = (preset.name ?? "").toLowerCase();
    const figures = [formatSizeMm(preset.widthMm), formatSizeMm(preset.heightMm)];
    return words.every((word) =>
      FIGURE.test(word)
        ? figures.some((f) => f.startsWith(word)) || name.includes(word)
        : name.includes(word)
    );
  });
}

/**
 * The pair the stamp form's two fields hold, or null when there is nothing a preset could be made of.
 *
 * Both must be present **and** readable (#805: *"enabled only when both fields hold a complete,
 * parseable size"*). Half a size is a state a stamp may be in; it is never a preset, and a figure the
 * form would refuse on save must not become one by the side door. `parseSizeMm` is the one grammar,
 * so what this accepts is exactly what the form would store — rounded to `SIZE_DECIMALS` the same way.
 */
export function sizePairFromFields(
  widthText: string | null | undefined,
  heightText: string | null | undefined
): StampSize | null {
  const width = parseSizeMm(widthText);
  const height = parseSizeMm(heightText);
  if (!width.ok || !height.ok || width.mm === null || height.mm === null) return null;
  return { widthMm: width.mm, heightMm: height.mm };
}

/** The counts `applyStampSizePreset` returns, as far as the wording needs them. */
export interface StampSizePresetApplyCounts extends StampSize {
  total: number;
  withoutSize: number;
  withStatedSize: number;
  withPartialSize: number;
}

function stamps(n: number): string {
  return n === 1 ? "1 stamp" : `${n} stamps`;
}

/**
 * What the apply dialog says before anything is written (ADR-0048 §6) — *17 stamps have no size and
 * will get 25 × 30 mm; 3 already state one* — and how many rows the write would touch.
 *
 * `willWrite` is the dialog's own count and the button's, and it is the same arithmetic the write
 * does: the sizeless always, the stated only with the box ticked. Deriving both from one function is
 * what keeps the number on the button the number the toast then reports.
 *
 * The half-stated stamps are named inside the stated sentence rather than as a line of their own,
 * because the write does not treat them apart (#803) — a stamp showing a width and no height is
 * skipped for the reason the others are, and the sentence says so, so its being left alone does not
 * read as a bug.
 */
export function describeStampSizePresetApply(
  counts: StampSizePresetApplyCounts,
  overwriteStated: boolean
): { willWrite: number; lines: string[] } {
  const pair = stampSizePresetPair(counts);
  const willWrite = counts.withoutSize + (overwriteStated ? counts.withStatedSize : 0);
  if (counts.total === 0) {
    return { willWrite: 0, lines: ["There are no stamps here to size."] };
  }

  const lines: string[] = [];
  lines.push(
    counts.withoutSize === 0
      ? "Every stamp here already states a size."
      : `${stamps(counts.withoutSize)} ${counts.withoutSize === 1 ? "has" : "have"} no size and will get ${pair}.`
  );

  const stated = counts.withStatedSize;
  if (stated > 0) {
    const partial = counts.withPartialSize;
    const which =
      partial === 0
        ? ""
        : stated === 1
          ? " (only a width or only a height)"
          : partial === stated
            ? " (each only a width or only a height)"
            : ` (${partial} of them only a width or only a height)`;
    const verb = stated === 1 ? "states" : "state";
    const fate = overwriteStated
      ? `will be overwritten with ${pair}`
      : stated === 1
        ? "will be left as it is"
        : "will be left as they are";
    lines.push(`${stamps(stated)} already ${verb} a size${which} and ${fate}.`);
  }
  return { willWrite, lines };
}

/** The toast after the write, from the counts the **write** returned — never the preview's, which
 *  may be a moment old. Info rather than success when nothing was written, since nothing happened. */
export function summarizeStampSizePresetApply(
  result: StampSizePresetApplyCounts & { written: number },
  overwriteStated: boolean
): { message: string; tone: "success" | "info" } {
  const pair = stampSizePresetPair(result);
  if (result.written === 0) {
    return { message: `Nothing was written — no stamp here was without a size`, tone: "info" };
  }
  const skipped = overwriteStated ? 0 : result.withStatedSize;
  const tail = skipped > 0 ? `; ${stamps(skipped)} that already stated one left as ${skipped === 1 ? "it was" : "they were"}` : "";
  return { message: `${pair} written to ${stamps(result.written)}${tail}`, tone: "success" };
}
