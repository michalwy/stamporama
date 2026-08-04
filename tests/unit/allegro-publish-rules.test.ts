import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLEGRO_TITLE_MAX_LENGTH,
  allegroOfferUrl,
  buildAllegroOfferRequest,
  evaluateAllegroPublishBlockers,
  namesIneligibleAccount,
  readCreatedOffer,
  readOperationStatus,
  type AllegroProfileForPublish,
  type AllegroPublishReadiness,
} from "../../src/lib/allegro-publish-rules";

// #477's two decisions: what stops a listing going out, and what one goes out *as*. Both are pinned
// here rather than exercised through a live selling account, because a publish is the one act in
// this app that writes to a marketplace — there is no cheap way to be wrong about it twice.

const PROFILE: AllegroProfileForPublish = {
  id: "p1",
  name: "Home, letter rates",
  shippingRatesId: "rates-1",
  handlingTime: "PT24H",
  returnPolicyId: "ret-1",
  impliedWarrantyId: "war-1",
  locationCountryCode: "PL",
  locationCity: "Kraków",
  locationPostCode: "30-001",
  invoiceType: "NO_INVOICE",
};

function readiness(over: Partial<AllegroPublishReadiness> = {}): AllegroPublishReadiness {
  return {
    isAllegroPlatform: true,
    connected: true,
    needsReconnect: false,
    canPublish: true,
    publishRefusedReason: null,
    state: "ready",
    listingType: "fixed",
    title: "Polska 1935 Mi 1-12 czyste",
    price: "48.00",
    startingPrice: null,
    quantity: 2,
    setsInterchangeable: true,
    differingSetLabels: [],
    profile: PROFILE,
    photosReady: true,
    photoCount: 3,
    publishedAs: null,
    categoryId: "9581",
    unansweredParameters: [],
    ...over,
  };
}

const codes = (input: AllegroPublishReadiness) =>
  evaluateAllegroPublishBlockers(input).map((b) => b.code);

describe("evaluateAllegroPublishBlockers", () => {
  it("passes an offer that is ready in every way", () => {
    assert.deepEqual(codes(readiness()), []);
  });

  it("reports the connection alone — nothing else is actionable without one", () => {
    assert.deepEqual(codes(readiness({ connected: false, profile: null, photoCount: 0 })), [
      "not-connected",
    ]);
    assert.deepEqual(codes(readiness({ needsReconnect: true, profile: null })), ["needs-reconnect"]);
  });

  it("refuses a grant that positively lacks the write scope, and accepts one it cannot read", () => {
    assert.deepEqual(codes(readiness({ canPublish: false })), ["missing-write-scope"]);
    // Null is *unreadable*, and nothing is authorized on the strength of a decoded token (#485).
    assert.deepEqual(codes(readiness({ canPublish: null })), []);
  });

  it("refuses an account Allegro will not sell from, in Allegro's own words and alone", () => {
    // A private seller's account. No offer can be fixed into passing this, so it stands alone and
    // the sentence is repeated verbatim — it is a rule about somebody's account, not about a field.
    const [only] = evaluateAllegroPublishBlockers(
      readiness({
        publishRefusedReason:
          "You cannot use the Public API method when selling with a Regular Account (not registered as a Business Account).",
        profile: null,
        photoCount: 0,
      })
    );
    assert.equal(only.code, "account-not-eligible");
    assert.match(only.message, /Regular Account/);
  });

  it("refuses a platform that is not the one marked as Allegro", () => {
    assert.deepEqual(codes(readiness({ isAllegroPlatform: false })), ["not-allegro-platform"]);
  });

  it("refuses a second publish whatever state the first listing is in", () => {
    // A draft included: **Activate** acts on the listing that is already there, and a second create
    // would orphan it.
    for (const status of ["ACTIVE", "PENDING", "INACTIVE"] as const) {
      const [only] = evaluateAllegroPublishBlockers(
        readiness({ publishedAs: { offerId: "12345", status } })
      );
      assert.equal(only.code, "already-published", status);
      assert.match(only.message, /12345/);
    }
  });

  it("reports an unfinished offer alone", () => {
    assert.deepEqual(codes(readiness({ state: "preparing", profile: null })), ["not-ready"]);
    assert.deepEqual(codes(readiness({ quantity: 0, profile: null })), ["no-sets"]);
  });

  it("asks for the figure the listing's own format states", () => {
    assert.deepEqual(codes(readiness({ price: "0.00" })), ["no-price"]);
    // An auction with no bids carries `0` legitimately (#449) — what it must have is an opening one.
    assert.deepEqual(
      codes(readiness({ listingType: "auction", price: "0.00", startingPrice: "5.00" })),
      []
    );
    assert.deepEqual(
      codes(readiness({ listingType: "auction", price: "0.00", startingPrice: null })),
      ["no-starting-price"]
    );
  });

  it("refuses an over-long title rather than shortening it", () => {
    const title = "x".repeat(ALLEGRO_TITLE_MAX_LENGTH + 1);
    const [only] = evaluateAllegroPublishBlockers(readiness({ title }));
    assert.equal(only.code, "title-too-long");
    assert.match(only.message, new RegExp(String(ALLEGRO_TITLE_MAX_LENGTH)));
    assert.deepEqual(codes(readiness({ title: "x".repeat(ALLEGRO_TITLE_MAX_LENGTH) })), []);
    assert.deepEqual(codes(readiness({ title: "  " })), ["no-title"]);
  });

  it("names the profile, and only the fields a listing cannot go out without", () => {
    assert.deepEqual(codes(readiness({ profile: null })), ["no-profile"]);
    assert.deepEqual(
      codes(readiness({ profile: { ...PROFILE, locationCity: " " } })),
      ["incomplete-profile"]
    );
    // Allegro defaults the after-sales services for an account that has none, so their absence is
    // not a refusal.
    assert.deepEqual(
      codes(readiness({ profile: { ...PROFILE, returnPolicyId: null, impliedWarrantyId: null } })),
      []
    );
  });

  it("points a missing category and an unanswered required parameter at the offer's own card", () => {
    // Both live on the offer now (#494), so neither is a question the publish dialog asks.
    assert.deepEqual(codes(readiness({ categoryId: null })), ["no-category"]);
    const [only] = evaluateAllegroPublishBlockers(
      readiness({ unansweredParameters: ["Stan zachowania"] })
    );
    assert.equal(only.code, "missing-category-parameters");
    assert.match(only.message, /Stan zachowania/);
  });

  it("asks for pictures, and tells an unfinished run apart from an empty plan", () => {
    assert.deepEqual(codes(readiness({ photosReady: false, photoCount: 0 })), ["photos-not-ready"]);
    assert.deepEqual(codes(readiness({ photoCount: 0 })), ["no-photos"]);
  });

  it("reports every remaining fault together, each being fixed somewhere different", () => {
    assert.deepEqual(
      codes(readiness({ price: "0", profile: null, photoCount: 0, title: null, categoryId: null })),
      ["no-title", "no-price", "no-profile", "no-category", "no-photos"]
    );
  });

  it("refuses sets that one stock figure cannot describe", () => {
    const [only] = evaluateAllegroPublishBlockers(
      readiness({ setsInterchangeable: false, differingSetLabels: ["Mi·PL 5-8"] })
    );
    assert.equal(only.code, "mixed-sets");
    assert.match(only.message, /Mi·PL 5-8/);
  });
});

