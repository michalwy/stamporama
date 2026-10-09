import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeFacebookAuctionCopies,
  facebookDefaultEndsAt,
  facebookDefaultStartingPrice,
  facebookMixedTypesRefusal,
  facebookMoney,
  facebookPostGaps,
  facebookPostRefusal,
  isFacebookLotPosted,
  parseBidIncrement,
  readFacebookCreateChoice,
  renderFacebookLotText,
  renderFacebookPostText,
  type FacebookPostCandidate,
  type FacebookPostLotText,
} from "../../src/lib/facebook-post-rules";

// A Facebook offer and its post (#1544; ADR-0061 §2, §3, §6): what a group's defaults become on a
// new auction, and the kit's text — an auction's or, since #1671, a quick buy's. The database half — the group required, its currency, a copy in
// one auction at a time, posts and their links — is `tests/integration/facebook-auctions.test.ts`.

function lot(overrides: Partial<FacebookPostLotText> = {}): FacebookPostLotText {
  return {
    lotNo: null,
    offerNo: 412,
    listingType: "auction",
    title: "Austria 1850 Mercury",
    description: "Mercury, 1850, unused",
    catalog: "Mi·AT 1",
    startingPrice: "10.00 PLN",
    increment: "1.00 PLN",
    closesAt: "Sun 5 Oct, 20:00",
    price: "",
    ...overrides,
  };
}

describe("facebookDefaultEndsAt (#1544)", () => {
  const now = new Date(2026, 9, 3, 14, 37, 12); // Sat 3 Oct 2026, 14:37 local

  it("closes the group's number of days later, at its closing time of day", () => {
    const end = facebookDefaultEndsAt(now, 7, "20:00");
    assert.deepEqual(
      [end?.getFullYear(), end?.getMonth(), end?.getDate(), end?.getHours(), end?.getMinutes()],
      [2026, 9, 10, 20, 0]
    );
  });

  it("keeps the time it is now when the group states no time of day", () => {
    const end = facebookDefaultEndsAt(now, 3, null);
    assert.deepEqual([end?.getDate(), end?.getHours(), end?.getMinutes(), end?.getSeconds()], [6, 14, 37, 0]);
  });

  it("crosses a month end by the calendar", () => {
    const end = facebookDefaultEndsAt(new Date(2026, 9, 30, 9, 0), 5, "21:30");
    assert.deepEqual([end?.getMonth(), end?.getDate(), end?.getHours(), end?.getMinutes()], [10, 4, 21, 30]);
  });

  it("names no end without a length — a time of day alone names no day", () => {
    assert.equal(facebookDefaultEndsAt(now, null, "20:00"), null);
    assert.equal(facebookDefaultEndsAt(now, 0, "20:00"), null);
  });
});

describe("facebookDefaultStartingPrice (#1544)", () => {
  it("takes an amount as it stands", () => {
    assert.equal(facebookDefaultStartingPrice("amount", 5, null), "5.00");
  });

  it("takes a percentage of the catalogue value, rounded to the cent", () => {
    assert.equal(facebookDefaultStartingPrice("catalogPercent", 30, "12.50"), "3.75");
    assert.equal(facebookDefaultStartingPrice("catalogPercent", 33, "10.01"), "3.30");
  });

  it("states none without a catalogue value, or without a default", () => {
    assert.equal(facebookDefaultStartingPrice("catalogPercent", 30, null), null);
    assert.equal(facebookDefaultStartingPrice("catalogPercent", 30, "0.00"), null);
    assert.equal(facebookDefaultStartingPrice(null, null, "12.50"), null);
  });
});

describe("parseBidIncrement (#1544)", () => {
  it("reads blank as none and a figure as two decimals", () => {
    assert.deepEqual(parseBidIncrement("  "), { ok: true, value: null });
    assert.deepEqual(parseBidIncrement("0,5"), { ok: true, value: "0.50" });
  });

  it("refuses nothing a bid could beat the last by", () => {
    assert.equal(parseBidIncrement("0").ok, false);
    assert.equal(parseBidIncrement("abc").ok, false);
  });
});

