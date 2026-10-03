// Stamp sizes and size presets through the agent API (#1415) — the pure half: how a figure is read,
// how a preset and a stamp's size are stated, how an apply is reported, and how a stamp named by a
// catalogue number that does not name exactly one stamp is refused.
//
// **A size is stated or it is inherited, and nothing records how a stated one was obtained.** #1415
// was written expecting a third source — *measured at a scale* — and the schema has none: #763 refused
// a *measured* flag and ADR-0048 §1 a preset reference, so a figure measured with the ruler, applied
// from a preset or typed on the form is the same two columns. So a read says `stated`, `inherited`
// (a checklist neighbour's figure, resolved at read time exactly as an album page resolves it) or
// `none`, and a figure the assistant writes is an ordinary stated size — which is what *recorded as
// typed, never as measured* comes to when there is nothing to record it in.
//
// Pure: no Prisma, no `server-only` (`agent-api.md`, *The module layout is the Prisma-free split*).

import { compact } from "./collection-reads";
import { invalidRequest, type ApiError } from "./errors";
import { MAX_SIZE_MM, MIN_SIZE_MM, resolveStampSize, type StampSizeEntry, type StampSizeFields } from "../stamp-size";
import {
  describeStampSizePresetApply,
  stampSizePresetLabel,
  stampSizePresetPair,
  type StampSizePresetApplyCounts,
} from "../stamp-size-preset-rules";
import type { AgentCatalogResolution } from "./catalog-resolve";

// ── Figures ────────────────────────────────────────────────────────────────

/**
 * One dimension as the agent sent it: millimetres, **to a tenth at most**, as a string — `"21.5"`.
 *
 * `parseSizeMm` is the form's grammar and it rounds a second decimal away; this refuses one instead,
 * which is the surface's own convention for amounts (#1390): a figure rounded behind the agent's back
 * is a figure it will report as written when it was not. The bounds are the form's, so what this
 * accepts is exactly what the form would store. A comma is read as a decimal point, as the form reads
 * one — a catalogue printed in the collector's locale writes `21,5`.
 */
export function parseAgentSizeMm(value: string, parameter: string): number {
  const text = value.trim().replace(",", ".");
  const mm = /^\d+(\.\d)?$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(mm) || mm < MIN_SIZE_MM || mm > MAX_SIZE_MM) {
    throw invalidRequest(
      `"${parameter}" must be a figure in millimetres between ${MIN_SIZE_MM} and ${MAX_SIZE_MM}, to a tenth at most, sent as a string: "21.5". "${value}" is not one.`
    );
  }
  return mm;
}

// ── Presets ────────────────────────────────────────────────────────────────

/** A preset as the Settings panel and the picker read one. */
export interface SizePresetRow {
  readonly id: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly name: string | null;
}

export interface AgentSizePreset {
  readonly presetId: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly name?: string;
  /** `25 × 30 mm · Germania`, the picker's own wording — what to say to the collector. */
  readonly label: string;
}

export function sizePreset(row: SizePresetRow): AgentSizePreset {
  return compact({
    presetId: row.id,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    name: row.name ?? undefined,
    label: stampSizePresetLabel(row),
  }) as AgentSizePreset;
}

/**
 * What a preset answers to when the agent names it: its id, its name, or its label. An unnamed preset
 * answers to its pair — `25 × 30 mm` — because that is all it is called anywhere in the app.
 */
export function presetVocabularyEntry(row: SizePresetRow): { id: string; name: string; label: string } {
  return { id: row.id, name: row.name ?? stampSizePresetPair(row), label: stampSizePresetLabel(row) };
}

// ── A stamp's size ─────────────────────────────────────────────────────────

/** A checklist the stamp is on, with every stamp on it **in catalog sort order** — the press run the
 *  inheritance is reckoned along (#763). */
export interface SizeChecklist {
  readonly checklistId: string;
  readonly name: string;
  readonly entries: readonly StampSizeEntry[];
}

export interface AgentInheritedSize {
  readonly checklistId: string;
  readonly checklist: string;
  readonly widthMm: number;
  readonly heightMm: number;
  /** The stamp on that checklist the figure is borrowed from. */
  readonly fromStampId: string;
  readonly fromCatalogNumber?: string;
}

export type AgentSizeSource = "stated" | "inherited" | "none";

export interface AgentStampSize {
  readonly stampId: string;
  readonly stampNo: number;
  readonly catalogNumbers: readonly string[];
  readonly name?: string;
  readonly source: AgentSizeSource;
  /** The stamp's **own** figures, either of which may stand alone. */
  readonly widthMm?: number;
  readonly heightMm?: number;
  /** One per checklist that lends it a size; only when the stamp does not state a whole one. */
  readonly inherited?: readonly AgentInheritedSize[];
  readonly path: string;
}

/**
 * Where a stamp's size comes from.
 *
 * `stated` only when **both** figures are the stamp's own — half a size is not a size (#763): an album
 * box needs both, so a stamp holding only a width resolves through its checklist the same as one
 * holding nothing, and it is reported that way, its half figure beside the answer.
 *
 * **Every checklist is answered, not one.** An album entry is a checklist and resolves inside it, so a
 * stamp on two checklists can borrow two different figures and each is what one album page draws.
 * Picking one here would be this surface inventing a rule the album does not have.
 */
