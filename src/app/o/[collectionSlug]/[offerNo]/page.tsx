import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { prisma } from "@/lib/db";

// The short address of an offer (#416): `/o/<collectionSlug>/<offerNo>` → the canonical
// `/c/<collectionSlug>/offers/<offerId>`.
//
// It exists to fit somewhere very small. A listing text carries `{offerUrl}` (#415) onto a
// marketplace page, and Colnect's private note allows 100 characters (#402) — a cuid-based URL is
// 69 of them before the collector has written a word, and an over-long text is not posted at all
// (#405). Built from `Offer.offerNo`, the same address is about forty.
//
// A **redirect** rather than a second offer screen, deliberately: an offer has one canonical URL,
// and this is an address for it, not a page. Everything about the offer — its data, its
// permissions, its layout — therefore stays defined in exactly one place.
//
// It sits outside `/c/` because that prefix plus a repeated slug is most of what there is to save,
// and it inherits no collection layout since it renders nothing.

interface ShortOfferLinkProps {
  params: Promise<{ collectionSlug: string; offerNo: string }>;
}

export default async function ShortOfferLink({ params }: ShortOfferLinkProps) {
  const { collectionSlug, offerNo } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  // Sign-in always lands on `/collections` (it takes no return address), so a link followed in a
  // signed-out browser costs one more click on the link afterwards. Not worked around here: a
  // return-to parameter is a change to the auth flow, with its own open-redirect question.
  if (!session) redirect("/sign-in");

  // Resolved for the session's own owner, exactly as the collection shell resolves a slug: the
  // number is per collection, so it authorizes nothing on its own.
  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // A number is what the URL states, and anything else — a decimal, a stray suffix, an id pasted
  // in its place — is simply not one of ours.
  const parsed = /^\d+$/.test(offerNo) ? Number(offerNo) : null;
  if (parsed === null || !Number.isSafeInteger(parsed)) notFound();

  const offer = await prisma.offer.findUnique({
    where: { collectionId_offerNo: { collectionId: collection.id, offerNo: parsed } },
    select: { id: true },
  });
  if (!offer) notFound();

  redirect(`/c/${collectionSlug}/offers/${offer.id}`);
}
