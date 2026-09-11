import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerDetail, offerRow, statedAmount, unlistedCopy } from "../../src/lib/agent-api/offer-reads";
import type {
  OfferDetailRow,
  OfferRow,
  UnlistedCopyRow,
} from "../../src/lib/agent-api/offer-reads";

// The offer operations' projections (#711) — what an agent is actually told about a listing.
//
// **Pure and structurally typed, so this file holds the whole of the decision** (`agent-api.md`,
// *The module layout is the Prisma-free split*). What it cannot hold is that `OfferDetail` and
// `OfferListItem` satisfy these shapes — `tsc` answers that where the handlers call these
// functions, and `tests/integration/agent-api-offers.test.ts` answers it against a real database.
//
// The rules worth pinning are the ones a later reader would otherwise "tidy" away: a price that
// does not exist is **absent** rather than `0.00`, the four pricing claims are never merged into one
// recommendation, a suggestion never travels without the counts saying what it rests on, and the
// offer projection says nothing at all about a marketplace.

const VALUE = {
  amount: "12.00",
  currency: "EUR",
  baseAmountDisplay: "52.00",
  unpriced: false,
  uncertain: false,
};

const COPY: UnlistedCopyRow = {
  id: "copy-1",
  itemNo: 41,
  stampId: "stamp-1",
  stampName: "Kościuszko",
  catalogNumbers: [{ catalogVendorId: "v1", number: "200" }],
  areaId: "area-1",
  issueId: "issue-1",
  issueName: "Insurgents",
  issueYear: 1938,
  conditionName: "Mint Never Hinged",
  certificateStatusName: null,
  formatName: null,
  locationId: "loc-1",
  locationRef: "A12",
  deliveryState: "delivered",
  promisedTo: null,
  value: VALUE,
};

const CONTEXT = {
  catalogNumbers: [{ label: "Mi·PL 200", isPrimary: true }],
  location: "Szafa 1 › Klaser A",
  marketValue: "38.50",
};

describe("an unlisted-copy row", () => {
  it("states what the catalogue says and what the market paid, apart", () => {
    // The two answer different questions — a book's opinion and evidence from auction results
    // (#458) — and a row that merged them would be stating a recommendation nobody made.
    const row = unlistedCopy(COPY, CONTEXT);
    assert.deepEqual(row.catalogValue, {
      amount: "12.00",
      currency: "EUR",
      baseAmount: "52.00",
    });
    assert.equal(row.marketValue, "38.50");
  });

  it("carries no market value at all where no auction result answers for the copy", () => {
    // *No evidence*, and deliberately not a catalogue-derived stand-in (ADR-0022 §6): a key with no
    // datapoints has no market value, and a figure invented for it would be the catalogue's again
    // under a second name.
    const row = unlistedCopy(COPY, { ...CONTEXT, marketValue: null });
    assert.equal("marketValue" in row, false);
  });

  it("leaves a null certificate and a null format absent rather than spelling them", () => {
    // A null certificate *is* "no certificate" (ADR-0006 §2) and a null format *is* the single
    // (ADR-0020). Neither has a dictionary row, so naming one would hand the agent a vocabulary
    // value it could not find in `get_collection_vocabulary` and could not send back.
    const row = unlistedCopy(COPY, CONTEXT);
    assert.equal("certificate" in row, false);
    assert.equal("format" in row, false);
  });

  it("names the trade a promised copy is committed to", () => {
    // #639: a listing may be *prepared* around it and cannot go live while the trade stands, so the
    // row says so while there is still time to compose the listing differently.
    const row = unlistedCopy(
      { ...COPY, promisedTo: { partnerName: "Anna", tradeNo: 7 } },
      CONTEXT
    );
    assert.equal(row.promisedTo, "Anna (trade #7)");
  });
});

describe("a stated amount", () => {
  it("reads a zero as no figure at all", () => {
    // `0.00` is what an unbid auction and an unpriced draft both carry, and neither is a price
    // somebody stated (#449). Reporting it as `0.00` would put a bid in the record that never
    // happened, and would read to an agent as *this is free*.
    assert.equal(statedAmount("0.00"), undefined);
    assert.equal(statedAmount("0"), undefined);
    assert.equal(statedAmount(null), undefined);
    assert.equal(statedAmount("12.50"), "12.50");
  });
});

