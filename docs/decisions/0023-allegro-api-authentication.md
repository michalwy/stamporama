# ADR-0023: Allegro API Authentication and Secrets at Rest

## Status

Accepted

## Context

Allegro is extension-only in this app today. The platform module (#355) carries the **capture**
half and nothing else, and everything the Assistant reads off allegro.pl reads the page's own
JSON because the markup is hashed per build. That is enough to record a lot the collector is
bidding on. It is not enough for the two things the backlog wants next — a sold-listing worklist
(#467) and a `Sale` created from an order (#463) — because those need the seller's *own* offers
and orders, which carry the buyer, the delivery method and the payment status, none of which a
listing page shows.

Allegro publishes a REST API (`api.allegro.pl`) covering exactly that. It returns the offer id
rather than a URL to be matched at its boundaries, and it is stable in a way no page is. This ADR
settles how the instance authenticates against it. It ends at *connected*; reading business data
is #467's and #463's.

The constraint that shapes everything is **self-hosting**. No client credentials can ship with
Stamporama: an OAuth client id and secret published in a public image would be one shared
application for every install, revocable by anyone and rate-limited as one caller. Each instance
therefore registers its own application at `apps.developer.allegro.pl`, and the credentials become
data the collector enters — which is what forces the questions below.

## Decision

### 1. Device code flow is the default; authorization code is the alternative

The **device code flow** is offered first and works everywhere. The instance asks Allegro for a
code, shows the collector a short user code and a URL, the collector confirms in their own browser,
and the instance polls for the token. It needs no redirect URI and no publicly reachable address,
so it behaves identically on `localhost`, on a home server behind NAT and on a VPS. For a
self-hosted app whose most common deployment is a machine with no inbound DNS, that is the only
flow that can be the default.

The **authorization code flow** is offered beside it, never instead of it, for an instance that
does have a stable public address. Its redirect URI is derived from the configured app URL
(`src/lib/app-url.ts`, i.e. `BETTER_AUTH_URL`) rather than being a second setting that could
disagree with it, and the collector registers that exact URI with their Allegro application. It is
one round trip instead of a polling wait, which is worth offering to the installs that can use it.

A connection **does not record which flow made it**, and an earlier draft of this ADR was wrong to
say it must: the refresh is identical either way — same endpoint, same two parameters, no
`redirect_uri`, which belongs to the initial authorization-code exchange alone. The `grantFlow` and
`redirectUri` columns that existed only to drive that branch were removed before the first release
rather than left as stored facts nothing reads.

The one place the two flows genuinely differ in shape is the device endpoint, and it is worth
stating because it is not guessable: `POST /auth/oauth/device` takes `client_id` in the **query
string**, while every other exchange puts its parameters in the form body. Sending it in the body
is answered with *"OAuth 2.0 Parameter: client_id"* — not "wrong id" but "no id", since Allegro
never reads the body. `deviceCodeUrl()` exists so that shape is unit-tested rather than trusted.
Neither request asks for **scopes**, and that is a decision rather than an omission. Scopes are
granted at registration and nowhere else, so requesting them buys nothing — while requesting one the
application does not hold fails the *whole* authorization, and Allegro reports that failure as
*"OAuth 2.0 Parameter: client_id"* too. Two different faults arriving under one misleading message
is what made this the expensive part of #476 to get right.

The trade-off accepted here is that a token carries whatever the registered application carries,
rather than a narrower set this app asks for. That is a real loss of least-privilege — but the
application is one the collector registers *for Stamporama*, so over-granting is theirs to avoid at
the only place it is visible, and the alternative is a setup step that fails opaquely whenever the
two lists drift.

### 2. Secrets are encrypted at rest with a key from the environment

`api-tokens.ts` is the only precedent in this repo and it does not transfer: it stores SHA-256
hashes, because an Assistant token is only ever *verified*. A refresh token is **replayed**, so a
hash is useless — it has to come back out in the clear.

Three options were considered:

- **Plain columns.** The collector owns the database, so the argument is that nothing is gained.
  But a database dump is a routine, freely-copied artefact in a self-hosted install — it goes to a
  backup disk, into a support paste, onto another machine for a restore test — and plaintext
  columns would put live Allegro credentials into every copy of it.
- **Client secret in the environment, tokens in the database.** Fewest secrets in the database,
  but it splits one connection across two places, makes Settings unable to state or change the
  credentials it is about, and turns rotating an application secret into an edit-and-restart.
- **Symmetric encryption keyed from the environment.** Chosen.

Both the client secret and the refresh/access tokens are sealed with **AES-256-GCM** under a key
derived from a new `STAMPORAMA_SECRET_KEY` environment variable (`src/lib/secret-box.ts`). GCM
because the ciphertext must be tamper-evident: a flipped byte in a refresh token has to fail as a
decryption error rather than as an opaque Allegro rejection that reads like an expired grant. Each
sealed value carries its own random IV and is stored as one self-describing `v1.<iv>.<ct>.<tag>`
string, so the format can change later without a migration guessing at what a column holds.

The key is **required only when a connection exists**. An install that never touches Allegro is
not asked to set it, and a missing key surfaces as an explicit, named configuration error on the
Allegro tab rather than as a decrypt failure somewhere downstream.

Losing the key loses the connection and nothing else: the collector reconnects. That is stated in
the user guide, because it is the one operational consequence of this choice.

### 3. The connection is scoped to a collection

An Allegro account belongs to a seller rather than to a collection, which is the honest argument
for making this instance-wide. It is nevertheless **per collection**, for two reasons. Every other
platform setting here is collection-scoped — including `Contact.platformModule`, the Allegro
platform contact this connection attaches to and without which a captured lot has nowhere to land
— and the app has exactly one authorization model, `collectionId` plus an owner check, which an
instance-level secret would have to sit outside of. A second collection selling through the same
Allegro account connects again; that is a duplicated setup step, not a wrong answer, and it keeps
one collection's credentials from being readable while acting on another.

### 4. Disconnect drops the connection locally and does not revoke

Disconnect deletes the stored connection. It does not call Allegro to revoke the grant. A local
drop always succeeds — including when the token is already dead, which is the state a collector is
most likely to be disconnecting *from* — whereas a revoke introduces a failure path whose only
honest handling is to disconnect anyway and explain. The grant stays listed in the collector's
Allegro account until they remove it there, which the user guide says.

### 5. One thin client owns every fact about the API

`src/lib/allegro-api.ts` is the single place that knows the base URL (production vs sandbox), the
versioned `Accept` header, the bearer header, and what a 429 or a 5xx means. Everything downstream
— #467, #463, anything after them — goes through it and knows none of that. The same reasoning as
the platform modules: a marketplace's own shape belongs in one file, so that when it changes there
is one file to change.

**Sandbox is a property of the connection**, not of the deployment, and it is stored beside the
credentials because an application registered in the sandbox has different credentials from one
registered in production. Nothing about orders or sales should first be exercised against a live
selling account.

### Every request identifies the application (`User-Agent`)

Allegro requires a `User-Agent` on **every** request — mandatory from the end of June 2026 — in the
shape `ApplicationName/Version (+DocumentationURL)`, so that they can contact whoever is generating
traffic instead of blocking an application outright. Node's `fetch` sends its own runtime string
otherwise, which identifies nothing.

The name is meant to be the application registered at `apps.developer.allegro.pl` — which in a
self-hosted install the collector registered themselves and named whatever they liked. So it is a
setting, `AllegroConnection.applicationName`, beside the client id it describes, and **not** a
credential: blank means "no name" and falls back to `Stamporama`, rather than "keep the stored one"
the way the client secret's blank field does. The fallback is a working state and not a degraded
one — `Stamporama/0.60.0 (+https://github.com/michalwy/stamporama)` answers Allegro's question about
who to contact just as well.

`allegroUserAgent` (pure, in `allegro-oauth.ts`, unit-tested like `deviceCodeUrl`) builds it and
narrows the collector's name to what a header can carry: spaces become `-`, anything outside
`[A-Za-z0-9._-]` is dropped, and a name that survives as nothing falls back. A header value Allegro
refuses would fail every call with an error about a field nobody would think to look at.

It is carried by the **token endpoints too**, not only the API: an application that identifies itself
while reading orders but not while refreshing its token is exactly the half-identified caller the
requirement exists to prevent. The header therefore travels with the token — `getAllegroAccessToken`
returns `AllegroCallCredentials` (`accessToken`, `sandbox`, `userAgent`), which is what the sync
already passed around whole, so no caller downstream had to learn that any of this exists.

## Consequences

- A new required setup step for anyone using this: registering an application at
  `apps.developer.allegro.pl` and pasting its id and secret into Settings → Allegro. Documented in
  `docs/user-guide/allegro.md`.
- A new optional environment variable, `STAMPORAMA_SECRET_KEY`, which becomes required the moment
  an Allegro connection exists. It is the first secret in this app whose loss destroys stored data
  rather than just a session.
- A failed refresh puts the connection into an explicit `needs_reconnect` state, surfaced in
  Settings, rather than letting every later call fail on its own with a different message.
- Every call to Allegro now names the application. A collector who registered theirs under a
  different name says so in Settings → Allegro; leaving it blank is supported and still identifies
  the software.
- The buying side is unaffected. Auction lots the collector bids on (#351/#352/#449) are other
  sellers' offers, outside `GET /sale/offers`, and stay with the Assistant's capture.
