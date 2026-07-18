"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { SettingsPanel } from "./settings-panel";
import { CatalogPanel } from "../catalog/catalog-panel";
import { AreasPanel } from "../areas/areas-panel";
import type { CollectionAreaData } from "@/lib/areas";
import type { CatalogNameFlat, CatalogVendorData } from "@/lib/catalog";

interface SettingsTabsProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  catalogNames: CatalogNameFlat[];
  initialTree: CatalogVendorData[];
}

const TABS = [
  { key: "general", label: "General" },
  { key: "catalogs", label: "Catalogs" },
  { key: "areas", label: "Areas" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function SettingsTabs({
  collectionId,
  collectionName,
  baseCurrency,
  collectionSlug,
  initialAreas,
  catalogNames,
  initialTree,
}: SettingsTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = searchParams.get("tab");
  const activeTab: TabKey =
    rawTab === "catalogs" || rawTab === "areas" ? rawTab : "general";

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
        />
      )}
      {activeTab === "catalogs" && (
        <CatalogPanel collectionId={collectionId} initialTree={initialTree} />
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
