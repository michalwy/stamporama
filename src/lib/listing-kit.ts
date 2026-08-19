import "server-only";
import { prisma } from "./db";
import { makeOfferLabeller, orderedLabelItems, STAMP_LABEL_SELECT } from "./offer-labels";
import { loadColnectConditionMap } from "./colnect";
import { colnectGradeFor } from "./colnect-conditions";
import {
  getOfferPhotoPlanState,
  type OfferPhotoGenerationStatus,
} from "./offer-photo-generation";
import {
  evaluateListingPreconditions,
  type ListingBlocker,
  type ListingMode,
} from "./listing-preconditions";
import {
  ALLEGRO_PLATFORM_MODULE,
  usesPlatformCatalogue,
  usesPlatformConditions,
} from "./platform-modules";
import {
  readAllegroListingSection,
  type AllegroListingSection,
} from "./allegro-listing-task";
import {
  listedVariantKey,
  loadOfferListedVariants,
  resolveListingCatalogItemIds,
} from "./listing-catalog-ids";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import type { OfferState } from "./offer-rules";
import type { DescriptionFormat } from "./description-format";

// The **listing kit** (#405, part of #155): everything one offer wants filled into a marketplace
// sale form, in one read. The Assistant already talks to the matching endpoints (#250); posting
// needs the offer side, and it needs it as a single call because the extension has no way to
// assemble a listing out of five round-trips while a form sits open.
//
// **Platform-neutral in shape**: this says what the listing *holds* — catalog item-IDs, graded
// conditions, a quantity, a price, the two texts, the photos in upload order — never how any one
// platform's form is laid out. Which field each value goes in belongs to the platform module in the
// extension (#408/#410).
//
// Which module a platform belongs to is `Contact.platformModule` (#406); a platform naming none is
// refused outright, because there is nobody to fill its form from here. **What a module asks for is
// its own** (#493, `listingModuleRules`): the two platform-side values below are Colnect's — its
// item-ID (#247) and its grade vocabulary (#404, per collection rather than per platform because
// Colnect's list is fixed and global, #402) — and a marketplace that lists by category rather than
// against a catalogue is served neither, both being null rather than a value from a catalogue it is
// not in. Nothing else in this shape moves for such a platform.

/** One copy of the listing, with the two platform-side values a form needs for it. Both are
 *  nullable, and both being non-null on every copy is exactly what the preconditions check. */
export interface ListingKitItem {
  itemId: string;
  /** The collection's own copy number (#268), so a filled form can be traced back to the piece. */
  itemNo: number;
  stampId: string;
  /** The copy's label — its leading catalog number (#379). */
  label: string;
  /** The platform's catalog item-ID (Colnect's item-ID, #247) — null when the stamp has none, and
   *  null throughout for a module that lists against no catalogue of its own (#493). For an
   *  unknown-variant umbrella it is **derived** from the cheapest variant (#616); see
   *  {@link ListingKitItem.catalogItemSource}. */
  catalogItemId: string | null;
  /** The variant the id above was derived from (#616), or null when the copy's own stamp carried it.
   *  A form is filled identically either way — this is what lets the surfaces say the listing went
   *  under a variant rather than under the umbrella the collector picked. */
  catalogItemSource: { stampId: string; label: string } | null;
  condition: ListingKitCondition;
}

/** A copy's condition, ours and the platform's side by side: the local pair is what a message names
 *  it by, the platform pair is what the form submits. */
export interface ListingKitCondition {
  id: string;
  name: string;
  abbreviation: string;
  /** The option value the platform's form submits (#404), or null when the condition is unmapped. */
  platformValue: string | null;
  /** What that value renders as on the platform's form. Null with the value. */
  platformLabel: string | null;
}

