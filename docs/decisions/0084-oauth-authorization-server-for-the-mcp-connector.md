# ADR-0084: The App Is Its Own OAuth Authorization Server, So That `/api/mcp` Can Be a Connector

## Status

Accepted, implemented in #2715. Requested by the owner on 2026-11-27: the MCP server is to work as
a custom connector in claude.ai, as two of his other projects already do. It sits on
[ADR-0050](0050-versioned-agent-api.md) (REST is the contract, MCP a thin wrapper) and
[ADR-0051](0051-hand-rolled-mcp-transport.md) (the transport is hand-written), and follows the
second one's reasoning. It adds **no dependency**, **three tables** and one migration that touches
nothing existing.

## Context

Until #2715 the only credential `/api/mcp` took was an Assistant token (`stmpa_…`) the collector
mints in Settings and pastes into a client's configuration. claude.ai's connectors cannot use that:
a connector is added **by address alone**, and the client then expects the server to tell it where
to sign in. In the MCP authorization specification's terms the endpoint is an OAuth 2.1 *protected
resource*, and the client needs:

- a `401` whose `WWW-Authenticate` names the **protected-resource metadata** (RFC 9728);
- **authorization-server metadata** (RFC 8414) reached from it;
- **dynamic client registration** (RFC 7591), because the client has never heard of this instance;
- the **authorization-code grant with PKCE**, behind a sign-in and a consent screen;
- **refresh tokens**, so the connection outlives an hour.

