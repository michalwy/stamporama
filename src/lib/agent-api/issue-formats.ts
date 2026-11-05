// A stamp's issue format through the agent API (#2445) — the pure half: how an agent names one, how
// it says *none*, how a filter of them is read, and the refusal for a name another one answers to.
//
// **An empty issue format is an ordinary stamp** (#2439): there is no "Stamp" row, as there is no
// "Single" copy format (ADR-0020). So the agent spells the empty value as a word of its own —
// `none` — in a filter (*the ordinary stamps*), in `update_stamps` (*make it an ordinary stamp
// again*), and nowhere else; `update_stamp` empties it through `clear`, as it empties every field.
// `none` is reserved for that: an issue format of that name or abbreviation is refused, since an
// agent could never name it.
//
// **It is the stamp's, never the copy's.** A copy's `format` is how the collector's piece was cut or
// kept — a single, a pair, a block of four — and a copy reads its stamp's issue format beside it, so
// a pair of stamps taken from a souvenir sheet reads `format: Pair`, `issueFormat: Stamp from a
// souvenir sheet`.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { ORDINARY_STAMP_ISSUE_FORMAT } from "../issue-format-filter";
import { TAG_COLORS } from "../tag-colors";
import { invalidRequest } from "./errors";
import { resolveVocabularyValue, type VocabularyEntry } from "./vocabulary";
import type { ParameterSpec } from "./types";

/** The word for *no issue format — an ordinary stamp*, in a filter and in a batch item. */
export const NO_ISSUE_FORMAT = "none";

/** The colours an issue format's chip may take — the palette's hues, as on the Settings panel. */
export const ISSUE_FORMAT_COLORS: readonly string[] = TAG_COLORS;

function isNone(value: string): boolean {
  return value.trim().toLocaleLowerCase() === NO_ISSUE_FORMAT;
}

/**
 * The issue format a write names: an id, or a name or abbreviation as the vocabulary resolver reads
 * one — or `none`, which is null, an ordinary stamp.
 */
export function resolveIssueFormatWrite(
  value: string,
  entries: readonly VocabularyEntry[],
  parameter: string
): string | null {
  if (isNone(value)) return null;
  return resolveVocabularyValue(value, entries, { vocabulary: "issue format", parameter });
}

/**
 * A filter's values as the lists' own filter takes them (#2440): each issue format's id, and `none`
 * as the ordinary-stamp value, ticked beside the others — so `["Souvenir sheet", "none"]` is the
 * souvenir sheets and the ordinary stamps together. Duplicates are folded.
 */
export function resolveIssueFormatFilter(
  values: readonly string[],
  entries: readonly VocabularyEntry[],
  parameter: string
): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    ids.add(isNone(value) ? ORDINARY_STAMP_ISSUE_FORMAT : resolveVocabularyValue(value, entries, { vocabulary: "issue format", parameter }));
  }
  return [...ids];
}

function fold(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Refuse a name or an abbreviation another issue format already answers to — by its name or by its
 * abbreviation, case and the spaces around it aside — because the resolver matches both, and two
 * issue formats answering to `Bl` would make every later call naming either ambiguous. The word
 * `none` is refused too: it is what the API calls an ordinary stamp. An issue format's own name and
 * abbreviation are never a clash with itself.
 */
export function assertIssueFormatWordsFree(
  formats: readonly { readonly id: string; readonly name: string; readonly abbreviation: string }[],
  words: { readonly name?: string; readonly abbreviation?: string },
  exceptId?: string
): void {
  for (const [field, word] of [
    ["name", words.name],
    ["abbreviation", words.abbreviation],
  ] as const) {
    if (word === undefined) continue;
    if (isNone(word)) {
      throw invalidRequest(
        `"${field}" cannot be "${NO_ISSUE_FORMAT}": that is what this API calls a stamp with no issue format — an ordinary stamp. Choose another ${field}.`
      );
    }
    const wanted = fold(word);
    const holder = formats.find(
      (row) => row.id !== exceptId && (fold(row.name) === wanted || fold(row.abbreviation) === wanted)
    );
    if (holder) {
      throw invalidRequest(
        `This collection already has an issue format answering to "${word.trim()}" — "${holder.name}" (${holder.abbreviation}), id "${holder.id}". Use it, or choose another ${field}.`,
        [holder.id]
      );
    }
  }
}

/**
 * The filter every stamp, copy and catalogue list takes (#2445), declared once so the three read it
 * the same way. `what` names the rows it narrows, for the sentence.
 */
export function issueFormatFilterParameter(what: string): ParameterSpec {
  return {
    name: "issue_format",
    in: "query",
    type: "string[]",
    required: false,
    description: `Restrict to ${what} in any of these issue formats — the form a stamp was issued in, by name, abbreviation or id from \`issueFormats\` in \`get_collection_vocabulary\` (\`Souvenir sheet\`, \`Bl\`) — or \`${NO_ISSUE_FORMAT}\` for the ordinary stamps, which have none. Several are any of them: \`Bl,${NO_ISSUE_FORMAT}\`. Not a copy's \`format\`, which is how a piece was cut or kept.`,
  };
}
