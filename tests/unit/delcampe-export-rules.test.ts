import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DELCAMPE_UPLOAD_COLUMNS,
  delcampeDecimal,
  delcampeRowRefusals,
  delcampeUploadRow,
  disambiguateBundleNames,
  toDelcampeCsv,
} from "../../src/lib/delcampe-export-rules";
import {
  DELCAMPE_PROFILE_DEFAULTS,
  type DelcampeListingProfileValues,
} from "../../src/lib/delcampe-listing-profile-rules";

const PROFILE: DelcampeListingProfileValues = {
  ...DELCAMPE_PROFILE_DEFAULTS,
  name: "Standard letter",
  shippingModel: "Fee template",
};

const ROW_INPUT = {
  title: "Poland (1921) - Sowing Man - Mi:158 / Fi:125I / Yt:224 - Used",
  personalReference: "https://stamps.example.test/o/main/1242",
  description: "",
  categoryId: "7945",
  price: 0.1,
  quantity: 1,
  imageNames: ["poland-1921-sowing-man-01.jpg", "poland-1921-sowing-man-02.jpg"],
  profile: PROFILE,
};

describe("delcampeDecimal", () => {
  it("writes the upload direction's comma, always to two decimals", () => {
    // The two directions are not symmetric (#611 reads `17.44` back with a dot).
    assert.equal(delcampeDecimal(0.1), "0,10");
    assert.equal(delcampeDecimal(17.44), "17,44");
    assert.equal(delcampeDecimal(0), "0,00");
    assert.equal(delcampeDecimal(1200), "1200,00");
  });

  it("rounds a third decimal rather than letting it through", () => {
    assert.equal(delcampeDecimal(0.005), "0,01");
    assert.equal(delcampeDecimal(2.675), "2,68");
  });
});

describe("delcampeUploadRow", () => {
  it("answers every column the file states", () => {
    const row = delcampeUploadRow(ROW_INPUT);
    for (const column of DELCAMPE_UPLOAD_COLUMNS) {
      assert.equal(typeof row[column], "string", `${column} is missing`);
    }
  });

  it("writes the observed live row", () => {
    const row = delcampeUploadRow(ROW_INPUT);
    assert.equal(row.category_id, "7945");
    assert.equal(row.selling_type, "fixed_price");
    assert.equal(row.price, "0,10");
    // 0,10 is under the seeded threshold of 1, so the cheap step applies.
    assert.equal(row.minimum_bid_step, "0,01");
    assert.equal(row.initial_quantity, "1");
    assert.equal(row.renew_duration, "28");
    assert.equal(row.renew_total_count, "99");
    assert.equal(row.shipping_model, "Fee template");
    assert.equal(row.has_renewable_options, "N");
    assert.equal(row.option_strong_title, "N");
    assert.equal(row.option_homepage_promotion, "N");
  });

  it("pipes the picture names in plan order", () => {
    assert.equal(
      delcampeUploadRow(ROW_INPUT).images,
      "poland-1921-sowing-man-01.jpg|poland-1921-sowing-man-02.jpg"
    );
  });

  it("takes the bid step from the profile's rule, inclusive at the top", () => {
    const rule = { ...PROFILE, minBidStepThreshold: 1, minBidStepBelow: 0.01, minBidStepAtOrAbove: 0.1 };
    assert.equal(delcampeUploadRow({ ...ROW_INPUT, price: 0.99, profile: rule }).minimum_bid_step, "0,01");
    assert.equal(delcampeUploadRow({ ...ROW_INPUT, price: 1, profile: rule }).minimum_bid_step, "0,10");
  });

  it("carries the promotions the profile actually buys", () => {
    const row = delcampeUploadRow({
      ...ROW_INPUT,
      profile: { ...PROFILE, optionStrongTitle: true, hasRenewableOptions: true },
    });
    assert.equal(row.option_strong_title, "Y");
    assert.equal(row.option_background_color, "N");
    assert.equal(row.has_renewable_options, "Y");
  });

  it("leaves the auction end columns empty on a fixed-price listing", () => {
    const row = delcampeUploadRow(ROW_INPUT);
    assert.equal(row.sale_end_time, "");
    assert.equal(row.sale_end_day, "");
  });
});

