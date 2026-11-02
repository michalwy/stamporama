import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **The fronts-and-backs pairs list is drawn whether Card scans is open or collapsed** (#2348).
//
// The defect this exists for: with *Fronts and backs, alternating* chosen, files picked from the
// header's *Add card scans* while the section was collapsed set the pairs to check — and nothing
// appeared, because `AlternatingPairsDialog` was rendered inside the `!open ? null : (…)` block with
// everything else the section holds. The button is in the header and in view while collapsed, so the
// chooser closed onto a screen that had not changed. The section is deliberately left folded; the
// list must not depend on it.
//
// **Why a static check rather than a test of the rendered card.** `ScansCard` is a `"use client"`
// component and nothing in this repository renders one: there is no component test harness, and
// `pnpm test:unit` is pure logic with no DOM. `offer-regenerate-title-gate.test.ts` is the precedent
// for reading the JSX with the parser instead.
//
// **What this can and cannot see.** It asserts that no `<AlternatingPairsDialog>` in the file sits
// under a condition that reads `open` — a `cond ? … : …` or a `cond && …` whose condition names it.
// It cannot see the dialog actually open, nor *Add N cards* upload; the pairing itself is covered by
// `alternating-scan-pairs.test.ts` and the queue by the integration suite. Stated so nobody reads it
// as more than it is.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CARD = path.join(ROOT, "src/app/c/[collectionSlug]/shared/scans-card.tsx");

/** The state the section's caret toggles. */
const SECTION_OPEN = "open";
const DIALOG = "AlternatingPairsDialog";

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
}

/** Every JSX element in the file whose tag is `name`. */
function elementsNamed(source: ts.SourceFile, name: string): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === name
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/** Whether `node` contains the bare identifier `name` anywhere. */
function mentions(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true;
  return ts.forEachChild(node, (child) => mentions(child, name) || undefined) ?? false;
}

/** The conditions above `node` — of a ternary it is a branch of, or an `&&` it is the right of. */
function conditionsAbove(node: ts.Node): ts.Expression[] {
  const conditions: ts.Expression[] = [];
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent) && child !== parent.condition) {
      conditions.push(parent.condition);
    } else if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      child === parent.right
    ) {
      conditions.push(parent.left);
    }
  }
  return conditions;
}

describe("scans card — the fronts-and-backs pairs list on a collapsed section (#2348)", () => {
  const source = parse(CARD);
  const dialogs = elementsNamed(source, DIALOG);

  it("renders the pairs list", () => {
    assert.ok(dialogs.length > 0, `${DIALOG} is not rendered in scans-card.tsx`);
  });

  it("does not render it only while the section is open", () => {
    for (const dialog of dialogs) {
      const gated = conditionsAbove(dialog).filter((c) => mentions(c, SECTION_OPEN));
      assert.deepEqual(
        gated.map((c) => c.getText(source)),
        [],
        `${DIALOG} sits under a condition reading \`${SECTION_OPEN}\` — files chosen with the section collapsed would show no pairs`
      );
    }
  });
});
