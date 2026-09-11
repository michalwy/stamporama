import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// **The agent writes inside Stamporama and nowhere else** (#711, #712; `agent-api.md`, *What is
// deliberately absent*). It never publishes to a marketplace, never moves a listing's lifecycle,
// never claims a live listing has been brought back into step with this record — and since #712 it
// never reaches a **counterparty** either: no trade proposal, no share token, no partner feedback,
// no closing, nothing to Colnect.
//
// That boundary is enforced by **absence** — there is no such operation in the registry — and an
// absence is exactly the kind of thing that stops being true without anything going red. #711's
// *Done when* says *no publish-shaped operation exists in the registry* and #712's says the same of
// a send-shaped one, and a sentence is not a check.
//
// **Two tests answer each of them and they fail on different things, which is why there are two.**
// `tests/integration/agent-api-offers.test.ts` and `tests/integration/agent-api-trades.test.ts`
// enumerate `OPERATIONS` and fail on a publish-shaped or send-shaped **name** — the mistake
// somebody makes deliberately. This one fails on an operation module **reaching a domain function
// that does the act**, whatever the operation is called, which is the mistake somebody makes
// without noticing. A name guard alone would pass an operation called `finalize_listing` or
// `tidy_up_trade`; this one would not.
//
// **The two boundaries are not the same shape, and reading this file as one list of one thing is
// the mistake to avoid** (#712). Publishing is an **outbound act** with a handful of entry points
// all doing one kind of thing, which is what made #711's list tight. Nothing in this app posts
// anything to a trading partner at all — the partner opens a link — so *sending* has no single
// chokepoint, and the trade half of the map below is **six kinds of act** rather than one: minting
// or altering or revoking the share link, writing as the partner, moving the lifecycle, recording
// what actually arrived, closing into a purchase, and claiming a Colnect list is in step. Each is
// labelled with which it is, because a seventh kind is what a later reader will have to recognise
// and there is no pattern here to recognise it by.
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
  // ── Publishing to a marketplace (#711) — one kind of act, several doors ──
  ["publishOffer", "posts a listing to its marketplace and moves it to `active`"],
  ["recordOfferListed", "records a listing as posted, activating the offer (#412)"],
  ["setOfferState", "moves a listing's lifecycle, `active` included"],
  ["markOfferListingSynced", "claims the live listing matches this record, clearing the drift flag (#542)"],
  ["publishOfferToAllegro", "creates the listing on Allegro through its API (#477)"],
  ["activateAllegroDraft", "takes an Allegro draft live (#477)"],
  ["buildDelcampeUploadBundle", "writes the CSV Delcampe's uploader creates listings from (#610)"],

  // ── Reaching a counterparty (#712) — six different kinds of act ──
  // 1. The share link **is** how a trade reaches a partner (#640). There is no *send*: minting the
  //    link is the act, altering what it discloses is a second one, and revoking it breaks an
  //    address somebody is halfway through reading.
  ["createTradeShareToken", "mints the link a trading partner reads the list at (#640)"],
  ["setTradeShareOptions", "changes what the partner's link discloses, the figures included (#640)"],
  ["revokeTradeShareToken", "breaks the link a partner is holding (#640)"],
  // 2. Writing **as** the partner. These are the endpoints behind the page with no session on it;
  //    an agent calling them would be putting words in a real person's mouth.
  ["savePartnerTradeFeedback", "writes what the partner said about a line, as the partner (#641)"],
  ["saveTradeCopyProposal", "writes the partner's request for a particular copy, as the partner (#658)"],
  // 3. Answering the partner. #712 puts trade feedback out of scope in both directions: accepting a
  //    rejection deletes a line off a list somebody agreed to, and dismissing one closes a question
  //    the partner asked and is waiting on.
  ["resolveTradeFeedback", "settles what the partner asked for, which can delete a line (#641)"],
  ["dismissTradeCopyProposal", "closes the partner's copy request without answering it (#658)"],
  // 4. Moving the lifecycle. `shared` is the partner being handed the list, `agreed` is the
  //    handshake that freezes it, `closed` and `cancelled` end it — one function, all four.
  ["setTradeStatus", "moves a trade's lifecycle: `shared`, `agreed`, `closed` and `cancelled` (ADR-0039 §5)"],
  ["setTradeShipping", "records that a parcel was posted or arrived, which is after the handshake (ADR-0039 §4)"],
  // 5. Recording what actually moved, and closing. Both are past `agreed` by construction.
  ["setTradeLineFulfillment", "records what became of a line after the handshake (#642)"],
  ["createTradePurchase", "closes a trade into a purchase, carrying the cost basis over (#644)"],
  // 6. Claiming Colnect is in step. **The `markOfferListingSynced` analogue exactly**: it writes
  //    nothing to Colnect and it clears the one flag telling the collector that the public record
  //    and this one disagree.
  ["markColnectApplied", "claims a difference has been carried out on Colnect, clearing the report (#689)"],
]);

