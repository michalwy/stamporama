import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { albumPlanOverview, planAlbum } from "@/lib/album-plan";
import { AlbumScreen } from "./album-screen";

export const metadata = { title: "Album" };

interface AlbumPageProps {
  params: Promise<{ collectionSlug: string; albumId: string }>;
}

export default async function AlbumDetailPage({ params }: AlbumPageProps) {
  const { collectionSlug, albumId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // One read plans the whole album: entries, boxes and sheets all come out of it, and planning twice
  // would be two answers to a question that has one.
  const plan = await planAlbum(session.user.id, albumId);
  if (!plan || plan.album.collectionId !== collection.id) notFound();

  return (
    <AlbumScreen
      collectionSlug={collectionSlug}
      album={plan.album}
      entries={plan.entries}
      initialOverview={albumPlanOverview(plan)}
    />
  );
}