describe("buildAllegroOfferRequest", () => {
  const base = {
    offerNo: 42,
    title: "Polska 1935 Mi 1-12 czyste",
    description: "Piękny zestaw.",
    descriptionFormat: "plain" as const,
    listingType: "fixed" as const,
    price: "48.00",
    startingPrice: null,
    currency: "PLN",
    quantity: 2,
    categoryId: "9999",
    parameters: [],
    imageUrls: ["https://a.allegroimg.com/1.jpg", "https://a.allegroimg.com/2.jpg"],
    profile: PROFILE,
    publication: "INACTIVE" as const,
  };

  it("carries the offer number as the listing's external id", () => {
    const body = buildAllegroOfferRequest(base);
    assert.deepEqual(body.external, { id: "42" });
  });

  it("sends a quick buy at its asking price", () => {
    assert.deepEqual(buildAllegroOfferRequest(base).sellingMode, {
      format: "BUY_NOW",
      price: { amount: "48.00", currency: "PLN" },
    });
  });

  it("sends an auction at its *starting* price, never at the standing bid", () => {
    const body = buildAllegroOfferRequest({
      ...base,
      listingType: "auction",
      price: "31.00",
      startingPrice: "5.00",
    });
    assert.deepEqual(body.sellingMode, {
      format: "AUCTION",
      startingPrice: { amount: "5.00", currency: "PLN" },
    });
  });

  it("sends the pictures as bare URLs in upload order — the first is the thumbnail", () => {
    // Strings, not `{ url }` objects: the object shape belongs to the legacy `/sale/offers` endpoint
    // and product-offers answers it with a `JsonMappingException` on `images[0]`.
    assert.deepEqual(buildAllegroOfferRequest(base).images, [
      "https://a.allegroimg.com/1.jpg",
      "https://a.allegroimg.com/2.jpg",
    ]);
  });

  it("states the stock, the delivery, the location and the publication asked for", () => {
    const body = buildAllegroOfferRequest({ ...base, publication: "ACTIVE" });
    assert.deepEqual(body.stock, { available: 2, unit: "UNIT" });
    assert.deepEqual(body.delivery, {
      shippingRates: { id: "rates-1" },
      handlingTime: "PT24H",
    });
    assert.deepEqual(body.location, { countryCode: "PL", city: "Kraków", postCode: "30-001" });
    assert.deepEqual(body.publication, { status: "ACTIVE" });
    assert.deepEqual(body.payments, { invoice: "NO_INVOICE" });
  });

  it("renders the description in the format it was written in, then in Allegro's own tags", () => {
    const content = (
      buildAllegroOfferRequest({
        ...base,
        description: "**bold**",
        descriptionFormat: "markdown",
      }).description as { sections: { items: { content: string }[] }[] }
    ).sections[0].items[0].content;
    // `<strong>` is what the renderer produces and is not on Allegro's list (#477 debugging).
    assert.equal(content, "<p><b>bold</b></p>");
  });

  it("does not send a plain description with the attribute the screen renders it with", () => {
    const content = (
      buildAllegroOfferRequest({ ...base, description: "Zestaw.", descriptionFormat: "plain" })
        .description as { sections: { items: { content: string }[] }[] }
    ).sections[0].items[0].content;
    assert.equal(content, "<p>Zestaw.</p>");
  });

  it("leaves the description out entirely where there is none", () => {
    assert.equal("description" in buildAllegroOfferRequest({ ...base, description: null }), false);
  });

  it("omits after-sales services an account has none of", () => {
    const body = buildAllegroOfferRequest({
      ...base,
      profile: { ...PROFILE, returnPolicyId: null, impliedWarrantyId: null },
    });
    assert.equal("afterSalesServices" in body, false);
  });

  it("sends only the halves of a parameter that were answered", () => {
    const body = buildAllegroOfferRequest({
      ...base,
      parameters: [
        { id: "1", valuesIds: ["a"] },
        { id: "2", values: ["1935"] },
        { id: "3", rangeValue: { from: "1", to: null } },
      ],
    });
    assert.deepEqual(body.parameters, [
      { id: "1", valuesIds: ["a"] },
      { id: "2", values: ["1935"] },
      { id: "3", rangeValue: { from: "1", to: null } },
    ]);
  });
});