describe("the post's text (#1544; ADR-0061 §3)", () => {
  it("fills every placeholder and keeps an unknown token as typed", () => {
    const text = renderFacebookLotText(
      "Lot {lot}: {title} — {description}\nStart {startingPrice}, +{increment}, ends {closesAt} {startprice}",
      lot({ lotNo: 3 })
    );
    assert.equal(
      text,
      "Lot 3: Austria 1850 Mercury — Mercury, 1850, unused\nStart 10.00 PLN, +1.00 PLN, ends Sun 5 Oct, 20:00 {startprice}"
    );
  });

  it("still fills the retired {catalog}, so no post loses text unannounced (#1671)", () => {
    assert.equal(renderFacebookLotText("{catalog} {title}", lot()), "Mi·AT 1 Austria 1850 Mercury");
    assert.equal(renderFacebookLotText("{catalog}", lot({ listingType: "fixed" })), "Mi·AT 1");
  });

  it("fills a quick buy's price and keeps an auction's tokens in it as typed (#1671)", () => {
    const quickBuy = lot({ listingType: "fixed", price: "25.00 PLN" });
    assert.equal(
      renderFacebookLotText("{title}: {price} {closesAt}", quickBuy),
      "Austria 1850 Mercury: 25.00 PLN {closesAt}"
    );
    assert.equal(renderFacebookLotText("{title} {price}", lot()), "Austria 1850 Mercury {price}");
  });

  it("leaves {lot} empty on an offer posted alone", () => {
    assert.equal(renderFacebookLotText("[{lot}] {catalog}", lot()), "[] Mi·AT 1");
  });

  it("puts the offer's bare number where {offer} is, on an offer posted alone and a quick buy (#1694)", () => {
    assert.equal(renderFacebookLotText("#{offer} {title}", lot()), "#412 Austria 1850 Mercury");
    assert.equal(renderFacebookLotText("Offer {offer}: {price}", lot({ listingType: "fixed", price: "25.00 PLN" })), "Offer 412: 25.00 PLN");
  });

  it("gives each lot of a post its own offer's number in {offer} (#1694)", () => {
    const text = renderFacebookPostText({ auction: "Lot {lot} (#{offer})", quickBuy: "Lot {lot} (#{offer}) buy now" }, "", [
      lot({ lotNo: 2, offerNo: 37 }),
      lot({ lotNo: 1, offerNo: 412, listingType: "fixed" }),
    ]);
    assert.equal(text, "Lot 1 (#412) buy now\n\nLot 2 (#37)");
  });

  it("gives an empty post where the group has no template — nothing falls back (#1692)", () => {
    assert.equal(renderFacebookLotText("", lot()), "");
    assert.equal(renderFacebookLotText("", lot(), "Shipping 5 PLN."), "");
    assert.equal(renderFacebookPostText({ auction: "", quickBuy: "" }, "Shipping 5 PLN.", [lot()]), "");
  });

  it("puts the title in once and leaves {description} empty when the offer has none (#1692)", () => {
    const quickBuy = lot({ listingType: "fixed", description: "", price: "20.00 PLN" });
    const text = renderFacebookPostText(
      { auction: "", quickBuy: "{title}\nKup teraz - {price} + koszty wysyłki\n\n{description}" },
      "",
      [quickBuy]
    );
    assert.equal(text, "Austria 1850 Mercury\nKup teraz - 20.00 PLN + koszty wysyłki\n\n");
  });

  it("leaves the template's line breaks as they are, empty placeholders included (#1692)", () => {
    assert.equal(renderFacebookLotText("{title}\n\n{description}\n\n{price}", lot({ description: "" })), "Austria 1850 Mercury\n\n\n\n{price}");
  });

  it("joins the lots in lot order, the note where the last lot's {terms} is, once (#1689)", () => {
    const text = renderFacebookPostText(
      { auction: "Lot {lot}: {catalog}\n\n{terms}", quickBuy: "" },
      "Shipping 5 PLN.",
      [lot({ lotNo: 2, catalog: "Mi·AT 2" }), lot({ lotNo: 1, catalog: "Mi·AT 1" })]
    );
    assert.equal(text, "Lot 1: Mi·AT 1\n\n\n\nLot 2: Mi·AT 2\n\nShipping 5 PLN.");
  });

  it("leaves a lot with no template out of the post rather than leaving a gap (#1692)", () => {
    const text = renderFacebookPostText({ auction: "Lot {lot}", quickBuy: "" }, "", [
      lot({ lotNo: 1 }),
      lot({ lotNo: 2, listingType: "fixed" }),
      lot({ lotNo: 3 }),
    ]);
    assert.equal(text, "Lot 1\n\nLot 3");
  });

  it("puts the note where {terms} stands, not at the end (#1689)", () => {
    const text = renderFacebookPostText({ auction: "{title}\n{terms}\nStart {startingPrice}", quickBuy: "" }, "Shipping 5 PLN.", [
      lot(),
    ]);
    assert.equal(text, "Austria 1850 Mercury\nShipping 5 PLN.\nStart 10.00 PLN");
  });

  it("appends no note to a template without {terms} (#1689)", () => {
    assert.equal(renderFacebookPostText({ auction: "{title}", quickBuy: "" }, "Shipping 5 PLN.", [lot()]), "Austria 1850 Mercury");
  });

  it("writes each lot from its own type's template, never the other (#1671)", () => {
    const templates = { auction: "Lot {lot} auction: {startingPrice}", quickBuy: "Lot {lot} buy now: {price}" };
    const text = renderFacebookPostText(templates, "", [
      lot({ lotNo: 1 }),
      lot({ lotNo: 2, listingType: "fixed", price: "25.00 PLN" }),
    ]);
    assert.equal(text, "Lot 1 auction: 10.00 PLN\n\nLot 2 buy now: 25.00 PLN");
  });

  it("leaves an empty standing note empty, the template's lines as they are (#1692)", () => {
    assert.equal(renderFacebookPostText({ auction: "{catalog}\n\n{terms}", quickBuy: "" }, "  ", [lot()]), "Mi·AT 1\n\n");
  });

  it("writes a figure with its currency, and nothing for none", () => {
    assert.equal(facebookMoney("1.00", "PLN"), "1.00 PLN");
    assert.equal(facebookMoney(null, "PLN"), "");
  });
});

