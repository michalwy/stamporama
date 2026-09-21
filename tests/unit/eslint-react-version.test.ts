import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `eslint.config.mjs` names the React version instead of letting `eslint-plugin-react` detect it,
// because detection crashes on ESLint 10 (#1052). A named version is a second copy of what
// `package.json` already says, and a stale one fails silently: the lint still passes, it only runs
// the version-gated branches of the React rules for a React this project no longer has. So a React
// bump that forgets the lint config turns this red instead.
//
// Read as text rather than imported: importing the config pulls in `eslint-config-next` and every
// plugin behind it, for one string.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const lintConfig = readFileSync(path.join(repoRoot, "eslint.config.mjs"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

/** Every `react: { version: "…" }` in the lint config — there must be exactly one. */
const pinnedVersions = [...lintConfig.matchAll(/react:\s*\{\s*version:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("the React version named in the lint config", () => {
  it("is named exactly once", () => {
    assert.equal(pinnedVersions.length, 1, `found ${JSON.stringify(pinnedVersions)}`);
  });

  it("is the major.minor of the React this project depends on", () => {
    const declared = manifest.dependencies.react;
    const [, major, minor] = /^\D*(\d+)\.(\d+)/.exec(declared) ?? [];
    assert.ok(major !== undefined, `cannot read a version out of react: ${JSON.stringify(declared)}`);
    assert.equal(pinnedVersions[0], `${major}.${minor}`);
  });
});
