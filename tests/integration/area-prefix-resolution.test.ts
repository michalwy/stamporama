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
  for (const { areaId, vendorId, expected, joined = false } of PREFIX_CASES) {
    it(`resolves (${areaId}, ${vendorId}) to ${expected === null ? "no prefix" : expected}${joined ? ", joined" : ""}`, () => {
      const resolved = resolveEffectivePrefix(areaId, vendorId, NODES);
      assert.equal(resolved?.prefix ?? null, expected);
      assert.equal(resolved?.joined ?? false, joined);
    });
  }

  it("agrees with the client mirror on every case", () => {
    for (const { areaId, vendorId } of PREFIX_CASES) {
      assert.deepEqual(
        resolveEffectivePrefix(areaId, vendorId, NODES),
        resolveAreaVendorPrefix(CLIENT_AREAS, areaId, vendorId),
        `server and client disagree on (${areaId}, ${vendorId})`
      );
    }
  });
});

describe("effectivePrefixFor keeps the issue override ahead of the area levels (#377)", () => {
  const overrides = new Map([
    ["issue-1", new Map([[MICHEL, { prefix: "SP", joined: false }]])],
    ["issue-3", new Map([[MICHEL, { prefix: "DR D", joined: true }]])],
  ]);

  it("uses the issue's override where it sets one", () => {
    assert.deepEqual(effectivePrefixFor("gg", MICHEL, NODES, "issue-1", overrides), {
      prefix: "SP",
      joined: false,
    });
  });

  it("brings the override's own joining, not the area's (#2657)", () => {
    assert.deepEqual(effectivePrefixFor("pl", MICHEL, NODES, "issue-3", overrides), {
      prefix: "DR D",
      joined: true,
    });
  });

  it("falls back to the area levels for a vendor the issue is silent about", () => {
    assert.deepEqual(effectivePrefixFor("gg", FISCHER, NODES, "issue-1", overrides), {
      prefix: "GG",
      joined: false,
    });
  });

  it("falls back to the area levels for an issue with no overrides at all", () => {
    assert.deepEqual(effectivePrefixFor("sl", MICHEL, NODES, "issue-2", overrides), {
      prefix: "PL",
      joined: false,
    });
  });
});