describe("toDelcampeCsv", () => {
  it("heads the file with the columns in the file's own order", () => {
    const csv = toDelcampeCsv([delcampeUploadRow(ROW_INPUT)]);
    assert.equal(csv.split("\r\n")[0], DELCAMPE_UPLOAD_COLUMNS.join(","));
  });

  it("quotes the money columns, since the decimal comma is a separator", () => {
    const line = toDelcampeCsv([delcampeUploadRow(ROW_INPUT)]).split("\r\n")[1];
    assert.ok(line.includes('"0,10","0,01"'), line);
  });

  it("doubles a quote inside a title rather than dropping it", () => {
    const row = delcampeUploadRow({ ...ROW_INPUT, title: 'Poland "Sowing Man", used' });
    const line = toDelcampeCsv([row]).split("\r\n")[1];
    assert.ok(line.includes('"Poland ""Sowing Man"", used"'), line);
  });

  it("quotes a description holding line breaks", () => {
    const row = delcampeUploadRow({ ...ROW_INPUT, description: "Line one\nLine two" });
    assert.ok(toDelcampeCsv([row]).includes('"Line one\nLine two"'));
  });

  it("ends every row, the last one included", () => {
    const csv = toDelcampeCsv([delcampeUploadRow(ROW_INPUT), delcampeUploadRow(ROW_INPUT)]);
    assert.ok(csv.endsWith("\r\n"));
    assert.equal(csv.trimEnd().split("\r\n").length, 3);
  });

  it("writes a header on its own for an empty batch rather than nothing at all", () => {
    assert.equal(toDelcampeCsv([]), `${DELCAMPE_UPLOAD_COLUMNS.join(",")}\r\n`);
  });
});

describe("delcampeRowRefusals", () => {
  const candidate = {
    title: "Poland (1921) - Sowing Man - Used",
    description: "",
    categoryId: "7945",
    listingType: "fixed",
    price: 0.1,
    imageCount: 2,
    hasProfile: true,
    personalReference: "https://stamps.example.test/o/main/1242",
  };
  const noLimits = { maxTitleLength: null, maxDescriptionLength: null };

  it("passes a complete offer", () => {
    assert.deepEqual(delcampeRowRefusals(candidate, noLimits), []);
  });

  it("refuses an over-long title and says by how much — never truncates", () => {
    const refusals = delcampeRowRefusals(
      { ...candidate, title: "x".repeat(84) },
      { ...noLimits, maxTitleLength: 80 }
    );
    assert.equal(refusals.length, 1);
    assert.match(refusals[0], /84 characters, 4 over this platform's 80/);
  });

  it("accepts a title exactly at the cap", () => {
    assert.deepEqual(
      delcampeRowRefusals({ ...candidate, title: "x".repeat(80) }, { ...noLimits, maxTitleLength: 80 }),
      []
    );
  });

  it("says nothing about a title where the platform states no cap", () => {
    assert.deepEqual(delcampeRowRefusals({ ...candidate, title: "x".repeat(400) }, noLimits), []);
  });

  it("refuses an over-long description on the platform's own cap", () => {
    const refusals = delcampeRowRefusals(
      { ...candidate, description: "x".repeat(120) },
      { ...noLimits, maxDescriptionLength: 100 }
    );
    assert.match(refusals[0], /description is 120 characters, 20 over/);
  });

  it("refuses a listing with nothing a marketplace could show", () => {
    assert.match(delcampeRowRefusals({ ...candidate, title: "  " }, noLimits)[0], /no listing title/);
    assert.match(delcampeRowRefusals({ ...candidate, categoryId: null }, noLimits)[0], /category/);
    assert.match(delcampeRowRefusals({ ...candidate, hasProfile: false }, noLimits)[0], /profile/);
    assert.match(delcampeRowRefusals({ ...candidate, price: 0 }, noLimits)[0], /no price/);
    assert.match(delcampeRowRefusals({ ...candidate, imageCount: 0 }, noLimits)[0], /no photos/);
    assert.match(
      delcampeRowRefusals({ ...candidate, personalReference: null }, noLimits)[0],
      /personal_reference/
    );
  });

  it("refuses an auction rather than uploading it as a quick buy", () => {
    const refusals = delcampeRowRefusals({ ...candidate, listingType: "auction" }, noLimits);
    assert.match(refusals[0], /auction/);
  });

  it("reports every reason at once, so one export answers the whole batch", () => {
    const refusals = delcampeRowRefusals(
      { ...candidate, categoryId: null, imageCount: 0, price: 0 },
      noLimits
    );
    assert.equal(refusals.length, 3);
  });
});

describe("disambiguateBundleNames", () => {
  it("suffixes a colliding offer's whole set, keeping one listing's run one stem", () => {
    assert.deepEqual(
      disambiguateBundleNames(["poland-01.jpg", "poland-02.jpg"], "poland", "a1b2c3"),
      ["poland-a1b2c3-01.jpg", "poland-a1b2c3-02.jpg"]
    );
  });

  it("still disambiguates a name that does not start with the slug", () => {
    assert.deepEqual(disambiguateBundleNames(["odd.jpg"], "poland", "a1b2c3"), ["a1b2c3-odd.jpg"]);
  });
});
