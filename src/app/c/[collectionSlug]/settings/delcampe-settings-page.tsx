"use client";

import { setDelcampePlatformAction } from "@/app/actions/delcampe";
import type { DelcampeListingProfileList } from "@/lib/delcampe-listing-profile";
import type { DelcampeLearnedCategoryList } from "@/lib/delcampe-categories";
import { MarketplacePlatformSelect } from "./marketplace-platform-select";
import { SettingsSummaryStrip, SettingsSummaryTile } from "./settings-summary-strip";
import { delcampeSummary, type DelcampeSettingsPart } from "./delcampe-summary";
import { DelcampeProfilesPanel } from "./delcampe-profiles-panel";
import { DelcampeCategoriesPanel } from "./delcampe-categories-panel";

/*
 * Settings → Delcampe (#1479): one entry with tabs inside — **Listing profiles**, **Categories** —
 * under a summary strip, with the platform choice in the page header. Designed in #1465 beside the
 * Allegro page (#1475), whose pieces it takes.
 *
 * Profiles first, for the Allegro page's reason: a profile is what the collector *configures*, and
 * the categories are what the app has *learned*. Delcampe has no account tab to lead with — listings
 * go up as an uploaded file, so there is no connection to make.
 */

interface DelcampeData {
  profiles: DelcampeListingProfileList;
  categories: DelcampeLearnedCategoryList;
}

/** The strip: each tile says where one tab stands and opens it. */
export function DelcampeSummary({
  active,
  onOpen,
  ...data
}: DelcampeData & { active: string | null; onOpen: (part: DelcampeSettingsPart) => void }) {
  return (
    <SettingsSummaryStrip label="Delcampe at a glance">
      {delcampeSummary(data.profiles, data.categories, (iso) =>
        new Date(iso).toLocaleDateString()
      ).map((tile) => (
        <SettingsSummaryTile
          key={tile.part}
          title={tile.title}
          figure={tile.figure}
          detail={tile.detail}
          active={tile.part === active}
          onOpen={() => onOpen(tile.part)}
        />
      ))}
    </SettingsSummaryStrip>
  );
}

export function DelcampeSettingsBody({
  part,
  collectionId,
  platforms,
  platformId,
  profiles,
  categories,
}: DelcampeData & {
  part: string | null;
  collectionId: string;
  platforms: { id: string; name: string }[];
  platformId: string | null;
}) {
  const noPlatform = <NoPlatform hasPlatforms={platforms.length > 0} />;
  return (
    <>
      <MarketplacePlatformSelect
        id="delcampe-platform"
        ariaLabel="Delcampe platform"
        platforms={platforms}
        selectedId={platformId}
        save={(contactId) => setDelcampePlatformAction(collectionId, contactId)}
      />
      {part === "categories" ? (
        <DelcampeCategoriesPanel list={categories} noPlatform={noPlatform} />
      ) : (
        <DelcampeProfilesPanel
          collectionId={collectionId}
          list={profiles}
          noPlatform={noPlatform}
        />
      )}
    </>
  );
}

/** What the platform's tabs say before a platform is Delcampe — and, with none, how to get one. */
function NoPlatform({ hasPlatforms }: { hasPlatforms: boolean }) {
  return (
    <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
      {hasPlatforms ? (
        <>
          Choose which of your platforms is Delcampe at the top of this page. Listing profiles and
          learned categories belong to that platform.
        </>
      ) : (
        <>
          This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
          under <strong>Contacts</strong>, then choose it as Delcampe at the top of this page.
        </>
      )}
    </p>
  );
}
