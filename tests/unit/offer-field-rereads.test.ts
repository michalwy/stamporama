import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import {
  fieldSaveRereads,
  fieldSaveTouchesActionItems,
  type OfferInlineField,
} from "@/lib/offer-field-rereads";
import {
  invalidateWithoutActionItems,
  takeQuietInvalidation,
} from "@/app/c/[collectionSlug]/action-items-refresh";

// #2426 — one price saved on a one-lot offer took about three seconds to settle, the screen asking
// again for reads the price could not have changed. What is pinned here is which reads a field save
// asks again, and that the notification centre is left alone where the edit cannot move it.

const C = "col";
const OFFER = "offer-1";
const OTHER = "offer-2";
const FIELDS: OfferInlineField[] = [
  "price",
  "startingPrice",
  "url",
  "descriptionFormat",
  "name",
  "description",
  "privateNote",
];

describe("what a field saved on the offer's screen reads again", () => {
  it("never the offer's copies, photo plan, cover walk or listing duplicates", () => {
    for (const field of FIELDS) {
      assert.equal(fieldSaveRereads(field, OFFER, ["offers", C, "copies", OFFER]), false, field);
      assert.equal(fieldSaveRereads(field, OFFER, ["offers", C, "photo-plan", OFFER]), false, field);
      assert.equal(fieldSaveRereads(field, OFFER, ["offers", C, "cover-walk", OFFER]), false, field);
      assert.equal(
        fieldSaveRereads(field, OFFER, ["offers", C, "detail", OFFER, "listing-duplicates"]),
        false,
        field
      );
    }
  });

  it("always the offer's own detail", () => {
    for (const field of FIELDS) {
      assert.equal(fieldSaveRereads(field, OFFER, ["offers", C, "detail", OFFER]), true, field);
    }
  });

  it("the untranslated names only after a text", () => {
    const key = ["offers", C, "translation-gaps", OFFER];
    assert.equal(fieldSaveRereads("name", OFFER, key), true);
    assert.equal(fieldSaveRereads("description", OFFER, key), true);
    assert.equal(fieldSaveRereads("privateNote", OFFER, key), true);
    assert.equal(fieldSaveRereads("price", OFFER, key), false);
    assert.equal(fieldSaveRereads("startingPrice", OFFER, key), false);
    assert.equal(fieldSaveRereads("url", OFFER, key), false);
  });

  it("every other offer's reads and every list, which show this offer's figures", () => {
    for (const key of [
      ["offers", C, "list", {}],
      ["offers", C, "counts", {}],
      ["offers", C, "summary", {}],
      ["offers", C, "prepare", {}],
      ["offers", C, "facebook-post", "post-1"],
      ["offers", C, "detail", OTHER],
      ["offers", C, "copies", OTHER],
      ["offers", C, "photo-plan", OTHER],
    ]) {
      assert.equal(fieldSaveRereads("price", OFFER, key), true, JSON.stringify(key));
    }
  });
});

describe("whether a field save can move the notification centre", () => {
  it("only on an offer that is up on its platform, where the listing is left behind (#542)", () => {
    assert.equal(fieldSaveTouchesActionItems("preparing"), false);
    assert.equal(fieldSaveTouchesActionItems("ready"), false);
    assert.equal(fieldSaveTouchesActionItems("sold"), false);
    assert.equal(fieldSaveTouchesActionItems("withdrawn"), false);
    assert.equal(fieldSaveTouchesActionItems("pending"), true);
    assert.equal(fieldSaveTouchesActionItems("active"), true);
    assert.equal(fieldSaveTouchesActionItems("paused"), true);
  });
});

describe("an invalidation the notification centre does not follow", () => {
  function seeded() {
    const client = new QueryClient();
    const keys = [
      ["offers", C, "detail", OFFER],
      ["offers", C, "list", {}],
    ];
    for (const key of keys) client.setQueryData(key, 1);
    return { client, hashes: keys.map((key) => client.getQueryCache().find({ queryKey: key })!.queryHash) };
  }

  it("marks each query it invalidates, once", async () => {
    const { client, hashes } = seeded();
    await invalidateWithoutActionItems(client, { queryKey: ["offers", C] });
    for (const hash of hashes) {
      assert.equal(takeQuietInvalidation(hash), true);
      assert.equal(takeQuietInvalidation(hash), false, "consumed as read");
    }
  });

  it("does not mark a query already stale, which sends no event to consume it", async () => {
    const { client, hashes } = seeded();
    await client.invalidateQueries({ queryKey: ["offers", C, "list"] });
    await invalidateWithoutActionItems(client, { queryKey: ["offers", C] });
    assert.equal(takeQuietInvalidation(hashes[0]), true);
    assert.equal(takeQuietInvalidation(hashes[1]), false);
  });

  it("each invalidation it marks sends exactly one event", async () => {
    const { client } = seeded();
    const events: string[] = [];
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "invalidate") {
        events.push(event.query.queryHash);
        assert.equal(takeQuietInvalidation(event.query.queryHash), true);
      }
    });
    await invalidateWithoutActionItems(client, { queryKey: ["offers", C] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();
    assert.equal(events.length, 2);
  });
});
