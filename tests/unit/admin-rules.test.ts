import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deletionConfirmed,
  formatStorageBytes,
  isAdminEmail,
  nextDeletionPass,
  parseAdminEmails,
  sumStorage,
} from "../../src/lib/admin-rules";
import { resolveRegistrationSwitch } from "../../src/lib/registration";

// The pure half of the administrator's panel (#2719).

describe("resolveRegistrationSwitch", () => {
  it("follows the environment while no administrator has used the switch", () => {
    assert.equal(resolveRegistrationSwitch(null, false), false);
    assert.equal(resolveRegistrationSwitch(null, true), true);
  });

  it("follows the administrator's setting once there is one, whatever the environment says", () => {
    assert.equal(resolveRegistrationSwitch(true, false), true);
    assert.equal(resolveRegistrationSwitch(false, true), false);
  });
});

describe("sumStorage", () => {
  it("adds bytes and objects, and nothing is zero", () => {
    assert.deepEqual(sumStorage([]), { bytes: 0, objects: 0 });
    assert.deepEqual(
      sumStorage([
        { bytes: 10, objects: 1 },
        { bytes: 5, objects: 2 },
      ]),
      { bytes: 15, objects: 3 }
    );
  });
});

describe("formatStorageBytes", () => {
  it("reads at a glance", () => {
    assert.equal(formatStorageBytes(0), "0 B");
    assert.equal(formatStorageBytes(-5), "0 B");
    assert.equal(formatStorageBytes(Number.NaN), "0 B");
    assert.equal(formatStorageBytes(812), "812 B");
    assert.equal(formatStorageBytes(1024), "1 KB");
    assert.equal(formatStorageBytes(4.2 * 1024 * 1024), "4.2 MB");
    assert.equal(formatStorageBytes(37 * 1024 * 1024), "37 MB");
    assert.equal(formatStorageBytes(1.3 * 1024 ** 3), "1.3 GB");
  });

  it("does not print 1024 of a unit", () => {
    assert.equal(formatStorageBytes(1024 * 1024 - 1), "1 MB");
  });

  it("stops at terabytes", () => {
    assert.equal(formatStorageBytes(5000 * 1024 ** 4), "5000 TB");
  });
});

describe("deletionConfirmed", () => {
  it("needs the name exactly, apart from surrounding whitespace", () => {
    assert.equal(deletionConfirmed("Poland", "Poland"), true);
    assert.equal(deletionConfirmed("  Poland ", "Poland"), true);
    assert.equal(deletionConfirmed("poland", "Poland"), false);
    assert.equal(deletionConfirmed("Pol", "Poland"), false);
    assert.equal(deletionConfirmed("", "Poland"), false);
  });

  it("is never confirmed against an empty name", () => {
    assert.equal(deletionConfirmed("", ""), false);
    assert.equal(deletionConfirmed(" ", "  "), false);
  });
});

describe("nextDeletionPass", () => {
  const a = { table: "a", column: "collectionId" };
  const b = { table: "b", column: "collectionId" };

  it("goes round again with the tables that were refused", () => {
    assert.deepEqual(nextDeletionPass([a, b], [b]), { retry: [b], stuck: false });
  });

  it("is finished when nothing was refused", () => {
    assert.deepEqual(nextDeletionPass([a, b], []), { retry: [], stuck: false });
  });

  it("is stuck when a whole pass was refused", () => {
    assert.deepEqual(nextDeletionPass([a, b], [a, b]), { retry: [a, b], stuck: true });
  });
});

describe("ADMIN_EMAILS (#2729)", () => {
  it("is nobody while unset, empty or only separators", () => {
    for (const raw of [undefined, "", "  ", " , ,"]) {
      assert.equal(parseAdminEmails(raw).size, 0, String(raw));
      assert.equal(isAdminEmail("owner@example.com", raw), false, String(raw));
    }
  });

  it("trims and lower-cases every entry of a comma-separated list", () => {
    assert.deepEqual([...parseAdminEmails(" Owner@Example.com ,second@example.com,, ")], [
      "owner@example.com",
      "second@example.com",
    ]);
  });

  it("matches an account's email whatever its letter case, and nothing else", () => {
    const raw = "Owner@Example.com, second@example.com";
    assert.equal(isAdminEmail("owner@example.com", raw), true);
    assert.equal(isAdminEmail("SECOND@example.com", raw), true);
    assert.equal(isAdminEmail("third@example.com", raw), false);
    assert.equal(isAdminEmail("owner@example.co", raw), false);
    assert.equal(isAdminEmail("", raw), false);
    assert.equal(isAdminEmail(null, raw), false);
    assert.equal(isAdminEmail(undefined, raw), false);
  });
});
