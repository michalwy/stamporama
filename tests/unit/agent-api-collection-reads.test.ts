import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compact,
  catalogLabels,
  conditionCounts,
  copyDetail,
  holding,
  issueDetail,
  mayBeTrimmed,
  money,
  searchCopy,
  searchStamp,
  stampDetail,
  valuationSummary,
} from "../../src/lib/agent-api/collection-reads";
import type {
  CopyRow,
  HoldingsSummaryRow,
  IssueDetailRow,
  SearchCopyRow,
  SearchStampRow,
  StampDetailRow,
} from "../../src/lib/agent-api/collection-reads";

// The collection reads' projections (#710) — what an agent is actually told.
//
// **Pure and structurally typed, so this file holds the whole of the decision** (`agent-api.md`,
// *The module layout is the Prisma-free split*). What cannot be held here is that the read models on
// the other side satisfy these shapes — that is a claim about `items.ts` and `stamps.ts`, made by
// `tsc` where the handlers call these functions, and exercised against a real database in
// `tests/integration/agent-api-collection-reads.test.ts`.
//
// The rules worth pinning are the ones a later reader would otherwise "tidy" away: `0` and `false`
// survive the compaction, a null format and a null certificate are **absent** rather than invented,
// a stamp's two copy counts are never summed, the collection's default subtype is dropped, and no
// valuation total ever travels without the counts that say how much of the collection is behind it.

const CATALOG = [
  { label: "Mi·PL 200", isPrimary: true },
  { label: "Fi·PL 187", isPrimary: false },
];

describe("compacting a row", () => {
  it("drops null, undefined and the empty string", () => {
    assert.deepEqual(compact({ a: null, b: undefined, c: "", d: "kept" }), { d: "kept" });
  });

  it("keeps 0 and false, because both are answers", () => {
    // `copies: 0` is the answer *not held* (#348) and `forSale: false` is a disposition the
    // collector set. A compaction that dropped them would turn two facts into two silences.
    assert.deepEqual(compact({ copies: 0, forSale: false }), { copies: 0, forSale: false });
  });
});

describe("catalog labels", () => {
  it("keeps the order and drops the primary flag", () => {
    assert.deepEqual(catalogLabels(CATALOG), ["Mi·PL 200", "Fi·PL 187"]);
  });
});

describe("whether a search group may be trimmed", () => {
  it("says so only when the group came back at its cap", () => {
    assert.equal(mayBeTrimmed(19, 20), false);
    assert.equal(mayBeTrimmed(20, 20), true);
    // A cap that moved down under us still fails safe: more rows than the cap is still "may be".
    assert.equal(mayBeTrimmed(21, 20), true);
  });
});

const SEARCH_STAMP: SearchStampRow = {
  stampId: "s1",
  name: "Kościuszko",
  issuedYear: 1919,
  areaName: "Poland",
  issueName: "Definitives",
  issueYear: 1919,
  catalogNumbers: CATALOG,
  photoId: "p1",
  subtype: { name: "Variant", isDefault: true },
  hasVariants: true,
  isVariant: false,
  copies: 0,
  variantCopies: 2,
  wants: { openCount: 3 },
  path: "/c/pl/stamps/s1",
};

describe("a stamp a search matched", () => {
  const row = searchStamp("col1", SEARCH_STAMP);

  it("reports the two copy counts apart and never summed", () => {
    // The umbrella shape: nothing filed on the stamp itself, two copies under its variants (#528).
    // Adding them would report one copy twice on a tree whose child rows state their own figures.
    assert.equal(row.copies, 0);
    assert.equal(row.variantCopies, 2);
  });

  it("drops the collection's default subtype", () => {
    // ADR-0010 §6: the default is the row given automatically to every new child, so badging every
    // variant with it scales noise with the collection.
    assert.equal(row.subtype, undefined);
    assert.equal(
      searchStamp("col1", {
        ...SEARCH_STAMP,
        subtype: { name: "Overprint", isDefault: false },
      }).subtype,
      "Overprint"
    );
  });

  it("hands back a photo link and never bytes", () => {
    assert.equal(row.photoUrl, "/api/collections/col1/photos/p1/thumb");
    assert.equal(searchStamp("col1", { ...SEARCH_STAMP, photoId: null }).photoUrl, undefined);
  });

  it("omits what the stamp does not state", () => {
    const bare = searchStamp("col1", {
      ...SEARCH_STAMP,
      name: null,
      issuedYear: null,
      areaName: null,
      issueName: null,
      issueYear: null,
      wants: null,
    });
    assert.deepEqual(Object.keys(bare).sort(), [
      "catalogNumbers",
      "copies",
      "hasVariants",
      "isVariant",
      "path",
      "photoUrl",
      "stampId",
      "variantCopies",
    ]);
  });
});

