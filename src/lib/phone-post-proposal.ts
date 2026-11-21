import "server-only";
import { prisma } from "./db";
import { resolvePurchaseContact } from "./contacts";
import { hasFacebookPostGoneUp } from "./facebook-post-rules";
import { OfferActionBlockedError } from "./offers";
import { readOpenPostProposal } from "./post-proposal-lots";
import { postProposalRefusal } from "./proposal-rules";
import { createProposalFromPost } from "./proposals";

/**
 * *Make a proposal* on a post's phone screen (#2632): the desk's *Make a proposal…* (#2602,
 * `createProposalFromPost`) for the contact picked as the phone's other contact fields pick one — a
 * suggestion, or a typed name, which is an existing contact of that name in any case, else a new one
 * with no role, as the desk's *Create* in its contact field makes. Everything else is the desk's: the
 * post's own lots under their numbers, refused once the post is up or while a proposal made from it is
 * open — asked before a contact is made, so a refused proposal leaves no new contact behind.
 */
export async function makePhonePostProposal(
  ownerId: string,
  collectionId: string,
  postId: string,
  contact: { contactId: string; contactName: string }
): Promise<{ proposalId: string; proposalNo: number }> {
  const post = await prisma.facebookPost.findFirst({
    where: { id: postId, collectionId, collection: { ownerId } },
    select: { postNo: true, lots: { select: { state: true, facebookPostSnapshot: true } } },
  });
  if (!post) throw new Error("Post not found.");
  if (!contact.contactId.trim() && !contact.contactName.trim()) throw new Error("Pick the contact the proposal is for.");
  const refusal = postProposalRefusal({
    postNo: post.postNo,
    up: hasFacebookPostGoneUp(post.lots),
    lotCount: post.lots.length,
    openProposal: await readOpenPostProposal(prisma, postId),
  });
  if (refusal) throw new OfferActionBlockedError("not-eligible", refusal);
  const contactId = await resolvePurchaseContact(collectionId, { id: contact.contactId, name: contact.contactName });
  if (!contactId) throw new Error("Pick the contact the proposal is for.");
  // The desk's own write, which asks the same refusal again inside its transaction.
  return createProposalFromPost(ownerId, postId, contactId);
}
