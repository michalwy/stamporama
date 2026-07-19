"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { SettingsPanel } from "./settings-panel";
import { CatalogPanel } from "../catalog/catalog-panel";
import { AreasPanel } from "../areas/areas-panel";
import { ConditionsPanel } from "./conditions-panel";
import { CertificateStatusesPanel } from "./certificate-statuses-panel";
import { SubtypesPanel } from "./subtypes-panel";
import type { CollectionAreaData } from "@/lib/areas";
import type { CatalogNameFlat, CatalogVendorData } from "@/lib/catalog";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampSubtypeData } from "@/lib/subtypes";

interface SettingsTabsProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  catalogNames: CatalogNameFlat[];
  initialTree: CatalogVendorData[];
  initialConditions: StampConditionData[];
  initialCertificateStatuses: CertificateStatusData[];
  initialSubtypes: StampSubtypeData[];
  appVersion: string;
}

const TABS = [
  { key: "general", label: "General" },
  { key: "catalogs", label: "Catalogs" },
  { key: "conditions", label: "Conditions" },
  { key: "subtypes", label: "Subtypes" },
  { key: "areas", label: "Areas" },
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
  collectionSlug,
  initialAreas,
  catalogNames,
  initialTree,
  initialConditions,
  initialCertificateStatuses,
  initialSubtypes,
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
    rawTab === "subtypes"
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
            />
          </section>
          <section>
            <h2 style={sectionHeadingStyle}>Certificate statuses</h2>
            <CertificateStatusesPanel
              collectionId={collectionId}
              initialStatuses={initialCertificateStatuses}
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
          />
        </section>
      )}
      {activeTab === "areas" && (
        <AreasPanel
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          initialAreas={initialAreas}
          catalogNames={catalogNames}
        />
      )}
    </div>
  );
}