/** One image of the upload run, as something the caller can fetch. */
export interface ListingKitPhoto {
  photoId: string;
  /** Instance-relative path to the bytes. The photo route takes the Assistant token (#253), so the
   *  extension fetches it with the same bearer it read this kit with; it is a path rather than an
   *  absolute URL because the caller already knows the instance origin it asked. */
  url: string;
  /** The name the file takes on upload — `<offer>-01.jpg`… in upload order (#314/#326). */
  fileName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** The offer's photos as a listing needs them: the upload set only, in upload order, plus the two
 *  signals that say whether it is worth uploading yet. */
export interface ListingKitPhotos {
  /** The generation job's state (#311). `ready` with an empty `images` is an offer whose plan
   *  produced nothing; anything else means the run has not finished. */
  status: OfferPhotoGenerationStatus;
  /** The stored images were rendered from inputs that have since changed (#311). A signal, never a
   *  refusal: what is stored is still a truthful set of pictures of these stamps, and a collector who
   *  wants the newer ones regenerates first. */
  outOfDate: boolean;
  /** The upload set in upload order (#313): what the collector marked do-not-publish and what falls
   *  past the platform's photo limit are both left out, exactly as the plan's ZIP leaves them out. */
  images: ListingKitPhoto[];
}

export interface OfferListingKit {
  offerId: string;
  collectionId: string;
  state: OfferState;
  /** Whether this kit is for posting a new listing or for re-filling one already live (#462). The
   *  payload is otherwise **identical** — an update reloads every field from the offer, exactly as a
   *  first listing does, because nothing here records what was last posted and a field left out of an
   *  edit would quietly keep the platform's older value. */
  mode: ListingMode;
  /** The listing's own address on the platform (`Offer.url`, #412) — what an update navigates back to,
   *  and null on an offer that has none. Carried in both modes: it is a fact about the offer, and a
   *  create task naming the listing it is about to replace would be the more surprising shape. */
  listingUrl: string | null;
  /** The platform, and the Assistant module that knows its sale form (#406) — null when it names
   *  none, which is itself the `no-platform-module` refusal below. */
  platform: { id: string; name: string; module: string | null };
  /** The listing title (#209) — the stored one, falling back to the derived label as every surface
   *  does. Carried because a listing has a title on most platforms; Colnect's own sale form has no
   *  title field (#402) and its module simply ignores this. */
  title: string;
  /** The generated description and seller-only private note (#266/#267) as they stand — a text the
   *  collector wrote by hand is what they wrote, and this is a read. Null when the platform has no
   *  template for the field and nothing was written. */
  description: string | null;
  privateNote: string | null;
  /** How the description is written (#319), so the module knows whether the field takes markup. */
  descriptionFormat: DescriptionFormat;
  price: string;
  /** The offer's currency, which on a platform that locks one (#196) is the platform's. */
  currency: string;
  /** How many of this listing there are — the number of sets. Truthful only over interchangeable
   *  sets, which is what the `mixed-sets` precondition guarantees; `items` describes one of them. */
  quantity: number;
  /** One set's copies in listing order — what a single buyer takes. */
  items: ListingKitItem[];
  photos: ListingKitPhotos;
  /** Empty on a servable kit. Populated, this is why the offer cannot be listed (#406) — the same
   *  list the workspace card shows, so the two can never disagree. */
  blockers: ListingBlocker[];
  /** The Allegro sale form's own half of the task (#493), for an offer on the Allegro platform and
   *  null for every other one — a **named section** rather than Allegro-shaped fields above, since
   *  a category and a delivery profile mean nothing on another marketplace. It carries refusals of
   *  its own; the endpoint serves neither list non-empty. */
  allegro: AllegroListingSection | null;
}

const KIT_ITEM_SELECT = {
  itemId: true,
  sortOrder: true,
  item: {
    select: {
      itemNo: true,
      stampId: true,
      conditionId: true,
      // The rest of the valuation key (#616): an umbrella's item-ID is derived from the variant that
      // is cheapest at *this* copy's condition, certificate and format.
      certificateStatusId: true,
      formatId: true,
      condition: { select: { name: true, abbreviation: true } },
      // The label fields (#379) plus the one external identifier the form points at (#247), plus
      // whether this stamp is an unknown-variant umbrella at all.
      stamp: {
        select: {
          ...STAMP_LABEL_SELECT.stamp.select,
          colnectId: true,
          variants: { select: VARIANT_FLAG_SELECT },
        },
      },
    },
  },
} as const;

/**
 * The listing kit for one offer, or null when it does not exist in this collection or the caller
 * does not own it — the endpoint's 404, kept indistinguishable from "no such offer" on purpose.
 *
 * **Always returns the kit**, blockers and all: a caller serving the payload refuses on a non-empty
 * `blockers` (#406), and the workspace card reads the very same evaluation to say why before the
 * handoff is offered. Where a precondition fails the affected fields are simply null — nothing is
 * guessed, and a wrong grade or an unmatched stamp is never papered over.
 *
 * `mode` decides only **which offer** may be served (#462) — Ready and unposted, or Active and live —
 * never what is in the payload. An update is the same listing read again.
 */
export async function getOfferListingKit(
  ownerId: string,
  collectionId: string,
  offerId: string,
  mode: ListingMode = "create"
): Promise<OfferListingKit | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      collectionId: true,
      state: true,
      name: true,
      description: true,
      privateNote: true,
      descriptionFormat: true,
      price: true,
      currency: true,
      url: true,
      collection: { select: { ownerId: true } },
      platform: { select: { id: true, name: true, platformModule: true } },
      sets: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, title: true, items: { select: KIT_ITEM_SELECT } },
      },
    },
  });
  if (!offer || offer.collectionId !== collectionId || offer.collection.ownerId !== ownerId) {
    return null;
  }

  // Both lookups are per collection and loaded **once per offer** (#404): a komplet is dozens of
  // copies over a handful of conditions, and the labeller's area tree is one read for the whole kit.
  const platformModule = offer.platform.platformModule;
  const [labeller, conditionMap] = await Promise.all([
    makeOfferLabeller(collectionId),
    usesPlatformConditions(platformModule)
      ? loadColnectConditionMap(collectionId)
      : new Map<string, string>(),
  ]);
  const catalogued = usesPlatformCatalogue(platformModule);

  // Which catalogue entry each copy stands under (#616). An unknown-variant umbrella has no item-ID
  // of its own and is listed under its **cheapest variant**, resolved by the same rule that values
  // the copy — reading nothing at all for an offer whose stamps are all matched, and nothing for a
  // module that lists against no catalogue.
  // …including the variants this offer names by hand, which short-circuit that rollup (part of #616's
  // override). Read only where the platform lists against a catalogue at all — a choice about a
  // catalogue entry says nothing where there is no catalogue.
  const chosen = catalogued ? await loadOfferListedVariants([offerId]) : new Map<string, string>();
  const catalogIds = await resolveListingCatalogItemIds(
    collectionId,
    catalogued
      ? offer.sets.flatMap((set) =>
          set.items.map(({ itemId, item }) => ({
            itemId,
            stampId: item.stampId,
            conditionId: item.conditionId,
            certificateStatusId: item.certificateStatusId,
            formatId: item.formatId,
            unknownVariant: isUnknownVariantStamp(item.stamp),
            ownCatalogItemId: item.stamp.colnectId?.trim() || null,
            listedAsStampId:
              chosen.get(listedVariantKey(offerId, item.stampId, item.conditionId)) ?? null,
          }))
        )
      : [],
    labeller
  );

  // The rest of each copy's price key (#616), kept beside the kit rather than carried inside it: the
  // blockers report it onward so an unpriced-tree link opens the price grid at the cell the listing
  // is blocked on (#633), while the kit itself — the text the extension types into a form — has no
  // use for a certificate or a format.
  const priceAxes = new Map(
    offer.sets.flatMap((set) =>
      set.items.map(({ itemId, item }) => [
        itemId,
        { certificateStatusId: item.certificateStatusId, formatId: item.formatId },
      ])
    )
  );

  const sets = offer.sets.map((set) => {
    const items = orderedLabelItems(set.items);
    return {
      setId: set.id,
      label: labeller.set({ title: set.title, items }),
      copies: items.map(({ itemId, item }): ListingKitItem => {
        const platformValue = conditionMap.get(item.conditionId) ?? null;
        const resolved = catalogIds.get(itemId);
        return {
          itemId,
          itemNo: item.itemNo,
          stampId: item.stampId,
          label: labeller.copy(item.stamp),
          catalogItemId: catalogued ? (resolved?.catalogItemId ?? null) : null,
          catalogItemSource:
            catalogued && resolved?.sourceStampId
              ? { stampId: resolved.sourceStampId, label: resolved.sourceLabel ?? "" }
              : null,
          condition: {
            id: item.conditionId,
            name: item.condition.name,
            abbreviation: item.condition.abbreviation,
            platformValue,
            platformLabel: platformValue ? (colnectGradeFor(platformValue)?.label ?? null) : null,
          },
        };
      }),
    };
  });

  const quantity = sets.filter((s) => s.copies.length > 0).length;
  const blockers = evaluateListingPreconditions({
    platformModule,
    state: offer.state as OfferState,
    mode,
    listingUrl: offer.url,
    sets: sets.map((s) => ({
      setId: s.setId,
      label: s.label,
      copies: s.copies.map((c) => ({
        itemId: c.itemId,
        label: c.label,
        stampId: c.stampId,
        catalogItemId: c.catalogItemId,
        // Why a null id came back null (#617) — read off the one derivation above, never re-derived,
        // so the refusal names the same stamp the resolution was about.
        catalogRollup: catalogIds.get(c.itemId)?.gap ?? null,
        conditionId: c.condition.id,
        conditionName: c.condition.name,
        certificateStatusId: priceAxes.get(c.itemId)?.certificateStatusId ?? null,
        formatId: priceAxes.get(c.itemId)?.formatId ?? null,
        platformCondition: c.condition.platformValue,
      })),
    })),
  });

  const title =
    offer.name ?? labeller.offer(offer.sets.map((s) => ({ title: s.title, items: s.items })));
  const photos = await uploadPhotos(ownerId, collectionId, offerId);

  return {
    offerId: offer.id,
    collectionId: offer.collectionId,
    state: offer.state as OfferState,
    mode,
    listingUrl: offer.url,
    platform: {
      id: offer.platform.id,
      name: offer.platform.name,
      module: offer.platform.platformModule,
    },
    title,
    description: offer.description,
    privateNote: offer.privateNote,
    descriptionFormat: offer.descriptionFormat as DescriptionFormat,
    price: offer.price.toFixed(2),
    currency: offer.currency,
    quantity,
    items: sets.find((s) => s.copies.length > 0)?.copies ?? [],
    photos,
    blockers,
    allegro:
      platformModule === ALLEGRO_PLATFORM_MODULE
        ? await readAllegroListingSection(ownerId, collectionId, {
            offerId: offer.id,
            state: offer.state as OfferState,
            title,
            price: offer.price.toFixed(2),
            quantity,
            photosReady: photos.status === "ready",
            photoCount: photos.images.length,
            // Both read off the evaluation already made over this very kit, never computed twice.
            setsInterchangeable: !blockers.some((b) => b.code === "mixed-sets"),
            differingSetLabels: blockers.find((b) => b.code === "mixed-sets")?.subjects ?? [],
          })
        : null,
  };
}

/** The offer's upload set as fetchable references. Read through the panel's own plan state so the
 *  kit, the Photos card and the plan's ZIP can never disagree about which images are uploaded or
 *  what they are called. */
async function uploadPhotos(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<ListingKitPhotos> {
  const state = await getOfferPhotoPlanState(ownerId, offerId);
  return {
    status: state.status,
    outOfDate: state.outOfDate,
    images: state.images
      .filter((image) => image.publish && !image.overLimit)
      .map((image) => ({
        photoId: image.photoId,
        url: `/api/collections/${collectionId}/photos/${image.photoId}/full`,
        fileName: image.fileName,
        mime: image.mime,
        width: image.width,
        height: image.height,
        sizeBytes: image.sizeBytes,
      })),
  };
}