describe("facebookPostGaps (#1692)", () => {
  const templates = { auction: "{title}\n{description}\n{startingPrice}\n{terms}", quickBuy: "" };

  it("names nothing when every placed placeholder has a value and every type a template", () => {
    assert.deepEqual(facebookPostGaps(templates, "Shipping 5 PLN.", [lot()]), {
      missingTemplates: [],
      emptyPlaceholders: [],
    });
  });

  it("names the template a lot's type has none of", () => {
    assert.deepEqual(facebookPostGaps(templates, "Shipping", [lot({ listingType: "fixed" })]).missingTemplates, ["fixed"]);
    assert.deepEqual(
      facebookPostGaps({ auction: "", quickBuy: "" }, "", [lot(), lot({ listingType: "fixed" })]).missingTemplates,
      ["auction", "fixed"]
    );
  });

  it("names each placed placeholder that is empty, per lot, once", () => {
    const gaps = facebookPostGaps({ ...templates, auction: `${templates.auction}\n{description}` }, "", [
      lot({ description: "", startingPrice: "" }),
    ]);
    assert.deepEqual(gaps.emptyPlaceholders, [
      { lotNo: null, token: "{description}" },
      { lotNo: null, token: "{startingPrice}" },
      { lotNo: null, token: "{terms}" },
    ]);
  });

  it("names neither {lot} on an offer posted alone nor {terms} before the last lot", () => {
    const gaps = facebookPostGaps({ auction: "{lot} {title} {terms}", quickBuy: "" }, "Shipping", [lot()]);
    assert.deepEqual(gaps.emptyPlaceholders, []);
    const post = facebookPostGaps({ auction: "{lot} {title} {terms}", quickBuy: "" }, "Shipping", [
      lot({ lotNo: 2 }),
      lot({ lotNo: 1 }),
    ]);
    assert.deepEqual(post.emptyPlaceholders, []);
  });

  it("ignores a token the lot's type does not fill — that one is kept as typed, and warned in Settings", () => {
    assert.deepEqual(facebookPostGaps({ auction: "{price} {startprice}", quickBuy: "" }, "", [lot()]).emptyPlaceholders, []);
  });
});

describe("isFacebookLotPosted (#1668)", () => {
  it("reads a lot as up once it is past Ready", () => {
    assert.equal(isFacebookLotPosted("preparing"), false);
    assert.equal(isFacebookLotPosted("ready"), false);
    for (const state of ["active", "paused", "sold", "withdrawn"]) assert.equal(isFacebookLotPosted(state), true);
  });
});

