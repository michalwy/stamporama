// The pure half of translating the collection's texts through the agent API (#1452): how one
// translatable text is named, how a write is spelled, and what the two operations answer.
//
// **A text is named by a key the agent is handed and sends back** — `issue.name.<id>`,
// `condition.abbreviation.<id>` — rather than by three parameters, because a write is a batch and the
// parameter types on this surface are scalars and string lists and nothing richer (#706). The key is
// the kind, the field and the row, so it is everything `saveEntityTranslation` needs and nothing an
// agent has to look up. A write is then one `"key: text"` entry per text, the catalogue writes'
// spelling (#1438), split on the **first** colon, which a key never contains.
//
// **The kinds are exactly the app's translatable texts** (`TRANSLATABLE_ENTITY_FIELDS`), under the
// snake_case names this surface uses. Nothing becomes translatable here that is not in the app.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { normalizeLanguage } from "../languages";
import { TRANSLATABLE_ENTITY_FIELDS, type TranslatableEntity } from "../translations";
import { invalidRequest, type ApiError } from "./errors";
import { parseKeyedEntries } from "./catalog-edits";

/**
 * The language asked about, normalised — one of the collection's translation languages (#293, #777):
 * those its platforms list in and its albums print in, less its own. Any other is refused with the
 * ones there are, and the collection's own is refused for what it is: its texts are written in it.
 */
export function checkCollectionLanguage(
  raw: string,
  languages: readonly string[],
  defaultLanguage: string
): string {
  const language = normalizeLanguage(raw) ?? "";
  if (language === defaultLanguage) {
    throw invalidRequest(
      `"${language}" is this collection's own language: its texts are written in it, so none is missing a translation into it. Use one of the accepted codes.`,
      languages
    );
  }
  if (!languages.includes(language)) {
    throw invalidRequest(
      languages.length === 0
        ? "This collection lists and prints in its own language only, so it keeps no translations. A language becomes one when a platform lists in it or an album prints in it — both are the collector's to set up in the app."
        : `"${raw}" is not a language this collection lists or prints in, so it keeps no translations into it. Use one of the accepted codes.`,
      languages
    );
  }
  return language;
}

/** The kinds of text an agent can translate, in the order a listing of gaps reaches them: the
 *  names that head album pages and titles first, then the stamps, then the collection's own terms. */
export const TRANSLATION_KINDS = [
  "area",
  "issue",
  "checklist",
  "stamp",
  "condition",
  "certificate_status",
  "format",
  "subtype",
  "color",
  "watermark",
  "paper",
  "printing",
] as const;

export type TranslationKind = (typeof TRANSLATION_KINDS)[number];

const ENTITY_BY_KIND: Readonly<Record<TranslationKind, TranslatableEntity>> = {
  area: "area",
  issue: "issue",
  checklist: "checklist",
  stamp: "stamp",
  condition: "condition",
  certificate_status: "certificateStatus",
  format: "format",
  subtype: "subtype",
  color: "color",
  watermark: "watermark",
  paper: "paper",
  printing: "printing",
};

const KIND_BY_ENTITY = Object.fromEntries(
  Object.entries(ENTITY_BY_KIND).map(([kind, entity]) => [entity, kind])
) as Readonly<Record<TranslatableEntity, TranslationKind>>;

/** The app's entity behind a kind. */
export function translationEntity(kind: TranslationKind): TranslatableEntity {
  return ENTITY_BY_KIND[kind];
}

/** The kinds that belong to an area, and so survive narrowing to one. The collection's own terms —
 *  conditions, formats, the attribute lists — belong to no area. */
export const AREA_BOUND_KINDS: ReadonlySet<TranslationKind> = new Set(["area", "issue", "checklist", "stamp"]);

