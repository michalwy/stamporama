import "server-only";
import { createHash } from "node:crypto";
import { prisma, type DbTransaction } from "./db";
import {
  shareLinkStatus,
  shareLinkVisitCutoff,
  type ShareLinkHistory,
  type ShareLinkKind,
} from "./share-link-visit-rules";

// **A share link's visit history, the database half** (#2557). `ShareLink` is one row per link ever
// handed out and `ShareLinkVisit` one per opening of its page; the schema says why they sit beside the
// five link tables rather than in them.
//
// Three writers and one reader:
//
//   - **the mint** (`recordShareLinkMinted`), called by each link's own create function inside the
//     transaction that writes the live row, ends the subject's previous link as `replaced`;
//   - **the withdrawal** (`recordShareLinkWithdrawn`), called wherever a live row is deleted on
//     purpose — each revoke, and a cancelled sale's;
//   - **the visit** (`recordShareLinkVisit`), called by each buyer page **before** it asks whether the
//     link works, so an opening of a replaced or withdrawn link is recorded under the link opened;
//   - **the dialog** (`readShareLinkHistory`), by collection, kind and subject, never by token.
//
// Nothing here decides what a buyer is shown. A page records the visit and then verifies the token
// exactly as before; the history cannot make a dead link live.

/** SHA-256 hex of a raw token — the hash every link table stores, so the two always meet. */
export function hashShareToken(rawToken: string): string {
  return createHash("sha256").update(rawToken.trim()).digest("hex");
}

/** A newly minted link for a subject. Its previous one, if any, ends here as replaced. */
export async function recordShareLinkMinted(
  tx: DbTransaction,
  link: { collectionId: string; kind: ShareLinkKind; subjectId: string; tokenHash: string; now?: Date }
): Promise<void> {
  const now = link.now ?? new Date();
  await tx.shareLink.updateMany({
    where: { collectionId: link.collectionId, kind: link.kind, subjectId: link.subjectId, endedAt: null },
    data: { endedAt: now, endReason: "replaced" },
  });
  await tx.shareLink.create({
    data: {
      collectionId: link.collectionId,
      kind: link.kind,
      subjectId: link.subjectId,
      tokenHash: link.tokenHash,
      createdAt: now,
    },
  });
}

/** The subject's link was withdrawn. Its visits stay, under a link marked withdrawn. */
export async function recordShareLinkWithdrawn(
  tx: DbTransaction,
  subject: { kind: ShareLinkKind; subjectId: string; now?: Date }
): Promise<void> {
  await tx.shareLink.updateMany({
    where: { kind: subject.kind, subjectId: subject.subjectId, endedAt: null },
    data: { endedAt: subject.now ?? new Date(), endReason: "withdrawn" },
  });
}

/** Who opened a page, as the request told it. */
export interface ShareLinkVisitor {
  ipAddress: string | null;
  userAgent: string | null;
  /** The signed-in account, if any — the collection's owner makes the visit their own. */
  userId: string | null;
}

/** The longest browser string kept: real ones are a few hundred characters, and this is a column a
 *  stranger writes into. */
const USER_AGENT_MAX = 512;
const IP_ADDRESS_MAX = 64;

/**
 * Record one opening of a link's page. A token no link of this kind ever had records nothing — a
 * mistyped or invented address is not a visit to anything. Best-effort: the page is served whether
 * or not this succeeds, so a failure is logged and swallowed rather than shown to a buyer.
 */
export async function recordShareLinkVisit(
  kind: ShareLinkKind,
  rawToken: string,
  visitor: ShareLinkVisitor,
  now: Date = new Date()
): Promise<boolean> {
  try {
    const link = await prisma.shareLink.findUnique({
      where: { tokenHash: hashShareToken(rawToken) },
      select: { id: true, kind: true, collection: { select: { ownerId: true } } },
    });
    if (!link || link.kind !== kind) return false;
    await prisma.shareLinkVisit.create({
      data: {
        shareLinkId: link.id,
        at: now,
        ipAddress: visitor.ipAddress?.slice(0, IP_ADDRESS_MAX) || null,
        userAgent: visitor.userAgent?.slice(0, USER_AGENT_MAX) || null,
        own: visitor.userId !== null && visitor.userId === link.collection.ownerId,
      },
    });
    return true;
  } catch (err) {
    console.error("[share-link] could not record a visit", err);
    return false;
  }
}

