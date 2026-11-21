import "server-only";
import { prisma } from "./db";
import { normalizeLanguage } from "./languages";
import { AREA_PATH_SEPARATOR } from "./area-path";
import type { CollectionAreaData } from "./areas";

// **The collection's names on the partner's page, in the partner's language** (#2606). Stamp,
// series, area, condition, certificate and format names are the collection's own wording; where the
// collection has a translation into the page's language the page prints that instead, and where it
// has none it prints the collection's own — the rule an offer's specification and a proposal follow
// (#1760, #2603), here over ids rather than over a copy's row, because a receive line has no copy.
//
// A language equal to the collection's own default is no language at all: its columns are already
// written in it and carry no translation rows (`makeTitleCopyMapper`'s rule).

/** A name and its abbreviation, either of which may be absent. */
export interface NamePair {
  name: string | null;
  abbreviation: string | null;
}

export interface TradeShareNames {
  stamp(stampId: string | null, own: string | null): string | null;
  issue(issueId: string | null, own: string | null): string | null;
  condition(conditionId: string | null, own: NamePair): NamePair;
  certificate(certificateStatusId: string | null, own: NamePair): NamePair;
  format(formatId: string | null, own: NamePair): NamePair;
  /** A condition by id alone, translated — what a condition heading names. Null for an id not asked for. */
  conditionById(conditionId: string): NamePair | null;
  /** A certificate status by id alone, translated. Null for an id not asked for. */
  certificateById(certificateStatusId: string): NamePair | null;
  /** The area's breadcrumb, each step in the language where its area has a title in it. */
  areaPath(areaId: string | null): string | null;
}

/** The ids whose names a page is about to print. */
export interface TradeShareNameIds {
  stampIds: Iterable<string>;
  issueIds: Iterable<string>;
  conditionIds: Iterable<string>;
  certificateStatusIds: Iterable<string>;
  formatIds: Iterable<string>;
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function areaPathIn(areas: readonly CollectionAreaData[], language: string | null) {
  const byId = new Map(areas.map((a) => [a.id, a]));
  return (areaId: string | null): string | null => {
    if (!areaId) return null;
    const path: string[] = [];
    let current = byId.get(areaId);
    let depth = 0;
    while (current && depth < 50) {
      path.unshift((language && nonBlank(current.titleNameByLanguage[language])) || current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth++;
    }
    return path.length > 0 ? path.join(AREA_PATH_SEPARATOR) : null;
  };
}

/** Each translation as `id → value`, blanks dropped so they fall back. */
function byId<T>(rows: readonly T[], id: (row: T) => string, value: (row: T) => string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const text = nonBlank(value(row));
    if (text) out.set(id(row), text);
  }
  return out;
}

/**
 * The names a partner's page prints, in `language` where the collection has them in it. Reads the
 * translation rows for exactly the ids given, once each.
 */
export async function loadTradeShareNames(
  areas: readonly CollectionAreaData[],
  defaultLanguage: string | null,
  language: string | null,
  ids: TradeShareNameIds
): Promise<TradeShareNames> {
  const code = normalizeLanguage(language);
  const effective = code && code !== normalizeLanguage(defaultLanguage) ? code : null;
  const areaPath = areaPathIn(areas, effective);
  const list = (values: Iterable<string>) => [...new Set(values)];
  // The collection's own condition and certificate names, read whatever the language: a heading is
  // named by its id alone, and its rows may be past the page's cap.
  const [ownConditions, ownCertificates] = await Promise.all([
    prisma.stampCondition.findMany({
      where: { id: { in: list(ids.conditionIds) } },
      select: { id: true, name: true, abbreviation: true },
    }),
    prisma.certificateStatus.findMany({
      where: { id: { in: list(ids.certificateStatusIds) } },
      select: { id: true, name: true, abbreviation: true },
    }),
  ]);
  const ownCondition = new Map(ownConditions.map((r) => [r.id, { name: r.name, abbreviation: r.abbreviation }]));
  const ownCertificate = new Map(ownCertificates.map((r) => [r.id, { name: r.name, abbreviation: r.abbreviation }]));

  if (!effective) {
    return {
      stamp: (_id, own) => own,
      issue: (_id, own) => own,
      condition: (_id, own) => own,
      certificate: (_id, own) => own,
      format: (_id, own) => own,
      conditionById: (id) => ownCondition.get(id) ?? null,
      certificateById: (id) => ownCertificate.get(id) ?? null,
      areaPath,
    };
  }

  const [stamps, issues, conditions, certificates, formats] = await Promise.all([
    prisma.stampTranslation.findMany({
      where: { language: effective, stampId: { in: list(ids.stampIds) } },
      select: { stampId: true, name: true },
    }),
    prisma.issueTranslation.findMany({
      where: { language: effective, issueId: { in: list(ids.issueIds) } },
      select: { issueId: true, name: true },
    }),
    prisma.stampConditionTranslation.findMany({
      where: { language: effective, stampConditionId: { in: list(ids.conditionIds) } },
      select: { stampConditionId: true, name: true, abbreviation: true },
    }),
    prisma.certificateStatusTranslation.findMany({
      where: { language: effective, certificateStatusId: { in: list(ids.certificateStatusIds) } },
      select: { certificateStatusId: true, name: true, abbreviation: true },
    }),
    prisma.stampFormatTranslation.findMany({
      where: { language: effective, stampFormatId: { in: list(ids.formatIds) } },
      select: { stampFormatId: true, name: true, abbreviation: true },
    }),
  ]);

  const stampName = byId(stamps, (r) => r.stampId, (r) => r.name);
  const issueName = byId(issues, (r) => r.issueId, (r) => r.name);
  const pair = <T>(rows: readonly T[], id: (row: T) => string, row: (row: T) => NamePair) => {
    const names = byId(rows, id, (r) => row(r).name);
    const abbreviations = byId(rows, id, (r) => row(r).abbreviation);
    return (key: string | null, own: NamePair): NamePair =>
      key
        ? {
            // Each falls back on its own: a translated name with no translated abbreviation keeps the
            // collection's abbreviation, as a listing title's tokens do.
            name: own.name === null ? null : (names.get(key) ?? own.name),
            abbreviation: own.abbreviation === null ? null : (abbreviations.get(key) ?? own.abbreviation),
          }
        : own;
  };

  const condition = pair(conditions, (r) => r.stampConditionId, (r) => r);
  const certificate = pair(certificates, (r) => r.certificateStatusId, (r) => r);
  return {
    stamp: (id, own) => (id && own !== null ? (stampName.get(id) ?? own) : own),
    issue: (id, own) => (id && own !== null ? (issueName.get(id) ?? own) : own),
    condition,
    certificate,
    format: pair(formats, (r) => r.stampFormatId, (r) => r),
    conditionById: (id) => {
      const own = ownCondition.get(id);
      return own ? condition(id, own) : null;
    },
    certificateById: (id) => {
      const own = ownCertificate.get(id);
      return own ? certificate(id, own) : null;
    },
    areaPath,
  };
}
