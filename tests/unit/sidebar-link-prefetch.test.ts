import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **The sidebar never prefetches a section because it is on screen** (#2425).
//
// A `<Link>` left on its default prefetch is watched for the viewport, and Next schedules every
// visible one again whenever the router's tree changes or its cache is invalidated. The sidebar is
// on every screen with ~25 rows in view, so each `router.refresh()` after an edit sent ~25 requests
// for screens the collector was not opening — three waves for one price saved on an offer. Its
// rows warm a screen up on hover and focus instead (`NavItem`), and this checks that no row has
// slipped back to the default.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIDEBAR = path.resolve(HERE, "../../src/app/c/[collectionSlug]/collection-sidebar.tsx");

function linkElements(source: ts.SourceFile): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
  const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "Link"
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function prefetchesOnlyOnIntent(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile
): boolean {
  return element.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(source) === "prefetch" &&
      attribute.initializer !== undefined &&
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword
  );
}

describe("sidebar links (#2425)", () => {
  const source = ts.createSourceFile(
    SIDEBAR,
    readFileSync(SIDEBAR, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const links = linkElements(source);

  it("finds the sidebar's links", () => {
    assert.ok(links.length > 0, "collection-sidebar.tsx draws no <Link> — has the row moved?");
  });

  it("turns the viewport prefetch off on every one", () => {
    const offending = links
      .filter((element) => !prefetchesOnlyOnIntent(element, source))
      .map((element) => source.getLineAndCharacterOfPosition(element.getStart(source)).line + 1);
    assert.deepEqual(offending, [], `<Link> without prefetch={false} at line(s) ${offending.join(", ")}`);
  });

  it("warms the screen up on hover and on focus instead", () => {
    const text = source.getFullText();
    assert.match(text, /router\.prefetch\(href\)/);
    for (const element of links) {
      const names = element.attributes.properties
        .filter(ts.isJsxAttribute)
        .map((attribute) => attribute.name.getText(source));
      assert.ok(names.includes("onMouseEnter") && names.includes("onFocus"));
    }
  });
});