/** The live rows' hashes for one subject — what tells a current link from one whose row went. */
async function liveTokenHashes(kind: ShareLinkKind, subjectId: string): Promise<Set<string>> {
  const select = { tokenHash: true } as const;
  const rows: { tokenHash: string }[] =
    kind === "post_preview"
      ? await prisma.facebookPostPreviewToken.findMany({ where: { postId: subjectId }, select })
      : kind === "offer_specification"
        ? await prisma.offerSpecificationShareToken.findMany({ where: { offerId: subjectId }, select })
        : kind === "proposal"
          ? await prisma.proposalShareToken.findMany({ where: { proposalId: subjectId }, select })
          : kind === "sale"
            ? await prisma.saleShareToken.findMany({ where: { saleId: subjectId }, select })
            : await prisma.tradeShareToken.findMany({ where: { tradeId: subjectId }, select });
  return new Set(rows.map((row) => row.tokenHash));
}

/**
 * Every link a subject has had that still has something to show, with its visits newest first: the
 * current link first, then the ended ones, most recent first. Scoped by the collection the caller
 * owns, so a subject id from another collection reads as an empty history.
 */
export async function readShareLinkHistory(
  ownerId: string,
  collectionId: string,
  kind: ShareLinkKind,
  subjectId: string
): Promise<ShareLinkHistory> {
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, ownerId }, select: { id: true } });
  if (!collection) throw new Error("Collection not found or access denied.");

  const [rows, live] = await Promise.all([
    prisma.shareLink.findMany({
      where: { collectionId, kind, subjectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tokenHash: true,
        createdAt: true,
        endedAt: true,
        endReason: true,
        visits: {
          orderBy: { at: "desc" },
          select: { id: true, at: true, ipAddress: true, userAgent: true, own: true },
        },
      },
    }),
    liveTokenHashes(kind, subjectId),
  ]);

  const links = rows
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      status: shareLinkStatus(row.endReason, live.has(row.tokenHash)),
      visits: row.visits.map((visit) => ({
        id: visit.id,
        at: visit.at.toISOString(),
        ipAddress: visit.ipAddress,
        userAgent: visit.userAgent,
        own: visit.own,
      })),
    }))
    // An ended link with no visits left has nothing to show.
    .filter((link) => link.status === "current" || link.visits.length > 0);
  // The current one leads; the order is otherwise the query's, newest first.
  links.sort((a, b) => Number(b.status === "current") - Number(a.status === "current"));
  return { links };
}

/**
 * The hourly sweep: visits older than 90 days go, and then every link that can collect none and has
 * none left to show — one that ended over 90 days ago, or whose live row is gone with it (a subject
 * deleted) and was made over 90 days ago. A link ended more recently is kept even with no visits, so
 * an opening of the replaced address next week is still recorded under it.
 */
export async function sweepShareLinkVisits(now: Date = new Date()): Promise<{ visits: number; links: number }> {
  const cutoff = shareLinkVisitCutoff(now);
  const visits = await prisma.shareLinkVisit.deleteMany({ where: { at: { lt: cutoff } } });
  const links = await prisma.$executeRaw`
    DELETE FROM "share_link" l
    WHERE NOT EXISTS (SELECT 1 FROM "share_link_visit" v WHERE v."shareLinkId" = l."id")
      AND (
        (l."endedAt" IS NOT NULL AND l."endedAt" < ${cutoff})
        OR (
          l."endedAt" IS NULL AND l."createdAt" < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM "facebook_post_preview_token" t WHERE t."tokenHash" = l."tokenHash")
          AND NOT EXISTS (SELECT 1 FROM "offer_specification_share_token" t WHERE t."tokenHash" = l."tokenHash")
          AND NOT EXISTS (SELECT 1 FROM "proposal_share_token" t WHERE t."tokenHash" = l."tokenHash")
          AND NOT EXISTS (SELECT 1 FROM "sale_share_token" t WHERE t."tokenHash" = l."tokenHash")
          AND NOT EXISTS (SELECT 1 FROM "trade_share_token" t WHERE t."tokenHash" = l."tokenHash")
        )
      )`;
  return { visits: visits.count, links };
}
