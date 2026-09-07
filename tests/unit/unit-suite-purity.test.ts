import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **`pnpm test:unit` is pure logic only, no Prisma imports** (AGENTS.md, *Testing Direction*).
//
// The rule had quietly stopped being true: three files reached the generated client, one directly
// and two through a barrel that also exports Prisma-backed code, and on a tree where the client has
// not been generated they hard-failed with `Cannot find module`. That reads as a broken checkout
// rather than as a broken test, and twice it sent a session looking at the postinstall (#861, #791).
//
// So the rule is checked rather than asserted. This walks the runtime import graph of every file in
// `tests/unit/` and fails if any path reaches the generated client or `@prisma/client`. It is a
// static walk on purpose: importing the modules to find out would run them, and the failure this
// guards against is a *load-time* one.
//
// It reads only static `import`/`export … from` forms. A `import type` — or a braces clause whose
// every binding is `type`-prefixed — is erased before it runs and is not an edge; `valuation.ts` and
// two of its tests hold a `Decimal` type that way on purpose. A dynamic `import()` is not an edge
// either, because it does not load until it is called.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const TESTS = path.join(ROOT, "tests/unit");
const SRC = path.join(ROOT, "src");
const GENERATED = path.join(SRC, "generated") + path.sep;

/** Bare specifiers that pull the query engine in. `@prisma/client/runtime/client` is on the list:
 *  as a value import it loads the runtime, and it is only safe in the type position. */
const PRISMA_PACKAGE = /^(@prisma\/client|\.prisma\/client)(\/|$)/;

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx"];

/** Where a specifier points, before asking whether anything is there. `null` for a bare package. */
function basePath(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return path.join(SRC, spec.slice(2));
  if (spec.startsWith(".")) return path.resolve(path.dirname(fromFile), spec);
  return null;
}

/** The file at `base`, or `undefined` when no candidate extension exists. */
function resolve(base: string): string | undefined {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/**
 * The specifiers a file loads when it runs, read off the real parse tree rather than by regex —
 * a comment or a template literal mentioning `import … from` is not an edge, and a hand-written
 * pattern gets that wrong long before it gets the type-only cases right.
 */
function edges(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const found: string[] = [];
  for (const statement of source.statements) {
    let clause: ts.ImportClause | ts.NamedExportBindings | undefined;
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(statement)) {
      clause = statement.importClause;
      specifier = statement.moduleSpecifier;
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      clause = statement.exportClause;
      specifier = statement.moduleSpecifier;
    } else continue;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;

    // `import type … from` / `export type … from`, and a braces clause whose every binding is
    // `type`-prefixed, are gone before the module runs: `catalog-price.ts` holds Prisma's `Decimal`
    // that way on purpose, and so do two of the valuation tests.
    if (clause) {
      if (ts.isImportClause(clause) && clause.isTypeOnly) continue;
      const bindings = ts.isImportClause(clause) ? clause.namedBindings : clause;
      const named =
        bindings && ts.isNamedImports(bindings)
          ? bindings.elements
          : bindings && ts.isNamedExports(bindings)
            ? bindings.elements
            : undefined;
      const hasValueBinding = ts.isImportClause(clause) && clause.name !== undefined;
      if (named && named.length > 0 && !hasValueBinding && named.every((e) => e.isTypeOnly)) continue;
    }
    found.push(specifier.text);
  }
  return found;
}

const rel = (file: string) => path.relative(ROOT, file);

describe("the unit suite's import graph", () => {
  it("reaches no Prisma client, directly or through any module it imports", () => {
    const testFiles = readdirSync(TESTS, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => path.join(TESTS, name));
    assert.ok(testFiles.length > 100, "expected to find the unit suite, found almost nothing");

    // `via` is the chain that got here, so a failure names the barrel rather than only the leaf.
    const seen = new Set<string>();
    const queue: { file: string; via: string[] }[] = testFiles.map((file) => ({
      file,
      via: [rel(file)],
    }));
    const prismaPaths: string[] = [];
    const unresolved: string[] = [];

    while (queue.length > 0) {
      const { file, via } = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);

      for (const spec of edges(file)) {
        if (PRISMA_PACKAGE.test(spec)) {
          prismaPaths.push([...via, spec].join("\n    → "));
          continue;
        }
        const base = basePath(file, spec);
        if (base === null) continue;
        // Judged on where the specifier points, not on what is on disk: the whole failure this
        // guards against happens on a tree where the generated client is *not* there to resolve to.
        if (base.startsWith(GENERATED)) {
          prismaPaths.push([...via, path.relative(ROOT, base)].join("\n    → "));
          continue;
        }
        const target = resolve(base);
        if (target === undefined) {
          unresolved.push(`${rel(file)} imports ${spec}`);
          continue;
        }
        if (!seen.has(target)) queue.push({ file: target, via: [...via, rel(target)] });
      }
    }

    // An edge this cannot follow is a hole in the walk, not a pass: report it as a failure so the
    // resolver gets extended rather than silently seeing less of the graph than the runtime does.
    assert.deepEqual(
      unresolved,
      [],
      `the import walk could not resolve these specifiers, so it saw less than the runtime does:\n  ${unresolved.join(
        "\n  "
      )}`
    );

    assert.deepEqual(
      prismaPaths,
      [],
      `the unit suite reaches Prisma. AGENTS.md says it is pure logic only — move the pure part ` +
        `into a module of its own, or stand a plain value in for the Decimal:\n  ${prismaPaths.join(
          "\n  "
        )}`
    );
  });
});
