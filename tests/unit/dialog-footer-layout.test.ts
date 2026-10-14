import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { baseBtn } from "../../src/app/button-style";
import {
  DIALOG_FOOTER_ACTIONS,
  DIALOG_FOOTER_LEADING,
  DIALOG_FOOTER_ROW,
} from "../../src/app/dialog-footer-style";

// **A dialog footer's buttons fit on one line or wrap onto the next, and never draw over each
// other** (#1908). The suite has no layout engine, so it holds the three properties that make an
// overlap impossible: a button never shrinks below its label, the row wraps, and no group in the row
// may be squeezed below the buttons it holds — `minWidth: 0` on the leading group is exactly what
// drew *Move to Packed anyway* over *Do nothing*.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = readFileSync(path.resolve(HERE, "../../src/app/dialog-shell.tsx"), "utf8");

function body(name: string): string {
  const start = SHELL.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} not found in dialog-shell.tsx`);
  const next = SHELL.indexOf("\nexport ", start + 1);
  return SHELL.slice(start, next < 0 ? undefined : next);
}

describe("dialog footer layout", () => {
  it("never shrinks or wraps a button's label, so a button is always as wide as its label", () => {
    assert.equal(baseBtn.flexShrink, 0);
    assert.equal(baseBtn.whiteSpace, "nowrap");
  });

  it("wraps the footer row, so a group that does not fit moves to a line of its own", () => {
    assert.equal(DIALOG_FOOTER_ROW.display, "flex");
    assert.equal(DIALOG_FOOTER_ROW.flexWrap, "wrap");
    assert.equal(DIALOG_FOOTER_ROW.justifyContent, "flex-end");
    assert.ok(DIALOG_FOOTER_ROW.rowGap, "wrapped lines need a gap between them");
  });

  it("lets the leading group take the spare room but never shrink below its own content", () => {
    assert.equal(DIALOG_FOOTER_LEADING.flex, "1 1 0");
    // `minWidth: 0` (or any explicit minimum) would override the content-based minimum and let
    // a button inside overflow onto the next one.
    assert.equal(DIALOG_FOOTER_LEADING.minWidth, undefined);
    assert.equal(DIALOG_FOOTER_LEADING.overflow, undefined);
  });

  it("wraps Cancel and the action in a dialog too narrow for the pair", () => {
    assert.equal(DIALOG_FOOTER_ACTIONS.display, "flex");
    assert.equal(DIALOG_FOOTER_ACTIONS.flexWrap, "wrap");
    assert.equal(DIALOG_FOOTER_ACTIONS.minWidth, undefined);
  });

  it("is the layout the shared footer and DialogActions actually use", () => {
    assert.match(body("DialogFooter"), /style=\{DIALOG_FOOTER_ROW\}/);
    const actions = body("DialogActions");
    assert.match(actions, /\.\.\.DIALOG_FOOTER_LEADING/);
    assert.match(actions, /style=\{DIALOG_FOOTER_ACTIONS\}/);
    assert.doesNotMatch(actions, /minWidth:\s*0/);
  });
});
