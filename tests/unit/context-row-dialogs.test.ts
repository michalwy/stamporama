import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **A dialog opened from a dimmed context row is drawn at full strength, above the page** (#2064).
// A stamp kept only as context for a filtered descendant is dimmed with `opacity`, and an opacity
// below 1 makes its own stacking context: a dialog rendered inside that element came out dimmed,
// see-through and ranked only within the row. So no element that dims a row hosts a dialog — the
// row's dialogs are drawn beside it. Checked on every stamp tree that dims context rows: the Issues
// list (Tree and Flat draw the same node), the issue's page and the stamp picker.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../src/app/c/[collectionSlug]");

const DIMMING_ROWS = [
  "issues/issue-row.tsx",
  "issues/[issueId]/issue-detail-panel.tsx",
  "inventory/selectable-stamp-node.tsx",
];

function parse(relative: string): ts.SourceFile {
  const file = path.join(SRC, relative);
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
}

/** True when a JSX element's inline `style={{ … }}` sets `opacity`. */
function setsOpacity(opening: ts.JsxOpeningLikeElement): boolean {
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "style") continue;
    const expr = attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression;
    if (!expr || !ts.isObjectLiteralExpression(expr)) continue;
    if (expr.properties.some((p) => p.name?.getText() === "opacity")) return true;
  }
  return false;
}

/** A dialog drawn here: a hook's `{x.dialog}`, or an element whose tag names a dialog. */
function isDialog(node: ts.Node): boolean {
  if (ts.isJsxExpression(node) && node.expression && ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text === "dialog";
  }
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return /Dialog$/.test(node.tagName.getText());
  }
  return false;
}

/** Each element in the file that dims itself, with the dialogs drawn inside it. */
function dimmedElements(source: ts.SourceFile): { line: number; dialogs: string[] }[] {
  const found: { line: number; dialogs: string[] }[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening && setsOpacity(opening)) {
      const dialogs: string[] = [];
      const inside = (child: ts.Node) => {
        if (isDialog(child)) dialogs.push(child.getText());
        ts.forEachChild(child, inside);
      };
      if (ts.isJsxElement(node)) node.children.forEach(inside);
      found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, dialogs });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("dimmed context rows (#2064)", () => {
  for (const relative of DIMMING_ROWS) {
    it(`${relative} draws no dialog inside its dimmed row`, () => {
      const dimmed = dimmedElements(parse(relative));
      assert.ok(dimmed.length > 0, "the context-row dimming was not found — has it moved?");
      for (const { line, dialogs } of dimmed) {
        assert.deepEqual(dialogs, [], `line ${line}: these dialogs belong beside the dimmed row`);
      }
    });
  }

  it("the Issues list's stamp row still draws its dialogs", () => {
    const text = parse("issues/issue-row.tsx").getText();
    for (const dialog of ["addCopy", "addWant", "copies", "offers", "prices", "quickPrice"]) {
      assert.match(text, new RegExp(`\\{${dialog}\\.dialog\\}`), `${dialog}'s dialog is drawn`);
    }
  });
});