describe("facebookPostRefusal (#1544; ADR-0061 §2)", () => {
  function offer(overrides: Partial<FacebookPostCandidate> = {}): FacebookPostCandidate {
    return {
      offerNo: 1,
      facebookGroupId: "g1",
      listingType: "auction",
      facebookPostId: null,
      state: "ready",
      url: null,
      ...overrides,
    };
  }

  it("lets two unposted auctions in one group become a post", () => {
    assert.equal(facebookPostRefusal([offer(), offer({ offerNo: 2, state: "preparing" })]), null);
  });

  it("refuses a single offer, another platform, a second group, another post, or one already up", () => {
    assert.match(facebookPostRefusal([offer()])!, /at least two/);
    assert.match(facebookPostRefusal([offer(), offer({ offerNo: 7, facebookGroupId: null })])!, /#7 is not a Facebook offer/);
    assert.match(facebookPostRefusal([offer(), offer({ offerNo: 2, facebookGroupId: "g2" })])!, /different groups/);
    assert.match(facebookPostRefusal([offer(), offer({ offerNo: 3, facebookPostId: "p" })])!, /#3 is already a lot/);
    assert.match(
      facebookPostRefusal([offer({ offerNo: 4, state: "active" }), offer({ offerNo: 5, state: "sold" })])!,
      /Offers #4 and #5 are already up or closed/
    );
  });

  it("keeps a post's lots to one listing type unless the group lets them mix (#1671)", () => {
    const mixed = [offer(), offer({ offerNo: 2, listingType: "fixed" }), offer({ offerNo: 3, listingType: "fixed" })];
    assert.equal(
      facebookPostRefusal(mixed),
      "The lots of one post share one listing type here: #1 is an auction and #2, #3 are quick buys. Post them apart, or let this group's posts mix them in Settings → Facebook."
    );
    assert.equal(facebookPostRefusal(mixed, { mixedListingTypes: true }), null);
    assert.equal(
      facebookPostRefusal([offer({ listingType: "fixed" }), offer({ offerNo: 2, listingType: "fixed" })]),
      null
    );
  });
});

describe("facebookMixedTypesRefusal (#1671)", () => {
  it("is null for lots of one type", () => {
    assert.equal(facebookMixedTypesRefusal([{ offerNo: 1, listingType: "auction" }]), null);
    assert.equal(facebookMixedTypesRefusal([]), null);
  });
});

describe("describeFacebookAuctionCopies (ADR-0061 §5)", () => {
  it("names each copy and the auction holding it", () => {
    assert.equal(
      describeFacebookAuctionCopies([{ itemNo: 12, offerNo: 41, groupName: "Znaczki" }]),
      "Copy #12 is already in an active Facebook offer: offer #41 in Znaczki. A copy is in one Facebook offer at a time, auction or quick buy — close or withdraw that one first."
    );
    assert.match(
      describeFacebookAuctionCopies([
        { itemNo: 12, offerNo: 41, groupName: "Znaczki" },
        { itemNo: 13, offerNo: 41, groupName: "Znaczki" },
      ]),
      /^Copies #12, #13 are already in an active Facebook offer: offer #41 in Znaczki\./
    );
  });
});

describe("readFacebookCreateChoice (#1663)", () => {
  it("reads the group and the closing time a shortcut sends", () => {
    assert.deepEqual(
      readFacebookCreateChoice({ facebookGroupId: " g1 ", endsAt: "2026-11-01T19:00:00.000Z" }),
      { facebookGroupId: "g1", endsAt: new Date("2026-11-01T19:00:00.000Z") }
    );
  });

  it("is nothing off Facebook, and a closing time without a group is none", () => {
    assert.deepEqual(readFacebookCreateChoice(undefined), { facebookGroupId: null, endsAt: null });
    assert.deepEqual(readFacebookCreateChoice({ facebookGroupId: "", endsAt: "2026-11-01T19:00:00.000Z" }), {
      facebookGroupId: null,
      endsAt: null,
    });
  });

  it("drops an unreadable closing time rather than refusing the group", () => {
    assert.deepEqual(readFacebookCreateChoice({ facebookGroupId: "g1", endsAt: "soon" }), {
      facebookGroupId: "g1",
      endsAt: null,
    });
  });
});
