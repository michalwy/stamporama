import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **A screen that opens a catalogue-write dialog invalidates the stamps and issues caches** (#918).
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
// **Which dialogs, and why that list is derivable rather than arbitrary.** A dialog is on it when its
// *opener* supplies the submit handler and reads the action's result — so the file that opens it owns
// the write cycle, and is the only file that can invalidate on success. That is true of all four
// catalogue-write dialogs: the two that write a stamp (`StampFormDialog`, `DeleteStampDialog`), the
// two that write an issue (`IssueDialog`, `DeleteIssueDialog`), and the range dialog that writes
// both (`AddVariantRangeDialog`). Their own definition files are not call sites and do not match:
// this reads import declarations, and a module does not import what it exports.
//
// **Keying on the write *actions* instead was measured and rejected**, not merely considered. Twenty
// files call a stamp or issue write action and ten of them never invalidate — but most of those ten
// are correct: `recompute-range-dialog`, `stamp-tree-reorder` and `use-quick-price-dialog` perform
// the write and hand success up through `onApplied` / `onSaved`, and the *parent* invalidates. The
// write and the invalidation legitimately live in different files, so an action-keyed rule reports
// structural false positives across auctions, trades and offers. The dialog rule holds precisely
// because opening one of these means owning the whole cycle.
//
// Parsed with the TypeScript parser rather than by regex, the way `unit-suite-purity.test.ts` is:
// this file's own comments mention `StampFormDialog` and `invalidateStampsAndIssues`, and so do the
// doc comments of the hook and of `use-stamps-query.ts`. A text search matches those and reports a
// green run for a tree where nothing is wired up.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(ROOT, "src");

/** The catalogue-write dialogs, by the criterion above: the opener passes the submit handler and
 *  reads the result, so the opener is where the invalidation can go. */
const DIALOGS = [
  "StampFormDialog",
  "DeleteStampDialog",
  "IssueDialog",
  "DeleteIssueDialog",
  "AddVariantRangeDialog",
];
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

/** The catalogue-write dialogs this file imports as values. A type-only import cannot open one, and
 *  a dialog's own module does not import what it exports, so definitions fall out for free. */
function dialogsImported(source: ts.SourceFile): string[] {
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      // `import { X as Y }` — the imported name is what identifies the dialog.
      const imported = (element.propertyName ?? element.name).text;
      if (DIALOGS.includes(imported) && !found.includes(imported)) found.push(imported);
    }
  }
  return found;
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

describe("every screen that opens a catalogue-write dialog", () => {
  it(`calls ${INVALIDATE} after writing`, () => {
    const callSites: string[] = [];
    const missing: string[] = [];
    // Per dialog, so a rename of any one of them cannot go unnoticed behind the others' call sites.
    const seenPerDialog = new Map(DIALOGS.map((d) => [d, 0]));

    for (const file of sourceFiles()) {
      const source = parse(file);
      const opened = dialogsImported(source);
      if (opened.length === 0) continue;
      for (const dialog of opened) seenPerDialog.set(dialog, seenPerDialog.get(dialog)! + 1);
      const relative = path.relative(ROOT, file);
      callSites.push(relative);
      if (!callsInvalidate(source)) missing.push(`${relative}  (opens ${opened.join(", ")})`);
    }

    // Asserted so the check cannot pass by finding nothing. A renamed or re-exported dialog would
    // otherwise turn this green by scanning zero files for it, which is the way a control of this
    // shape fails silently — and the whole point of it is that nobody is watching.
    const unseen = [...seenPerDialog].filter(([, n]) => n === 0).map(([d]) => d);
    assert.deepEqual(
      unseen,
      [],
      `no call site found for: ${unseen.join(", ")}. Either the dialog was renamed and DIALOGS is ` +
        `stale, or it is imported in a way this does not read — in both cases the rule stopped ` +
        `covering it silently.`
    );

    assert.deepEqual(
      missing,
      [],
      `these open a catalogue-write dialog and never call ${INVALIDATE}, so the Stamps list and ` +
        `the Issues tree keep reading the way they read before the write (#918):\n  ` +
        `${missing.join("\n  ")}\n\n` +
        `Use useInvalidateStampsAndIssues() from ` +
        `src/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues.ts and call it on the ` +
        `action's success branch.`
    );
  });
});
