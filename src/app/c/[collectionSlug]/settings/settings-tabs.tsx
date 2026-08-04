"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { SettingsPanel } from "./settings-panel";
import { CatalogPanel } from "../catalog/catalog-panel";
import { AreasPanel } from "../areas/areas-panel";
import { ConditionsPanel } from "./conditions-panel";
import { CertificateStatusesPanel } from "./certificate-statuses-panel";
import { FormatsPanel } from "./formats-panel";
import { FormatFactorsPanel } from "./format-factors-panel";
import { SubtypesPanel } from "./subtypes-panel";
import { DuplicatesPanel } from "./duplicates-panel";
import { ColnectPanel } from "./colnect-panel";
import { ColnectConditionsPanel } from "./colnect-conditions-panel";
import { ColnectPlatformPanel } from "./colnect-platform-panel";
import { AllegroPlatformPanel } from "./allegro-platform-panel";
import { AllegroConnectionPanel } from "./allegro-connection-panel";
import { AllegroProfilesPanel } from "./allegro-profiles-panel";
import { CollageTemplatesPanel } from "./collage-templates-panel";
import { AssistantPanel } from "./assistant-panel";
import type { DuplicateCatalogMode } from "@/lib/duplicate-catalog";
import type { CollectionAreaData } from "@/lib/areas";
import type { CatalogNameFlat, CatalogVendorData } from "@/lib/catalog";
import type { ColnectMappingData, ColnectConditionMappingData } from "@/lib/colnect";
import type { AssistantTokenData } from "@/lib/api-tokens";
import type { StampConditionData } from "@/lib/conditions";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { FormatFactorData } from "@/lib/format-factors";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampSubtypeData } from "@/lib/subtypes";
import type { CollageTemplateData } from "@/lib/collage-templates";
import type { AllegroConnectionStatus } from "@/lib/allegro-connection";
import type { AllegroListingProfileList } from "@/lib/allegro-listing-profile";

interface SettingsTabsProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  /** The collection's default language (#293), edited in the General tab. */
  defaultLanguage: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  catalogNames: CatalogNameFlat[];
  /** Listing languages in use across the collection's platforms (#293); drives the per-language
   * title-name inputs on the area form. */
  titleLanguages: string[];
  initialTree: CatalogVendorData[];
  initialConditions: StampConditionData[];
  initialFormats: StampFormatData[];
  initialFormatFactors: FormatFactorData[];
  initialCertificateStatuses: CertificateStatusData[];
  initialSubtypes: StampSubtypeData[];
  initialCollageTemplates: CollageTemplateData[];
  initialColnectMappings: ColnectMappingData[];
  /** Every condition with the Colnect grade it maps to (#404) — one row each, mapped or not. */
  initialColnectConditionMappings: ColnectConditionMappingData[];
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
  /** Every platform contact, for that picker. */
  platformContacts: { id: string; name: string }[];
  initialAssistantTokens: AssistantTokenData[];
  /** Internal copy-number display width (#268), edited on the General tab. */
  itemNoPad: number;
  duplicateCatalogMode: DuplicateCatalogMode;
  photoStorageBytes: number;
  appVersion: string;
}

