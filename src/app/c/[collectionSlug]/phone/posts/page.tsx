import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { PhoneScreen } from "@/app/phone-screen";
import { PhonePostsList } from "./phone-posts-list";

export const metadata = { title: "Facebook posts" };

interface PhonePostsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The phone list of Facebook posts (#2626, ADR-0072): newest first, the posts not over unless the
// select says otherwise, each row opening the post's phone screen. Its *Full app* goes to the desk's
// list of posts.
export default async function PhonePostsPage({ params }: PhonePostsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <PhoneScreen title="Facebook posts" fullAppHref={`/c/${collectionSlug}/offers/posts`}>
      <PhonePostsList collectionId={collection.id} collectionSlug={collectionSlug} />
    </PhoneScreen>
  );
}
