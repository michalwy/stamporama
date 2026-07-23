import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getCatalogNames, getCatalogTree } from "@/lib/catalog";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getStampSubtypes } from "@/lib/subtypes";
import { getCollectionPhotoStorageBytes } from "@/lib/photos";
import { getAppVersionLabel } from "@/lib/version";
import { SettingsTabs } from "./settings-tabs";

export const metadata = { title: "Settings" };

interface SettingsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [
    areas,
    catalogNames,
    catalogTree,
    conditions,
    certificateStatuses,
    subtypes,
    photoStorageBytes,
  ] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getCatalogNames(session.user.id, collection.id),
    getCatalogTree(session.user.id, collection.id),
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getStampSubtypes(session.user.id, collection.id),
    getCollectionPhotoStorageBytes(session.user.id, collection.id),
  ]);

  return (
    <div style={{ padding: "2rem", maxWidth: "56rem" }}>
      <Suspense fallback={null}>
        <SettingsTabs
          collectionId={collection.id}
          collectionName={collection.name}
          baseCurrency={collection.baseCurrency}
          collectionSlug={collectionSlug}
          initialAreas={areas}
          catalogNames={catalogNames}
          initialTree={catalogTree}
          initialConditions={conditions}
          initialCertificateStatuses={certificateStatuses}
          initialSubtypes={subtypes}
          duplicateCatalogMode={collection.duplicateCatalogMode === "block" ? "block" : "warn"}
          photoStorageBytes={photoStorageBytes}
          appVersion={getAppVersionLabel()}
        />
      </Suspense>
    </div>
  );
}
