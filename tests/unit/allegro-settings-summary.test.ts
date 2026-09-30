import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AllegroConnectionStatus } from "../../src/lib/allegro-connection";
import type {
  AllegroListingProfileData,
  AllegroListingProfileList,
} from "../../src/lib/allegro-listing-profile";
import type { AllegroLearnedCategoryList } from "../../src/lib/allegro-category";
import {
  ALLEGRO_CONNECTION_WORDS,
  NO_ALLEGRO_PLATFORM,
  allegroConnectionState,
  allegroSummary,
} from "../../src/app/c/[collectionSlug]/settings/allegro-summary";

/**
 * The Allegro page's summary strip (#1475): one tile per tab, and the connection flagged when it
 * needs the collector — not connected, or needing a reconnect — in the Account tab's own words.
 */

function connection(over: Partial<AllegroConnectionStatus> = {}): AllegroConnectionStatus {
  return {
    configured: true,
    clientId: "client",
    applicationName: null,
    hasClientSecret: true,
    sandbox: false,
    connected: true,
    accountLogin: "filatelista",
    lastRefreshedAt: null,
    expiresAt: null,
    needsReconnect: false,
    lastError: null,
    secretKeyConfigured: true,
    redirectUri: null,
    scopes: null,
    canPublishOffers: null,
    publishRefusedReason: null,
    ...over,
  };
}

function profile(name: string, isDefault = false): AllegroListingProfileData {
  return {
    id: name,
    platformId: "p",
    name,
    shippingRatesId: "r",
    shippingRatesName: null,
    handlingTime: "PT24H",
    durationLimit: null,
    autoRepublish: false,
    returnPolicyId: null,
    returnPolicyName: null,
    impliedWarrantyId: null,
    impliedWarrantyName: null,
    locationCountryCode: "PL",
    locationCity: "Kraków",
    locationPostCode: "30-001",
    invoiceType: "NO_INVOICE",
    isDefault,
  };
}

function profiles(list: AllegroListingProfileData[], platformId: string | null = "p") {
  return {
    platformId,
    platformName: platformId ? "Allegro" : null,
    profiles: list,
    defaultProfileId: list.find((p) => p.isDefault)?.id ?? null,
  } satisfies AllegroListingProfileList;
}

function categories(lessons: number, parameters: number, platformId: string | null = "p") {
  return {
    platformId,
    platformName: platformId ? "Allegro" : null,
    lessons: Array.from({ length: lessons }, () => ({})),
    parameters: Array.from({ length: parameters }, () => ({})),
  } as unknown as AllegroLearnedCategoryList;
}

function tiles(...args: Parameters<typeof allegroSummary>) {
  return allegroSummary(...args).map((t) => [t.part, t.figure, t.detail, t.flagged]);
}

describe("Allegro summary strip (#1475)", () => {
  it("has one tile per tab, in the tabs' order", () => {
    const parts = allegroSummary(connection(), profiles([]), categories(0, 0)).map((t) => t.part);
    assert.deepEqual(parts, ["account", "profiles", "categories"]);
  });

  it("says who the connection is and does not flag a working one", () => {
    assert.deepEqual(tiles(connection(), profiles([]), categories(0, 0))[0], [
      "account",
      "Connected",
      "as filatelista",
      false,
    ]);
    assert.deepEqual(
      tiles(connection({ accountLogin: null, sandbox: true }), profiles([]), categories(0, 0))[0],
      ["account", "Connected", "sandbox", false]
    );
  });

  it("flags a connection that is missing or has to be redone", () => {
    const none = connection({ connected: false, accountLogin: null });
    assert.deepEqual(tiles(none, profiles([]), categories(0, 0))[0], [
      "account",
      "Not connected yet",
      null,
      true,
    ]);
    const unsaved = connection({ configured: false, connected: false });
    assert.deepEqual(tiles(unsaved, profiles([]), categories(0, 0))[0], [
      "account",
      "Not connected yet",
      "No application saved",
      true,
    ]);
    // A stored grant Allegro refused to renew is not a working connection.
    const expired = connection({ needsReconnect: true });
    assert.equal(allegroConnectionState(expired), "needs-reconnect");
    assert.deepEqual(tiles(expired, profiles([]), categories(0, 0))[0], [
      "account",
      "Needs reconnecting",
      null,
      true,
    ]);
  });

  it("uses the Account tab's words for every state", () => {
    const states = [connection(), connection({ connected: false }), connection({ needsReconnect: true })];
    for (const c of states) {
      const [tile] = allegroSummary(c, profiles([]), categories(0, 0));
      assert.equal(tile.figure, ALLEGRO_CONNECTION_WORDS[allegroConnectionState(c)]);
    }
  });

  it("counts the profiles and names the default", () => {
    assert.deepEqual(
      tiles(connection(), profiles([profile("Home", true), profile("Away")]), categories(0, 0))[1],
      ["profiles", "2 profiles", "Default: Home", false]
    );
    assert.deepEqual(tiles(connection(), profiles([profile("Home")]), categories(0, 0))[1], [
      "profiles",
      "1 profile",
      "No default",
      false,
    ]);
    assert.deepEqual(tiles(connection(), profiles([]), categories(0, 0))[1], [
      "profiles",
      "0 profiles",
      null,
      false,
    ]);
  });

  it("counts what publishing has taught", () => {
    assert.deepEqual(tiles(connection(), profiles([]), categories(1, 3))[2], [
      "categories",
      "1 category learned",
      "3 parameter answers",
      false,
    ]);
  });

  it("says so on the platform's tiles while no platform is Allegro", () => {
    const [, p, c] = tiles(connection(), profiles([], null), categories(0, 0, null));
    assert.deepEqual(p, ["profiles", NO_ALLEGRO_PLATFORM, null, false]);
    assert.deepEqual(c, ["categories", NO_ALLEGRO_PLATFORM, null, false]);
  });
});
