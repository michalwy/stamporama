import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import { REMEMBERED_FILTER_KEYS } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";

// *Not on any open offer* on the Copies list (#2338): a *More filters* switch, remembered with the
// list's other filters and read by every Copies route through the one parser.

describe("Not on any open offer on the Copies list (#2338)", () => {
  it("is remembered with the list's other filters, so Reset filters clears it", () => {
    assert.ok((REMEMBERED_FILTER_KEYS as readonly string[]).includes("notOnOpenOffer"));
  });

  it("narrows only on an explicit true", () => {
    assert.equal(readItemFilters(new URLSearchParams("notOnOpenOffer=true")).notOnOpenOffer, true);
    assert.equal(readItemFilters(new URLSearchParams("notOnOpenOffer=1")).notOnOpenOffer, undefined);
    assert.equal(readItemFilters(new URLSearchParams("")).notOnOpenOffer, undefined);
  });

  it("never takes exceptions from the Copies list's query string", () => {
    const filters = readItemFilters(new URLSearchParams("notOnOpenOffer=true&exceptProposal=p1"));
    assert.equal(filters.openOfferExcept, undefined);
  });
});
