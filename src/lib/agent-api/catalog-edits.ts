// The pure half of the catalogue writes (#1438): how an agent spells a catalogue's numbers and a
// translated name, the year and date bounds the collector's forms apply, and the refusal a duplicate
// catalogue number earns.
//
// **Per-catalogue and per-language values are `"key: value"` entries in a string list**, because the
// parameter types on this surface are scalars and string lists and nothing richer (#706). `"Mi:
// 100-105"` is how a person would write it anyway, and it is split on the **first** colon only, so a
// value may carry colons of its own.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { normalizeLanguage } from "../languages";
import { invalidRequest, type ApiError } from "./errors";

/** One `"key: value"` entry, split. */
export interface KeyedEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * Split `"key: value"` entries, refusing one with no colon, an empty side, or a key named twice.
 * `what` names the key in the refusal — *catalogue*, *language*.
 */
export function parseKeyedEntries(
  entries: readonly string[],
  parameter: string,
  what: string,
  example: string
): KeyedEntry[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    const colon = entry.indexOf(":");
    const key = colon < 0 ? "" : entry.slice(0, colon).trim();
    const value = colon < 0 ? "" : entry.slice(colon + 1).trim();
    if (!key || !value) {
      throw invalidRequest(
        `"${parameter}" entry "${entry}" is not "${what}: value". Write each as \`${example}\` and retry.`
      );
    }
    const folded = key.toLocaleLowerCase();
    if (seen.has(folded)) {
      throw invalidRequest(
        `"${parameter}" names the ${what} "${key}" twice. Send one entry per ${what}.`
      );
    }
    seen.add(folded);
    return { key, value };
  });
}

/**
 * Translated names, `"pl: Nazwa"`, keyed by normalised language code. Only the languages the
 * collection keeps translations in are accepted — the languages its forms offer an input for
 * (#293, #777) — and never its default language, whose text is the plain `name`.
 */
export function parseTranslatedNames(
  entries: readonly string[],
  parameter: string,
  languages: readonly string[],
  defaultLanguage: string
): Map<string, string> {
  const names = new Map<string, string>();
  for (const { key, value } of parseKeyedEntries(entries, parameter, "language", "pl: Znaczki")) {
    const language = checkTranslationLanguage(key, parameter, languages, defaultLanguage);
    if (names.has(language)) {
      throw invalidRequest(`"${parameter}" names the language "${language}" twice. Send one entry per language.`);
    }
    names.set(language, value);
  }
  return names;
}

/** A language code this collection keeps translations in, normalised, or a refusal saying which are. */
export function checkTranslationLanguage(
  raw: string,
  parameter: string,
  languages: readonly string[],
  defaultLanguage: string
): string {
  const language = normalizeLanguage(raw) ?? "";
  if (language === defaultLanguage) {
    throw invalidRequest(
      `"${language}" is this collection's own language, so a name in it is the plain "name" rather than a translation. Send it as "name".`
    );
  }
  if (!languages.includes(language)) {
    throw invalidRequest(
      languages.length === 0
        ? `This collection keeps no translations: it lists and prints in its own language only, so "${parameter}" cannot be used. Send the name as "name".`
        : `"${raw}" is not a language this collection keeps translations in. Use one of the accepted codes.`,
      languages
    );
  }
  return language;
}

/** The years the collector's forms accept (the issue form, the stamp form). */
export const YEAR_MIN = 1840;
export const YEAR_MAX = 2100;

/** Refuse a year, month or day the collector's own forms would refuse, in their bounds. */
export function checkDatePart(
  value: number,
  parameter: string,
  part: "year" | "month" | "day"
): number {
  const [min, max] = part === "year" ? [YEAR_MIN, YEAR_MAX] : part === "month" ? [1, 12] : [1, 31];
  if (value < min || value > max) {
    throw invalidRequest(`"${parameter}" must be between ${min} and ${max}; ${value} is outside it.`);
  }
  return value;
}

/** One existing stamp a duplicate catalogue number already belongs to. */
export interface DuplicateHolder {
  readonly stampId: string;
  readonly name: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
}

/** One catalogue identity (`Mi·PL 200`) already held, with who holds it. */
export interface DuplicateIdentity {
  readonly label: string;
  readonly stamps: readonly DuplicateHolder[];
}

function describeHolder(stamp: DuplicateHolder): string {
  const series = [stamp.issueName, stamp.issueYear].filter((part) => part !== null && part !== "").join(", ");
  const name = stamp.name ? `"${stamp.name}"` : "a stamp";
  return `${name}${series ? ` in ${series}` : ""} (id ${stamp.stampId})`;
}

/**
 * The refusal for catalogue numbers that already exist in this catalogue under the same prefix —
 * the catalogue identity duplicate detection and the resolver both compare (#85, #1037). **It is
 * refused whatever the collection's duplicate setting says**: the setting decides what a person
 * typing into a form is allowed to override, and an agent that could have found the stamp with
 * `resolve_catalog_numbers` has no business creating a second one. The existing stamps' ids are in
 * `accepted`, so the agent can edit the one that is there instead.
 */
export function duplicateCatalogNumbers(groups: readonly DuplicateIdentity[]): ApiError {
  const held = groups.filter((group) => group.stamps.length > 0);
  const lines = held.map(
    (group) => `${group.label} is already ${group.stamps.map(describeHolder).join(" and ")}`
  );
  return invalidRequest(
    `${lines.join("; ")}. Nothing was written. A catalogue number names one stamp here, so use the stamp that has it — \`get_stamp\` with its id — or correct the number.`,
    [...new Set(held.flatMap((group) => group.stamps.map((stamp) => stamp.stampId)))]
  );
}
