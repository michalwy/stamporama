import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLEGRO_PLATFORM_MODULE,
  COLNECT_PLATFORM_MODULE,
  DELCAMPE_PLATFORM_MODULE,
  PHILASEARCH_PLATFORM_MODULE,
  captureModuleRules,
  hasListingModule,
  listingModuleRules,
  supportsAssistantClose,
  usesPlatformCatalogue,
  usesPlatformConditions,
} from "../../src/lib/platform-modules";

describe("listingModuleRules", () => {
  it("gives Colnect both of its own rules, and names where grades are mapped", () => {
    const rules = listingModuleRules(COLNECT_PLATFORM_MODULE);
    assert.ok(rules);
    assert.equal(rules.requiresCatalogItemId, true);
    assert.equal(rules.requiresPlatformCondition, true);
    assert.equal(rules.conditionMappingLocation, "Settings → Colnect");
  });

  it("answers null for a platform naming no module at all", () => {
    assert.equal(listingModuleRules(null), null);
    assert.equal(hasListingModule(null), false);
  });

  it("answers null for a module id nothing here can list to (#471)", () => {
    // A module may exist for another half entirely — Allegro's carried capture alone (#355) — and
    // must not inherit Colnect's rules by existing.
    assert.equal(listingModuleRules("captures-only"), null);
    assert.equal(hasListingModule("captures-only"), false);
  });

  it("keeps the catalogue and the grades as two questions, asked of the module", () => {
    assert.equal(usesPlatformCatalogue(COLNECT_PLATFORM_MODULE), true);
    assert.equal(usesPlatformConditions(COLNECT_PLATFORM_MODULE), true);
    // Allegro lists — and asks for neither (#493): a category is not a catalogue, and the condition
    // is one of that category's own parameters.
    assert.equal(hasListingModule(ALLEGRO_PLATFORM_MODULE), true);
    assert.equal(usesPlatformCatalogue(ALLEGRO_PLATFORM_MODULE), false);
    assert.equal(usesPlatformConditions(ALLEGRO_PLATFORM_MODULE), false);
  });
});

describe("supportsAssistantClose (#729)", () => {
  it("answers for Colnect, whose sale code is what a close names", () => {
    assert.equal(supportsAssistantClose(COLNECT_PLATFORM_MODULE), true);
  });

  it("answers no for every other marketplace, listable or not", () => {
    // Allegro can be listed to through the Assistant (#493) and still gains no close with it.
    assert.equal(supportsAssistantClose(ALLEGRO_PLATFORM_MODULE), false);
    assert.equal(supportsAssistantClose(DELCAMPE_PLATFORM_MODULE), false);
    assert.equal(supportsAssistantClose(null), false);
  });
});

describe("captureModuleRules (#742)", () => {
  it("keeps Allegro's capture exactly as #355 wrote it", () => {
    const rules = captureModuleRules(ALLEGRO_PLATFORM_MODULE);
    assert.ok(rules);
    assert.equal(rules.lotNoIsListingId, true);
    assert.equal(rules.observesCurrentBid, true);
    assert.equal(rules.readsMyBid, false);
    assert.equal(rules.parcelIsNamedSale, false);
    assert.equal(rules.settingsLocation, "Settings → Allegro");
  });

  it("answers every one of the three the other way for a house aggregator", () => {
    // The house's `Lot 1` is in every sale; the page shows the collector's own written bid and never a
    // standing one; and the parcel is the house's sale the page names.
    const rules = captureModuleRules(PHILASEARCH_PLATFORM_MODULE);
    assert.ok(rules);
    assert.equal(rules.lotNoIsListingId, false);
    assert.equal(rules.observesCurrentBid, false);
    assert.equal(rules.readsMyBid, true);
    assert.equal(rules.parcelIsNamedSale, true);
    assert.equal(rules.settingsLocation, "Settings → Philasearch");
  });

  it("answers null for a marketplace nothing here captures from", () => {
    // Colnect and Delcampe are modules of their own and capture nothing; an absent module is not
    // silently Allegro either.
    assert.equal(captureModuleRules(COLNECT_PLATFORM_MODULE), null);
    assert.equal(captureModuleRules(DELCAMPE_PLATFORM_MODULE), null);
    assert.equal(captureModuleRules(null), null);
    assert.equal(captureModuleRules(""), null);
  });
});
