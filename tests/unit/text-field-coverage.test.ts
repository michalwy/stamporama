import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **Every field the collector types text into is `TextInput` or `TextArea`** (#1357).
//
// The whitespace rule is written once, in `shared/text-input.tsx` and `src/lib/text-input.ts`, and
// the issue's whole point is that it is not then re-applied field by field — "one behaviour for
// every text field, so no field is left out". A rule that depends on remembering it is a rule that
// the ninety-sixth field quietly skips, so it is checked rather than asserted, the way
// `unit-suite-purity.test.ts` checks the unit suite's imports.
//
// A raw `<input>` is fine for everything that is not typed prose — a checkbox, a radio, a date, a
// file, a colour, a hidden value, a number. It is the texty types, and the ones that state no type
// at all and therefore *are* text, that have to go through the shared field.
//
// Two files are allowed to hold one anyway, and both are named here rather than pattern-matched:
//
// - `shared/text-input.tsx` is the field itself.
// - `shared/numeric-input.tsx` is the **amount** field (#1231). It is a `type="text"` input on
//   purpose — a native `type="number"` drops a comma in a period-locale browser (#233) — and it
//   settles its own value on blur through `formatAmountInput`. An amount is not prose.
//
// `type="password"` is not on the list of texty types and so never reaches this rule: a space in a
// credential is a character the collector chose, and dropping it would lock them out of their own
// account. That is the one field #1357 asks to have named, and this is where it is named.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(ROOT, "src");

/** The `type` values that hold text a collector types. An absent `type` is one of these: an
 *  `<input>` with no type is a text field. */
const TEXTY_TYPES = new Set(["text", "search", "url", "email", "tel"]);

const ALLOWED = new Set([
  "src/app/c/[collectionSlug]/shared/text-input.tsx",
  "src/app/c/[collectionSlug]/shared/numeric-input.tsx",
]);

interface Finding {
  file: string;
  line: number;
  detail: string;
}

/** The `type=` attribute as written: its string value, `"«expression»"` when it is computed, or
 *  `undefined` when the element states none. */
function typeAttribute(
  attributes: ts.JsxAttributes
): { kind: "string"; value: string } | { kind: "expression" } | undefined {
  for (const attr of attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "type") continue;
    const init = attr.initializer;
    if (init && ts.isStringLiteral(init)) return { kind: "string", value: init.text };
    if (
      init &&
      ts.isJsxExpression(init) &&
      init.expression &&
      ts.isStringLiteral(init.expression)
    ) {
      return { kind: "string", value: init.expression.text };
    }
    return { kind: "expression" };
  }
  return undefined;
}

function scan(file: string, relative: string, findings: Finding[]): void {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );

  const report = (node: ts.Node, detail: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ file: relative, line: line + 1, detail });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(source);
      if (tag === "textarea") {
        report(node, "<textarea> — use <TextArea>");
      } else if (tag === "input") {
        const attr = typeAttribute(node.attributes);
        if (attr === undefined) {
          report(node, '<input> with no type — it is a text field; use <TextInput>');
        } else if (attr.kind === "expression") {
          report(
            node,
            "<input> with a computed type — branch on it, so the text case can be a <TextInput>"
          );
        } else if (TEXTY_TYPES.has(attr.value)) {
          report(node, `<input type="${attr.value}"> — use <TextInput>`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

describe("the text fields", () => {
  it("are all the shared TextInput / TextArea, so the whitespace rule cannot miss one", () => {
    const files = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => path.join(SRC, name))
      .filter((file) => !path.relative(ROOT, file).startsWith(path.join("src", "generated")));
    assert.ok(files.length > 100, "expected to find the app's components, found almost nothing");

    const findings: Finding[] = [];
    for (const file of files) {
      const relative = path.relative(ROOT, file);
      if (ALLOWED.has(relative)) continue;
      scan(file, relative, findings);
    }

    assert.deepEqual(
      findings.map((f) => `${f.file}:${f.line} ${f.detail}`),
      [],
      "a field the collector types text into is not the shared one, so it keeps the whitespace " +
        "around what is typed (#1357). Import { TextInput, TextArea } from the shared " +
        "`text-input` module:\n  " +
        findings.map((f) => `${f.file}:${f.line} ${f.detail}`).join("\n  ")
    );
  });
});
