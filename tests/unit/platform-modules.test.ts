import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLEGRO_PLATFORM_MODULE,
  COLNECT_PLATFORM_MODULE,
  hasListingModule,
  listingModuleRules,
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
