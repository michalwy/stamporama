import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PHONE_COLLECTIONS_PATH, PHONE_START_PATH, phoneHomePath, phoneSalesPath, phoneStart } from "../../src/lib/phone";
import { isReturnableScreen } from "../../src/lib/sign-in-return";

// Where the home-screen icon lands (#2002, ADR-0072 §3): `/phone` goes straight into the collector's
// collection when there is one, into the one last opened on the phone when there are several
// (#2574), and offers the list when none is remembered.

const POLAND = { id: "c-poland", slug: "poland" };
const TOPICALS = { id: "c-topicals", slug: "topicals" };

describe("phoneStart", () => {
  it("goes straight into the only collection", () => {
    assert.deepEqual(phoneStart([POLAND]), { kind: "collection", href: "/c/poland/phone" });
  });

  it("goes into the only collection whatever is remembered", () => {
    assert.deepEqual(phoneStart([POLAND], "c-gone"), {
      kind: "collection",
      href: "/c/poland/phone",
    });
  });

  it("offers the list when there are several and none is remembered", () => {
    assert.deepEqual(phoneStart([POLAND, TOPICALS]), { kind: "choose" });
    assert.deepEqual(phoneStart([POLAND, TOPICALS], null), { kind: "choose" });
  });

  it("opens the collection last used on the phone", () => {
    assert.deepEqual(phoneStart([POLAND, TOPICALS], "c-topicals"), {
      kind: "collection",
      href: "/c/topicals/phone",
    });
  });

  // Deleted, or not the collector's: the list is what is theirs.
  it("offers the list when the remembered collection is not among theirs", () => {
    assert.deepEqual(phoneStart([POLAND, TOPICALS], "c-someone-elses"), { kind: "choose" });
  });

  it("says so when there is none", () => {
    assert.deepEqual(phoneStart([]), { kind: "none" });
    assert.deepEqual(phoneStart([], "c-poland"), { kind: "none" });
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
    assert.ok(isReturnableScreen(PHONE_COLLECTIONS_PATH));
    assert.ok(isReturnableScreen(phoneHomePath("poland")));
  });
});
