import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { parseFacebookPostNo } from "@/lib/facebook-post-rules";
import { getPhonePost } from "@/lib/phone-posts";
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
// recorded and a lot sold or withdrawn. The proposal made from it, if any, is named and linked. Its
// *Full app* goes to the post's own screen at the desk, by the same number.
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

  return (
    <PhoneScreen title={`Post #${post.postNo}`} fullAppHref={`/c/${collectionSlug}/offers/posts/${post.postNo}`}>
      <PhonePostPanel collectionId={collection.id} collectionSlug={collectionSlug} post={post} />
    </PhoneScreen>
  );
}