// **The Colnect clause is guarded by the architecture rather than by this list, and that is worth
// stating because it is the one entry nobody can add correctly by reading `src/` alone.**
//
// **This app does write to Colnect.** `extension/src/platform/colnect/list-write.ts` builds
// `POST /item/col` with `act=check` — list membership, and since #704 an entry's quantity and grades
// (#689, ADR-0042). It runs in the **content script**, on a colnect.com page, under the collector's
// own session cookie, same-origin because the call carries no CSRF token. No `/api/v1` handler can
// reach it: it is a different package, shipped to the collector's browser rather than run on the
// server, so there is no import for this list to forbid and nothing for it to catch.
//
// `markColnectApplied` above is the one thing on **this** side that touches the Colnect story at
// all, and it writes nothing outbound: it clears the flag saying the public record and this one
// disagree, which is why it is forbidden for `markOfferListingSynced`'s reason and not for being a
// Colnect write.
//
// **An earlier draft of this comment said the clause was *vacuous today* because *nothing in this
// tree writes to Colnect over the wire*.** It is quoted because it was asserted in a report before
// it was checked, and because the mistake is the reusable part: the grep behind it was
// `grep -rln 'colnect.com' src/`, which is one package of a two-package repository, and the
// conclusion was stated about *the tree*. `git grep -lF 'colnect.com'` answers **59 files**, 17 of
// them under `extension/`.

// **`deleteTrade` was weighed and left off, on `getOfferListingKit`'s reasoning.** It destroys a
// trade, which is worse than most things here — and it is not a *send*, and no operation calls it.
// Putting it on this list would make the list mean *anything dangerous* rather than *the acts that
// reach somebody else*, and a list that means two things is one a later reader cannot add to
// correctly. That there is no `delete_trade` operation is a fact about the registry, which is what
// the name guards beside this one are for.

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

describe("the agent API's operation modules (#711, #712)", () => {
  it("reach no domain function that publishes a listing, moves a state, or reaches a counterparty", () => {
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
      `The agent API never publishes to a marketplace, never moves a listing's or a trade's lifecycle, and never reaches a counterparty (#711, #712).\n  ${breaches.join("\n  ")}`
    );
  });

  it("would notice one, which is the half a green control cannot show on its own", () => {
    // The control's own control. A guard that has never been seen to fail is indistinguishable from
    // one that cannot fail (#814), and here the thing most likely to break it is silent: the parse
    // walk returning nothing at all — a renamed directory, a changed file extension — would leave
    // every assertion above green over an empty set.
    //
    // **Two fixtures since #712, because the two halves of the map are proved by different files**:
    // a green offers module says nothing about whether the walk can see the trade modules at all.
    for (const [relative, allowed] of [
      // `patchOffer` is a write this surface *is* allowed to make, so it is exactly the binding that
      // proves the instrument sees writing imports and is not simply blind to all of them.
      ["operations/offers.ts", "patchOffer"],
      // The same, one boundary over: `addTradeGiveLines` writes lines onto a trade, which is #712's
      // whole point, while `setTradeStatus` four lines away in the same module's domain is not.
      ["operations/trades.ts", "addTradeGiveLines"],
    ] as const) {
      const fixture = path.join(AGENT_API, relative);
      const names = importedBindings(fixture).map((binding) => binding.name);
      assert.ok(
        names.length > 10,
        `the walk read almost nothing out of ${path.relative(ROOT, fixture)}`
      );
      assert.ok(
        names.includes(allowed),
        `the walk did not see the writes that are allowed in ${relative}`
      );
      assert.ok(
        !names.some((name) => FORBIDDEN.has(name)),
        `${relative} was expected to be clean`
      );
    }
  });
});
