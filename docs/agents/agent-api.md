# The Agent API

`/api/v1` and `/api/mcp`: the versioned, described surface an agentic AI client uses, the shared
operation registry behind it, and the conventions every operation obeys. Read this before adding an
operation, and read [ADR-0050](../decisions/0050-versioned-agent-api.md) for why the surface exists
at all and [ADR-0051](../decisions/0051-hand-rolled-mcp-transport.md) for why the MCP half is
hand-written rather than built on the reference SDK.

The track is #706 (the foundation), #707 (token scopes), #708 (vocabulary), #709 (the MCP wrapper),
#710/#711/#712 (the operations), and #1036/#1037 (two gaps filed against it later). **The whole
track has landed**, #1036 last, #1390 has since added purchases, #1415 stamp sizes, #1438 the
catalogue writes, #1445 a stamp's Colnect ID, #1452 translations, #1512 checklists, #1540 catalogue prices, #1539 areas, #1627 the auction register, #1628 auction outcomes and #1635 price observations; both wrappers exist and the registry carries **eighty-four operations** — #708's vocabulary read, #710's
six reads over the collection, #711's six offer verbs, #712's two want reads, checklist gap and nine
trade verbs, #1036's three auction reads, #1390's eleven purchase operations, #1415's seven size
operations, #1438's five catalogue writes, #1445's `set_stamp_colnect_id`, #1452's two translation operations, #1512's eight checklist operations, #1540's four catalogue-price operations, #1539's six area operations, #1627's five auction writes, #1628's `record_auction_lot_outcome`, #1635's four price-observation operations, #1168's bid recommendation, and #1037's catalog-number
resolver. Thirteen counts are quoted
rather than deleted, because each was true when it was written: *the registry carries twenty-five
operations* (from #712 until #1168), *the registry carries twenty-six operations* (from #1168 until
#1037), *the registry carries twenty-seven operations* (from #1037 until #1036), *the registry
carries thirty operations* (from #1036 until #1390), *the registry carries forty-one operations*
(from #1390 until #1415), *the registry carries forty-eight operations* (from #1415 until #1438),
*the registry carries fifty-three operations* (from #1438 until #1445), *the registry carries
fifty-four operations* (from #1445 until #1452), *the registry carries fifty-six operations* (from
#1452 until #1512), *the registry carries sixty-four operations* (from #1512 until #1540), *the registry carries sixty-eight operations* (from #1540 until #1539), *the registry carries seventy-four operations* (from #1539 until #1627), *the registry carries seventy-nine operations* (from #1627 until #1628) and *the registry carries eighty operations* (from #1628 until #1635).

**Fifty of them write** since #1635 added three; *forty-seven of them write* was the count from #1628 until
then, *forty-six of them write* from #1627 until #1628, *forty-one of them write* from #1539 until #1627, *thirty-six of them write* from #1540 until #1539, *thirty-four of them write* from
#1512 until #1540, *twenty-eight of them write* from #1452 until #1512, *twenty-seven of them write* from #1445 until #1452, *twenty-six of them write* from #1438 until #1445, *twenty-one of them write* from
#1415 until #1438, *seventeen of them write* from #1390 until #1415, and *eight of them write* from #712 until #1390, and neither #1168, #1037 nor #1036 moved it: `recommend_bid` and `resolve_catalog_numbers` both read and compute and store
nothing, and #1036's three reads store nothing either — for them that was a boundary the collector
set rather than a fact about what they happen to do, until #1627 opened the auction register to the
agent (*Following the auctions already tracked* and *Keeping the auction register*, below). Two earlier sentences are
quoted rather than deleted, because each was true when it was written and will go on arriving in
anything copied from it: *the registry carries seven operations … **Nothing in it writes**, which
several statements below still rest on* (#706 through #710), and *the registry carries thirteen
operations … **Three of them write*** (#711). Every statement that rested on either is corrected
below, each saying what it used to say.

**And the surface now answers four workflows rather than three** (#1168). The first three are the
ones #710, #711 and #712 name, and every one of them is about material the collection holds or is
looking for. The fourth is not: it is a **stateless query about a lot nothing here records**, asked
before any of the other three could have anything to say. *The three agent workflows* is quoted
rather than deleted wherever it appears below, for the same reason.

**#1037 added no fifth workflow, and that is worth saying rather than leaving to be counted.** It is
the step *in front of* all four: an agent that has been handed `Mi 123a` cannot ask any of them
anything until that string is a stamp id. `search_collection` is the same step asked with a phrase;
`resolve_catalog_numbers` is it asked with a number, over a batch, and answered with a verdict
instead of a result list. See *Resolving a number an agent was handed* below.

**#1036 added no fifth workflow either.** Its three reads are the part of the fourth that is about
the collection after all: before asking whether a new lot is worth bidding, the agent needs to know
whether the collector already follows it and how much is already riding on the lots they do follow.
See *Following the auctions already tracked* below.

## It is beside the screen API, never over it

The routes under `/api/collections/[collectionId]/…` are **screen endpoints**. They are shaped
for TanStack Query, for cursor pagination and for the needs of one particular table, and they are
free to change whenever the UI does. **Do not add an agent operation by widening one of them**, and
do not make an agent operation call one: an operation calls `src/lib/` directly, exactly as the
screen route beside it does.

`/api/v1` is a contract. Once an operation is published there, its name, its parameters and the
meaning of its answer only ever grow — a break is `/api/v2`.

## Adding an operation

One edit. Append an `Operation` to `OPERATIONS` in `src/lib/agent-api/registry.ts`; it appears in
`GET /api/v1/openapi.json` **and** in the MCP tool list at `POST /api/mcp`, with no second place to
change. That property is the whole point of the registry and it is the thing to preserve, and since
#709 it is the thing being preserved rather than the thing being promised — there are now two
generated wrappers to drift, and neither has a hand-written list to drift from.

```ts
{
  name: "find_unlisted_copies",          // snake_case, the OpenAPI operationId and the MCP tool name
  method: "GET",
  path: "/copies/unlisted",              // relative to /api/v1; "{name}" for a path parameter
  description: "Find copies that are not listed in any offer.",   // written for a model to read
  writes: false,                         // #707 refuses a `read` token on a writing operation
  parameters: [ /* ParameterSpec[] */ ],
  result: { kind: "list", description: "The copies with no offer against them." },
  handler: async ({ ownerId, collectionId }, params) => { /* call src/lib/ */ },
}
```

**Name it after the task, not after a resource.** `find_unlisted_copies`, not `GET /items` with
eighteen filters. An agent resolves a wide parameter surface by guessing and a named task by reading,
and a tool with eighteen optional arguments is a tool a model uses wrongly.

**Write the description for a model.** It is what the agent reads in the document and, through #709,
in the tool description — where it is the **first** thing, with the `result` description after it,
because an MCP tool has one description field and a model decides whether to call a tool from both
halves. It is not a changelog line.

**Declare `writes` honestly.** It is the one place that decides: #707 reads it to refuse a read-only
token, and the document says so to the agent. An operation that writes and declares `false` is a
security defect with no test that can see it — nothing checks a `writes` declaration against what a
handler does, and nothing can.

## The module layout is the Prisma-free split, and the whole track follows it

**This is the rule, not a description of how #706 happened to arrange its files.** The layer is cut
in exactly one place — **what may reach Prisma** — and every issue in this track sits on one side of
that cut or the other. The vocabulary, the parsers, the list and cursor helpers, the error helpers,
the document generator and **the whole MCP protocol layer** are **pure**; the registry array, which
reaches handlers, is the only server-side module. **Add to the pure side by default, and put
something on the server side only because it genuinely needs the database.** #708's name-or-id
resolver, #709's registry-to-tool generation and every operation's parameter declarations all
belong on the pure side; only the handler behind an operation — and the two route files that read a
request — does not.

Two things fall out of it, and both are why it is a rule rather than a preference — they are stated
under the tree below.

```
src/lib/agent-api/
  types.ts          the Operation and ParameterSpec vocabulary — imports nothing
  errors.ts         codes, statuses, the agent-facing error body
  params.ts         the hand-written parsers and the handler-side readers
  list.ts           the window parameters, the cursor, the list envelope
  path-template.ts  "{name}" matching for the dispatcher
  photo-url.ts      the one spelling of a photo link
  scope.ts          whether a token's scope covers an operation (#707)
  vocabulary.ts     the response shape and the name-or-id resolver (#708)
  collection-reads.ts  the read responses and their projections (#710)
  offer-reads.ts    the offer responses, their projections and the text vocabulary (#711)
  want-reads.ts     the want and checklist-gap responses and their projections (#712)
  trade-reads.ts    the trade, line and balance responses and their projections (#712)
  bid-reads.ts      the bid-recommendation response and its projections (#1168)
  auction-reads.ts  the watchlist, exposure and tracked-listing responses (#1036)
  purchase-reads.ts the purchase responses, the seller match and the close-name rule (#1390)
  catalog-resolve.ts  the foreign-number parse, the key set and the verdict (#1037)
  size-reads.ts     the size figure grammar, the size source, the apply report (#1415)
  catalog-edits.ts  the "key: value" entries, the date bounds, the duplicate refusal (#1438)
  colnect-ids.ts    reading a Colnect item-ID, the answer, the refusal for one held (#1445)
  translations.ts   the text kinds, the `kind.field.id` key, the language check, the answers (#1452)
  checklist-reads.ts  the checklist row, the order they are listed in, the refusals (#1512)
  catalog-prices.ts  naming an edition, the cell grammar, the grid's figures, the per-cell answer (#1540)
  area-reads.ts     the area row, the tree order, the catalogue spelling, the refusals (#1539)
  auction-writes.ts the lot-line grammar, amounts, instants, tags, a written line read back (#1627, #1628)
  openapi.ts        buildOpenApiDocument + validateOperations + parameterSchema
  mcp.ts            the MCP protocol: tool generation and JSON-RPC dispatch (#709)
  registry.ts       the operations array and the path lookup
  operations/
    vocabulary.ts   the vocabulary read and its registry entry (#708)   ← server-side
    reads-shared.ts the collection header, the labeller, the location tree (#710)  ← server-side
    search.ts       search_collection (#710)                            ← server-side
    catalog.ts      resolve_catalog_numbers (#1037)                     ← server-side
    records.ts      get_stamp / get_issue / get_copy (#710)             ← server-side
    holdings.ts     list_holdings / summarize_valuation (#710)          ← server-side
    offers.ts       the six offer verbs (#711)                          ← server-side
    wants.ts        the two want reads and the checklist gap (#712)     ← server-side
    trades.ts       the nine trade verbs (#712)                         ← server-side
    bids.ts         recommend_bid (#1168)                                ← server-side
    auctions.ts     the three auction reads (#1036)                      ← server-side
    purchases.ts    the eleven purchase operations (#1390)               ← server-side
    sizes.ts        the seven stamp-size and preset operations (#1415)  ← server-side
    stamp-refs.ts   naming a stamp by id or number, reading its labels   ← server-side
    catalog-edits.ts  the five catalogue writes (#1438)                  ← server-side
    colnect-ids.ts  set_stamp_colnect_id (#1445)                        ← server-side
    translations.ts find_missing_translations / set_translations (#1452) ← server-side
    checklists.ts   the eight checklist operations (#1512)              ← server-side
    catalog-prices.ts  the editions, the price read, set and clear (#1540)  ← server-side
    areas.ts        the six area operations (#1539)                     ← server-side
    auction-writes.ts  the five auction writes and the outcome (#1627, #1628)  ← server-side
```

**`collection-reads.ts`, `offer-reads.ts`, `want-reads.ts`, `trade-reads.ts`, `bid-reads.ts`,
`auction-reads.ts`, `auction-writes.ts`, `purchase-reads.ts`, `size-reads.ts`, `catalog-edits.ts`, `colnect-ids.ts`, `translations.ts`, `checklist-reads.ts`, `catalog-prices.ts`, `area-reads.ts` and `catalog-resolve.ts` are on the pure side and are typed structurally** rather than against
`ItemListItem` and friends, which is the shape `src/lib/issue-stamp-match.ts` already reaches for and
for its stated reason — *so it unit-tests without Prisma*. An `import type` from a `server-only`
module would pass the purity walk (it is erased before it runs), and it is still not what this side
of the cut is for: the read models carry sixty fields apiece, and a projection naming them would stop
being readable as a statement of what an agent is told.

**Everything but `registry.ts` and `operations/` is pure and carries no `server-only`.** That is
load-bearing twice over:

- **`pnpm test:unit` forbids Prisma anywhere in its import graph**, and
  `tests/unit/unit-suite-purity.test.ts` walks the graph and names the chain when something breaks
  it. The machinery worth testing — the parsers, the list window, the path matcher, the document
  generator — is reachable from a test only because none of it reaches the registry.
  **So nothing in `tests/unit/` may import `registry.ts`**: it carries handlers, and a handler
  reaches Prisma. A real operation is exercised end to end by the integration suite. **That went
  from pending to live with #708** rather than with #710, which is what this line used to
  anticipate — `registry.ts` imports `operations/vocabulary.ts`, which carries `server-only`.
- **The import direction is one-way.** The registry imports operation modules; an operation module
  imports the types and the helpers beside it and **never** the registry. A registry importing
  handlers that import the registry back is exactly the `src/lib` cycle that typechecks, passes every
  test, and then throws `Cannot access 'X' before initialization` at module-init in the real app
  (#658, `platform.md`). Nothing warns.

## The conventions, and the constraint they all come from

**The agent's context window is the binding constraint here, not bandwidth.** Every convention below
follows from that, and each looks arbitrary without it.

- **Flat, short fields.** No nested trees, and no field a screen needs that a reader does not. A
  response shaped like the screen's payload is the most common way to spend an agent's context on
  nothing.
- **A hard default limit with a cursor on every list.** `DEFAULT_LIST_LIMIT` is 25 and
  `MAX_LIST_LIMIT` is 100, and the cap is **hard**: a request above it is refused rather than
  clamped. Clamping would hand back fewer rows than asked for with nothing saying so, which is the
  same failure `total` exists to prevent one level down.
- **Every list response states the full `total`.** This is the convention that is not obvious and it
  is the important one. An agent handed twenty-five rows and no total cannot tell a page from the
  whole collection, so it answers confidently about a slice. Build the envelope with `listResponse`,
  and pass the **match count**, never `items.length` — a response derived from its own page always
  claims to be complete.
- **The cursor is the next offset as a decimal string**, which is this project's existing spelling
  (`wants.ts`, `sales.ts`, `items.ts` and nine others), so the domain layer's own paging drops
  straight in. It is opaque to the agent by contract: the parameter's own sentence says to send back
  what the last response gave, which leaves it free to become something else without a version bump.
- **Photos are URLs, never bytes** — `agentPhotoUrl`, once, so #710 and #711 cannot arrive at two
  spellings. The link is the app's existing photo route, which takes the same bearer token, so the
  agent's own credential opens it.
- **An error carries a stable code, one English sentence saying what to do next, and the accepted
  values where a value was rejected against a closed set.** Throw an `ApiError` from `errors.ts`; the
  dispatcher renders it. Anything else thrown out of a handler becomes a bare `internal_error` and
  its message is deliberately **not** relayed — an internal message is written for a maintainer, and
  putting it in front of an agent spends context on a sentence it cannot act on.

**And an undeclared query parameter is rejected rather than ignored**, with the declared names in
`accepted`. It is the same argument one level up: an agent that guessed `filter=` and was silently
ignored receives a plausible answer to a question it did not ask.

## Authentication

**Token only, and no collection id anywhere.** `resolveAgentApiCaller` in `src/lib/route-auth.ts`
verifies the `Authorization: Bearer stmpa_…` header and derives the collection **from** the token —
an Assistant token is pinned to exactly one collection (#253), so an id in the path could only ever
be right or wrong, never useful.

**That sibling is a consequence of the no-id rule rather than a decision of its own, and #706's own
issue body does not state it.** `resolveCollectionOwner` is handed a collection and asks whether the
credential covers it, which is what a screen route wants because it knows its collection from the
URL. **With no id in the path there is nothing to hand it**, so the same reasoning one step on
produces a function that runs the comparison the other way round. **Every issue in this track
inherits it** — #707 hangs scope enforcement on it, and #708 through #712 reach their collection
through it and through nothing else. An operation never takes a `collectionId` parameter; it reads
`context.collectionId`.

**A Better Auth session is not accepted here, and that is what makes the decision sound**: a session
covers every collection its user owns, so a session caller would have no way to say which collection
it meant and the id would have to come back into the path. A browser that wants this surface mints a
token like any other agent.

`resolveCollectionOwner` is untouched and the screen routes go on accepting both.

### A token's scope, and where it is checked

**A token carries a scope, and the operation carries `writes`; the two meet in one place** (#707).
`AssistantToken` gained `scope` (`read` / `read_write`) and `kind` (`extension` / `agent`).
`resolveAgentApiCaller` derives the scope from the credential exactly as it derives the collection,
and `assertAgentApiScope` beside it refuses a `read` token on an operation that declares
`writes: true`. **The dispatcher calls it after the operation is resolved and before a parameter is
parsed** — after, because the answer depends on which operation was picked; before, because there is
no point validating parameters for a call that will not be made.

**The decision is on the pure side and the enforcement point is not, and both halves are
deliberate.** `agent-api/scope.ts` holds `assertOperationScope`, a function of a scope and a
`writes` declaration, so `pnpm test:unit` can hold it; `route-auth.ts` holds the one-line function
the dispatcher calls, because that is where the collection pinning already lives and because
authorization here is server-side and never in a caller. The vocabulary itself is one level further
out again, in the pure `src/lib/assistant-token-scope.ts` — Settings → Assistant & API is a `"use client"`
panel and `api-tokens.ts` carries `server-only`, so a constant both halves read belongs in a module
neither owns (`platform.md`).

**The refusal is the error convention of this surface**: `forbidden`, 403, one English sentence
naming the operation and the scope that would have worked, and `accepted` carrying both scopes. An
agent cannot widen its own token; what the sentence buys is that it stops retrying and can say which
scope the collector has to grant.

**Two things about `writes` that are worth stating rather than inferring.** It is read here and
nowhere else, so an operation does not check its own scope — one that forgot to would be a defect
with nothing to see it, which is the same argument as declaring it honestly above. And the check
reads `writes` and **nothing** else: a verb in an operation's name buys no protection at all.

**And `kind` is a label, never a permission.** It says what a token was minted for so that the
collector can tell one row of the Settings list from another; what a token may do is `scope` and
only `scope`. Do not grow a check on it.

**#711 made the criterion real, and the three premises it had before are worth keeping.** #707's
*Done when* says a `read` token is refused on any writing operation and accepted on every reading
one. For four issues there was nothing to refuse it on, and the premise was restated three times
without the conclusion moving: *the registry is empty until #710*; then *#708 filled the registry and
the conclusion is untouched, because its one operation declares `writes: false`*; then *#710 filled
the registry properly — seven operations — and the conclusion is untouched a second time, because
every one of them declares `writes: false`*. All three are quoted rather than deleted, because each
was true when it was written and will go on arriving in anything copied from it. **The point they
were carrying is the one that survives**: what the criterion waited for was a *writing* operation and
not a populated registry.

`draft_offer`, `set_offer_price` and `set_offer_text` declare `writes: true`, so
`tests/integration/agent-api-offers.test.ts` refuses a real `read` token on each of them through the
real dispatcher, and through the MCP wrapper besides. **That test is owed to #707 and #709 rather
than to #711** and says so in its own header, because it is the first end-to-end proof that scope
enforcement works on the wire. #712's five writing verbs are refused the same way in
`tests/integration/agent-api-trades.test.ts`.

**One assertion in #711's file had to be loosened by #712, and the reason is worth carrying.** It
read `deepEqual(writing.sort(), ["draft_offer", "set_offer_price", "set_offer_text"])` under the
label *the writing operations #711 added* — a sentence about one issue, asked as a question about
the **whole registry**, so the next issue to declare a write turned it red in a file that has
nothing to do with it. It now asks that #711's three still declare `writes: true` **and** that
#711's three reads still do not, which is the direction an accident would actually go: a read
quietly gaining `writes: true` refuses a `read` token that should have worked. **An exact list over
`OPERATIONS` belongs only where the subject is the registry**, which is
*What is deliberately absent* below.

**The fixture tests stay, and that is unchanged rather than left over.**
`tests/unit/agent-api-scope.test.ts` exercises both directions over fixture operations because
`tests/unit/` may not import `registry.ts` at all, and
`tests/integration/agent-api-auth.test.ts` keeps its fixtures because its own question — that a scope
read off a real hashed row reaches `assertAgentApiScope` — is answerable without a collection's worth
of fixture data behind it.

**Existing tokens are `read_write` + `extension`, and the migration is what makes that true.** They
are extension tokens doing extension work and narrowing them would break a working install, so
`20260911000000_assistant_token_scope_and_kind` adds both columns with those values as SQL defaults
— which backfills every existing row — and then **drops the defaults**. That second statement is the
point: with no default the generated client makes both fields required, so every mint has to state a
scope rather than arrive at the widest one by omission. Registration (#252) states `extension` +
`read_write` explicitly, because the extension connecting itself has nobody to ask.

**Per-area scopes (`offers:write`, `trades:write`, …) are out of scope and a second token model is
not wanted.** One model, one Settings screen: `read` / `read_write` widens into per-area scopes later
without either. If a real need appears, that is the shape to reach for.

## The collection's vocabulary, and names instead of cuids

**This is the thing most likely to decide whether the surface works in practice** (#708), and it is
an issue rather than a footnote in each operation for that reason. Almost everything an agent wants
to say about a stamp is a per-collection, user-configurable value — a condition, a format, an area,
a location — and every one of them is cuid-keyed. An agent will never guess a cuid.

**One call, held for the session.** `GET /api/v1/vocabulary` (`get_collection_vocabulary`) returns
the whole configurable vocabulary in one object. The agent fetches it once at the start of a session
and keeps it, which is why **the shape matters more than the endpoint does**: every field is paid for
in the agent's context on every later turn, not once on the wire.

**Names are accepted wherever a name is unambiguous.** An operation taking a condition takes `"MNH"`
as readily as its id. `resolveVocabularyValue` in the pure `agent-api/vocabulary.ts` is the one
spelling of that rule, and it has exactly three branches:

- an **id** is taken as an id;
- a **name, abbreviation or label** that matches exactly one row resolves, case- and
  whitespace-insensitively — the abbreviation matters as much as the name, because an agent reading a
  listing meets `MNH` far more often than `Mint Never Hinged`;
- an **ambiguous** name is refused and the id is required. Nothing stops a collector naming two areas
  `Poland`, and guessing would file a copy under the wrong one silently — the one failure here that
  is both invisible and expensive.

**The two refusals hand back different lists, and that is the point rather than an inconsistency.**
`unknownVocabularyValue` returns the accepted **names**, so the agent can pick. `ambiguousVocabularyValue`
returns the matching **ids**, because handing the names back would hand the ambiguity back with them
and the agent would retry the same string for ever. Both are in the shared `errors.ts` for the reason
#706 gives about `accepted`: one convention, not eight spellings. The name list is capped at
`MAX_ACCEPTED_VALUES` (40) and past it the sentence points at this operation — an area list runs to
hundreds of rows and an error an agent may hit repeatedly must not paste all of them.

### The nine it names are not nine of the same thing

**#708's *Done when* cannot be satisfied against the tree, and a later reader should know that rather
than re-derive it.** It says *one call returns every vocabulary an operation in #710, #711 or #712 can
take as input* — and none of those exists, so what the endpoint ships was derived from those three
issue bodies. The derivation is in the pull request that landed this; **if a vocabulary turns out to
be missing when one of them is built, adding a key is not a break** — `/api/v1` only ever grows.

The issue names *conditions, formats, subtypes, certificate statuses, areas, catalogs and vendors,
locations, currencies*. Measured against the schema they fall into several kinds, and the response is
shaped per kind rather than flattened into one:

| kind | which | shape |
| --- | --- | --- |
| flat, per-collection, cuid | conditions, formats, certificate statuses, subtypes, catalog vendors | `{id, name, abbreviation?, label?}` |
| flat, plus one locked fact | platforms | the same, plus the `currency` an offer there is locked to |
| flat, and **people** | exchange partners (#712) | `{id, name}` and nothing else — see below |
| **trees** | areas, locations | the same, plus `parentId` and `assignable` |
| hangs off a vendor | catalogs | the same, plus `vendorId` and `currency` |
| **not this kind of thing at all** | currencies | not returned — see below |

**The trees are returned flat, carrying `parentId`.** An agent that wants the tree rebuilds it in
three lines, and nesting would repeat every parent's fields down every branch — which is exactly what
the context-window constraint forbids. So *one call* survived intact; what did not is *one flat shape
for all nine*.

**Currencies are deliberately absent, and #708's own premise is the argument.** That premise is *all
of them are cuid-keyed, and an agent will never guess a cuid* — true of the eight above and false of
`"EUR"`. Currencies are a module-level constant in `src/lib/currencies.ts`: app-wide, not
per-collection, not configurable, and already known to any model. What the agent actually needs is
the denomination of a figure it reads, and that is the `baseCurrency` scalar on the response.

**The second half of that argument was retired by #712 and is quoted rather than deleted**, because
it was true when written and will go on arriving in anything copied from it: *And no operation in
the three takes one as input: an offer's currency is inherited and locked from
`Contact.platformCurrency` (#196), so drafting an offer names a platform, never a currency.* The
offer half still holds. What does not is *no operation takes one*: #712's `create_trade` takes an
optional `currency`, and it defaults to the collection's own base currency exactly as the
collector's form defaults it.

**The sharper correction is not that it became false but that the justification never covered #712
at all.** The sentence says *the three* — #710, #711 and #712 — and supports it with a fact about
**offers alone**, so it was a prediction about an unimplemented issue written in the present tense
as a fact. `Trade.currency` is a real column, and its schema comment says what it is: *the currency
the partner's figures are expressed in (#638)*. Nothing inherits it from a platform, because **a
trade has no platform** — the inheritance that made the claim true of an offer has no counterpart on
the other side of the scope it was asserted over.

**And the sentence two lines below it has the identical shape, so #712 settles it too:**
*Catalog editions are absent for the same kind of reason — an edition is a year on a book, and
nothing in #710, #711 or #712 takes one.* **That one holds.** None of #712's twelve operations takes
a catalog edition as input: an edition is chosen by the valuation rule from the stamp's area and the
collection's own catalogue configuration, and every figure this surface states — a copy's, a want's
range, a trade line's — arrives already read in whatever edition that rule picked. Left as written.

**That does not reopen #708's decision, and reading it as a case for a currency vocabulary would be
the mistake.** What #708 settled is that currencies need no *vocabulary read* — they are not
cuid-keyed, so there is nothing to resolve. A small closed set is expressed as a `values` list on
the parameter, which is the mechanism #706 already provides, and `create_trade` uses
`COMMON_CURRENCIES` there. The premise's factual half moved; its conclusion did not.

**Catalog editions are absent for the same kind of reason** — an edition is a year on a book, and
nothing in #710, #711 or #712 takes one.

**Platforms are included, and they are the one vocabulary derived from #711's body rather than from
#708's list of nine** — marked as such in the type, so whoever implements #711 can contradict it.
**#711 did not contradict it, and that is worth recording rather than leaving to be inferred**: three
of its six operations take a platform (`find_unlisted_copies` requires one, `list_offers` takes one
optionally, `draft_offer` requires one), each resolving it through `resolveVocabularyValue` against
this very key. The derivation was right.
#708's Context names nine and platforms is not among them; **the binding statement is the *Done
when***, and #711's *draft an offer* cannot be called without naming a platform, because an offer's
currency is inherited and locked from `Contact.platformCurrency` (#196). That is the same test that
admitted areas, conditions, locations, formats, certificate statuses and catalog vendors, and the
same test that kept currencies out — so applying it to six and refusing it for a seventh was the
inconsistency, not the inclusion.

**It is the reason there is no currency vocabulary rather than an exception to it.** Where an agent
might have thought it was choosing a currency, it is choosing a platform.

**A platform is a `Contact` with `platform: true`, projected to `{id, name, currency}`, and the
projection is load-bearing.** That table is shared with buyers, sellers, exchange partners and
auction houses, and carries `email`, `phone`, `fullName` and `notes`. **Three guards, and the mapper is the one that
holds** — measured rather than assumed: the `where` decides whose rows, the `select` which columns
leave the database, and the mapper what reaches the agent. Dropping the filter *and* adding `email`
to the `select` still leaked nothing, because the mapper names its fields instead of spreading the
row. The other two are depth behind it, so do not replace the mapper with a spread. The role flags are independent and
combinable (ADR-0007 §4), so a contact that is a platform *and* a seller is returned — `platform` is
the whole test — and its personal columns still are not.

**Exchange partners joined on the same test, and the projection matters more there than it does for
a platform** (#712). A platform is a marketplace; an exchange partner is a **person**, and the row
carrying one is the same row that carries their email, their telephone number and the collector's
private notes about them. Two fields leave the query — `{id, name}` — and two reach the agent, and
the paragraph above is the rule being followed rather than a second one: **do not replace that
mapper with a spread.** `tests/integration/agent-api-trades.test.ts` asks the wire rather than the
query, searching a real vocabulary response for a real partner's email, telephone and note.

**The reason they are here at all is that the alternative was worse.** `create_trade` needs a
partner, and `createTrade` will find-or-create a contact from a typed name exactly as a purchase's
supplier does — right for a person filling in a form, and *writing to the vocabulary* for this
surface. So the agent resolves somebody the collection already knows, or is refused with the names
that would have worked; the integration suite checks the contact count across that refusal, because
a partner quietly created on the way is the failure that would look like success.

**Writing to the vocabulary is out of scope for the whole surface.** An agent works within the
collector's configured terms; changing them is a settings decision and stays in the UI. There is no
operation for it, which is the same *absence, not a flag* the section below is about.

### `label`, and what it is for

Vocabulary comes back **in the collection's own terms**: `name` is the canonical value the collector
configured and is what an agent sends back. `label` is what the collection actually *displays* for
that row where it differs — the `defaultLanguage` translation where one exists, falling back for an
area to its `titleName`, which is genuinely a different string (internal `Second Republic` against
public `Poland`, #210).

**It is omitted when absent or identical to `name`**, which is the common case by a wide margin. A
`label` echoing every `name` would double every vocabulary to say nothing, and this response is held
for a whole session.

**One reading of #708 here was left to its author.** The issue says *the translated label beside the
canonical name where one exists*, and the obvious implementation would be dead code: the `name`
columns **are** the default-language value, and the schema says the default language is excluded from
the per-language inputs, so a translation row *for* `defaultLanguage` should not exist. What is
implemented is the reading that is correct either way and costs nothing when there is nothing.

## Reading the collection

**Six operations, answering the first of the workflows** (#710): *what do I have, in
what condition, where does it sit, what is it worth, what is missing*. All six are `read` scope and
none of them writes.

| operation | what it is for |
| --- | --- |
| `search_collection` | one piece of text in, ids out — the only operation that takes no id |
| `get_stamp` / `get_issue` / `get_copy` | one record in full, as one call |
| `list_holdings` | what is held, scoped to a series, stamp, area, year, location or grade |
| `summarize_valuation` | what that same scope is worth, four ways |

**Everything here is `src/lib/` exposed rather than reinvented, and that is the rule to keep.**
`search_collection` is `searchCollection` — the browser extension's *have I got this?* window
(#529), which deliberately runs three searches rather than one because the three lists a collector
reads already disagree about what a query means. The three records read through the **list's own**
enrichment, `getStampListItem` / `getIssueListItem` / `listItemsPaginated`, which is what the detail
*pages* already do (`inventory-lists.md`) so that a record cannot read one way to an agent and
another on the screen beside it. The holdings pair is `listItemsPaginated` + `countItems` +
`getHoldingsValuation`, which already narrow through one private `buildItemWhere`. **If you find
yourself writing domain logic in an operation, stop** — it exists somewhere, or it is a decision
that needs an issue.

### The five verbs became six, and the fifth moved

#710 named its five verbs *a starting set to refine during implementation*. What changed is one
thing, and the reasoning is the part worth keeping rather than the count.

**There is no *where is this copy* operation.** Every holdings row states its own `location` — the
full filing path — and its `locationRef`, so *where is it* is answered by the row without a second
call, and the other half of that bullet (*what is in this drawer*) is the `location` scope on
`list_holdings`. A verb of its own would have been a third way of asking one question. **This is
what makes the issue's own *Done when* reachable**: *what do I hold from this issue, in what
condition, and where is it* is one call, and
`tests/integration/agent-api-collection-reads.test.ts` makes it and reads the answer out rather than
asserting that it could.

**And *one thing in full* is three operations rather than one `get_thing(kind, id)`.** The *three*
in *"as one call rather than three"* is the calls it takes to assemble one record — the stamp, then
its prices, then its copies — not the three kinds. A discriminated resource verb would be the wide
parameter surface the first decision rules out, and an agent that got an id out of
`search_collection` already knows which kind it holds.

### Six named scopes, and why the list stops there

`list_holdings` and `summarize_valuation` share one scope — `issue_id`, `stamp_id`, `area`, `year`,
`location`, `condition` — declared once, ANDed, and every one of them something a collector would
say out loud. The Copies list's other two dozen filters are deliberately absent: an agent resolves a
wide parameter surface by guessing, and each knob is one more thing to guess wrong.

**They share the scope *in one function*, and that is not tidiness.** `countItems`'s own comment says
a count that disagrees with the rows under it is worse than no count; the two operations resolving
the same parameters twice, in two files, is how that guarantee is lost one refactor later.

**A scope that names nothing is a refusal, never an empty answer.** An agent handed `[]` cannot tell
*you hold none of these* from *that id was wrong*, and only the second is a mistake it can fix. So an
`issue_id` or `stamp_id` matching nothing is `not_found` naming `search_collection`, a bad area,
location or condition is #708's own refusal carrying the accepted names — and a **real** series that
happens to hold nothing is an ordinary empty list. All three states are distinguishable, which is the
whole point.

**Vocabulary values resolve against `readCollectionVocabulary`**, the very endpoint the agent took
the names from, rather than against a narrower query. A name the agent was told to send being
refused is the failure that would be, and one dictionary row spelled in two places is how it
happens.

### What a row says, and what it deliberately does not

The projections are pure, in `agent-api/collection-reads.ts`, structurally typed so `pnpm test:unit`
holds them — `issue-stamp-match.ts`'s precedent, and for its reason. Four decisions live there:

- **`null` and `""` are dropped; `0` and `false` are kept.** `copies: 0` is the answer *not held*
  (#348) and `forSale: false` is a disposition the collector set.
- **A null certificate and a null format are absent, never spelled.** A null certificate *is* "no
  certificate" (ADR-0006 §2) and a null format *is* the single (ADR-0020); neither has a dictionary
  row, so naming one would hand the agent a vocabulary value it could not find in
  `get_collection_vocabulary` and could not send back. The result description says so instead.
- **A stamp's two copy counts are never summed** (#348/#528) — copies of this stamp exactly, and
  copies under its variants.
- **A holdings row is leaner than a record.** A list is read twenty-five rows at a time and every
  field is paid for on each of them; the rest is one `get_copy` away.

### Two conventions this issue had to extend

**`byCondition` counts the whole match, not the page.** `total` tells an agent it was trimmed and
still leaves it nothing to say about the ninety rows it did not get, so `list_holdings` carries a
condition breakdown over the whole matched set — `countItemsByCondition`, added beside `countItems`
and through the same three calls, so it narrows over exactly the `where` the rows came from. It is
what lets *what do I hold and in what condition* be one call over an area as well as over an issue.

**A search states that it may be trimmed rather than stating a total.** The three searches behind
`search_collection` take a fixed number of rows and count none of the rest, so
`stampsMayBeTrimmed` / `issuesMayBeTrimmed` / `copiesMayBeTrimmed` say *this group came back full*
rather than a total nothing measured. Counting the matches would mean changing all three searches,
which is the reinvention #710 says not to do; claiming a definite *there are more* would be a fact
nothing here took.

### The valuation reads over a wider set than the holdings list

`summarize_valuation` states five totals — catalogue, market, cost, opening value, write-off — and
**every one of them travels with the counts saying how much of the collection is behind it**
(`valuation.md`): a figure built from a tenth of the copies must never read as the collection's
worth. `openingValue` joined in #1324: copies from an opening balance carry a cost basis nobody
paid, so it is a group of its own and never inside `cost`.

**It covers the held copies *and* the ones in the same scope that are gone**, because
`getHoldingsValuation` lifts the disposal exclusion on purpose (#396) so it can state a write-off.
`list_holdings` shows the held ones only, so its `total` and `catalogue.pricedCount` are **not meant
to agree** — stated here and in the operation's own result description, because a later reader who
finds them disagreeing will otherwise "fix" it.

### Two things outside `agent-api/` that #710 moved

Both are one spelling being shared rather than a second one being written, and both are worth
knowing before something is "simplified" back:

- **`makeCatalogLabeller` is exported from `collection-search.ts`.** A stamp reading `Mi·PL 200` in
  the window a collector opens at an auction and `Mi 200` to an agent would be two spellings of one
  catalog identity (#66/#377).
- **`formatIssueCatalogNumber` moved to `src/lib/catalog-range.ts`**, with
  `src/app/stamp-display.ts` re-exporting it, so `src/lib` can state an issue's declared range
  without reaching into `src/app`. It shortens the numeric end — `100–104` renders `100–04`, exactly
  as `1298–302` does on screen — which is the app's own rule and not a defect to correct.

## Resolving a number an agent was handed

**One operation, and it is a step rather than a workflow** (#1037). `resolve_catalog_numbers` is
`read` scope and writes nothing.

| operation | writes | what it is for |
| --- | --- | --- |
| `resolve_catalog_numbers` | no | foreign catalog strings in, one stamp identity **and a verdict** each out |

**The hard part already existed and the issue says so.** `src/lib/catalog-number.ts` was built for
this exact problem on the search side (#104/#146/#435): `normalizeCatalogKey` folds spacing and
punctuation, `catalogMatchKey` builds the comparison key from vendor abbreviation + area prefix +
number, `catalogNumberRuns` is the recall net that survives `BL30 B4` against `304`. So this
operation **adds no second matching rule** — it exposes the one that works, which is the rule #710
and #711 state about their own domains.

### What it adds is an answer about confidence

A person typing into a search box sees the results and picks, so recall may be generous and
**containment is the right comparison**: `catalogKeyMatches` finds `"200"` inside `"mipl2000"` on
purpose, and the person ignores the rows they did not mean. An agent cannot ignore anything. So the
resolver compares **the same keys by equality**, and answers one of four things:

- **`resolved`** — exactly one stamp, with `matchedNumber` saying which of its own numbers answered;
- **`ambiguous`** — several, all returned with their numbers, name, series and area, and *none
  picked*;
- **`unknown_vendor`** — the string names a catalogue this collection does not keep;
- **`no_match`** — the number is simply not held here.

**The third and fourth are the issue's reason for existing.** `Fi 456` where no Fischer vendor is
configured is a different fact from a number that is not held: the first is fixed by naming a
catalogue the collection does have, the second by buying the stamp, and an agent that conflates them
files a wrong report every morning.

**An `unknown_vendor` entry is never looked up at all**, which is the sharp end of that. An agent
that wrote `Fi 456` said *Fischer*, so answering it with a `Mi 456` that happens to exist would be
the mistake that is both invisible and expensive — it looks exactly like a right answer. The row
carries `vendorToken` and `acceptedVendors` instead, which is `errors.ts`'s `accepted` convention
carried **in the row** rather than thrown: one unresolvable entry must not refuse the other
nineteen.

### The three things the parse must not do

Each is a guard rather than a nicety, and each is measured by the unit suite:

- **A prefix the collection uses is never dropped.** `Mi·SP 1` and `Mi·PL 1` are two stamps
  (#66/#377), so the bare-number fallback that lets `Michel 123a` — `chel123a` once `mi` is off the
  front — reach the same stamp as `Mi 123a` is **switched off** when the letters being dropped are a
  prefix this collection actually configures. The prefix set is the area tree's *and* the issues'
  overrides, both levels, because both are catalog identity.
- **A prefix is never read as a catalogue's name.** `PL 200` names no vendor, so the same set is
  consulted a second time before a leading word is called an unknown catalogue.
- **A leading word is read conservatively.** `leadingCatalogueWord` refuses a word with nothing after
  it (`VIII` is a whole catalog number, #383), a word carrying anything but letters (`BL30`,
  `Ark. 103`), a word longer than twelve letters, and a word the collection uses as a prefix. It is
  written to be wrong in the cheap direction: a word it misses costs a `no_match` where an
  `unknown_vendor` would have helped more, and a word it invents blocks a resolution that worked.

### `stripCatalogVendor` was lifted, not copied

`parseCatalogSearch` did the vendor strip inline and then dropped whatever led the remainder — right
for a search box, and it throws away the area prefix a resolver needs. The loop is now
`stripCatalogVendor` in `catalog-number.ts` and `parseCatalogSearch` is three lines over it, which is
#1168's own `lotLineValueOf` move: **if the picker's answer and the resolver's could diverge about
which vendor a string names, nothing would ever go red over it.**

**A vendor's full name needs no branch of its own**, which is the small surprise in that function.
An abbreviation is by convention the start of the name it stands for, so `Michel 123a` normalizes to
`michel123a`, gives `mi` up to the existing longest-first strip, and leaves `chel123a` — whose
leading letters the caller already drops as it drops an area code. #1037's *Done when* names
`Michel 123a` explicitly and it was answered by the code that was already there.

### Two reads rather than one, and a cap that would have lied

The prefix a stamp's number carries depends on its area and its issue, so the exact comparison
cannot run until those are loaded — and loading them for every row the recall net pulls back would
mean capping the scan. **A cap turns a stamp that was simply row 201 into a `no_match`**, which is
the one answer this operation must never give wrongly. So `loadCandidateStamps` reads three columns,
applies a *necessary* condition that needs no prefix (`couldMatchForeignCatalogNumber`), and reads
in full only what survives it. That filter is never the answer; the exact comparison still decides,
which is what keeps it from becoming a second matching rule in its own right.

### What it deliberately is not

**It does not say what is held.** `stamps` carries identity — the numbers, the name, the series, the
area, the path — and stops there. The issue's own *Out of scope* points at #710 for the rest: this
says what a number *is*, and `list_holdings` or `get_stamp` says what there is of it.

**There is no collection-level default catalogue, and none was invented.** #1037's Context mentions
*the collection's default*; the schema has no such column — `CollectionArea.primaryCatalogVendorId`
is per **area** (#675) and a bare number arrives with no area. So a bare number with no `vendor`
parameter is matched against every catalogue and reported `ambiguous` when more than one stamp
answers, which is the honest reading and needs no schema change. A collection with one vendor gets
*the default* for free. A real collection-level setting is a product decision and would be an issue.

### A stamp's short number is the third way to name one

Since #1574 every stamp has a short number (`Stamp.stampNo`, ADR-0062), and the API carries it both
ways. **Out:** every answer that describes a stamp — a search row, `get_stamp`, a resolution, a
checklist's stamps, a size reading, a price-tree row, a checklist gap, a stamp a write created or
named — has `stampNo` beside `stampId`. Rows whose subject is a copy, a want, a trade line or a bid
line do not: they carry their own identity (`itemNo`, `wantId`, …) and the stamp is one `get_stamp`
away, which is #710's *a row is leaner than a record* again.

**In:** wherever a stamp is named — the `stamp`/`stamps` parameters `resolveStampRefs` reads and the
older id-only `stamp_id`/`stamp_ids` parameters alike — `st 123` is accepted. It is the quick-jump
box's own reading (`parseStampNoRef` in `quick-jump.ts`, over `parseQuickJump`), so the agent sends
exactly what a row shows and the box takes. **The `st` is required**: a bare `123` stays a catalogue
number, for the box's reason. A short number is read **before** anything else is tried, so it can
never reach the catalogue resolver. `stampIdFromRef` turns one into an id and otherwise passes the
value through untouched, so each operation's own *no stamp with id …* check still answers for an id;
a number naming nothing is refused as a number. In a list (`stampIdsFromRefs`) one such number
refuses the whole call, as a catalogue number that resolves to nothing does.

## Working on offers

**Six operations, answering the second of the workflows** (#711): *what is not listed,
what is it worth, draft a listing, price it, word it.* Three of them **write**, and they are the
first writes on this surface.

| operation | writes | what it is for |
| --- | --- | --- |
| `find_unlisted_copies` | no | for-sale copies with no open listing on a marketplace, with what each is worth |
| `list_offers` | no | the listings, narrowed to a marketplace, a state or a piece of text |
| `get_offer` | no | one listing in full, **including what it could be priced at** |
| `draft_offer` | yes | a new `preparing` listing around some copies, titled from the marketplace's template |
| `set_offer_price` | yes | what the seller is asking |
| `set_offer_text` | yes | write a text, or hand it back to the marketplace's template |

**Everything here is `src/lib/` exposed rather than reinvented**, which is #710's rule and the one to
keep. `find_unlisted_copies` is `listItemsPaginated` with `notOfferedPlatformId`, which is #259's own
worklist; `draft_offer` is `createOffer`; `set_offer_price` is `patchOffer`; `set_offer_text` is
`patchOffer` or `regenerateOfferText`; the price suggestions are `getOfferDetail`'s own figures.
Two things were added, both **beside the reads they belong with** rather than inside an operation:
`countOffers` in `offers.ts`, and the catalogue-value band in `items.ts`.

### The boundary is absence, and since #711 it is checked

**The agent writes inside Stamporama and nowhere else.** There is no publish operation, no state
operation, and no way to reach `active`: `draft_offer` creates a `preparing` listing and nothing here
moves it. *What is deliberately absent* above says why; this section says how it is kept.

**Two tests, failing on different things, and the pairing is the point.**
`tests/integration/agent-api-offers.test.ts` enumerates `OPERATIONS` and fails on a publish-shaped
**name** — the mistake somebody makes deliberately.
`tests/unit/agent-api-operation-boundary.test.ts` fails on an operation module **importing** a domain
function that publishes, records a listing or moves a state — the mistake somebody makes without
noticing, and the one a name guard passes: an operation called `finalize_listing` defeats the first
test and not the second.

**The name guard matches a leading verb rather than a fragment**, because `list_offers` and
`find_unlisted_copies` both contain `list` and a pattern crude enough to catch `list_on_colnect`
would take both of them with it. **The import guard reads the parse tree rather than the text**, for
a reason worth stating before somebody simplifies it to a `grep`: these modules explain at length
why they do not publish, so the first thing a regular expression would flag is the documentation of
the rule it is checking.

**`getOfferListingKit` was weighed for that list and left off.** The listing kit (#405) is the
payload a marketplace form is filled from, so it looks like the sharpest thing to ban — and it
publishes nothing and moves nothing, it already answers to this same token on its own endpoint, and
banning it would make the list mean *anything near a marketplace* rather than *the acts that go
public*. A list that means two things is one a later reader cannot add to correctly.

### What "unlisted" means, and why it takes a platform

`find_unlisted_copies` **requires** a `platform`, which looks like a restriction and is the question
being asked. *Unlisted* is a fact about one marketplace: a copy already sold on one is routinely
still worth listing on another (#165), and the copies the collector has ruled out for a particular
platform (#506) are not candidates there and are candidates everywhere else. The filter is
`notOfferedPlatformId` whole — for sale, no non-terminal offer on that platform, nothing committed
by a live bid anywhere (#334), nothing that never arrived, and nothing excluded — plus `excludeGone`,
because a copy that has **left** passes the first clause (the offer it left on is terminal) and is
not unlisted but gone.

**An offer-level reading was considered and is not what the domain answers.** *Copies in no offer at
all* would need a new `where` clause and would hand an agent copies it must not list on the platform
it is about to draft for, which is the worklist-that-keeps-asking #506 fixed.

### The catalogue-value band, and the one product question in it

`min_catalogue_value` / `max_catalogue_value` are the *value band* #711 asks for, and a catalogue
value is **computed and never stored** (#758) — so it cannot be a `where` clause, and filtering a
page after the fact would give a `total` that disagrees with its rows. It goes through the same
narrowing `missingCatalogValue` (#229) already uses: valuate the whole matching set once, narrow to
the resulting ids, so the list, its count and the holdings total behind it cannot differ about which
copies are in scope. One helper, thirteen call sites, none of them changed.

**A copy with no catalogue value is outside every band**, which is the one thing nothing in the tree
decided for us. It is `yearFrom`/`yearTo`'s own rule one axis over — *a stamp with no issued year is
outside every span: a bound is a claim about when the goods were issued, and a copy that cannot
answer it has not met it* — and it is deliberately **not** #758's reading, where the bulk-lot
builder's per-copy ceiling admits an unpriced copy and reports it. The two are asking different
questions: that pass is filling a lot and a gap there may be read neither as *cheap enough* nor as
zero, while this one is asking which copies are in a band and an unpriced copy is not known to be.
**Stated rather than assumed**, so that a collector who disagrees has something to point at.

### What a row says, and what a verb would have been

**An unlisted-copy row states its own catalogue value and its own market median**, and that is where
#711's *price suggestions for an offer **or a copy*** went. It is #710's move said again: a holdings
row states its own `location`, so there is no *where is this copy* operation; this row states its own
worth, so there is no *what is this copy worth* operation either — a verb would have been a third way
of asking one question.

The two figures are **never merged**. `catalogValue` is a book's opinion at this exact
`condition × certificate × format`; `marketValue` is the median of what copies like it have actually
fetched (#458), and it is **absent** where no auction result answers, which is *no evidence* and
deliberately not a catalogue-derived stand-in (ADR-0022 §6). On a copy carrying several stamps the first figure is not a book's at all: no catalogue prices such a piece (#745), so `catalogValue` is the value the collector recorded on it and says so with `recorded: true` (#747) — a field added, never a meaning changed for any other copy.

### `get_offer`'s `pricing` is four claims, not a recommendation

`suggested` is the catalogue value averaged **per set**, in the listing's own currency, because a
buyer takes one set (#190). `marketTotal` is evidence. `platformOpening` is what this house opens an
auction at whatever the goods are worth (#553), and outranks the other two **on an auction only**.
`platformMinimum` is what the marketplace costs to post on (#731) and is the weakest of the four.

**Collapsing them into one number is what would make an agent price a stamp confidently and
wrongly**, which is the same argument `offers.md` makes for drawing the three figures in a fixed
order under the price on the offer's screen. And `suggested` never travels without `suggestedValuedSets` and
`suggestedUnpricedSets`, which partition the listing — `valuation.md`'s standing rule.

**`get_offer` is the verb #711 does not name and `list_offers` is the other one**, and both are here
because *adjust an offer's price* and *edit an offer's text* are unreachable without them:
`search_collection` (#710) searches stamps, issues and copies, and nothing on this surface reaches an
offer id. Folding the price suggestion into the record read rather than giving it a verb of its own
costs one call instead of two, and the suggestion is computed by `getOfferDetail` anyway.

### `set_offer_price` writes the figure the seller *states*

On a quick buy that is `price`; on an auction it is `startingPrice`. The operation takes **one**
`price` parameter and routes it by the listing's own format, which is `offers.md`'s rule said once
more rather than a new one: an auction's `price` is where the bidding has got to — an observation of
what buyers did — so writing a number into it would put a bid in the record that nobody placed.

`statedAmount` in `offer-reads.ts` is the reading half of the same rule: a stored `0.00` is what an
unbid auction and an unpriced draft both carry, and neither is a price somebody stated, so it is
reported as **absent** rather than as nought.

### `set_offer_text` is one verb for two acts, and the second is a refusal short of one

Sending `text` writes the wording and takes the field **off** the template (#380). Omitting it hands
the field back to the marketplace's template and renders it now — `regenerateOfferText`, the ↻ on the
collector's own screen, which is how wording written by hand is undone. #711 lists *compose a listing
text* and *edit an offer's text* as two of its six verbs and they are two ways of setting one field,
so they are one operation whose description says which is which.

**A field with no template to render from is refused, and this is the one guard the domain does
not make for itself.** `regenerateOfferText` writes what the generator produced, which over no
template is null — so the call would **empty** the field. The collector's own ↻ is *disabled* there
rather than refused, off `OfferDetail.regeneratable`, and the operation reads that same answer so the
two surfaces cannot come to disagree. It was found by a test failing rather than by reading.

**That shared answer is load-bearing in both directions, and #1146 is the second direction arriving.**
The refusal was worded and computed as *the marketplace has no template*, while a listing may carry
its own (#774) — so an agent omitting `text` on a bulk lot's title was refused a render that would
have worked, and the collector's ↻ was greyed out over the same wording. One projection was wrong and
both surfaces were wrong with it; correcting it there corrected both, which is exactly what reading
one answer is for. Giving either surface a computation of its own would undo that.

`get_offer` publishes both answers — `templatedTexts` and `editedTexts` — in the agent's own
spelling, so an agent need not find out by trying. **The agent's word for the title is `title`**;
`name` is what the schema calls the column, and the mapping lives once, on the pure side, because the
name a field is *sent* under has to be the name it is *read back* under.

### A literal path segment beats a parameter

`/copies/unlisted` and #710's `/copies/{copyId}` both match one request, and until #711 the winner
was whichever operation was appended to `OPERATIONS` first — so `find_unlisted_copies` was dispatched
as `get_copy` with an id of `"unlisted"`, and the refusal an agent read was *this operation has no
query parameter "platform"*: a truthful sentence about the wrong operation. `validateOperations`
cannot see it, because the two paths are genuinely different and neither the duplicate-name rule nor
the duplicate-binding rule has anything to say.

`matchPath` now orders its candidates by `templateSpecificity` — the pure comparator in
`path-template.ts`, so a unit test holds it — most specific first. It is **this app's own routing
rule one layer over**: `offers/listing/` is a sub-route of `offers/[offerId]` and *the static segment
takes precedence* (`offers.md`, #322). A stable sort keeps registry order between templates of equal
specificity, which is what decides the order a `405` lists its methods in.

## Wants and checklists

**Three operations, opening the third of the workflows** (#712): *what am I looking for,
what does a counterparty have that answers it, and what is this set still missing.* All three are
`read` scope and none of them writes.

| operation | what it is for |
| --- | --- |
| `list_wants` | the want list, each row with its acceptance sets and what is already held of its stamp |
| `match_wants` | stamps a counterparty holds, at a stated grade, against the open wants |
| `find_checklist_gaps` | what a series' checklists are missing, per checklist |

**Everything here is `src/lib/` exposed rather than reinvented**, which is #710's rule and the one
to keep. `list_wants` is `listWantsPaginated`; `match_wants` is `wantMatchesCopy` — the intake
review's own predicate — through `findWantsMatching`; `find_checklist_gaps` is
`previewIssueMissingWants`, which reads held-ness through the variant rollup (#661) exactly as the
completeness card does. **A second matching rule would be the defect**: the agent and the screen
would come to disagree about what satisfies a want or what a checklist is missing, and nothing would
ever go red over it.

**Two things were added, both beside the reads they belong with**, which is #711's move for
`countOffers`: `countWants` in `wants.ts`, and `findWantsMatching` — the body of
`findWantsSatisfiedBy` with the key made the caller's, because the intake review keys by `itemId`
and a counterparty's material has no `Item` to key by. `findWantsSatisfiedBy` now passes its own
`itemId` as that key, so there is one implementation and not two.

### The issue's four bullets became three verbs, and the two that merged are the interesting ones

#712 asks for *list and read wants*, *match wants against stock — the collector's wants against what
is held, and the mirror direction for a trade*, and *checklist gaps: what is missing from a
checklist, and which held copies would fill one*.

**There is no *read one want* operation.** A `list_wants` row is the whole want — its acceptance
sets, its urgency, its note, its catalogue range — so a detail verb would answer a question the row
already answers, and `stamp_id` narrows the list to one stamp's wants when that is what is wanted.

**And *the collector's wants against what is held* is answered by the row rather than by a verb**,
which is #710's own move said again: a holdings row states its own `location`, so there is no *where
is this copy* operation, and an unlisted-copy row states its own worth (#711), so there is no *what
is this copy worth* one. Every want row carries **two** tallies — `copiesOfStamp`, everything held
of the stamp whichever want it answers, and `copiesMatching`, only what would satisfy *this* want —
and **they are never merged** (#532): a used copy in the post satisfies a want for "anything" and a
mint-only want not at all, so one figure would tell a collector to stop chasing the mint copy they
were right to chase.

**`match_wants` is the mirror direction, and it takes one grade for a batch of stamps.** A want
accepts a *set* of grades, so *would I want this* is unanswerable about material whose grade is
unstated — hence `condition` is required — and the parameter types on this surface are scalars and
string lists rather than objects (#706), so a batch is *these stamps, in this grade* rather than a
list of rows. An agent asks twice for a partner offering some mint and some used.

**A stamp id that is not in this collection is refused rather than answered short.** A row simply
missing from the result would read as *not wanted*, which is the one wrong answer an agent cannot
tell from a right one. An empty `wants` array is the opposite: *no* is the answer that was asked for.

**And *which held copies would fill a checklist* is `list_holdings` with the same `issue_id`**
(#710), whose rows already state their copy ids, grades and filing places. `find_checklist_gaps`
answers the half that has no other home — which members are missing — and the result description
says where the other half lives.

### What an acceptance set says, and the one place this contradicts #710

**An empty acceptance set means *any*** (ADR-0032 §1), and that is the single most misreadable thing
about a want: an agent handed `"conditions": []` reads it as *accepts nothing* about half the time,
and then tells the collector that a want they can plainly satisfy cannot be. So an unnarrowed axis
comes back as `["(any)"]`.

**The null members are spelled rather than dropped, which is the opposite of what a copy does** —
`collection-reads.ts` drops a null certificate and a null format because on a copy the null *is* the
whole answer, so its absence says exactly what spelling it would. Here the null is **one member of a
set**, and dropping it changes the set outright: `{null, "PZF"}` means *uncertificated, or with a
PZF certificate*, and dropped it reads as *PZF only*, which is a different want. They are
`"(no certificate)"` and `"(single)"`, and **the parentheses are load-bearing**: nothing stops a
collector naming a certificate status `No certificate`, and a bare word would be indistinguishable
from that row's own name.

**The way to *send* those values is to leave the parameter out**, since a null certificate and a
null format have no dictionary row to name. The read spells them and the write omits them, and that
asymmetry is stated on both.

**"At least this grade" is inexpressible and is not missing** (ADR-0032 §1). `StampCondition.sortOrder`
is display order, `U` and `MNG` are cancellation and gum rather than two points on a scale, and
`CTO`/`FDC` are on no scale at all — so a minimum-quality rule would invent an ordering the
dictionary does not guarantee. An upgrade needs no concept of its own: a used copy against a
mint-only acceptance set simply does not satisfy the want.

**There is no price on a want and `catalogRange` is not one.** A max price was built and dropped
before it meant anything (`20260811140000_want_drop_max_price`), because a want has no date and a
figure on it is a price opinion frozen the day it was typed. The range is computed now, over the
combinations the want accepts, and **it never travels without `pricedCombinations` /
`acceptedCombinations`** — `valuation.md`'s standing rule, because a range built from one
combination in twenty-four is real and is not the whole story.

### The checklist gap is per checklist, and *already wanted* means something narrow

**Per checklist and never over an issue's merged membership** (#531, #661). Which member a variant
copy answers for is a question about *one* membership: a `226yw` copy answers the basic list as `226`
and the specialized one as itself. Asked of the union it would answer for the specialized list and
leave the basic list's umbrella looking missing — wanting a stamp the completeness card on the same
screen calls held.

**`alreadyWanted` means an open want on the same wide-open terms**, which is `wantGapForStamps`'s own
rule rather than a simplification of it: a second want for "anything" beside a want for "anything"
says nothing the first does not, while a mint-only want beside it is a *different intent* about one
stamp. Mirroring it here is what keeps this answer and the *add what is missing* button from
disagreeing, and the operation's result description says so in as many words so that an agent does
not read a marked-absent row as *nobody is looking for this*.

**There is no operation that creates, narrows or closes a want**, and that is absence rather than an
oversight. ADR-0032 §7 makes closing and narrowing the collector's decision at the moment a copy
reaches their hands — *nothing closes automatically, because that would discard a record of intent* —
and an agent is not that moment. The gap generator is the same decision one level up: a button the
collector presses on the completeness card, having looked at it.

## Working on trades

**Nine operations, answering the rest of the third workflow** (#712): *read an exchange, build both
its sides, and see whether it balances.* Five of them write.

| operation | writes | what it is for |
| --- | --- | --- |
| `list_trades` | no | the exchanges, narrowed to a stage, a partner or one trade number |
| `get_trade` | no | one exchange with its terms and its sections |
| `list_trade_lines` | no | one side of one section, each row with its own catalogue value |
| `get_trade_balance` | no | both sides in both valuations, the verdict, and what is blocking |
| `create_trade` | yes | a new **draft** exchange with one section |
| `add_trade_give_lines` | yes | promise particular copies |
| `serve_trade_requirement` | yes | *they asked for this stamp in this grade* — the resolver picks the copies |
| `add_trade_receive_lines` | yes | ask for a stamp, or a whole set, in a grade |
| `remove_trade_line` | yes | take a line off, which is the other half of making it balance |

**Everything here is `src/lib/` exposed rather than reinvented.** `create_trade` is `createTrade`;
the give verbs are `addTradeGiveLines` and `addTradeGiveLinesFromRequirement`; the receive verb is
`addTradeReceiveLines`; the balance is `readTradeBalance` whole. **Nothing here computes a figure or
decides a rule**, and one addition — `countTrades`, with `buildTradeListWhere` extracted so the
count and the page cannot narrow differently — went into `trades.ts` beside the read it belongs with.

**`list_trades` and `create_trade` are additions to the issue's verb list**, and both on grounds
#711 already settled. `search_collection` reaches stamps, issues and copies and nothing else, so
without `list_trades` every other verb here is callable only on a trade drafted in the same session
— `list_offers`' own argument. And the *Done when* asks the agent to leave a **drafted, balanced
trade behind**, which needs something to leave it on: `create_trade` is `draft_offer`'s analogue,
making a `preparing` trade with one section and nothing that reaches anybody.

### No operation sets a line's manual value, and that is a refinement rather than a gap

#712's *add and adjust trade lines* arguably asks for one, and two arguments keep it out.

**The decisive one is the contract at the top of this page.** `/api/v1` only ever grows: once an
operation is published its name, its parameters and the meaning of its answer are fixed, and a break
is `/api/v2`. The two directions are therefore **not symmetrical** — leaving it out is reversible
next week and publishing it is not — so absent a positive reason to ship it now, out. **The bound is
worth stating, because without it the argument refuses everything**: every operation here is equally
irreversible, so this decides nothing on its own. It decides *this* case because the positive reason
is weak, which is the second argument.

**And the second is what makes it weak.** `trades.md` keeps the manual value narrow on purpose —
*the default reflex stays type the price on the stamp*, a price being a property of the stamp rather
than of a line — so **an agent reaching for it would be an agent making the valuation gate pass
rather than making a trade balance**. The gate exists because a trade whose lines carry no figure
cannot be judged, and a typed number clears the refusal without answering it. `get_trade_balance`
names the blocking lines instead, so the agent hands them back and the collector prices the stamp;
the figure is then true on every screen rather than true inside one trade.

The same reasoning leaves out *restate a receive line*: removing and re-adding is the same act, and
the only thing lost is the line's `position`, which nothing sorts by — the screen groups rather than
ordering by hand (#637).

### A section is the unit, and the two sides are read one at a time

`list_trade_lines` takes a **section** and a **side**, which looks like a restriction and is the
model showing through. `listTradeLinePage` is per `(section, side)` by construction, because the two
sides are **two independent bags with no pairing between them** (ADR-0039 §2) and a section is the
unit a collector reasons in. Reading a whole trade in one call would mean writing domain logic in an
operation, which is exactly what this page forbids. `get_trade` lists the sections with their ids
and their counts, so the agent knows how many calls that is — usually two.

**It is read flat, with no grouping levels.** The screen nests by area › year › issue › grade because
a collector reads a column; an agent reads rows, and every heading would be paid for twice.

**A give row names a copy and a receive row does not**, and rendering the second as a copy row would
print an empty copy number and five blank slots and call that consistency. A give line's `quantity`
is always 1 — a multiple is one copy in one format, never N singles (ADR-0020) — and a receive
line's is any number, which is why a section's `receivePieces` and `receiveLines` are two figures.

**`fulfillment` is read and never written.** Recording what actually moved is after the handshake
and is past this surface's boundary, so every line reads `pending` until the collector says
otherwise on their own screen.

### The row states its worth and the balance states the judgement

**A line row carries its own `catalogValue`, per piece**, and carries no verdict; `get_trade_balance`
carries the totals, the verdicts and the blockers and does **not** repeat the per-line figures. Two
readings of one question in two responses is how they come to disagree, and the balance read's own
`lines` array is unpaged besides, which the cursor convention forbids.

**The two valuations are never merged** (ADR-0039 §7). `own` is the collector's own figure in the
collection's `baseCurrency` and `agreed` is the figure in the catalogue both sides named, in
`tradeCurrency`. Two fields of two units, labelled apart wherever both appear, because the failure
the whole engine exists to prevent is somebody one day adding 340 to 78.

**A missing figure is counted, never summed as zero.** `ownMissing` is what the gates refuse on, and
a total that quietly assumed nought would read as an answer while being a guess.

**Both modes are computed and `balanceBy` says which is the verdict.** The piece count is a fact
whatever the trade is judged on, and the own-valuation skew is computed in **both**, because *am I
giving away a thousand for ten* is a question a piece-count trade gets wrong just as easily.
`ownWarn` is a **warning and never a block**: a deliberately uneven exchange is a normal thing.

**`blockers` names the lines by id**, and is empty-lined for the one fault that is the trade's rather
than any line's — a value-balanced trade naming no agreed catalogue, which `create_trade` refuses up
front rather than leaving to the first balance read.

### What the projection drops, and why that is the guard

**`get_trade` does not carry the trade's share block.** `TradeData.share` holds the address the
partner opens the list at (#640), and handing an agent that address would hand it the one thing this
issue's boundary exists to keep out of reach — a `where` and a `select` are depth behind a mapper
that names its fields, which is #708's measured lesson about the platform vocabulary. **Do not
replace that mapper with a spread**, and the integration suite mints a real share token and searches
the whole response for it rather than testing a fixture that never had one.

**The agreed catalogue is named by its canonical name in all three places, and that was a real
disagreement rather than a tidy-up.** `TradeData.catalogVendorName` is the vendor's **abbreviation**
(`Mi`) because that is what a trades row has room for; `TradeBalanceRead.agreedCatalogVendorName` is
the vendor's `name` (`Michel`). Published as they stood, `get_trade` and `get_trade_balance` would
have called one catalogue two different things, and neither would have been the value
`get_collection_vocabulary` tells the agent to send back (#708: `name` is the canonical value). It
is resolved off the vocabulary in the operation. **Found by the integration suite disagreeing with
itself**, which is the argument for a test that reads two operations' answers in one sequence rather
than asserting each alone.

### Refusals, and the one place this differs from #711

#711 had `OfferActionBlockedError` to catch. **The trade domain throws a plain `Error` with a
sentence written for a collector**, and #706 deliberately does not relay one of those — an internal
message may carry an internal identifier and spends an agent's context on a sentence it cannot act
on. So the inputs an agent controls are checked in the operation, against the domain's own **pure**
answers: `isTradeContentEditable` for the lock, `resolveVocabularyValue` for every dictionary value,
and a collection-scoped `findFirst` for every id. That is not a second rule; it is the same rule read
early so the refusal can be written for the caller, which is `set_offer_text`'s `regeneratable`
pre-check said again.

**The lock refusal names the step that would unfreeze it and says the agent cannot take it.** From
`agreed` the list is what two people shook hands on, and reopening it is the collector's decision.

### Silence means two opposite things on the two write paths, and both are the domain's

**On `serve_trade_requirement` an unstated certificate or format means *anything will do***; on
`add_trade_receive_lines` it means **no certificate** and **single**. That looks like an
inconsistency and is the difference between the two acts. A requirement **narrows a search** over
copies the collection holds, and a wish list that says nothing about a certificate would refuse a
certificated copy the partner would have been delighted with (#659's `GiveAxisNarrowing`, whose three
states exist for exactly this). A receive line **describes a piece**, and there a null *is* a value —
"no certificate" (ADR-0006 §2) and "single" (ADR-0020). Both are stated on the parameters rather than
left to be inferred.

### A gap is an outcome, not an error

`serve_trade_requirement` reports every requirement's own outcome — requested, served, missing —
**including the ones nothing served** (#659). *You do not hold this in this grade* is what the
collector sends back to the partner, and on an imported wish list it is the main output. A refused
copy comes off the resolution that chose it, so the report says *served 2 of 3* rather than claiming
a line that does not exist.

**Which copy goes is #659's order and never the agent's**: one already marked for trade, then a plain
single, then one with a picture, then the lowest copy number. N takes N distinct copies and no copy
serves two requirements. An agent choosing for itself would be a second ranking rule, and a bad trade
is what a wrong one costs.

## Deciding whether an auction is worth looking at

**One operation, answering a fourth workflow — and the first that is a query about something the
collection does not hold** (#1168). `recommend_bid` is `read` scope and writes nothing.

| operation | writes | what it is for |
| --- | --- | --- |
| `recommend_bid` | no | what a described lot would be worth bidding, before any of it exists here |

**The workflow decides the shape, and it is worth stating before the mechanics.** The agent is at an
auctioneer's page. Nothing exists in Stamporama — no lot, no sale, no `AuctionLotLine` — and it has
the description of a stamp and an opening price. It wants one thing: **if the opening price is above
the recommendation, drop it and move on.** So this is a **stateless query** rather than a read of a
record, and `writes: false` is literal — it stores nothing at all, not even the question.

### Why the agent must not do this arithmetic itself

`find_unlisted_copies` hands it `catalogValue` and `marketValue` and its own description says what
they are: *"they answer different questions, so both are given and neither is a recommendation."* A
bid recommendation is arithmetic **over** those — an anchor per line, quantity multiplying it
(ADR-0020), a band in percent of the fair figure (#508), and the buyer's premium subtracted to get
from an all-in valuation to the hammer price that may be typed. An agent reconstructing that from
two numbers would be **a second valuation rule beside the existing one**, which is this page's own
prohibition and the defect class no test can see.

### It is lot-free by extraction, not by copying

**`auction-lot-anchors.ts` was keyed on lots and is not any more.** `resolveAuctionLotAnchors` and
`valuateAuctionLotLines` both took lot ids, and the tempting answer — a parallel lot-free path — is
exactly the second anchoring rule the issue forbids. What was done instead:

- **`lotLineValueOf`** (pure, `auction-lot.ts`) is the three-outcome catalogue rule — *unpriced*, a
  figure, and *unconvertible* — stated **once**. Both `valuateAuctionLotLines` and the lot-free
  `valuateLineSpecs` call it. It is three lines of arithmetic and it is extracted because it is the
  whole of the valuation rule sitting above `valuateItemRows`: a second copy is how one surface
  comes to call a line unpriced while the other calls it unconvertible.
- **`AnchorableLine`** (`auction-lines.ts`) is what the anchoring rule actually reads off a line —
  a `stamp × condition × certificate × format × quantity` with its catalogue value resolved.
  `AuctionLotLineItem` **extends** it rather than merely resembling it, so the fit is a compile
  error away rather than a coincidence.
- **`loadAnchorContext` + `anchorLine`** are `resolveAuctionLotAnchors`'s own body, lifted. The lots
  screen goes through them and so does the agent. **Batching is unchanged**: one market read, one
  rate map, one ratio load and one ownership count cover a whole page of lots, which a
  per-composition extraction would have turned into four queries per row.
- **`recommendBid` is reused unchanged.** It was already pure and already lot-free — `BidLine` is
  `{quantity, anchor, source, unconvertible}` and names no record — which is what made this issue
  cheap.

**The point is not tidiness.** If the agent's answer and the lot row's answer could diverge, nothing
would ever go red over it. One function is the only form of that guarantee this repository can have.

### The four questions the issue named, and what each was answered with

**Currency: the caller names one, defaulting to the collection's base currency.** The three figures
are all-in in *some* currency and the fees are in that same one, so answering in the base currency
about a house listing in EUR would be arithmetic on nothing. Base is the default because it always
has a rate and because it is the one currency `get_collection_vocabulary` already hands over as a
scalar. **`unconvertible` survives it and is not collapsed into *no price***: a market median with
no rate into the currency asked for is reported unconvertible, exactly as a sale currency with no
rate behaves on the lots screen.

**One rate does both halves, which is worth saying because ADR-0029 §5 invites reading it as two
rules.** §5 says catalogue anchors need no conversion because they already roll up in the sale's
currency — true of `auction-lot-anchors.ts`, and true because `valuateAuctionLotLines` has *already*
applied that same base → target rate by the time a line arrives. It is a statement about that module
rather than about the pipeline, and the lot-free path applies the rate in the same place.

**Fees: two optional parameters, and the answer echoes what it used.** With no premium,
`maxBidWithin` returns the all-in figure itself, so `bid` equals `allIn` and an agent reading only
the hammer price would bid the whole fair valuation and pay the premium on top — **omitting fees
overstates what may be bid**, which is the wrong direction for a control whose job is to say *do not
bother*. It cannot be defaulted: there is no sale, and the only place a premium lives is the seller,
which would mean naming one. Requiring it would make an agent invent a number it does not have. So
the answer carries `premiumPercent` / `premiumFixed` back, and **the overstatement stops being
silent**, which is the half that was actually wrong. No shipping parameter — `recommendBid` strips
it deliberately, a parcel shipping once however many lots are in it.

**Naming the stamp: `search_collection`, and #708's resolver is not the route for this half.** The
issue points at #708's name-or-id resolver, and it is right about three of the four axes and wrong
about the fourth. #708 resolves per-collection, **cuid-keyed vocabularies**; a stamp is not one of
them and has no entry to match a name against. The established route for a stamp id here is
`search_collection` (#710) — what `list_wants`, `match_wants`, `list_holdings` and
`find_checklist_gaps` all say — and it searches catalogue numbers over free text, which is exactly
what the agent holds at an auctioneer's page. `resolveVocabularyValue` owns the grade, the
certificate and the format.

**Several lines, in `match_wants`' shape.** An auction lot is usually a run, `recommendBid` takes a
list and ADR-0029 §6 makes a lot the sum of its lines. #706 keeps parameter types to scalars and
string lists, so a per-line object would mean widening `ParameterType` across four modules for one
operation; `match_wants` met the identical problem and answered it with a list of stamps at one
stated grade, and this takes the same shape plus a `quantity` applying to each.

**What that cannot express is a lot mixing grades, and it is said on the operation rather than left
to be found** — `agent-api.md`'s own move for *"at least this grade" is inexpressible and is not
missing*. It also cannot be worked around by calling twice and adding: **a fixed premium is charged
once per lot, so two answers are not additive.** Both sentences are in the result description,
because that is what a model actually reads.

### A grade the description does not settle is a range, never a guess (#1623)

A listing often does not say the grade: *Czysty* (unused) is MNH or MH, and the two can differ
twofold. So the grade can be said **one of three ways, and exactly one**: `condition` (one grade),
`possible_conditions` (two or more — a set of one is that grade) or `condition_unknown=true` (any of
the collection's grades). Neither is refused for being vague; sending none, or two, is.
`condition` went from required to optional for it — a loosening, so every call that worked still
works, which is `/api/v1`'s only-grows rule.

**The answer is the lot screen's own range** (`lotLineRangeOf` in `auction-lot.ts`, `anchorLine`):
each line is anchored **at each grade it may be in**, by the one anchoring rule, and the plain
`floor` / `fair` / `walkAway` are the **low end** — the cautious figure an opening price is compared
with — while `high` holds the same three at the top. Each line names its `possibleConditions` and
carries `unitValueHigh`. A grade nothing prices is left out of the range rather than emptying it,
the rule the collector chose for the catalogue range on 2026-10-04. `high` is absent when the answer
is one figure, so a caller that never sends a set sees exactly the shape it always did.

### The three unanswerable cases stay three answers

This is the requirement the whole response shape is built around, and `BidRecommendation` already
separated them — what #1168 had to do was carry the distinction out to the wire and into the
`description`:

- **no anchor at all** — `unanchoredLines`. Nothing prices the key and nothing was ever recorded
  against it. The anchored lines still sum, and the count is what says the total is partial.
- **an anchor with no rate** — `unconvertibleLines`. There *is* a figure and it cannot be stated in
  the currency asked for. Calling it unpriced would send the collector off to enter a value that
  already exists, which is the distinction `LotLineValue.unconvertible` has carried since #353.
- **a figure the fees alone consume** — a level whose `allIn` is stated and whose `bid` is
  **absent**. It is a real answer and emphatically not a zero: at that premium no hammer price stays
  inside the figure, which is the clearest *do not bother* there is and would read as *bid nothing*
  at `0.00`.

A fourth case looks like one of these and is not: **no line anchored at all**, where `fair` is null
outright and all three levels are absent. ADR-0029 §1 is explicit that a lot whose composition is
entered but unpriceable is *unanswered, not worthless*.

**And a stamp that is not in this collection is refused rather than dropped.** A line silently
missing from the sum would make `fair` read as the lot's worth while describing a smaller lot —
`match_wants`' own rule and #710's *a scope that names nothing is a refusal, never an empty answer*,
with the refusal naming `search_collection`.

### What it deliberately is not

**It creates nothing.** No lot, no sale, no `AuctionLotLine` — *this workflow exists precisely
because none of that has happened yet*. *There is no operation that reads existing lots and their
recommendations either; exposing the auctions area to the agent is #1036 and is a separate and
larger question* — quoted, because #1036 has since landed, narrowed by the collector to three reads
that state no recommendation (*Following the auctions already tracked*, below). And nothing here
changes how the lot screen computes its own figures — it now
computes them through two functions that were lifted out of it, and the figures are the same ones.

## Following the auctions already tracked

**Three operations, and all three read** (#1036). The agent's first consumer reads a daily mail of
new Allegro listings, and until #1036 it could not tell a listing it reported yesterday from a new
one, could not say where the collector's open bids stood, and recommended the tenth lot as readily
as the first because it did not know what was already committed.

| operation | writes | what it is for |
| --- | --- | --- |
| `list_auction_watchlist` | no | the open lots: closing time, the auction's bid, the collector's bid and ceiling, leading or outbid, and whether a condition is still to settle |
| `summarize_auction_exposure` | no | what those lots can cost — *Committed* and *At ceiling*, in the base currency |
| `find_tracked_auction_lots` | no | links or offer numbers in; *tracked*, *not tracked* or *unrecognized*, and which lot, out |

**Everything here is `src/lib/` exposed rather than reinvented, and for these three that is the
requirement rather than the habit.** The issue says an agent and the screen must not be able to
disagree, so they are `listAuctionLots` + `countAuctionLots`, `auctionLotExposure` and
`findLotsForListings` whole — the reads the lots list, its exposure bar and the Assistant's chip on a
listing page (#575) are drawn from. `auction-reads.ts` names their answers for a model and computes
no amount; the one thing it evaluates is `lotHasSignal`, the toolbar's own predicate over the row's
own figures. `tests/integration/agent-api-auctions.test.ts` compares each answer with its screen's
read **and** with the fixture's figures worked by hand, because two paths through one broken rule
still agree.

**Its fixture keeps every exposure count distinct, and that was found rather than planned.** With one
uncapped lot and one outpriced one, crossing the two counts over in the projection left every
assertion green; a fifth lot was added so the swap turns the suite red, which it now does.

### The range on the watchlist (#1623)

A lot line's condition can be unknown or one of several, and such a lot is **condition to settle**.
`list_auction_watchlist` reports it so the assistant can tell a lot it valued on a guess from one it
valued on a description: `conditionToSettle` on every lot, `unsettledLines` naming each such line
with its `possibleConditions` (or `conditionUnknown`), and the two figures a range touches —
`catalogueValue` and `recommended` (the row's own `fair`, all-in with its bid) at the **low end**,
`catalogueValueHigh` and `recommendedHigh` at the top. They are `AuctionLotListItem`'s own fields,
named, so the agent and the row cannot disagree. Adding the recommendation here is not a reversal of
#1036's narrowing: that issue dropped it from scope because #1168 had delivered `recommend_bid`, and a
range has no meaning without the figure it is a range of.

### Read only, and the boundary is a third one

**#1627 opened this boundary for the register, and only for it** — see *Keeping the auction register*
below — and #1628 opened recording how an auction ended, through a writer of its own. What follows
is #1036's reasoning as it stood, kept because the half about bidding, reopening and settling still
holds: those stay closed, and `AUCTION_WRITES` still names every screen writer.

**No lot is created, and nothing is bid, edited or closed** (the collector, 2026-09-10: *the agent
only reads from Stamporama — it does not create auctions automatically, at least at this stage*).
Adding a listing to the watchlist stays the collector's decision in the app, after reading the
report. It is kept the way the other two boundaries are — by absence, checked twice:
`tests/integration/agent-api-auctions.test.ts` requires every operation under `/auctions` to be a
`GET` declaring `writes: false` and fails on a write-shaped auction **name** anywhere in the
registry, and `tests/unit/agent-api-operation-boundary.test.ts` fails on an operation module
**importing** any of the writers in `auctions.ts`.

**That import map is `AUCTION_WRITES`, beside `FORBIDDEN` and not inside it**, for the reason
`getOfferListingKit` and `deleteTrade` were left off `FORBIDDEN`. That map is *the acts that go
public or reach somebody else*; writing a lot reaches nobody, and is forbidden only because the
collector decided the agent reads. A list that means two things is one a later reader cannot add to
correctly, so the new one has a plain rule — *anything in `auctions.ts` that writes* — and checks that
every name on it is still a real export, so a renamed writer cannot leave a row guarding nothing.
`captureAuctionLot` is on it although its dry run is a read, because an import cannot say which way
it will be called.

### What the agent writes to auctions waits for review, and that boundary does not open

**#1626 laid the marker the auction writes (#1627, #1628) are bound by, before any of them exists.**
The collector accepts an assistant writing lots only if everything it created or changed is visibly
waiting for review, and that has to be enforced rather than left to a tag the assistant could
forget. So `AuctionLot` and `AuctionSale` carry a *to review* marker (`auctions.md`), and two rules
hold for every auction write this surface will ever make:

- **Every write marks what it touched** — a lot's current bid alone excepted (#1652, *A write marks
  what actually changed*) — in the write's own transaction, through
  `markAuctionLotWrittenByApi` / `markAuctionSaleWrittenByApi` with `{ kind: "created" }` or
  `{ kind: "changed", fields }`. The field keys are `AUCTION_LOT_REVIEW_FIELD_LABEL` /
  `AUCTION_SALE_REVIEW_FIELD_LABEL` in `auction-review.ts`, which word the chip's hint; a key not on
  them still shows, as itself. A lot written into a sale marks the lot, and the sale shows it by its
  count; a sale the API starts or whose terms it changes is marked itself.
- **Nothing reachable from an agent clears it.** That is `REVIEW_CLEARERS` in
  `tests/unit/agent-api-operation-boundary.test.ts` — `confirmAuctionLotReviews`,
  `confirmAuctionSaleReview` and `CONFIRMED_API_REVIEW` — and it is **a map of its own on purpose**:
  *#1627 takes writers off `AUCTION_WRITES` as it opens them* was the expectation, and this map is
  the half that must not go with them. #1627 in fact took none off — it added writers of its own
  that mark (*Keeping the auction register*) — and this map is unchanged. An operation able to clear the marker could hide its own work from the review it is
  waiting for, which is `markOfferListingSynced`'s shape in `FORBIDDEN`.

### One watchlist, and it is the screen's default

The list and the exposure both read the lots screen **with nothing narrowed**: open lots, soonest
closing first (#504). So the two describe one set of lots, and the exposure matches the bar the
collector sees on opening the screen. **No filter is published**, on the argument this page makes
for leaving a trade line's manual value out: `/api/v1` only grows, so a parameter left out is
reversible next week and one published is not, and nothing in the workflow needed one. A closed lot
is filed rather than followed; its outcome is what `find_tracked_auction_lots` reports when its
listing turns up again.

**A row states the three amounts apart** — the auction's `currentBid` (an observation, dated by
`checkedAt`), the collector's `myBid` (a proxy maximum, a commitment) and `ceiling` (a private
valuation, already all-in) — which is `auctions.md`'s rule that the three are constantly confused and
must not be merged. `ceiling` is the one the lot is **held to** (#1515): unless `ceilingSetApart`, it follows the bid and is `myBidAllIn`. `ceilingBid` is the screen's `bidRoom`. `ended` says the closing time has passed
with nothing recorded, and there `standing` is where the bidding was last seen rather than a result —
the screen's *Won?* with its question mark. `overCeiling: false` survives and an unrecorded
comparison is absent, which is the row's own three states. `notStamps` (#1624) is always present,
`false` included, because a lot with no stamps listed means something different with it set: the lot
is literature or an accessory and has nothing to describe, not a lot still to be described.
`find_tracked_auction_lots` carries the same mark on a `tracked` answer.

**A lot's tags are reported by name** (#1625), on a watchlist row and on a `tracked` listing alike —
`tags: string[]`, always present on the row, empty when there are none, as `signals` is. Names and
not ids: no operation takes a tag id, and a colour is how a chip is drawn. They come off the same
`TagSummary[]` the lot row carries for the screens, in the dictionary's order. No tag filter is
published on the watchlist, on the argument the paragraph above makes for every filter.

**The exposure counts travel with the totals, zeros included** (`valuation.md`): `uncappedLots`
reads the totals low, `outpricedLots` is correctly costed at nothing (#600), and
`unconvertibleLots` is left out rather than added at par.

### Already tracked is the Assistant's lookup, answered for every listing

`findLotsForListings` is what the extension asks on a listing page, so an agent and the chip cannot
disagree about whether a listing is watched. Two things were added around it, and neither is a
second matching rule:

- **A link is read at the matching rule's own boundaries.** `platformOfferIdFromUrl` sits in
  `platform-offer-url.ts` beside the two readings it inverts — `offerId=` first, then the digits
  ending the path after a `/` or `-`, the query and fragment dropped — so a link resolves to exactly
  the id a stored address would be found under. The unit suite checks that property directly.
- **Every listing is answered, in order.** The domain lookup leaves a miss out, which is right for a
  chip that draws nothing. An agent reading a batch cannot tell a listing left out from one never
  asked about, so a miss is `not_tracked`, and a string with no offer number in it is `unrecognized`
  — nothing was looked up, which is a different answer from *no*.

**A house's catalogue position is not an offer number and is never matched** — #575's rule
unchanged: a stored `lotNo` is read as an offer number only on the collection's Allegro platform. So
the operation answers the Allegro mail it was built for, and a house listing only through the address
stored on its lot. Widening that would be a platform-scoped lot-number rule, which is a product
decision rather than a parameter. **The batch cap is `AUCTION_LOT_LISTING_LOOKUP_LIMIT`, refused
above it**, because the domain lookup slices there silently and a listing past the cut would come
back `not_tracked` — a confident answer to a question nothing asked.

**One wrinkle of the parameter surface is stated on the operation rather than fixed**: a `string[]`
query parameter is split on commas (#706), so a link with a comma in its query string splits in two.
The parameter tells the agent to send a link without its query string, where the offer number never
is.

## Keeping the auction register

**Six operations, and all six write** (#1627, #1628): once the collector decides to bid on a listing the
assistant found, the assistant enters the lot instead of the collector retyping it — the sale, the
lot, its stamps, its tags and its ceiling — and keeps it current.

| operation | writes | what it is for |
| --- | --- | --- |
| `add_auction_lot` | yes | a lot, joining or starting its sale by the capture's rule, with lines, tags and ceiling |
| `update_auction_lot` | yes | correct a lot; record what the auction stands at, with when it was checked |
| `set_auction_lot_lines` | yes | replace what a lot holds |
| `set_auction_lot_ceiling` | yes | set or clear the ceiling set apart, with a note on how it was reached |
| `update_auction_sale` | yes | a sale's terms: name, address, closing time, currency, premium, shipping |
| `record_auction_lot_outcome` | yes | close a lot with its final price, or without one, or cancel it (#1628) |

**The API keeps the register and never bids** (the collector, 2026-10-04). Nothing writes `myBid` —
the bid the collector places by hand on the platform — and nothing reaches a platform; outcomes are
recorded by #1628's rules, below. That is held three ways: the integration suite pins the exact list of auction writes and fails
on any parameter named for a bid, and `tests/unit/agent-api-operation-boundary.test.ts` reads each
writer's body and fails if it mentions `myBid`.

**The writers are the API's own, and each marks what it touched.** `auctions.ts` carries
`addAuctionLotThroughApi`, `updateAuctionLotThroughApi`, `replaceAuctionLotLinesThroughApi`,
`setAuctionLotCeilingThroughApi`, `updateAuctionSaleThroughApi` and (#1628)
`recordAuctionLotOutcomeThroughApi` — `AUCTION_API_WRITES` in the
boundary test, reachable from `operations/auction-writes.ts` alone — and every one sets the *to review*
marker (#1626) **in its own transaction**, which the boundary test checks by reading each body for a
`markAuction…WrittenByApi(tx,` call. **No screen writer left `AUCTION_WRITES`**, which is not what
#1626 expected: the screen's writers do not mark, so opening them would have made the marker a
convention every handler had to remember. The test also sweeps `auctions.ts` for every writer by
verb and requires each on one map or the other — which is how `setAuctionLotMyBidAndCeiling` (#1515)
was found missing from `AUCTION_WRITES`, where it now is. A sale started by an add is created inside
the add's transaction (`newAuctionSaleData` is `createAuctionSale`'s seeding, split out), and the tags
go through `replaceAuctionLotTagsTx`, the lot dialog's replace taking the caller's transaction.

**There is no `upsert_auction_sale`, because a sale has no natural key but the capture has the rule.**
A lot names its platform and seller and **joins or starts** the sale as the Assistant's capture and
the *Add lot* form do (#352, #742): where the platform's marketplace marker says the parcel is the
house's named sale (`captureModuleRules(…).parcelIsNamedSale`, Philasearch), the open sale **of
`sale_name`** on that platform, whose seller the lot takes; elsewhere the seller's open sale on the
platform. A sale started this way is seeded from the seller's defaults like any other, and the
answer says `saleCreated`. A platform no module captures from follows the basket rule. A lot's
closing time falls back to the sale's — a house sale's lots share one — and is refused when neither
has one. A sale is edited on its own only for its terms; its parties and status are not reachable.

**A listing already tracked is refused with the lot that has it** (`findLotTrackingListing`), so a
second add never makes a duplicate, and the same check refuses an `update_auction_lot` that would give
a lot another lot's listing. Where the platform's lot number **is** the listing's id (Allegro), it is
`find_tracked_auction_lots`' rule: the offer number — read off the link sent, or sent as the number —
stored as a lot number on that platform, or inside any stored address at the address's boundaries.
Elsewhere a lot number is a house's catalogue position and is matched **within the sale** the lot
joins, and an address only as itself: a house's address may end in a digit run another house's
shares, and a false match here would refuse a lot nobody tracks. The refusal is `invalid_request`
with the lot's id in `accepted`.

**A line is a `name=value` string, `set_catalog_prices`' grammar with the line's fields** —
`"stamp=Mi 309; condition=MNH|MH; quantity=2"` — since a parameter is a scalar or a string list
(#706). The grade is one of three, never a guess (#1623): one (`MNH`), the grades it may be in
separated by `|`, or `unknown`. The certificate and format default to none and the single, matched
as keywords only when no row answers (`resolveAxisValue`), and the stamp is an id, a short number or
a catalogue number through `resolveStampRefMap` — `resolveStampRefs` answered per reference. **One
line that does not parse or resolve refuses the call**, as the catalogue writes do: a lot's lines are
its whole contents, unlike a page of prices. At most 100 lines a call.

**The ceiling is the one set apart (#1515), and its note is a column of its own** — the collector's
choice on 2026-10-04 over the lot's notes. `AuctionLot.ceilingNote` explains `maxBid` and nothing
else: written with it here, cleared with it, and cleared by any screen write that changes `maxBid`
(`ceilingNoteAfter` in `setAuctionLotMaxBid`, `setAuctionLotMyBidAndCeiling` and `updateAuctionLot`),
so it never explains a figure it was not written for. The row's ceiling hint shows it; the watchlist
reports it as `ceilingNote`.

**A write marks what actually changed.** `update_auction_lot` and `update_auction_sale` compare what
was sent with what is stored and name only the differences — in `AUCTION_LOT_REVIEW_FIELD_LABEL` /
`AUCTION_SALE_REVIEW_FIELD_LABEL`'s keys, the two premium components being one term — and a call
that changes nothing writes and marks nothing, answering `changed: []`. A current bid always counts:
it dates a fresh look even when the figure has not moved (`checked_at`, defaulting to now, refused
in the future). A settled lot takes only its tags, which settlement did not transcribe (#1625).

**A current bid is recorded and never marks** (#1652, the collector, 2026-10-05; amends #1626 and
#1627, where every API write marked). It is an observation, not a decision — the Assistant's capture
refreshes it with no marker — and an assistant refreshing its watched lots daily left nearly every
one waiting for review, so the marker stopped singling out what the assistant had decided. So
`changed` still lists `currentBid` whenever one is sent, but the marker takes the call's other fields
only (`lotReviewFields`, `AUCTION_LOT_UNMARKED_FIELDS` in `auction-review.ts`): a refresh alone leaves
the lot's marker exactly as it was, neither set nor cleared, and a call that also changes another
field marks that field alone, so the hint names only it. The refresh stays visible as the bid's age
on the row. `currentBid` keeps its label in `AUCTION_LOT_REVIEW_FIELD_LABEL` for markers set before
the change. The boundary test's *marks in its transaction* still reads the writer, whose marking
call is now conditional.

**Names, never creations, for the parties.** A seller is resolved exactly (`resolveSellerParam`,
#1390's) and an unknown one is refused with close names, never created — `create_seller` is that
act, which is the opposite of the capture's `resolvePurchaseContact` and for the purchase writes'
reason. A tag name the collection lacks **is** created, as typing it into the lot's tag field does,
and must be one word, as that field takes it.

**A write answers with the lot as the watchlist states it**, plus `lines` and `toReview`, read back
through `getAuctionLotDetail` — `listAuctionLots`' row building for one lot — so an answer and
`list_auction_watchlist` cannot disagree. The watchlist row gained `saleId` (what
`update_auction_sale` takes), `ceilingNote` and `toReview` with it.

### Recording how an auction ended (#1628)

**`record_auction_lot_outcome` does what *Close the lot* and *Mark as cancelled* do in the app, and
nothing past them.** It sends `status` — `closed` or `cancelled` — and for a closed lot the
`final_price` and, on a tie, `won_tie`. **Won or lost is never sent**: it is `lotOutcome` off the
money (`auctions.md`), and the answer reports the `outcome` read back through `getAuctionLotDetail`,
the row the lots screen draws, so the agent and the screen cannot disagree about one lot.

**The closing rules are the app's, by construction rather than by copy.** `recordAuctionLotTransition`'s
body was split into `lotTransitionData` — the two judgements (a price is required unless no bid was
placed, and a tie must be answered), the rate frozen with a recorded price, and `cancelled` clearing
price, rate and tie — and both the ⋮ menu's writer and `recordAuctionLotOutcomeThroughApi` call it.
That helper reads `myBid` to judge; the API writer's own body does not mention it, so the boundary
test's *never writes the collector's bid* still reads the writer and still holds. The integration
suite closes twin lots, one each way, over the same figures and compares the two outcomes.

**A lot that vanished from view is closed without a price only where the app allows it**: a lot the
collector never bid on (it reads `observed`). One they bid on is refused with `"final_price" is
required`, because the app refuses it — that outcome could not be read at all — and the refusal tells
the agent to leave the lot open, or that the collector clears their bid in the app. The API cannot
clear `myBid`, which is the *never bids* rule, so that way out stays the collector's.

**`open` is not a value it takes.** A closed lot is corrected — closing it again replaces its price
and re-freezes the rate, as the dialog's *Edit the final price* does — but reopened only in the app.
`won_tie` is ignored away from a tie, as the domain ignores it, and refused with `cancelled`, as is a
price. It marks `outcome` (already a key of `AUCTION_LOT_REVIEW_FIELD_LABEL` since #1626), and a call
recording what is already recorded writes and marks nothing, answering `changed: []`.

**It settles nothing.** A won lot stays won and unsettled: settling is per parcel, reviews the money
against the seller's invoice and asks each unsettled line's condition (#1623), and all three are the
collector's. `settleAuctionSale` stays on `AUCTION_WRITES`, as does `recordAuctionLotTransition`
itself, since it reopens. A settled lot is refused, as every API write to one is.

## Recording price observations (#1635)

**A realised price from someone else's auction is recorded, listed, corrected and deleted here**
(ADR-0063, ADR-0064). The bidding assistant reads results pages — Philasearch, a house's price list,
an ended Allegro offer — often hundreds for one field, so the write is a batch:

| operation | writes | what it is for |
| --- | --- | --- |
| `list_price_observations` | no | what is recorded, by stamp, area subtree, market, platform, house and sale days |
| `record_price_observations` | yes | a page of results, up to 100, each answered `recorded`, `duplicate` or `refused` |
| `update_price_observation` | yes | a correction, only what is sent; `clear` empties an optional field; `stamp` moves it |
| `delete_price_observation` | yes | one recorded by mistake |

**One observation is one `name=value` string**, the grammar of `set_catalog_prices` and the lot lines
(`agent-api/price-observations.ts`, pure): `stamp`, `price`, `sold_on` and `platform` required,
`currency` unless the house has a usual one. A piece with no `=` after `url` continues the address,
which may carry a `;`. **A batch answers per row and never fails whole over one** (#1540's rule).

**Every write is the Valuation dialog's own**, `createPriceObservation` / `updatePriceObservation`,
and every read is judged by its `toView` — so `counted`, `notCounted` and `doubts` mean in an answer
what they mean on the screen. A recorded row answers in `list_price_observations`' shape, so the
assistant learns at once whether it counts and why not.

**Nothing is guessed.** A stamp is named as every catalogue write names one — an id, `st 123`, or a
catalogue number in any catalogue through #1037's resolver (`resolveRowStamps`, answered per row
rather than refusing the call as `resolveStampRefMap` does). Ambiguous or unmatched refuses the row
with `unresolvedStampReason`'s sentence. A number that names an unknown-variant umbrella is recorded
**on the umbrella** — what the listing established — and is a hint by ADR-0063 §3's live read,
without the API having to say so. `condition=?` and `certificate=?` record the other two doubts.

**Contacts are matched, never created** — the collector's choice on #1635, #1627's rule. A platform
resolves by the vocabulary, a house by the address book (`resolveSeller`), and the domain is handed
ids alone, since its `resolvePurchaseContact` creates a contact from any name. The reason is the
market: a house naming none counts as the home market (ADR-0064 §2), so a German house created
silently would anchor Polish valuations. **`create_seller` grew `auction_house` and `market`** for
it, so the assistant adds a house with its country in one call. A house's premium, fee and usual
currency fill those a row leaves out (ADR-0063 §5).

**A source lot is recorded once**, in the domain and so in the dialog too: the same address, or the
same lot number in the same auction at the same house — at the same platform where there is no house
(an Allegro offer number). `DuplicatePriceObservationError` carries the existing id; a batch answers
`duplicate` with `duplicateOf`, a correction is refused with it. A row with neither address nor lot
number names no lot and duplicates nothing. Rows are written in order, so a batch repeating itself
meets the rule exactly as a page recorded yesterday does.

**Rates are looked up once per sale day and currency** within a batch (`ObservationRateCache`), the
grouping ADR-0063's *Consequences* asked for; a failed lookup is remembered for the batch too.

**The `market` filter is the market a result counts in**: the house's, else the platform's, else the
home market — so asking for the home market also finds results whose contacts name none, and the
query spells `resultMarket`'s order rather than filtering after the page.

**`recommend_bid` already lists its evidence** (#1634: `marketResults`, `notCounted`); #1635 adds each
result's `id`, so an observation a recommendation stood on can be corrected or deleted directly.

## A copy that is one of several stamps (#1651)

**A copy may be identified as a set of candidate stamps** (ADR-0065) — *Mi 123aI or 123bI*, or *Mi 85
or Mi 101* across two issues. The API covers it fully, and adds the surface's first write on a copy's
identity:

| operation | writes | what it is for |
| --- | --- | --- |
| `set_copy_stamp` | yes | one stamp, or two or more the copy might be — sets, narrows and settles a set |

**Every copy read reports a set the same way**, through one pure projection (`candidateSet` in
`agent-api/collection-reads.ts`): `candidates` carries a `label` (`candidateSetLabel`, the app's own
naming), each stamp with its catalogue labels, and either `sharedStampId` — one variant tree, the copy
counts as an umbrella copy of it — or `acrossTrees`. `variantToSettle` is true for an umbrella copy and
for a set. `get_copy`, `list_holdings`, `find_unlisted_copies` and `list_trade_lines`' give side carry
it; `get_offer`'s `copyLabels` name the set; the handler resolves each candidate's labels with
`candidateLabelsFor`. **The copy's own `stampId` stays where it is filed** — the shared ancestor, or the
first candidate across trees — and the OpenAPI description tells an agent never to report it as the
copy's identity.

**`set_copy_stamp` is `setCopyStamp`**, the one write the app's identification and settling use, so
its refusals are the app's sentences: an empty list, a stamp from elsewhere, a set on a copy carrying
several stamps. Every variant of one umbrella is stored as the umbrella. It creates no copy (#1390's
rule). A note rides into the refinement history when the copy is re-pointed.

**The rest follows the app's rules with nothing restated**: the valuation is `valuateItemRows`' (the
cheapest candidate, `sourceStampId` naming it), the market value `copyMarketMedian`'s (the lowest of
the candidates', and none while any has no evidence), `draft_offer` lists the copy under its cheapest
candidate because `resolveListingCatalogItemIds` does, and `serve_trade_requirement` and the trade
alternatives leave a set out through `excludeCandidateSets` — a requirement names one stamp, and a set
satisfies one only if every candidate would. `add_trade_give_lines` promises a copy, not a stamp, so a
set may be promised like any other piece. `list_holdings` and `summarize_valuation` share the scope
`variant_to_settle`.

## Entering purchases

**Eleven operations** (#1390): an order the agent has in front of it as text — an order
confirmation, an auction invoice, a seller's email — entered without the collector retyping it. Nine
of them write.

| operation | writes | what it is for |
| --- | --- | --- |
| `list_purchases` | no | purchases, narrowed to a seller, a span of dates or one purchase number |
| `get_purchase` | no | one purchase with its lots, its expenses and what it cost in both currencies |
| `create_seller` | yes | a contact for a seller the collection has never bought from |
| `create_purchase` | yes | the header: seller, platform, date, currency, shipping |
| `update_purchase` | yes | correct the header; only what is sent changes, `clear` empties a field |
| `add_purchase_lot` | yes | an open, empty, priced lot |
| `update_purchase_lot` | yes | rename or reprice an **open** lot |
| `remove_purchase_lot` | yes | take off a lot that is open, empty and on no other record |
| `add_purchase_expense` / `update_purchase_expense` / `remove_purchase_expense` | yes | the non-inventory lines |

**The boundary is the collector's, set on 2026-09-26: the purchase, and nothing past it.** No copies —
they enter the collection's counts, wants and values, which is the larger and riskier step — and
nothing irreversible: no closing or reopening a lot (closing freezes the cost basis, ADR-0009 §3.5),
no delivery status (arriving moves copies to *to sort*), no deleting a purchase. It is held the way
the other boundaries are, by absence, and checked by `tests/unit/agent-api-operation-boundary.test.ts`
(the imports) and `tests/integration/agent-api-purchases.test.ts` (the exact list of purchase
operations). **`deleteLot` is on the forbidden map although removing a lot is allowed**, because it
deletes the lot's copies with it; `remove_purchase_lot` goes through `lots.ts`'s `deleteEmptyLot`,
whose emptiness is part of the delete's own `where` rather than a check a copy could arrive after.

**Expenses had no writer anywhere until this issue.** `PurchaseExpense` has been in the schema since
ADR-0009 and the order total has counted it since #852, but nothing in the app could create one. The
issue's *everything the assistant writes can be seen and undone on the purchase's own screen* would
have been false for them, so the collector chose (2026-09-26) to give the order screen an Expenses
card in the same change, over `src/lib/purchase-expenses.ts` — one module for both the card and the
three verbs.

**A seller is matched first and created only on purpose.** `resolvePurchaseContact`, behind the
purchase form, creates a contact from any name it does not recognise — right for a person typing,
wrong here, where a misspelling would quietly become a second person. So every seller parameter is
resolved exactly by `resolveSeller` (an id, or a name or full name equal once case and space are set
aside), an ambiguous one is refused with the ids in `accepted` and the names in the sentence, and an
unknown one is refused with the **close** contacts named. `create_seller` is the separate act, and it
refuses a name close to an existing contact unless the agent sends `different_person: true`; a name
already filed is refused whatever it says. **Close** is `namesAreClose`: equal once accents and
punctuation are off, one inside the other at five letters or more, or one or two letters apart
scaled to the length — loose on purpose, because it only ever suggests and never resolves.
`resolvePurchaseContact` is on the forbidden map for that reason.

**A contact is two fields.** A marketplace seller is filed under their login (#463), so
`create_seller` writes the login as `name` and the name it was given as `fullName`; without a login,
the name is the name. Nothing reads or writes `email`, `phone` or `notes` (a contact has no address
field), and `updateContact` and `deleteContact` are on the forbidden map. The integration suite gives
a seller all three private fields and searches every answer it received for them.

**Money is the purchase screen's.** `get_purchase` states `PurchaseDetail.spend` and each
`LotSummary.spend` (#852) as `paid` and `base`; an order in a foreign currency with no frozen rate
has `base: null` and a `baseMissing` sentence, never a zero. Amounts are taken as strings to the
cent (`"12.50"`), the offer surface's convention, and a third decimal or a comma is refused rather
than rounded behind the agent's back. **Writes on a lot or an expense answer with that line and the
order's new `spend`**, not the whole purchase: an auction settlement can carry forty lots, and the
shipping split every one of them moves is what the agent needs to read back.

**The incoming half of a trade is read and never written.** Its lot prices are the carried-over
cost basis of the copies that went the other way (#644), kept in step by `syncTradePurchasePool` —
not money anybody paid — so every write refuses it and `get_purchase` says `editable: false`.
**Opening balances are not reachable at all**: they are rows of the same table, and `assertPurchase`
answers one as not found (#1321 is its own track).

**`update_purchase` restates the delivery status as it stands.** `updatePurchase` replaces the whole
header and would otherwise write `preparing` over an order in transit; the integration suite moves
one to `in_transit` first and checks it stays there.

**One guard elsewhere had to learn the difference between two lots.** `agent-api-auctions.test.ts`
read any write verb beside the word `lot` as a write to the auction watchlist, which
`add_purchase_lot` is not. A name carrying `purchase` is now judged by its other words, so
`add_purchase_auction_lot` would still be caught, and the test says both.

## Stamp sizes and presets

**Seven operations** (#1415): a size an assistant reads in a catalogue or a dealer's list, put on a
series without retyping it stamp by stamp. Four of them write.

| operation | writes | what it is for |
| --- | --- | --- |
| `list_size_presets` | no | the presets, in the collector's dragged order |
| `get_stamp_size` | no | one stamp's own figures and where its size comes from |
| `create_size_preset` / `update_size_preset` | yes | a preset, under the Settings panel's rules (#804) |
| `set_stamp_size` | yes | one stamp, through the album editor's one-box write (#1309) |
| `preview_stamp_size_apply` | no | the apply dialog's counts, writing nothing (`GET /stamp-sizes/apply`) |
| `apply_stamp_size` | yes | the apply dialog's write, to an issue, a checklist or a list (`POST` on the same path) |

**Every write is the app's, and that is the safety argument.** A preset goes through
`stamp-size-presets.ts`, one stamp through `writeMeasuredStampSize` — whose *a stated size is never
replaced silently* is a server-side gate (#1290), so `overwrite` is its `replace` — and an apply
through `applyStampSizePreset` / `applyStampSize`, with the dialog's skip-by-default, variant
subtree and counts (ADR-0048 §6, §7). Nothing here decides which stamps a write reaches. The
preview is its own operation rather than a flag on the apply because `writes` is per operation, and
the collector wanted a `read` token able to ask for one; it answers with
`describeStampSizePresetApply`'s own sentences, so the counts an agent reports are the dialog's.

**The issue expected a source this schema does not have.** #1415 asked for a read that tells
*stated*, *measured at a scale* and *inherited* apart, and for the assistant's writes to be recorded
*as typed, never as measured*. There is no *measured* flag — #763 refused one and ADR-0048 §1 a
preset reference — so a figure measured, typed or applied is the same two columns. `get_stamp_size`
says `stated`, `inherited` or `none`, and a written size is an ordinary stated one, which is all
*recorded as typed* can mean. Adding the flag would be a schema decision against two ADRs, not
something this surface could quietly grow.

**An inherited size is answered per checklist.** `get_stamp_size` runs `resolveStampSize` over each
checklist the stamp is on, in catalog sort order — `album-plan.ts`'s ordering, so it reads the
figure an album page built from that checklist draws — and returns one row for each that lends a
figure, naming the stamp it is borrowed from. A stamp on two checklists can borrow two figures, and
picking one would be a rule the album does not have. Half a size is not a size (#763): a stamp
stating only a width is `inherited` or `none`, its half figure beside the answer.

**Stamps are named by id or catalogue number, through #1037's resolver.** `resolveCatalogStrings`
was lifted out of `resolve_catalog_numbers` for this, so a number cannot resolve one way there and
another here. A number that is not exactly one stamp refuses the **whole** call, every failure named
and every ambiguous candidate's id in `accepted` (`unresolvedStamps`); a list of forty with three
bad entries is corrected in one turn, and nothing is written from the other thirty-seven.

**Figures are strings to a tenth, refused rather than rounded** — `"21.5"`, a comma read as a point
as the form reads one. `parseSizeMm` rounds a second decimal away, which is right for a field the
collector sees and wrong for an agent that would report the unrounded figure as written; it is the
purchase surface's convention for amounts (#1390).

**No preset is deleted or reordered.** Deleting was not asked for and is a decision for the screen,
and the dragged order is the collector's muscle memory (ADR-0048). `SIZE_PRESET_BOUNDARY` in
`tests/unit/agent-api-operation-boundary.test.ts` keeps `deleteStampSizePreset` and
`reorderStampSizePresets` out of every operation module, and
`tests/integration/agent-api-sizes.test.ts` pins the exact list of size operations.

## Building the catalogue

**Five operations, and all five write** (#1438): an issue, its stamps and its variants entered from a
catalogue page, a dealer's list or Colnect, and their names, numbers and attributes corrected —
where until then the resolver could find a number and nothing could add one.

| operation | writes | what it is for |
| --- | --- | --- |
| `create_issue` | yes | an issue in an area, its declared ranges, its own prefixes (#1606), and the stamps they generate (#70, #451) |
| `add_issue_stamps` | yes | the issue's *Add stamp range* dialog (#219), optionally sized from a preset (#807) |
| `add_stamp_variants` | yes | the *Add variant range* dialog (#722), with its subtype (#1000) |
| `update_issue` | yes | the name, the year, the translated names, a catalogue's declared range, its own prefix in a catalogue (#1606) |
| `update_stamp` | yes | the name, translated names, date, catalogue numbers and attributes (#71, #736) |

**Every write is the app's own.** `createIssue`, `addStampRangeToIssue`, `addVariantRangeToStamp`,
`updateIssue` and `updateStampWithCatalog` are the issue form's, the two range dialogs' and the two
edit dialogs' writes. What the operations add is what those dialogs' server actions do before they
write — `parseCatalogNumberSpec` / `parseVariantNumberSpec`, the same-span rule across catalogues,
`AUTO_CREATE_MAX_STAMPS`, the 1840–2100 year bound — each read in the operation so its refusal is
written for an agent, since the domain throws plain `Error`s this surface does not relay. Three lib
functions grew rather than being worked around: the three creating ones **return the created stamp
ids** (the screen callers ignore them), and `createIssue` takes the add-range dialog's
`sizePresetId`, resolved before the transaction as `addStampRangeToIssue` resolves it.

**A catalogue's numbers are one `"catalogue: numbers"` entry in a string list** — `"Mi: 100-105,
107"` — because a parameter is a scalar or a string list and nothing richer (#706), and the value is
exactly the issue form's syntax, so a spec means here what it means in the dialog. Translated names
are `"de: Freimarken"` the same way. **Every catalogue named generates stamps** unless `stamps_from`
names fewer — the form ticks its boxes itself and an agent has no boxes, so the default is stated on
the parameter and a mismatched span is refused pointing at `stamps_from`, never silently narrowed.

**A catalogue must be one the area keeps** (`effectiveVendorsForArea`, the forms' own set), and a
translated name one of `getCollectionTranslationContext`'s languages: a number or a name the forms
offer no field for would be one the collector could neither see nor correct on the record's screen.

**An issue's own prefix per catalogue (#377) is `prefixes`**, on both `create_issue` and
`update_issue` (#1606), so a series a catalogue files under another prefix than the rest of its area
is set up in one call. It is spelled as the area operations spell a catalogue — `"Mi: GG"` a prefix of
its own, `"Mi"` follow the area — and only the catalogues sent change; `updateIssue` replaces the whole
set, so the rest is handed back as it is. **`"Mi: -"` is refused**, and that is the model rather than
the API: an issue has two states, not the area's three — no `IssueCatalogPrefix` row is inheritance
and a row always carries a prefix, which is also all the issue form can say (a blank field inherits).
The collector chose refusing it over adding a third state on 2026-10-04. `get_issue` states
`catalogues` twice — `own`, every catalogue the area keeps in the spelling `prefixes` takes, and
`resolved`, the prefix its stamps' numbers carry — so an override can be told from an inherited
prefix; a stored prefix for a catalogue the area no longer keeps resolves nowhere and is not stated.

**A prefix that would make a duplicate is refused before anything is written**, whatever the
duplicate setting, for the reason below. On a create the prefixes sent are the generated stamps'
prefix context, as the create form's typed fields are. On an edit every catalogue whose *resolved*
prefix changes is checked over all the issue's stamps — `findCatalogDuplicatesForCandidates` with the
new set as unsaved `prefixes`, per primary area — and the issue's own stamps are never counted against
each other, since they move together. The refusal names the issue's stamp and the holder, with the
holders' ids in `accepted`. This is a check the screen does not make: the issue edit dialog saves a
prefix without looking at the stamps it re-labels. `update_issue` answers with `prefixChange`, the
resolved catalogues `before` and `after`, as `move_issue_to_area` does.

**`add_stamp_variants` does not ask #1573's question.** A screen that gives a priced stamp its
first variant asks whether to keep or clear the stamp's own prices; an agent has no dialog, so the
operation passes `umbrellaPrices: "keep"` — today's behaviour — and answers `ownPricesKept` (count,
editions, a note naming `clear_catalog_prices`) instead of `null`. Clearing stays a separate,
visible write the collector can be asked about, rather than a parameter that deletes prices as a
side effect of adding variants.

**A duplicate is refused whatever `Collection.duplicateCatalogMode` says**, and that is #1438's
decision rather than an oversight of the setting. The setting decides what a person typing into a
form may override; an agent that could have found the stamp with `resolve_catalog_numbers` has no
business creating a second one. So the operations call `findCatalogDuplicatesForCandidates` /
`findCatalogDuplicatesForStamp` directly — catalogue identity, vendor + effective prefix + number
(#85), the key the resolver compares too — and refuse with the holders named and their ids in
`accepted`. The mode-gated `enforce…` wrappers are not used, and their sentence (*switch to warnings
under Settings*) is written for the screen.

**An edit restates what it does not change.** `updateIssue` writes `name` and `year` as `?? null`
and `updateStampWithCatalog` writes the name, the date and **every** catalogue number, because that
is what an edit dialog submits; so each edit reads the record first and sends the rest back, and a
`clear` list empties a field (`params.ts` refuses an empty string). The attributes and translations
go through the domain's own *absent means untouched* rule (`pickStampAttributeWrites`,
`syncEntityTranslations`). A stamp edit refuses a run (`Mi: 401-402`): a stamp has one number in
each catalogue. **No operation takes a number off a stamp or a range off an issue** — leaving that
out is reversible and publishing it is not, the argument *Working on trades* makes for a line's
manual value.

**The four attribute dictionaries joined the vocabulary** (`colors`, `watermarks`, `papers`,
`printings`) on #708's licence, *adding a key is not a break*: `update_stamp` takes them by name.

**Nothing is deleted, moved or reordered**, and it is held the way the other boundaries are.
`CATALOG_BOUNDARY` in `tests/unit/agent-api-operation-boundary.test.ts` keeps `deleteIssue`,
`deleteStamp`, `deleteStampCatalogNumber`, `removeStampFromIssue`, `mergeIssues`, `moveStampNode`,
`reparentStampNode`, `reorderIssueMembers`, `reorderChecklists` and `deleteCollectionArea` out of every
operation module, and `tests/integration/agent-api-catalog-edits.test.ts` pins the exact list of
writes under `/issues` and `/stamps` and fails on a delete-, move- or reorder-shaped name. New stamps
take the issue's order as the dialogs' generation gives it (#549).

**#1512 lifted this for checklists, and for exactly its operations** — see *Changing checklists*
below. **#1540 lifted it for one catalogue price at a time** — see *Pricing the catalogue* below — and
added the three Settings deletes of a catalogue, a book and an edition to the map, since each takes
every price recorded under it. Until then the map also held `deleteChecklist` and `reorderChecklistStamps`; both moved to
`CHECKLIST_WRITES`, and `reorderChecklists` — the order of an issue's checklists among themselves,
which nobody asked for — joined the map instead. `remove_checklist_stamps` is exempted **by name,
with its reason**, from the catalogue test's name guard, which it would otherwise trip on
`remove_…stamp`.

**#1539 lifted it for areas, and for exactly its operations** — see *Organising the area tree*
below. `moveIssueToArea` left the map for `AREA_WRITES`; `deleteCollectionArea`, which was rejected,
joined it. `move_issue_to_area` is exempted by name, with its reason, from the same name guard and
from the exact list of `/issues` writes, and `agent-api-areas.test.ts` pins it instead.

**`resolveStampRefs` and `loadStampLabels` moved out of `sizes.ts` into `operations/stamp-refs.ts`**
so the two modules share one way of naming a stamp and reading its numbers back.

### A stamp's Colnect ID

**One operation, and it writes** (#1445): `set_stamp_colnect_id` (`POST /stamp-colnect-id`) sets,
changes or clears `Stamp.colnectId` (#247), the item-ID listing on Colnect, the Colnect links and the
list sync all join on — supplied by an assistant with the stamp's Colnect page or a Colnect export in
front of it. `get_stamp` already reported it as `colnectId`.

**It is written the one way an item-ID is ever written**: `confirmColnectMatch`, the Assistant's
match confirmation and the collector's own item-ID box (#741), with `allowOverwrite`. A clear is
`clearColnectMatch` beside it, the same one field. No page numbers, date or attributes are filled —
that is the Assistant's match walk, and an agent calling this has sent an ID, not a page. The value is
read by `colnectItemIdInput`, the box's own reading, so a Colnect address works as well as the
number; it is not validated further, for the box's reason (Colnect, not this app, knows which ids
exist).

**#1445's issue body said the ID is stored *as the Colnect catalogue's number on the stamp*, and the
tree says otherwise**: it is the plain `Stamp.colnectId` column, not a `StampCatalogNumber` row. The
decision it was stating — *stored the way the app stores it* — is what was built.

**One ID names one stamp, and that is this operation's check**, not the column's: the index on
`(collectionId, colnectId)` is deliberately non-unique (`schema.prisma`), and `confirmColnectMatch`
does not look, because the matcher's own decision matrix never proposes a second holder (#250). So
the operation asks `findColnectIdHolders` first and refuses with the holder named and its id in
`accepted`; it never moves an ID off the other stamp. **Changing or clearing an ID the stamp itself
carries needs no confirmation flag** — #1445 allowed it outright, unlike `set_stamp_size`'s
`overwrite` — and the answer carries `replaced` so the collector can put it back.

**A forgery is written like any stamp.** #1445 proposed refusing one, citing #1007; #1007 was closed
on 2026-09-08 as contrary to ADR-0049 — a forgery is an ordinary variant, and nothing in the app
recognises one — and the collector confirmed on 2026-09-28 that the operation makes no exception.

**On an umbrella the ID is a claim about the umbrella itself.** An unknown-variant umbrella listed
under its cheapest variant is resolved at listing time (#616, `listing-catalog-ids.ts`) and never
written back; this operation writes only the ID it was sent onto the stamp it was named, and its
description tells a model not to put a variant's ID on a parent to get a listing.

**`colnect` is a forbidden word in #712's name guard**, which is there for *claiming a Colnect list is
in step* (#689). `set_stamp_colnect_id` is exempted **by name, with its reason**, in
`tests/integration/agent-api-trades.test.ts`, rather than by narrowing the word list or renaming the
operation to slip past it: it sends nothing, claims nothing about a list and clears no report, and
`markColnectApplied` stays out through the import guard.

## Pricing the catalogue

**Four operations, two of which write** (#1540): the editions a price is recorded in, an issue's or a
stamp tree's prices in one read, and many cells set or cleared in one write — a catalogue page entered
a whole set at a time, which is most of the typing in a collection.

| operation | writes | what it is for |
| --- | --- | --- |
| `list_catalog_editions` | no | every book and year with its currency, or an area's — the grid's own list (`readAreaEditions`) |
| `get_catalog_prices` | no | the variant price grid over an issue or a stamp's whole tree, every axis at once |
| `set_catalog_prices` | yes | many cells in one edition, answered per cell |
| `clear_catalog_prices` | yes | many cells emptied, as emptying a grid cell does |

**The grid's read and the grid's write, and nothing beside them** (#618). `getVariantPriceGrid` is the
read and `setVariantCatalogPrice` the write — a null amount clears the cell's row — so the
validation, the rounding (`formatAmountInput`, the cell's own reading when it is left), the currency
taken from the edition's book and never from the caller, and the effect on valuation are the grid's.
Nothing is filled or derived on a write: the grid's *Fill from None* and condition fill are buttons
for a person, and an assistant that wants those figures sends them as prices.

**A cell is `name=value` pairs, one string per cell** — `"stamp=Mi 309AP; condition=MNH;
price=12.50"` — because a parameter is a scalar or a string list (#706) and a cell has five axes. The
edition is the call's, since a page comes from one book; `certificate` and `format` default to `none`
and `single`, the axes' nulls (ADR-0006 §2, ADR-0020), matched as keywords only when no row of the
collection answers to the word. An edition is named `"<book> <year>"` or `"<vendor> <year>"` through
#708's resolver, so two Michel books of one year make `Mi 2024` ambiguous and refused with ids.

**A batch answers per cell and never fails whole over one** — the collector's decision on #1540. A
cell's stamp is resolved through #1037's resolver as everywhere, but a number that names nothing or
several stamps refuses **its cell**, unlike `resolveStampRefs`, which refuses the call. Only what is
the call's — the edition, an empty list, more than 100 cells — refuses the call. Each cell says
`written`, `cleared`, `unchanged` (the figure was already there, or a clear found nothing) or
`refused` with a sentence; a written or cleared cell names the figure it `replaced`; a cell naming the
same cell as an earlier entry is refused rather than written twice. Unchanged cells are not written.

**What a price reads back as is the grid's arithmetic, called rather than restated.** An umbrella
(`identified: false` on the grid's row) with no price of its own is worth the lowest of its variant
descendants' figures and is reported `rolledUp`; a price recorded on it outranks that and is reported
plainly (#616, #627) — and writing one is what unlocking the row does. On a format axis an empty cell
of an ordinary row may be the single times a resolved multiplier, reported `derived` (ADR-0020 §5),
because the grid draws it greyed and the rollup may rest on it. Both come from
`variant-price-cells.ts`, which the grid and the identification step already share so they cannot
disagree; `catalogPriceCells` walks every axis combination something is recorded in, which is the
grid's three controls turned through in one pass. The rollup is taken within one edition, as the grid
takes it, and so may differ from the headline the lists print (#238's newest-with-a-price fallback) —
the grid's own stated trade.

**A cell may say the catalogue gives no price** (#1615): `StampCatalogPrice.mark` is `nonexistent`
(the catalogue prints —) or `undeterminable` (?), with `price` null. It is written as `price=-` or
`price=?` — or the marks' own names — through the same `setVariantCatalogPrice`, whose `amount` is a
figure, a mark or null; it reads back as `mark` **in place of** `amount`, and a write's answer says
`mark` where it would say `amount`, with `replaced` carrying a figure or a mark's name. A figure and a
mark replace each other as an ordinary write, and a clear still means *not entered yet*. Inside
`catalogPriceCells` a recorded mark is held as the grid holds it — its sign — so a marked single
carries onto an empty format cell (`derived`) and an umbrella none of whose variants is priced and all
of them marked reports their combined mark `rolledUp`, by the grid's own `rolledUpCellMark`. A copy's
value carries `catalogueMark` beside `unpriced`, and `get_holdings_valuation`'s catalogue total a
`markedCount` beside `unpricedCount`.

**Clearing is the one catalogue delete on this surface**, amending #1438's *nothing is deleted*.
`CATALOG_PRICE_WRITES` in `tests/unit/agent-api-operation-boundary.test.ts` pins the price writes to
`setVariantCatalogPrice` from `operations/catalog-prices.ts` alone, keeps `quickSetCatalogPrices` out,
and fails on any operation module saying `catalogPrices` — `updateStampWithCatalog` handed that list
**deletes every price on the stamp** before writing the new ones. `deleteCatalogVendor`,
`deleteCatalogName` and `deleteCatalogEdition` joined `CATALOG_BOUNDARY`.
`tests/integration/agent-api-catalog-prices.test.ts` pins the two writes and that
`clear_catalog_prices` is the only price- or catalogue-shaped name that removes anything.

## Changing checklists

**Eight operations, six of which write** (#1512): a checklist created on an issue or spanning several
(#1416), renamed and translated, its stamps added, taken off and put in order (#764), and one no album
prints deleted — *make a checklist of the watermark Y stamps of this issue*, *take the reprints out of
this one*. What a checklist is, and how completeness and gaps are computed, did not change.

| operation | writes | what it is for |
| --- | --- | --- |
| `list_checklists` | no | the checklists, spanning ones first, then each issue's by year; narrowed by `issue_id`, `spanning`, `name`, `type`; standard only unless `include_specialised` (`GET /checklists`) |
| `list_checklist_stamps` | no | one checklist's stamps in their order, paged, with the checklist (`GET /checklists/{checklist_id}/stamps`) |
| `create_checklist` | yes | an empty checklist on an issue, or without `issue_id` spanning issues, of the `type` sent (standard by default) |
| `update_checklist` | yes | its name, translated names and `type`, only what is sent |
| `add_checklist_stamps` | yes | stamps appended in the order sent |
| `remove_checklist_stamps` | yes | stamps taken off, the stamps kept (`POST …/stamps/remove`) |
| `set_checklist_order` | yes | the stamps sent first, the rest after them as they were (`POST …/order`) |
| `delete_checklist` | yes | a checklist no album prints |

**The reads answer what `get_issue` and `find_checklist_gaps` did not**: `get_issue` names an issue's
checklists and their sizes and nothing spanning issues, and the gap read names only what is missing.
A `list_checklists` row is the whole checklist but its stamps — #712's move for a want row — so there
is no *read one checklist* verb; its stamps are a paged list of their own because a spanning set can
run to hundreds, and `list_checklist_stamps` carries the checklist row beside the page.

**Every write is the editors' own.** `createChecklist`, `renameChecklist`, `setChecklistStamps` (the
remove, which is the editor's *save the set* with the survivors keeping their order),
`reorderChecklistStamps` and `deleteChecklist`, and for an add `addStampsToSpanningChecklist` — the
Issues list's selection bar — or `addStampsToIssueChecklist`, which #1512 added beside it for an
issue's own checklist. **That one function is where the screens' rule for an issue's checklist now
lives**: the editor on the issue offers only the issue's members (`useIssueMembers`), so nothing on the
server had to say it, and `addStampsToSpanningChecklist` refuses an issue's checklist outright for the
reason ADR-0020 §7 gives. The new function admits the issue's `IssueMember` rows only; the operation
checks first so its refusal can name the stamps. Translated names go through `translationWrites`, the
catalogue writes' `"language: name"` spelling (#1438), over the same languages the name dialog offers.
**A checklist still named after its issue** follows the issue's translation (`resolveChecklistName`)
until it is renamed or given its own, and the API writes the same columns, so that holds unchanged.

**A repeated name is advisory, as in `ChecklistNameDialog`**: the answer carries `sameNameAs` with the
other checklists' ids and the name is kept (#178's rule for an issue name).

**An add refuses; a remove and an order report.** An add is a statement about what the set contains,
so a stamp that names nothing — `resolveStampRefs`, the size and catalogue writes' resolver — or one an
issue's checklist may not hold refuses the whole call. A remove and an order are idempotent over a
stale list, as #1512 decided: an entry the resolver cannot place is reported under `notFound` with the
reason (`unfoundStamp`), a stamp not on the checklist under `notOnChecklist`, and the rest is done.
`set_checklist_order` is `reorderChecklistStamps` whole — named stamps first, the others after them in
their relative order — and says how many it placed and how many it `keptAfter`.

**Delete refuses what an album prints.** On the screen the confirmation names the albums
(`getChecklistUsage`, `ChecklistUsageNote`) and the delete cascades their cards away; through the API
it is refused with the albums named, so no printed page loses a block the collector has not looked
at. **#1512's issue body named *a series run* as a second user, and the tree says otherwise**: a run of
scan tiles (#1225) reads a checklist once and keeps no reference to it (`getChecklistUsage`'s own
comment, and `AlbumEntry` is the schema's only relation to `Checklist` besides its own rows), so an
album is the one thing there is to refuse on.

**A printed card is not touched.** The divergence report (#778) compares a snapshot with what the
collection would now produce, at read time, so a membership or order change made here shows up on a
printed card exactly as one made on the screen, and nothing is reprinted.

### A checklist's type (#1617)

**Every checklist an operation returns carries its `type`, `standard` or `specialised`** — ADR-0031
§11's `Checklist.kind` under the word the collector's form shows. `list_checklists` and the checklist
writes state it on the row (`agentChecklist`); `get_issue` on each of its `checklists`;
`find_checklist_gaps` on each gap; `get_stamp_size` on each `inherited` row as `checklistType`.
`get_stamp` names a stamp's checklists as **strings**, and `/api/v1` only grows, so it does not turn
them into rows: `specialisedChecklists` beside `checklists` names the specialised ones among them, and
every other one is standard.

**`create_checklist` and `update_checklist` take `type`**, through `createChecklist` and
`renameChecklist` — the name form's own write, which carries the type since #1617 — so no new write
crosses the boundary below. Their descriptions say what the type is for
(`CHECKLIST_TYPE_MEANING`), so an assistant making a checklist of one stamp's colour variants makes
it specialised.

**Every read that lists, offers or counts checklists takes `include_specialised`, false by default** —
the screens' switch, stated per call, and the app's default: `list_checklists`, `get_issue`,
`get_stamp`, `find_checklist_gaps`, `get_stamp_size` and `find_missing_translations` (outside an
`album`, which names what it prints). The domain functions take the answer as a boolean and never read
the screens' cookie, so the two transports cannot disagree about a rule. **`type` on
`list_checklists` narrows to one type, and asking for `specialised` is itself the request for them** —
refusing `type=specialised` without the flag would be a refusal of exactly what was asked.

**A checklist named by id answers whatever its type** — `list_checklist_stamps`, every write, the
trade lines and size applies that take a `checklist_id`. Hiding is about what is offered, never about
what exists. The two parameters live in `operations/checklist-type-params.ts`, one spelling for every
operation; `tests/integration/agent-api-checklist-types.test.ts` holds the *Done when* as calls.

**This narrowed existing answers, and it is not a break.** Every checklist that existed when #1617
landed became standard, so no answer changed then; what changes is what a collector later marks
specialised, which is the collector's decision about their own data rather than a change of meaning.

**The boundary moved by exactly these operations.** `CHECKLIST_WRITES` in
`tests/unit/agent-api-operation-boundary.test.ts` pins the checklist writes `operations/checklists.ts`
imports and fails if any other operation module imports one; `reorderChecklists` joined
`CATALOG_BOUNDARY`. `tests/integration/agent-api-checklists.test.ts` pins the exact list of operations
under `/checklists`.

## Organising the area tree

**Six operations, five of which write** (#1539): the area tree read, an area created under a parent
with its names and catalogue configuration, corrected, moved to another parent, put in order among
its siblings, and an issue moved to another area — setting up a collecting field from a catalogue's
table of contents, and reorganising the tree. What an area is, and how its configuration resolves
for the issues under it, did not change.

| operation | writes | what it is for |
| --- | --- | --- |
| `list_areas` | no | the tree in the Areas screen's order, each area's own and resolved configuration; narrowed by `under` (`GET /areas`) |
| `create_area` | yes | the *Add area* form: name, title names, description, grouping-only, catalogues, prefixes, books |
| `update_area` | yes | the edit form, only what is sent; `clear` hands a field back to the parent |
| `move_area` | yes | the form's parent picker, with what changed for the branch's issues (`POST /areas/{area_id}/move`) |
| `set_area_order` | yes | the tree's drag within one sibling group (`POST /areas/order`) |
| `move_issue_to_area` | yes | the Issues list's *Move to area* (`POST /issues/{issue_id}/move`) |

**`list_areas` is new rather than the vocabulary's area rows widened**: `get_collection_vocabulary`
names areas with `parentId` and `assignable` and is fetched once a session, and the catalogue
configuration, the counts and the resolution are what #1539 asked for and the vocabulary never
carries. A row states the configuration twice — `own`, what the area sets, in the spelling the writes
take, so an agent can read it and send it back changed; and `resolved`, what an issue under it gets
(`effectiveVendorsForArea`, `effectivePrimaryVendorId`, `resolveEffectivePrimaryCatalogNameId`, the
forms' own walks). Counts are direct: `issueCount` and `stampCount` filed under the area itself.

**An area's anchoring markets ride on the same two operations** (#1634; ADR-0064): `anchor_markets`
replaces the list, `clear: ["anchor_markets"]` hands it back to the parent, and a row reads it twice
like the catalogues — `anchorMarkets` as set on the area, `anchoringMarkets` in force after the walk
(absent meaning the home market). Omitted on `update_area`, the list is left as it is, which is also
why `move_area` cannot clear it. `recommend_bid` lists the results a market anchor rests on
(`marketResults`, each with its market) and counts the other markets' results it left out
(`notCounted`). A contact's market is set only as `create_seller` creates one (#1635) — an existing
contact's details are the collector's, as #1390 has them.

**A catalogue's three states are one string each**: `"Mi"` declares the catalogue with its prefix
inherited, `"Mi: GG"` gives it one here, and `"Mi: -"` states *no prefix here* — the column's null,
text and `''` (#675). The read writes them the same way.

**Every write is the screen's own.** `createCollectionArea` / `updateCollectionArea`, then
`syncAreaCatalogBooks` and `syncAreaVendors`, are the two form actions' calls in their order;
`reorderCollectionAreas` is the drag; `moveIssueToArea` is the Issues list's move. The screen's rules
are the domain's — an area under itself or a descendant, a grouping-only area holding issues or
stamps, an assignable area with no valuing book on it or above it (#69, #263), an issue under a
grouping-only area — and each is read in the operation first so the refusal is written for an agent,
since the domain throws plain `Error`s. **No rule is the API's own.** The form's three choices are
kept as the form makes them: the leading catalogue is one of the area's own catalogues, the valuing
book one of its price books, and attaching a book lists its catalogue (`AreaFormDialog` submits the
book vendors with the rest); a catalogue or book taken off stops leading or valuing, as the radio
goes with its row. The title name defaults to the name on a create and follows a rename while the two
are equal (#210), which is the form's mirroring.

**An edit restates what it does not change**, because `updateCollectionArea` writes every column it
is handed; the books and vendors are written only when one of their lists is sent or cleared. A move
is that same edit with only `parentId` changed, so it lands at the end of its new siblings and the
subtree's sort keys are recomputed (#78, #181) exactly as from the form.

**A move answers with what it changed** (#1539's third decision): `move_area` returns, for every area
of the moved branch whose `resolved` configuration differs, its `issueCount` and the configuration
before and after; `move_issue_to_area` returns the issue's own before and after — its issue-level
prefixes (#377) applied to both, since they travel with it — and `numbersOutsideArea`, the catalogues
its stamps are numbered in that the new area does not keep. Per area rather than per issue on an area
move, because a branch can hold hundreds of issues and every issue in one area resolves alike but for
its own prefixes.

**`set_area_order` is `set_checklist_order`'s shape over the domain's stricter write**:
`reorderCollectionAreas` demands the exact sibling set, so the operation sends the named areas first
and the rest after in their order. The areas named must share one parent and are refused otherwise.

**The boundary moved by exactly these operations.** `AREA_WRITES` in
`tests/unit/agent-api-operation-boundary.test.ts` pins the area writes `operations/areas.ts` imports
and fails if any other operation module imports one; `deleteCollectionArea` joined `CATALOG_BOUNDARY`
and `moveIssueToArea` left it. `tests/integration/agent-api-areas.test.ts` pins the operations under
`/areas` and that none deletes an area.

## Translating the collection's texts

**Two operations, one of which writes** (#1452): the texts a language is missing, and the
translations that fill them — hundreds of names an assistant can translate in a sitting, where a
missing one falls back to the default language and on a printed card stays that way (#1308).

| operation | writes | what it is for |
| --- | --- | --- |
| `find_missing_translations` | no | a language's gaps, narrowed by `kind`, `area` (with its subtree) or `album` (`GET /translations/missing`) |
| `set_translations` | yes | `"key: translation"` entries, at most 100, gaps only unless `replace` (`POST /translations`) |

**Every text the app translates, and through the app's own path.** The kinds are
`TRANSLATABLE_ENTITY_FIELDS` under snake_case names (`certificate_status`, an area's `title_name`),
and `tests/unit/agent-api-translations.test.ts` fails if the two lists part. The write is
`saveEntityTranslation`, the in-place gap editor's (#299, #300), so a translation written here is the
row the collector's dialogs write and every listing title and album page reads it at once. Nothing
becomes translatable here that is not in the app, and nothing marks a row as an assistant's.

**A text is named by a key, `kind.field.id`.** A write is a batch and parameters are scalars and
string lists (#706), so each entry is `"key: translation"`, the catalogue writes' spelling (#1438)
split on the first colon — which a key never contains, so a translation may carry colons. The find
hands the keys out and the agent sends them back; it never assembles one from three parameters.

***Missing* is what would fall back**: words in the default-language column and no filled
translation row for the language. A stamp or an issue with no name has nothing to translate, and a
write naming one is refused. **A checklist still named after its issue is not listed** — it prints
the issue's translation (`resolveChecklistName`), so the issue is the gap; that comparison is
column-to-column, which the query builder cannot express, so checklists are filtered in memory.
Everything else pages in the database, the sources counted for `total` and walked in
`TRANSLATION_KINDS` order.

**Narrowed to an album, the list is the page editor's**: `albumTranslationGaps` in `album-editor.ts`
is the texts behind the editor's album-wide *untranslated* figure, deduplicated by the row that fixes
each, in page order — lifted so that the agent and the editor cannot disagree about an album. The
language must be the album's own. A printed card is left out, as the editor leaves it out; nothing
here touches a snapshot, and a translation that changes a card's words is a `text` divergence
(#778) like any other.

**Only the collection's languages** (`getCollectionTranslationContext`: its platforms' listing
languages and its albums' languages, #777) — any other is refused with them in `accepted`, and so is
the default language, whose text is the entity's own column.

**A write keeps what is there.** A text that already has a translation is listed under `kept` with
its current wording unless `replace` is sent; a replacement is under `written` with `replaced`. That
is #1415's protective default, reported rather than refused so that a batch fills every gap it can.
Every entry is checked — the key, the row in this collection, words to translate — before the first
row is written. **No operation clears a translation**: a blank entry is refused, and taking one away
stays on the entity's screen.

## What is deliberately absent

**Absence, not a flag.** Three boundaries in this track are enforced by there being no operation, and
they must stay that way — a switch is something that can be flipped, and an operation that does not
exist cannot be.

- **The agent never publishes to a marketplace** (#711). It drafts, prices and titles an offer inside
  Stamporama; going public stays in the collector's hands. An agent that misreads costs a minute; an
  agent that mispublishes lists a stamp at the wrong price under the collector's name on someone
  else's platform. **Since #711 this is checked rather than asserted**, by two tests that fail on
  different things — see *Working on offers* above.
- **The agent never reaches a counterparty** (#712). It builds and balances trade lines; it does not
  send a proposal, touch a share token, write the partner's feedback or answer it, move a trade's
  lifecycle, record what actually arrived, close a trade, or claim a Colnect list is in step.
  **Since #712 this is checked rather than asserted**, by the same pair of tests failing on
  different things — see *Working on trades* above.
- **The agent never bids, and never reopens or settles a lot** (#1036, narrowed by #1627 and #1628).
  *The agent never writes to the auction watchlist* stood here until #1627, which opened the register
  — adding, describing, capping and correcting lots and a sale's terms — and *never closes or settles
  a lot* until #1628, which opened closing and cancelling. Bidding, reopening, settling and deleting
  stay closed — see *Keeping the auction register* above.
- **The agent never touches a copy through a purchase, never does anything to one that cannot be
  undone, and never edits a contact it did not just create** (#1390). See *Entering purchases* above.
- **The agent never deletes or reorders a size preset** (#1415). See *Stamp sizes and presets* above.
- **The agent never deletes, moves or reorders an issue, a stamp or a variant** (#1438). See
  *Building the catalogue* above. **Checklists, catalogue prices and areas are the exceptions**
  (#1512, #1540, #1539): it deletes a checklist no album prints and sets the order of its stamps —
  see *Changing checklists* — clears one cell's price as the grid does and never deletes a catalogue,
  a book or an edition — see *Pricing the catalogue* — and moves and orders areas and moves an issue
  to another area — see *Organising the area tree*.
- **The agent never deletes an area** (#1539).
- **Price observations are deleted** (#1635): they are market facts the assistant itself records,
  not the collector's transactions, and a misread one must be removable — see *Recording price
  observations* above.

Do not add a publish-shaped, send-shaped, bid-shaped or copy-touching operation to the
registry, whatever it is called, nor an auction write beyond #1627's five and #1628's outcome, nor one that deletes a size preset, deletes an area, or deletes,
moves or reorders an issue or a stamp beyond moving an issue to another area. *Two boundaries* was this
section's count until #1036 and *three* until #1390, and both are quoted rather than deleted.

### The two boundaries are not the same shape

**Publishing has a chokepoint and sending does not, and reading the second guard as the first is the
mistake to avoid** (#712). Publishing is an **outbound act**: a handful of domain functions post
something to a marketplace or move a listing's state, all doing one kind of thing, which is what let
#711's forbidden list be short and obvious.

**Nothing in this app sends anything to a trading partner at all.** The partner opens a link. So
*reaching a counterparty* has no single door, and the trade half of
`tests/unit/agent-api-operation-boundary.test.ts` is **six kinds of act** rather than one: minting or
altering or revoking the share link (#640), writing *as* the partner (#641, #658), answering the
partner (#641, #658), moving the lifecycle — `setTradeStatus` is `shared`, `agreed`, `closed` and
`cancelled` in one function (ADR-0039 §5) — recording what actually arrived and closing into a
purchase (#642, #644), and claiming a Colnect list has been carried out (#689, which is
`markOfferListingSynced`'s analogue exactly: it writes nothing outbound and it clears the flag
saying the public record and this one disagree). Each is labelled in the map with which kind it is,
because a seventh kind is what a later reader will have to recognise and there is no pattern to
recognise it by.

**And #712's *writing to Colnect* clause is guarded by the architecture rather than by that list**,
which is the one entry nobody can add correctly by reading `src/` alone. **This app does write to
Colnect**: `extension/src/platform/colnect/list-write.ts` builds `POST /item/col` — `act=check` for
list membership, and since #704 `act=cond` / `act=quantity` / `act=x_cond_qty` to correct the
quantity and grades of an entry the run has just created, because on a *new* entry silence hands the
decision to the list's own defaults rather than preserving anything (#689, ADR-0042, which
`colnect-list-sync.md` calls *a step change with an ADR of its own*). `list-export.ts` asks for a
list's export under the same authority and is a **read** (#690). It runs in the **content script**,
on a colnect.com page, under the collector's own session cookie, same-origin because the call
carries no CSRF token. **No `/api/v1` handler can reach it** — a different package, shipped to
the collector's browser rather than run on the server — so there is no import for the map to forbid
and nothing for it to catch. `markColnectApplied` is the one thing on *this* side that touches the
Colnect story at all, and it writes nothing outbound: it clears the flag saying the public record
and this one disagree, which is `markOfferListingSynced`'s reason and not a Colnect write's.

**An earlier draft of this passage said the clause was *vacuous today* because *nothing in this tree
writes to Colnect over the wire*, and it is quoted because the mistake is the reusable part.** The
grep behind it was `grep -rln 'colnect.com' src/` — one package of a two-package repository — and
the conclusion was stated about *the tree*. `git grep -lF 'colnect.com'` answers **59 files**, 17 of
them under `extension/`. The instrument ran, exited truthfully and answered exactly what it was
asked; what was wrong was the question's scope, which is *the guards protect the instrument; the
remaining failure is the question* (`collaboration.md`) met on a path list rather than on a pattern.

**`deleteTrade` was weighed for that list and left off**, on the reasoning `getOfferListingKit` was
left off #711's. It destroys a trade, which is worse than most things on the list — and it is not a
*send*, no operation calls it, and putting it there would make the list mean *anything dangerous*
rather than *the acts that reach somebody else*. That there is no `delete_trade` operation is a fact
about the registry, which is what the name guards are for.

## The MCP wrapper

`POST /api/mcp` (#709), served by the app itself — nothing extra runs beside the existing
container. **REST is the contract and MCP is a thin wrapper**: one domain layer, one set of
operations, two ways of reaching them.

**The tools are generated from `OPERATIONS` and there is no hand-written list anywhere.** That is
the whole of this issue; everything else on this page about MCP is transport. A hand-maintained tool
list is how MCP and REST drift, and the drift is silent — the list goes on describing an operation
whose parameters moved, and the agent goes on believing it. `buildToolList` is a pure function of an
operation list, exactly as `buildOpenApiDocument` is, and `tests/unit/agent-api-mcp.test.ts` holds
the criterion the same way #706's generator test does: build from one fixture operation, build from
two, and nothing in the test names the second one's parameters.

**Both wrappers run the same `validateOperations` and the same `parameterSchema`.** A malformed
entry fails the first `tools/list` as it fails the first request for the document, and a parameter
type has one spelling rather than one per wrapper — which is the registry's own argument, one level
below the operation.

### What it implements, and what it refuses

**Two eras on one endpoint, chosen per request** (#1222). Revision 2026-07-28 removed the
handshake, and a server that answers it and the revisions before it is what the specification calls
*dual-era*:

- **A 2026-07-28 client** gets `server/discover`, `tools/list` and `tools/call`. There is no
  `initialize` and no `ping` — both are answered `404` with `-32601`, the status that revision names
  for an unknown method. Every request carries its revision and the client's capabilities in
  `params._meta`, and mirrors its method into `Mcp-Method` and, on `tools/call`, the tool name into
  `Mcp-Name`; a missing or disagreeing header is `400` with `HeaderMismatch` (`-32020`), a missing
  `_meta` field `400` with `-32602`. Every result carries `resultType: "complete"` and the server's
  identity in `_meta`, and `server/discover` and `tools/list` carry `ttlMs: 0` and
  `cacheScope: "private"`.
- **A client on 2025-06-18, 2025-03-26 or 2024-11-05** gets exactly what #709 built: `initialize`,
  `tools/list`, `tools/call` and `ping`, with results carrying none of 2026-07-28's fields. The unit
  suite pins that by asserting the keys of a legacy result, so a modern field leaking into every
  result fails a test rather than a client.

**A request is modern when its `MCP-Protocol-Version` header names 2026-07-28 or its body declares a
revision in `_meta`.** The second half is not decoration: without it, a body declaring 2026-07-28 with
no header would read as a header-less legacy client and be served under rules it never asked for.

**The cache hints are two decisions, not defaults.** `private` for the reason
`/api/v1/openapi.json` requires a token (*The document*, below): the list carries no collection data,
but it is the list of things a valid token could do, and `public` would let a shared cache hand it to
a caller without one. `ttlMs: 0` because the list changes only with a deploy and this build cannot
know when the next one is — a positive TTL would be a promise about a deploy nobody has scheduled,
and zero costs one `POST`.

**A legacy `initialize` is never answered with 2026-07-28**, even by a client that asks for it: a
client that sent `initialize` is speaking a revision with a handshake, so it is answered with the
newest one that has one (`LATEST_LEGACY_MCP_PROTOCOL_VERSION`).

**Streamable HTTP, stateless, in both eras**: no `Mcp-Session-Id`, because the tool list is compiled
into the build and every call is authorised from its own `Authorization` header, so there is no
session state to key. A notification — `notifications/initialized` is the one every legacy client
sends — is answered with `202` and no body, because a message carrying no id has nothing to answer.

`GET` and `DELETE` are refused with `405` and an `Allow: POST`: there is no server-initiated stream
to open and no session to terminate, and 2026-07-28 names `405` for exactly that traffic from an older
client.

**Batching is refused**, which is the current specification rather than a shortcut — since 2025-06-18
the body of a POST must be a single JSON-RPC message.

**The `MCP-Protocol-Version` header is refused rather than negotiated when it names a revision this
build does not speak**: `400` with `UnsupportedProtocolVersion` (`-32022`) and `data` carrying
`supported` and `requested`, answered to every era because 2026-07-28 fixes that shape and a dual-era
client reads it to tell a modern server from a legacy one. **That one refusal is also this build's
staleness alarm** (ADR-0051 §4): the route logs it naming the ADR, and it fired on 2026-09-13 when the
collector's client first asked for 2026-07-28, which is what #1222 is. **The revision is pinned at
`2026-07-28`** in `MCP_PROTOCOL_VERSION` (`2025-06-18` from #709 until #1222). The decision of what a
request is refused for lives in the pure `mcp.ts` and the route only reads the headers and writes the
log, so `pnpm test:unit` holds the header rules as well as the handshake. A header-less request is not
refused, because the specification lets a server assume `2025-03-26` for one and this build speaks it.

**MCP resources and prompts are deliberately absent — and this is a different kind of absence from
the section above.** *What is deliberately absent* is about boundaries that must stay, enforced by
there being no operation. This one is *tools first*: resources and prompts are worth adding the
moment a concrete need shows up, and are missing only because none has.

### There is no SDK, and the reason is the Prisma-free split

**[ADR-0051](../decisions/0051-hand-rolled-mcp-transport.md) is the decision and carries the whole
argument**, including where this implementation deviates from the specification and why — re-read against 2026-07-28 in #1222.
What follows is the summary; where the two differ, the ADR is right.

`@modelcontextprotocol/sdk` writes its HTTP transport against Node's `IncomingMessage` and
`ServerResponse`. A Next App Router route handler is handed a Web `Request` and must return a Web
`Response`, so using it means a stream adapter between the two shapes — more code than the four
methods it wraps, with a failure mode (a half-consumed body, a response that never ends) that no
suite here can see. **And it would move the protocol to the server side of the cut**, where only the
integration suite could reach it; the hand-written module is pure, so `pnpm test:unit` holds the
handshake, the tool schemas and the error mapping.

The cost is stated rather than glossed: when the specification revises, the revision is ours. For
four methods that is the right side of the trade, and `renovate.json`'s never-alone list is why —
an SDK at 0.x tracking a specification that has changed its transport twice would be a never-alone
entry by construction, so the honest comparison is *SDK plus adapter plus a standing never-alone
entry* against *a pure module a unit test holds*.

### Which failures are protocol errors and which are tool errors

**This is the one judgement in the wrapper worth stating rather than inferring.**

- **A malformed message, an unknown method, an unknown tool** is a **JSON-RPC error**. The client
  built the call from a list this server gave it, so the fault is the client's rather than the
  model's reasoning.
- **Anything an agent could act on** — a rejected parameter, a refused scope, a domain refusal — is
  a **tool error**: an ordinary result carrying `isError: true`, the sentence, and the #706 body
  beside it. A JSON-RPC error is handled by the client's transport and may never reach the model at
  all; an `isError` result always does, and the whole point of #706's error convention is that the
  agent reads the sentence and corrects itself.

Nothing runs in either case, so this is a choice about **who reads the refusal** and not about
whether it is enforced.

### One token, one parser, one scope check

**The same `Bearer stmpa_…` token as REST**, through the same `resolveAgentApiCaller`, with the same
collection pinning. No second credential and nothing second to revoke. An unauthenticated call is
`401` with the same sentence `/api/v1` uses, plus `WWW-Authenticate: Bearer` — there is no OAuth
metadata to point at, because this surface takes the token the collector minted and nothing here can
issue one.

**The same parser.** MCP takes a single `arguments` object, so a tool's schema flattens an
operation's path, query and body parameters into one — and before `parseParameters` sees them, each
value is put back where its own declaration says it came from. Nothing is reimplemented, so every
coercion and every rejection sentence is the REST surface's. **Unknown keys are routed to the query
bucket on purpose**: that is what makes them refused *with the accepted names beside them*, by the
rejection #706 already wrote, rather than dropped here with a second sentence saying the same thing.

**The same scope check.** The route binds `assertAgentApiScope` to the caller and hands it in; the
wrapper derives nothing and checks nothing itself. The ordering is the REST dispatcher's and for its
reasons — after the tool is resolved, because the answer depends on which one, and before a
parameter is parsed, because there is no point validating inputs for a call that will not be made.

**That binding was the one line of #709 no test covered, and #711 closed it.** The paragraph here
read: *replacing it with a no-op leaves every test in `tests/integration/agent-api-mcp.test.ts`
green, because **nothing in `OPERATIONS` writes** and no request exists that could be refused* —
measured rather than assumed, true when written, and quoted rather than deleted. With three writing
operations in the registry, a `read` token calling `draft_offer` through this wrapper is refused by
that binding and by nothing else;
`tests/integration/agent-api-offers.test.ts` makes the call and reads the refusal out. It is in that
file rather than in the MCP one because the request needs a real platform and real copies, which is
that suite's fixture.

What the MCP suite covers on its own is unchanged: the decision over both directions against the
real `assertOperationScope`, the ordering (a writing tool called with a bad parameter under a `read`
scope answers *forbidden* and never mentions the parameter), and a `read` scope read back off a real
hashed row.

### What the integration test can and cannot claim

`tests/integration/agent-api-mcp.test.ts` imports the route module and drives it with real
`Request` objects: a real hashed token, a real collection, a real `tools/call` answering out of
Postgres. **What it does not establish is that a client library has spoken to it over a socket** —
framing, header negotiation and what a particular client does at connect time are untested. #709's
*Done when* asks for a client to connect and list the tools, and that half needs a person with one;
[`docs/user-guide/agent-api.md`](../user-guide/agent-api.md) is the instructions for doing it.

## The document

`GET /api/v1/openapi.json`, generated, OpenAPI 3.1, **requiring the same token as every operation**.
It carries no collection data, so this is not about secrecy of content: a self-hosted instance is
often reachable from the internet, and publishing the list of things a valid token could do buys an
unauthenticated reader something and the collector nothing.

`validateOperations` runs from `buildOpenApiDocument`, so a malformed registry entry fails the first
request for the document rather than producing a document that describes it wrongly. It refuses a
name that is not snake_case, two operations sharing a name, two sharing a method and path, a
`{param}` with nothing declaring it, a declared path parameter the path does not carry, a body
parameter on `GET`, and a list operation redeclaring `limit` or `cursor`.

**The document carries eighty-four operations.** It was empty on #706, which shipped none; #708
added `get_collection_vocabulary`; #710 added `search_collection`, `get_stamp`, `get_issue`,
`get_copy`, `list_holdings` and `summarize_valuation`; #711 added `find_unlisted_copies`,
`list_offers`, `get_offer`, `draft_offer`, `set_offer_price` and `set_offer_text`; #712 added
`list_wants`, `match_wants`, `find_checklist_gaps`, `list_trades`, `create_trade`, `get_trade`,
`list_trade_lines`, `get_trade_balance`, `add_trade_give_lines`, `serve_trade_requirement`,
`add_trade_receive_lines` and `remove_trade_line`; #1168 added `recommend_bid`; #1037 added
`resolve_catalog_numbers`; #1036 added `list_auction_watchlist`, `summarize_auction_exposure` and
`find_tracked_auction_lots`; #1390 added `list_purchases`, `get_purchase`, `create_seller`,
`create_purchase`, `update_purchase`, `add_purchase_lot`, `update_purchase_lot`,
`remove_purchase_lot`, `add_purchase_expense`, `update_purchase_expense` and
`remove_purchase_expense`; #1415 added `list_size_presets`, `get_stamp_size`, `create_size_preset`,
`update_size_preset`, `set_stamp_size`, `preview_stamp_size_apply` and `apply_stamp_size`; #1438
added `create_issue`, `add_issue_stamps`, `add_stamp_variants`, `update_issue` and `update_stamp`;
#1445 added `set_stamp_colnect_id`; #1452 added `find_missing_translations` and `set_translations`;
#1512 added the eight checklist operations; #1540 added `list_catalog_editions`, `get_catalog_prices`,
`set_catalog_prices` and `clear_catalog_prices`; #1539 added `list_areas`, `create_area`,
`update_area`, `move_area`, `set_area_order` and `move_issue_to_area`; #1627 added `add_auction_lot`,
`update_auction_lot`, `set_auction_lot_lines`, `set_auction_lot_ceiling` and `update_auction_sale`;
#1628 added `record_auction_lot_outcome`; #1635 added `list_price_observations`,
`record_price_observations`, `update_price_observation` and `delete_price_observation`.
*The document carries thirty operations* stood here from #1036 until #1390, *forty-one* from #1390
until #1415, *forty-eight* from #1415 until #1438, *fifty-three* from #1438 until #1445, *fifty-four* from #1445 until #1452, and *fifty-six* from #1452 until #1540 — #1512 took it to sixty-four without saying so here — and *sixty-eight* from #1540 until #1539, *seventy-four* from #1539 until #1627, and *seventy-nine* from #1627 until #1628, and *eighty* from #1628 until #1635. Six earlier sentences are quoted rather than deleted because each stood
in several files and will go on arriving in anything copied from them: *#706 ships no domain
operation, so `paths` is `{}` — valid OpenAPI 3.1, and the honest state of the surface until #710*,
*the document carries one operation*, *the document carries seven operations*, *the document carries
thirteen operations*, *the document carries twenty-five operations*, and *the document carries
twenty-six operations* — which #1037 left standing here although it made the count twenty-seven. What is unchanged is that `build([])` is still the right way to ask what an
empty document looks like — that is a question about the generator, and `tests/unit/agent-api-openapi.test.ts`
asks it of a fixture list rather than of the registry.
