import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **A checkbox that leads a row beside a `CaretCell` sits in a `CheckCell`** (#2314).
//
// A caret's cell reaches out to the row's edges through `bleed` (#1589), and on a row that also has
// a checkbox the reach towards the box is meant to be half the gap between them. A bare checkbox
// beside the caret has no cell of its own to claim that half, and the sale screen's sold-set card
// kept the row's whole padding as the caret's bleed when its tick was added (#2204): the caret's
// cell lay over the box, and a click on the tick expanded or collapsed the card instead. Wrapping
// the box in `CheckCell` is what makes the two cells split the space between them, so the rule is
// checked here rather than remembered.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(ROOT, "src");

interface Finding {
  file: string;
  line: number;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function tagName(node: ts.Node): string | undefined {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return undefined;
}

function isCheckbox(node: ts.Node): boolean {
  const attributes = ts.isJsxElement(node)
    ? node.openingElement.attributes
    : ts.isJsxSelfClosingElement(node)
      ? node.attributes
      : undefined;
  if (!attributes || tagName(node) !== "input") return false;
  return attributes.properties.some(
    (attr) =>
      ts.isJsxAttribute(attr) &&
      attr.name.getText() === "type" &&
      attr.initializer !== undefined &&
      ts.isStringLiteral(attr.initializer) &&
      attr.initializer.text === "checkbox"
  );
}

/** The element a child stands for — itself, or the element at the end of `{cond && <…/>}`. */
function childElement(child: ts.JsxChild): ts.Node | undefined {
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) return child;
  if (ts.isJsxExpression(child) && child.expression) {
    let expr: ts.Expression = child.expression;
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      expr = expr.right;
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
    }
    if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) return expr;
  }
  return undefined;
}

function findings(file: string): Finding[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const siblings = node.children.map(childElement).filter((c): c is ts.Node => c !== undefined);
      if (siblings.some((c) => tagName(c) === "CaretCell")) {
        for (const sibling of siblings.filter(isCheckbox)) {
          out.push({
            file: path.relative(ROOT, file),
            line: source.getLineAndCharacterOfPosition(sibling.getStart(source)).line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe("a checkbox beside a caret cell", () => {
  it("is drawn in a CheckCell, so the caret's cell does not cover it", () => {
    const found = tsxFiles(SRC).flatMap(findings);
    assert.deepEqual(
      found.map((f) => `${f.file}:${f.line}`),
      [],
      "a bare checkbox shares its row with a CaretCell — wrap it in CheckCell (#2314)"
    );
  });
});
