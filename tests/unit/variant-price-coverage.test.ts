import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decimal } from "@prisma/client/runtime/client";
import type { RawCatalogPrice } from "../../src/lib/catalog-price";
import { unpricedVariantCells } from "../../src/lib/variant-price-coverage";

// `RawCatalogPrice.price` is a Prisma Decimal; the rule only ever compares edition years and reads
// the amount through Number(), so a plain number stands in fine at runtime.
const D = (n: number): Decimal => n as unknown as Decimal;

const MICHEL = "cat-michel";
const SCOTT = "cat-scott";
const MNH = "cond-mnh";
const USED = "cond-used";
const CERT = "cert-guarantee";
const BLOCK = "fmt-block";

function price(
  amount: number,
  opts: {
    conditionId?: string;
    certificateStatusId?: string | null;
    formatId?: string | null;
    year?: number;
    catalogNameId?: string;
  } = {}
): RawCatalogPrice {
  return {
    price: D(amount),
    currency: "EUR",
    conditionId: opts.conditionId ?? MNH,
    certificateStatusId: opts.certificateStatusId ?? null,
    formatId: opts.formatId ?? null,
    catalogEdition: {
      year: opts.year ?? 2024,
      catalogNameId: opts.catalogNameId ?? MICHEL,
    },
  };
}

describe("unpricedVariantCells", () => {
  it("reports the conditions a variant carries no price at", () => {
    assert.deepEqual(
      unpricedVariantCells({
        variants: [
          { stampId: "309A", identified: true, prices: [price(10, { conditionId: MNH })] },
          { stampId: "309B", identified: true, prices: [] },
        ],
        conditionIds: [MNH, USED],
        primaryCatalogNameId: MICHEL,
      }),
      [
        { stampId: "309A", conditionId: USED },
        { stampId: "309B", conditionId: MNH },
        { stampId: "309B", conditionId: USED },
      ]
    );
  });

  it("is empty for a fully priced tree", () => {
    assert.deepEqual(
      unpricedVariantCells({
        variants: [
          {
            stampId: "309A",
            identified: true,
            prices: [price(10, { conditionId: MNH }), price(2, { conditionId: USED })],
          },
        ],
        conditionIds: [MNH, USED],
        primaryCatalogNameId: MICHEL,
      }),
      []
    );
  });

  it("counts a variant priced only on an older edition as priced", () => {
    // The rollup itself falls back to the newest edition *carrying* a price, so a figure recorded
    // in 2019 and not repeated since is still an answer — asking for it again on every new edition
    // would leave every tree incomplete for ever.
    assert.deepEqual(
      unpricedVariantCells({
        variants: [
          { stampId: "309A", identified: true, prices: [price(10, { year: 2019 })] },
        ],
        conditionIds: [MNH],
        primaryCatalogNameId: MICHEL,
      }),
      []
    );
  });

  it("never counts an intermediate node — it is an umbrella of its own", () => {
    assert.deepEqual(
      unpricedVariantCells({
        variants: [
          { stampId: "309A", identified: false, prices: [] },
          { stampId: "309AP", identified: true, prices: [price(10)] },
        ],
        conditionIds: [MNH],
        primaryCatalogNameId: MICHEL,
      }),
      []
    );
  });

  it("ignores prices recorded on another catalog, with a certificate, or for a format", () => {
    // Each of these is a real figure about something else: a second catalogue, a certified copy,
    // a block of four. None of them prices the single in the primary catalogue.
    assert.deepEqual(
      unpricedVariantCells({
        variants: [
          {
            stampId: "309A",
            identified: true,
            prices: [
              price(10, { catalogNameId: SCOTT }),
              price(30, { certificateStatusId: CERT }),
              price(45, { formatId: BLOCK }),
            ],
          },
        ],
        conditionIds: [MNH],
        primaryCatalogNameId: MICHEL,
      }),
      [{ stampId: "309A", conditionId: MNH }]
    );
  });

  it("reports nothing when the area resolves no primary catalog", () => {
    // A catalog-setup gap, fixed where catalogs are set up. Reporting it here would fill the
    // worklist with trees no amount of typing could complete.
    assert.deepEqual(
      unpricedVariantCells({
        variants: [{ stampId: "309A", identified: true, prices: [] }],
        conditionIds: [MNH],
        primaryCatalogNameId: null,
      }),
      []
    );
  });

  it("reports nothing when the collection holds no copies at any condition", () => {
    // The condition set is what the collection actually holds or lists at; an empty one is a
    // collection with nothing in it, not a tree with everything missing.
    assert.deepEqual(
      unpricedVariantCells({
        variants: [{ stampId: "309A", identified: true, prices: [] }],
        conditionIds: [],
        primaryCatalogNameId: MICHEL,
      }),
      []
    );
  });
});
