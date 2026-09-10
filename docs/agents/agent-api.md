# The Agent API

`/api/v1`: the versioned, described surface an agentic AI client uses, the shared operation registry
behind it, and the conventions every operation obeys. Read this before adding an operation, and read
[ADR-0050](../decisions/0050-versioned-agent-api.md) for why the surface exists at all.

The track is #706 (the foundation), #707 (token scopes), #708 (vocabulary), #709 (the MCP wrapper),
#710/#711/#712 (the operations), and #1036/#1037 (two gaps filed against it later). #706, #707 and
#708 have landed; the registry carries one operation and the rest of the track adds to it.

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
`GET /api/v1/openapi.json` and, from #709, in the MCP tool list, with no second place to change.
That property is the whole point of the registry and it is the thing to preserve.

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
as the tool description. It is not a changelog line.

**Declare `writes` honestly.** It is the one place that decides: #707 reads it to refuse a read-only
token, and the document says so to the agent. An operation that writes and declares `false` is a
security defect with no test that can see it — nothing checks a `writes` declaration against what a
handler does, and nothing can.

## The module layout is the Prisma-free split, and the whole track follows it

**This is the rule, not a description of how #706 happened to arrange its files.** The layer is cut
in exactly one place — **what may reach Prisma** — and every issue in this track sits on one side of
that cut or the other. The vocabulary, the parsers, the list and cursor helpers, the error helpers
and the document generator are **pure**; the registry array, which reaches handlers, is the only
server-side module. **Add to the pure side by default, and put something on the server side only
because it genuinely needs the database.** #708's name-or-id resolver, #709's registry-to-tool
generation and every operation's parameter declarations all belong on the pure side; only the
handler behind an operation does not.

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
  openapi.ts        buildOpenApiDocument + validateOperations
  registry.ts       the operations array and the path lookup
  operations/
    vocabulary.ts   the vocabulary read and its registry entry (#708)   ← server-side
```

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

**The criterion is demonstrated against fixtures on purpose.** #707's *Done when* says a `read`
token is refused on any writing operation and accepted on every reading one — and **nothing on
`main` writes**, so there is nothing to refuse it on. That premise used to be *the registry is empty
until #710*; #708 filled the registry and the conclusion is untouched, because its one operation
declares `writes: false`. #711 and #712 are where a real refusal first becomes possible.
`tests/unit/agent-api-scope.test.ts` exercises both directions over fixture operations, and
`tests/integration/agent-api-auth.test.ts` does the same over a real hashed token row, which is
where a scope actually comes from. **Adding a domain operation to make the test real would breach
the *What is deliberately absent* rule below one issue early**; a fixture is the honest instrument,
exactly as it was for #706's generator criterion.

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

## What is deliberately absent

**Absence, not a flag.** Two boundaries in this track are enforced by there being no operation, and
they must stay that way — a switch is something that can be flipped, and an operation that does not
exist cannot be.

- **The agent never publishes to a marketplace** (#711). It drafts, prices and titles an offer inside
  Stamporama; going public stays in the collector's hands. An agent that misreads costs a minute; an
  agent that mispublishes lists a stamp at the wrong price under the collector's name on someone
  else's platform.
- **The agent never reaches a counterparty** (#712). It builds and balances trade lines; it does not
  send a proposal, touch a share token, or write to Colnect.

Do not add a publish-shaped or send-shaped operation to the registry, whatever it is called.

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

**The document carries one operation.** It was empty on #706, which shipped none, and #708 added
`get_collection_vocabulary` — so `paths` is no longer `{}`. That earlier sentence is quoted rather
than deleted because it stood in four files and will go on arriving in anything copied from them:
*#706 ships no domain operation, so `paths` is `{}` — valid OpenAPI 3.1, and the honest state of the
surface until #710.* What is unchanged is that `build([])` is still the right way to ask what an
empty document looks like — that is a question about the generator, and `tests/unit/agent-api-openapi.test.ts`
asks it of a fixture list rather than of the registry.
