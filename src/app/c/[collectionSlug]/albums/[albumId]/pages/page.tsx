import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getAlbumEditorData } from "@/lib/album-editor";
import { AlbumPageEditor } from "./page-editor";

export const metadata = { title: "Album pages" };

interface PageEditorPageProps {
  params: Promise<{ collectionSlug: string; albumId: string }>;
  searchParams: Promise<{ sheet?: string }>;
}

/**
 * The page editor (#769).
 *
 * Which sheet is being looked at is **URL state**, as every other navigation on this screen is, and
 * it is a one-based **position** in the plan — which is how a sheet is asked for everywhere on this
 * track (ADR-0046 §7) and never how one is named: a page's identity is its catalog range, and a
 * number is a position that moves. Nothing here stores one.
 */
export default async function AlbumPageEditorPage({
  params,
  searchParams,
}: PageEditorPageProps) {
  const { collectionSlug, albumId } = await params;
  const { sheet } = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const requested = Number.parseInt(sheet ?? "", 10);
  const data = await getAlbumEditorData(
    session.user.id,
    albumId,
    Number.isFinite(requested) ? requested : null
  );
  if (!data || data.album.collectionId !== collection.id) notFound();

  return <AlbumPageEditor collectionSlug={collectionSlug} data={data} />;
}
