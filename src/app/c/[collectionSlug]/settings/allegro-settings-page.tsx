"use client";

import type { AllegroConnectionStatus } from "@/lib/allegro-connection";
import type { AllegroListingProfileList } from "@/lib/allegro-listing-profile";
import type { AllegroLearnedCategoryList } from "@/lib/allegro-category";
import type { PlatformListItem } from "@/lib/platforms";
import { ModulePlatformTab } from "./module-platform-tab";
import { SettingsSummaryStrip, SettingsSummaryTile } from "./settings-summary-strip";
import { allegroSummary, type AllegroSettingsPart } from "./allegro-summary";
import { AllegroConnectionPanel } from "./allegro-connection-panel";
import { AllegroProfilesPanel } from "./allegro-profiles-panel";
import { AllegroCategoriesPanel } from "./allegro-categories-panel";

/*
 * Settings → Allegro (#1475): one entry with tabs inside — **Account**, **Listing profiles**,
 * **Categories**, **Platform** — under a summary strip. Designed in #1465 against a wireframe; one
 * entry per panel was rejected, and so were tabs alone.
 *
 * The tabs keep the order the setup happens in: connect the account, say what its listings carry,
 * then read what publishing has taught. The Platform tab (#1955) is the Allegro platform's own
 * settings and its on/off switch; it replaced the choice of which contact was Allegro.
 */

interface AllegroData {
  connection: AllegroConnectionStatus;
  profiles: AllegroListingProfileList;
  categories: AllegroLearnedCategoryList;
  /** The Allegro platform (#1955) — the Platform tab's, and the strip's last tile. */
  platform: PlatformListItem;
}

/** The strip: each tile says where one tab stands and opens it. */
export function AllegroSummary({
  active,
  onOpen,
  ...data
}: AllegroData & { active: string | null; onOpen: (part: AllegroSettingsPart) => void }) {
  return (
    <SettingsSummaryStrip label="Allegro at a glance">
      {allegroSummary(data.connection, data.profiles, data.categories, data.platform).map((tile) => (
        <SettingsSummaryTile
          key={tile.part}
          title={tile.title}
          figure={tile.figure}
          detail={tile.detail}
          flagged={tile.flagged}
          active={tile.part === active}
          onOpen={() => onOpen(tile.part)}
        />
      ))}
    </SettingsSummaryStrip>
  );
}

export function AllegroSettingsBody({
  part,
  collectionId,
  platform,
  connection,
  profiles,
  categories,
}: AllegroData & {
  part: string | null;
  collectionId: string;
}) {
  // A connection that has to be redone cannot read Allegro's dictionaries or its category tree, so
  // both later tabs treat it as no connection at all.
  const connected = connection.connected && !connection.needsReconnect;
  const noPlatform = <NoPlatform />;
  return part === "platform" ? (
    <ModulePlatformTab collectionId={collectionId} platform={platform} />
  ) : part === "profiles" ? (
    <AllegroProfilesPanel
      collectionId={collectionId}
      list={profiles}
      connected={connected}
      noPlatform={noPlatform}
    />
  ) : part === "categories" ? (
    <AllegroCategoriesPanel
      collectionId={collectionId}
      list={categories}
      connected={connected}
      noPlatform={noPlatform}
    />
  ) : (
    <AllegroConnectionPanel collectionId={collectionId} status={connection} />
  );
}

/** What a tab hanging off the platform says while the collection has no Allegro platform yet — a
 *  state the settings page's own loader closes by making it (#1955), so it is seldom seen. */
function NoPlatform() {
  return (
    <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
      The Allegro platform is not set up yet. Reload the page to create it.
    </p>
  );
}
