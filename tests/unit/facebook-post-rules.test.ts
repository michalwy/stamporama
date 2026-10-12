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
  facebookPostLabel,
  facebookPostLink,
  facebookPostMoves,
  facebookPostSource,
  facebookPostStage,
  facebookPostTitleRefusal,
  FACEBOOK_POST_STAGES,
  FACEBOOK_POST_STAGE_LABEL,
  isFacebookPostStage,
  parseFacebookPostNo,
  facebookLotPhotoFileName,
  facebookLotUploadPhotos,
  isFacebookLotPosted,
  isFacebookPendingPostUrl,
  parseBidIncrement,
  readFacebookCreateChoice,
  facebookCaptionedPostGaps,
  facebookPartsText,
  readFacebookFrozenLot,
  renderFacebookCaptionedPost,
  renderFacebookLotText,
  renderFacebookPostText,
  type FacebookCaptionTemplates,
  type FacebookFrozenLot,
  type FacebookPostCandidate,
  type FacebookPostLotText,
  type FacebookPostSourceLot,
} from "../../src/lib/facebook-post-rules";
import { facebookTemplatePlaceholders } from "../../src/lib/facebook-group-rules";

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
    assert.equal(facebookMoney("1.00", "PLN"), "1 PLN");
    assert.equal(facebookMoney("1.50", "PLN"), "1.50 PLN");
    assert.equal(facebookMoney(null, "PLN"), "");
  });

  it("writes a whole price in a post without decimals, any other with both (#1787)", () => {
    const templates = { auction: "", quickBuy: "Kup teraz - {price}" };
    const quickBuy = (price: string) => lot({ listingType: "fixed", price: facebookMoney(price, "PLN") });
    assert.equal(renderFacebookPostText(templates, "", [quickBuy("15.00")]), "Kup teraz - 15 PLN");
    assert.equal(renderFacebookPostText(templates, "", [quickBuy("15.50")]), "Kup teraz - 15.50 PLN");
  });
});

