"use client";

import type { ScanningProfileListRow } from "@/lib/scanning-profile";
import { ScanningProfilesPanel } from "./scanning-profiles-panel";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { StorageCacheStatus } from "@/lib/storage-cache";
import {
  BidRecommendationPanel,
  CollectionSettingsPanel,
  StorageSettingsPanel,
} from "./settings-panel";
import { SettingsPageFrame } from "./settings-page-frame";
import {
  SETTINGS_GROUPS,
  resolveSettingsAddress,
  settingsEntriesOf,
  settingsGroupOf,
  settingsSearch,
  type SettingsEntryKey,
  type SettingsGroup,
} from "./settings-nav";
import { AppVersionLabel } from "@/app/c/[collectionSlug]/shared/app-version-label";
import { CatalogPanel } from "../catalog/catalog-panel";
import { ConditionsPanel } from "./conditions-panel";
import { CertificateStatusesPanel } from "./certificate-statuses-panel";
import { FormatsPanel } from "./formats-panel";
import { FormatFactorsPanel } from "./format-factors-panel";
import { SubtypesPanel } from "./subtypes-panel";
import { AttributeDictionaryPanel } from "./attributes-panel";
import { StampSizePresetsPanel } from "./stamp-size-presets-panel";
import { TagsPanel } from "./tags-panel";
import { AcceptanceProfilesPanel } from "./acceptance-profiles-panel";
import { DuplicatesPanel } from "./duplicates-panel";
import { ColnectPanel } from "./colnect-panel";
import { ColnectConditionsPanel } from "./colnect-conditions-panel";
import { ColnectAttributesPanel } from "./colnect-attributes-panel";
import { ColnectPlatformPanel } from "./colnect-platform-panel";
import { ColnectListsPanel } from "./colnect-lists-panel";
import { AllegroPlatformPanel } from "./allegro-platform-panel";
import { AllegroConnectionPanel } from "./allegro-connection-panel";
import { AllegroProfilesPanel } from "./allegro-profiles-panel";
import { AllegroCategoriesPanel } from "./allegro-categories-panel";
import { DelcampePlatformPanel } from "./delcampe-platform-panel";
import { DelcampeProfilesPanel } from "./delcampe-profiles-panel";
import { DelcampeCategoriesPanel } from "./delcampe-categories-panel";
import { PhilasearchPlatformPanel } from "./philasearch-platform-panel";
import { CollageTemplatesPanel } from "./collage-templates-panel";
import { RefCardTemplatesPanel } from "./ref-card-templates-panel";
import { CarriersPanel } from "./carriers-panel";
import { HawidStockPanel } from "./hawid-stock-panel";
import { AlbumTemplatesPanel } from "./album-templates-panel";
import { AlbumOrnamentsPanel } from "./album-ornaments-panel";
import { AssistantPanel } from "./assistant-panel";
import { EmailPanel } from "./email-panel";
import { AuctionReminderPanel } from "./auction-reminder-panel";
import type { DuplicateCatalogMode } from "@/lib/duplicate-catalog";
import type { CollectionAreaData } from "@/lib/areas";
import type { CatalogVendorData } from "@/lib/catalog";
import type { ColnectMappingData, ColnectConditionMappingData } from "@/lib/colnect";
import type { ColnectListMappingData } from "@/lib/colnect-list-sync";
import type { AssistantTokenData } from "@/lib/api-tokens";
import type { MailSettings } from "@/lib/mail/messages";
import type { AuctionReminderSettings } from "@/lib/auction-reminder";
import type { StampConditionData } from "@/lib/conditions";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { FormatFactorData } from "@/lib/format-factors";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampSubtypeData } from "@/lib/subtypes";
import type { StampAttributeLists } from "@/lib/stamp-attributes";
import type { StampSizePresetData } from "@/lib/stamp-size-presets";
import type { TagData } from "@/lib/tags";
import { STAMP_ATTRIBUTE_KINDS, type StampAttributeKind } from "@/lib/stamp-attribute-kinds";
import type { CollageTemplateData } from "@/lib/collage-templates";
import type { RefCardTemplateData } from "@/lib/ref-card-templates";
import type { CarrierData } from "@/lib/carriers";
import type { HawidStripData } from "@/lib/hawid-stock";
import type { AlbumTemplateData } from "@/lib/album-templates";
import type { AllegroConnectionStatus } from "@/lib/allegro-connection";
import type { AllegroListingProfileList } from "@/lib/allegro-listing-profile";
import type { AllegroLearnedCategoryList } from "@/lib/allegro-category";
import type { DelcampeListingProfileList } from "@/lib/delcampe-listing-profile";
import type { DelcampeLearnedCategoryList } from "@/lib/delcampe-categories";

