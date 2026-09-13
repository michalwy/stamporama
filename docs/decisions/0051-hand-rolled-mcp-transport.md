# ADR-0051: A Hand-Rolled MCP Transport Rather Than the Reference SDK

## Status

Accepted, implemented in #709. It sits on [ADR-0050](0050-versioned-agent-api.md), which decided
that **REST is the contract and MCP is a thin wrapper** over one operation registry; this decides
only *how* that wrapper is built. It adds **no dependency**, no table and no migration.

**The revision implemented is `2026-07-28`**, named in `MCP_PROTOCOL_VERSION` in
`src/lib/agent-api/mcp.ts` and in [the user guide](../user-guide/agent-api.md), with `2025-06-18`,
`2025-03-26` and `2024-11-05` still answered (§6).
<https://modelcontextprotocol.io/specification/2026-07-28/>

It was `2025-06-18` from #709 until #1222. On 2026-09-13 the collector's own client asked for
2026-07-28 and §4's alarm logged it, which is the trigger §4 was written to produce; #1222 implemented
the revision in response, still by hand and still with no dependency.

## Context

#709 asked for a remote MCP endpoint served by the app itself. The obvious way to build one is
`@modelcontextprotocol/sdk`, the reference implementation, and **not using it is the kind of choice
that reads as reinvention to anybody who was not in the room.** That is the whole reason this
document exists: `AGENTS.md` requires an ADR for a framework, a library **or a major pattern**, and
hand-writing a protocol implementation instead of taking its reference SDK is a major pattern.

**A rejected alternative that is not written down invites the next reader to reverse it silently.**
Six months from now a session will meet `src/lib/agent-api/mcp.ts`, see a JSON-RPC dispatcher and
four method names, and conclude that the official SDK would be less code. Without the reasoning
below on file, that session is reasoning from nothing and is not wrong to.

## Decision

### 1. Hand-roll the transport; add no MCP dependency

**The transport mismatch is technical rather than a preference.** The SDK's
`StreamableHTTPServerTransport` is written against Node's `http.IncomingMessage` and
`http.ServerResponse`. A Next App Router route handler is handed a Web `Request` and must return a
Web `Response`. Using the SDK therefore means writing an adapter between the two shapes — a
Node-stream shim inside a route handler, larger than the four methods it wraps.

**And its failure mode is invisible to every check this project runs.** A half-consumed body, or a
response that never ends, is not a type error, is not a lint finding, and is not something a unit
test of pure logic can see. That is the never-alone list's second criterion
(`collaboration.md`, *Automerge is the one exception*) applied to a dependency choice rather than to
a bump: **ask what failure modes the five required checks cannot see**, and prefer the design where
the answer is *none of the interesting ones*.

**`mcp-handler` is a second dependency on top of the first.** It is the wrapper the ecosystem
reaches for to solve exactly the mismatch above, so the honest comparison was never *SDK versus
hand-rolled*.

**The never-alone arithmetic finishes it.** An SDK at 0.x, tracking a specification that has revised
its transport twice in a year, is a `renovate.json` never-alone entry **by construction** — its
failure modes are invisible to the required checks, which is that list's own test. So the real
comparison is *SDK + adapter + a standing never-alone entry a person must review on every bump*
against *a pure module a unit test holds*.

### 2. The deciding reason is the track's own rule, not taste

**Hand-rolled, the protocol layer sits on the pure side of the Prisma-free split**
(`agent-api.md`, *The module layout is the Prisma-free split*). `src/lib/agent-api/mcp.ts` imports
no registry, no Prisma and no `next/server`: the operations arrive as an argument, exactly as they
do for `buildOpenApiDocument`. So `pnpm test:unit` holds **the whole protocol layer** — the
handshake, the tool schemas, the argument routing and the error mapping — and
`src/app/api/mcp/route.ts` is left holding only what genuinely needs a request.

An SDK transport puts the protocol behind a Node-stream boundary that only the integration suite
could reach. **That is the track's stated rule making this choice**, and it is the reason an
outsider would never guess from the diff.

### 3. Streamable HTTP, stateless

