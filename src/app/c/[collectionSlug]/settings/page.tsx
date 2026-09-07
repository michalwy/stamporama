import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getCatalogTree } from "@/lib/catalog";
import { getStampConditions } from "@/lib/conditions";
import { getStampFormats } from "@/lib/stamp-formats";
import { getCollectionFormatFactors } from "@/lib/format-factors";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getStampSubtypes } from "@/lib/subtypes";
import { getStampAttributeLists } from "@/lib/stamp-attributes";
import { getStampSizePresets } from "@/lib/stamp-size-presets";
import {
  getColnectMappings,
  getColnectConditionMappings,
  getColnectPlatform,
  listPlatformContacts,
} from "@/lib/colnect";
import { getColnectListMappings } from "@/lib/colnect-list-sync";
import { getAllegroPlatform } from "@/lib/allegro";
import { getAllegroConnectionStatus } from "@/lib/allegro-connection";
import { listAllegroListingProfiles } from "@/lib/allegro-listing-profile";
import { listAllegroLearnedCategories } from "@/lib/allegro-category";
import { getDelcampePlatform } from "@/lib/delcampe";
import { listDelcampeListingProfiles } from "@/lib/delcampe-listing-profile";
import { listDelcampeLearnedCategories } from "@/lib/delcampe-categories";
import { getCollageTemplates } from "@/lib/collage-templates";
import { getRefCardTemplates } from "@/lib/ref-card-templates";
import { getCarriers } from "@/lib/carriers";
import { getHawidStrips } from "@/lib/hawid-stock";
import { getAlbumTemplates } from "@/lib/album-templates";
import { getCollectionTitleLanguages } from "@/lib/contacts";
import { listAssistantTokens } from "@/lib/api-tokens";
import { getCollectionPhotoStorageBytes } from "@/lib/photos";
import { getStorageCacheStatus } from "@/lib/storage-cache";
import { getAppReleaseDate, getAppVersionLabel } from "@/lib/version";
import { describeClosedOfferPhotoTtl } from "@/lib/offer-photo-cleanup-rules";
import { instanceClosedOfferPhotoTtlMs } from "@/lib/offer-photo-retention";
import { describeScanSheetTtl } from "@/lib/scan-sheet-cleanup-rules";
import { instanceScanSheetTtlMs } from "@/lib/scan-sheet-retention";
import { SettingsTabs } from "./settings-tabs";

export const metadata = { title: "Settings" };

