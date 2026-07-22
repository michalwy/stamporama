import "server-only";
import { prisma } from "./db";
import { valuateItemsByIds } from "./items";
import {
  type LotKind,
  type LotState,
  isLotKind,
  deriveLotLabel,
} from "./sale-lot-rules";
import {
  type OfferState,
  isOfferState,
  canTransition,
  isTerminalState,
} from "./offer-rules";

// Server-side domain logic for **per-platform offer management** (ADR-0012, #165). A sale `Lot`
// is the platform-agnostic package (composed in #164); an `Offer` lists it on one platform
// (a `Contact` carrying the `platform` role). `Lot` 1:N `Offer` — the same package can be
// offered on Delcampe, Allegro, Colnect at once, each with its own price/currency/URL.
//
// This module owns: create / edit / delete an offer, the manual lifecycle transitions
// (active ↔ paused → withdrawn; `sold` is set by the sale flow, #166), the paginated offers
// list with platform/state filters, the eligible-lot picker, and the **collision lookup** — the
// non-blocking "at most one active offer per (Item × platform)" warning the dialogs surface.
// The pure state machine + validation live in `offer-rules.ts`. All access is owner-scoped.

// ── Errors ────────────────────────────────────────────────────────────────

export type OfferBlockReason =
  | "not-eligible"
  | "terminal"
  | "bad-transition"
  | "no-platform";

/** Raised when an offer action is refused by a domain guard. `message` is user-facing; the
 * server action maps it to an `{ status: "error" }` response. */
export class OfferActionBlockedError extends Error {
  readonly reason: OfferBlockReason;
  constructor(reason: OfferBlockReason, message: string) {
    super(message);
    this.name = "OfferActionBlockedError";
    this.reason = reason;
  }
}

// ── Ownership helpers ───────────────────────────────────────────────────────

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

interface OfferRef {
  collectionId: string;
  lotId: string;
  platformId: string;
  state: OfferState;
}

async function assertOfferOwner(ownerId: string, offerId: string): Promise<OfferRef> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      lotId: true,
      platformId: true,
      state: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new Error("Offer not found or access denied.");
  }
  return {
    collectionId: offer.collectionId,
    lotId: offer.lotId,
    platformId: offer.platformId,
    state: (isOfferState(offer.state) ? offer.state : "active") as OfferState,
  };
}

/** Verify the lot exists, is owned by `ownerId`, belongs to `collectionId`, and may be listed
 * (non-dissolved). Returns the lot's kind for label derivation. */
async function assertListableLot(
  ownerId: string,
  collectionId: string,
  lotId: string
): Promise<{ kind: LotKind }> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: {
      collectionId: true,
      kind: true,
      state: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!lot || lot.collection.ownerId !== ownerId || lot.collectionId !== collectionId) {
    throw new Error("Lot not found or access denied.");
  }
  if (lot.state === "dissolved") {
    throw new OfferActionBlockedError(
      "not-eligible",
      "This lot has been dissolved and can no longer be listed."
    );
  }
  return { kind: (isLotKind(lot.kind) ? lot.kind : "unit") as LotKind };
}

/** Verify a contact exists in the collection and carries the `platform` role. */
async function assertPlatform(collectionId: string, platformId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: { id: true },
  });
  if (!contact) {
    throw new OfferActionBlockedError("no-platform", "Choose a platform to list on.");
  }
}

// ── Labels / value ──────────────────────────────────────────────────────────

/** Short copy label from a stamp select — primary catalog number, else name. */
function copyLabel(stamp: { name: string | null; catalogNumbers: { number: string }[] }): string {
  return stamp.catalogNumbers[0]?.number ?? stamp.name ?? "Copy";
}

const LOT_LABEL_SELECT = {
  kind: true,
  title: true,
  items: {
    select: {
      item: {
        select: { stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } } },
      },
    },
  },
  subLots: {
    select: {
      child: {
        select: {
          title: true,
          kind: true,
          items: {
            select: {
              item: {
                select: { stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } } },
              },
            },
          },
        },
      },
    },
  },
} as const;

