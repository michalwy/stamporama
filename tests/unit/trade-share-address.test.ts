import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SECRET_KEY_ENV } from "../../src/lib/secret-box";
import {
  readTradeShareAddress,
  sealTradeShareToken,
} from "../../src/lib/trade-share-address";

// Showing the collector their own partner link again (#681).
//
// The whole of this module is a decision about what to tell the collector, so what is asserted here
// is the *reason* rather than the mechanics: a link that regenerates into a readable one must not be
// reported like a link whose install has no key, since regenerating there breaks the partner's
// address and fixes nothing.

const KEY = "cLBk3n0tArEaLkEy/JustEntropyForTests=";
const OTHER_KEY = "aDiFfErEnTkEy/AlsoJustEntropy/Tests==";
const TOKEN = "stmpx_Ck2h9Qv3ZmR7pT1yXw0sLbNfE4aJdU8g";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env[SECRET_KEY_ENV];
  process.env[SECRET_KEY_ENV] = KEY;
});

afterEach(() => {
  if (saved === undefined) delete process.env[SECRET_KEY_ENV];
  else process.env[SECRET_KEY_ENV] = saved;
});

describe("the collector's copy of the partner link (#681)", () => {
  it("seals a minted token and reads it back", () => {
    const sealed = sealTradeShareToken(TOKEN);
    assert.ok(sealed);
    assert.notEqual(sealed, TOKEN, "the stored value is not the token");
    assert.ok(!sealed.includes(TOKEN.slice(6)), "nor does it carry it in the clear");
    assert.deepEqual(readTradeShareAddress(sealed), { readable: true, token: TOKEN });
  });

  it("mints without a key rather than refusing to share", () => {
    // `STAMPORAMA_SECRET_KEY` is optional (ADR-0023 needs it only for Allegro), and a link that
    // refused to exist without one would take a working feature away from those installs.
    delete process.env[SECRET_KEY_ENV];
    assert.equal(sealTradeShareToken(TOKEN), null);
  });

  it("says a link minted before #681 needs regenerating", () => {
    assert.deepEqual(readTradeShareAddress(null), { readable: false, reason: "legacy" });
  });

  it("says a missing key is the thing to fix, not the link", () => {
    // The distinction that matters: here a new link would be just as unreadable, so advising one
    // would break the address the partner is holding and change nothing else.
    delete process.env[SECRET_KEY_ENV];
    assert.deepEqual(readTradeShareAddress(null), { readable: false, reason: "unconfigured" });
    assert.deepEqual(readTradeShareAddress("v1.a.b.c"), {
      readable: false,
      reason: "unconfigured",
    });
  });

  it("says a key that changed under a sealed link is why it will not open", () => {
    const sealed = sealTradeShareToken(TOKEN);
    assert.ok(sealed);
    process.env[SECRET_KEY_ENV] = OTHER_KEY;
    assert.deepEqual(readTradeShareAddress(sealed), { readable: false, reason: "unreadable" });
  });

  it("reads a corrupt value as unreadable rather than throwing", () => {
    assert.deepEqual(readTradeShareAddress("not-a-sealed-value"), {
      readable: false,
      reason: "unreadable",
    });
  });
});
