"use client";

import { setAllegroPlatformAction } from "@/app/actions/allegro";
import type { AllegroConnectionStatus } from "@/lib/allegro-connection";
import type { AllegroListingProfileList } from "@/lib/allegro-listing-profile";
import type { AllegroLearnedCategoryList } from "@/lib/allegro-category";
import { MarketplacePlatformSelect } from "./marketplace-platform-select";
import { SettingsSummaryStrip, SettingsSummaryTile } from "./settings-summary-strip";
import { allegroSummary, type AllegroSettingsPart } from "./allegro-summary";
import { AllegroConnectionPanel } from "./allegro-connection-panel";
import { AllegroProfilesPanel } from "./allegro-profiles-panel";
import { AllegroCategoriesPanel } from "./allegro-categories-panel";

/*
 * Settings → Allegro (#1475): one entry with tabs inside — **Account**, **Listing profiles**,
 * **Categories** — under a summary strip, with the platform choice in the page header. Designed in
 * #1465 against a wireframe; one entry per panel was rejected, and so were tabs alone.
 *
 * The tabs keep the order the setup happens in: connect the account, say what its listings carry,
 * then read what publishing has taught. The platform choice is not a tab because the two later
 * tabs hang off it and the first does not: the connection is the collection's, while profiles and
 * categories are the Allegro platform's.
 */

interface AllegroData {
  connection: AllegroConnectionStatus;
  profiles: AllegroListingProfileList;
  categories: AllegroLearnedCategoryList;
}

/** The strip: each tile says where one tab stands and opens it. */
export function AllegroSummary({
  active,
  onOpen,
  ...data
}: AllegroData & { active: string | null; onOpen: (part: AllegroSettingsPart) => void }) {
  return (
    <SettingsSummaryStrip label="Allegro at a glance">
      {allegroSummary(data.connection, data.profiles, data.categories).map((tile) => (
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
  platforms,
  platformId,
  connection,
  profiles,
  categories,
}: AllegroData & {
  part: string | null;
  collectionId: string;
  platforms: { id: string; name: string }[];
  platformId: string | null;
}) {
  // A connection that has to be redone cannot read Allegro's dictionaries or its category tree, so
  // both later tabs treat it as no connection at all.
  const connected = connection.connected && !connection.needsReconnect;
  const noPlatform = <NoPlatform hasPlatforms={platforms.length > 0} />;
  return (
    <>
      <MarketplacePlatformSelect
        id="allegro-platform"
        ariaLabel="Allegro platform"
        platforms={platforms}
        selectedId={platformId}
        save={(contactId) => setAllegroPlatformAction(collectionId, contactId)}
      />
      {part === "profiles" ? (
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
      )}
    </>
  );
}

/** What the platform's tabs say before a platform is Allegro — and, with none, how to get one. */
function NoPlatform({ hasPlatforms }: { hasPlatforms: boolean }) {
  return (
    <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
      {hasPlatforms ? (
        <>
          Choose which of your platforms is Allegro at the top of this page. Listing profiles and
          learned categories belong to that platform.
        </>
      ) : (
        <>
          This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
          under <strong>Contacts</strong>, then choose it as Allegro at the top of this page.
        </>
      )}
    </p>
  );
}
