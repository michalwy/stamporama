import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { findFacebookPostId } from "@/lib/facebook-posts";
import { parseFacebookPostNo } from "@/lib/facebook-post-rules";
import { FacebookPostPanel } from "./facebook-post-panel";
import { Screen } from "@/app/screen";

// A multi-lot Facebook post's own screen (#1842): every lot with its state, the post kit and the moves
// the post makes as one. A sub-route of Offers like the bulk listing workspace — the post is a way of
// putting offers up, not an area of its own, so the sidebar's Offers entry stays current — addressed by
// the post's short number, the one *Post #N · lot M* names on each lot's row. The static `posts`
// segment takes precedence over `[offerId]`, so no offer can be shadowed by it.

interface FacebookPostPageProps {
  params: Promise<{ collectionSlug: string; postNo: string }>;
}

export async function generateMetadata({ params }: FacebookPostPageProps) {
  const { postNo } = await params;
  return { title: `Post #${postNo}` };
}

export default async function FacebookPostPage({ params }: FacebookPostPageProps) {
  const { collectionSlug, postNo: rawPostNo } = await params;
  const postNo = parseFacebookPostNo(rawPostNo);
  if (postNo === undefined) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const postId = await findFacebookPostId(session.user.id, collection.id, postNo);
  if (!postId) notFound();

  // "Today" at request time, for *Sell*'s new-sale step — as the offer screen passes it.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Screen height="column">
      <FacebookPostPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        postId={postId}
        today={today}
      />
    </Screen>
  );
}
