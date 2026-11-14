import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// **A list's *Reset filters* always lets go of the applied filter preset** (#2534).
//
// Left to the list-view comparison alone, the button gave two results: a preset whose filters it
// cleared detached, and one that also held a sort, a grouping or a value the button leaves alone
// stayed on the chip marked *modified*. Each list with presets therefore calls `useDetachListPreset`
// beside its own clearing — and a rule that depends on every list remembering it is checked here,
// the way `text-field-coverage.test.ts` checks the text fields.
//
// A list is a file that renders `ListPresetsControl`. Its button is the JSX text *Reset filters* or
// *Clear filters* — in the same file, or in a child named below that draws it for the list.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(ROOT, "src");

/** A list whose button is drawn by a child component, handed the clearing as a prop. */
const BUTTON_DRAWN_ELSEWHERE: Record<string, string> = {
  "src/app/c/[collectionSlug]/supplies/supplies-panel.tsx":
    "src/app/c/[collectionSlug]/supplies/supply-register.tsx",
};

const BUTTON_TEXT = />\s*(Reset|Clear) filters\s*</;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("Reset filters detaches the applied preset (#2534)", () => {
  const lists = walk(SRC)
    .map(rel)
    .filter((file) => /<ListPresetsControl\b/.test(read(file)));

  const withButton = lists.filter((file) => {
    const drawnIn = BUTTON_DRAWN_ELSEWHERE[file];
    return BUTTON_TEXT.test(read(file)) || (drawnIn !== undefined && BUTTON_TEXT.test(read(drawnIn)));
  });

  it("finds the lists that carry the button", () => {
    // Copies, auction lots, Purchases, Posts and Packing supplies at the time of writing; fewer means
    // the scan has stopped seeing them, not that the lists have lost the button.
    assert.ok(withButton.length >= 5, `found only ${withButton.join(", ")}`);
  });

  it("every one of them lets go of the preset", () => {
    const missing = withButton.filter((file) => !/useDetachListPreset\(/.test(read(file)));
    assert.deepEqual(missing, [], "a list's Reset/Clear filters must call useDetachListPreset");
  });

  it("names only real files as drawing the button elsewhere", () => {
    for (const [list, child] of Object.entries(BUTTON_DRAWN_ELSEWHERE)) {
      assert.ok(lists.includes(list), `${list} no longer renders ListPresetsControl`);
      assert.match(read(child), BUTTON_TEXT, `${child} no longer draws the button`);
    }
  });
});