type LotLabelRow = {
  kind: string;
  title: string | null;
  items: { item: { stamp: { name: string | null; catalogNumbers: { number: string }[] } } }[];
  subLots: {
    child: {
      title: string | null;
      kind: string;
      items: { item: { stamp: { name: string | null; catalogNumbers: { number: string }[] } } }[];
    };
  }[];
};

function labelForLot(lot: LotLabelRow): string {
  const kind = (isLotKind(lot.kind) ? lot.kind : "unit") as LotKind;
  const memberLabels =
    kind === "unit"
      ? lot.items.map((li) => copyLabel(li.item.stamp))
      : lot.subLots.map((s) =>
          s.child.title ??
          deriveLotLabel(
            (isLotKind(s.child.kind) ? s.child.kind : "unit") as LotKind,
            s.child.title,
            s.child.items.map((li) => copyLabel(li.item.stamp))
          )
        );
  return deriveLotLabel(kind, lot.title, memberLabels);
}

/** The physical copy ids under a lot (direct copies for a unit lot, the union of sub-lot copies
 * for a quantity lot). Used by the collision lookup. */
async function itemIdsUnderLot(lotId: string): Promise<string[]> {
  const direct = await prisma.lotItem.findMany({ where: { lotId }, select: { itemId: true } });
  const viaSubLots = await prisma.lotSubLot.findMany({
    where: { parentLotId: lotId },
    select: { child: { select: { items: { select: { itemId: true } } } } },
  });
  const ids = new Set<string>();
  for (const r of direct) ids.add(r.itemId);
  for (const s of viaSubLots) for (const li of s.child.items) ids.add(li.itemId);
  return [...ids];
}

// ── Collision lookup (non-blocking warning) ─────────────────────────────────

export interface OfferCollision {
  offerId: string;
  lotLabel: string;
  /** How many physical copies this active offer shares with the target lot on the platform. */
  sharedCount: number;
  /** True when the colliding offer lists the *same* lot — a plain duplicate listing (e.g. the
   * same quantity lot listed twice on one platform), as opposed to a different lot that merely
   * shares a copy. Lets the UI phrase the two cases differently. */
  sameLot: boolean;
}

/**
 * **Active** offers on the same platform that would double-claim a copy in `lotId` (ADR-0012:
 * at most one active offer per Item × platform). Two cases are flagged:
 *   - the **same** lot already listed active on the platform (a duplicate listing — the common
 *     quantity-lot case, where re-listing the same package double-commits every unit), and
 *   - a **different** lot sharing ≥1 physical copy (the N:M overlap).
 * This is a *warning* — the caller decides whether to surface it; nothing is blocked.
 * `excludeOfferId` skips the offer being edited so it never collides with itself.
 */
