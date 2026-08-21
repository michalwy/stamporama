import "server-only";
import { prisma } from "./db";
import { buildDescendantMap } from "./pricing";
import { valuateItemRows } from "./item-valuation";
import { makeOfferLabeller, STAMP_LABEL_SELECT, type OfferLabeller } from "./offer-labels";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import {
  listedVariantKey,
  resolveListingCatalogItemIds,
  type ResolvedCatalogItemId,
} from "./listing-catalog-ids";
import { syncGeneratedTexts } from "./offers";
import { templateUsesListedAs } from "./offer-title-template";

// Choosing by hand which variant an offer lists an unknown-variant umbrella under — the read behind
// the picker, and the write behind it.
//
// #616 derives that entry from the price rollup and stores nothing, which is right as a default and
// cannot be the only answer: a collector may be able to rule a variant out from the piece in front of
// them, may prefer the variant that is actually being traded on the platform, and may not want to
// price a whole tree (#617) to post one offer. `OfferListedVariant` records the answer; this module
// is what fills the dialog and what writes it.
//
// Two things it deliberately does not do. It **never writes `Stamp.colnectId`**: a choice is about
// one listing, and recording an id on the umbrella would assert that the umbrella *is* that variant —
// still the one thing not known about it. And it never touches the **valuation**: what the copy is
// worth goes on being the rollup's lowest-variant figure. #616 could hold that a listing and its
// value can never drift apart because both were derived; a choice is the collector electing that
// drift, and the dialog says so by naming the automatic answer beside theirs.

/** One variant the umbrella's tree offers, as the picker draws it. */
export interface ListedVariantOption {
  stampId: string;
  /** The leading catalog number with its vendor prefix (`Mi·PL 865a`) — #423's rule for naming a
   *  stamp that is read against the *platform's* catalogue rather than inside its own set. Falls
   *  back to the derived copy label for a variant carrying no number. */
  label: string;
  /** The stamp's own name where it has one; the label already carries the number. */
  name: string | null;
  /** How far below the umbrella it sits, so a deep tree (`309 → 309A → 309AP`) draws as one. */
  depth: number;
  /** Whether it carries a Colnect item-ID. Choosing one that does not is allowed and still refuses
   *  the listing (#405) — but against the variant the collector picked, whose match affordance is on
   *  the card beside it. Being unable to say what you want to sell before you can say it would be the
   *  worse constraint. */
  matched: boolean;
  /** Its catalog price at this row's condition, in its own catalog currency, or null when it has
   *  none. Read through the same valuation the default is derived from, so the figure the collector
   *  compares is the figure the rollup compared. */
  price: string | null;
  currency: string | null;
  /** True when this variant has variants of its own — an unknown-variant umbrella in its own right
   *  (ADR-0010 §3), whose value *is* its children's. It is listed and selectable like any other, and
   *  marked, because listing under one is a coarser claim than listing under a leaf. */
  umbrella: boolean;
  /** True for the variant the rollup would pick on its own — what "back to automatic" restores. */
  automatic: boolean;
}

/** Everything the picker draws for one row of the Items card. */
export interface ListedVariantChoice {
  offerId: string;
  stampId: string;
  conditionId: string;
  /** How the umbrella and the condition are named on the card, so the dialog's own heading agrees
   *  with the line it was opened from. */
  stampLabel: string;
  stampName: string | null;
  conditionName: string;
  /** The variant currently chosen by hand, or null while the row takes the derivation. */
  chosenStampId: string | null;
  /** What the derivation says on its own, ignoring any choice — the label of the variant it picks,
   *  or null where it picks nothing. Named so the dialog can offer *going back* to it and can say
   *  what "automatic" would mean today. */
  automaticLabel: string | null;
  /** Why the derivation picks nothing, for the dialog to state instead of an empty automatic row:
   *  `unpriced-variants` (the tree is not fully priced, #617), `unmatched-variant` (the cheapest one
   *  carries no item-ID), or null when it resolves. */
  automaticGap: "unpriced-variants" | "unmatched-variant" | null;
  options: ListedVariantOption[];
}

/** The offer, scoped to its owner, plus one copy of `stampId` in `conditionId` — the axes the rollup
 *  is resolved at come off that copy, exactly as the card's own row reports the first copy's answer. */
