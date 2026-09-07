import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **A screen that opens `StampFormDialog` invalidates the stamps and issues caches** (#918).
//
// The rule is checked rather than asserted, for the reason #918 exists at all: nine call sites each
// individually remembering produced six that did not, and a collector's only evidence was a row that
// looked correct and was not. #861 is the precedent — a rule nothing enforces is the rule that
// produced the issue.
//
// **The dialog cannot own this.** `StampFormDialog.onSubmit` returns `void` and runs *before* the
// server action does, so the dialog knows only that Save was pressed; invalidating there would
// refetch after a failed save. The call belongs where the action's result is read, which is the call
// site — and that is what makes a check necessary rather than optional.
//
// **What this can and cannot see.** It is a static, per-file check: it finds the files that import
// `StampFormDialog` and asserts each also *calls* `invalidateStampsAndIssues`. It cannot see whether
// the call sits on the success branch, nor whether it is reached at all. It catches the file that
// never thought about the question, which is the failure that actually happened six times over; it
// would not catch a call wired to the wrong branch. Stated so nobody reads it as more than it is.
//
// It also covers only `StampFormDialog`. `DeleteStampDialog` writes stamps too, and today all three
// of its call sites are among these files — so they are covered incidentally, not by this rule. A
// future delete-only screen would not be.
//
// Parsed with the TypeScript parser rather than by regex, the way `unit-suite-purity.test.ts` is:
// this file's own comments mention `StampFormDialog` and `invalidateStampsAndIssues`, and so do the
// doc comments of the hook and of `use-stamps-query.ts`. A text search matches those and reports a
// green run for a tree where nothing is wired up.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(ROOT, "src");

const DIALOG = "StampFormDialog";
const INVALIDATE = "invalidateStampsAndIssues";

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** True when the file imports `StampFormDialog` as a value — the definition itself re-exports
 *  nothing and is excluded by path, and a type-only import cannot open a dialog. */
function importsDialog(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      if (element.name.text === DIALOG) return true;
    }
  }
  return false;
}

/** True when the file contains a call whose callee is the bare identifier
 *  `invalidateStampsAndIssues` — the name the shared hook destructures to. A call site that renames
 *  it fails here, which is the intended answer: the name is what makes the rule greppable. */
function callsInvalidate(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === INVALIDATE
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .map((name) => path.join(SRC, name))
    .filter((file) => !file.includes(`${path.sep}generated${path.sep}`));
}

describe("every screen that opens the stamp form", () => {
  it(`calls ${INVALIDATE} after writing`, () => {
    const callSites: string[] = [];
    const missing: string[] = [];

    for (const file of sourceFiles()) {
      const source = parse(file);
      if (!importsDialog(source)) continue;
      const relative = path.relative(ROOT, file);
      callSites.push(relative);
      if (!callsInvalidate(source)) missing.push(relative);
    }

    // The count is asserted so the check cannot pass by finding nothing: a rename of the dialog, or
    // a change to how it is imported, would otherwise turn this test green by scanning zero files.
    assert.ok(
      callSites.length >= 9,
      `expected to find the ${DIALOG} call sites, found ${callSites.length}:\n  ${callSites.join("\n  ")}`
    );

    assert.deepEqual(
      missing,
      [],
      `these open ${DIALOG} and never call ${INVALIDATE}, so the Stamps list and the Issues tree ` +
        `keep reading the way they read before the write (#918):\n  ${missing.join("\n  ")}\n\n` +
        `Use useInvalidateStampsAndIssues() from ` +
        `src/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues.ts and call it on the ` +
        `action's success branch.`
    );
  });
});