const SEARCH_COPY: SearchCopyRow = {
  itemId: "i1",
  itemNo: 123,
  stampName: "Kościuszko",
  areaName: "Poland",
  issueName: "Definitives",
  issueYear: 1919,
  catalogNumbers: CATALOG,
  photoId: null,
  condition: { name: "Mint Never Hinged" },
  certificate: null,
  format: null,
  locationRef: "A234",
  inCollection: true,
  forSale: false,
  forTrade: false,
  path: "/c/pl/inventory/i1",
};

describe("a copy a search matched", () => {
  it("states the condition by its canonical name, which is what an agent sends back", () => {
    // `name` is the value the collector configured and the one `get_collection_vocabulary` says to
    // send (#708) — the abbreviation is what a chip reads, and would not round-trip.
    assert.equal(searchCopy("col1", SEARCH_COPY).condition, "Mint Never Hinged");
  });

  it("leaves a null certificate and a null format absent rather than inventing a word for them", () => {
    // A null certificate *is* "no certificate" (ADR-0006 §2) and a null format *is* the single
    // (ADR-0020). Neither has a dictionary row, so spelling one would hand the agent a vocabulary
    // value it could not find in `get_collection_vocabulary` and could not send back.
    const row = searchCopy("col1", SEARCH_COPY);
    assert.equal(row.certificate, undefined);
    assert.equal(row.format, undefined);
    assert.equal("certificate" in row, false);
    assert.equal("format" in row, false);
  });

  it("names them when the copy has them", () => {
    const row = searchCopy("col1", {
      ...SEARCH_COPY,
      certificate: { name: "Photo certificate" },
      format: { name: "Block of four" },
    });
    assert.equal(row.certificate, "Photo certificate");
    assert.equal(row.format, "Block of four");
  });

  it("keeps a false disposition, all three being independent markers", () => {
    const row = searchCopy("col1", SEARCH_COPY);
    assert.equal(row.forSale, false);
    assert.equal(row.inCollection, true);
  });
});

const COUNTS = { total: 3, inCollection: 2, forSale: 2, forTrade: 0, unmarked: 0 };

const STAMP_DETAIL: StampDetailRow = {
  id: "s1",
  parentId: null,
  name: "Kościuszko",
  issuedDay: null,
  issuedMonth: 5,
  issuedYear: 1919,
  colnectId: null,
  subtype: null,
  issues: [
    {
      issueId: "iss1",
      issueName: "Definitives",
      issueYear: 1919,
      checklists: [
        { name: "Basic", on: true },
        { name: "Specialized", on: false },
      ],
    },
  ],
  mainCatalogPrice: {
    amount: "12.50",
    currency: "EUR",
    convertedAmount: "53.20",
    baseCurrency: "PLN",
  },
  mainCatalogPriceStale: false,
  mainCatalogPriceDerived: true,
  photos: [{ id: "p1" }, { id: "p2" }],
  copies: COUNTS,
  variantCopies: { total: 0, inCollection: 0, forSale: 0, forTrade: 0, unmarked: 0 },
  wants: null,
  attributes: {
    denomination: "10 gr",
    perforation: null,
    color: "green",
    watermark: null,
    paper: null,
    printing: null,
  },
  size: { widthMm: 21.5, heightMm: null },
};

describe("one stamp in full", () => {
  const row = stampDetail("col1", STAMP_DETAIL, {
    catalogNumbers: CATALOG,
    area: "Poland",
    path: "/c/pl/stamps/s1",
  });

  it("lists only the checklists the stamp is actually on", () => {
    // The others are the stamp form's business (#531) — the picker has to offer the boxes a stamp
    // is *not* ticked for, and an agent has no box to tick.
    assert.deepEqual(row.issues[0].checklists, ["Basic"]);
  });

  it("publishes a price flag only when it is true", () => {
    // `false` survives `compact`, so a `false` here would be a field present on every stamp saying
    // nothing on all but a few.
    assert.equal(row.catalogPriceDerived, true);
    assert.equal("catalogPriceStale" in row, false);
  });

  it("carries the base-currency figure beside the catalogue's own", () => {
    assert.deepEqual(row.catalogPrice, {
      amount: "12.50",
      currency: "EUR",
      baseAmount: "53.20",
      baseCurrency: "PLN",
    });
  });

  it("omits the base amount when the catalogue is already in the base currency", () => {
    assert.equal(
      money({ amount: "10.00", currency: "PLN", convertedAmount: null, baseCurrency: "PLN" })
        .baseAmount,
      undefined
    );
  });

  it("flattens the attributes and omits the ones the stamp does not state", () => {
    // Every one of the six is null on most stamps (#71/#736), so a nested `attributes` object would
    // be a key always present and almost always empty.
    assert.equal(row.denomination, "10 gr");
    assert.equal(row.color, "green");
    assert.equal("perforation" in row, false);
    assert.equal("watermark" in row, false);
  });

  it("reports the half of a size the stamp states and borrows nothing", () => {
    // #763: a detail read reports what the record holds; the checklist-neighbour fallback belongs to
    // the surfaces that cut a hawid to it.
    assert.equal(row.widthMm, 21.5);
    assert.equal("heightMm" in row, false);
  });

  it("links each photo and never inlines one", () => {
    assert.deepEqual(row.photoUrls, [
      "/api/collections/col1/photos/p1/full",
      "/api/collections/col1/photos/p2/full",
    ]);
  });
});

