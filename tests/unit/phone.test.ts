import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PHONE_START_PATH, phoneHomePath, phoneSalesPath, phoneStart } from "../../src/lib/phone";
import { isReturnableScreen } from "../../src/lib/sign-in-return";

// Where the home-screen icon lands (#2002, ADR-0072 §3): `/phone` goes straight into the collector's
// collection when there is one and offers the list when there are several.

describe("phoneStart", () => {
  it("goes straight into the only collection", () => {
    assert.deepEqual(phoneStart([{ slug: "poland" }]), {
      kind: "collection",
      href: "/c/poland/phone",
    });
  });

  it("offers the list when there are several", () => {
    assert.deepEqual(phoneStart([{ slug: "poland" }, { slug: "topicals" }]), { kind: "choose" });
  });

  it("says so when there is none", () => {
    assert.deepEqual(phoneStart([]), { kind: "none" });
  });
});

describe("the phone's addresses", () => {
  it("puts a collection's phone screens under its own path", () => {
    assert.equal(phoneHomePath("poland"), "/c/poland/phone");
    assert.equal(phoneSalesPath("poland"), "/c/poland/phone/sales");
  });

  // Signing in on the phone has to land back on the phone, not on the desk's collections list.
  it("is a screen signing in returns to", () => {
    assert.ok(isReturnableScreen(PHONE_START_PATH));
    assert.ok(isReturnableScreen(phoneHomePath("poland")));
  });
});
