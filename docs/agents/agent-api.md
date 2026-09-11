# The Agent API

`/api/v1` and `/api/mcp`: the versioned, described surface an agentic AI client uses, the shared
operation registry behind it, and the conventions every operation obeys. Read this before adding an
operation, and read [ADR-0050](../decisions/0050-versioned-agent-api.md) for why the surface exists
at all and [ADR-0051](../decisions/0051-hand-rolled-mcp-transport.md) for why the MCP half is
hand-written rather than built on the reference SDK.

The track is #706 (the foundation), #707 (token scopes), #708 (vocabulary), #709 (the MCP wrapper),
#710/#711/#712 (the operations), and #1036/#1037 (two gaps filed against it later). #706, #707,
#708, #709, #710 and #711 have landed; **both wrappers exist and the registry carries thirteen
operations** — #708's vocabulary read, #710's six reads over the collection and #711's six offer
verbs — and #712 adds to it.

**Three of them write**, which is the change #711 made to this page. What stood here read
*the registry carries seven operations … **Nothing in it writes**, which several statements below
still rest on* — true when it was written, quoted rather than deleted, and it will go on arriving in
anything copied from it. Every statement that rested on it is corrected below, each saying what it
used to say.

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
  openapi.ts        buildOpenApiDocument + validateOperations + parameterSchema
  mcp.ts            the MCP protocol: tool generation and JSON-RPC dispatch (#709)
  registry.ts       the operations array and the path lookup
  operations/
    vocabulary.ts   the vocabulary read and its registry entry (#708)   ← server-side
    reads-shared.ts the collection header, the labeller, the location tree (#710)  ← server-side
    search.ts       search_collection (#710)                            ← server-side
    records.ts      get_stamp / get_issue / get_copy (#710)             ← server-side
    holdings.ts     list_holdings / summarize_valuation (#710)          ← server-side
    offers.ts       the six offer verbs (#711)                          ← server-side
```

**`collection-reads.ts` is on the pure side and is typed structurally** rather than against
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
out again, in the pure `src/lib/assistant-token-scope.ts` — Settings → Assistant is a `"use client"`
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
enforcement works on the wire.

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
per-collection, not configurable, and already known to any model. **And no operation in the three
takes one as input**: an offer's currency is inherited and locked from `Contact.platformCurrency`
(#196), so drafting an offer names a *platform*, never a currency. What the agent actually needs is
the denomination of a figure it reads, and that is the `baseCurrency` scalar on the response.

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

**Six operations, answering the first of the three agent workflows** (#710): *what do I have, in
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

`summarize_valuation` states four totals — catalogue, market, cost, write-off — and **every one of
them travels with the counts saying how much of the collection is behind it** (`valuation.md`): a
figure built from a tenth of the copies must never read as the collection's worth.

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

## Working on offers

**Six operations, answering the second of the three agent workflows** (#711): *what is not listed,
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
deliberately not a catalogue-derived stand-in (ADR-0022 §6).

### `get_offer`'s `pricing` is four claims, not a recommendation

`suggested` is the catalogue value averaged **per set**, in the listing's own currency, because a
buyer takes one set (#190). `marketTotal` is evidence. `platformOpening` is what this house opens an
auction at whatever the goods are worth (#553), and outranks the other two **on an auction only**.
`platformMinimum` is what the marketplace costs to post on (#731) and is the weakest of the four.

**Collapsing them into one number is what would make an agent price a stamp confidently and
wrongly**, which is the same argument `offers.md` makes for drawing the three figures in a fixed
order on the wizard's price step. And `suggested` never travels without `suggestedValuedSets` and
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

**A field the marketplace has no template for is refused, and this is the one guard the domain does
not make for itself.** `regenerateOfferText` writes what the generator produced, which over no
template is null — so the call would **empty** the field. The collector's own ↻ is *disabled* there
rather than refused, off `OfferDetail.regeneratable`, and the operation reads that same answer so the
two surfaces cannot come to disagree. It was found by a test failing rather than by reading.

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

## What is deliberately absent

**Absence, not a flag.** Two boundaries in this track are enforced by there being no operation, and
they must stay that way — a switch is something that can be flipped, and an operation that does not
exist cannot be.

- **The agent never publishes to a marketplace** (#711). It drafts, prices and titles an offer inside
  Stamporama; going public stays in the collector's hands. An agent that misreads costs a minute; an
  agent that mispublishes lists a stamp at the wrong price under the collector's name on someone
  else's platform. **Since #711 this is checked rather than asserted**, by two tests that fail on
  different things — see *Working on offers* below.
- **The agent never reaches a counterparty** (#712). It builds and balances trade lines; it does not
  send a proposal, touch a share token, or write to Colnect.

Do not add a publish-shaped or send-shaped operation to the registry, whatever it is called.

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

`initialize`, `tools/list`, `tools/call` and `ping`, over JSON-RPC 2.0. **Streamable HTTP,
stateless**: no `Mcp-Session-Id`, because the tool list is compiled into the build and every call is
authorised from its own `Authorization` header, so there is no session state to key. A notification
— `notifications/initialized` is the one every client sends — is answered with `202` and no body,
because a message carrying no id has nothing to answer.

`GET` and `DELETE` are refused with `405` and an `Allow: POST`: there is no server-initiated stream
to open and no session to terminate, and a client that would like one should be told rather than
left waiting on a channel that never sends anything.

**Batching is refused**, which is the current specification rather than a shortcut — in this
revision the body of a POST must be a single JSON-RPC message. **Protocol-version negotiation at
`initialize` is an echo**: a client asking for a revision this server knows gets that one back, and
anything else is answered with the newest one it speaks, which is what the specification asks a
server to do — it is a negotiation rather than an error.

**The `MCP-Protocol-Version` *header* is a different thing and is refused rather than negotiated.**
A request carrying one for a revision this build does not speak gets `400`, which the specification
requires — and **that one line is also this build's staleness alarm** (ADR-0051 §4), because it logs
the mismatch naming the ADR. **The revision is pinned at `2025-06-18`** in `MCP_PROTOCOL_VERSION`;
a header-less request is not refused, because the specification says to assume `2025-03-26` for one
and this build speaks it.

**MCP resources and prompts are deliberately absent — and this is a different kind of absence from
the section above.** *What is deliberately absent* is about boundaries that must stay, enforced by
there being no operation. This one is *tools first*: resources and prompts are worth adding the
moment a concrete need shows up, and are missing only because none has.

### There is no SDK, and the reason is the Prisma-free split

**[ADR-0051](../decisions/0051-hand-rolled-mcp-transport.md) is the decision and carries the whole
argument**, including the two places this implementation deviates from the specification and why.
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

**The document carries thirteen operations.** It was empty on #706, which shipped none; #708 added
`get_collection_vocabulary`; #710 added `search_collection`, `get_stamp`, `get_issue`, `get_copy`,
`list_holdings` and `summarize_valuation`; #711 added `find_unlisted_copies`, `list_offers`,
`get_offer`, `draft_offer`, `set_offer_price` and `set_offer_text`. Three earlier sentences are
quoted rather than deleted because each stood in several files and will go on arriving in anything
copied from them: *#706 ships no domain operation, so `paths` is `{}` — valid OpenAPI 3.1, and the
honest state of the surface until #710*, *the document carries one operation*, and *the document
carries seven operations*. What is unchanged is that `build([])` is still the right way to ask what an
empty document looks like — that is a question about the generator, and `tests/unit/agent-api-openapi.test.ts`
asks it of a fixture list rather than of the registry.
