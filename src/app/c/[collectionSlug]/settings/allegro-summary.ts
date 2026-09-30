/**
 * What the Allegro page's summary strip says (#1475), kept apart from the components so it can be
 * tested without rendering anything.
 *
 * Three tiles, one per tab: the connection's state, the listing profiles (how many, which is the
 * default) and the categories learned. **A connection that needs attention is flagged on its tile**
 * — not connected, or needing a reconnect — in the words the Account tab itself uses, so the strip
 * and the tab cannot describe one connection two ways.
 */

import type { AllegroConnectionStatus } from "@/lib/allegro-connection";
import type { AllegroListingProfileList } from "@/lib/allegro-listing-profile";
import type { AllegroLearnedCategoryList } from "@/lib/allegro-category";

/** The Allegro page's tabs, in their order; the first is the default and the sign-in callback's. */
export const ALLEGRO_SETTINGS_PARTS = [
  { key: "account", label: "Account" },
  { key: "profiles", label: "Listing profiles" },
  { key: "categories", label: "Categories" },
] as const;

export type AllegroSettingsPart = (typeof ALLEGRO_SETTINGS_PARTS)[number]["key"];

export type AllegroConnectionState = "connected" | "needs-reconnect" | "not-connected";

/**
 * Where the connection stands. A grant Allegro refused to renew is *needs reconnecting* even though
 * one is stored — every call made with it would fail — and that is the expired case the tile flags.
 */
export function allegroConnectionState(status: AllegroConnectionStatus): AllegroConnectionState {
  if (status.needsReconnect) return "needs-reconnect";
  return status.connected ? "connected" : "not-connected";
}

/** The state in words — the Account tab's heading line and the tile's figure alike. */
export const ALLEGRO_CONNECTION_WORDS: Record<AllegroConnectionState, string> = {
  connected: "Connected",
  "needs-reconnect": "Needs reconnecting",
  "not-connected": "Not connected yet",
};

export interface AllegroSummaryTile {
  part: AllegroSettingsPart;
  title: string;
  figure: string;
  /** A second, muted line, or null. */
  detail: string | null;
  /** Needs the collector: drawn in the warning tone. */
  flagged: boolean;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Said on the platform's two tiles while no platform is Allegro — nothing hangs off it yet. */
export const NO_ALLEGRO_PLATFORM = "Platform not chosen";

export function allegroSummary(
  connection: AllegroConnectionStatus,
  profiles: AllegroListingProfileList,
  categories: AllegroLearnedCategoryList
): AllegroSummaryTile[] {
  const state = allegroConnectionState(connection);
  const account: AllegroSummaryTile = {
    part: "account",
    title: "Account",
    figure: ALLEGRO_CONNECTION_WORDS[state],
    detail:
      state === "connected"
        ? [
            connection.accountLogin && `as ${connection.accountLogin}`,
            connection.sandbox && "sandbox",
          ]
            .filter(Boolean)
            .join(" · ") || null
        : !connection.configured
          ? "No application saved"
          : null,
    flagged: state !== "connected",
  };

  const defaultProfile = profiles.profiles.find((p) => p.isDefault) ?? null;
  const profileTile: AllegroSummaryTile = {
    part: "profiles",
    title: "Listing profiles",
    figure: profiles.platformId
      ? count(profiles.profiles.length, "profile", "profiles")
      : NO_ALLEGRO_PLATFORM,
    detail: !profiles.platformId
      ? null
      : defaultProfile
        ? `Default: ${defaultProfile.name}`
        : profiles.profiles.length > 0
          ? "No default"
          : null,
    flagged: false,
  };

  const categoryTile: AllegroSummaryTile = {
    part: "categories",
    title: "Categories",
    figure: categories.platformId
      ? count(categories.lessons.length, "category learned", "categories learned")
      : NO_ALLEGRO_PLATFORM,
    detail: categories.platformId
      ? count(categories.parameters.length, "parameter answer", "parameter answers")
      : null,
    flagged: false,
  };

  return [account, profileTile, categoryTile];
}
