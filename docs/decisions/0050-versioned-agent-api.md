# ADR-0050: A Versioned Agent API Beside the Screen API, Generated From One Registry

## Status

Accepted, and the whole track is implemented: #706 (the foundation), #707 (token scopes), #708 (the
collection vocabulary, which put the registry's first operation in it), #710 (collection reads),
#711 (offers, short of publishing) and #712 (wants, checklists and trades, short of sending). The
registry carries **twenty-five** operations, eight of which write. Two gaps filed against the track
afterwards are still open — #1036 (auction reads) and #1037 (resolving foreign catalog-number
strings). The MCP wrapper over this same registry is #709, landed — **how** it is built, and why it
takes no dependency, is [ADR-0051](0051-hand-rolled-mcp-transport.md).

It rests on #253 (`AssistantToken`) and on `src/lib/route-auth.ts`, and it adds **no table and no
migration**.

## Context

Stamporama should be usable by an agentic AI client. The first named consumer is the collector's
own: every day Allegro mails him about new listings in the categories he follows, and reading it by
hand is expensive for two reasons — almost every listing has to be checked against the collection
(do I hold this, is it on a want list, is the starting price below what Stamporama would recommend),
and the catalog numbers in listings arrive in formats that are not the ones here. The agent's job is
to read the mail, ask Stamporama about each listing, and report what is worth his attention. **It
only reads.** It does not create auctions, at least at this stage.

The app already has well over a hundred route handlers under `/api/collections/[collectionId]/…` —
`git ls-files | grep -c '^src/app/api/collections/.*/route\.ts$'` answers it, and the count is given
as a command rather than a figure because it moves every few days. #706's own issue body says 117
and `main` carried **124** on 2026-09-10; nothing in this decision turns on which.

They look like an API and they are not one: they are **screen endpoints**, shaped for TanStack
Query, for cursor pagination, and for the needs of one particular table. `GET …/items` returns what
the copies list draws, which is why it carries the fields it does. Freezing that as a public contract
would stop the UI changing, which is the opposite of what those routes are for.

So an agent needs a different surface over the same domain layer in `src/lib/`: narrower, stable,
and **described**, because an agent that cannot read the surface has to guess at it.

## Decision

### 1. A separate versioned namespace, `/api/v1/…`, beside the screen API

`/api/v1` is a contract: once an operation is published there it only ever grows, and a break is
`/api/v2`. The screen API stays unversioned and free to change with the screens.

The alternative — versioning the existing routes — was rejected because it prices every UI change at
a contract change, and because the two surfaces want different shapes anyway (see §5).

### 2. No collection id anywhere in the path

An Assistant token is pinned to exactly one collection. `resolveCollectionOwner` has rejected a
token issued for another collection since #253, so a collection id in the path would be a value the
caller supplies, that we then check against the credential, and that can only ever be right or
wrong — never useful. `GET /api/v1/items` is enough.

This removes a whole class of agent mistake and one value the agent would otherwise have to obtain
from somewhere.

**The consequence the issue body does not state is that `/api/v1` cannot call
`resolveCollectionOwner` at all**, and it is the same reasoning one step on rather than a second
decision. That function is handed a collection and asks whether the credential covers it, which is
what a screen route wants because it knows its collection from the URL; with no id in the path there
is nothing to hand it. So this issue adds a **sibling**, `resolveAgentApiCaller`, running the
comparison the other way round — and **every issue in this track inherits it**: #707 hangs scope
enforcement on it, and #708 through #712 reach their collection through it and through nothing else.

Adding it beside `resolveCollectionOwner` rather than widening that function is deliberate: the
screen routes depend on the existing shape, they are untouched, and they go on accepting a session
or a token as they always have.

**It is also what makes `/api/v1` token-only.** `resolveAgentApiCaller` does not accept a Better
Auth session — a session covers every collection its user owns, so a session caller would have no
way to say which collection it meant, and the id would have to come back into the path. A browser
that wants this surface mints a token like any other agent.

### 3. One operation registry, two wrappers