interface SettingsScreenProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  /** The collection's default language (#293), edited on Collection. */
  defaultLanguage: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  /** Listing languages in use across the collection's platforms (#293); drives the per-language
   * title-name inputs on the area form. */
  titleLanguages: string[];
  initialTree: CatalogVendorData[];
  initialConditions: StampConditionData[];
  initialFormats: StampFormatData[];
  initialFormatFactors: FormatFactorData[];
  initialCertificateStatuses: CertificateStatusData[];
  initialSubtypes: StampSubtypeData[];
  /** The four stamp-attribute dictionaries (#72) — colour, watermark, paper, printing method. */
  initialAttributes: StampAttributeLists;
  /** The collection's stamp size presets (#804) — the seventh and eighth attribute's dictionary,
   *  a saved pair of millimetres copied onto a stamp rather than referenced by it. */
  initialStampSizePresets: StampSizePresetData[];
  /** The collection's tags (#152) — the collector's own labels, with what each is on. Empty until
   *  the collector invents one: nothing is seeded. */
  initialTags: TagData[];
  initialCollageTemplates: CollageTemplateData[];
  /** The collection's ref-card formats (#569) — what the blank ref-card sheet prints. */
  initialRefCardTemplates: RefCardTemplateData[];
  /** The hawid strips the collection owns (#765) — what an album page's boxes are cut from. */
  initialHawidStrips: HawidStripData[];
  /** The collection's album templates (#766) — how a page looks, seeded onto an album rather than
   *  referenced by one. */
  initialAlbumTemplates: AlbumTemplateData[];
  /** The collection's carriers (#491) — the tracking-address side of shipping. */
  initialCarriers: CarrierData[];
  initialColnectMappings: ColnectMappingData[];
  /** Every condition with the Colnect grade it maps to (#404) — one row each, mapped or not. */
  initialColnectConditionMappings: ColnectConditionMappingData[];
  /** Colnect's four standard lists with what each mirrors (#684) — one row each, configured or
   *  not, since the set is Colnect's and is fixed. */
  initialColnectListMappings: ColnectListMappingData[];
  /** Which platform contact is Colnect (#406), or null when none is — the setting the listing
   * checks ride on. */
  colnectPlatformId: string | null;
  /** Which platform contact is Allegro (#355), or null when none is — the setting the Assistant's
   * lot capture rides on. */
  allegroPlatformId: string | null;
  /** This instance's own API connection to the collector's Allegro account (#476). Secret-free by
   *  construction — the client secret and both tokens never cross to the browser. */
  allegroConnection: AllegroConnectionStatus;
  /** The Allegro platform's listing profiles (#486) and which of them it publishes with by
   *  default — empty, with a null platform, until one of the collection's platforms is Allegro. */
  allegroListingProfiles: AllegroListingProfileList;
  /** What the collection has learned about Allegro's categories (#488) — both registers, empty with
   *  a null platform until one of the collection's platforms is Allegro. */
  allegroLearnedCategories: AllegroLearnedCategoryList;
  /** Which platform is Delcampe (#608), and the profiles its uploads are built from. */
  delcampePlatformId: string | null;
  delcampeListingProfiles: DelcampeListingProfileList;
  delcampeLearnedCategories: DelcampeLearnedCategoryList;
  /** Which platform is Philasearch (#742) — the setting a lot captured from its pages rides on. */
  philasearchPlatformId: string | null;
  /** Every platform contact, for that picker. */
  platformContacts: { id: string; name: string }[];
  initialAssistantTokens: AssistantTokenData[];
  /** Email (#1372): the instance's mail provider as a summary — never its key — and this
   * collection's undelivered mail. */
  mailSettings: MailSettings;
  /** The morning auction reminder (#1373): on or off, its hour and zone, and whether the instance
   * can send mail at all. */
  auctionReminder: AuctionReminderSettings;
  /** Internal copy-number display width (#268), edited on Collection. */
  itemNoPad: number;
  /** The bid-recommendation percentages (#508), edited on Bid recommendation. */
  bidFloorPercent: number;
  bidCeilingPercent: number;
  bidFallbackPercent: number;
  /** How long this collection's closed offers keep their generated images (#577), or null while it
   * defers to the instance. Edited on Photos & storage, beside the storage figure it explains. */
  closedOfferPhotoTtl: string | null;
  /** What deferring to the instance means, already in words — the environment variable itself stays
   * server-side. */
  instanceClosedOfferPhotoTtlLabel: string;
  /** How long this collection keeps the scans of a batch it has finished with (#578), or null while
   * it defers to the instance — whose own answer, in words, is the second field. */
  scanSheetTtl: string | null;
  instanceScanSheetTtlLabel: string;
  /** The collection's scanning profiles (#1443), each with what uses it. */
  initialScanningProfiles: ScanningProfileListRow[];
  duplicateCatalogMode: DuplicateCatalogMode;
  photoStorageBytes: number;
  /** The local cache of remote storage objects (#591), shown beside the storage figure but never
   * added to it: one is the collector's data, the other is reclaimable scratch. */
  storageCache: StorageCacheStatus;
  appVersion: string;
  /** When the running build was made (#507), ISO-8601, or null on an unstamped build. */
  appReleaseDate: string | null;
}

