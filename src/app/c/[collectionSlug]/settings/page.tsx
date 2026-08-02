import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getCatalogNames, getCatalogTree } from "@/lib/catalog";
import { getStampConditions } from "@/lib/conditions";
import { getStampFormats } from "@/lib/stamp-formats";
import { getCollectionFormatFactors } from "@/lib/format-factors";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getStampSubtypes } from "@/lib/subtypes";
import {
  getColnectMappings,
  getColnectConditionMappings,
  getColnectPlatform,
  listPlatformContacts,
} from "@/lib/colnect";
import { getAllegroPlatform } from "@/lib/allegro";
import { getAllegroConnectionStatus } from "@/lib/allegro-connection";
import { getCollageTemplates } from "@/lib/collage-templates";
import { getCollectionTitleLanguages } from "@/lib/contacts";
import { listAssistantTokens } from "@/lib/api-tokens";
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
    formats,
    formatFactors,
    certificateStatuses,
    subtypes,
    collageTemplates,
    colnectMappings,
    colnectConditionMappings,
    colnectPlatform,
    allegroPlatform,
    allegroConnection,
    platformContacts,
    assistantTokens,
    photoStorageBytes,
    titleLanguages,
  ] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getCatalogNames(session.user.id, collection.id),
    getCatalogTree(session.user.id, collection.id),
    getStampConditions(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    getCollectionFormatFactors(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getStampSubtypes(session.user.id, collection.id),
    getCollageTemplates(session.user.id, collection.id),
    getColnectMappings(session.user.id, collection.id),
    getColnectConditionMappings(session.user.id, collection.id),
    getColnectPlatform(session.user.id, collection.id),
    getAllegroPlatform(session.user.id, collection.id),
    getAllegroConnectionStatus(session.user.id, collection.id),
    listPlatformContacts(session.user.id, collection.id),
    listAssistantTokens(session.user.id, collection.id),
    getCollectionPhotoStorageBytes(session.user.id, collection.id),
    getCollectionTitleLanguages(session.user.id, collection.id),
  ]);

  return (
    <div style={{ padding: "2rem", maxWidth: "56rem" }}>
      <Suspense fallback={null}>
        <SettingsTabs
          collectionId={collection.id}
          collectionName={collection.name}
          baseCurrency={collection.baseCurrency}
          defaultLanguage={collection.defaultLanguage}
          itemNoPad={collection.itemNoPad}
          collectionSlug={collectionSlug}
          initialAreas={areas}
          catalogNames={catalogNames}
          titleLanguages={titleLanguages}
          initialTree={catalogTree}
          initialConditions={conditions}
          initialFormats={formats}
          initialFormatFactors={formatFactors}
          initialCertificateStatuses={certificateStatuses}
          initialSubtypes={subtypes}
          initialCollageTemplates={collageTemplates}
          initialColnectMappings={colnectMappings}
          initialColnectConditionMappings={colnectConditionMappings}
          colnectPlatformId={colnectPlatform?.id ?? null}
          allegroPlatformId={allegroPlatform?.id ?? null}
          allegroConnection={allegroConnection}
          platformContacts={platformContacts}
          initialAssistantTokens={assistantTokens}
          duplicateCatalogMode={collection.duplicateCatalogMode === "block" ? "block" : "warn"}
          photoStorageBytes={photoStorageBytes}
          appVersion={getAppVersionLabel()}
        />
      </Suspense>
    </div>
  );
}
