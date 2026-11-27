import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `ci.yml`'s `Deploy main to the Pi` job (#2712, the owner, 2026-11-27): the Pi follows `main`, and
// the deploy is dispatched only for a push to `main`, only after the image of that commit — and so
// all four suites — passed. Read as text, like `deploy-workflow.test.ts`.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const text = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const lines = text.split("\n").filter((line) => !/^\s*#/.test(line));

function job(name: string) {
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `no job "${name}"`);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break;
    out.push(line);
  }
  return out;
}

describe("ci.yml deploy-main", () => {
  const deploy = job("deploy-main");

  it("runs only for a push to main in michalwy/stamporama, after the image is published", () => {
    assert.ok(deploy.includes("    needs: [publish-image]"));
    assert.ok(
      deploy.includes(
        "    if: github.repository == 'michalwy/stamporama' && github.event_name == 'push' && github.ref == 'refs/heads/main'"
      )
    );
  });

  it("stays on a GitHub-hosted runner and only dispatches deploy.yml on main, automatic", () => {
    assert.ok(deploy.includes("    runs-on: ubuntu-latest"));
    const body = deploy.join("\n");
    assert.ok(body.includes('actions/workflows/deploy.yml/dispatches" -f ref=main'));
    assert.ok(body.includes('"inputs[automatic]=true"'));
  });

  it("builds the image only after the four suites", () => {
    assert.ok(job("build-image").includes("    needs: [static-checks, unit, integration, extension]"));
  });
});