One `POST` carrying one JSON-RPC message, answered with one JSON-RPC message. For a 2026-07-28
client, `server/discover`, `tools/list` and `tools/call`; for a legacy client, `initialize`,
`tools/list`, `tools/call` and `ping` (§6).

**No `Mcp-Session-Id`.** A session id is something a server *may* assign; there is no session state
to key here, because the tool list is compiled into the build and every call is authorised from its
own `Authorization` header. `GET` and `DELETE` are refused with `405`, which is the answer the
specification names for a server offering no SSE stream and for one that does not let a client
terminate a session. **Batching is refused** because the body of a POST must be a single JSON-RPC
message in this revision.

### 4. The revision is pinned, and the staleness alarm is the specification's own requirement

This is the cost in §Consequences taken seriously rather than noted. A hand-rolled implementation of
a moving specification diverges **silently**: the failure is a client that stops connecting months
later with nothing in this repository having changed.

So: **the revision is named** in `MCP_PROTOCOL_VERSION`, in this ADR's Status, and in the user
guide. And the endpoint reports its own drift — a client sending an `MCP-Protocol-Version` header
for a revision this build does not speak is refused with `400` **and the refusal is logged, naming
this ADR**. That refusal is the specification's own `MUST`, so conformance and the alarm are the
same line of code: **the first client newer than this build is the thing that notices**, and it says
so in the server log rather than failing for a reason nobody can see.

Two weaker signals, recorded so that the first is not mistaken for the only one: a new revision
whose changelog touches the Streamable HTTP transport, `server/discover`, `tools/list`, `tools/call`
or the per-request `_meta` fields; and legacy clients repeatedly negotiating *down* at `initialize`.

