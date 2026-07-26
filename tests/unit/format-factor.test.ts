import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveFormatPrice,
  resolveFormatFactor,
  type FormatFactorRow,
  type FormatFactorSubject,
} from "../../src/lib/format-factor";
import { pickCatalogPriceFor } from "../../src/lib/catalog-price";

const row = (over: Partial<FormatFactorRow> = {}): FormatFactorRow => ({
  formatId: "blk4",
  factor: 4.5,
  collectionAreaId: null,
  issueId: null,
  conditionId: null,
  ...over,
});

/** A block of four of an Infla stamp: Infla sits under German Reich, itself under Germany. */
const subject = (over: Partial<FormatFactorSubject> = {}): FormatFactorSubject => ({
  formatId: "blk4",
  areaPath: ["infla", "reich", "germany"],
  issueId: "infla-1923",
  conditionId: "mnh",
  ...over,
});

describe("resolveFormatFactor — matching", () => {
  it("returns nothing when no row is for this format", () => {
    assert.equal(resolveFormatFactor([row({ formatId: "pair" })], subject()), null);
  });

  it("uses the all-nulls row as the collection default", () => {
    const resolved = resolveFormatFactor([row()], subject());
    assert.equal(resolved?.factor, 4.5);
    assert.deepEqual(resolved?.matchedOn, { issue: false, area: false, condition: false });
  });

  it("matches an area anchor against an ancestor of the stamp's area", () => {
    // A factor set on German Reich has to cover Infla, or every sub-area would need its own.
    const resolved = resolveFormatFactor([row({ collectionAreaId: "reich", factor: 6 })], subject());
    assert.equal(resolved?.factor, 6);
  });

  it("ignores an area anchor outside the stamp's ancestry", () => {
    assert.equal(resolveFormatFactor([row({ collectionAreaId: "poland" })], subject()), null);
  });

  it("ignores an issue anchor for a different issue", () => {
    assert.equal(resolveFormatFactor([row({ issueId: "other" })], subject()), null);
  });

  it("ignores a condition anchor for a different condition", () => {
    assert.equal(resolveFormatFactor([row({ conditionId: "used" })], subject()), null);
  });

  it("matches a condition-anchored row against a stamp with no condition only when both are unset", () => {
    const noCondition = subject({ conditionId: null });
    assert.equal(resolveFormatFactor([row({ conditionId: "mnh" })], noCondition), null);
    assert.equal(resolveFormatFactor([row()], noCondition)?.factor, 4.5);
  });
});

describe("resolveFormatFactor — precedence", () => {
  it("prefers an issue anchor over everything else", () => {
    const rows = [
      row({ factor: 4.5 }),
      row({ collectionAreaId: "infla", factor: 6 }),
      row({ conditionId: "mnh", factor: 7 }),
      row({ issueId: "infla-1923", factor: 9 }),
    ];
    assert.equal(resolveFormatFactor(rows, subject())?.factor, 9);
  });

  it("prefers a nearer area to a further ancestor", () => {
    const rows = [
      row({ collectionAreaId: "germany", factor: 3 }),
      row({ collectionAreaId: "infla", factor: 6 }),
      row({ collectionAreaId: "reich", factor: 5 }),
    ];
    assert.equal(resolveFormatFactor(rows, subject())?.factor, 6);
  });

  it("prefers any area anchor to none", () => {
    const rows = [row({ factor: 4.5 }), row({ collectionAreaId: "germany", factor: 3 })];
    assert.equal(resolveFormatFactor(rows, subject())?.factor, 3);
  });

  it("lets where beat for-which-condition", () => {
    // The documented consequence of the fixed order: an area-anchored factor outranks a
    // collection-wide one pinned to a condition.
    const rows = [
      row({ conditionId: "mnh", factor: 7 }),
      row({ collectionAreaId: "germany", factor: 3 }),
    ];
    assert.equal(resolveFormatFactor(rows, subject())?.factor, 3);
  });

  it("uses a condition anchor to break a tie at the same place", () => {
    const rows = [
      row({ collectionAreaId: "infla", factor: 6 }),
      row({ collectionAreaId: "infla", conditionId: "mnh", factor: 8 }),
    ];
    assert.equal(resolveFormatFactor(rows, subject())?.factor, 8);
  });

  it("reports which anchors the winning row set", () => {
    const rows = [row(), row({ issueId: "infla-1923", conditionId: "mnh", factor: 9 })];
    assert.deepEqual(resolveFormatFactor(rows, subject())?.matchedOn, {
      issue: true,
      area: false,
      condition: true,
    });
  });

  it("does not let a row's own anchors matter when they do not apply to this stamp", () => {
    // A used-anchored issue factor must not beat the MNH default just for being narrow.
    const rows = [row({ factor: 4.5 }), row({ issueId: "infla-1923", conditionId: "used", factor: 9 })];
    assert.equal(resolveFormatFactor(rows, subject())?.factor, 4.5);
  });
});

describe("deriveFormatPrice", () => {
  it("scales the single's price by the factor", () => {
    assert.equal(deriveFormatPrice(20, 4.5), 90);
  });

  it("rounds to two decimals so it reads like a stored amount", () => {
    assert.equal(deriveFormatPrice(12.34, 2.2), 27.15);
  });

  it("handles a fractional factor below one", () => {
    assert.equal(deriveFormatPrice(10, 0.75), 7.5);
  });
});

describe("pickCatalogPriceFor — format", () => {
  const edition = { year: 2026, catalogNameId: "michel" };
  const priceRow = (amount: number, formatId: string | null) => ({
    price: amount as unknown as Parameters<typeof pickCatalogPriceFor>[0][number]["price"],
    currency: "EUR",
    conditionId: "mnh",
    certificateStatusId: null,
    formatId,
    catalogEdition: edition,
  });

  it("never lets a format's price stand in for the single's", () => {
    // The regression this guards: before the format column entered the picker, a block price
    // recorded on the same stamp/condition was an equally valid candidate for the headline.
    const prices = [priceRow(95, "blk4")];
    assert.equal(pickCatalogPriceFor(prices, "michel", "mnh", null), null);
  });

  it("picks the format's own price when one is asked for", () => {
    const prices = [priceRow(20, null), priceRow(95, "blk4")];
    assert.equal(pickCatalogPriceFor(prices, "michel", "mnh", null)?.amount, 20);
    assert.equal(pickCatalogPriceFor(prices, "michel", "mnh", null, "blk4")?.amount, 95);
  });
});