interface SettingsPageProps {
  params: Promise<{ collectionSlug: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function SettingsPage({ params, searchParams }: SettingsPageProps) {
  const { collectionSlug } = await params;

  // Areas left Settings for the Collection section (#775), and `?tab=areas` is an address a
  // collector has had in front of them for months — every mention of it in the user guide was one,
  // and the tab strip itself was a bookmark. Without this the query simply falls through to
  // General, which is the one outcome worth avoiding: it does not look like a move, it looks like
  // the screen is gone. The mirror of what `/areas` did until now, pointing the other way.
  const { tab } = await searchParams;
  if ((Array.isArray(tab) ? tab[0] : tab) === "areas") {
    redirect(`/c/${collectionSlug}/areas`);
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [
    areas,
    catalogTree,
    conditions,
    formats,
    formatFactors,
    certificateStatuses,
    subtypes,
    attributes,
    stampSizePresets,
    collageTemplates,
    refCardTemplates,
    hawidStrips,
    albumTemplates,
    carriers,
    colnectMappings,
    colnectConditionMappings,
    colnectListMappings,
    colnectPlatform,
    allegroPlatform,
    allegroConnection,
    allegroListingProfiles,
    allegroLearnedCategories,
    delcampePlatform,
    delcampeListingProfiles,
    delcampeLearnedCategories,
    platformContacts,
    assistantTokens,
    photoStorageBytes,
    storageCache,
    titleLanguages,
  ] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getCatalogTree(session.user.id, collection.id),
    getStampConditions(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    getCollectionFormatFactors(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getStampSubtypes(session.user.id, collection.id),
    getStampAttributeLists(session.user.id, collection.id),
    getStampSizePresets(session.user.id, collection.id),
    getCollageTemplates(session.user.id, collection.id),
    getRefCardTemplates(session.user.id, collection.id),
    getHawidStrips(session.user.id, collection.id),
    getAlbumTemplates(session.user.id, collection.id),
    getCarriers(session.user.id, collection.id),
    getColnectMappings(session.user.id, collection.id),
    getColnectConditionMappings(session.user.id, collection.id),
    getColnectListMappings(session.user.id, collection.id),
    getColnectPlatform(session.user.id, collection.id),
    getAllegroPlatform(session.user.id, collection.id),
    getAllegroConnectionStatus(session.user.id, collection.id),
    listAllegroListingProfiles(session.user.id, collection.id),
    listAllegroLearnedCategories(session.user.id, collection.id),
    getDelcampePlatform(session.user.id, collection.id),
    listDelcampeListingProfiles(session.user.id, collection.id),
    listDelcampeLearnedCategories(session.user.id, collection.id),
    listPlatformContacts(session.user.id, collection.id),
    listAssistantTokens(session.user.id, collection.id),
    getCollectionPhotoStorageBytes(session.user.id, collection.id),
    getStorageCacheStatus(session.user.id, collection.id),
    getCollectionTitleLanguages(session.user.id, collection.id),
  ]);

  return (
    // The width cap lives on the tabs (#691), not here: how wide a settings surface may get is the
    // tab's answer rather than the page's. The tree that made that distinction worth drawing has
    // since moved out (#775); the placement stands on its own reasoning.
    <div style={{ padding: "2rem" }}>
      <Suspense fallback={null}>
        <SettingsTabs
          collectionId={collection.id}
          collectionName={collection.name}
          baseCurrency={collection.baseCurrency}
          defaultLanguage={collection.defaultLanguage}
          itemNoPad={collection.itemNoPad}
          bidFloorPercent={collection.bidFloorPercent}
          bidCeilingPercent={collection.bidCeilingPercent}
          bidFallbackPercent={collection.bidFallbackPercent}
          closedOfferPhotoTtl={collection.closedOfferPhotoTtlDays}
          // What this collection inherits while it states nothing of its own (#577), resolved
          // server-side: the environment variable is the operator's and never crosses to the
          // browser, so the screen is handed the sentence rather than the setting.
          instanceClosedOfferPhotoTtlLabel={describeClosedOfferPhotoTtl(
            instanceClosedOfferPhotoTtlMs()
          )}
          scanSheetTtl={collection.scanSheetTtlDays}
          // The same server-side resolution for the retained-scan period (#578). Its instance
          // default is *keep for ever* unless an operator says otherwise, which is exactly the
          // sentence a collector following the instance should be reading.
          instanceScanSheetTtlLabel={describeScanSheetTtl(instanceScanSheetTtlMs())}
          // The scale a measurement on a scan is converted with (#598). Nothing to resolve
          // server-side: it is the collection's own answer and there is no instance-wide scanner.
          scanDpi={collection.scanDpi}
          collectionSlug={collectionSlug}
          initialAreas={areas}
          titleLanguages={titleLanguages}
          initialTree={catalogTree}
          initialConditions={conditions}
          initialFormats={formats}
          initialFormatFactors={formatFactors}
          initialCertificateStatuses={certificateStatuses}
          initialSubtypes={subtypes}
          initialAttributes={attributes}
          initialStampSizePresets={stampSizePresets}
          initialCollageTemplates={collageTemplates}
          initialRefCardTemplates={refCardTemplates}
          initialHawidStrips={hawidStrips}
          initialAlbumTemplates={albumTemplates}
          initialCarriers={carriers}
          initialColnectMappings={colnectMappings}
          initialColnectConditionMappings={colnectConditionMappings}
          initialColnectListMappings={colnectListMappings}
          colnectPlatformId={colnectPlatform?.id ?? null}
          allegroPlatformId={allegroPlatform?.id ?? null}
          allegroConnection={allegroConnection}
          allegroListingProfiles={allegroListingProfiles}
          allegroLearnedCategories={allegroLearnedCategories}
          delcampePlatformId={delcampePlatform?.id ?? null}
          delcampeListingProfiles={delcampeListingProfiles}
          delcampeLearnedCategories={delcampeLearnedCategories}
          platformContacts={platformContacts}
          initialAssistantTokens={assistantTokens}
          duplicateCatalogMode={collection.duplicateCatalogMode === "block" ? "block" : "warn"}
          photoStorageBytes={photoStorageBytes}
          // Beside the figure above and never added to it (#591): the storage figure is how much of
          // the collector's data is held, this is how much disk the instance is using as scratch.
          storageCache={storageCache}
          appVersion={getAppVersionLabel()}
          appReleaseDate={getAppReleaseDate()}
        />
      </Suspense>
    </div>
  );
}