describe("facebookPostGaps (#1692)", () => {
  const templates = { auction: "{title}\n{description}\n{startingPrice}\n{terms}", quickBuy: "" };

  it("names nothing when every placed placeholder has a value and every type a template", () => {
    assert.deepEqual(facebookPostGaps(templates, "Shipping 5 PLN.", [lot()]), {
      missingTemplates: [],
      emptyOwnTemplates: [],
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

describe("an offer's own post template (#1780)", () => {
  const templates = { auction: "Group: {title}", quickBuy: "Group buy: {title} {price}" };

  it("writes the offer's lot from its own template instead of the group's", () => {
    assert.equal(
      renderFacebookPostText(templates, "", [lot({ ownTemplate: "Mine: **{title}** from {startingPrice}" })]),
      "Mine: **Austria 1850 Mercury** from 10.00 PLN"
    );
  });

  it("follows the group's template for the lot's type when it has none", () => {
    assert.equal(renderFacebookPostText(templates, "", [lot({ ownTemplate: null })]), "Group: Austria 1850 Mercury");
    assert.equal(renderFacebookPostText(templates, "", [lot()]), "Group: Austria 1850 Mercury");
  });

  it("shapes only its own lot of a multi-lot post", () => {
    assert.equal(
      renderFacebookPostText(templates, "", [
        lot({ lotNo: 1, title: "A" }),
        lot({ lotNo: 2, title: "B", ownTemplate: "Lot {lot}, mine: {title}" }),
        lot({ lotNo: 3, title: "C" }),
      ]),
      "Group: A\n\nLot 2, mine: B\n\nGroup: C"
    );
  });

  it("keeps following the offer's figures, and places the note where the last lot's own template says", () => {
    assert.equal(
      renderFacebookPostText(templates, "Shipping 5 PLN.", [
        lot({ lotNo: 1, title: "A" }),
        lot({ lotNo: 2, title: "B", closesAt: "Mon 6 Oct, 21:00", ownTemplate: "{title} until {closesAt}\n{terms}" }),
      ]),
      "Group: A\n\nB until Mon 6 Oct, 21:00\nShipping 5 PLN."
    );
  });

  it("fills only its type's placeholders — another type's token stays as typed", () => {
    assert.equal(
      renderFacebookPostText(templates, "", [lot({ ownTemplate: "{title} {price}" })]),
      "Austria 1850 Mercury {price}"
    );
  });

  it("names an empty own template by its lot, not the group's template as missing", () => {
    const gaps = facebookPostGaps({ auction: "", quickBuy: "" }, "", [
      lot({ lotNo: 1, ownTemplate: "" }),
      lot({ lotNo: 2, ownTemplate: "{title}" }),
    ]);
    assert.deepEqual(gaps.missingTemplates, []);
    assert.deepEqual(gaps.emptyOwnTemplates, [1]);
    assert.equal(renderFacebookPostText({ auction: "", quickBuy: "" }, "", [lot({ ownTemplate: "" })]), "");
  });

  it("names the group's missing template only for the lots that follow it", () => {
    const gaps = facebookPostGaps({ auction: "", quickBuy: "" }, "", [
      lot({ lotNo: 1, ownTemplate: "{title}" }),
      lot({ lotNo: 2 }),
    ]);
    assert.deepEqual(gaps.missingTemplates, ["auction"]);
    assert.deepEqual(gaps.emptyOwnTemplates, []);
  });

  it("names the empty placeholders its own template places", () => {
    const gaps = facebookPostGaps(templates, "", [lot({ description: "", ownTemplate: "{title} {description}" })]);
    assert.deepEqual(gaps.emptyPlaceholders, [{ lotNo: null, token: "{description}" }]);
  });
});

describe("isFacebookLotPosted (#1668)", () => {
  it("reads a lot as up once it is past Ready", () => {
    assert.equal(isFacebookLotPosted("preparing"), false);
    assert.equal(isFacebookLotPosted("ready"), false);
    for (const state of ["pending", "active", "paused", "sold", "withdrawn"]) assert.equal(isFacebookLotPosted(state), true);
  });
});

describe("facebookPostLink (#1778)", () => {
  it("reads the post's link as the one most of its lots carry", () => {
    const post = "https://www.facebook.com/groups/1/pending_posts/2";
    const photo = "https://www.facebook.com/photo/?fbid=3";
    assert.equal(facebookPostLink([{ url: photo }, { url: post }, { url: post }]), post);
    assert.equal(facebookPostLink([{ url: post }, { url: photo }]), post, "the first lot's wins a tie");
  });

  it("is null when no lot carries a link", () => {
    assert.equal(facebookPostLink([]), null);
    assert.equal(facebookPostLink([{ url: null }, { url: "  " }]), null);
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

describe("isFacebookPendingPostUrl (#1779)", () => {
  it("knows a post held for a group administrator by its pending_posts segment", () => {
    assert.equal(isFacebookPendingPostUrl("https://www.facebook.com/groups/123/pending_posts/456"), true);
    assert.equal(isFacebookPendingPostUrl("  https://m.facebook.com/groups/123/pending_posts/  "), true);
    assert.equal(isFacebookPendingPostUrl("https://facebook.com/groups/abc/pending_posts"), true);
  });

  it("reads anything else as a post that is up, or no link at all", () => {
    assert.equal(isFacebookPendingPostUrl("https://www.facebook.com/groups/123/posts/456"), false);
    assert.equal(isFacebookPendingPostUrl("https://example.com/groups/1/pending_posts/2"), false);
    assert.equal(isFacebookPendingPostUrl("https://notfacebook.com/pending_posts/2"), false);
    assert.equal(isFacebookPendingPostUrl("https://www.facebook.com/groups/1/posts/2?ref=pending_posts"), false);
    assert.equal(isFacebookPendingPostUrl("not a link"), false);
    assert.equal(isFacebookPendingPostUrl(""), false);
  });
});

describe("the post as published (#1800)", () => {
  const group = {
    postTemplate: "Now: {title} from {startingPrice}, ends {closesAt}\n{terms}",
    quickBuyTemplate: "Buy {title} for {price}",
    standingNote: "New note",
    auctionCaptionTemplate: "",
    quickBuyCaptionTemplate: "",
    captionPostTemplate: "",
    layout: "text" as const,
  };
  const closesAt = (iso: string | null) => (iso ? `at ${iso}` : "");
  const frozen: FacebookFrozenLot = {
    frozenAt: "2026-10-11T10:00:00.000Z",
    listingType: "auction",
    template: "Then: {title} from {startingPrice}, ends {closesAt}\n{terms}",
    standingNote: "Old note",
    title: "Austria 1850 Mercury",
    description: "",
    catalog: "Mi·AT 1",
    startingPrice: "10.00",
    bidIncrement: "1.00",
    price: null,
    currency: "PLN",
    endsAt: "2026-10-18T18:00:00.000Z",
    layout: "text",
    postText: "",
    postTitle: "",
  };
  function source(overrides: Partial<FacebookPostSourceLot> = {}): FacebookPostSourceLot {
    return {
      offerId: "o1",
      lotNo: null,
      offerNo: 412,
      listingType: "auction",
      title: "Austria 1850 Mercury — retitled",
      description: "",
      catalog: "Mi·AT 1",
      startingPrice: "12.00",
      bidIncrement: "1.00",
      currency: "PLN",
      endsAt: "2026-10-20T18:00:00.000Z",
      price: "14.00",
      ownTemplate: null,
      frozen: null,
      ...overrides,
    };
  }
  const text = (s: ReturnType<typeof facebookPostSource>) => renderFacebookPostText(s.templates, s.standingNote, s.lots);

  it("draws a lot not yet published from the group's template and its figures now", () => {
    const s = facebookPostSource(group, [source()], closesAt);
    assert.equal(text(s), "Now: Austria 1850 Mercury — retitled from 12 PLN, ends at 2026-10-20T18:00:00.000Z\nNew note");
    assert.equal(s.frozenAt, null);
  });

  it("draws a published lot as it was posted — template, note and figures — whatever changed since", () => {
    const s = facebookPostSource(group, [source({ frozen, ownTemplate: "Own: {title}" })], closesAt);
    assert.equal(text(s), "Then: Austria 1850 Mercury from 10 PLN, ends at 2026-10-18T18:00:00.000Z\nOld note");
    assert.equal(s.frozenAt, frozen.frozenAt);
  });

  it("draws the lots a repost takes as they go up now", () => {
    const s = facebookPostSource(group, [source({ frozen })], closesAt, () => true);
    assert.equal(text(s), "Now: Austria 1850 Mercury — retitled from 12 PLN, ends at 2026-10-20T18:00:00.000Z\nNew note");
    assert.equal(s.frozenAt, null);
  });

  it("states a frozen quick buy's asking price as it was", () => {
    const quick = { ...frozen, listingType: "fixed" as const, template: "Buy {title} for {price}", price: "15.50" };
    const s = facebookPostSource(group, [source({ listingType: "fixed", price: "9.00", frozen: quick })], closesAt);
    assert.equal(text(s), "Buy Austria 1850 Mercury for 15.50 PLN");
  });

  it("states the last lot's note in a multi-lot post, frozen with it", () => {
    const lots = [
      source({ offerId: "a", lotNo: 1, frozen: { ...frozen, template: "{lot}. {title}", standingNote: "First" } }),
      source({ offerId: "b", lotNo: 2, offerNo: 413, frozen: { ...frozen, template: "{lot}. {title}\n{terms}" } }),
    ];
    assert.equal(text(facebookPostSource(group, lots, closesAt)), "1. Austria 1850 Mercury\n\n2. Austria 1850 Mercury\nOld note");
  });

  it("reads a stored snapshot back, and nothing that is not one", () => {
    assert.deepEqual(readFacebookFrozenLot(JSON.parse(JSON.stringify(frozen))), frozen);
    assert.equal(readFacebookFrozenLot(null), null);
    assert.equal(readFacebookFrozenLot({ ...frozen, template: 3 }), null);
    assert.equal(readFacebookFrozenLot({ ...frozen, listingType: "barter" }), null);
    assert.equal(readFacebookFrozenLot([frozen]), null);
  });
});

describe("a captioned post (#1841)", () => {
  const captions: FacebookCaptionTemplates = {
    auction: "{lot}. {title} from {startingPrice}",
    quickBuy: "{title} — {price}",
    post: "Lots {offer}\n{terms}",
  };
  const lots = [
    lot({ lotNo: 2, offerNo: 413, listingType: "fixed", price: "25 PLN", title: "Second" }),
    lot({ lotNo: 1, offerNo: 412, title: "First" }),
  ];
  const texts = (post: ReturnType<typeof renderFacebookCaptionedPost>) => ({
    post: facebookPartsText(post.post),
    captions: post.captions.map((c) => [c.lotNo, facebookPartsText(c.parts)]),
  });

  it("writes the shared text once and each lot's caption from its type's template, in lot order", () => {
    assert.deepEqual(texts(renderFacebookCaptionedPost(captions, " Shipping 7 PLN ", lots, { postNo: 1, title: null })), {
      post: "Lots 412, 413\nShipping 7 PLN",
      captions: [
        [1, "1. First from 10.00 PLN"],
        [2, "Second — 25 PLN"],
      ],
    });
  });

  it("keeps {terms} out of a caption — the note is the post's, stated once", () => {
    const out = renderFacebookCaptionedPost({ ...captions, auction: "{title} {terms}" }, "Note", [lots[1]], { postNo: 1, title: null });
    assert.equal(facebookPartsText(out.captions[0].parts), "First {terms}");
  });

  it("writes a lot's caption from its offer's own template where it has one", () => {
    const out = renderFacebookCaptionedPost(captions, "", [lot({ lotNo: 1, ownTemplate: "Own {title}" })], { postNo: 1, title: null });
    assert.equal(facebookPartsText(out.captions[0].parts), "Own Austria 1850 Mercury");
  });

  it("names what is missing: the shared text, a type's caption template, empty placeholders", () => {
    const gaps = facebookCaptionedPostGaps({ auction: "{title} {description}", quickBuy: "", post: "" }, "", [
      lot({ lotNo: 1, description: "" }),
      lot({ lotNo: 2, listingType: "fixed", price: "5 PLN" }),
    ], { postNo: 1, title: null });
    assert.equal(gaps.missingPostText, true);
    assert.deepEqual(gaps.missingTemplates, ["fixed"]);
    assert.deepEqual(gaps.emptyPlaceholders, [{ lotNo: 1, token: "{description}" }]);
    const note = facebookCaptionedPostGaps(captions, "  ", [lot({ lotNo: 1 })], { postNo: 1, title: null });
    assert.equal(note.missingPostText, false);
    assert.deepEqual(note.emptyPlaceholders, [{ lotNo: null, token: "{terms}" }]);
  });

  it("is drawn as it was published: the layout, the shared text and each caption, frozen", () => {
    const frozen: FacebookFrozenLot = {
      frozenAt: "2026-10-12T10:00:00.000Z",
      listingType: "auction",
      template: "Then {title}",
      standingNote: "Old note",
      title: "First",
      description: "",
      catalog: "",
      startingPrice: "10.00",
      bidIncrement: null,
      price: null,
      currency: "PLN",
      endsAt: null,
      layout: "captions",
      postText: "Old lots {offer}\n{terms}",
      postTitle: "",
    };
    const group = {
      postTemplate: "",
      quickBuyTemplate: "",
      standingNote: "New note",
      auctionCaptionTemplate: "Now {title}",
      quickBuyCaptionTemplate: "",
      captionPostTemplate: "New lots {offer}",
      layout: "text" as const,
    };
    const one = {
      offerId: "o1",
      lotNo: 1,
      offerNo: 412,
      listingType: "auction" as const,
      title: "First, retitled",
      description: "",
      catalog: "",
      startingPrice: "12.00",
      bidIncrement: null,
      currency: "PLN",
      endsAt: null,
      price: "0.00",
      ownTemplate: null,
      frozen,
    };
    const s = facebookPostSource(group, [one], () => "");
    assert.equal(s.layout, "captions");
    assert.deepEqual(texts(renderFacebookCaptionedPost(s.captions, s.standingNote, s.lots, { postNo: 1, title: null })), {
      post: "Old lots 412\nOld note",
      captions: [[1, "Then First"]],
    });
    // Not yet published, it follows the group's layout and templates now.
    const live = facebookPostSource({ ...group, layout: "captions" }, [{ ...one, frozen: null }], () => "");
    assert.deepEqual(texts(renderFacebookCaptionedPost(live.captions, live.standingNote, live.lots, { postNo: 1, title: null })), {
      post: "New lots 412",
      captions: [[1, "Now First, retitled"]],
    });
  });

  it("puts the post's number where the shared text or a caption has {post} (#1854)", () => {
    const out = renderFacebookCaptionedPost(
      { ...captions, auction: "Post #{post}, lot {lot}: {title}", post: "Post #{post} — lots {offer}" },
      "",
      [lots[1]],
      { postNo: 7, title: null }
    );
    assert.deepEqual(texts(out), { post: "Post #7 — lots 412", captions: [[1, "Post #7, lot 1: First"]] });
    // An offer's own template writes its caption, so it takes {post} there too.
    const own = renderFacebookCaptionedPost(captions, "", [lot({ lotNo: 1, ownTemplate: "{post}/{lot}" })], { postNo: 7, title: null });
    assert.equal(facebookPartsText(own.captions[0].parts), "7/1");
  });

  it("keeps {post} as typed in a post template — an offer posted alone has no post number (#1854)", () => {
    const templates = { auction: "Post {post}: {title}", quickBuy: "" };
    assert.equal(renderFacebookPostText(templates, "", [lot({ lotNo: null })]), "Post {post}: Austria 1850 Mercury");
    assert.equal(renderFacebookPostText(templates, "", [lot({ lotNo: 1 })]), "Post {post}: Austria 1850 Mercury");
    assert.deepEqual(facebookPostGaps(templates, "", [lot({ lotNo: null })]).emptyPlaceholders, []);
  });

  it("names {post} as empty where a captioned post has no number (#1854)", () => {
    const gaps = facebookCaptionedPostGaps(
      { ...captions, auction: "{title} {post}", post: "Post {post}" },
      "",
      [lot({ lotNo: 1 })],
      null
    );
    assert.deepEqual(gaps.emptyPlaceholders, [
      { lotNo: null, token: "{post}" },
      { lotNo: 1, token: "{post}" },
    ]);
    const numbered = facebookCaptionedPostGaps({ ...captions, auction: "{title} {post}", post: "Post {post}" }, "", [lot({ lotNo: 1 })], { postNo: 3, title: null });
    assert.deepEqual(numbered.emptyPlaceholders, []);
  });

  it("reads a snapshot older than the layout as the post's text", () => {
    const old = readFacebookFrozenLot({
      frozenAt: "2026-10-11T10:00:00.000Z",
      listingType: "auction",
      template: "{title}",
    });
    assert.equal(old?.layout, "text");
    assert.equal(old?.postText, "");
  });
});

describe("a multi-lot post's screen (#1842)", () => {
  const lots = (...states: string[]) => states.map((state, i) => ({ state, lotNo: i + 1 }));

  it("offers activating or submitting only when every lot is Ready", () => {
    const ready = facebookPostMoves(lots("ready", "ready"));
    assert.equal(ready.activate, true);
    assert.equal(ready.submit, true);
    assert.equal(ready.approve, false);
    assert.equal(ready.takeOut, true);
    assert.deepEqual(ready.waiting, []);

    const short = facebookPostMoves(lots("ready", "preparing", "preparing"));
    assert.equal(short.activate, false);
    assert.equal(short.submit, false);
    assert.deepEqual(short.waiting, [2, 3]);
  });

  it("finishes an activation refused halfway, but not a submission into a live post", () => {
    const half = facebookPostMoves(lots("active", "ready"));
    assert.equal(half.activate, true);
    assert.equal(half.submit, false);
    assert.equal(half.takeOut, false);
  });

  it("offers approve, reject and withdraw while the post waits for approval, and nothing else", () => {
    const pending = facebookPostMoves(lots("pending", "pending"));
    assert.deepEqual(
      [pending.activate, pending.submit, pending.approve, pending.reject, pending.withdraw, pending.takeOut],
      [false, false, true, true, true, false]
    );
  });

  it("offers no move of the post's own once it is up, and no take-out", () => {
    const up = facebookPostMoves(lots("active", "sold", "withdrawn"));
    assert.deepEqual(
      [up.activate, up.submit, up.approve, up.reject, up.withdraw, up.takeOut],
      [false, false, false, false, false, false]
    );
    assert.deepEqual(up.waiting, []);
  });

  it("says where the post stands as a whole", () => {
    assert.equal(facebookPostStage(lots("preparing", "ready")), "preparing");
    assert.equal(facebookPostStage(lots("ready", "ready")), "ready");
    assert.equal(facebookPostStage(lots("pending", "ready")), "pending");
    assert.equal(facebookPostStage(lots("active", "sold")), "up");
    assert.equal(facebookPostStage(lots("paused", "withdrawn")), "up");
    assert.equal(facebookPostStage(lots("sold", "withdrawn")), "over");
  });

  it("reads a post number from a filter only as a positive whole number", () => {
    assert.equal(parseFacebookPostNo("12"), 12);
    for (const bad of [null, undefined, "", "0", "-3", "1.5", "12a", " 12", "99999999999999999999"]) {
      assert.equal(parseFacebookPostNo(bad), undefined, String(bad));
    }
  });

  it("shows a lot's upload set, in upload order, under the name the post's ZIP gives it (#1848)", () => {
    const images = [
      { id: "a", publish: true, overLimit: false },
      { id: "held", publish: false, overLimit: false },
      { id: "b", publish: true, overLimit: false },
      { id: "past", publish: true, overLimit: true },
    ];
    assert.deepEqual(
      facebookLotUploadPhotos(images).map((i) => i.id),
      ["a", "b"]
    );
    assert.equal(facebookLotPhotoFileName(3, "penny-black-01.jpg"), "lot-03-penny-black-01.jpg");
    assert.equal(facebookLotPhotoFileName(12, "x.jpg"), "lot-12-x.jpg");
  });
});

describe("the list of posts' stage filter (#1850)", () => {
  it("offers every stage a post can be at, once, in the order a post passes through them", () => {
    assert.deepEqual([...FACEBOOK_POST_STAGES], ["preparing", "ready", "pending", "up", "over"]);
    assert.deepEqual([...FACEBOOK_POST_STAGES].sort(), Object.keys(FACEBOOK_POST_STAGE_LABEL).sort());
  });

  it("reads a stage from the address only when it is one", () => {
    for (const stage of FACEBOOK_POST_STAGES) assert.equal(isFacebookPostStage(stage), true);
    for (const bad of ["", "active", "Up", "sold"]) assert.equal(isFacebookPostStage(bad), false, bad);
  });
});

describe("a post's title (#1862)", () => {
  const captions: FacebookCaptionTemplates = {
    auction: "{postTitle}, lot {lot}: {title}",
    quickBuy: "",
    post: "Post #{post} · {postTitle}",
  };
  const titled = { postNo: 4, title: "Generalgouvernement 1940–44" };
  const untitled = { postNo: 4, title: null };
  const texts = (post: ReturnType<typeof renderFacebookCaptionedPost>) => ({
    post: facebookPartsText(post.post),
    captions: post.captions.map((c) => facebookPartsText(c.parts)),
  });

  it("names a post by number and title, or by number alone while it has none", () => {
    assert.equal(facebookPostLabel(titled), "Post #4 · Generalgouvernement 1940–44");
    assert.equal(facebookPostLabel(untitled), "Post #4");
    assert.equal(facebookPostLabel({ postNo: 4, title: "  " }), "Post #4");
  });

  it("refuses a blank title — every post has one", () => {
    assert.equal(facebookPostTitleRefusal("Generalgouvernement"), null);
    assert.equal(facebookPostTitleRefusal(""), "A post needs a title.");
    assert.equal(facebookPostTitleRefusal("   "), "A post needs a title.");
  });

  it("is offered beside {post} in the captioned post's text and its captions, and in no post template", () => {
    const tokens = (role: "post" | "caption" | "captionPost", type: "auction" | "fixed") =>
      facebookTemplatePlaceholders(role, type).map((p) => p.token);
    for (const type of ["auction", "fixed"] as const) {
      assert.ok(tokens("caption", type).includes("{postTitle}"), type);
      assert.ok(!tokens("post", type).includes("{postTitle}"), type);
    }
    assert.ok(tokens("captionPost", "auction").includes("{postTitle}"));
  });

  it("puts the title where the shared text, a caption or an offer's own template has {postTitle}", () => {
    const out = renderFacebookCaptionedPost(captions, "", [lot({ lotNo: 1, title: "First" })], titled);
    assert.deepEqual(texts(out), {
      post: "Post #4 · Generalgouvernement 1940–44",
      captions: ["Generalgouvernement 1940–44, lot 1: First"],
    });
    const own = renderFacebookCaptionedPost(captions, "", [lot({ lotNo: 1, ownTemplate: "[{postTitle}]" })], titled);
    assert.equal(facebookPartsText(own.captions[0].parts), "[Generalgouvernement 1940–44]");
  });

  it("keeps {postTitle} as typed in a post template — an offer posted alone has no post", () => {
    const templates = { auction: "{postTitle}: {title}", quickBuy: "" };
    assert.equal(renderFacebookPostText(templates, "", [lot({ lotNo: null })]), "{postTitle}: Austria 1850 Mercury");
  });

  it("leaves {postTitle} empty on a post with no title and names the want once, never per lot", () => {
    const lots = [lot({ lotNo: 1 }), lot({ lotNo: 2 })];
    assert.deepEqual(texts(renderFacebookCaptionedPost(captions, "", lots, untitled)), {
      post: "Post #4 · ",
      captions: [", lot 1: Austria 1850 Mercury", ", lot 2: Austria 1850 Mercury"],
    });
    const gaps = facebookCaptionedPostGaps(captions, "", lots, untitled);
    assert.equal(gaps.missingPostTitle, true);
    assert.deepEqual(gaps.emptyPlaceholders, []);
    assert.equal(facebookCaptionedPostGaps(captions, "", lots, titled).missingPostTitle, false);
    // A title nobody places is no gap, whether the post has one or not.
    const plain = { ...captions, auction: "{title}", post: "Post #{post}" };
    assert.equal(facebookCaptionedPostGaps(plain, "", lots, untitled).missingPostTitle, false);
    // Placed only in a caption, it is still the post's one want.
    const inCaption = { ...captions, post: "Post #{post}" };
    assert.equal(facebookCaptionedPostGaps(inCaption, "", lots, untitled).missingPostTitle, true);
  });

  describe("as published (#1800)", () => {
    const group = {
      postTemplate: "",
      quickBuyTemplate: "",
      standingNote: "",
      auctionCaptionTemplate: "{postTitle}: {title}",
      quickBuyCaptionTemplate: "",
      captionPostTemplate: "{postTitle}",
      layout: "captions" as const,
    };
    const frozen = (postTitle: string | null): FacebookFrozenLot => ({
      frozenAt: "2026-10-12T10:00:00.000Z",
      listingType: "auction",
      template: "{postTitle}: {title}",
      standingNote: "",
      title: "First",
      description: "",
      catalog: "",
      startingPrice: "10.00",
      bidIncrement: null,
      price: null,
      currency: "PLN",
      endsAt: null,
      layout: "captions",
      postText: "{postTitle}",
      postTitle,
    });
    const one = (snapshot: FacebookFrozenLot | null): FacebookPostSourceLot => ({
      offerId: "o1",
      lotNo: 1,
      offerNo: 412,
      listingType: "auction",
      title: "First",
      description: "",
      catalog: "",
      startingPrice: "10.00",
      bidIncrement: null,
      currency: "PLN",
      endsAt: null,
      price: "0.00",
      ownTemplate: null,
      frozen: snapshot,
    });
    const renamed = { ...group, post: { postNo: 4, title: "Renamed since" } };
    const drawn = (snapshot: FacebookFrozenLot | null) => {
      const s = facebookPostSource(renamed, [one(snapshot)], () => "");
      return texts(renderFacebookCaptionedPost(s.captions, s.standingNote, s.lots, s.post));
    };

    it("keeps the title the post went up with, however it is renamed after", () => {
      assert.deepEqual(drawn(frozen("As posted")), { post: "As posted", captions: ["As posted: First"] });
      // Posted with none, it stays with none — the title given since was not posted.
      assert.deepEqual(drawn(frozen("")), { post: "", captions: [": First"] });
    });

    it("reads the title now on a snapshot older than titles, and on a post not yet published", () => {
      assert.deepEqual(drawn(frozen(null)), { post: "Renamed since", captions: ["Renamed since: First"] });
      assert.deepEqual(drawn(null), { post: "Renamed since", captions: ["Renamed since: First"] });
    });

    it("reads a snapshot without a title as older than titles", () => {
      const { postTitle: _drop, ...older } = frozen("x");
      void _drop;
      assert.equal(readFacebookFrozenLot(older)!.postTitle, null);
      assert.equal(readFacebookFrozenLot(frozen(""))!.postTitle, "");
    });

    it("has no post for an offer posted alone", () => {
      assert.equal(facebookPostSource(group, [one(null)], () => "").post, null);
    });
  });
});
