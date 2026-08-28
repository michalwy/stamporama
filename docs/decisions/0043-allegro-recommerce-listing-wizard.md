# ADR-0043: Driving Allegro's Recommerce Listing Wizard, and Pictures Inside the Fill

## Status

Accepted. Supersedes ADR-0028 §2, §6, §6a and the entry half of §8.

## Context

ADR-0028 built the Assistant's Allegro listing path (#493) against Allegro's **legacy one-screen sale
form**, and said in as many words what would happen if that form went away: *"If Allegro retires the
legacy form, the newer one is a second mapping inside this module — the neutral interface does not
move."*

Allegro retired it (#719). Every direct navigation to
`…/moje-allegro/sprzedaz/formularz-wystawiania` now answers with
`…/moje-allegro/recommerce/formularz-wystawiania/produkt`, and the opt-out link the module followed
back to the old form — *dotychczasowy formularz* — is no longer on that page. **List via Assistant**
failed on every Allegro offer from the day it went.

Half the prediction held: the mapping is a second mapping inside the module, and most of it survives
intact. The other half did not. The neutral interface had to move, because of a single fact about the
new form that no marketplace had presented before.

The replacement is a five-step wizard in **one document**, client-side routed, mapped in the
collector's own browser on 2026-08-28:

| Step | URL tail | What it holds |
| --- | --- | --- |
| Wybór produktu | `produkt` | `#product-name-search`, SZUKAJ, *Mojego produktu tu nie ma* |
| Zdjęcia i opis | `opis` | `#title-input`, the category picker, `#dropdown-<id>` / `#<id>`, `#file-input`, `div[aria-label="Opis oferty"]` |
| Szczegóły | `szczegoly` | `[data-testid=offer-type-selection]`, `#offer-duration-select`, `#priceCents`, the quantity spinner, the re-listing switch |
| Dostawa | `dostawa` | the handling-time select, `label[data-testid="shipping-rate-option-<shippingRatesId>"]`, the returns select |
| Podsumowanie | `podsumowanie` | `[data-testid=price-summary]`, and `[data-testid=submit-button]` reading *Wystaw na Allegro* |

## Decision

### 1. The pictures travel **with** the fill, and each module places them itself

**Allegro will not leave *Zdjęcia i opis* without a picture.** The step answers *Kolejny krok* with
`[data-testid=photos-error]` — *"Dodaj przynajmniej jedno zdjęcie"* — and stays where it is.

That is fatal to the shell's own ordering. #411 fetched the images in the worker and handed them to
the page **after** the fill, through a second message and a second interface member
(`PlatformListing.attachPhotos`), so that nothing reached a marketplace until the form in front of
the collector was otherwise complete. On this form that order can never reach the price, the
quantity, the delivery or the returns: the run stops on step two, for ever.

So `fill` gains the run's photos and may answer asynchronously:

```ts
fill(doc, task, photos): ListingFillOutcome | Promise<ListingFillOutcome>
```

and `attachPhotos` is gone, with the `attach-photos` message and `attachListingPhotos` with it.

**The rule it used to enforce was right and is kept — it just is not the shell's to hold.** Colnect's
uploader posts each picture the moment it is handed over, before the sale is saved (#402), so
`fillColnectSaleForm` hands them over as the very last thing it does, and says so where a reader of
that module will find it. Allegro's hands them over in the middle, because that is where its form
asks for them. Both statements are true of the form being filled; neither is true of listing in
general, and a shell that imposed either on the other would be wrong about one of them.

Two consequences follow and both are improvements:

- A module that has **no uploader** used to be recognised by the absence of an `attachPhotos` member.
  Every module has a `fill`, so the fact is now stated: `takesPhotos?: boolean`. The shell still
  fetches no bytes for a form with none, and still reports nothing about pictures — a form the
  Assistant fills completely has no gap in it.
- The **pending-listing record** (#412) moves ahead of the fill rather than after it. It always had
  to precede the first thing that writes to the marketplace, so that a collector who presses Save
  during an upload still gets the listing written back; with the pictures inside the fill, that means
  before the fill. A fill that then fails forgets the record — nothing on that page is this offer's
  listing, and a record left behind would write a stranger's Save back to it.

### 2. The module drives all four fillable steps, and `prepare` shrinks

The wizard is one document — the steps are client-side routes and **nothing between them is a page
load** — so one content-script lifetime drives the whole run. That is the single piece of luck in the
change, and it is what makes this a module rewrite rather than a shell one.

`prepare` keeps its original meaning and loses most of its work: it walks the entry (*Wybór produktu*
→ a search → *Mojego produktu tu nie ma*) and stops on *Zdjęcia i opis*, which `isFormDocument` now
identifies. Everything else it used to do has moved into `fill`, and not for tidiness: on this form
**a control's existence follows from a value**. The category parameters and the picture uploader do
not exist in the document until a category is chosen; the auction's duration select and the quick
buy's quantity do not exist until a format is. Unfolding a form that is not there yet is not a step
that can precede the fill — it is part of it, which is why the fill both reads and writes and why it
is asynchronous.

The fill therefore walks *Zdjęcia i opis* → *Szczegóły* → *Dostawa* and stops on *Podsumowanie*.
A step that will not advance **ends the run there**, with the wizard's own complaints in the report
(`[data-testid$="-error"]`): everything written stays written and in front of the collector, and
"Allegro would not go on from this step: Dodaj przynajmniej jedno zdjęcie" says more than any
sentence this module could compose.

### 3. *Kolejny krok* and *Wystaw na Allegro* share one test id, so the guard is doubled

`[data-testid="submit-button"]` is *Kolejny krok* on three steps and **the publish button** on the
fourth. It is the single most dangerous fact on this page: one careless click posts a listing to the
collector's live selling account.

Nothing is submitted, here or anywhere (#408, ADR-0028 §7), and the button is refused twice over —
`advance` will only click on the three steps it has just written to, and `nextStepButton` refuses any
button whose own words say it posts the listing. Either guard alone would do. Both are there because
the cost of being wrong is a listing the collector never saw.

### 4. The category is chosen by **path**, not by number

This is the one place the offer's stored configuration no longer fits the form. The legacy form took
the category **number** in its entry modal — the value #488 learns, #494 stores and every other part
of this app speaks in. The new picker is a modal that drills down a name tree one level at a time,
and carries no number anywhere.

So the module walks `categoryPath` (#494 already stores the breadcrumb, walked up from the node
itself, as a display snapshot) level by level. It is walked **every time**, even when a category is
already showing, because the picker is the same modal either way and walking it is cheaper and surer
than reading a breadcrumb back and deciding whether it means the same thing.

An offer that holds a category **id but no path** — a row written before that snapshot existed — is
**reported, not guessed at**. Allegro suggests a category of its own on that step, from the title,
and ticking it would file somebody's stamps under a category nobody chose. The whole promise of the
fill is that what goes into the form is what the offer says, and the report names the number the
offer does hold and where to re-match it.

### 5. What else moved, and what did not

Most of the mapping survived, which is why this is worth doing at all:

- Category parameters are still **Allegro's own parameter ids**: `#dropdown-<id>` where the parameter
  is a dictionary and `#<id>` where it is free text. A dictionary is now a **combobox** rather than a
  `select` — an `<input role="combobox">` whose options are drawn into `#dropdown-<id>-content` only
  while it is open — so a value is typed and then chosen rather than assigned, and **the field is
  left empty when nothing matches**: a combobox holding unmatched text is an invalid field, which is
  what would stop the wizard advancing three lines later for a value that already did not go in.
- The listing profile is still a **one-to-one fit** (ADR-0025): `shippingRatesId` is the test id of
  the price list's card, `returnPolicyId` is the value of the returns option. A price list Allegro
  keeps behind *Inne zapisane dostawy* is fetched from that dialog and saved onto the step, which is
  the two clicks a collector makes.
- Durations are still matched **by length, not by string** (ADR-0028 §6b).
- The description editor is a same-origin `contenteditable` (tiptap) rather than TinyMCE in an
  iframe, and it is in the document from the start — the click that used to mount it is gone.
- **A quick buy has no duration on this form at all.** Allegro fixes it at 30 days and says so beside
  the format, so the profile's `durationLimit` now only ever reaches an auction, and a quick buy
  reports that rather than dropping it silently.
- Neither select on *Dostawa* has an id, so each is found by **what it is a list of**: the handling
  time is the select whose every option is an ISO-8601 duration, the returns policy is the select
  that offers the profile's own id. That is sturdier than a position — a step that grows a third
  select does not silently move the handling time.
- Allegro's **unfinished-draft prompt** (*Kontynuuj wystawianie*) is a backdrop over the whole page
  and must be answered before anything can be reached. It is answered with *Chcę wystawić nową
  ofertę* and **never** with the other control on it, which deletes a draft the collector started and
  this run knows nothing about.
- The **AI-watermark question** (ADR-0028 §6a) was not served on the new form when it was mapped — it
  is behind a flag — but the answer is unchanged and is still given, checked for while the upload is
  waited on rather than in a wait of its own. It is the reason `fill` had to be able to answer
  asynchronously; that door is now open for a plainer reason as well.
- The upload is waited for on Allegro's own signal: an accepted thumbnail carries the **uploaded
  image's URL** as its test id, which cannot exist before the upload finished.

### 6. The confirmation is written to survive either shape

ADR-0028 §8 reads the listed URL off the page rather than off a navigation, because the legacy form
re-rendered itself into `#thank-you-page` without moving the address bar. Everything about that —
`listedUrlInDocument`, the `MutationObserver` armed at fill time and never on `submit`, the write-back
— is unchanged and stays.

The **wizard's** confirmation was deliberately not observed: reading it would have meant publishing a
listing from the collector's live account to find out what the page looks like. So the rule is
written to survive either shape it takes. `#thank-you-page` is still recognised, and beside it: a
document at the form's own address that has **stopped being any step of the wizard** and carries a
link to an `/oferta/<id>` is the listing that was just posted. If Allegro navigates to the offer
instead, none of this is reached at all — the background already reads a listed URL off the tab's
navigations (#412).

This is the one part of #719 that is a considered guess rather than an observation, and it is marked
as such in the module. The first listing posted through it settles the question.

## Consequences

- Listing to Allegro through the Assistant works again, filling the same values it always did, with
  the pictures uploaded in the middle rather than at the end.
- `PlatformListing` is **smaller**: `fill` carries the pictures, `attachPhotos` is gone, and
  `takesPhotos` states the fact its presence used to imply. One message fewer crosses to the page.
- Where a marketplace wants its pictures is now the module's answer, stated in each module. Colnect's
  ordering rule (#402) is unchanged and is written down where its module can be read.
- A run still leaves an Allegro **draft** behind if it is abandoned — the wizard is draft-backed from
  the moment a product search is run, one step earlier than the legacy form's.
- An offer whose stored Allegro category has no `categoryPath` cannot be filed automatically. It is
  reported with the number it does hold; re-matching the category on the offer's Allegro card stores
  the path.
- The fill depends on Allegro's element ids and its own test ids rather than on its markup. Neither is
  a contract, and a form that stops matching is a report full of skipped fields — visible rather than
  silent, which is the property that made this failure diagnosable in an afternoon.
