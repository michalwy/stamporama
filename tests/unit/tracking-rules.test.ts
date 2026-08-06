import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRACKING_CODE_TOKEN,
  buildTrackingUrl,
  normalizeTrackingCode,
  parseTrackingUrlTemplate,
} from "../../src/lib/tracking-rules";

const TEMPLATE = `https://emonitoring.poczta-polska.pl/?numer=${TRACKING_CODE_TOKEN}`;

describe("normalizeTrackingCode", () => {
  it("trims what is stored", () => {
    assert.equal(normalizeTrackingCode("  PL123456789  "), "PL123456789");
  });

  it("treats a blank as not recorded", () => {
    assert.equal(normalizeTrackingCode(""), null);
    assert.equal(normalizeTrackingCode("   "), null);
  });

  it("leaves the carrier's own format alone", () => {
    assert.equal(normalizeTrackingCode("00 259007 71234567 89"), "00 259007 71234567 89");
  });
});

describe("parseTrackingUrlTemplate", () => {
  it("accepts an absolute address carrying the code token", () => {
    assert.deepEqual(parseTrackingUrlTemplate(` ${TEMPLATE} `), { ok: true, value: TEMPLATE });
  });

  it("treats a blank as a carrier with no tracking page", () => {
    assert.deepEqual(parseTrackingUrlTemplate("  "), { ok: true, value: null });
  });

  it("refuses a template that never says where the number goes", () => {
    const result = parseTrackingUrlTemplate("https://tracking.example/");
    assert.equal(result.ok, false);
  });

  it("refuses a relative or scheme-less address", () => {
    assert.equal(parseTrackingUrlTemplate(`tracking.example/?id=${TRACKING_CODE_TOKEN}`).ok, false);
    assert.equal(parseTrackingUrlTemplate(`/track/${TRACKING_CODE_TOKEN}`).ok, false);
  });
});

describe("buildTrackingUrl", () => {
  it("substitutes the code", () => {
    assert.equal(
      buildTrackingUrl(TEMPLATE, "PL123456789"),
      "https://emonitoring.poczta-polska.pl/?numer=PL123456789"
    );
  });

  it("substitutes every occurrence of the token", () => {
    assert.equal(
      buildTrackingUrl(`https://t.example/${TRACKING_CODE_TOKEN}?id=${TRACKING_CODE_TOKEN}`, "AB1"),
      "https://t.example/AB1?id=AB1"
    );
  });

  it("percent-encodes the code, so a carrier's spaces and slashes cannot rewrite the address", () => {
    assert.equal(buildTrackingUrl(TEMPLATE, "00 259/007"),
      "https://emonitoring.poczta-polska.pl/?numer=00%20259%2F007");
  });

  it("has nothing to link to without a code, a template, or the token", () => {
    assert.equal(buildTrackingUrl(TEMPLATE, null), null);
    assert.equal(buildTrackingUrl(TEMPLATE, "   "), null);
    assert.equal(buildTrackingUrl(null, "PL123456789"), null);
    assert.equal(buildTrackingUrl("https://tracking.example/", "PL123456789"), null);
  });
});