const ISSUE_DETAIL: IssueDetailRow = {
  id: "iss1",
  issueNo: 12,
  name: "Definitives",
  year: 1919,
  memberCount: 14,
  requiredCount: 8,
  checklists: [
    {
      id: "c1",
      name: "Basic",
      stampCount: 5,
      priceTotal: {
        amount: "40.00",
        currency: "EUR",
        convertedAmount: "170.00",
        baseCurrency: "PLN",
      },
    },
    { id: "c2", name: "Specialized", stampCount: 6, priceTotal: null },
  ],
  photos: [],
};

describe("one issue in full", () => {
  const row = issueDetail("col1", ISSUE_DETAIL, {
    catalogRanges: ["Mi·PL 1–14"],
    area: "Poland",
    path: "/c/pl/issues/iss1",
  });

  it("keeps the union count and the per-checklist counts apart", () => {
    // #531: `requiredCount` is the distinct stamps on any checklist, so the sizes do not add up to
    // it — a stamp on both a basic and a specialized list is counted once.
    assert.equal(row.requiredCount, 8);
    assert.deepEqual(
      row.checklists.map((list) => list.stampCount),
      [5, 6]
    );
  });

  it("states a catalogue total per checklist and omits one that has none", () => {
    assert.equal(row.checklists[0].catalogTotal?.amount, "40.00");
    assert.equal(row.checklists[0].catalogTotal?.baseAmount, "170.00");
    assert.equal("catalogTotal" in row.checklists[1], false);
  });
});

const COPY: CopyRow = {
  id: "i1",
  itemNo: 123,
  stampId: "s1",
  stampName: "Kościuszko",
  unknownVariant: true,
  subtype: null,
  sold: false,
  catalogNumbers: [{ catalogVendorId: "v1", number: "200" }],
  areaId: "a1",
  issueId: "iss1",
  issueName: "Definitives",
  issueYear: 1919,
  conditionName: "Mint Never Hinged",
  certificateStatusName: null,
  formatName: null,
  inCollection: true,
  forSale: false,
  forTrade: false,
  locationId: "l1",
  locationRef: "A234",
  deliveryState: "delivered",
  disposedAt: null,
  disposalReason: null,
  costBasis: null,
  notes: null,
  photos: [{ id: "p9" }],
  value: {
    amount: "12.50",
    currency: "EUR",
    baseAmountDisplay: "53.20",
    unpriced: false,
    uncertain: true,
  },
};

const COPY_CONTEXT = {
  catalogNumbers: CATALOG,
  area: "Poland",
  location: "Szafa 1 › Klaser A",
  path: "/c/pl/inventory/i1",
};

describe("one copy in full", () => {
  const row = copyDetail("col1", COPY, COPY_CONTEXT);

  it("marks an estimate as one rather than stating it flatly", () => {
    // #238/#616: the copy is filed on an umbrella, so the figure is the lowest of its priced
    // variants. An estimate may be marked as an estimate — a sale may not.
    assert.equal(row.catalogValue.uncertain, true);
    assert.equal(row.catalogValue.baseAmount, "53.20");
    assert.equal("unpriced" in row.catalogValue, false);
  });

  it("leaves a pending cost basis absent rather than calling it zero", () => {
    // #123: the copy sits in an open purchase lot whose pool has not been split. *Nothing recorded*
    // and *nothing paid* are different answers and only the first is true.
    assert.equal("costBasis" in row, false);
  });

  it("says where it is, path and ref together", () => {
    // A ref only means anything inside its own location (#421).
    assert.equal(row.location, "Szafa 1 › Klaser A");
    assert.equal(row.locationRef, "A234");
  });

  it("says the variant has not been decided", () => {
    assert.equal(row.unknownVariant, true);
    assert.equal("unknownVariant" in copyDetail("col1", { ...COPY, unknownVariant: false }, COPY_CONTEXT), false);
  });

  it("states a disposal as a date a model can read", () => {
    const gone = copyDetail(
      "col1",
      { ...COPY, disposedAt: new Date("2026-01-02T03:04:05.000Z"), disposalReason: "lost" },
      COPY_CONTEXT
    );
    assert.equal(gone.disposedAt, "2026-01-02T03:04:05.000Z");
    assert.equal(gone.disposalReason, "lost");
  });
});