/** A heading inside a page that holds several panels of one thing — below the page title's rank. */
const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: "0 0 1rem",
};

/** Where the navigation stays put: the window scrolls the page, never the list (#1469). */
const NAV_TOP = "2rem";

/**
 * The Settings screen (#1469; ADR-0059): the grouped navigation down the left, every group open,
 * and the chosen entry in the shared page skeleton beside it. What each entry holds is unchanged;
 * the entries are `settings-nav.ts`'s.
 */
export function SettingsScreen(props: SettingsScreenProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { entry, part } = resolveSettingsAddress(searchParams.get("tab"), searchParams.get("part"));

  // A tab inside an entry replaces rather than pushes, as the album screen's do (#1430): it is a
  // view of one page, and Back should leave the page rather than step through its tabs.
  function choosePart(next: string) {
    router.replace(`${pathname}${settingsSearch(searchParams, entry.key, next)}`, { scroll: false });
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "2.5rem" }}>
      <SettingsNav
        activeKey={entry.key}
        pathname={pathname}
        appVersion={props.appVersion}
        appReleaseDate={props.appReleaseDate}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <SettingsPageFrame
          // Keyed on the entry so a page's own state — a half-typed field, an open row — does not
          // follow the collector onto the next entry.
          key={entry.key}
          group={settingsGroupOf(entry)}
          title={entry.label}
          hint={entry.hint}
          unshaped
          tabs={
            entry.parts && part ? { parts: entry.parts, active: part, onChoose: choosePart } : undefined
          }
        >
          <SettingsEntryBody entryKey={entry.key} part={part} {...props} />
        </SettingsPageFrame>
      </div>
    </div>
  );
}

/**
 * The navigation (#1465): a vertical list beside the content, as in the Page template dialog
 * (#1453), with **every group always open** — the sidebar's sections collapse (#762), but a list a
 * collector opens to *find* something should not hide half of it. It scrolls on its own when the
 * window is short. The group headings speak in the sidebar's tints, so a group reads as the part of
 * the app it configures.
 */
