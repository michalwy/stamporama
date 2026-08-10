import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getStampListItem, getStampRelatives } from "@/lib/stamps";
import { StampDetailPanel } from "./stamp-detail-panel";

interface StampDetailPageProps {
  params: Promise<{ collectionSlug: string; stampId: string }>;
}

export async function generateMetadata({ params }: StampDetailPageProps): Promise<Metadata> {
  const { stampId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  try {
    const stamp = await getStampListItem(session.user.id, stampId);
    return {
      title: `Stamp — ${stamp.name ?? stamp.catalogNumbers[0]?.number ?? "untitled"}`,
    };
  } catch {
    return {};
  }
}

/**
 * One stamp, whole (#518): its identity and catalog numbers, its photos, what every catalog says
 * it is worth, where it sits in the variant tree, which issue it belongs to, and the copies and
 * offers behind it. The edit dialogs stay where they are — this page reads, it does not write.
 */
export default async function StampDetailPage({ params }: StampDetailPageProps) {
  const { collectionSlug, stampId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  let stamp;
  try {
    stamp = await getStampListItem(session.user.id, stampId);
  } catch {
    notFound();
  }
  // Another of this owner's collections is somebody else's screen as far as this slug is concerned.
  if (stamp.collectionId !== collection.id) notFound();

  const [areas, relatives] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getStampRelatives(session.user.id, stampId),
  ]);

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <StampDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        stamp={stamp}
        relatives={relatives}
        areas={areas}
      />
    </div>
  );
}
