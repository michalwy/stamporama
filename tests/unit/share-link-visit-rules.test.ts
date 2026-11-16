import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeUserAgent,
  hasShareLinkVisits,
  isShareLinkKind,
  shareLinkStatus,
  shareLinkVisitCutoff,
  summarizeShareLinkVisits,
  visitCountText,
  type ShareLinkVisitData,
} from "../../src/lib/share-link-visit-rules";

// A share link's visit history (#2557), the pure half: what a browser string is called, what the
// link's dialog counts, which status a stored link reads as, and where 90 days end.

describe("describeUserAgent", () => {
  const cases: Array<[string, string]> = [
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Chrome · Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Safari · iOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
      "Chrome · iOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Edge · Windows",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox · Linux"],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Safari · macOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
      "Samsung Internet · Android",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]",
      "Facebook app · Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0]",
      "Messenger · iOS",
    ],
    ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Facebook link preview"],
    ["WhatsApp/2.23.20.0", "WhatsApp link preview"],
  ];
  for (const [ua, expected] of cases) {
    it(`calls ${expected} by its name`, () => assert.equal(describeUserAgent(ua), expected));
  }

  it("says what it can, and *Unknown browser* where it can say nothing", () => {
    assert.equal(describeUserAgent("curl/8.4.0"), "Unknown browser");
    assert.equal(describeUserAgent(null), "Unknown browser");
    assert.equal(describeUserAgent("  "), "Unknown browser");
    assert.equal(describeUserAgent("Something (Windows NT 10.0)"), "Windows");
  });
});

describe("the link's dialog line", () => {
  const visit = (at: string, own = false): ShareLinkVisitData => ({
    id: at,
    at,
    ipAddress: "203.0.113.1",
    userAgent: null,
    own,
  });

  it("counts buyers' visits and keeps the collector's own apart, out of *last opened*", () => {
    const summary = summarizeShareLinkVisits([
      visit("2026-11-17T18:45:00.000Z", true),
      visit("2026-11-17T14:10:00.000Z"),
      visit("2026-11-17T16:00:00.000Z"),
    ]);
    assert.deepEqual(summary, { visits: 2, ownVisits: 1, lastOpenedAt: "2026-11-17T16:00:00.000Z" });
    assert.equal(visitCountText(summary), "2 visits + 1 yours");
  });

  it("reads *not opened* from nothing but the collector's own", () => {
    const summary = summarizeShareLinkVisits([visit("2026-11-17T18:45:00.000Z", true)]);
    assert.equal(summary.lastOpenedAt, null);
    assert.equal(visitCountText(summary), "0 visits + 1 yours");
    assert.equal(visitCountText({ visits: 1, ownVisits: 0, lastOpenedAt: null }), "1 visit");
  });

  it("offers the history only while some link has a visit", () => {
    const link = { id: "l", createdAt: "x", endedAt: null, status: "current" as const, visits: [] };
    assert.equal(hasShareLinkVisits({ links: [link] }), false);
    assert.equal(hasShareLinkVisits({ links: [link, { ...link, status: "replaced", visits: [visit("y")] }] }), true);
  });
});

describe("a stored link's status", () => {
  it("says why an ended link ended, and reads a link whose row went another way as withdrawn", () => {
    assert.equal(shareLinkStatus("replaced", false), "replaced");
    assert.equal(shareLinkStatus("withdrawn", false), "withdrawn");
    assert.equal(shareLinkStatus(null, true), "current");
    assert.equal(shareLinkStatus(null, false), "withdrawn");
  });

  it("knows the five kinds and nothing else", () => {
    for (const kind of ["post_preview", "offer_specification", "proposal", "sale", "trade"]) assert.ok(isShareLinkKind(kind));
    assert.equal(isShareLinkKind("assistant"), false);
  });
});

describe("the 90 days", () => {
  it("ends exactly 90 days before now", () => {
    const now = new Date("2026-11-17T12:00:00.000Z");
    assert.equal(shareLinkVisitCutoff(now).toISOString(), "2026-08-19T12:00:00.000Z");
  });
});
