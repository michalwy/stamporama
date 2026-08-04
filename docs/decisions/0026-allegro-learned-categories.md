# ADR-0026: Allegro Categories Are Learned, Not Configured

## Status

Accepted

## Context

ADR-0025 took the account-side half of what `POST /sale/product-offers` demands. The other half is
about the stamp: `category.id`, and that category's `parameters[]` — several of them required, and
different for every category.

Neither can be defaulted the way a shipping rate set can. A 1935 Polish used definitive and a modern
German souvenir sheet belong in different Allegro categories and answer their categories' parameters
differently, and nothing in the `Offer` model says which. Yet a collector lists the *same handful of
kinds* over and over: asking the question per listing is asking the same question a hundred times.

The collection already knows what a stamp is — its area (`StampCollectionArea`), its year
(`Stamp.issuedYear`), its condition (`Item.conditionId`) and its subtype (`Stamp.subtypeId`). The
association worth recording is between those four facts and the category that was actually used.

Nothing is configured up front and no taxonomy is invented here. The app watches what the collector
chose, and the second listing of a kind is where the work disappears.

## Decision

### 1. Two registers, not one

`AllegroCategoryLesson` maps a **key → category**. `AllegroCategoryParameterMemory` maps a
**(category, parameter) → the value last answered**.

They are separate because they are learned from different things and are useful separately. The
second is what makes a *new* key still cheap to publish once its category has been picked by hand;
the first is what makes an old key free. One combined register — a key mapping to a whole listing —
would have to relearn every parameter the first time an area gains a new year.

The parameter register is one row **per parameter**, not one row per category holding all of them: a
category that gains a parameter must not invalidate what is known about the others, and the support
count below is per answer.

### 2. The key is (area, year, condition, subtype), each part nullable

Every part is nullable, and null means **absent from this key** rather than "no value". Two different
things produce a null, and both mean the same thing to lookup:

- The offer is **mixed**. An offer is a bundle of copies, which may span years, conditions or areas.
  Each of the four facts is derived independently and enters the key only where the copies **agree**;
  one they disagree on is left null. A bundle of 1935 and 1938 Polish used definitives still asks a
  useful question — it just does not ask it about a year.
- The fact does not exist. A stamp with no year, or on the collection's default subtype.

The area part names a **node** of the area tree, and lookup walks upwards from it (§3).

### 3. Lookup relaxes rather than fails, and the order is fixed

An exact key first, then progressively broader ones, in one order that every caller shares:

1. the exact key;
2. **drop the year** — the same area, condition and subtype in any year;
3. **drop the subtype** as well;
4. **move one level up the area tree** and repeat 1–3 there, until the root runs out.

The year goes first because it is the sparsest part by a wide margin: exact years are what make the
register slow to become useful, and a 1936 stamp learning nothing from a 1935 one is the failure this
whole feature exists to avoid. It is kept in the key rather than bucketed into decades or eras
because a bucket bakes a philatelic judgement into the schema that no other part of this app makes,
and an exact match — when there is one — is the best answer available.

**The condition is never dropped.** Used and mint are different categories on Allegro far more often
than they are the same one, and a suggestion that crosses that line is worse than no suggestion.

A tier is a **filter over rows, not a row lookup**. Lessons are recorded with the fullest key the
offer supported, so relaxing by "any year" has to match rows that *have* a year. For the same reason
an area tier matches a node **or any of its descendants**: that is what makes a lesson learned on
Poland → Provinces reach a stamp filed under Poland → Republic, which is the entire point of walking
up. Where a tier matches several rows they are ranked by the closest area first, then by support.

A key that no tier matches falls to Allegro's own `GET /sale/matching-categories` suggestion from the
offer title, and failing that to a manual pick from the tree. Lookup has no failing outcome.

### 4. Recorded on success only, newest wins, and support is counted

A listing Allegro accepted writes both registers; a refused publish teaches nothing. Correcting a
suggestion and publishing again is itself a lesson, and the newer choice wins over the older one.

Each row carries `timesUsed` and `lastUsedAt`. A suggestion can then say how well backed it is —
"used 7 times, last in March" — rather than quoting a single publish, and the panel in §6 can be read
by confidence. The count is what breaks a tie between two rows a relaxed tier both matches.

### 5. Per (collection, platform)

Both registers hang off the platform `Contact` this collection calls Allegro, with `collectionId`
riding along for scoping — the `AllegroListingProfile` ownership (ADR-0025 §1), for the same reason.
The category is Allegro's, so the platform is what owns knowledge about it, and nothing is shared
between collections or between instances.

### 6. Always a suggestion, and always correctable

Nothing is published on a guess the collector has not seen. The publish dialog (#477) shows the
category, **what it was matched on**, and lets it be changed before anything is sent — a prefill,
never an automatic decision.

What the app has learned is a list in Settings → Allegro, whose rows can be re-pointed at another
category or deleted outright. A wrong association learned once must never be a thing that can only be
fixed by publishing something wrong again.

## Consequences

- The second listing of a kind carries no category work at all, and the first one after that is what
  teaches the register the collector's correction.
- The register is only ever as good as what has been published. A fresh install suggests nothing, and
  says so, rather than guessing from a taxonomy this app would have had to invent.
- Recording is #477's call into `recordAllegroCategoryLesson`. Until publishing exists the registers
  fill only by hand-correcting a row, which is a defensible if slow way in.
- Allegro's product catalog (`GET /sale/products`) stays out. Stamps are listed by category, not
  matched to a catalog product.
- A category deleted or restructured on Allegro leaves rows pointing at nothing. They are names and
  ids like ADR-0025 §3's, not re-validated on read; the publish is where it becomes a refusal, and
  the panel is where the stale row is deleted.
