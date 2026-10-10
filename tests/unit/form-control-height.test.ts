import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **A single-line form control is exactly the shared height** (#1751).
//
// #1686 gave every form control one height through `formControl` in `src/app/control-style.ts`, and
// the issue was closed with the heights worked out from the styles rather than seen: a select still
// stood shorter than the text field beside it. The height is now exact, and what keeps it exact is
// this check rather than a reviewer's eye, the way `text-field-coverage.test.ts` keeps the text
// fields shared.
//
// It follows every style spread from `formControl` — through a form's own `INPUT_STYLE`, a style
// imported from another module, a style spread from that — and fails when one of them:
//
// - **sets a height of its own** after the shared one: `height`, `minHeight`, `maxHeight`, the block
//   sizes or `boxSizing`, whether as its own key or through a later spread of a style that carries
//   one. A compact control that wants to be smaller does not spread the form style and shrink it
//   back; it keeps a style of its own, as #1686 decided for toolbars, grid cells and row editors;
// - **is drawn on a `TextArea` without `multiLineFormControl`**, or **can wrap** (`flexWrap`,
//   `wordBreak`, `overflowWrap` — a chip field, a link shown in full) without it, either of which
//   would clamp a growing field to one line; or the other way round, a single-line control given the
//   multi-line one;
// - is multi-line and sets a `height`, or a `minHeight` below the shared one: a multi-line field
//   starts level with its neighbours and grows, never shorter.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(ROOT, "src");
const CONTROL_STYLE = path.join(SRC, "app", "control-style.ts");

/** The shared height, in rem, read from the module rather than restated. */
const CONTROL_HEIGHT_REM = Number(
  /CONTROL_HEIGHT = "([\d.]+)rem"/.exec(readFileSync(CONTROL_STYLE, "utf8"))?.[1]
);

const HEIGHT_KEYS = new Set([
  "height",
  "minHeight",
  "maxHeight",
  "blockSize",
  "minBlockSize",
  "maxBlockSize",
  "boxSizing",
]);

/** A box that can wrap — a chip field, a link shown in full — grows, so it is not single-line. */
const WRAPPING = new Set(["flexWrap", "wordBreak", "overflowWrap"]);

const MULTI_LINE_TAGS = new Set(["TextArea", "textarea"]);
const SINGLE_LINE_TAGS = new Set(["input", "select", "TextInput", "NumericInput"]);

type Kind = "single" | "multi";

interface Module {
  source: ts.SourceFile;
  imports: Map<string, { file: string; name: string }>;
  /** Every `const X = { … }` in the module, by name — at any depth, as forms declare them. */
  objects: Map<string, ts.ObjectLiteralExpression[]>;
}

function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function resolveImport(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return undefined;
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const candidate = base + suffix;
    if (candidate.endsWith(".ts") || candidate.endsWith(".tsx")) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const modules = new Map<string, Module>();

function load(file: string): Module {
  const cached = modules.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const parsed: Module = { source, imports: new Map(), objects: new Map() };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      const target = resolveImport(file, node.moduleSpecifier.text);
      if (target) {
        for (const element of node.importClause.namedBindings.elements) {
          parsed.imports.set(element.name.text, {
            file: target,
            name: (element.propertyName ?? element.name).text,
          });
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        const list = parsed.objects.get(node.name.text) ?? [];
        list.push(init);
        parsed.objects.set(node.name.text, list);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  modules.set(file, parsed);
  return parsed;
}

const kinds = new Map<string, Kind | null>();

/** Whether the style a name refers to in a module is spread from the shared one, and which. */
function kindOfName(file: string, name: string): Kind | null {
  if (file === CONTROL_STYLE && name === "formControl") return "single";
  if (file === CONTROL_STYLE && name === "multiLineFormControl") return "multi";
  const key = `${file}#${name}`;
  if (kinds.has(key)) return kinds.get(key) ?? null;
  kinds.set(key, null); // a cycle resolves to "not derived"
  const parsed = load(file);
  let kind: Kind | null = null;
  const objects = parsed.objects.get(name);
  if (objects) {
    for (const object of objects) kind = kindOfObject(file, object) ?? kind;
  } else {
    const imported = parsed.imports.get(name);
    if (imported) kind = kindOfName(imported.file, imported.name);
  }
  kinds.set(key, kind);
  return kind;
}

/** A spread's kind: the last spread from the shared style decides, as it does in the browser. */
function kindOfObject(file: string, object: ts.ObjectLiteralExpression): Kind | null {
  let kind: Kind | null = null;
  for (const property of object.properties) {
    if (!ts.isSpreadAssignment(property)) continue;
    const expression = unwrap(property.expression);
    if (ts.isIdentifier(expression)) kind = kindOfName(file, expression.text) ?? kind;
  }
  return kind;
}

function kindOfExpression(file: string, expression: ts.Expression): Kind | null {
  const node = unwrap(expression);
  if (ts.isIdentifier(node)) return kindOfName(file, node.text);
  if (ts.isObjectLiteralExpression(node)) return kindOfObject(file, node);
  return null;
}

/** The height keys an object literal states itself, with their initializers. */
function heightKeys(object: ts.ObjectLiteralExpression): [string, ts.Expression | undefined][] {
  const found: [string, ts.Expression | undefined][] = [];
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property) || !property.name) continue;
    const key = property.name.getText();
    if (!HEIGHT_KEYS.has(key)) continue;
    found.push([key, ts.isPropertyAssignment(property) ? property.initializer : undefined]);
  }
  return found;
}

/** The objects a non-shared spread brings in, so a height cannot be smuggled in through one. */
function spreadObjects(file: string, expression: ts.Expression): ts.ObjectLiteralExpression[] {
  const node = unwrap(expression);
  if (!ts.isIdentifier(node)) return [];
  const parsed = load(file);
  const local = parsed.objects.get(node.text);
  if (local) return local;
  const imported = parsed.imports.get(node.text);
  return imported ? spreadObjects(imported.file, ts.factory.createIdentifier(imported.name)) : [];
}

function remValue(expression: ts.Expression | undefined): number | undefined {
  if (!expression) return undefined;
  const node = unwrap(expression);
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return undefined;
  const match = /^([\d.]+)rem$/.exec(node.text);
  return match ? Number(match[1]) : undefined;
}

function scan(file: string, findings: string[]): void {
  const { source } = load(file);
  const relative = path.relative(ROOT, file);
  const report = (node: ts.Node, detail: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push(`${relative}:${line + 1} ${detail}`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const kind = kindOfObject(file, node);
      if (kind === "single") {
        for (const [key] of heightKeys(node)) {
          report(node, `sets its own ${key} over the shared form-control height`);
        }
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !WRAPPING.has(property.name.getText(source))) {
            continue;
          }
          const value = unwrap(property.initializer);
          if (ts.isStringLiteral(value) && value.text === "nowrap") continue;
          report(
            node,
            `${property.name.getText(source)} lets it wrap onto a second line inside one line's height — spread multiLineFormControl after the form style`
          );
        }
        for (const property of node.properties) {
          if (!ts.isSpreadAssignment(property)) continue;
          if (kindOfExpression(file, property.expression)) continue;
          for (const object of spreadObjects(file, property.expression)) {
            for (const [key] of heightKeys(object)) {
              report(
                node,
                `spreads ${property.expression.getText(source)}, whose ${key} overrides the shared form-control height`
              );
            }
          }
        }
      } else if (kind === "multi") {
        for (const [key, value] of heightKeys(node)) {
          if (key === "maxHeight") continue;
          if (key === "minHeight") {
            const rem = remValue(value);
            if (rem === undefined || rem >= CONTROL_HEIGHT_REM) continue;
          }
          report(node, `a multi-line field that sets ${key} — it starts at the shared height and grows`);
        }
      }
    }

    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(source);
      for (const attribute of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(attribute) ||
          attribute.name.getText(source) !== "style" ||
          !attribute.initializer ||
          !ts.isJsxExpression(attribute.initializer) ||
          !attribute.initializer.expression
        ) {
          continue;
        }
        const kind = kindOfExpression(file, attribute.initializer.expression);
        if (MULTI_LINE_TAGS.has(tag) && kind === "single") {
          report(node, `<${tag}> drawn at one line's height — spread multiLineFormControl after the form style`);
        }
        if (SINGLE_LINE_TAGS.has(tag) && kind === "multi") {
          report(node, `<${tag}> is single-line but given multiLineFormControl — it grows past its neighbours`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

describe("the form-control height", () => {
  it("is read from control-style.ts", () => {
    assert.ok(CONTROL_HEIGHT_REM > 0, "CONTROL_HEIGHT is no longer a rem literal");
  });

  it("is never overridden by a form's style, and a multi-line field is never clamped to one line", () => {
    const files = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
      .map((name) => path.join(SRC, name))
      .filter((file) => !path.relative(ROOT, file).startsWith(path.join("src", "generated")))
      .filter((file) => file !== CONTROL_STYLE);
    assert.ok(files.length > 100, "expected to find the app's components, found almost nothing");

    const findings: string[] = [];
    for (const file of files) scan(file, findings);

    assert.deepEqual(
      findings,
      [],
      "a single-line form control is exactly the shared height (#1751): a style spread from " +
        "`formControl` declares no height of its own, a compact control keeps a style that does " +
        "not spread it, and a field that grows spreads `multiLineFormControl` after it:\n  " +
        findings.join("\n  ")
    );
  });
});
