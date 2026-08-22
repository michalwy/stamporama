import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAreaPrefixNodes,
  effectivePrefixFor,
  resolveEffectivePrefix,
} from "../../src/lib/area-prefix";
import { resolveAreaVendorPrefix } from "../../src/lib/area-vendor";
import {
  FISCHER,
  MICHEL,
  PREFIX_CASES,
  prefixAreasAsClientData,
  prefixAreasAsServerRows,
} from "../fixtures/area-prefix-cases";

// The server half of the two-level area prefix (#675), and the property that binds the two halves:
// `area-prefix.ts` (Prisma rows, server) and `area-vendor.ts` (the client's area payload) must
// resolve every pair identically. The prefix is catalog *identity* (#66/#377) — it decides the chip,
// duplicate detection (#85) and the Colnect strict full-key match (#155) alike — so a disagreement
// is a stamp that reads as one thing and de-duplicates as another.
//
// It lives under `tests/integration` only because `area-prefix.ts` is `server-only`, which the unit
// runner cannot load; it touches no database.

const NODES = buildAreaPrefixNodes(prefixAreasAsServerRows());
const CLIENT_AREAS = prefixAreasAsClientData();

describe("resolveEffectivePrefix (#675)", () => {
  for (const { areaId, vendorId, expected } of PREFIX_CASES) {
    it(`resolves (${areaId}, ${vendorId}) to ${expected === null ? "no prefix" : expected}`, () => {
      assert.equal(resolveEffectivePrefix(areaId, vendorId, NODES), expected);
    });
  }

  it("agrees with the client mirror on every case", () => {
    for (const { areaId, vendorId } of PREFIX_CASES) {
      assert.equal(
        resolveEffectivePrefix(areaId, vendorId, NODES),
        resolveAreaVendorPrefix(CLIENT_AREAS, areaId, vendorId),
        `server and client disagree on (${areaId}, ${vendorId})`
      );
    }
  });
});

describe("effectivePrefixFor keeps the issue override ahead of the area levels (#377)", () => {
  const overrides = new Map([["issue-1", new Map([[MICHEL, "SP"]])]]);

  it("uses the issue's override where it sets one", () => {
    assert.equal(effectivePrefixFor("gg", MICHEL, NODES, "issue-1", overrides), "SP");
  });

  it("falls back to the area levels for a vendor the issue is silent about", () => {
    assert.equal(effectivePrefixFor("gg", FISCHER, NODES, "issue-1", overrides), "GG");
  });

  it("falls back to the area levels for an issue with no overrides at all", () => {
    assert.equal(effectivePrefixFor("sl", MICHEL, NODES, "issue-2", overrides), "PL");
  });
});
