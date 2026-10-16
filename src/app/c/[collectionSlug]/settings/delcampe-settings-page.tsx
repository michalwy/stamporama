"use client";

import type { DelcampeListingProfileList } from "@/lib/delcampe-listing-profile";
import type { DelcampeLearnedCategoryList } from "@/lib/delcampe-categories";
import type { PlatformListItem } from "@/lib/platforms";
import { ModulePlatformTab } from "./module-platform-tab";
import { SettingsSummaryStrip, SettingsSummaryTile } from "./settings-summary-strip";
import { delcampeSummary, type DelcampeSettingsPart } from "./delcampe-summary";
import { DelcampeProfilesPanel } from "./delcampe-profiles-panel";
import { DelcampeCategoriesPanel } from "./delcampe-categories-panel";

/*
 * Settings → Delcampe (#1479): one entry with tabs inside — **Listing profiles**, **Categories**,
 * **Platform** — under a summary strip. Designed in #1465 beside the Allegro page (#1475), whose
 * pieces it takes. The Platform tab (#1955) is the Delcampe platform's own settings and its on/off
 * switch; it replaced the choice of which contact was Delcampe.
 *
 * Profiles first, for the Allegro page's reason: a profile is what the collector *configures*, and
 * the categories are what the app has *learned*. Delcampe has no account tab to lead with — listings
 * go up as an uploaded file, so there is no connection to make.
 */

interface DelcampeData {
  profiles: DelcampeListingProfileList;
  categories: DelcampeLearnedCategoryList;
  /** The Delcampe platform (#1955) — the Platform tab's, and the strip's last tile. */
  platform: PlatformListItem;
}

/** The strip: each tile says where one tab stands and opens it. */
export function DelcampeSummary({
  active,
  onOpen,
  ...data
}: DelcampeData & { active: string | null; onOpen: (part: DelcampeSettingsPart) => void }) {
  return (
    <SettingsSummaryStrip label="Delcampe at a glance">
      {delcampeSummary(
        data.profiles,
        data.categories,
        (iso) => new Date(iso).toLocaleDateString(),
        data.platform
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
  platform,
  profiles,
  categories,
}: DelcampeData & {
  part: string | null;
  collectionId: string;
}) {
  const noPlatform = <NoPlatform />;
  return part === "platform" ? (
    <ModulePlatformTab collectionId={collectionId} platform={platform} />
  ) : part === "categories" ? (
    <DelcampeCategoriesPanel list={categories} noPlatform={noPlatform} />
  ) : (
    <DelcampeProfilesPanel collectionId={collectionId} list={profiles} noPlatform={noPlatform} />
  );
}

/** What a tab hanging off the platform says while the collection has no Delcampe platform yet — a
 *  state the settings page's own loader closes by making it (#1955), so it is seldom seen. */
function NoPlatform() {
  return (
    <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
      The Delcampe platform is not set up yet. Reload the page to create it.
    </p>
  );
}
