import "server-only";
import { prisma } from "../../db";
import { notFound } from "../errors";
import { requiredString } from "../params";
import { facebookPostRecord, parseFacebookPostRef, type AgentFacebookPost } from "../facebook-post-reads";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type { Operation, OperationContext, ParameterSpec } from "../types";

// Facebook posts (#2608) — a post of several lots in a Facebook group (#1842), read so a proposal can
// be made of it (#2602): *send this post to Jan first*. The write, `create_proposal_from_post`, is a
// proposal write and lives with the others in `operations/proposals.ts`; this module is the read and
// the naming of a post both use.
//
// **Read only.** Nothing here composes, publishes, prices or withdraws a post — publishing stays the
// collector's (#711), and a lot is priced as a proposal's lot with `set_proposal_lot_price` or as an
// offer with `set_offer_price`. The post's photos, text and translations are its screen's.

export const FACEBOOK_POST_PARAMETER: ParameterSpec = {
  name: "post",
  in: "path",
  type: "string",
  required: true,
  description: "The Facebook post: its number as the collector calls it (`12` or `#12`, *Post #12* on the offers list), or its id.",
};

/** The post named, proved to be in the token's collection. */
export async function resolveFacebookPost(
  context: OperationContext,
  value: string
): Promise<{ id: string; postNo: number }> {
  const ref = parseFacebookPostRef(value);
  const row = await prisma.facebookPost.findFirst({
    where: {
      collectionId: context.collectionId,
      collection: { ownerId: context.ownerId },
      ...(ref.kind === "number" ? { postNo: ref.postNo } : { id: ref.id }),
    },
    select: { id: true, postNo: true },
  });
  if (!row) {
    throw notFound(
      `No Facebook post ${ref.kind === "number" ? `#${ref.postNo}` : `with id "${ref.id}"`} is in this token's collection. A post's number is the one the offers list shows as *Post #12*.`
    );
  }
  return row;
}

/** The post in `get_facebook_post`'s shape, read fresh. */
export async function loadFacebookPost(context: OperationContext, postId: string): Promise<AgentFacebookPost> {
  const [post, header] = await Promise.all([
    prisma.facebookPost.findFirst({
      where: { id: postId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
      select: {
        id: true,
        postNo: true,
        title: true,
        group: { select: { name: true, platform: { select: { name: true } } } },
        lots: {
          orderBy: [{ facebookLotNo: "asc" }, { offerNo: "asc" }],
          select: {
            id: true,
            offerNo: true,
            facebookLotNo: true,
            name: true,
            state: true,
            listingType: true,
            price: true,
            startingPrice: true,
            currency: true,
            facebookPostSnapshot: true,
            proposal: { select: { proposalNo: true, status: true } },
          },
        },
        proposals: { select: { id: true, proposalNo: true, status: true, contact: { select: { name: true } } } },
      },
    }),
    loadCollectionHeader(context),
  ]);
  if (!post) throw notFound("That Facebook post is not in this token's collection any more.");
  return facebookPostRecord(
    {
      postId: post.id,
      postNo: post.postNo,
      title: post.title,
      groupName: post.group.name,
      platformName: post.group.platform.name,
      lots: post.lots.map((lot) => ({
        offerId: lot.id,
        offerNo: lot.offerNo,
        facebookLotNo: lot.facebookLotNo,
        name: lot.name,
        state: lot.state,
        listingType: lot.listingType,
        price: lot.price.toFixed(2),
        startingPrice: lot.startingPrice?.toFixed(2) ?? null,
        currency: lot.currency,
        facebookPostSnapshot: lot.facebookPostSnapshot,
        proposal: lot.proposal,
      })),
      proposals: post.proposals.map((proposal) => ({
        proposalId: proposal.id,
        proposalNo: proposal.proposalNo,
        status: proposal.status,
        contactName: proposal.contact.name,
      })),
    },
    collectionPath(header, `/offers/posts/${post.postNo}`)
  );
}

// ── get_facebook_post ────────────────────────────────────────────────────────

export const getFacebookPostOperation: Operation = {
  name: "get_facebook_post",
  method: "GET",
  path: "/facebook-posts/{post}",
  description:
    "One Facebook post of several lots: its group, where it stands, and every lot by its number in the post with its offer, title, state, price and the proposal it is in. Read it before `create_proposal_from_post` — a post not yet up can be made into a proposal for one buyer, who then sees its lots first.",
  writes: false,
  parameters: [FACEBOOK_POST_PARAMETER],
  result: {
    kind: "object",
    description:
      "The post. `stage` is `preparing` (being put together), `ready` (ready to post), `pending` (posted, waiting for the group's approval), `up` (up in the group) or `over` (every lot sold or withdrawn). Each lot carries its `lotNo` in the post — the number a proposal made from it gives the lot too — its offer's number and id, title, state, listing type, price (the asking price, or an auction's opening; null while it has none) and `proposal`, the proposal it is a lot of by number and status, null for none. `proposal` is the proposal made from the post that its screen links to — the open one, else the latest — with its contact and status, or null. `proposalRefusal` is why `create_proposal_from_post` would be refused now, in the app's words — the post is up, or already has an open proposal — or null when it would not.",
  },
  handler: async (context, params) =>
    loadFacebookPost(context, (await resolveFacebookPost(context, requiredString(params, "post"))).id),
};
