import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAppVersionLabel } from "../../src/lib/version";

// The Pi runs builds of `main` since #2712, versioned `main-<short sha>`; only a release gets a `v`.

const saved = process.env.STAMPORAMA_VERSION;
afterEach(() => {
  if (saved === undefined) delete process.env.STAMPORAMA_VERSION;
  else process.env.STAMPORAMA_VERSION = saved;
});

describe("getAppVersionLabel", () => {
  it("prefixes a release with v", () => {
    process.env.STAMPORAMA_VERSION = "1.4.0";
    assert.equal(getAppVersionLabel(), "v1.4.0");
  });

  it("shows a main build as it is", () => {
    process.env.STAMPORAMA_VERSION = "main-1a2b3c4";
    assert.equal(getAppVersionLabel(), "main-1a2b3c4");
  });

  it("reads dev when no version is baked", () => {
    delete process.env.STAMPORAMA_VERSION;
    assert.equal(getAppVersionLabel(), "dev");
  });
});
