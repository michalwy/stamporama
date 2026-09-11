import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **The offer header's ⋮ *Regenerate title* entry is gated on `regeneratable`** (#1163).
//
// The defect this exists for: the entry read `regeneratable` **not at all**, so on a listing with
// neither its own title template (#774) nor the platform's, selecting it called
// `regenerateOfferText`, which rendered the generator's `null` and **emptied the title**. Nothing
// errored. The per-field ↻ controls, the agent surface (#711) and the other-language entries three
// lines below all honoured the guard; this one plain entry, reached for by name, did not.
//
// **Why a static check rather than a test of the rendered menu.** `menuActions` is built inside a
// `"use client"` React component and nothing in this repository renders one: there is no component
// test harness, `pnpm test:unit` is pure logic with no Prisma and no DOM, and the integration suite
// exercises domain functions. A session on this very screen deleted a menu entry outright and all
// three suites stayed green. So the array is unprotected, and the only instrument that can see it
// is the parser — `stamp-form-dialog-invalidation.test.ts` is the settled precedent for that shape
// and for stating its limits rather than leaving them to be discovered.
//
// **What this can and cannot see.** It asserts the entry's *shape*: that it carries a `disabled`
// decided by `regeneratable`, and a `hint` — #273's pair, a disabled control receiving no hover
// event, so the second line is the only thing that can say why. It cannot see the rendered menu,
// cannot see that a collector is actually stopped, and cannot see the destruction the gate
// prevents. That last half is asserted where it can be — `tests/integration/offer-listing-text.test.ts`,
// *empties a hand-written title when neither has a template*, which pins the hazard this entry
// must not reach.
// Neither half is the whole control; stated so nobody reads this as more than it is.
//
// Parsed rather than grepped, for `stamp-form-dialog-invalidation.test.ts`'s own reason: this
// file's comments name both `regenerate` and `regeneratable`, and so does the source file's, so a
// text search reports green over a tree where the gate was deleted.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PANEL = path.join(
  ROOT,
  "src/app/c/[collectionSlug]/offers/[offerId]/offer-detail-panel.tsx"
);

/** The entry's `key`, which is what identifies it in `menuActions`. */
const ENTRY_KEY = "regenerate";
/** The single answer every surface asking *is there a template to render from* reads (#1146). */
const GUARD = "regeneratable";

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ false,
    ts.ScriptKind.TSX
  );
}

/** Every object literal in the file carrying `key: "<name>"` as a plain string property. */
function entriesKeyed(source: ts.SourceFile, name: string): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (!ts.isIdentifier(property.name) || property.name.text !== "key") continue;
        if (ts.isStringLiteral(property.initializer) && property.initializer.text === name) {
          found.push(node);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/** The initializer of one property of an object literal, or null when it has none. */
function property(entry: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const p of entry.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    if (ts.isIdentifier(p.name) && p.name.text === name) return p.initializer;
  }
  return null;
}

/** The non-empty string literals anywhere inside an expression. */
function stringsIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (n.text.trim() !== "") found.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

describe("the offer header's Regenerate title entry (#1163)", () => {
  const source = parse(PANEL);
  const entries = entriesKeyed(source, ENTRY_KEY);

  // Asserted first so the checks below cannot pass by finding nothing — the way a check of this
  // shape fails silently, and the whole point of it is that nobody is watching. A rename of the
  // entry's key lands here, saying so, rather than turning the file green over an entry it no
  // longer reads.
  it("is found exactly once in the panel's menu actions", () => {
    assert.equal(
      entries.length,
      1,
      `expected one menu entry keyed "${ENTRY_KEY}" in ${path.relative(ROOT, PANEL)}, found ` +
        `${entries.length}. Either it was renamed — update ENTRY_KEY, the rule stopped covering ` +
        `it silently — or there are now two entries for one act.`
    );
  });

  it(`is disabled from \`${GUARD}\`, so it cannot empty the title`, () => {
    assert.equal(entries.length, 1);
    const disabled = property(entries[0], "disabled");
    assert.notEqual(
      disabled,
      null,
      `the entry has no \`disabled\` property, so it is offered on a listing with no title ` +
        `template and empties the title when it is taken (#1163). Gate it on ` +
        `\`offer.${GUARD}.name\` — the same answer the per-field ↻, the agent surface and the ` +
        `other-language entries read (#1146). Do not compute the question a second time.`
    );
    assert.match(
      disabled!.getText(source),
      new RegExp(`\\b${GUARD}\\b`),
      `the entry's \`disabled\` does not read \`${GUARD}\`, so it is gated on something else — ` +
        `#1146's whole point is that this question has one answer across the screen and the agent ` +
        `surface.`
    );
  });

  it("says why, because a disabled control never gets a hover event (#273)", () => {
    assert.equal(entries.length, 1);
    const hint = property(entries[0], "hint");
    assert.notEqual(
      hint,
      null,
      `the entry has no \`hint\`, so it greys out with no explanation — the mystery #273 is about, ` +
        `and the reason \`ui-patterns.md\` says to disable with a hint rather than hide.`
    );
    const wording = stringsIn(hint!);
    assert.ok(
      wording.length > 0,
      `the entry's \`hint\` carries no wording, so the disabled entry says nothing.`
    );
    assert.match(
      hint!.getText(source),
      new RegExp(`\\b${GUARD}\\b`),
      `the \`hint\` is not conditional on \`${GUARD}\`, so it is shown beside an entry that works ` +
        `— the hint exists to explain the disabled state and belongs on the same answer.`
    );
  });
});
