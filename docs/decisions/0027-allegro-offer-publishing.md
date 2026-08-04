# ADR-0027: Publishing an Offer to Allegro Through the API

## Status

Accepted

## Context

Listing through the Assistant (ADR-0015, #407/#408) works by getting to a marketplace's own sale form
and filling it from a neutral listing kit (#405). That is the right shape for a platform with no API
— Colnect — and it is what the extension was built for. It has a cost that is inherent to it: the
form has to be found, the fields have to keep matching what the marketplace renders, and the listing
URL comes back only because a human pressed Save and something read the address bar afterwards.

Allegro has an API, and with the instance connected to it (ADR-0023) none of that is necessary. The
four pieces a listing needs already exist here:

- what the offer holds — the listing kit (#405);
- what the account sells under — the listing profile (ADR-0025);
- what the stamp is — the learned category and its parameters (ADR-0026);
- the pictures, in Allegro's own image store (#487).

What was missing was the act itself: assembling one request out of the four, sending it, telling
Allegro's two success answers apart, and recording what came back.

There is one further prize. A listing created through the API can carry the Stamporama offer number
as its `external.id`, and the sold-listing sync (ADR-0024) already matches on exactly that. Every
listing published this way is therefore matched **exactly** rather than by parsing an address.

## Decision

### 1. The publish path is beside the Assistant path, not instead of it

Colnect keeps the Assistant. The listing kit stays the shared contract for what an offer *holds*, and
it is read here directly rather than through its endpoint.

The kit's own `blockers`, though, are **Colnect's rules** (#406, narrowed by #471): a Colnect item-ID
on every stamp, a Colnect grade for every condition. Asking them of an Allegro listing reports faults
in a form nobody is going to fill. So Allegro's refusals are its own (§4), and the one rule the two
genuinely share — that a single quantity may only describe interchangeable sets — is a single
exported function, `differingSets`, called from both. Two implementations of "these sets are the same
goods" is how they come to disagree.

### 1a. The category, its answers and the profile live on the **offer**

They were worked out inside the publish dialog. That was wrong the moment a second way of posting to
Allegro appeared: the Assistant filling Allegro's own sale form (#493) needs the same category, the
same parameter answers and the same profile, and it cannot reach a dialog. A value each path resolves
for itself is a value the two eventually disagree about.

So they are stored on `Offer` (`allegroCategoryId` and friends, `allegroCategoryParameters`, and
#486's existing `allegroListingProfileId`), shown on the offer's own **On Allegro** card, and read
from there by whichever path posts. `allegro-offer-listing.ts` owns all of it; the publish dialog is
a review of what that card says and asks nothing of its own.

**The category is filled in when the offer gains its first copy** — from the same three mutations
`syncGeneratedTexts` hangs off (#365/#380), with one deliberate difference: this is a *backfill and
never a refresh*. A generated title follows the composition because it **describes** it; a category is
a decision about what the goods **are**, and re-deriving it under a collector who has corrected it
would undo that silently. Re-matching is an explicit ↻ on the card. The backfill also **cannot fail
the mutation it hangs off**: adding a set is the collector's own act and has nothing to do with
Allegro, so a marketplace that is down costs a blank card and a ↻, never a refused set.

**Nothing is a gate.** Whatever was matched is what publishes; every value is correctable in place and
none asks to be confirmed. What the card carries instead is *provenance* — `learned`, `allegro`,
`manual`, plus the sentence saying what it was matched on — because a value nobody can account for is
one that gets re-checked by hand every time, which is the cost the register exists to remove. The one
thing that does refuse is a **required parameter with no answer**: Allegro rejects such a listing by a
field name the collector never saw, so it is named before the request instead.

**The register learns on `preparing → ready`**, not at publication. ADR-0026 §5 said "on a successful
publish" and this ADR originally read that literally, which is the wrong moment for the way a
collection is actually worked: offers are prepared in runs of ten or twenty and published later,
sometimes days later, so a register that learns only at publication asks the same question twenty
times over and answers it the day after it stopped mattering. `ready` is the point the collector has
said what these stamps *are*, which is the whole of what a lesson claims — and it is still a decision
rather than a draft, an offer left in `preparing` teaching nothing.

It hangs off the **transition** rather than off each listing path, for the reason that has not
changed: the API publish, the Assistant's write-back (#412) and a URL pasted in by hand all reach
their state through `setOfferState`, and a lesson recorded per path is one a new path forgets. A
category corrected on an already-`ready` offer is re-taught the next time it passes through, or
corrected directly in Settings → Allegro — which exists so that a wrong lesson never needs a wrong
listing to fix it.

### 2. The request is assembled purely

`allegro-publish-rules.ts` holds the refusals, the request assembly and the reading of Allegro's
answer. `allegro-publish.ts` fetches, sends, polls and writes, and decides nothing. Publishing is the
one act in this app that writes to somebody else's live selling account; being able to assert what
would be sent, without a marketplace, is worth the split on its own.

Two shapes in the body are decisions rather than transcription:

- **`sellingMode`** carries the format (#449) and only the figure that format *states*: `BUY_NOW` at
  the asking price, `AUCTION` at the **starting** price. An auction's `price` here is an observation
  of the bidding, and sending it as the opening figure would put a bid in the listing that nobody
  made.
- **`external.id` is the offer number** (#416), as a string. This is the whole reason the read side
  gets to be exact.
- **Only *offer* parameters are sent — and only by this request.** Allegro splits a category's
  parameters into an offer section and a product one (`options.describesProduct`), and product-offers
  refuses a product parameter sent among the offer's own by name — *"`9525:Klej` should not be
  specified as in section `offer`"*. It belongs inside `productSet[].product.parameters`, which is
  the catalog path, and matching stamps to Allegro's product catalog is a non-goal.

  The filter belongs **here**, where the restriction is, and nowhere earlier. An intermediate pass
  applied it at `getAllegroCategoryForm` — the read the picker and the card share — which quietly
  stopped the collector being asked for values the *other* listing path needs: Allegro's own sale
  form asks for both sections and the collector answers both. So every parameter is asked for and
  stored, each carrying its own `describesProduct`, and the API request drops the half it cannot
  carry. For the same reason a required *product* parameter is **not** a publish blocker: this
  request could not carry it answered or not, so refusing over it would block a listing on a field
  with no bearing on it.
- **`images` is an array of bare URL strings**, not of `{ url }` objects. The object shape belongs to
  the legacy `/sale/offers` endpoint, and product-offers answers it with a `JsonMappingException` on
  `images[0]` — a *parse* failure rather than a validation one, so Allegro says only "message is not
  readable" and names no expected shape. Worth stating here because the two endpoints are otherwise
  near-identical and the error tells you nothing.

### 3. Draft or live, chosen per publish, with draft the default

Allegro takes `publication.status` in the create call itself, so offering both costs nothing.

- `INACTIVE` creates the listing in the collector's own Allegro account without showing it to buyers.
  The offer stays `ready` here, because nothing is live.
- `ACTIVE` publishes at once, and the offer moves `ready → active` through `publishOffer` — the
  existing transition (#246), which is what stamps the listing date (#320) and writes the URL — never
  around it.

Draft leads because a publish is irreversible in the way that matters: a listing seen by buyers has
been seen. A last look in the marketplace's own interface is cheap, and the second half of that path
— **Activate** — is offered from the same control, in the same place. A draft reachable only by going
to Allegro would be a listing nobody goes back to.

### 4. Every refusal is named before the request

The connection first and alone (not connected, needs reconnecting, an application that positively
lacks the offer-write scope, #485), then a listing already published, then the offer being unfinished
— each of those standing alone because nothing else is actionable underneath them. Everything after
that is reported **together**, one line each, because each is fixed somewhere different: the price on
the offer header, the profile in Settings → Allegro, the pictures on the Photos card.

Two of these are worth stating explicitly:

- A scope that **could not be read** is not a refusal. The token's scopes are decoded for display and
  never verified (ADR-0023 §1 as amended by #485); refusing on an unreadable token would block a
  connection that publishes perfectly well.
- An **over-long title** is refused rather than shortened. Allegro caps a title at 75 characters and
  the kit does not, because a cap is the platform's. Truncating mangles wording the collector chose,
  which is the same answer #405 gives an over-long Colnect text.

### 4a. The description is rewritten into Allegro's own markup

Allegro's `description.sections[].items[].content` is **not** an HTML field. It takes seven tags —
`<p>`, `<h1>`, `<h2>`, `<ul>`, `<ol>`, `<li>`, `<b>` — with **no attributes at all**, and every piece
of text must sit inside one of the block tags.

Our descriptions do not look like that and should not have to: they are written in three formats
(ADR-0019) and rendered by one shared renderer, which emits `<p style="white-space:pre-wrap">` for
`plain` and `<strong>`, `<em>`, `<a href>` and `<h3>` for `markdown`. Sending what the offer screen
shows is a 422 naming the field and nothing else — which is exactly how this was found.

`toAllegroDescriptionHtml` (`allegro-description.ts`, pure, no DOM and no dependency) converts it at
the one point that knows the text is going to Allegro. It is **lossy on purpose and never
destructive**: an unsupported tag is dropped and *its text is kept*, a link becomes its own words, an
`<h4>` becomes an `<h2>`, a `<br>` becomes a paragraph, and loose text is wrapped rather than dropped.
Narrowing what a collector may write, or sanitising in the shared renderer, were both rejected — the
constraint is one marketplace's, and it must not reach the field they type into.

A scanner rather than a parser, deliberately: the input is markup this app rendered a moment earlier,
it is executed nowhere, and Allegro validates it again on arrival. A DOM library for a job whose
output is seven tag names would be a dependency and an ADR of its own.

### 4b. A refusal names the fields, not the sentence

Allegro's error bodies are `{ errors: [{ userMessage, message, code, path }] }`, and on a validation
failure they carry **one entry per bad field**. The information is in `path` (which field) and
`message` (what is wrong with it); every entry's `userMessage` repeats the same generic sentence,
*"Request contains invalid data"*.

`describeFailure` therefore reads **every** entry, writes the `path` in front of it, deduplicates, and
caps the flattened sentence — and `AllegroApiError.details` carries the entries as data so the publish
dialog renders one line per fault.

**Neither wording leads**, and that took two goes to get right. Reading the first `userMessage`, as
this originally did, turns a precise per-field refusal into one generic sentence naming nothing.
Reading `message` instead — the first fix — turns Allegro's *most* informative refusals into
"Unprocessable Entity", because that is exactly where Allegro puts the HTTP phrase while the sentence
sits in `userMessage`:

    { "code": "ParameterCategoryException", "message": "Unprocessable Entity",
      "path": "parameters", "userMessage": "Parameter `9525:Klej` should not be specified…" }

So both are kept and `informativeMessage` discards whichever is boilerplate, showing both where both
look specific. This is not cosmetic: `namesIneligibleAccount` (§4c) reads the same string, and under
the `message`-only rule it would have matched "Unprocessable Entity" and **never latched** — the
business-account refusal would have been re-discovered once per offer for ever.

Beside it, `STAMPORAMA_ALLEGRO_DEBUG=1` logs a refused call in full — the request body and Allegro's
raw answer. Off by default, because a publish body is the whole listing and a self-hosted instance's
logs are not the place for it unless somebody is looking; the bearer is never part of the log.

It is **on** in `docker-compose.yml`, which is `STAMPORAMA_SECRET_KEY`'s fixed-local-default
precedent: that file only ever runs the local stack, the dev overlay inherits from it, and a refusal
there lands in the developer's own terminal. Setting `STAMPORAMA_ALLEGRO_DEBUG=0` in the environment
turns it off again, so a quiet local session is still available.

A related refusal is moved **before** the request: a category whose **required** parameters the
register has never seen answered cannot be published from a suggestion alone (ADR-0026 §1 remembers
answers, not questions). The dialog says which parameters are unanswered and sends the collector to
the picker, rather than letting Allegro refuse a field they never saw.

### 4c. A business-account-only API is a property of the account, latched

Allegro's selling endpoints are open to **business accounts** only. A private seller's grant is
issued, refreshed and used for reading orders and bids without a word of complaint; the refusal
arrives the first time something is published — *"You cannot use the Public API method when selling
with a Regular Account (not registered as a Business Account)."*

There is no way to ask in advance. `GET /me` answers who the account is, not what it may sell as, and
inferring it from anything else would be a guess about somebody's tax status. So it is **recorded the
first time Allegro says it**, in Allegro's own words, on `AllegroConnection.publishRefusedReason`, and
every later publish is refused here rather than at the marketplace.

Three things about that column:

- It is **not** `needsReconnect`. ADR-0023 converges every *unusable* state on that flag, and this is
  not one: the connection works, the worklist works, the bid tracking works. Reconnecting fixes
  nothing, so saying "needs reconnecting" would send the collector round a loop with no exit.
- It stores **Allegro's sentence**, not a code of ours. This is a rule about somebody's account
  status that this app does not administer, and paraphrasing it would be inventing an account policy.
- It is **cleared** by a fresh grant and by re-registering the application — the two moments the
  answer could have changed, a sandbox application (where a business account is free) above all.
  Asking again costs one refused publish; never asking again means a permanent refusal that has
  quietly stopped being true.

Detection matches on the **wording** (`namesIneligibleAccount`), because the error code Allegro sends
with it is undocumented and observed once, while the two account types are what the sentence is about
in every language it arrives in. A false positive costs a sentence a reconnection clears; a false
negative costs the collector re-discovering the rule once per offer.

The practical consequence is that on a private account this whole path is a **named refusal** rather
than a feature — which is a better answer than a button that fails, and it works unchanged the day
the account becomes a business one. Listing to Allegro from a private account is the Assistant's job,
and that is a separate module (the listing half of #355's, the sibling of #410).

### 5. A 202 is polled to a conclusion

`POST /sale/product-offers` answers **201 or 202**, and #485's `AllegroWriteResult` already keeps the
two apart. A 202 is the work having been *accepted*: the offer row exists, and Allegro's asynchronous
validation can still refuse it for a duplicate or a policy breach.

So a 202 is polled at `GET /sale/product-offers/{offerId}/operations/{operationId}`, bounded by a
timeout. Three outcomes, and none of them is "probably fine":

- **succeeded** — the listing exists, and the write-back below runs;
- **failed** — reported as **Allegro stated it**, and nothing is transitioned;
- **still running when the bound is reached** — reported as exactly that. The Allegro offer id *is*
  recorded, so a second press cannot create a duplicate, but the offer is not moved and no listing is
  claimed.

An operation status this app does not recognise reads as still running. Treating an unknown answer as
success is how a listing Allegro later refused ends up recorded here as live.

### 6. What a concluded publish writes

- `Offer.url` and the `ready → active` transition, on a live publish only, through `publishOffer`.
- `Offer.allegroOfferId` and `Offer.allegroPublishStatus` — the listing's own identity on Allegro and
  the state we last knew it in. The id is not a second copy of what ADR-0024 matches on: that match
  runs off `external.id` and off `url`, which is how an *observation* finds its way back here. A
  draft has no public page and so no URL, which is precisely why the id has to be recorded on its
  own — it is the address activation is sent to.
- The category lesson (ADR-0026 §5), **only** on a conclusive success. A refused publish teaches
  nothing; a category Allegro rejected is exactly the association that must not be learned. A failure
  to record it is swallowed — a register write is not worth losing a published listing over.

### 7. The pictures go up first, and orphans are not a problem

The create references images by URL, so they are uploaded before it (#487). If the create then fails,
nothing is cleaned up: Allegro removes an uploaded image no listing has used, which is also why no
URL is cached on a photo row. The first image failure stops the run and names *the picture*, so a
listing is never published with fewer pictures than were prepared.

## Consequences

- An offer published this way is matched exactly by the sold-listing sync (ADR-0024) and observed by
  the bidding poll (#481) from the moment it goes live, without a URL ever being parsed.
- A publish makes several calls under one token: the image uploads, the create, and the operation
  polls. They share one `AllegroCallCredentials`, resolved once.
- A 401 latches `needsReconnect` (ADR-0023's single convergence point); a scope refusal deliberately
  does not, because reconnecting the same application does not fix it.
- **On a private (Regular) Allegro account nothing here can publish**, and the app says so in
  Allegro's own words instead of offering a control that fails (§4c). Everything else the connection
  does is unaffected.
- Editing a published listing and ending one are **not** covered here. Both are separate questions
  about a listing that already exists, and neither is answered by a create.
- Bulk publishing is not covered either. The bulk listing workspace (#322) is scoped to the Assistant
  path; a batch of API publications is a different act, with a different failure story.
