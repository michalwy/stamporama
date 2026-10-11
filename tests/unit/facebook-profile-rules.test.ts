import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeFacebookProfileUrl } from "../../src/lib/facebook-profile-rules";

// A Facebook buyer's profile link (#1545; ADR-0061 §4): the one identity a repeat buyer is recognised
// by. The database half — finding the buyer by it when a Facebook offer is sold (#1777) — is
// `tests/integration/facebook-sales.test.ts`.

describe("normalizeFacebookProfileUrl", () => {
  const value = (raw: string) => {
    const r = normalizeFacebookProfileUrl(raw);
    assert.ok(r.ok, raw);
    return r.value;
  };

  it("stores every address of one profile as one link", () => {
    const canonical = "https://www.facebook.com/jan.kowalski";
    assert.equal(value("https://www.facebook.com/jan.kowalski"), canonical);
    assert.equal(value("https://m.facebook.com/Jan.Kowalski/"), canonical);
    assert.equal(value("facebook.com/jan.kowalski?ref=bookmarks#x"), canonical);
    assert.equal(value("  https://web.facebook.com/jan.kowalski  "), canonical);
    assert.equal(value("http://fb.com/jan.kowalski"), canonical);
  });

  it("keeps the id of a profile.php link, which is the profile", () => {
    assert.equal(
      value("https://m.facebook.com/profile.php?id=100012345678&mibextid=abc"),
      "https://www.facebook.com/profile.php?id=100012345678"
    );
    assert.equal(normalizeFacebookProfileUrl("https://www.facebook.com/profile.php").ok, false);
  });

  it("reads blank as no link, and refuses an address that is not a profile", () => {
    assert.deepEqual(normalizeFacebookProfileUrl("   "), { ok: true, value: null });
    assert.deepEqual(normalizeFacebookProfileUrl(null), { ok: true, value: null });
    assert.equal(normalizeFacebookProfileUrl("https://allegro.pl/uzytkownik/jan").ok, false);
    assert.equal(normalizeFacebookProfileUrl("https://www.facebook.com/").ok, false);
    assert.equal(normalizeFacebookProfileUrl("not a link at all").ok, false);
  });
});