async function readSubject(
  ownerId: string,
  offerId: string,
  stampId: string,
  conditionId: string
): Promise<{
  collectionId: string;
  itemId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      collection: { select: { ownerId: true } },
      sets: {
        select: {
          items: {
            where: { item: { stampId, conditionId } },
            select: {
              itemId: true,
              item: { select: { certificateStatusId: true, formatId: true } },
            },
            take: 1,
          },
        },
      },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new Error("Offer not found or access denied.");
  }
  const copy = offer.sets.flatMap((set) => set.items)[0];
  // The choice is a fact about what *this offer* sells, so it may only be recorded against a stamp
  // and condition the offer actually holds — otherwise the row would outlive the composition that
  // justified it and quietly reappear if the copy came back.
  if (!copy) {
    throw new Error("This offer holds no copy of that stamp in that condition.");
  }
  return {
    collectionId: offer.collectionId,
    itemId: copy.itemId,
    certificateStatusId: copy.item.certificateStatusId,
    formatId: copy.item.formatId,
  };
}

/** The umbrella and its whole variant subtree, in catalog order, with the labeller they are named
 *  by. Refuses a stamp that is not an unknown-variant umbrella: it stands under itself, and there is
 *  nothing to choose between. */
async function readTree(collectionId: string, stampId: string) {
  const [umbrella, labeller] = await Promise.all([
    prisma.stamp.findFirst({
      where: { id: stampId, collectionId },
      select: {
        id: true,
        colnectId: true,
        parentId: true,
        variants: { select: VARIANT_FLAG_SELECT },
        ...STAMP_LABEL_SELECT.stamp.select,
      },
    }),
    makeOfferLabeller(collectionId),
  ]);
  if (!umbrella) throw new Error("Stamp not found in this collection.");
  if (!isUnknownVariantStamp(umbrella)) {
    throw new Error("This stamp's variant is identified, so it is listed under itself.");
  }
  const descendantIds = [
    ...((await buildDescendantMap(collectionId, new Set([stampId]))).get(stampId) ?? []),
  ];
  const descendants =
    descendantIds.length === 0
      ? []
      : await prisma.stamp.findMany({
          where: { id: { in: descendantIds }, collectionId },
          select: {
            id: true,
            colnectId: true,
            parentId: true,
            variants: { select: VARIANT_FLAG_SELECT },
            ...STAMP_LABEL_SELECT.stamp.select,
          },
        });
  // `buildDescendantMap` already walks the subtree in catalog-sort order; the `findMany` above does
  // not preserve it, so the walk's order is restored rather than re-derived. An order pinned here is
  // the same discipline #619 applies to the variants it names in a stored description.
  const byId = new Map(descendants.map((s) => [s.id, s]));
  const ordered = descendantIds.flatMap((id) => {
    const stamp = byId.get(id);
    return stamp ? [stamp] : [];
  });
  return { umbrella, ordered, labeller };
}

/** Depth below the umbrella, walked through the loaded rows so a deep tree indents without a second
 *  query. A node whose parent is missing from the set (it cannot be, the walk being a subtree) is
 *  treated as a direct child rather than dropped. */
function depthsBelow(
  rootId: string,
  rows: readonly { id: string; parentId: string | null }[]
): Map<string, number> {
  const parentById = new Map(rows.map((r) => [r.id, r.parentId]));
  const depths = new Map<string, number>();
  const depthOf = (id: string, guard: number): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const parent = parentById.get(id);
    const depth =
      !parent || parent === rootId || guard === 0 ? 1 : depthOf(parent, guard - 1) + 1;
    depths.set(id, depth);
    return depth;
  };
  for (const row of rows) depthOf(row.id, rows.length);
  return depths;
}

/** What the derivation alone says for this copy — the choice deliberately ignored, so the dialog can
 *  name the automatic answer beside the collector's own and offer going back to it. */
async function automaticFor(
  collectionId: string,
  subject: { itemId: string; certificateStatusId: string | null; formatId: string | null },
  stampId: string,
  conditionId: string,
  ownCatalogItemId: string | null,
  labeller: OfferLabeller
): Promise<ResolvedCatalogItemId | undefined> {
  const resolved = await resolveListingCatalogItemIds(
    collectionId,
    [
      {
        itemId: subject.itemId,
        stampId,
        conditionId,
        certificateStatusId: subject.certificateStatusId,
        formatId: subject.formatId,
        unknownVariant: true,
        ownCatalogItemId,
        listedAsStampId: null,
      },
    ],
    labeller
  );
  return resolved.get(subject.itemId);
}

/**
 * Everything the picker needs for one `offer × stamp × condition`.
 *
 * Four reads and no more: the offer's own copy, the subtree, one valuation pass over the variants,
 * and the derivation asked once with the choice ignored. The prices come through `valuateItemRows`
 * with each variant standing as its **own** identified copy, so the figures on offer here are the
 * figures the rollup weighed — a second pricing path would eventually disagree with the default it
 * is shown beside.
 */
