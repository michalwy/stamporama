"use client";

import { setColnectPlatformAction } from "@/app/actions/colnect";
import type { ColnectConditionMappingData, ColnectMappingData } from "@/lib/colnect";
import type { ColnectListMappingData } from "@/lib/colnect-list-sync";
import type { StampAttributeLists } from "@/lib/stamp-attributes";
import { MarketplacePlatformSelect } from "./marketplace-platform-select";
import { SettingsSummaryStrip, SettingsSummaryTile } from "./settings-summary-strip";
import { colnectSummary, type ColnectSettingsPart } from "./colnect-summary";
import { ColnectCatalogsPanel, type ColnectVendorOption } from "./colnect-catalogs-panel";
import { ColnectConditionsPanel } from "./colnect-conditions-panel";
import { ColnectAttributesPanel } from "./colnect-attributes-panel";
import { ColnectListsPanel } from "./colnect-lists-panel";

/*
 * Settings → Colnect (#1480): one entry with tabs inside — **Catalogs**, **Conditions**,
 * **Attributes**, **List sync** — under a summary strip, with the platform choice in the page header,
 * as Allegro has it (#1475). Designed in #1465.
 *
 * The first three tabs translate our vocabulary into Colnect's and are set up in one sitting,
 * looking at one catalogue page; List sync reads in the other direction — what a list *of theirs* is
 * a list of here — and presupposes the rest, so it comes last. None of the four hangs off the
 * platform choice: the mappings are the collection's, and naming the platform is what switches the
 * listing checks on (#406).
 */

/**
 * The mapping rows, never wider than this: a condition's name and its grade, or a value and its
 * Colnect word, read across one row, and on a wide window the two would sit a screen apart — #691's
 * stretched field in another form. Catalogs is list beside detail, which keeps that rule itself.
 */
const MAPPING_WIDTH = "56rem";

interface ColnectData {
  catalogs: ColnectMappingData[];
  conditions: ColnectConditionMappingData[];
  attributes: StampAttributeLists;
  lists: ColnectListMappingData[];
}

/** The strip: each tile says where one tab stands and opens it — the attributes' narrowed. */
export function ColnectSummary({
  active,
  onOpen,
  ...data
}: ColnectData & {
  active: string | null;
  onOpen: (part: ColnectSettingsPart, view?: Readonly<Record<string, string>>) => void;
}) {
  return (
    <SettingsSummaryStrip label="Colnect at a glance">
      {colnectSummary(data.catalogs, data.conditions, data.attributes, data.lists).map((tile) => (
        <SettingsSummaryTile
          key={tile.part}
          title={tile.title}
          figure={tile.figure}
          detail={tile.detail}
          active={tile.part === active}
          onOpen={() => onOpen(tile.part, tile.view)}
        />
      ))}
    </SettingsSummaryStrip>
  );
}

export function ColnectSettingsBody({
  part,
  collectionId,
  platforms,
  platformId,
  vendors,
  catalogs,
  conditions,
  attributes,
  lists,
}: ColnectData & {
  part: string | null;
  collectionId: string;
  platforms: { id: string; name: string }[];
  platformId: string | null;
  vendors: ColnectVendorOption[];
}) {
  return (
    <>
      <MarketplacePlatformSelect
        id="colnect-platform"
        ariaLabel="Colnect platform"
        platforms={platforms}
        selectedId={platformId}
        save={async (contactId) => {
          const result = await setColnectPlatformAction(collectionId, contactId);
          return result.status === "error" ? result : { status: "success" };
        }}
      />
      {/* With no platform to choose, the header has no select; the mappings still work without
          one, so this is a line above them rather than in their place. */}
      {platforms.length === 0 && (
        <p
          style={{
            margin: "0 0 1.25rem",
            color: "var(--color-text-muted)",
            fontSize: "0.875rem",
          }}
        >
          This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
          under <strong>Contacts</strong>, then choose it as Colnect at the top of this page.
        </p>
      )}
      {part === "conditions" ? (
        <div style={{ maxWidth: MAPPING_WIDTH }}>
          <ColnectConditionsPanel mappings={conditions} />
        </div>
      ) : part === "attributes" ? (
        <div style={{ maxWidth: MAPPING_WIDTH }}>
          <ColnectAttributesPanel lists={attributes} />
        </div>
      ) : part === "lists" ? (
        <div style={{ maxWidth: MAPPING_WIDTH }}>
          <ColnectListsPanel collectionId={collectionId} mappings={lists} />
        </div>
      ) : (
        <ColnectCatalogsPanel
          collectionId={collectionId}
          initialMappings={catalogs}
          vendors={vendors}
        />
      )}
    </>
  );
}