const OFFER: OfferRow = {
  id: "offer-1",
  offerNo: 41,
  name: "Poland 1938, MNH",
  label: "Mi·PL 200-204",
  platformName: "Colnect",
  state: "preparing",
  listingType: "fixed",
  price: "0.00",
  startingPrice: null,
  currency: "PLN",
  setCount: 2,
  itemCount: 6,
  url: null,
};

describe("an offer row", () => {
  it("keeps the written title and the derived label apart", () => {
    // `offers.md`'s own rule (#1023/#1024): they are two names for one thing, and the answer that
    // flattens them is the worse one wherever there is room to print both.
    const row = offerRow(OFFER, "/c/pl/offers/offer-1");
    assert.equal(row.name, "Poland 1938, MNH");
    assert.equal(row.label, "Mi·PL 200-204");
  });

  it("omits a title that was never written, rather than echoing the label into it", () => {
    const row = offerRow({ ...OFFER, name: null }, "/c/pl/offers/offer-1");
    assert.equal("name" in row, false);
    assert.equal(row.label, "Mi·PL 200-204");
  });

  it("omits the price of a listing nobody has priced", () => {
    const row = offerRow(OFFER, "/c/pl/offers/offer-1");
    assert.equal("price" in row, false);
  });

  it("states an auction's opening figure while its live one is still nobody's bid", () => {
    const row = offerRow(
      { ...OFFER, listingType: "auction", price: "0.00", startingPrice: "5.00" },
      "/c/pl/offers/offer-1"
    );
    assert.equal("price" in row, false);
    assert.equal(row.startingPrice, "5.00");
  });
});

const DETAIL: OfferDetailRow = {
  id: "offer-1",
  offerNo: 41,
  name: "Poland 1938, MNH",
  label: "Mi·PL 200-204",
  description: "Five stamps, mint never hinged.",
  privateNote: null,
  descriptionFormat: "plain",
  edited: { name: true, description: false, privateNote: false },
  regeneratable: { name: true, description: true, privateNote: false },
  platformName: "Colnect",
  state: "preparing",
  listingType: "fixed",
  price: "0.00",
  startingPrice: null,
  currency: "PLN",
  baseCurrency: "PLN",
  suggestedPrice: "104.00",
  suggestedUnpricedSets: 1,
  platformDefaultStartingPrice: null,
  platformMinimumPrice: "2.00",
  url: null,
  setsTotals: { catalogTotal: "208.00", catalogValuedSets: 2, costTotal: "60.00" },
  sets: [
    {
      id: "set-1",
      title: null,
      label: "Mi·PL 200-202",
      itemIds: ["copy-1", "copy-2", "copy-3"],
      copyLabels: ["200", "201", "202"],
      sold: false,
      holdings: { market: { totalBaseAmount: "70.00", noEvidenceCount: 1 } },
    },
    {
      id: "set-2",
      title: "The pair",
      label: "Mi·PL 203-204",
      itemIds: ["copy-4", "copy-5"],
      copyLabels: ["203", "204"],
      sold: true,
      holdings: { market: { totalBaseAmount: "45.00", noEvidenceCount: 0 } },
    },
  ],
};

