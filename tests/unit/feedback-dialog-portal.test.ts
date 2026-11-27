import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **The Report a problem dialog is drawn above everything, wherever it is opened from** (#2725).
// The sidebar that opens it inside a collection is `position: sticky` — its own stacking context —
// so drawn in place, `DialogShell`'s z-index ranked it only within the sidebar and the stamp cards
// of the main column painted over its fields. The dialog is therefore portalled to `<body>`: the
// component's one `return` is `createPortal(<DialogShell …>, document.body)`.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, "../../src/app/feedback/feedback-dialog.tsx");

function feedbackDialogReturns(): ts.Expression[] {
  const source = ts.createSourceFile(FILE, readFileSync(FILE, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const fn = source.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "FeedbackDialog"
  );
  assert.ok(fn?.body, "FeedbackDialog is a function declaration in feedback-dialog.tsx");
  const returns: ts.Expression[] = [];
  for (const statement of fn.body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) returns.push(statement.expression);
  }
  return returns;
}

function unwrap(expr: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expr) ? unwrap(expr.expression) : expr;
}

describe("FeedbackDialog", () => {
  it("is portalled to the body, so no ancestor's stacking context can rank it under the page", () => {
    const returns = feedbackDialogReturns();
    assert.equal(returns.length, 1, "one top-level return");
    const call = unwrap(returns[0]);
    assert.ok(ts.isCallExpression(call) && call.expression.getText() === "createPortal", "returns createPortal(…)");
    const [content, target] = call.arguments;
    const element = unwrap(content);
    assert.ok(ts.isJsxElement(element) && element.openingElement.tagName.getText() === "DialogShell", "the portal draws the DialogShell");
    assert.equal(target.getText(), "document.body");
  });
});