describe("a holdings row", () => {
  const row = holding(COPY, { catalogNumbers: CATALOG, location: "Szafa 1 › Klaser A" });

  it("answers what it is, in what condition and where — and stops there", () => {
    assert.deepEqual(Object.keys(row).sort(), [
      "catalogNumbers",
      "condition",
      "copyId",
      "deliveryState",
      "forSale",
      "forTrade",
      "inCollection",
      "issue",
      "issueYear",
      "itemNo",
      "location",
      "locationRef",
      "stamp",
      "stampId",
    ]);
  });

  it("is leaner than the record behind it", () => {
    // A list is read twenty-five rows at a time and every field is paid for on each of them; the
    // rest is one `get_copy` away.
    const full = copyDetail("col1", COPY, COPY_CONTEXT);
    assert.ok(Object.keys(row).length < Object.keys(full).length);
    for (const key of ["catalogValue", "photoUrls", "notes", "path", "area"]) {
      assert.equal(key in row, false, `a holdings row should not carry "${key}"`);
    }
  });

  it("keeps the delivery state, because a copy on its way is held and not in hand", () => {
    assert.equal(row.deliveryState, "delivered");
    assert.equal(
      holding({ ...COPY, deliveryState: "in_transit" }, { catalogNumbers: [], location: null })
        .deliveryState,
      "in_transit"
    );
  });
});

describe("the condition breakdown", () => {
  it("names each condition and orders by count, largest first", () => {
    assert.deepEqual(
      conditionCounts(
        new Map([
          ["c-u", 2],
          ["c-mnh", 7],
          ["c-mh", 2],
        ]),
        new Map([
          ["c-u", "Used"],
          ["c-mnh", "Mint Never Hinged"],
          ["c-mh", "Mint Hinged"],
        ])
      ),
      [
        { condition: "Mint Never Hinged", copies: 7 },
        // A tie breaks on the name, so two reads of one collection cannot come back in two orders.
        { condition: "Mint Hinged", copies: 2 },
        { condition: "Used", copies: 2 },
      ]
    );
  });

  it("falls back to the id rather than dropping a condition it cannot name", () => {
    assert.deepEqual(conditionCounts(new Map([["ghost", 1]]), new Map()), [
      { condition: "ghost", copies: 1 },
    ]);
  });
});

const SUMMARY: HoldingsSummaryRow = {
  baseCurrency: "PLN",
  totalBaseAmount: "1200.00",
  pricedCount: 30,
  unpricedCount: 12,
  unconvertibleCount: 1,
  uncertainCount: 4,
  uncertainBaseAmount: "300.00",
  market: { totalBaseAmount: "210.00", valuedCount: 5, noEvidenceCount: 38 },
  cost: { totalCostBasis: "640.00", knownCount: 20, pendingCount: 8, noneCount: 15 },
  writeOff: {
    cost: { totalCostBasis: "30.00", knownCount: 1, pendingCount: 0, noneCount: 2 },
    count: 3,
  },
};

describe("the valuation summary", () => {
  const row = valuationSummary(SUMMARY);

  it("never states a total without the counts behind it", () => {
    // `valuation.md`: a total built from a fraction of the collection must never read as the
    // collection's worth, and these counts are what stop it. Asserted field by field rather than as
    // one `deepEqual`, so dropping any single one of them fails with its own name.
    for (const key of ["pricedCount", "unpricedCount", "unconvertibleCount", "uncertainCount"]) {
      assert.ok(key in row.catalogue, `the catalogue total must carry "${key}"`);
    }
    for (const key of ["valuedCount", "noEvidenceCount"]) {
      assert.ok(key in row.market, `the market total must carry "${key}"`);
    }
    for (const key of ["knownCount", "pendingCount", "noneCount"]) {
      assert.ok(key in row.cost, `the cost total must carry "${key}"`);
    }
  });

  it("keeps the four answers apart rather than blending them", () => {
    assert.equal(row.catalogue.total, "1200.00");
    assert.equal(row.market.total, "210.00");
    assert.equal(row.cost.total, "640.00");
    assert.equal(row.writeOff.cost.total, "30.00");
    assert.equal(row.writeOff.copies, 3);
  });

  it("carries the uncertain share beside the catalogue total", () => {
    assert.equal(row.catalogue.uncertainCount, 4);
    assert.equal(row.catalogue.uncertainTotal, "300.00");
  });

  it("states one base currency for every figure", () => {
    // Market medians are aggregated in the base currency to begin with (ADR-0022 §2), and the
    // catalogue total is converted into it, so one scalar answers for all four.
    assert.equal(row.baseCurrency, "PLN");
  });
});