An operation is a plain TypeScript object: a name, an English description, parameter declarations, a
result declaration, and a handler that calls `src/lib/`. `src/lib/agent-api/registry.ts` holds the
array. **The OpenAPI document at `GET /api/v1/openapi.json` and the MCP tool list (#709) are both
generated from it**, and neither is hand-maintained.

The reason is drift, and it is the load-bearing decision here. Two hand-written descriptions of one
surface agree on the day they are written and disagree within months, silently: the document goes on
describing an operation whose parameters moved, and the agent goes on believing it. There is no
required check that could see that, because both halves compile.

`buildOpenApiDocument` is therefore a **pure function of the operation list**, which is also what
makes the claim checkable while this issue ships no operations of its own: a unit test builds a
document from a fixture operation and traces every part of it back to the declaration.

**A single dispatcher serves the whole namespace** — one catch-all route matching the request
against the registry's path templates — rather than a route file per operation, because a route file
per operation is exactly the second place to edit this design exists to remove.

### 4. No new validation library

The project uses none — no zod, no valibot, anywhere — and introducing one purely to generate a spec
is an ADR-level dependency for something four parameter types and a hundred lines of hand-written
parsing answer. The types are `string`, `integer`, `boolean` and `string[]`; anything richer is a
**vocabulary**, and a vocabulary is a list of accepted values on the parameter, which #708 extends
to the collection's own configurable ones.

### 5. Task-shaped verbs, not CRUD

Operations read like `find_unlisted_copies`, not `GET /items` with eighteen filter parameters. An
agent resolves a wide parameter surface by guessing and a named task by reading — and a named task
is also what the MCP tool list wants, since a tool with eighteen optional arguments is a tool a model
uses wrongly.

### 6. The response conventions, and the one that is not obvious

The binding constraint on this surface is **the agent's context window**, not bandwidth. That is the
reason behind each of these, and it is worth stating because the conventions look arbitrary
otherwise:

- **Flat, short fields.** No nested trees, no field a screen needs and a reader does not.
- **A hard default limit with a cursor on every list** — `DEFAULT_LIST_LIMIT` when the caller asks
  for no size, `MAX_LIST_LIMIT` as a cap the caller cannot raise, both in
  `src/lib/agent-api/list.ts` and stated in figures nowhere but `docs/agents/agent-api.md`. The cap
  is hard because the caller most likely to raise it is an agent optimising its own round trips,
  which is the caller least able to read the result.
- **Every list response states the full `total`.** This is the one that is not obvious and it is the
  important one: an agent handed one page and no total cannot tell it from the whole
  collection, so it answers confidently about a slice. The total is what makes a trimmed answer
  visibly trimmed.
- **Photos are URLs, never bytes.** An inlined image is the single most expensive thing that could
  enter an agent's context. The URL is the app's existing photo route, which already takes the same
  bearer token, so the agent's own credential opens it.
- **An error carries a stable code, one English sentence saying what to do next, and — where a value
  was rejected against a closed set — the values that would have been accepted.** The third is what
  lets an agent correct itself in one turn instead of retrying blind, which is why it lives in the
  shared error helper rather than in each handler.

The same argument produces one thing the screen API does not do: **an undeclared query parameter is
rejected rather than ignored**, and the rejection names the parameters that do exist. An agent that
guessed `filter=` and was silently ignored receives a plausible answer to a question it did not ask,
with nothing to tell it so.

### 7. The document requires the same token as the operations

`/api/v1/openapi.json` carries no collection data — it is the same bytes for every caller of a given
build — so this is not about the secrecy of its content. It is that a self-hosted instance is often
reachable from the internet, and publishing the list of things a valid token could do buys an
unauthenticated reader something and buys the collector nothing: the agent that needs the document
already holds a token.

### 8. The MCP wrapper is hand-written, and that is its own decision

§3 said *two wrappers* and left open how the second one is built. **It is a hand-written module
rather than `@modelcontextprotocol/sdk`** (#709), and the deciding reason is the Prisma-free split:
hand-rolled, the protocol layer is a pure function of an operation list, so `pnpm test:unit` holds
the whole of it, where an SDK transport — written against Node stream objects an App Router handler
does not have — would sit behind a boundary only the integration suite could reach. **The cost is
that a specification revision is ours to implement**, which is why the revision is pinned and the
endpoint reports its own drift.

**This section is a finding aid and not the argument.** It is here because a reader asking *was this
decided, or did it merely happen* looks in `docs/decisions/`, and the answer would otherwise have
lived only in a topic file. The reasoning is in
**[ADR-0051](0051-hand-rolled-mcp-transport.md)** — the alternatives, the never-alone arithmetic,
and the two places the implementation deviates from the specification — with the working detail in
[`agent-api.md`](../agents/agent-api.md). Do not restate any of it here: prose that points does not
drift; prose that copies does.

## Consequences

- **`src/lib/agent-api/` is split by what may reach Prisma, and the split is not stylistic.**
  `types.ts`, `errors.ts`, `params.ts`, `list.ts`, `path-template.ts`, `photo-url.ts` and
  `openapi.ts` are pure and carry no `server-only`, so `pnpm test:unit` can hold them —
  `tests/unit/unit-suite-purity.test.ts` walks that suite's import graph and fails on any path
  reaching the generated client. Only `registry.ts` and the two route files are server-side.
- **The import direction is one-way**: the registry imports operation modules; an operation module
  imports the types and helpers beside it and never the registry. A registry importing handlers that
  import the registry back is the `src/lib` cycle that typechecks, passes every test, and then throws
  `Cannot access 'X' before initialization` at module-init in the real app (#658, `platform.md`).
- **Nothing in `tests/unit/` may import `registry.ts`.** It carries handlers, so it reaches Prisma —
  live since #708, rather than pending as this bullet first read. What is worth unit-testing is the
  machinery, and all of it is reachable without that file; a real operation is exercised end to end
  by the integration suite.
- **A malformed registry entry fails loudly rather than producing a wrong document.**
  `validateOperations` runs from `buildOpenApiDocument`, so it cannot be skipped: duplicate names,
  duplicate method-and-path bindings, a `{param}` with nothing declaring it, a body parameter on
  `GET`, and a list operation redeclaring the shared window parameters are all refused.
- **This issue ships no operation, so the published document has an empty `paths` object.** That was
  valid OpenAPI 3.1 and the honest state of the surface when #706 landed. **It is no longer the
  state**: #708 added `get_collection_vocabulary`, so the first operation arrived before #710; #710
  added six reads over the collection, #711 six offer verbs and #712 twelve more, and the document
  now carries twenty-five. The consequence is left as written, dated to this ADR's own issue, with
  the correction beside it — and *#710 has since added six reads over the collection* is what that
  correction said until #712, quoted for the same reason.
- **§5's task-shaped rule was exercised by every later issue and refined three of their verb lists,
  which is the rule working rather than three deviations.** #710's five verbs became six and one
  moved onto a row; #711 added `list_offers` and `get_offer` because nothing on this surface reaches
  an offer id; #712 added `list_trades` for that same reason, added `create_trade` because its own
  *Done when* asks for a trade to be left behind, and left out a *set a line's manual value* verb
  because an agent reaching for one would be clearing a valuation gate rather than balancing a
  trade. Each issue's verb list called itself *a starting set to refine during implementation*, and
  refining it against the domain is what the rule is for.
- **No schema change and no migration.** #707 owns the one this track needs.

## Alternatives considered

- **Version the existing screen routes.** Rejected in §1: it prices every UI change at a contract
  change.
- **MCP first, REST second.** Rejected: a REST client holding the OpenAPI document needs nothing
  further, so MCP is a question about which client the collector runs rather than a step in the
  workflow. Building it first would also have made the tool list the source of truth, which is the
  hand-maintained list §3 exists to avoid.
- **Per-operation route files.** Rejected in §3.
- **A validation library to generate the schema.** Rejected in §4.
- **Publishing the document unauthenticated.** Rejected in §7.