The agent API behind the endpoint is authorised by three facts read off the credential — whose
account, which **one** collection, and `read` or `read_write` (ADR-0050 §2, #707). Whatever is added
has to arrive at those three facts or the whole surface changes shape.

## Decision

### 1. The app issues the tokens itself, by hand, with no new dependency

Better Auth, which the app already uses for sign-in, ships an OAuth-provider plugin with an MCP
flavour. It is not used, for three reasons that are ADR-0051's own, one step on:

- **Its tokens name a user, and this surface needs a collection.** A session, or a user-scoped
  token, covers every collection its user owns; ADR-0050 §2 refuses sessions on `/api/v1` for
  exactly that. Using the plugin would mean a second mapping from its token to a collection and a
  scope, kept somewhere beside it — the consent screen and the storage this ADR adds anyway, plus
  the plugin.
- **Its failure modes are invisible to the five required checks.** A plugin that owns the token
  endpoint is a moving part whose behaviour changes on a dependency bump, in the one place where a
  silent change is a security change. That is the never-alone criterion (`collaboration.md`).
- **What is needed is small and almost entirely pure.** Four RFCs' worth of *rules* — which redirect
  URI is acceptable, what a registration must say, which request is answered where, PKCE, what a
  reused refresh token means — are functions of their inputs. They live in `src/lib/oauth-rules.ts`
  and `pnpm test:unit` holds all of them; `oauth-server.ts` stores and claims rows and decides
  nothing; the routes read a request and write a response.

**Sign-in stays Better Auth's.** The authorization screen is an ordinary page behind the ordinary
session: a browser without one is sent to `/sign-in` with the request as its return address (#1176)
and comes back. **Nothing in the flow creates an account** — it is for the accounts the instance
has, which is what the owner's instance wants now that registration is being closed.

### 2. A grant is one app, one account, one collection, one scope

The consent screen asks the two things an Assistant token's mint asks: **which collection**, and
**read only or read and write**. The answer is an `OAuthGrant` row, and an access token verifies to
`{ ownerId, collectionId, scope }` — the same three facts, so `resolveMcpCaller` hands the route an
`AgentApiCaller` either way and **nothing behind that line can tell which credential arrived**. No
operation changed; `assertAgentApiScope` is still the one place a scope is checked.

- **The collector chooses the scope, not the client.** A client that asks for `read` alone is offered
  only that; any other request leaves both on offer, widest preselected, as the token form does.
- **A call acts as the account that allowed it, and only while it still owns the collection.** The
  grant names both, and they are compared on every call and every refresh.
- **Allowing the same app again for the same collection replaces its grant**, so Settings never
  shows two rows the collector would have to tell apart. Two collections are two connections.
- **`/api/v1` does not take the OAuth token.** It was issued for one resource — `resource` is checked
  at the authorization and token endpoints (RFC 8707) — and a token honoured where it was not issued
  for is what audience binding exists to prevent. `resolveAgentApiCaller` is untouched.

### 3. What is implemented, and to which document

| Piece | Where | Notes |
| --- | --- | --- |
| Protected-resource metadata, RFC 9728 | `/.well-known/oauth-protected-resource` and `…/api/mcp` | One resource, so both forms answer the same document |
| Authorization-server metadata, RFC 8414 | `/.well-known/oauth-authorization-server` | The issuer is the instance's base address, which has no path |
| Dynamic client registration, RFC 7591 | `POST /api/oauth/register` | Public clients only; the reply says `none` whatever was asked |
| Authorization endpoint | `/oauth/authorize` | `code` only, PKCE `S256` only, `state` returned, `iss` added (RFC 9207) |
| Token endpoint | `POST /api/oauth/token` | `authorization_code` and `refresh_token` |
| Revocation, RFC 7009 | `POST /api/oauth/revoke` | Either token ends the grant |

The instance's own address is `BETTER_AUTH_URL` — the setting a deployment already has to get right —
falling back to the request's origin on an install without it.

**Every secret is stored as its SHA-256 and shown once**, as `api-tokens.ts` does: the code
(`stmpoc_`, two minutes, one use), the access token (`stmpoa_`, one hour) and the refresh token
(`stmpor_`, until disconnected).

### 4. Refresh tokens rotate, with a minute's grace

OAuth 2.1 asks a public client's refresh token to be rotated, and a rotated token presented again to
be treated as stolen. Both are done — a replay ends the grant — **except for sixty seconds after a
rotation**, during which the previous token is answered with a fresh pair. A client whose answer was
lost on the way, or whose two conversations refreshed at the same moment, would otherwise lose a
connection the collector then has to make again by hand; the window is short enough that a thief
would have to be inside it. `classifyRefresh` is the whole rule.

**A refresh token does not expire on a clock.** A session here lasts until the collector signs out
(ADR-0052), and a connection lasts until it is disconnected — in Settings → Assistant & API, or by
the app itself.

**A code presented twice ends the grant its first use made** (OAuth 2.1 §4.1.3): the row is kept
until it expires, with the grant it produced, for exactly that.

### 5. What is open to the internet, and what stands in front of it

Registration is open by design — that is what *dynamic* means — and the token and revocation
endpoints take no credential but the one being exchanged. So:

- **A registration grants nothing.** It is a name and redirect URIs; it can do nothing until a
  signed-in collector allows it. The consent screen shows the name the app gave **and the host the
  browser will be sent back to**, which is the one fact about itself an app cannot choose freely.
- **A redirect URI is `https`, or `http` on loopback** (RFC 8252 §7.3, any port), with no fragment.
  Private schemes are refused: one cannot be told from `javascript:`.
- **An unknown client or an unregistered redirect URI is answered on the page and the browser is
  sent nowhere**; only after both are established is a fault reported at the redirect URI. The order
  is what keeps the endpoint from being an open redirector.
- **All three endpoints are rate limited per address** (`oauth-http.ts`, on `rate-limit.ts`), which is
  that module's own premise: a surface reachable without a session.
- **Registrations nobody ever allowed are swept after a day.** One that was allowed even once is
  kept, connected or not, because the app goes on presenting that `client_id`.
- **The consent screen cannot be framed** (`X-Frame-Options` and `frame-ancestors`, in
  `next.config.mjs`).

### 6. ADR-0051's two security deviations, re-read

ADR-0051 §5 deliberately implements neither `Origin` validation nor rate limiting on `/api/mcp`, and
names what would make each wrong. Both lists were re-read against this change:

- **Deviation 1 (`Origin`) stands.** Its three retirements are a session-authenticated path, CORS
  headers, and a credential a browser sends by itself. The OAuth access token is none of them: it is
  a bearer header a page cannot obtain, the route still answers no CORS headers — **nor does any
  OAuth endpoint**, which is why a browser-based MCP client cannot connect and claude.ai, calling from
  its own servers, can — and nothing moved into a cookie or a query parameter. The consent screen
  *is* session-authenticated, and is a page and a server action, which Next checks for origin; it is
  not on the MCP endpoint.
- **Deviation 3 (rate limiting tool calls) stands, with its premise restated.** Its first retirement
  is *a token that reaches anyone other than the collector's own client*, *or any mint that is not
  the collector's deliberate act*. A grant is a deliberate act — the collector signs in and presses
  Allow, for one app — and is revoked in the same panel as a token. The second, *more than one
  person's agent on one instance*, is no nearer than it was: each account's grants reach only its own
  collections. **If the instance ever serves collectors who do not trust each other's load, both the
  OAuth grant and the Assistant token meet that retirement together.**

## Consequences

- **A connector is added by address.** `https://<instance>/api/mcp` in claude.ai's *Add custom
  connector*, then sign in and choose. The instance has to be reachable from the internet at the
  address in `BETTER_AUTH_URL`; that was already true of any hosted client.
- **Two credentials on one endpoint, one authorisation behind it.** The Assistant token is unchanged
  for the extension, scripts and hand-configured clients.
- **The OAuth revisions are ours to track**, as the MCP revisions are (ADR-0051 §4). The rules are
  pure and unit-tested, so a change is contained; there is no bump that brings one in.
- **Not implemented, because nothing here needs it**: confidential clients and client secrets, Client
  ID Metadata Documents (the server would have to fetch an address a stranger names), OpenID Connect,
  token introspection, and CORS. Each is an addition rather than a reversal.
- **What no check here establishes** is that claude.ai itself connects: the suites drive the route
  handlers, not a real client over a socket. The owner verifies that on the live instance.

## Alternatives considered

- **Better Auth's OAuth-provider / MCP plugin.** Rejected in §1.
- **A user-scoped token and a `collection` argument on every tool.** Rejected: it is the id ADR-0050
  §2 removed from the surface, one more thing an agent can get wrong on every call, and it would
  make the two credentials behave differently behind the same endpoint.
- **Minting an `AssistantToken` as the access token.** Rejected: an Assistant token has no expiry and
  no client, and a refresh flow needs both; the row would have had to grow into a grant anyway, and
  the Settings list would have mixed things the collector made with things an app made.
- **A separate authorization service.** Rejected as ADR-0051 rejects a separate MCP process: nothing
  extra runs beside the container.
