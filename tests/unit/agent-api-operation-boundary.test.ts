import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **The agent writes inside Stamporama and nowhere else** (#711, `agent-api.md`, *What is
// deliberately absent*). It never publishes to a marketplace, never moves a listing's lifecycle,
// and never claims a live listing has been brought back into step with this record.
//
// That boundary is enforced by **absence** — there is no such operation in the registry — and an
// absence is exactly the kind of thing that stops being true without anything going red. #711's
// *Done when* says *no publish-shaped operation exists in the registry*, and a sentence is not a
// check.
//
// **Two tests answer it and they fail on different things, which is why there are two.**
// `tests/integration/agent-api-offers.test.ts` enumerates `OPERATIONS` and fails on a publish-shaped
// **name** — the mistake somebody makes deliberately. This one fails on an operation module
// **reaching a domain function that publishes**, whatever the operation is called, which is the
// mistake somebody makes without noticing. A name guard alone would pass an operation called
// `finalize_listing`; this one would not.
//
// **It is a unit test even though it is about the registry**, because it *reads* the modules off
// disk rather than importing them: `tests/unit/` may not import `registry.ts`, which carries
// handlers and so reaches Prisma (`agent-api.md`). Reading is not importing, and the walk is the
// one `unit-suite-purity.test.ts` already does for the other direction of the same cut.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const AGENT_API = path.join(ROOT, "src/lib/agent-api");

/**
 * The domain functions that take a listing public or move its lifecycle, and what each one is.
 *
 * **It is a list of *acts*, not of modules**, which is what makes it survive a refactor: a function
 * that moves house keeps its name, and a new way of publishing gets a new name that whoever adds it
 * will have to add here — with the issue body in front of them, which is the moment the question is
 * worth asking.
 *
 * `markOfferListingSynced` is on it and looks out of place. It writes nothing to a marketplace; it
 * *asserts* that the live listing already matches this record (#542), which clears the one flag
 * telling the collector a public listing is wrong. An agent that could clear it could hide exactly
 * the thing this surface is not allowed to touch.
 */
const FORBIDDEN = new Map<string, string>([
  ["publishOffer", "posts a listing to its marketplace and moves it to `active`"],
  ["recordOfferListed", "records a listing as posted, activating the offer (#412)"],
  ["setOfferState", "moves a listing's lifecycle, `active` included"],
  ["markOfferListingSynced", "claims the live listing matches this record, clearing the drift flag (#542)"],
  ["publishOfferToAllegro", "creates the listing on Allegro through its API (#477)"],
  ["activateAllegroDraft", "takes an Allegro draft live (#477)"],
  ["buildDelcampeUploadBundle", "writes the CSV Delcampe's uploader creates listings from (#610)"],
]);

// **`getOfferListingKit` was weighed and left off, and the reasoning matters more than the verdict.**
// The listing kit (#405) is the payload a marketplace form is filled from, so it *looks* like the
// sharpest thing to ban. It publishes nothing and moves nothing: it is a read, it already answers to
// this same Assistant token on its own endpoint, and its refusals are about whether the goods are
// described truthfully. Banning it here would make this list mean *anything near a marketplace*
// rather than *the acts that go public*, and a list that means two things is one a later reader
// cannot add to correctly. The kit is out of #711's scope because #711 did not ask for it, which is
// a fact about the registry and is what the name guard beside this one is for.

/** Every module the registry reaches for a handler — the server side of the layer. */
function operationModules(): string[] {
  const dir = path.join(AGENT_API, "operations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(dir, name))
    .concat(path.join(AGENT_API, "registry.ts"));
}

/**
 * The value bindings a file imports, read off the real parse tree.
 *
 * A regex over the source would count a **comment** naming `publishOffer` as a hit, and every one
 * of these modules explains at length why it does not publish — so the first thing a hand-written
 * pattern would flag is the documentation of the rule it is checking. That is not a hypothetical:
 * `operations/offers.ts` names five of these seven in its own header.
 */
function importedBindings(file: string): { name: string; from: string }[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ false,
    ts.ScriptKind.TS
  );
  const found: { name: string; from: string }[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    // `import type` is erased before the module runs and can call nothing.
    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const from = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      // The *imported* name, not the local alias: renaming on the way in must not get past this.
      found.push({ name: (element.propertyName ?? element.name).text, from });
    }
  }
  return found;
}

describe("the agent API's operation modules (#711)", () => {
  it("reach no domain function that publishes a listing or moves its lifecycle", () => {
    const modules = operationModules();
    assert.ok(
      modules.length >= 6,
      `expected to find the operation modules, found ${modules.length}`
    );

    const breaches: string[] = [];
    for (const file of modules) {
      for (const { name, from } of importedBindings(file)) {
        const why = FORBIDDEN.get(name);
        if (why) {
          breaches.push(
            `${path.relative(ROOT, file)} imports \`${name}\` from "${from}" — it ${why}`
          );
        }
      }
    }
    assert.deepEqual(
      breaches,
      [],
      `The agent API never publishes to a marketplace and never moves a listing's lifecycle (#711).\n  ${breaches.join("\n  ")}`
    );
  });

  it("would notice one, which is the half a green control cannot show on its own", () => {
    // The control's own control. A guard that has never been seen to fail is indistinguishable from
    // one that cannot fail (#814), and here the thing most likely to break it is silent: the parse
    // walk returning nothing at all — a renamed directory, a changed file extension — would leave
    // every assertion above green over an empty set.
    const fixture = path.join(AGENT_API, "operations/offers.ts");
    const names = importedBindings(fixture).map((binding) => binding.name);
    assert.ok(names.length > 10, `the walk read almost nothing out of ${path.relative(ROOT, fixture)}`);
    // `patchOffer` is a write this surface *is* allowed to make, so it is exactly the binding that
    // proves the instrument sees writing imports and is not simply blind to all of them.
    assert.ok(names.includes("patchOffer"), "the walk did not see the writes that are allowed");
    assert.ok(
      !names.some((name) => FORBIDDEN.has(name)),
      "the fixture module was expected to be clean"
    );
  });
});