export async function findOfferCollisions(
  ownerId: string,
  collectionId: string,
  lotId: string,
  platformId: string,
  excludeOfferId?: string
): Promise<OfferCollision[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const targetItems = new Set(await itemIdsUnderLot(lotId));
  if (targetItems.size === 0) return [];

  // Note: the target lot is NOT excluded here — another active offer of the *same* lot on this
  // platform is itself a collision (it re-claims every copy). Only the offer being edited is
  // skipped, via `excludeOfferId`, so it never flags against itself.
  const activeOffers = await prisma.offer.findMany({
    where: {
      collectionId,
      platformId,
      state: "active",
      ...(excludeOfferId ? { id: { not: excludeOfferId } } : {}),
    },
    select: { id: true, lotId: true, lot: { select: LOT_LABEL_SELECT } },
  });

  const collisions: OfferCollision[] = [];
  for (const offer of activeOffers) {
    const otherItems = await itemIdsUnderLot(offer.lotId);
    const shared = otherItems.filter((id) => targetItems.has(id));
    if (shared.length > 0) {
      collisions.push({
        offerId: offer.id,
        lotLabel: labelForLot(offer.lot),
        sharedCount: shared.length,
        sameLot: offer.lotId === lotId,
      });
    }
  }
  return collisions;
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface OfferListItem {
  id: string;
  lotId: string;
  lotLabel: string;
  lotKind: LotKind;
  platformId: string;
  platformName: string;
  url: string | null;
  price: string;
  currency: string;
  state: OfferState;
  createdAt: Date;
}

const OFFER_SELECT = {
  id: true,
  lotId: true,
  platformId: true,
  url: true,
  price: true,
  currency: true,
  state: true,
  createdAt: true,
  platform: { select: { name: true } },
  lot: { select: LOT_LABEL_SELECT },
} as const;

function toListItem(row: {
  id: string;
  lotId: string;
  platformId: string;
  url: string | null;
  price: unknown;
  currency: string;
  state: string;
  createdAt: Date;
  platform: { name: string };
  lot: LotLabelRow;
}): OfferListItem {
  return {
    id: row.id,
    lotId: row.lotId,
    lotLabel: labelForLot(row.lot),
    lotKind: (isLotKind(row.lot.kind) ? row.lot.kind : "unit") as LotKind,
    platformId: row.platformId,
    platformName: row.platform.name,
    url: row.url,
    price: String(row.price),
    currency: row.currency,
    state: (isOfferState(row.state) ? row.state : "active") as OfferState,
    createdAt: row.createdAt,
  };
}

export interface OfferListFilters {
  platformId?: string;
  state?: OfferState;
  /** Restrict to a single lot's offers (the lot detail panel). Unpaginated when set. */
  lotId?: string;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedOffersResult {
  items: OfferListItem[];
  nextCursor: string | null;
}

/** Paginated offers list for the Offers screen (ADR-0012, #165). Filters by platform + state;
 * offset-paginated to feed the shared infinite-scroll. A `lotId` narrows to one lot's offers. */
export async function listOffersPaginated(
  ownerId: string,
  collectionId: string,
  filters: OfferListFilters = {}
): Promise<PaginatedOffersResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await prisma.offer.findMany({
    where: {
      collectionId,
      ...(filters.platformId ? { platformId: filters.platformId } : {}),
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.lotId ? { lotId: filters.lotId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    skip: offset,
    select: OFFER_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    items: page.map(toListItem),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/** Every offer on one lot (lot detail panel). Newest first, unpaginated. */
export async function listLotOffers(ownerId: string, lotId: string): Promise<OfferListItem[]> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!lot || lot.collection.ownerId !== ownerId) {
    throw new Error("Lot not found or access denied.");
  }
  const rows = await prisma.offer.findMany({
    where: { lotId },
    orderBy: { createdAt: "desc" },
    select: OFFER_SELECT,
  });
  return rows.map(toListItem);
}

/** Distinct platforms that currently have at least one offer, for the list-screen filter
 * dropdown (so the dropdown never lists platforms with nothing on them). */
export async function listOfferPlatforms(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId },
    select: { platform: { select: { id: true, name: true } } },
    distinct: ["platformId"],
    orderBy: { platform: { name: "asc" } },
  });
  return rows.map((r) => r.platform);
}

export interface EligibleLot {
  id: string;
  label: string;
  kind: LotKind;
  state: LotState;
  /** Direct members: copies for a unit lot, sub-lots for a quantity lot. */
  memberCount: number;
  /** Base-currency catalog value of the packaged copies; null when nothing could be valued. */
  value: string | null;
}

// Eligible-lot select needs member counts and physical copy ids (for valuation) on top of the
// label fields, so it uses its own richer select rather than the shared label-only one.
const ELIGIBLE_LOT_SELECT = {
  id: true,
  kind: true,
  title: true,
  state: true,
  items: {
    select: {
      itemId: true,
      item: {
        select: { stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } } },
      },
    },
  },
  subLots: {
    select: {
      child: {
        select: {
          title: true,
          kind: true,
          items: {
            select: {
              itemId: true,
              item: {
                select: { stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } } },
              },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Lots that can be listed on a platform (Offers-screen create picker): non-dissolved, holding
 * ≥1 member. Each row carries the lot's kind, state, member count, and base-currency catalog
 * value so the picker can show and facet on them. An optional `query` narrows by title
 * server-side (the compact autocomplete path); the rich browse picker fetches the full set with
 * no query and filters client-side on the derived label + facets. Capped at 200.
 */
export async function searchEligibleLots(
  ownerId: string,
  collectionId: string,
  query: string
): Promise<EligibleLot[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.lot.findMany({
    where: {
      collectionId,
      state: { not: "dissolved" },
      ...(query.trim() ? { title: { contains: query.trim(), mode: "insensitive" } } : {}),
      OR: [{ items: { some: {} } }, { subLots: { some: {} } }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: ELIGIBLE_LOT_SELECT,
  });

  // One batched valuation across every copy under the returned lots (avoids an N+1).
  const perLotItemIds = rows.map((r) =>
    r.kind === "quantity"
      ? r.subLots.flatMap((s) => s.child.items.map((li) => li.itemId))
      : r.items.map((li) => li.itemId)
  );
  const allItemIds = [...new Set(perLotItemIds.flat())];
  const valuations = await valuateItemsByIds(collectionId, allItemIds);

  return rows.map((r, idx) => {
    const kind = (isLotKind(r.kind) ? r.kind : "unit") as LotKind;
    const memberCount = kind === "quantity" ? r.subLots.length : r.items.length;
    let total = 0;
    let anyValued = false;
    for (const id of perLotItemIds[idx]) {
      const base = valuations.get(id)?.baseAmount;
      if (base != null) {
        total += base;
        anyValued = true;
      }
    }
    return {
      id: r.id,
      label: labelForLot(r),
      kind,
      state: r.state as LotState,
      memberCount,
      value: anyValued ? total.toFixed(2) : null,
    };
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface OfferInput {
  platformId: string;
  url: string | null;
  price: string;
  currency: string;
}

/** List a lot on a platform (create an `active` offer). The collision check is intentionally
 * NOT enforced here — it is a non-blocking warning surfaced by the dialog before submit. */
export async function createOffer(
  ownerId: string,
  collectionId: string,
  lotId: string,
  input: OfferInput
): Promise<string> {
  await assertListableLot(ownerId, collectionId, lotId);
  await assertPlatform(collectionId, input.platformId);
  const offer = await prisma.offer.create({
    data: {
      collectionId,
      lotId,
      platformId: input.platformId,
      url: input.url,
      price: input.price,
      currency: input.currency,
      state: "active",
    },
    select: { id: true },
  });
  return offer.id;
}

/** Edit an offer's platform / URL / price / currency. Terminal offers (sold / withdrawn) are
 * frozen. The lot is not editable — an offer is bound to the package it lists. */
export async function updateOffer(
  ownerId: string,
  offerId: string,
  input: OfferInput
): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError(
      "terminal",
      `A ${ref.state} offer is read-only and cannot be edited.`
    );
  }
  await assertPlatform(ref.collectionId, input.platformId);
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      platformId: input.platformId,
      url: input.url,
      price: input.price,
      currency: input.currency,
    },
  });
}

/** Move an offer through its manual lifecycle (active ↔ paused → withdrawn). `sold` is owned by
 * the sale flow (#166) and rejected here. */
export async function setOfferState(
  ownerId: string,
  offerId: string,
  to: OfferState
): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (to === "sold") {
    throw new OfferActionBlockedError(
      "bad-transition",
      "An offer is marked sold by recording a sale, not directly."
    );
  }
  if (!canTransition(ref.state, to)) {
    throw new OfferActionBlockedError(
      "bad-transition",
      `Cannot move an offer from ${ref.state} to ${to}.`
    );
  }
  await prisma.offer.update({ where: { id: offerId }, data: { state: to } });
}

/** Delete an offer (its lot and copies are untouched). A `sold` offer is referenced by a sale
 * line via `SetNull`, so deleting it is safe but discouraged — allowed for cleanup. */
export async function deleteOffer(ownerId: string, offerId: string): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  await prisma.offer.delete({ where: { id: offerId } });
}
