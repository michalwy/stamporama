import "server-only";
import { prisma } from "./db";
import { buyerMaterialLanguage, normalizeLanguage } from "./languages";
import { getCollectionLanguageChoices, setContactLanguage } from "./contacts";
import { resolveTranslation } from "./translations";

// **The order summary in the buyer's language** (#2604) — the read and the choice. The pure half (the
// sheet's own words, the areas' names) is in `order-summary-labels.ts` and `order-summary.ts`.
//
// The language is chosen as a proposal's is (#2603): the buyer's — the sale's contact — else the sale's
// platform's listing language, else the collection's. A choice on the page is **saved on the contact**,
// so the next material for that buyer opens in it; there is no column on the sale. A sale with no
// buyer has nowhere to save one, so its page carries the choice in its own address instead.

/** The order summary's language and what its selector offers. */
export interface OrderSummaryLanguage {
  /** The language the sheet is in. */
  language: string | null;
  /** The languages the selector offers — the ones the collection uses, the one in force kept. */
  languages: string[];
  /** Whether the sale has a buyer the choice is saved on; without one the page's address carries it. */
  hasBuyer: boolean;
  /** The language the collection's names are translated into — {@link language}, or null where it is
   *  the collection's own language, whose names need no translating. */
  translateTo: string | null;
}

/**
 * The order summary's language for a sale, or null when the sale is not the owner's. `asked` is the
 * language the page's address names — taken only on a sale with no buyer, and only when it is one the
 * collection uses; a buyer's sale is always in the buyer's language.
 */
export async function readOrderSummaryLanguage(
  ownerId: string,
  saleId: string,
  asked?: string | null
): Promise<OrderSummaryLanguage | null> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, collection: { ownerId } },
    select: {
      collectionId: true,
      buyer: { select: { language: true } },
      platform: { select: { titleLanguage: true } },
      collection: { select: { defaultLanguage: true } },
    },
  });
  if (!sale) return null;
  const defaultLanguage = normalizeLanguage(sale.collection.defaultLanguage);
  let language = buyerMaterialLanguage(sale.buyer?.language, sale.platform.titleLanguage, defaultLanguage);
  const languages = await getCollectionLanguageChoices(ownerId, sale.collectionId, [language]);
  const wanted = normalizeLanguage(asked);
  if (!sale.buyer && wanted && languages.includes(wanted)) language = wanted;
  return {
    language,
    languages,
    hasBuyer: sale.buyer !== null,
    translateTo: language && language !== defaultLanguage ? language : null,
  };
}

/**
 * Put a sale's order summary in another language (#2604): saved on the sale's buyer, so their next
 * material opens in it too. Only a language the collection uses (or the buyer's own) is taken. Refused
 * on a sale with no buyer, whose page keeps the choice in its address. Returns the language now in force.
 */
export async function setOrderSummaryLanguage(ownerId: string, saleId: string, language: string): Promise<string> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, collection: { ownerId } },
    select: { collectionId: true, buyer: { select: { id: true, language: true } } },
  });
  if (!sale) throw new Error("Sale not found or access denied.");
  if (!sale.buyer) throw new Error("This sale has no buyer to save the language on.");
  const code = normalizeLanguage(language);
  const choices = await getCollectionLanguageChoices(ownerId, sale.collectionId, [sale.buyer.language]);
  if (!code || !choices.includes(code)) {
    throw new Error("That language is not one this collection uses. Add it to a platform or an album first.");
  }
  return (await setContactLanguage(ownerId, sale.buyer.id, code)) ?? code;
}

/** The fields of a sold copy the order summary prints by name — a sale's copies satisfy it. */
export interface OrderSummaryCopyNames {
  stampId: string;
  stampName: string | null;
  issueId: string | null;
  issueName: string | null;
  conditionId: string | null;
  conditionName: string | null;
  conditionAbbreviation: string | null;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
}

/**
 * A sale's copies with their stamp, series, condition and certificate named in `language` (#2604) —
 * each field its translation where the collection has one, and the collection's own wording where it
 * has none, field by field as a generated title resolves them (so a condition can be translated while
 * keeping its abbreviation). Null (the collection's own language) returns the copies as they are.
 * Nothing is written.
 */
export async function copiesInLanguage<T extends OrderSummaryCopyNames>(
  copies: readonly T[],
  language: string | null
): Promise<T[]> {
  if (!language || copies.length === 0) return [...copies];
  const ids = (pick: (c: T) => string | null) => [...new Set(copies.map(pick).filter((id): id is string => !!id))];
  const [stamps, issues, conditions, certificates] = await Promise.all([
    prisma.stampTranslation.findMany({
      where: { language, stampId: { in: ids((c) => c.stampId) } },
      select: { stampId: true, language: true, name: true },
    }),
    prisma.issueTranslation.findMany({
      where: { language, issueId: { in: ids((c) => c.issueId) } },
      select: { issueId: true, language: true, name: true },
    }),
    prisma.stampConditionTranslation.findMany({
      where: { language, stampConditionId: { in: ids((c) => c.conditionId) } },
      select: { stampConditionId: true, language: true, name: true, abbreviation: true },
    }),
    prisma.certificateStatusTranslation.findMany({
      where: { language, certificateStatusId: { in: ids((c) => c.certificateStatusId) } },
      select: { certificateStatusId: true, language: true, name: true },
    }),
  ]);
  const stampBy = new Map(stamps.map((t) => [t.stampId, [t]]));
  const issueBy = new Map(issues.map((t) => [t.issueId, [t]]));
  const conditionBy = new Map(conditions.map((t) => [t.stampConditionId, [t]]));
  const certificateBy = new Map(certificates.map((t) => [t.certificateStatusId, [t]]));
  return copies.map((copy) => ({
    ...copy,
    stampName: resolveTranslation(stampBy.get(copy.stampId), language, (t) => t.name, copy.stampName),
    issueName: copy.issueId
      ? resolveTranslation(issueBy.get(copy.issueId), language, (t) => t.name, copy.issueName)
      : copy.issueName,
    conditionName: copy.conditionId
      ? resolveTranslation(conditionBy.get(copy.conditionId), language, (t) => t.name, copy.conditionName)
      : copy.conditionName,
    conditionAbbreviation: copy.conditionId
      ? resolveTranslation(
          conditionBy.get(copy.conditionId),
          language,
          (t) => t.abbreviation,
          copy.conditionAbbreviation
        )
      : copy.conditionAbbreviation,
    certificateStatusName: copy.certificateStatusId
      ? resolveTranslation(
          certificateBy.get(copy.certificateStatusId),
          language,
          (t) => t.name,
          copy.certificateStatusName
        )
      : copy.certificateStatusName,
  }));
}
