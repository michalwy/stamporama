import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { parseFacebookPostNo } from "@/lib/facebook-post-rules";
import { getPhonePost } from "@/lib/phone-posts";
import { lotPhotosDrawing } from "@/lib/facebook-post-lot-refresh";
import { kickOfferPhotoWorker } from "@/lib/offer-photo-worker";
import { PhoneScreen } from "@/app/phone-screen";
import { PhonePostPanel } from "./phone-post-panel";

interface PhonePostPageProps {
  params: Promise<{ collectionSlug: string; postNo: string }>;
}

// The number leads the tab title, as on the post's desk screen (#2112).
export async function generateMetadata({ params }: PhonePostPageProps) {
  const { postNo } = await params;
  return { title: `Post #${postNo}` };
}

// A Facebook post on the phone (#2626, ADR-0072): its group, stage and closing time, and every lot —
// number, picture, title, price and state — each opening the lot's phone offer screen, where a bid is
// recorded and a lot sold or withdrawn. The proposal made from it, if any, is named and linked. A post
// ready to go up is published from here — its text copied, its photos shared or saved, its link pasted —
// and one waiting for the group is approved or rejected (#2629). Before it is up it is made into a
// proposal for one buyer (#2632). Its *Full app* goes to the post's own
// screen at the desk, by the same number.
export default async function PhonePostPage({ params }: PhonePostPageProps) {
  const { collectionSlug, postNo: rawPostNo } = await params;
  const postNo = parseFacebookPostNo(rawPostNo);
  if (postNo === undefined) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const post = await getPhonePost(session.user.id, collection.id, postNo);
  if (!post) notFound();
  // Reading the photos queues whatever is missing; the worker is woken for it, as the desk's read does.
  if (lotPhotosDrawing(post.photos).length > 0) kickOfferPhotoWorker();

  return (
    <PhoneScreen title={`Post #${post.postNo}`} fullAppHref={`/c/${collectionSlug}/offers/posts/${post.postNo}`}>
      <PhonePostPanel collectionId={collection.id} collectionSlug={collectionSlug} post={post} />
    </PhoneScreen>
  );
}