function SettingsNav({
  activeKey,
  pathname,
  appVersion,
  appReleaseDate,
}: {
  activeKey: string;
  pathname: string;
  appVersion: string;
  appReleaseDate: string | null;
}) {
  return (
    <nav
      aria-label="Settings"
      style={{
        flex: "0 0 13rem",
        position: "sticky",
        top: NAV_TOP,
        maxHeight: `calc(100vh - 2 * ${NAV_TOP})`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {SETTINGS_GROUPS.map((group, i) => (
          <SettingsNavGroup
            key={group.key}
            group={group}
            first={i === 0}
            activeKey={activeKey}
            pathname={pathname}
          />
        ))}
      </div>
      {/* The running build is not a setting of the collection (#1469), so it is a line at the foot
          of the list rather than a card among the settings. */}
      <p
        style={{
          margin: "0.75rem 0 0",
          padding: "0.75rem 0.75rem 0",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
        }}
      >
        Stamporama <AppVersionLabel version={appVersion} releaseDate={appReleaseDate} />
      </p>
    </nav>
  );
}

function SettingsNavGroup({
  group,
  first,
  activeKey,
  pathname,
}: {
  group: SettingsGroup;
  first: boolean;
  activeKey: string;
  pathname: string;
}) {
  // Outside the app's sections (General, System) the active row is the accent's, as Overview's and
  // the footer's are in the sidebar.
  const hue = group.tint ? `var(--color-tag-${group.tint})` : "var(--color-accent)";
  const plate = group.tint ? `var(--color-tag-${group.tint}-soft)` : "var(--color-bg-muted)";
  return (
    <div>
      <p
        style={{
          margin: 0,
          padding: `${first ? "0" : "1rem"} 0.75rem 0.375rem`,
          fontSize: "0.75rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: group.tint ? hue : "var(--color-text-muted)",
        }}
      >
        {group.label}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {settingsEntriesOf(group.key).map((entry) => {
          const active = entry.key === activeKey;
          return (
            <li key={entry.key}>
              <Link
                href={`${pathname}${settingsSearch(new URLSearchParams(), entry.key, null)}`}
                aria-current={active ? "page" : undefined}
                style={{
                  display: "block",
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 400,
                  textDecoration: "none",
                  color: active ? hue : "var(--color-text-secondary)",
                  background: active ? plate : "transparent",
                  boxShadow: active ? `inset 2px 0 0 ${hue}` : undefined,
                }}
              >
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What one entry holds — today's panels, unchanged, until each page's own issue reshapes it. */
function SettingsEntryBody({
  entryKey,
  part,
  collectionId,
  collectionName,
  baseCurrency,
  defaultLanguage,
  collectionSlug,
  initialAreas,
  titleLanguages,
  initialTree,
  initialConditions,
  initialFormats,
  initialFormatFactors,
  initialCertificateStatuses,
  initialSubtypes,
  initialAttributes,
  initialStampSizePresets,
  initialTags,
  initialCollageTemplates,
  initialRefCardTemplates,
  initialHawidStrips,
  initialAlbumTemplates,
  initialCarriers,
  initialColnectMappings,
  initialColnectConditionMappings,
  initialColnectListMappings,
  colnectPlatformId,
  allegroPlatformId,
  allegroConnection,
  allegroListingProfiles,
  allegroLearnedCategories,
  delcampePlatformId,
  delcampeListingProfiles,
  delcampeLearnedCategories,
  philasearchPlatformId,
  platformContacts,
  initialAssistantTokens,
  mailSettings,
  auctionReminder,
  itemNoPad,
  bidFloorPercent,
  bidCeilingPercent,
  bidFallbackPercent,
  closedOfferPhotoTtl,
  instanceClosedOfferPhotoTtlLabel,
  scanSheetTtl,
  instanceScanSheetTtlLabel,
  initialScanningProfiles,
  duplicateCatalogMode,
  photoStorageBytes,
  storageCache,
}: SettingsScreenProps & { entryKey: string; part: string | null }) {
  switch (entryKey as SettingsEntryKey) {
    case "general":
      return (
        <CollectionSettingsPanel
          collectionId={collectionId}
          collectionName={collectionName}
          baseCurrency={baseCurrency}
          defaultLanguage={defaultLanguage}
          itemNoPad={itemNoPad}
        />
      );
    case "storage":
      return (
        <StorageSettingsPanel
          collectionId={collectionId}
          closedOfferPhotoTtl={closedOfferPhotoTtl}
          instanceClosedOfferPhotoTtlLabel={instanceClosedOfferPhotoTtlLabel}
          scanSheetTtl={scanSheetTtl}
          instanceScanSheetTtlLabel={instanceScanSheetTtlLabel}
          photoStorageBytes={photoStorageBytes}
          storageCache={storageCache}
        />
      );
    case "catalogs":
      return <CatalogPanel collectionId={collectionId} initialTree={initialTree} />;
    case "conditions":
      return (
        <ConditionsPanel
          collectionId={collectionId}
          initialConditions={initialConditions}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "certificates":
      return (
        <CertificateStatusesPanel
          collectionId={collectionId}
          initialStatuses={initialCertificateStatuses}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "formats":
      // Formats and their multipliers are one thing (#1469): a multiplier is a format's worth, set
      // per area and condition, so the two are tabs of one entry rather than two entries.
      return part === "multipliers" ? (
        <FormatFactorsPanel
          collectionId={collectionId}
          initialFactors={initialFormatFactors}
          formats={initialFormats}
          conditions={initialConditions}
          areas={initialAreas}
        />
      ) : (
        <FormatsPanel
          collectionId={collectionId}
          initialFormats={initialFormats}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "subtypes":
      return (
        <SubtypesPanel
          collectionId={collectionId}
          initialSubtypes={initialSubtypes}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "attributes": {
      // The four attribute dictionaries are one subject (#72) — what a catalogue says about a
      // stamp — so they are tabs of one entry. Keyed on the kind, so each tab is its own list.
      const kind = (STAMP_ATTRIBUTE_KINDS as readonly string[]).includes(part ?? "")
        ? (part as StampAttributeKind)
        : STAMP_ATTRIBUTE_KINDS[0];
      return (
        <AttributeDictionaryPanel
          key={kind}
          collectionId={collectionId}
          kind={kind}
          initialRows={initialAttributes[kind]}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    }
    case "size-presets":
      // An entry of its own rather than a fifth tab of Attributes (#1469): a preset is a saved pair
      // of millimetres copied onto a stamp (#804; ADR-0048 §8), not a value a stamp refers to.
      return (
        <StampSizePresetsPanel collectionId={collectionId} initialPresets={initialStampSizePresets} />
      );
    case "duplicates":
      return (
        <DuplicatesPanel
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          initialMode={duplicateCatalogMode}
        />
      );
    case "scanning":
      return (
        <ScanningProfilesPanel collectionId={collectionId} initialProfiles={initialScanningProfiles} />
      );
    case "tags":
      return <TagsPanel collectionId={collectionId} initialTags={initialTags} />;
    case "album-templates":
      return (
        <AlbumTemplatesPanel collectionId={collectionId} initialTemplates={initialAlbumTemplates} />
      );
    case "hawid-stock":
      return <HawidStockPanel collectionId={collectionId} initialStrips={initialHawidStrips} />;
    case "ornaments":
      return <AlbumOrnamentsPanel collectionId={collectionId} />;
    case "refcards":
      return (
        <RefCardTemplatesPanel
          collectionId={collectionId}
          initialTemplates={initialRefCardTemplates}
        />
      );
    case "collages":
      return (
        <CollageTemplatesPanel
          collectionId={collectionId}
          initialTemplates={initialCollageTemplates}
        />
      );
    case "shipping":
      // Carriers are the collection's, while the price list they are named on is each platform's
      // (#468/#491) — a marketplace quotes the postage, a carrier moves the parcel and tracks it the
      // same way whichever marketplace it came from.
      return <CarriersPanel collectionId={collectionId} initialCarriers={initialCarriers} />;
    case "allegro":
      return (
        <section>
          {/* Which platform is Allegro leads the page — the same question the Colnect page leads
              with, asked separately because a collection may well buy on one platform and sell on
              another. */}
          <h3 style={sectionHeadingStyle}>Allegro platform</h3>
          <AllegroPlatformPanel
            collectionId={collectionId}
            platforms={platformContacts}
            selectedId={allegroPlatformId}
          />

          {/* The instance's own API access to the collector's Allegro account (#476). Below the
              platform picker because the picker is what names the marketplace at all, and a
              connection to an account the collection has no platform for would land nowhere. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Allegro account</h3>
          <AllegroConnectionPanel collectionId={collectionId} status={allegroConnection} />

          {/* What a listing is published *with* (#486). After the account because it is built from
              dictionaries only a connected account can be asked for — the order here is the order
              the setup actually happens in: name the platform, connect the account, then say what
              its listings carry. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Listing profiles</h3>
          <AllegroProfilesPanel
            collectionId={collectionId}
            list={allegroListingProfiles}
            connected={allegroConnection.connected && !allegroConnection.needsReconnect}
          />

          {/* What the app has *learned* rather than what the collector configured (#488). Last,
              because it fills itself in from publishing and is read here only to be corrected —
              a wrong association must never need a wrong listing to fix it. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Learned categories</h3>
          <AllegroCategoriesPanel
            collectionId={collectionId}
            list={allegroLearnedCategories}
            connected={allegroConnection.connected && !allegroConnection.needsReconnect}
          />
        </section>
      );
    case "delcampe":
      return (
        <section>
          {/* The same question the other two marketplace pages lead with (#608). Delcampe has no
              connection half to follow it: listings go up as an uploaded file, so what comes after
              naming the platform is what that file's rows carry. */}
          <h3 style={sectionHeadingStyle}>Delcampe platform</h3>
          <DelcampePlatformPanel
            collectionId={collectionId}
            platforms={platformContacts}
            selectedId={delcampePlatformId}
          />

          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Listing profiles</h3>
          <DelcampeProfilesPanel collectionId={collectionId} list={delcampeListingProfiles} />

          {/* Third and last, for the Allegro page's reason (#609): a profile is what the collector
              configures, and this is what the app has learned — read here only to be corrected, and
              to say how current Delcampe's own category list is. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Categories</h3>
          <DelcampeCategoriesPanel list={delcampeLearnedCategories} />
        </section>
      );
    case "philasearch":
      // The whole page (#742): a marketplace this collection only bids on needs nothing else.
      return (
        <PhilasearchPlatformPanel
          collectionId={collectionId}
          platforms={platformContacts}
          selectedId={philasearchPlatformId}
        />
      );
    case "acceptance":
      // Written entirely in the Catalog group's three vocabularies — condition, certificate, format
      // (#533) — and it reads its own list client-side, being the same query the want form's picker
      // reads.
      return <AcceptanceProfilesPanel collectionId={collectionId} />;
    case "bids":
      return (
        <BidRecommendationPanel
          collectionId={collectionId}
          bidFloorPercent={bidFloorPercent}
          bidCeilingPercent={bidCeilingPercent}
          bidFallbackPercent={bidFallbackPercent}
        />
      );
    case "auction-reminder":
      return <AuctionReminderPanel collectionId={collectionId} settings={auctionReminder} />;
    case "colnect":
      return (
        <section>
          {/* Which platform is Colnect (#406) leads the page: the mappings below it only ever
              matter for offers headed there, and it is what switches the listing checks on. */}
          <h3 style={sectionHeadingStyle}>Colnect platform</h3>
          <ColnectPlatformPanel
            collectionId={collectionId}
            platforms={platformContacts}
            selectedId={colnectPlatformId}
          />

          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect catalog mapping</h3>
          <ColnectPanel
            collectionId={collectionId}
            initialMappings={initialColnectMappings}
            vendors={initialTree.map((v) => ({
              id: v.id,
              name: v.name,
              abbreviation: v.abbreviation,
            }))}
          />

          {/* The condition side of the same translation (#404): our grades → Colnect's fixed five.
              Same page as the catalog mapping because they answer one question — what our
              vocabulary is called on Colnect — and are set up in one sitting. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect condition mapping</h3>
          <ColnectConditionsPanel mappings={initialColnectConditionMappings} />

          {/* The third form of the same translation (#739): our four attribute dictionaries →
              the words Colnect prints. A field rather than a select, Colnect's side being open text
              — there is no list of every colour it names — and beside the two above it because a
              collector sets all three up in one sitting, looking at one catalogue page. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect attribute mapping</h3>
          <ColnectAttributesPanel lists={initialAttributes} />

          {/* The fourth translation on the page (#684), and the one that reads in the other
              direction: the two above say what our vocabulary is called on Colnect, this says what
              a list *of theirs* is a list of here. Last because it is what the export → compare →
              fix loop (#685–#690) is configured with, and that loop presupposes the rest. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect list sync</h3>
          <ColnectListsPanel collectionId={collectionId} mappings={initialColnectListMappings} />
        </section>
      );
    case "assistant":
      return (
        <AssistantPanel
          collectionId={collectionId}
          collectionName={collectionName}
          initialTokens={initialAssistantTokens}
        />
      );
    case "email":
      return <EmailPanel collectionId={collectionId} settings={mailSettings} />;
    default: {
      // Every entry has a body: a new one in `settings-nav.ts` without a case here does not compile.
      const unreachable: never = entryKey as never;
      return unreachable;
    }
  }
}
