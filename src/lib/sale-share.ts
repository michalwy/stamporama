import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { readShareAddress, sealShareToken, type ShareAddress } from "./share-address";
import {
  isSaleShareTokenShape,
  resolveSaleShareAccess,
  SALE_SHARE_TOKEN_PREFIX,
  type SaleShareRefusal,
} from "./sale-share-rules";
import type { SaleStatus } from "./sale-status";

// **The buyer's link** (#699; ADR-0013 §7). The database half: what mints one, what a raw token
// resolves to, and what a resolved one stands for.
//
// `trade-share.ts`'s shape one table over, and the rule that holds it together is the same one.
//
// **The token names one sale, and nothing is ever read by any other key.** `verifySaleShareToken`
// hands back a `SaleShareAccess` carrying the sale id it resolved to, and every read and write built
// on it (`sale-share-choice.ts`) takes that value rather than anything from a URL, a query string or
// a form. There is no path by which a second sale id, a collection id or a line id supplied by the
// reader reaches a `where` clause on its own. So a leaked link exposes exactly the question the
// seller asked — which of these identical copies would you like — and nothing beside it.
//
// What is deliberately **not** here is any option about what the page shows. A trade's link carries
// `showValues` because a trade list is a column of figures and disclosing them is a real choice; this
// page has no figures at all. The buyer already knows what they paid, and the sale's costs,
// commission and the rest of the collection are not on the page in any setting, so there is no
// setting.

const HASH_ALGO = "sha256";

/** SHA-256 hex of a raw token — what every lookup here runs on. The row also holds the token sealed
 *  (#681), for showing the seller their own address; that value is never a lookup key. */
function hashToken(rawToken: string): string {
  return createHash(HASH_ALGO).update(rawToken, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** The sale is the caller's, or this throws. The sales module's own check, asked the same way from
 *  every entry point here rather than folded into each query. */
async function assertSaleOwner(ownerId: string, saleId: string): Promise<void> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: { collection: { select: { ownerId: true } } },
  });
  if (!sale || sale.collection.ownerId !== ownerId) {
    throw new Error("Sale not found or access denied.");
  }
}

// ── The seller's side ───────────────────────────────────────────────────────────────────────────

/** A sale's buyer link as the seller's dialog reads it — including the address itself (#681): a link
 *  the owner cannot see is a link they cannot send twice, check, or hand to a buyer who lost it. */
export interface SaleShareLinkData {
  address: ShareAddress;
  expiresAt: string | null;
  createdAt: string;
  /** When the buyer last opened it, or null if they never have. The only read receipt there is, and
   *  the one thing that tells a seller whether the question actually reached anybody. */
  lastUsedAt: string | null;
}

export interface SaleShareOptions {
  /** Null is "no expiry", which is the default and the common case — the question closes when the
   *  parcel is packed anyway. */
  expiresAt: Date | null;
}

/** The columns the seller's side reads. One constant, so the reads here cannot come to disagree
 *  about what a link is. */
const LINK_SELECT = {
  tokenSealed: true,
  expiresAt: true,
  createdAt: true,
  lastUsedAt: true,
} as const;

/** The link on a sale, or null when it has none. */
export async function readSaleShareLink(
  ownerId: string,
  saleId: string
): Promise<SaleShareLinkData | null> {
  await assertSaleOwner(ownerId, saleId);
  const row = await prisma.saleShareToken.findUnique({
    where: { saleId },
    select: LINK_SELECT,
  });
  return row ? toLinkData(row) : null;
}