export async function getOfferListedVariantChoice(
  ownerId: string,
  offerId: string,
  stampId: string,
  conditionId: string
): Promise<ListedVariantChoice> {
  const subject = await readSubject(ownerId, offerId, stampId, conditionId);
  const { collectionId } = subject;
  const [{ umbrella, ordered, labeller }, condition, chosen] = await Promise.all([
    readTree(collectionId, stampId),
    prisma.stampCondition.findFirst({
      where: { id: conditionId, collectionId },
      select: { name: true },
    }),
    prisma.offerListedVariant.findUnique({
      where: { offerId_stampId_conditionId: { offerId, stampId, conditionId } },
      select: { variantStampId: true },
    }),
  ]);

  const ownCatalogItemId = umbrella.colnectId?.trim() || null;
  const [valuations, automatic] = await Promise.all([
    valuateItemRows(
      collectionId,
      ordered.map((variant) => ({
        id: variant.id,
        stampId: variant.id,
        conditionId,
        certificateStatusId: subject.certificateStatusId,
        formatId: subject.formatId,
        // Each variant priced **as itself**, not rolled up: what the picker states is the price
        // recorded on that entry, which is what "cheapest" was decided on.
        unknownVariant: false,
      }))
    ),
    automaticFor(collectionId, subject, stampId, conditionId, ownCatalogItemId, labeller),
  ]);

  const depths = depthsBelow(stampId, ordered);
  const nameOf = (stamp: (typeof ordered)[number]) =>
    labeller.catalogNumbers(stamp)[0] ?? labeller.copy(stamp);

  return {
    offerId,
    stampId,
    conditionId,
    stampLabel: labeller.catalogNumbers(umbrella)[0] ?? labeller.copy(umbrella),
    stampName: umbrella.name?.trim() || null,
    conditionName: condition?.name ?? "",
    chosenStampId: chosen?.variantStampId ?? null,
    automaticLabel: automatic?.sourceLabel ?? null,
    automaticGap: automatic?.gap?.kind ?? null,
    options: ordered.map((variant) => {
      const valuation = valuations.get(variant.id);
      return {
        stampId: variant.id,
        label: nameOf(variant),
        name: variant.name?.trim() || null,
        depth: depths.get(variant.id) ?? 1,
        matched: (variant.colnectId?.trim() || null) !== null,
        price: valuation?.unpriced ? null : (valuation?.amount ?? null),
        currency: valuation?.unpriced ? null : (valuation?.currency ?? null),
        umbrella: isUnknownVariantStamp(variant),
        automatic: automatic?.sourceStampId === variant.id,
      };
    }),
  };
}

/**
 * Record — or clear — the variant this offer lists a stamp under.
 *
 * `variantStampId` null goes back to the derivation, which is why clearing is a delete rather than a
 * sentinel: absence already means "derive it", and a stored null would be a second way of saying the
 * same thing that every reader would have to know about.
 *
 * The variant must be inside the umbrella's own subtree. That is checked here rather than by the
 * database — a subtree is not expressible as a constraint — and it is the check that keeps the choice
 * a claim about *this* stamp: any other id would name a listing for goods the offer does not hold.
 *
 * The generated listing texts are re-rendered afterwards, and only where a template actually names
 * `{listedAs}` (#619's own guard, #415's rule): a description saying `Offered under Mi·PL 865b` while
 * the form is filled with `865c` is precisely the drift #619 exists to prevent, and re-running the
 * one function every composition change already uses means the edited-flag and terminal-state rules
 * are not restated here.
 */
export async function setOfferListedVariant(
  ownerId: string,
  offerId: string,
  stampId: string,
  conditionId: string,
  variantStampId: string | null
): Promise<void> {
  const { collectionId } = await readSubject(ownerId, offerId, stampId, conditionId);

  if (variantStampId === null) {
    await prisma.offerListedVariant.deleteMany({ where: { offerId, stampId, conditionId } });
  } else {
    const descendants = (await buildDescendantMap(collectionId, new Set([stampId]))).get(stampId);
    if (!descendants?.has(variantStampId)) {
      throw new Error("That stamp is not a variant of the one being listed.");
    }
    await prisma.offerListedVariant.upsert({
      where: { offerId_stampId_conditionId: { offerId, stampId, conditionId } },
      create: { offerId, stampId, conditionId, variantStampId },
      update: { variantStampId },
    });
  }

  const platform = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      platform: {
        select: { descriptionTemplate: true, privateNoteTemplate: true },
      },
    },
  });
  const names = [
    platform?.platform.descriptionTemplate,
    platform?.platform.privateNoteTemplate,
  ].some((t) => templateUsesListedAs(t ?? null));
  if (names) await syncGeneratedTexts(ownerId, offerId);
}

/** The key one choice is stored under, re-exported so a caller holding a card row does not have to
 *  know the shape of the table. */
export { listedVariantKey };
