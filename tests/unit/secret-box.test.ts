import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SECRET_KEY_ENV,
  SecretDecryptError,
  SecretKeyMissingError,
  openSecret,
  sealSecret,
  secretKeyConfigured,
  tryOpenSecret,
} from "../../src/lib/secret-box";

const KEY = "cLBk3n0tArEaLkEy/JustEntropyForTests=";
const OTHER_KEY = "aDiFfErEnTkEy/AlsoJustEntropy/Tests==";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env[SECRET_KEY_ENV];
  process.env[SECRET_KEY_ENV] = KEY;
});

afterEach(() => {
  if (saved === undefined) delete process.env[SECRET_KEY_ENV];
  else process.env[SECRET_KEY_ENV] = saved;
});

describe("sealSecret / openSecret", () => {
  it("round-trips a secret", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.refresh-token-value";
    assert.equal(openSecret(sealSecret(token)), token);
  });

  it("round-trips an empty string and non-ASCII text", () => {
    assert.equal(openSecret(sealSecret("")), "");
    assert.equal(openSecret(sealSecret("kolekcja — żółć")), "kolekcja — żółć");
  });

  it("never produces the same ciphertext twice", () => {
    // A fresh IV per call: these columns sit in a database the collector can read, and two
    // identical rows would say the two connections share a secret.
    assert.notEqual(sealSecret("same"), sealSecret("same"));
  });

  it("is self-describing", () => {
    const sealed = sealSecret("x");
    assert.ok(sealed.startsWith("v1."));
    assert.equal(sealed.split(".").length, 4);
  });
});

describe("openSecret failures", () => {
  it("refuses a value sealed under a different key", () => {
    const sealed = sealSecret("refresh");
    process.env[SECRET_KEY_ENV] = OTHER_KEY;
    assert.throws(() => openSecret(sealed), SecretDecryptError);
  });

  it("refuses a tampered ciphertext", () => {
    // GCM's whole reason for being here: a flipped byte has to fail loudly rather than yield
    // plausible garbage that Allegro then rejects as an expired grant.
    const parts = sealSecret("refresh").split(".");
    const ct = Buffer.from(parts[2], "base64url");
    ct[0] ^= 0xff;
    parts[2] = ct.toString("base64url");
    assert.throws(() => openSecret(parts.join(".")), SecretDecryptError);
  });

  it("refuses a tampered auth tag and a truncated value", () => {
    const parts = sealSecret("refresh").split(".");
    const tag = Buffer.from(parts[3], "base64url");
    tag[0] ^= 0xff;
    assert.throws(
      () => openSecret([parts[0], parts[1], parts[2], tag.toString("base64url")].join(".")),
      SecretDecryptError
    );
    assert.throws(() => openSecret("v1.abc.def"), SecretDecryptError);
    assert.throws(() => openSecret("v2.a.b.c"), SecretDecryptError);
  });

  it("reports a missing key as a configuration problem, not a corrupt value", () => {
    const sealed = sealSecret("refresh");
    delete process.env[SECRET_KEY_ENV];
    assert.equal(secretKeyConfigured(), false);
    assert.throws(() => sealSecret("x"), SecretKeyMissingError);
    assert.throws(() => openSecret(sealed), SecretKeyMissingError);
  });
});

describe("tryOpenSecret", () => {
  it("returns null instead of throwing, so a status screen can still render", () => {
    const sealed = sealSecret("refresh");
    assert.equal(tryOpenSecret(sealed), "refresh");
    process.env[SECRET_KEY_ENV] = OTHER_KEY;
    assert.equal(tryOpenSecret(sealed), null);
    delete process.env[SECRET_KEY_ENV];
    assert.equal(tryOpenSecret(sealed), null);
  });
});