/** The entity's column as the agent reads it: `title_name` for an area's `titleName`. */
function agentField(entityField: string): string {
  return entityField.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function entityField(field: string): string {
  return field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The translatable fields of a kind, as the agent spells them. */
export function translationFields(kind: TranslationKind): readonly string[] {
  return TRANSLATABLE_ENTITY_FIELDS[ENTITY_BY_KIND[kind]].map(agentField);
}

/** Every text an agent can name, as `kind.field` — the accepted values of a malformed key. */
export function translationTargets(): string[] {
  return TRANSLATION_KINDS.flatMap((kind) => translationFields(kind).map((field) => `${kind}.${field}`));
}

/** One translatable text: which row, and which of its columns. */
export interface TranslationTarget {
  readonly kind: TranslationKind;
  readonly entityType: TranslatableEntity;
  /** The agent's spelling, `title_name`. */
  readonly field: string;
  /** The entity's column, `titleName`. */
  readonly entityField: string;
  readonly id: string;
}

/** The key naming one text, as the agent reads it and sends it back. */
export function translationKey(target: Pick<TranslationTarget, "kind" | "field" | "id">): string {
  return `${target.kind}.${target.field}.${target.id}`;
}

/** The target for an entity row and column — the shape the album editor's gaps come in. */
export function translationTarget(
  entityType: TranslatableEntity,
  entityFieldName: string,
  id: string
): TranslationTarget {
  return { kind: KIND_BY_ENTITY[entityType], entityType, field: agentField(entityFieldName), entityField: entityFieldName, id };
}

/** A key read back, or a refusal naming the kinds and fields there are. */
export function parseTranslationKey(raw: string, parameter: string): TranslationTarget {
  const [kind, field, id, ...rest] = raw.trim().split(".");
  const known = (TRANSLATION_KINDS as readonly string[]).includes(kind);
  if (!known || !id || rest.length > 0 || !translationFields(kind as TranslationKind).includes(field)) {
    throw invalidRequest(
      `"${parameter}" names "${raw}", which is not a text's key. Send the \`key\` \`find_missing_translations\` returned — kind, field and id, such as \`issue.name.<id>\` — with one of these kind and field pairs.`,
      translationTargets()
    );
  }
  const typed = kind as TranslationKind;
  return { kind: typed, entityType: ENTITY_BY_KIND[typed], field, entityField: entityField(field), id };
}

/** One text to write: its target and the translation. */
export interface TranslationEntry {
  readonly target: TranslationTarget;
  readonly key: string;
  readonly text: string;
}

/** The most texts one write carries — the list cap, for the same reason: an answer must fit. */
export const MAX_TRANSLATION_WRITES = 100;

/** `"key: text"` entries read, every one checked before anything is written. */
export function parseTranslationEntries(entries: readonly string[], parameter: string): TranslationEntry[] {
  if (entries.length === 0) {
    throw invalidRequest(`"${parameter}" must carry at least one \`"key: translation"\` entry.`);
  }
  if (entries.length > MAX_TRANSLATION_WRITES) {
    throw invalidRequest(
      `"${parameter}" carries ${entries.length} entries; one call writes at most ${MAX_TRANSLATION_WRITES}. Send the rest in a second call.`
    );
  }
  return parseKeyedEntries(entries, parameter, "key", "issue.name.<id>: Freimarken").map(({ key, value }) => {
    const target = parseTranslationKey(key, parameter);
    return { target, key: translationKey(target), text: value };
  });
}

/** One text without a translation in the language asked about. */
export interface AgentMissingTranslation {
  /** What to send back to `set_translations`. */
  readonly key: string;
  readonly kind: TranslationKind;
  readonly field: string;
  /** The text in the collection's own language — what prints until a translation exists. */
  readonly text: string;
  /** What the text belongs to, where the kind alone does not say: a stamp's catalogue numbers and
   *  issue, an issue's area and year, an area's parent. Absent for the collection's own terms. */
  readonly belongsTo?: string;
}

/** What `set_translations` answers. */
export interface AgentTranslationWrite {
  readonly language: string;
  /** The texts written, each with the translation it replaced where there was one. */
  readonly written: readonly { key: string; text: string; replaced?: string }[];
  /** Texts that already had a translation, left as they were — send `replace: true` to change them. */
  readonly kept: readonly { key: string; current: string }[];
}

/** Keys naming nothing in this collection — every one named, and nothing written. */
export function unknownTranslationTargets(keys: readonly string[]): ApiError {
  return invalidRequest(
    `${keys.length === 1 ? "This key names" : "These keys name"} no text in this collection: ${keys.join(", ")}. Nothing was written. Send the keys \`find_missing_translations\` returned.`,
    keys
  );
}

/** Keys naming a text that is empty in the collection's own language — there is nothing to translate. */
export function untranslatableTargets(keys: readonly string[]): ApiError {
  return invalidRequest(
    `${keys.length === 1 ? "This text is" : "These texts are"} empty in the collection's own language, so there is nothing to translate: ${keys.join(", ")}. Nothing was written. Give the text a value in the app first.`,
    keys
  );
}
