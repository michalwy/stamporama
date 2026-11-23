import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `.github/workflows/release.yml` cuts a release and starts the deploy (#2704). What keeps it safe is
// pinned here: only a manual dispatch from `main` starts it, it runs on a GitHub-hosted runner, it
// never starts a deploy before the tag's own CI run and the image are green, and no input reaches a
// `run:` script except through `env:`. Read as text, like `deploy-workflow.test.ts`.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const text = readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
const lines = text.split("\n").filter((line) => !/^\s*#/.test(line));
const has = (re: RegExp) => lines.some((line) => re.test(line));

function childrenOf(key: string) {
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `no top-level "${key}:"`);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^ {2}([A-Za-z_-]+):/);
    if (match) out.push(match[1]);
  }
  return out;
}

describe("release workflow", () => {
  it("starts only by a manual dispatch", () => {
    assert.deepEqual(childrenOf("on"), ["workflow_dispatch"]);
  });

  it("runs only in michalwy/stamporama, from main, on a GitHub-hosted runner", () => {
    assert.ok(has(/^ {4}if: github\.repository == 'michalwy\/stamporama' && github\.ref == 'refs\/heads\/main'$/));
    assert.ok(has(/^ {4}runs-on: ubuntu-latest$/));
  });

  it("is never cancelled halfway", () => {
    assert.ok(has(/^ {2}cancel-in-progress: false$/));
  });

  it("publishes the Release, moves latest and deploys only after the tag run, in that order", () => {
    const at = (name: string) => {
      const index = lines.findIndex((line) => line.trim() === `- name: ${name}`);
      assert.notEqual(index, -1, `no step "${name}"`);
      return index;
    };
    const order = [
      "Check the inputs, main and the version",
      "Read main's CI run for the commit",
      "Create the annotated tag",
      "Run CI on the tag and wait for it",
      "Publish the GitHub Release",
      "Move latest",
      "Start the deploy",
    ].map(at);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  it("puts no expression inside a run: script, where free-text notes could become shell", () => {
    let indent = -1;
    for (const line of lines) {
      if (indent >= 0) {
        if (line.trim() !== "" && line.search(/\S/) <= indent) indent = -1;
        else assert.ok(!line.includes("${{"), `expression inside run: ${line.trim()}`);
      }
      if (/^\s*run: \|$/.test(line)) indent = line.search(/\S/);
    }
  });
});