const TABS = [
  { key: "general", label: "General" },
  { key: "catalogs", label: "Catalogs" },
  { key: "conditions", label: "Conditions & formats" },
  { key: "subtypes", label: "Subtypes" },
  { key: "areas", label: "Areas" },
  { key: "collages", label: "Collage templates" },
  { key: "duplicates", label: "Duplicates" },
  { key: "colnect", label: "Colnect" },
  { key: "allegro", label: "Allegro" },
  { key: "assistant", label: "Assistant" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: "0 0 1rem",
};

export function SettingsTabs({
  collectionId,
  collectionName,
  baseCurrency,
  defaultLanguage,
  collectionSlug,
  initialAreas,
  catalogNames,
  titleLanguages,
  initialTree,
  initialConditions,
  initialFormats,
  initialFormatFactors,
  initialCertificateStatuses,
  initialSubtypes,
  initialCollageTemplates,
  initialColnectMappings,
  initialColnectConditionMappings,
  colnectPlatformId,
  allegroPlatformId,
  allegroConnection,
  allegroListingProfiles,
  platformContacts,
  initialAssistantTokens,
  itemNoPad,
  duplicateCatalogMode,
  photoStorageBytes,
  appVersion,
}: SettingsTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = searchParams.get("tab");
  const activeTab: TabKey =
    rawTab === "catalogs" ||
    rawTab === "areas" ||
    rawTab === "conditions" ||
    rawTab === "subtypes" ||
    rawTab === "collages" ||
    rawTab === "duplicates" ||
    rawTab === "colnect" ||
    rawTab === "allegro" ||
    rawTab === "assistant"
      ? rawTab
      : "general";

  function setTab(tab: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "general") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "0",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: "1.5rem",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            style={{
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: activeTab === tab.key ? 600 : 400,
              color:
                activeTab === tab.key
                  ? "var(--color-accent)"
                  : "var(--color-text-secondary)",
              background: "transparent",
              border: "none",
              borderBottom:
                activeTab === tab.key
                  ? "2px solid var(--color-accent)"
                  : "2px solid transparent",
              cursor: "pointer",
              marginBottom: "-1px",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <SettingsPanel
          collectionId={collectionId}
          collectionName={collectionName}
          baseCurrency={baseCurrency}
          defaultLanguage={defaultLanguage}
          itemNoPad={itemNoPad}
          photoStorageBytes={photoStorageBytes}
          appVersion={appVersion}
        />
      )}
      {activeTab === "catalogs" && (
        <CatalogPanel collectionId={collectionId} initialTree={initialTree} />
      )}
      {activeTab === "conditions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          <section>
            <h2 style={sectionHeadingStyle}>Conditions</h2>
            <ConditionsPanel
              collectionId={collectionId}
              initialConditions={initialConditions}
              titleLanguages={titleLanguages}
              defaultLanguage={defaultLanguage}
            />
          </section>
          <section>
            <h2 style={sectionHeadingStyle}>Certificate statuses</h2>
            <CertificateStatusesPanel
              collectionId={collectionId}
              initialStatuses={initialCertificateStatuses}
              titleLanguages={titleLanguages}
              defaultLanguage={defaultLanguage}
            />
          </section>
          {/* Formats sit here, not on a tab of their own: condition, certificate and format are
              the three axes of one catalog price, and they are set up together, once. */}
          <section>
            <h2 style={sectionHeadingStyle}>Formats</h2>
            <FormatsPanel
              collectionId={collectionId}
              initialFormats={initialFormats}
              titleLanguages={titleLanguages}
              defaultLanguage={defaultLanguage}
            />
          </section>
          <section>
            <h2 style={sectionHeadingStyle}>Format multipliers</h2>
            <FormatFactorsPanel
              collectionId={collectionId}
              initialFactors={initialFormatFactors}
              formats={initialFormats}
              conditions={initialConditions}
              areas={initialAreas}
            />
          </section>
        </div>
      )}
      {activeTab === "subtypes" && (
        <section>
          <h2 style={sectionHeadingStyle}>Subtypes</h2>
          <SubtypesPanel
            collectionId={collectionId}
            initialSubtypes={initialSubtypes}
            titleLanguages={titleLanguages}
            defaultLanguage={defaultLanguage}
          />
        </section>
      )}
      {activeTab === "areas" && (
        <AreasPanel
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          initialAreas={initialAreas}
          catalogNames={catalogNames}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      )}
      {activeTab === "collages" && (
        <section>
          <h2 style={sectionHeadingStyle}>Collage templates</h2>
          <CollageTemplatesPanel
            collectionId={collectionId}
            initialTemplates={initialCollageTemplates}
          />
        </section>
      )}
      {activeTab === "duplicates" && (
        <section>
          <h2 style={sectionHeadingStyle}>Duplicate catalog numbers</h2>
          <DuplicatesPanel
            collectionId={collectionId}
            collectionSlug={collectionSlug}
            initialMode={duplicateCatalogMode}
          />
        </section>
      )}
      {activeTab === "colnect" && (
        <section>
          {/* Which platform is Colnect (#406) leads the tab: the two mappings below it only ever
              matter for offers headed there, and it is what switches the listing checks on. */}
          <h2 style={sectionHeadingStyle}>Colnect platform</h2>
          <ColnectPlatformPanel
            collectionId={collectionId}
            platforms={platformContacts}
            selectedId={colnectPlatformId}
          />

          <h2 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect catalog mapping</h2>
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
              Same tab as the catalog mapping because they answer one question — what our vocabulary
              is called on Colnect — and are set up in one sitting. */}
          <h2 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect condition mapping</h2>
          <ColnectConditionsPanel mappings={initialColnectConditionMappings} />
        </section>
      )}
      {activeTab === "allegro" && (
        <section>
          {/* One setting, and the tab is named after the marketplace it answers for — the same
              question the Colnect tab leads with, asked separately because a collection may well buy
              on one platform and sell on another. */}
          <h2 style={sectionHeadingStyle}>Allegro platform</h2>
          <AllegroPlatformPanel
            collectionId={collectionId}
            platforms={platformContacts}
            selectedId={allegroPlatformId}
          />

          {/* The instance's own API access to the collector's Allegro account (#476). Below the
              platform picker because the picker is what names the marketplace at all, and a
              connection to an account the collection has no platform for would land nowhere. */}
          <h2 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Allegro account</h2>
          <AllegroConnectionPanel
            collectionId={collectionId}
            status={allegroConnection}
          />

          {/* What a listing is published *with* (#486). Last on the tab because it is built from
              dictionaries only a connected account can be asked for — the order here is the order
              the setup actually happens in: name the platform, connect the account, then say what
              its listings carry. */}
          <h2 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Listing profiles</h2>
          <AllegroProfilesPanel
            collectionId={collectionId}
            list={allegroListingProfiles}
            connected={allegroConnection.connected && !allegroConnection.needsReconnect}
          />
        </section>
      )}
      {activeTab === "assistant" && (
        <AssistantPanel
          collectionId={collectionId}
          collectionName={collectionName}
          initialTokens={initialAssistantTokens}
        />
      )}
    </div>
  );
}
