"use client";

import type { ColnectConditionMappingData, ColnectMappingData } from "@/lib/colnect";
import type { ColnectListMappingData } from "@/lib/colnect-list-sync";
import type { StampAttributeLists } from "@/lib/stamp-attributes";
import type { PlatformListItem } from "@/lib/platforms";
import { ModulePlatformTab } from "./module-platform-tab";
import { SettingsSummaryStrip, SettingsSummaryTile } from "./settings-summary-strip";
import { colnectSummary, type ColnectSettingsPart } from "./colnect-summary";
import { ColnectCatalogsPanel, type ColnectVendorOption } from "./colnect-catalogs-panel";
import { ColnectConditionsPanel } from "./colnect-conditions-panel";
import { ColnectAttributesPanel } from "./colnect-attributes-panel";
import { ColnectListsPanel } from "./colnect-lists-panel";

/*
 * Settings → Colnect (#1480): one entry with tabs inside — **Catalogs**, **Conditions**,
 * **Attributes**, **List sync**, **Platform** — under a summary strip, as Allegro has it (#1475).
 * Designed in #1465. The Platform tab (#1955) is the Colnect platform's own settings and its on/off
 * switch; it replaced the choice of which contact was Colnect.
 *
 * The first three tabs translate our vocabulary into Colnect's and are set up in one sitting,
 * looking at one catalogue page; List sync reads in the other direction — what a list *of theirs* is
 * a list of here — and presupposes the rest, so it comes last. None of the four hangs off the
 * platform: the mappings are the collection's, and an offer on the Colnect platform is what the
 * listing checks are asked of (#406).
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
  /** The Colnect platform (#1955) — the Platform tab's, and the strip's last tile. */
  platform: PlatformListItem;
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
      {colnectSummary(data.catalogs, data.conditions, data.attributes, data.lists, data.platform).map((tile) => (
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
  platform,
  vendors,
  catalogs,
  conditions,
  attributes,
  lists,
}: ColnectData & {
  part: string | null;
  collectionId: string;
  vendors: ColnectVendorOption[];
}) {
  return (
    <>
      {part === "platform" ? (
        <ModulePlatformTab collectionId={collectionId} platform={platform} />
      ) : part === "conditions" ? (
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