function toLinkData(row: {
  tokenSealed: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}): SaleShareLinkData {
  return {
    address: readShareAddress(row.tokenSealed),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/**
 * Mint the sale's link, replacing any it already had.
 *
 * **Minting and regenerating are one act**, `createTradeShareToken`'s rule for its reason: a sale has
 * one link, and asking for a new one is asking for the old one to stop working. Written as an upsert
 * on the unique `saleId` so there is never a window in which a sale has two live links.
 *
 * The raw token is **sealed** beside its hash (#681, `share-address.ts`) and returned as well,
 * because the dialog that pressed the button has the address on screen before any refetch lands.
 */
export async function createSaleShareToken(
  ownerId: string,
  saleId: string,
  options: SaleShareOptions
): Promise<{ token: string; record: SaleShareLinkData }> {
  await assertSaleOwner(ownerId, saleId);
  const rawToken = SALE_SHARE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const tokenSealed = sealShareToken(rawToken);
  const row = await prisma.saleShareToken.upsert({
    where: { saleId },
    create: { saleId, tokenHash, tokenSealed, expiresAt: options.expiresAt },
    update: {
      tokenHash,
      // Written on every regeneration, null included: a stale seal would show the seller the address
      // of the link they have just replaced.
      tokenSealed,
      expiresAt: options.expiresAt,
      // A regenerated link has never been opened. Carrying the old receipt over would have the
      // dialog report that a buyer had read a question they cannot reach.
      lastUsedAt: null,
      createdAt: new Date(),
    },
    select: LINK_SELECT,
  });
  return { token: rawToken, record: toLinkData(row) };
}

/**
 * Change when the link runs out, without changing the address.
 *
 * Separate from minting because they are separate decisions: extending a link the buyer is halfway
 * through answering must not also break it. Refused when there is no link, rather than quietly
 * creating one — an option set on nothing is a setting the seller cannot see.
 */
export async function setSaleShareOptions(
  ownerId: string,
  saleId: string,
  options: SaleShareOptions
): Promise<SaleShareLinkData> {
  await assertSaleOwner(ownerId, saleId);
  const existing = await prisma.saleShareToken.findUnique({
    where: { saleId },
    select: { id: true },
  });
  if (!existing) throw new Error("This sale has no buyer link.");
  const row = await prisma.saleShareToken.update({
    where: { saleId },
    data: { expiresAt: options.expiresAt },
    select: LINK_SELECT,
  });
  return toLinkData(row);
}

/** Withdraw the link. The row is deleted rather than flagged: a revoked credential kept around is a
 *  credential someone can un-revoke, and there is nothing here worth an audit trail. */
export async function revokeSaleShareToken(ownerId: string, saleId: string): Promise<void> {
  await assertSaleOwner(ownerId, saleId);
  await prisma.saleShareToken.deleteMany({ where: { saleId } });
}

// ── The buyer's side ────────────────────────────────────────────────────────────────────────────

/**
 * What a verified token authorises.
 *
 * The sale id in here is the **only** one any read or write built on it uses. It is resolved from the
 * token's own row, never from anything the reader supplied, which is what makes "nothing outside the
 * named sale is reachable" a property of the code rather than a promise.
 */
export interface SaleShareAccess {
  saleId: string;
  /** The sale's owner. The pick reuses the seller's own `swapSaleLineSet`, which takes one — the
   *  token acts as the owner **for this one sale**, and for nothing else. */
  ownerId: string;
  collectionId: string;
  /** What decides whether the buyer may still answer (`canChooseSaleSet`), read at resolve time so
   *  the page and the write behind it cannot disagree about the parcel. */
  status: SaleStatus;
}

/**
 * Resolve a raw token, or say why not.
 *
 * The prefix is checked before anything is hashed, so a crawler walking `/s/…` costs a string
 * comparison rather than a query. `lastUsedAt` is bumped on success — the seller's one signal that
 * the question was actually opened — and deliberately not on a refusal, which would turn a revoked
 * link into a way to keep touching the row.
 */
export async function verifySaleShareToken(
  rawToken: string,
  options: { touch?: boolean; now?: Date } = {}
): Promise<{ ok: true; access: SaleShareAccess } | { ok: false; reason: SaleShareRefusal }> {
  const now = options.now ?? new Date();
  // The **page** is the visit; the thumbnails on it and the picks made from it are not. One opened
  // question writes one receipt.
  const touch = options.touch ?? true;
  const token = rawToken.trim();
  if (!isSaleShareTokenShape(token)) return { ok: false, reason: "unknown" };
  const hash = hashToken(token);
  const row = await prisma.saleShareToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      sale: {
        select: {
          id: true,
          status: true,
          collectionId: true,
          collection: { select: { ownerId: true } },
        },
      },
    },
  });
  if (!row || !hashesEqual(row.tokenHash, hash)) return { ok: false, reason: "unknown" };

  const allowed = resolveSaleShareAccess({ expiresAt: row.expiresAt }, now);
  if (!allowed.ok) return allowed;

  if (touch) {
    await prisma.saleShareToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return {
    ok: true,
    access: {
      saleId: row.sale.id,
      ownerId: row.sale.collection.ownerId,
      collectionId: row.sale.collectionId,
      status: row.sale.status as SaleStatus,
    },
  };
}
