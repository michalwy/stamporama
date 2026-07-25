import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignProfileColors,
  normalizeBaseUrl,
  profileSubtitle,
  profileTarget,
  type Profile,
} from "./profile";

// Only the pure parts are covered here: the storage helpers need a chrome.storage double, while the
// colour derivation is exactly the bit whose guarantees matter (stable per target, never two alike).

const profile = (over: Partial<Profile>): Profile => ({
  id: "id",
  name: "Profile",
  apiBaseUrl: "http://localhost:3002",
  collectionId: "col_1",
  token: "stmpa_x",
  ...over,
});

describe("normalizeBaseUrl", () => {
  it("trims whitespace and trailing slashes", () => {
    assert.equal(normalizeBaseUrl("  http://pi.local:3000///  "), "http://pi.local:3000");
  });
});

describe("profileTarget", () => {
  it("ignores naming and trailing-slash differences", () => {
    assert.equal(
      profileTarget({ apiBaseUrl: "http://pi.local:3000/", collectionId: "col_1" }),
      profileTarget({ apiBaseUrl: "http://pi.local:3000", collectionId: " col_1 " })
    );
  });

  it("separates two collections on the same instance", () => {
    assert.notEqual(
      profileTarget({ apiBaseUrl: "http://pi.local:3000", collectionId: "col_1" }),
      profileTarget({ apiBaseUrl: "http://pi.local:3000", collectionId: "col_2" })
    );
  });
});

describe("profileSubtitle", () => {
  it("prefers the collection name and falls back to the id", () => {
    assert.equal(
      profileSubtitle(profile({ collectionName: "Polska" })),
      "http://localhost:3002 · Polska"
    );
    assert.equal(profileSubtitle(profile({})), "http://localhost:3002 · col_1");
  });
});

describe("assignProfileColors", () => {
  const dev = profile({ id: "a", name: "Dev" });
  const prod = profile({ id: "b", name: "Pi", apiBaseUrl: "http://pi.local:3000", collectionId: "col_9" });

  it("gives every profile a colour", () => {
    const colors = assignProfileColors([dev, prod]);
    assert.equal(colors.size, 2);
    for (const c of colors.values()) assert.match(c, /^hsl\(\d+ 62% 45%\)$/);
  });

  it("is stable across calls and unaffected by renames", () => {
    const first = assignProfileColors([dev, prod]).get("a");
    const renamed = assignProfileColors([{ ...dev, name: "Local dev" }, prod]).get("a");
    assert.equal(renamed, first);
  });

  it("follows the target, so re-pointing a profile re-colours it", () => {
    const before = assignProfileColors([dev]).get("a");
    const after = assignProfileColors([{ ...dev, collectionId: "col_other" }]).get("a");
    assert.notEqual(after, before);
  });

  it("never repeats a colour, even for identical targets", () => {
    const clones = ["a", "b", "c", "d"].map((id) => profile({ id }));
    const colors = [...assignProfileColors(clones).values()];
    assert.equal(new Set(colors).size, clones.length);
  });
});