export function stampSizeReading(
  stamp: {
    readonly stampId: string;
    readonly stampNo: number;
    readonly catalogNumbers: readonly string[];
    readonly name: string | null;
    readonly path: string;
  },
  own: StampSizeFields,
  checklists: readonly SizeChecklist[],
  catalogNumberOf: (stampId: string) => string | undefined
): AgentStampSize {
  const whole = own.widthMm !== null && own.heightMm !== null;
  const inherited: AgentInheritedSize[] = [];
  if (!whole) {
    for (const checklist of checklists) {
      const resolved = resolveStampSize(checklist.entries, stamp.stampId);
      if (!resolved || resolved.source !== "inherited") continue;
      inherited.push(
        compact({
          checklistId: checklist.checklistId,
          checklist: checklist.name,
          widthMm: resolved.widthMm,
          heightMm: resolved.heightMm,
          fromStampId: resolved.fromStampId,
          fromCatalogNumber: catalogNumberOf(resolved.fromStampId),
        }) as AgentInheritedSize
      );
    }
  }
  return compact({
    stampId: stamp.stampId,
    stampNo: stamp.stampNo,
    catalogNumbers: [...stamp.catalogNumbers],
    name: stamp.name ?? undefined,
    source: whole ? "stated" : inherited.length > 0 ? "inherited" : "none",
    widthMm: own.widthMm ?? undefined,
    heightMm: own.heightMm ?? undefined,
    inherited: inherited.length > 0 ? inherited : undefined,
    path: stamp.path,
  }) as AgentStampSize;
}

// ── Applying ───────────────────────────────────────────────────────────────

export interface AgentSizeApply {
  readonly widthMm: number;
  readonly heightMm: number;
  /** The preset's label, when a preset was named rather than a size typed. */
  readonly preset?: string;
  /** Every stamp the subject reaches, variant descendants at any depth included. */
  readonly total: number;
  readonly withoutSize: number;
  /** Stamps stating at least one figure; left alone unless `overwrite` was sent. */
  readonly withStatedSize: number;
  /** How many of `withStatedSize` state only one of the two figures. */
  readonly withPartialSize: number;
  readonly overwrite: boolean;
  /** On a preview: how many rows the apply would write. */
  readonly willWrite?: number;
  /** On an apply: how many rows were written. */
  readonly written?: number;
  /** The apply dialog's own sentences, to say to the collector as they are. */
  readonly summary: readonly string[];
}

/**
 * The counts, stated. **The same arithmetic the apply dialog shows** (`describeStampSizePresetApply`),
 * so the figure a preview promises is the figure the collector's own dialog would have promised, and
 * an apply's `written` is read off the write rather than the preview — the state may have moved.
 */
export function sizeApply(
  counts: StampSizePresetApplyCounts & { readonly written: number },
  options: { readonly overwrite: boolean; readonly preview: boolean; readonly preset?: string }
): AgentSizeApply {
  const described = describeStampSizePresetApply(counts, options.overwrite);
  return compact({
    widthMm: counts.widthMm,
    heightMm: counts.heightMm,
    preset: options.preset,
    total: counts.total,
    withoutSize: counts.withoutSize,
    withStatedSize: counts.withStatedSize,
    withPartialSize: counts.withPartialSize,
    overwrite: options.overwrite,
    willWrite: options.preview ? described.willWrite : undefined,
    written: options.preview ? undefined : counts.written,
    summary: described.lines,
  }) as AgentSizeApply;
}

// ── Naming stamps ──────────────────────────────────────────────────────────

/** How many unresolved strings a refusal spells out before it stops listing. */
export const MAX_REFUSED_STAMPS = 10;

/**
 * The refusal for stamps named by catalogue number that did not each name exactly one stamp.
 *
 * **Never a guess** (#1037): an ambiguous number is answered with its candidates — their own catalogue
 * numbers in the sentence, their ids in `accepted` — and nothing is written, because a size put on the
 * wrong stamp is a hawid cut to it. **One refusal for the whole batch**, naming every string that
 * failed, so a list of forty with three bad entries is corrected in one turn rather than three.
 */
export function unresolvedStamps(
  failures: readonly AgentCatalogResolution[],
  parameter: string
): ApiError {
  const shown = failures.slice(0, MAX_REFUSED_STAMPS).map((failure) => {
    if (failure.verdict === "ambiguous") {
      const candidates = failure.stamps.map((stamp) => `${stamp.matchedNumber} (${stamp.stampId})`);
      return `"${failure.input}" matches ${failure.stamps.length} stamps: ${candidates.join(", ")}`;
    }
    if (failure.verdict === "unknown_vendor") {
      const kept = failure.acceptedVendors?.join(", ") || "none";
      return `"${failure.input}" names a catalogue this collection does not keep (catalogues kept: ${kept})`;
    }
    return `"${failure.input}" is no stamp id and no catalogue number of a stamp in this collection`;
  });
  const more = failures.length > shown.length ? `; and ${failures.length - shown.length} more` : "";
  const candidateIds = failures
    .filter((failure) => failure.verdict === "ambiguous")
    .flatMap((failure) => failure.stamps.map((stamp) => stamp.stampId));
  return invalidRequest(
    `Every entry in "${parameter}" must name exactly one stamp, and nothing was read or written: ${shown.join("; ")}${more}. Send the id of the stamp you mean, or a catalogue number that names only it — \`resolve_catalog_numbers\` shows what a number reaches.`,
    candidateIds.length > 0 ? candidateIds : undefined
  );
}
