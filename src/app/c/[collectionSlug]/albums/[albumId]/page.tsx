import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { albumPlanOverview, planAlbum } from "@/lib/album-plan";
import { getAlbumPrintedReport } from "@/lib/album-printing";
import { AlbumScreen } from "./album-screen";

export const metadata = { title: "Album" };

interface AlbumPageProps {
  params: Promise<{ collectionSlug: string; albumId: string }>;
}

export default async function AlbumDetailPage({ params }: AlbumPageProps) {
  const { collectionSlug, albumId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // One read plans the whole album: entries, boxes and sheets all come out of it, and planning twice
  // would be two answers to a question that has one.
  const plan = await planAlbum(session.user.id, albumId);
  if (!plan || plan.album.collectionId !== collection.id) notFound();

  // The comparison against paper (#778). A second read, and it has to be: it plans each printed card
  // again on its own, from its own entries, which is not something the album's plan produces — the
  // live plan steps over a printed sheet rather than laying it out.
  const printedReport = await getAlbumPrintedReport(session.user.id, albumId);

  return (
    <AlbumScreen
      collectionSlug={collectionSlug}
      album={plan.album}
      entries={plan.entries}
      initialOverview={albumPlanOverview(plan)}
      printedReport={printedReport}
    />
  );
}