describe("readCreatedOffer", () => {
  it("reads the offer id off a 201's body", () => {
    assert.deepEqual(readCreatedOffer({ id: "12345" }, null), {
      offerId: "12345",
      operationId: null,
    });
  });

  it("reads both ids off a 202, whichever shape they arrived in", () => {
    assert.deepEqual(readCreatedOffer({ id: "12345", operationId: "op-1" }, null), {
      offerId: "12345",
      operationId: "op-1",
    });
    assert.deepEqual(readCreatedOffer({ id: "12345", operation: { id: "op-2" } }, null), {
      offerId: "12345",
      operationId: "op-2",
    });
  });

  it("falls back to the Location header, which is where Allegro names an operation", () => {
    assert.deepEqual(
      readCreatedOffer(null, "https://api.allegro.pl/sale/product-offers/12345/operations/op-3"),
      { offerId: "12345", operationId: "op-3" }
    );
    assert.deepEqual(readCreatedOffer(null, "/sale/product-offers/12345"), {
      offerId: "12345",
      operationId: null,
    });
  });

  it("names nothing rather than guessing when the answer named nothing", () => {
    assert.deepEqual(readCreatedOffer({}, "https://example.test/somewhere"), {
      offerId: null,
      operationId: null,
    });
  });
});

describe("readOperationStatus", () => {
  it("concludes only on a status that positively says so", () => {
    assert.equal(readOperationStatus({ status: "SUCCESS" }).outcome, "succeeded");
    assert.equal(readOperationStatus({ status: "finished" }).outcome, "succeeded");
  });

  it("reports a refusal as Allegro stated it", () => {
    const status = readOperationStatus({
      status: "FAILED",
      errors: [{ userMessage: "Taka oferta już istnieje." }],
    });
    assert.equal(status.outcome, "failed");
    assert.equal(status.message, "Taka oferta już istnieje.");
  });

  it("reads anything else as still running, never as a listing", () => {
    assert.equal(readOperationStatus({ status: "IN_PROGRESS" }).outcome, "pending");
    assert.equal(readOperationStatus({ status: "SOMETHING_NEW" }).outcome, "pending");
    assert.equal(readOperationStatus(null).outcome, "pending");
  });
});

describe("allegroOfferUrl", () => {
  it("builds the canonical `/oferta/<id>` address the read side matches on", () => {
    assert.equal(allegroOfferUrl("12345", false), "https://allegro.pl/oferta/12345");
  });

  it("points a sandbox listing at the sandbox", () => {
    assert.equal(
      allegroOfferUrl("12345", true),
      "https://allegro.pl.allegrosandbox.pl/oferta/12345"
    );
  });
});

describe("namesIneligibleAccount", () => {
  it("recognises Allegro's refusal to sell through the API from a private account", () => {
    assert.equal(
      namesIneligibleAccount([
        "You cannot use the Public API method when selling with a Regular Account (not registered as a Business Account).",
      ]),
      true
    );
    assert.equal(namesIneligibleAccount(["Metoda dostępna wyłącznie dla konta firmowego."]), true);
  });

  it("leaves an ordinary field refusal alone", () => {
    assert.equal(
      namesIneligibleAccount([
        "Parameter `9525:Klej` should not be specified as in section `offer`.",
        "Message is not readable.",
      ]),
      false
    );
    assert.equal(namesIneligibleAccount([]), false);
  });
});
