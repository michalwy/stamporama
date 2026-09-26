import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getStampFormats } from "@/lib/stamp-formats";
import { getStampSubtypes } from "@/lib/subtypes";
import { StructurePanel } from "./structure-panel";

export const metadata = { title: "Collection structure" };

interface StructurePageProps {
  params: Promise<{ collectionSlug: string }>;
}

/** The collection structure screen (#1401; ADR-0056): the held copies counted along any one of the
 * collection's dimensions, or two crossed, with a drill-down. Opened from the Overview's holdings
 * tile, as the profit and loss screen is opened from its own (#1305) — no sidebar entry. */
export default async function StructurePage({ params }: StructurePageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [conditions, certificateStatuses, areas, locations, formats, subtypes] = await Promise.all([
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    getStampSubtypes(session.user.id, collection.id),
  ]);

  return (
    <div
      style={{
        padding: "2rem",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Collection structure
      </h2>
      <StructurePanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
        locations={locations}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
        formats={formats}
        subtypes={subtypes}
      />
    </div>
  );
}
