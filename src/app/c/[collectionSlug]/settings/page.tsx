import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getCatalogSettingsTree } from "@/lib/catalog";
import { getStampConditions } from "@/lib/conditions";
import { getStampFormats } from "@/lib/stamp-formats";
import { getCollectionFormatFactors } from "@/lib/format-factors";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getStampSubtypes } from "@/lib/subtypes";
import { getFaults } from "@/lib/faults";
import { getStampAttributeLists } from "@/lib/stamp-attributes";
import { getStampSizePresets } from "@/lib/stamp-size-presets";
import { listScanningProfiles } from "@/lib/scanning-profiles";
import { getTags } from "@/lib/tags";
import { getColnectMappings, getColnectConditionMappings } from "@/lib/colnect";
import { getColnectListMappings } from "@/lib/colnect-list-sync";
import { getAllegroConnectionStatus } from "@/lib/allegro-connection";
import { getMailSettings } from "@/lib/mail/messages";
import { getAuctionReminderSettings } from "@/lib/auction-reminder";
import { listAllegroListingProfiles } from "@/lib/allegro-listing-profile";
import { listAllegroLearnedCategories } from "@/lib/allegro-category";
import { listDelcampeListingProfiles } from "@/lib/delcampe-listing-profile";
import { listDelcampeLearnedCategories } from "@/lib/delcampe-categories";
import { ensureModulePlatforms, listPlatforms } from "@/lib/platforms";
import { listFacebookGroups } from "@/lib/facebook-groups";
import { getCollageTemplates } from "@/lib/collage-templates";
import { getRefCardTemplates } from "@/lib/ref-card-templates";
import { getCarriers } from "@/lib/carriers";
import { listPackingSupplies } from "@/lib/packing-supplies";
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
import { SettingsScreen } from "./settings-screen";
import { Screen } from "@/app/screen";

export const metadata = { title: "Settings" };

