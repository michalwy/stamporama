# ADR-0051: A Hand-Rolled MCP Transport Rather Than the Reference SDK

## Status

Accepted, implemented in #709. It sits on [ADR-0050](0050-versioned-agent-api.md), which decided
that **REST is the contract and MCP is a thin wrapper** over one operation registry; this decides
only *how* that wrapper is built. It adds **no dependency**, no table and no migration.

**The revision implemented is `2025-06-18`**, named in `MCP_PROTOCOL_VERSION` in
`src/lib/agent-api/mcp.ts` and in [the user guide](../user-guide/agent-api.md).
<https://modelcontextprotocol.io/specification/2025-06-18/>

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

One `POST` carrying one JSON-RPC message, answered with one JSON-RPC message. `initialize`,
`tools/list`, `tools/call` and `ping`.

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
whose changelog touches the Streamable HTTP transport, `tools/list`, `tools/call` or `initialize`;
and clients repeatedly negotiating *down* at `initialize`.

### 5. Where this implementation deviates from the specification, and why

**Both deviations were found by reading the published specification rather than by remembering it**,
which is the practice this section exists to record as much as the deviations themselves. A
hand-rolled protocol has a failure mode no control can catch — **an assertion that passes because
the implementation and its test share a misreading is green either way** — and the only instrument
that separates those is the specification text. Two things came out of that reading that seven
deliberate-breakage controls did not.

**Deviation 1 — `Origin` is not validated, and that is a `MUST`.** The transport requires a server
to validate `Origin` against DNS rebinding. **The attack cannot reach this endpoint**, structurally
rather than improbably: rebinding buys the browser's *ambient* authority, and there is none here.
Every call needs an `Authorization: Bearer stmpa_…` header a page cannot obtain, and a cross-origin
request carrying one is preflighted — this route answers no CORS headers, so the browser never sends
it. An `Origin` check would refuse requests that are already refused while breaking a client that
legitimately sets one. **It is written down rather than skipped quietly, because a `MUST` a later
reader finds missing should read as a decision and not as an oversight.**

**Deviation 2 — a rejected argument comes back as a tool error, where the specification's division
puts it on the protocol side.** *Tools* §Error Handling lists *invalid arguments* under protocol
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

**And one thing deliberately not done**: no `structuredContent` beside the text. The registry
declares no output schema — an operation declares a result *description*, not a shape — and a
client that surfaces both would spend the agent's context on the same payload twice, which is the
one constraint ADR-0050 §6 is built around.

## Consequences

- **When the specification revises, the revision is ours.** That is the cost, stated plainly: there
  is no dependency bump that brings a new revision in, and no upstream maintainer tracking it for
  us. §4 is the mitigation and not a denial of it.
- **The protocol layer is unit-testable, and is unit-tested.** `tests/unit/agent-api-mcp.test.ts`
  holds the handshake, tool generation, argument routing, the error split and the scope ordering
  over fixture operations, without a database.
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