describe("an offer detail", () => {
  it("states the four pricing claims separately rather than as one recommendation", () => {
    // They are claims of different strengths (#190/#458/#553/#731) — a catalogue's opinion, market
    // evidence, what this house opens an auction at, and what the marketplace costs to post on.
    // Collapsing them into a single number is what would make an agent price a stamp confidently
    // and wrongly.
    const detail = offerDetail(DETAIL, "/c/pl/offers/offer-1");
    assert.equal(detail.pricing.suggested, "104.00");
    assert.equal(detail.pricing.catalogueTotal, "208.00");
    assert.equal(detail.pricing.marketTotal, "115.00");
    assert.equal(detail.pricing.costTotal, "60.00");
    assert.equal(detail.pricing.platformMinimum, "2.00");
    assert.equal("platformOpening" in detail.pricing, false);
  });

  it("never lets a suggestion travel without the counts it rests on", () => {
    // `valuation.md`'s standing rule: a figure built from a tenth of the copies must never read as
    // the listing's worth. The two counts partition the listing, so an agent can see at a glance
    // that a suggestion came off one set of nine.
    const detail = offerDetail(DETAIL, "/c/pl/offers/offer-1");
    assert.equal(detail.pricing.suggestedValuedSets, 2);
    assert.equal(detail.pricing.suggestedUnpricedSets, 1);
  });

  it("keeps a zero count rather than dropping it, because zero is an answer", () => {
    const detail = offerDetail(
      { ...DETAIL, suggestedUnpricedSets: 0 },
      "/c/pl/offers/offer-1"
    );
    assert.equal(detail.pricing.suggestedUnpricedSets, 0);
  });

  it("sums the market figure over the sets, which partition the listing", () => {
    // An offer never lists a copy twice (#378), so the sets' figures add up to the listing's
    // exactly — and the copies with no auction result behind them are counted rather than folded
    // into the total as zeros.
    const detail = offerDetail(DETAIL, "/c/pl/offers/offer-1");
    assert.equal(detail.pricing.marketTotal, "115.00");
    assert.equal(detail.pricing.marketNoEvidenceCopies, 1);
  });

  it("omits a market total that nothing is behind, rather than reporting nought", () => {
    const detail = offerDetail(
      {
        ...DETAIL,
        sets: DETAIL.sets.map((set) => ({
          ...set,
          holdings: { market: { totalBaseAmount: "0.00", noEvidenceCount: 3 } },
        })),
      },
      "/c/pl/offers/offer-1"
    );
    assert.equal("marketTotal" in detail.pricing, false);
    assert.equal(detail.pricing.marketNoEvidenceCopies, 6);
  });

  it("names the texts that have stopped following the composition", () => {
    // #380: a text written by hand no longer follows what the listing holds, which is the whole
    // reason `set_offer_text` with no `text` exists — and an agent that cannot see which fields are
    // in that state cannot know whether to undo one.
    const detail = offerDetail(DETAIL, "/c/pl/offers/offer-1");
    assert.deepEqual(detail.editedTexts, ["title"]);
  });

  it("names them in the spelling an agent sends, not in the column's", () => {
    // The name a field is **sent** under and the name it is **read back** under have to be one
    // word, and the way they come to be two is by being spelled in two files. `title` is the
    // agent's word throughout; `name` is what this schema calls the column.
    const detail = offerDetail(DETAIL, "/c/pl/offers/offer-1");
    assert.ok(!detail.editedTexts.includes("name"));
    assert.deepEqual(detail.templatedTexts, ["description", "title"]);
    assert.ok(!detail.templatedTexts.includes("private_note"), "no private-note template here");
  });

  it("states the sets as a buyer takes them, marking the one that has gone", () => {
    const detail = offerDetail(DETAIL, "/c/pl/offers/offer-1");
    assert.equal(detail.sets.length, 2);
    assert.deepEqual(detail.sets[0].copyIds, ["copy-1", "copy-2", "copy-3"]);
    assert.equal("sold" in detail.sets[0], false);
    assert.equal(detail.sets[1].sold, true);
    assert.equal(detail.sets[1].title, "The pair");
    assert.equal(detail.copyCount, 5);
  });

  it("says nothing about publishing, which is the boundary this projection carries", () => {
    // #711: the agent writes inside Stamporama and nowhere else. `OfferDetail` states the Allegro
    // publication, the Delcampe category, the listing blockers and the Assistant's handoff state;
    // none of it survives here, because a field describing how a publication would go is an
    // invitation to try. The absence is checked rather than trusted — this is the one assertion
    // that would go red if somebody widened the projection by spreading the row.
    const detail = offerDetail(DETAIL, "/c/pl/offers/offer-1") as unknown as Record<string, unknown>;
    for (const key of [
      "allegroPublication",
      "allegroListing",
      "delcampeCategory",
      "listingBlockers",
      "listingUpdateBlockers",
      "readyBlockers",
      "platformModule",
      "platformItems",
      "photoConfig",
    ]) {
      assert.equal(key in detail, false, `\`${key}\` reached the agent's view of a listing`);
    }
  });
});