**It fired as designed on 2026-09-13** (#1222): a real client asked for 2026-07-28, the refusal named
this ADR in the server log, and MCP went on working for the collector
throughout. That is the whole argument of this section proven once, and it is why the alarm stays
after #1222 rather than being retired with the revision that raised it. The refusal is now
`UnsupportedProtocolVersion` (`-32022`) with `data: { supported, requested }`, the shape 2026-07-28
fixes, answered to every era — the legacy revisions ask only for a `400`, and a dual-era client reads
exactly that body to tell a modern server that wants another revision from a legacy one. The logging
stays in the route; the decision to refuse moved into the pure module with the rest of the header
rules.

### 5. Where this implementation deviates from the specification, and why

**Every deviation here was found by reading the published specification rather than by remembering
it**, which is the practice this section exists to record as much as the deviations themselves. #709
read 2025-06-18; #1222 read 2026-07-28 — the changelogs since 2025-06-18, *Versioning*, *Streamable
HTTP*, *Discovery*, *Tools*, *Caching*, the base protocol page and `schema.ts` — which re-confirmed
Deviation 1 (the requirement stands; 2025-11-25 only added `403` as the answer to an invalid
`Origin`), retired most of Deviation 2, and found Deviation 3, which #709's reading had passed over. A
hand-rolled protocol has a failure mode no control can catch — **an assertion that passes because
the implementation and its test share a misreading is green either way** — and the only instrument
that separates those is the specification text. #709's two deviations came out of that reading when
seven deliberate-breakage controls had not, and #1222's third came out of it the same way.

**Deviation 1 — `Origin` is not validated, and that is a `MUST`.** The transport requires a server
to validate `Origin` against DNS rebinding. **The attack cannot reach this endpoint**, structurally
rather than improbably: rebinding buys the browser's *ambient* authority, and there is none here.
Every call needs an `Authorization: Bearer stmpa_…` header a page cannot obtain, and a cross-origin
request carrying one is preflighted — this route answers no CORS headers, so the browser never sends
it. An `Origin` check would refuse requests that are already refused while breaking a client that
legitimately sets one. **It is written down rather than skipped quietly, because a `MUST` a later
reader finds missing should read as a decision and not as an oversight.**

**What would make this wrong, named because the argument rests on a property of the deployment
rather than on a property of MCP.** The reasoning above holds only while `/api/mcp` has **no
ambient authority to steal**, and each of the following retires it completely:

- **Any unauthenticated or session-authenticated path on this endpoint.** A Better Auth cookie is
  ambient by definition — the browser attaches it without the page asking — so accepting one here
  hands a rebound page exactly the authority this argument says does not exist. ADR-0050 §2 refuses
  a session on `/api/v1` for an unrelated reason (it covers every collection its user owns), and
  that refusal is load-bearing here too.
- **Any CORS headers on this route.** An `Access-Control-Allow-Origin` paired with
  `Access-Control-Allow-Headers: authorization` is what makes the preflight stop being a barrier.
- **Any credential a browser sends by itself** — the token moving into a cookie, or being accepted
  from a query parameter, both of which remove the step a page cannot perform.

**Whoever makes one of those changes owns the `Origin` check**, and the change is the moment to
implement it rather than to re-derive this paragraph. That is the honest risk in this deviation: it
is not that the analysis is wrong today, it is that **the change which invalidates it is one nobody
would think to weigh against an ADR about `Origin`** — so it is named here, in the section that
would otherwise only say why the check is unnecessary.

**And this one is the owner's to ratify rather than a session's to settle.** Deviating from a
security `MUST` is a decision about his posture, not an implementation detail; it was raised for
ratification on 2026-09-11, with the analysis above as what he is ratifying. Nothing else in this
ADR has that character.

**Deviation 2 — a rejected argument comes back as a tool error, where 2025-06-18's division puts it on
the protocol side.** *A deviation now only towards a client on 2025-06-18 or earlier* (#1222):
revision 2025-11-25 (SEP-1303) moved **input validation errors** to the tool-execution side so that a
model can correct itself, and 2026-07-28's *Tools* §Error Handling keeps them there — so for a modern
client this is the specification's own split. What follows is the reasoning as #709 recorded it, kept
because it still governs the legacy half and because the specification reached the same conclusion
for the same reason. *Tools* §Error Handling lists *invalid arguments* under protocol
errors and *invalid input data* under tool execution errors; a missing required parameter or a wrong
type lands on its protocol side. Here only an unknown tool, an unknown method and a malformed
message are JSON-RPC errors; everything an agent could act on is a tool error.

**The reason is `accepted`.** ADR-0050 §6 makes an error carry the values that would have worked,
and it is the field that turns a refusal into a correction the agent makes in one turn. In a tool
error it reaches the model inside the text it reads; in a JSON-RPC error it lives in `error.data`,
which is the client transport's to render and which many clients drop. Following the division
exactly would put **the most common recoverable mistake an agent makes** — a guessed parameter name
— in the one channel where the list of real names may never be seen. The specification's wording
there is descriptive rather than a `MUST`, so this is a choice it leaves open.

**Deviation 3 — tool invocations are not rate limited, and that is a `MUST`** (found in #1222; the
requirement is in both 2025-06-18's and 2026-07-28's *Tools* §Security Considerations, and #709 did
not record it). **Every call on this endpoint already carries a credential the collector minted by
hand**, for one collection, revocable at once from Settings → Assistant, on a self-hosted instance
with one collector on it. `rate-limit.ts` exists and states its own premise — it is for the surface
reachable *without* a session, because behind sign-in the account is the limit — and a bearer token
the collector issued to their own client is that premise, not an exception to it: what a rate limit
would stop is the collector's own agent, and the remedy for a runaway one is revoking its token. **The
owner ratified this on 2026-09-13**, for the reason Deviation 1 was ratified: departing from a
security `MUST` is a decision about the owner's posture, not an implementation detail.

**What would make this wrong**, named for the same reason Deviation 1 names it:

- **A token that reaches anyone other than the collector's own client** — a token shared with a
  partner, a published one, or any mint that is not the collector's deliberate act.
- **More than one person's agent on one instance.** One collector's agent exhausting the instance is
  that collector's problem; one person's agent exhausting another's is not.
- **Any path on this endpoint that runs without a token** — the same retirement as Deviation 1's
  first bullet.

**Whoever makes one of those changes owns the rate limit**, and `rate-limit.ts` keyed on the token is
where it starts.

**And one thing deliberately not done**: no `structuredContent` beside the text. The registry
declares no output schema — an operation declares a result *description*, not a shape — and a
client that surfaces both would spend the agent's context on the same payload twice, which is the
one constraint ADR-0050 §6 is built around.

### 6. Two eras on one endpoint (#1222)

Revision 2026-07-28 made MCP stateless: no `initialize`, no `ping`, every request carrying its
revision and the client's capabilities in `params._meta` and mirroring its method and tool name into
`Mcp-Method` / `Mcp-Name` headers, a required `resultType` on every result, `server/discover` as a
`MUST`, and required caching hints on `server/discover` and `tools/list`. **#1222 made this a
*dual-era* server** in the specification's own terms rather than dropping the older revisions, because
a client that works today must keep working.

- **The era is chosen per request.** Modern when the `MCP-Protocol-Version` header names 2026-07-28
  **or** the body declares a revision in `_meta` — the second half so that a body declaring
  2026-07-28 with no header is refused as a header mismatch instead of being served under legacy rules
  it did not ask for.
- **The legacy era is answered byte for byte as before**, and a unit test asserts the keys of a legacy
  result so that a modern field cannot leak into it silently.
- **A legacy `initialize` is answered with the newest legacy revision**, never with 2026-07-28, even
  when a client asks for it: the answer has to be a revision with a handshake.
- **The caching hints are `ttlMs: 0` and `cacheScope: "private"`.** `private` because the tool list is
  the list of things a valid token could do, which ADR-0050's document requires a token to read;
  `0` because the list changes only with a deploy this build cannot foresee.
- **The header rules sit on the pure side**, with the handshake. §2's argument applies to them
  unchanged: `pnpm test:unit` holds which header is required, what a mismatch is and how a Base64
  `Mcp-Name` decodes, and the route reads headers and writes the log.
- **Deliberately not implemented, because nothing here needs them**: `subscriptions/listen` (the tool
  list cannot change while the process runs, so `listChanged` stays `false`), multi round-trip
  requests, `x-mcp-header`, SSE responses, and the tasks extension. #1222 scoped the revision to
  answering it correctly, and none of these is a `MUST` for a server that does not use them.

## Consequences

- **When the specification revises, the revision is ours.** That is the cost, stated plainly: there
  is no dependency bump that brings a new revision in, and no upstream maintainer tracking it for
  us. §4 is the mitigation and not a denial of it.
- **The protocol layer is unit-testable, and is unit-tested.** `tests/unit/agent-api-mcp.test.ts`
  holds the handshake, tool generation, argument routing, the error split and the scope ordering
  over fixture operations, without a database — and since #1222 both eras, the 2026-07-28 header and
  `_meta` rules and the unsupported-revision refusal the alarm is logged from.
- **Two wrappers, one validator.** `buildToolList` and `buildOpenApiDocument` both run
  `validateOperations` and both render a `ParameterSpec` through the same `parameterSchema`, so
  neither can come to disagree with the other about what a publishable entry is.
- **There is nothing to review on a dependency bump**, because there is no dependency. The
  never-alone list is unchanged by this issue.
- **Adopting the SDK later is not blocked.** The protocol layer is a pure function from a message to
  a message behind a route; replacing its internals is a contained change, and this ADR is what such
  a session should read first — the transport mismatch, not the quality of the SDK, is what to
  re-check.

## Alternatives considered

- **`@modelcontextprotocol/sdk` directly.** Rejected in §1: the transport is written against Node
  stream objects an App Router handler does not have, the adapter is larger than what it wraps, its
  failure modes are invisible to all five required checks, and it moves the protocol off the pure
  side of the split.
- **`@modelcontextprotocol/sdk` plus `mcp-handler`.** Rejected in §1: two dependencies to solve a
  mismatch that four methods of hand-written JSON-RPC do not have.
- **A separate MCP process beside the app.** Rejected by #709 before this: the endpoint is served by
  the app so there is nothing extra to run beside the existing container, and a second process would
  need its own copy of the registry or a network hop to reach it — the second place to edit that
  ADR-0050 §3 exists to remove.
- **Supporting SSE and sessions.** Rejected for now: nothing here pushes to a client, so a stream
  would be an open connection that never sends. `GET` returning `405` is the answer the
  specification names for exactly this server, and adding SSE later changes no decision above.
- **MCP resources and prompts.** Out of scope in #709, and *tools first* rather than a boundary —
  unlike ADR-0050's publish- and send-shaped absences, these are worth adding the moment a concrete
  need appears.
