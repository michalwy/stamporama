# ADR-0028: Listing to Allegro Through the Assistant, Beside the API

## Status

Accepted

## Context

ADR-0027 built the API publish path (#477) and it works right up to Allegro's own gate:
`POST /sale/product-offers` is open to **business accounts only**. A private seller's grant is
issued, refreshed and used for reading orders and bids without complaint; the refusal arrives the
first time a listing is published — *"You cannot use the Public API method when selling with a
Regular Account (not registered as a Business Account)."* ADR-0027 §4c latches that sentence on
`AllegroConnection.publishRefusedReason` and re-checks it on every reconnection, so the day the
account becomes a business one the API path publishes unchanged.

What was missing was the path that works today for the account this instance actually has, and it is
the one the extension shell was built for: the `PlatformModule` **listing half** (#408), which
Colnect already had (#410) and Allegro did not — Allegro's module (#355) carried **capture** alone.

Everything a listing is configured with had already moved onto the offer in #494: the category and
both parameter sections (#488), and the resolved listing profile (#486), all read through one
`readAllegroListingInputs`. So what this decides is the module, the shape the configuration travels
in, and how the two paths sit beside each other.

## Decision

### 1. Two paths, one offer, and the connection is what chooses

The API path stays and stays the better one where it works: it is one request, it carries the offer
number as `external.id` so the sold-listing sync matches exactly (ADR-0024), and it needs no browser.
The Assistant path is what a Regular account has.

Both are offered on a `ready` Allegro offer, and neither is hidden behind the other:

- **Publish to Allegro** (#477) refuses with `account-not-eligible` — Allegro's own sentence,
  verbatim — on an account Allegro will not publish for, and that refusal now names the other path.
- **⚡ List via Assistant** (#407) is lit for Allegro by `hasListingModule()` going true (§3).

Nothing here inspects the connection to decide *which* to show. A collector whose account is a
business one may still prefer to look at the form before posting, and a refusal that has to be met
before the alternative appears is a dead end for the collector who does not have the API.

### 2. What the module fills is Allegro's **legacy** sale form

Allegro runs two sale forms, and a Regular account is pushed to the newer one. Every direct
navigation to the legacy address — with a `?categoryId=`, and even to a draft's own `/restore` —
answers with `…/recommerce/formularz-wystawiania/produkt`. The legacy one-screen form loads only when
*that* page's own opt-out link is followed.

The legacy form is nevertheless the one to fill, and by a wide margin. Every value the offer holds
maps onto a **stable element id** — and the category parameters map onto *Allegro's own parameter
ids*: the control answering parameter `213` is `#213`. The three ids the listing profile stores are
the option values of `#shippingRatesId`, `#estimatedShippingTimeId` and `#return-policies` verbatim,
so ADR-0025's profile is a one-to-one fit. The newer form picks its category from suggestions rather
than by number and puts every field behind its own step.

No class name is read anywhere, exactly as #355 ruled for this marketplace: every class on an Allegro
page is hashed per build, while these ids are the site's own field vocabulary.

If Allegro retires the legacy form, the newer one is a second mapping inside this module — the
neutral interface does not move.

### 3. The preconditions become **per module** before Allegro can list

`hasListingModule()` going true for Allegro is what lights the handoff — and it was also what would
have turned **Colnect's** listing preconditions (#406) on for every Allegro offer: a Colnect item-ID
on every stamp, a Colnect grade for every condition. An Allegro listing is filed under a category
(#488) and graded by one of that category's own parameters, so both are questions about a catalogue
it is not in, and asking them refuses every Allegro offer `ready`.

So a module now states its own rules (`listingModuleRules` in `platform-modules.ts`), and the neutral
evaluation asks only what the entry claims. What stays shell-wide is deliberately small — being
Ready, holding copies, and the sets being interchangeable — because those are facts about the
**offer** rather than about anyone's form. The same entry gates the two reads that only ever existed
for Colnect's sake: the condition map, and the platform-catalogue card (#423).

### 4. Allegro's own refusals are split by **who they are about**

ADR-0027's refusals were one list mixing two vocabularies. The connection, the write scope, the
account's eligibility and "already published" are the **API's alone** — a form filled in the
collector's own browser needs none of them, and the very account the API refuses lists perfectly well
by hand. Everything else is about the **listing**: a title over Allegro's 75, a stock figure that is
not truthful, no price, no profile, no category, no pictures.

The listing group therefore lives in `allegro-listing-rules.ts` and is evaluated by both paths;
`evaluateAllegroPublishBlockers` is the API group followed by it. A rule written twice is a rule the
two paths eventually disagree about, and the disagreement shows up as a listing one path refuses and
the other posts.

### 5. The configuration travels as a **named section** of the listing task

The listing kit (#405) is platform-neutral *in shape*: it says what a listing holds and never how
anyone's form is laid out. Allegro's category, its parameter answers and its profile are not that, so
they travel as `kit.allegro` — a section beside the neutral fields, null for every other platform —
rather than as Allegro-shaped fields sprinkled through them. A third marketplace with its own
configuration gets its own section and nothing about the kit moves.

Two things ride in that section for the form's sake:

- **both parameter sections**, offer and product. The API drops the product half because
  `POST /sale/product-offers` refuses it there (ADR-0027 §2); the sale form asks for both in one
  list, and a collector filling it by hand would answer both.
- each answer's **display value** beside its dictionary ids. The API takes `valuesIds`; the form's
  own `select` submits the option's **text**. The labels are resolved once, server-side, from the
  category form Allegro is already asked for — and **best-effort**: a read that fails costs labels,
  not the task, which matters more here than anywhere, this being the path a collector reaches for
  precisely when Allegro will not serve them.

### 6. The module drives Allegro's entry sequence, through one new optional half-member

Getting to Allegro's form is a sequence and only its ends are page loads: *recommerce landing* →
(load) → *product search* → SZUKAJ → *Kontynuuj bez wybierania produktu* → the **category modal** →
the category number → (load) → the form. The middle steps are network round-trips inside one
document, and `fill` is synchronous DOM work that cannot wait for one.

So `PlatformListing` gains **`prepare?(doc, task): Promise<void>`** — optional, and Allegro's is the
only one. It is not a fill: nothing it does writes a value from the offer into a listing, except the
category, which is not a field on the form at all but the thing that decides which form there is. The
shell calls it only where the document is at `isFormUrl` and is not `isFormDocument` — the very
condition that was already a `retry` (#419) — and then fills once more. If `prepare` ended by
navigating, the attempt simply ends and the next load starts a fresh one, which is the loop the shell
already ran.

Three things about Allegro's own pages had to be built into that walk, each of which cost a run
before it was:

- **The entry page renders half a minute after it loads.** The content script arrives on the load
  event, so every step has to wait for a *landmark* — the opt-out link, the search field, the
  category field, the form — rather than decide against an empty `<main>`, which looks identical to a
  page that has none of them.
- **The two searches share one field.** The page opens on its GTIN search and the name search is the
  same `#product-search-phrase-field` with a different placeholder, so a title typed in without
  switching is looked up as a barcode — and fails in a way that never offers the way past.
- **Typing the category number creates a draft** on the account, Allegro's form being draft-backed.
  A run the collector abandons therefore leaves one behind, which is Allegro's own behaviour for
  anyone opening the form by hand and is cleared from *Kontynuuj wystawianie → Usuń*.

The alternative was to leave the module a pure fill and have the collector click through Allegro's
entry themselves, with the shell waiting for the form to appear. It was rejected because the one
value the collector would then have to type by hand is the category number — the value this whole
feature exists to stop them looking up.

### 6a. The pictures are answered for, and the answer is always "no"

Allegro opens a dialog the moment files reach its uploader, asking which of them should carry an
**"AI" watermark** under the AI Act. The Assistant confirms it with **nothing ticked**.

That is a claim about the goods, not a click to get out of the way, and it is answerable: an offer's
pictures are photographs of stamps, composed by Stamporama from those photographs, and nothing in
that path is generative. The default is therefore already the truthful answer, and this confirms it
rather than choosing anything — **it must never tick a box**, which would put a declaration on the
listing that the collector never made and that is not true. The dialog is matched on its own title,
not on the button alone, so no other dialog is ever confirmed by accident.

It is also why `attachPhotos` may now answer **asynchronously** (the one signature widened for this):
the pictures are not in until Allegro's question about them has been answered, and the run's report
would otherwise claim a handover that had not finished. A module with nothing to wait for — Colnect's
— returns its report directly and pays nothing.

### 6b. The profile grew two settings, and `prepare` grew a second job

Two of the form's fields have no answer anywhere in this app, and both are ways of *selling* rather
than facts about the stamps — the same reasoning that already puts the handling time and the returns
policy on the profile (ADR-0025). So `AllegroListingProfile` gains **`durationLimit`** (nullable:
"leave the form as served" is a real answer, and the answer every profile written before this gives)
and **`autoRepublish`** (a plain boolean, written in *both* directions, since an unticked box is a
decision rather than the absence of one). Neither is sent by the API path: `POST /sale/product-offers`
takes Allegro's own default, this app has not established what it would do with either field, and
sending an untested value to a live selling account is not worth the symmetry.

**Durations are matched by length, not by string.** Allegro states the same duration differently on
its two surfaces — the profile holds `P3D` because that is what the API takes, the form offers
`PT72H` — so an equality test silently selects nothing and leaves the default standing, which is
exactly how a three-day handling time went out as one day. `isoDurationHours` parses both notations
and the option is chosen on the number.

`prepare` therefore has a second job beside walking the entry: **unfolding the form**. Three things
this task needs are not in the served document at all — the rest of the category's parameters (behind
*więcej parametrów*), an auction's own opening-price and duration fields (which exist only once
*licytacja* is ticked, and which *replace* the quick buy's duration select), and the description
editor (TinyMCE mounts only when the placeholder is clicked). Each is a React re-render, which is why
none of them can live in the synchronous `fill` — and why `prepare` now runs before **every** fill
rather than only when the page is not the form.

### 7. What the fill will not do

- **It never submits.** Filling stops before *wystaw i zaakceptuj warunki*.
- **An auction's Buy Now price stays empty.** The format itself is ticked and the opening price is
  written (§6b), but filling `#buynow-price` beside it would add a second way of selling the offer
  never asked for.
- **The sending address is reported, not typed.** Allegro keeps it as an account setting behind its
  own dialog rather than as a field, so the profile's city and post code are stated for the collector
  to check against the line the form already shows.
- **Nothing pre-filled is overwritten** where the offer has nothing to say about it.

### 8. The listing comes back — but Allegro says so **in place**, not by navigating

`listedUrl` recognises `/oferta/<slug>-<id>`, the shape #355's capture half already matches and the
one #467 finds a sold listing by. That much is unchanged, and it is what makes a listing posted
through the Assistant matched back to its offer exactly as a hand-posted one is.

What is new is **where the address is found**. #412 reads it off the tab's navigations, which is the
whole answer on Colnect, where Save lands on the new entry. Allegro never navigates: a submitted form
re-renders *the same document* into a thank-you page (`#thank-you-page`) carrying the offer's link,
with the address bar still on the form. A run watching only the address bar therefore ends every
Allegro listing as "submitted, URL unread" — the listing exists and the offer never learns its
address.

So `PlatformListing` gains **`listedUrlInDocument?(doc)`** beside `listedUrl(url)` — not a
replacement but the same question asked of the page rather than of the address — and the content
script that filled the form watches for that page, handing the URL to the background the moment it
appears. From there it is the existing write-back verbatim: same pending record, same delivery to the
page or the endpoint, same `ready → active`.

The watch starts **when the form is filled, not when it is submitted**, and that is the load-bearing
detail: Allegro posts its form through script, so no `submit` event is ever raised and a watch that
waited for one never started at all — which is exactly how the first attempt at this failed, silently.
Nothing is lost by watching early, because a thank-you page can only exist after the form has been
posted: its presence *is* the submission. It is a `MutationObserver` rather than a poll (the page
changes once, the wait is the collector's own time — half an hour) and the `submit` listener stays,
now deciding only which of two reports a closed tab produces.

The offer Allegro names is **awaiting its review** ("Gdy ją zatwierdzimy, będzie opublikowana"), and
recording it is still right: the listing exists, that is its address, and #467 will find it there.

The category register needs no hook here either: it learns on `preparing → ready` (#494), so an offer
listed through the Assistant has already taught it by the time it is posted.

## Consequences

- A private (Regular) Allegro account can list from Stamporama today, with the category, its
  parameters, the price, the quantity, the description and the delivery profile filled in.
- The listing preconditions are per module. A fourth module inherits nobody's rules by existing, and
  must state its own.
- `PlatformListing` has one more optional member. A module with no entry sequence — every module but
  Allegro's — is unchanged and pays nothing.
- The fill depends on Allegro's element ids rather than on its markup. They are the site's own field
  vocabulary and move on a slow clock, but they are not a contract: a form that stops matching is a
  fill report full of skipped fields, which is visible rather than silent.
- Two things on the form still need the collector: the auction fields, and the sending address.
- Each run leaves an Allegro **draft** behind if it is abandoned, the form being draft-backed from the
  moment its category is chosen.
- A **failed** handoff is now reported and left alone (`extension/src/content/instance.ts`). It used
  to be dropped from the `handled` set so that "pressing the button again retries", which it never
  needed to be — the page mints a fresh `requestId` per press — and which made a failure re-read
  itself from the mutation its own error report caused: one marketplace tab per turn, for ever. It
  only ever showed with a module that could fail, which is why it survived Colnect.
