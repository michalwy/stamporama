import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegistrationPayload } from "./registration";

// The payload arrives from whatever page the user had in front when they clicked the icon, so the
// parser is a trust boundary: it either yields a fully-formed target or nothing.

const valid = {
  v: 1,
  name: "World (raspberrypi.local:3000)",
  apiBaseUrl: "http://raspberrypi.local:3000",
  collectionId: "col_123",
  collectionName: "World",
  regCode: "stmpr_abc",
  expiresAt: "2026-07-25T10:05:00.000Z",
};

test("accepts a well-formed payload", () => {
  const parsed = parseRegistrationPayload(JSON.stringify(valid));
  assert.deepEqual(parsed, valid);
});

test("rejects non-JSON, non-objects, and a missing payload", () => {
  assert.equal(parseRegistrationPayload(null), null);
  assert.equal(parseRegistrationPayload(""), null);
  assert.equal(parseRegistrationPayload("not json"), null);
  assert.equal(parseRegistrationPayload("[]"), null);
  assert.equal(parseRegistrationPayload("null"), null);
});

test("rejects an unknown payload version", () => {
  assert.equal(parseRegistrationPayload(JSON.stringify({ ...valid, v: 2 })), null);
});

test("requires the fields a request cannot be made without", () => {
  for (const field of ["apiBaseUrl", "collectionId", "regCode"] as const) {
    assert.equal(
      parseRegistrationPayload(JSON.stringify({ ...valid, [field]: "" })),
      null,
      `${field} must be required`
    );
    const without = { ...valid } as Record<string, unknown>;
    delete without[field];
    assert.equal(parseRegistrationPayload(JSON.stringify(without)), null, `${field} must be present`);
  }
});

test("rejects a base URL that is not http(s) — it decides where a token request goes", () => {
  for (const apiBaseUrl of ["javascript:alert(1)", "file:///etc/passwd", "raspberrypi.local"]) {
    assert.equal(parseRegistrationPayload(JSON.stringify({ ...valid, apiBaseUrl })), null, apiBaseUrl);
  }
});

test("falls back to the collection id when names are absent", () => {
  const parsed = parseRegistrationPayload(
    JSON.stringify({ v: 1, apiBaseUrl: "https://stamps.example", collectionId: "col_9", regCode: "stmpr_x" })
  );
  assert.equal(parsed?.collectionName, "col_9");
  assert.equal(parsed?.name, "col_9");
  assert.equal(parsed?.expiresAt, "");
});

test("trims surrounding whitespace", () => {
  const parsed = parseRegistrationPayload(
    JSON.stringify({ ...valid, regCode: "  stmpr_abc  ", apiBaseUrl: " http://x.local " })
  );
  assert.equal(parsed?.regCode, "stmpr_abc");
  assert.equal(parsed?.apiBaseUrl, "http://x.local");
});