interface SettingsPageProps {
  params: Promise<{ collectionSlug: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function SettingsPage({ params, searchParams }: SettingsPageProps) {
  const { collectionSlug } = await params;

  // Areas left Settings for a page of their own (#775; in the Catalog section since #1234), and `?tab=areas` is an address a
  // collector has had in front of them for months — every mention of it in the user guide was one,
  // and the old tab strip itself was a bookmark. Without this the query simply falls through to
  // the default entry, which is the one outcome worth avoiding: it does not look like a move, it looks like
  // the screen is gone. The mirror of what `/areas` did until now, pointing the other way.
  const { tab } = await searchParams;
  if ((Array.isArray(tab) ? tab[0] : tab) === "areas") {
    redirect(`/c/${collectionSlug}/areas`);
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();
  // Before anything reads them: the module pages, and the profiles and groups hanging off their
  // platforms, assume each of the five exists (#1955). One read once they do.
  await ensureModulePlatforms(collection.id);

  const [
    areas,
    catalogTree,
    conditions,
    formats,
    formatFactors,
    certificateStatuses,
    subtypes,
    faults,
    attributes,
    stampSizePresets,
    scanningProfiles,
    tags,
    collageTemplates,
    refCardTemplates,
    hawidStrips,
    albumTemplates,
    carriers,
    packingSupplies,
    colnectMappings,
    colnectConditionMappings,
    colnectListMappings,
    genericPlatforms,
    modulePlatforms,
    allegroConnection,
    allegroListingProfiles,
    allegroLearnedCategories,
    delcampeListingProfiles,
    delcampeLearnedCategories,
    facebookGroups,
    assistantTokens,
    photoStorageBytes,
    storageCache,
    titleLanguages,
    mailSettings,
    auctionReminder,
  ] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getCatalogSettingsTree(session.user.id, collection.id),
    getStampConditions(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    getCollectionFormatFactors(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getStampSubtypes(session.user.id, collection.id),
    getFaults(session.user.id, collection.id),
    getStampAttributeLists(session.user.id, collection.id),
    getStampSizePresets(session.user.id, collection.id),
    listScanningProfiles(session.user.id, collection.id),
    getTags(session.user.id, collection.id),
    getCollageTemplates(session.user.id, collection.id),
    getRefCardTemplates(session.user.id, collection.id),
    getHawidStrips(session.user.id, collection.id),
    getAlbumTemplates(session.user.id, collection.id),
    getCarriers(session.user.id, collection.id),
    listPackingSupplies(session.user.id, collection.id),
    getColnectMappings(session.user.id, collection.id),
    getColnectConditionMappings(session.user.id, collection.id),
    getColnectListMappings(session.user.id, collection.id),
    listPlatforms(session.user.id, collection.id, "generic"),
    listPlatforms(session.user.id, collection.id, "module"),
    getAllegroConnectionStatus(session.user.id, collection.id),
    listAllegroListingProfiles(session.user.id, collection.id),
    listAllegroLearnedCategories(session.user.id, collection.id),
    listDelcampeListingProfiles(session.user.id, collection.id),
    listDelcampeLearnedCategories(session.user.id, collection.id),
    listFacebookGroups(session.user.id, collection.id),
    listAssistantTokens(session.user.id, collection.id),
    getCollectionPhotoStorageBytes(session.user.id, collection.id),
    getStorageCacheStatus(session.user.id, collection.id),
    getCollectionTitleLanguages(session.user.id, collection.id),
    getMailSettings(session.user.id, collection.id),
    getAuctionReminderSettings(session.user.id, collection.id),
  ]);

  return (
    // No width cap here (#1469; ADR-0059): the screen takes the window, and how wide a page's
    // fields may run is its body shape's answer, not the screen's.
    <Screen>
      <Suspense fallback={null}>
        <SettingsScreen
          collectionId={collection.id}
          collectionName={collection.name}
          baseCurrency={collection.baseCurrency}
          defaultLanguage={collection.defaultLanguage}
          homeMarket={collection.homeMarket}
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
          // The collection's scanning profiles (#1443), with what uses each — the Scanners entry.
          initialScanningProfiles={scanningProfiles}
          collectionSlug={collectionSlug}
          initialAreas={areas}
          titleLanguages={titleLanguages}
          initialTree={catalogTree}
          initialConditions={conditions}
          initialFormats={formats}
          initialFormatFactors={formatFactors}
          initialCertificateStatuses={certificateStatuses}
          initialSubtypes={subtypes}
          initialFaults={faults}
          initialAttributes={attributes}
          initialStampSizePresets={stampSizePresets}
          initialTags={tags}
          initialCollageTemplates={collageTemplates}
          initialRefCardTemplates={refCardTemplates}
          initialHawidStrips={hawidStrips}
          initialAlbumTemplates={albumTemplates}
          initialCarriers={carriers}
          initialPackingSupplies={packingSupplies}
          initialColnectMappings={colnectMappings}
          initialColnectConditionMappings={colnectConditionMappings}
          initialColnectListMappings={colnectListMappings}
          genericPlatforms={genericPlatforms}
          modulePlatforms={Object.fromEntries(
            modulePlatforms.map((p) => [p.platformModule!, p])
          )}
          allegroConnection={allegroConnection}
          allegroListingProfiles={allegroListingProfiles}
          allegroLearnedCategories={allegroLearnedCategories}
          delcampeListingProfiles={delcampeListingProfiles}
          delcampeLearnedCategories={delcampeLearnedCategories}
          facebookGroups={facebookGroups}
          initialAssistantTokens={assistantTokens}
          mailSettings={mailSettings}
          auctionReminder={auctionReminder}
          duplicateCatalogMode={collection.duplicateCatalogMode === "block" ? "block" : "warn"}
          photoStorageBytes={photoStorageBytes}
          // Beside the figure above and never added to it (#591): the storage figure is how much of
          // the collector's data is held, this is how much disk the instance is using as scratch.
          storageCache={storageCache}
          appVersion={getAppVersionLabel()}
          appReleaseDate={getAppReleaseDate()}
        />
      </Suspense>
    </Screen>
  );
}
