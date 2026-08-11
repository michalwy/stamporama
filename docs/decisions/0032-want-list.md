# ADR-0032: The Want List — Wanting as an Acceptance Criterion

## Status

Accepted

## Context

The collection records what is held. It records nothing about what is being **looked for** — the
stamps not owned at all, and the ones owned in a shape the collector means to replace. That
knowledge lived in a notebook, which is why the same gap gets bought twice and the same dealer list
gets read from the top every time.

Two obvious models were considered and both are wrong.

**A fourth disposition.** `inCollection` / `forSale` / `forTrade` live on `Item`, and an `Item` is
**one physical copy** (ADR-0007 — there is deliberately no quantity field). A wanted stamp has no
copy. A `wanted` flag would therefore force phantom `Item` rows into existence, and every count that
reads inventory would immediately be wrong: holdings totals, valuation, cost-basis, completeness.
Disposition answers "what am I doing with what I have". Wanting is outside its domain.

**One wanted (stamp, condition, format) tuple.** Too narrow to survive contact with the hobby:

- Nothing owned yet → anything from used to MNH will do.
- A used copy owned → now looking for any *mint* one: MNG, MH, MNH, and MH vs MNH is usually
  indifferent.
- Certificates matter for a handful of stamps and not at all for the rest.

## Decisions

### 1. A want is its own row, and it carries acceptance *sets*

`Want` is collection-scoped, points at one `Stamp`, and each of the three axes is a **set of
acceptable values in a join table, where zero rows means "any"**:

- **condition** — `{MNG, MH, MNH}` is "any mint"; empty is "anything".
- **certificate status** — a full dictionary like condition, not a flag; empty is "don't care".
- **format** — empty is "any"; set when specifically after a block.

Upgrades then need no concept of their own. With a used copy held and the acceptance set narrowed
to the mint conditions, the held copy does not satisfy the want, so it stays open. There is no
separate "upgrade" entity to keep honest.

### 2. "At least X" is not expressible, and that is deliberate

`StampCondition` is a **user-defined dictionary** whose `sortOrder` is display order, not quality.
`U` and `MNG` are not two points on one scale — cancellation and gum are different axes — and `CTO`
/ `FDC` are on no scale at all. Any "minimum quality" rule would invent an ordering the dictionary
does not guarantee and the collector can destroy by dragging a row. A set of acceptable values needs
no ordering to be correct, which is why it is the only shape offered.

### 3. Null in an acceptance set means a value; "any" is zero rows

This is the trap the model exists to avoid. On `Item` and `StampCatalogPrice` a null
`certificateStatusId` **is a value** — "no certificate" (ADR-0006 §2) — and a null `formatId` means
"single". Both of "only without a certificate" and "only singles" are real wants and must be
expressible, alongside "don't care".

So `want_certificate_status` and `want_format` are join tables with a **nullable FK**: a null member
is the "none" value, and **zero rows** is "any". Uniqueness is a raw
`UNIQUE ... NULLS NOT DISTINCT` index — the idiom `stamp_catalog_price_unique` and
`stamp_format_factor_unique` already use (PostgreSQL 15+) — without which Postgres treats every null
row as distinct and the "no certificate" member could be added over and over.

`want_condition` needs none of this: `Item.conditionId` is required, so there is no "none" value on
that axis and a plain composite primary key is enough. Three tables, two shapes, and the difference
is a fact about the data rather than an inconsistency.

### 4. Open/closed is one nullable timestamp

`closedAt` is null while the want is open and a timestamp once the collector decides it is met —
`Item.disposedAt`'s idiom. Flag and date in one column, so every filter stays a plain `where` and no
second column can disagree with the first.

### 5. A want carries a priority and **no price at all**

`priority` is `high | normal | low` — what to chase first when a dealer's list is long. It is not a
queue position: several wants share a priority and nothing orders within one.

A **maximum price** was built and then removed before it ever meant anything (migration
`20260811140000_want_drop_max_price`). Two reasons, and either alone is enough.

A want is a **standing intention with no date**. A figure on it is a price opinion frozen the day it
was typed, and nothing ever comes back to correct it — the catalogue moves, the market moves, and the
number on the row keeps looking authoritative. ADR-0029 §2 refuses a *configured* realization ratio
for exactly this reason ("a market opinion stated once and wrong nearly everywhere"); a per-want
ceiling is the same mistake, multiplied by the number of rows on the list.

And §5b's whole-series add makes it plainly unworkable: one field over twelve stamps worth wildly
different amounts, with no honest way to resolve it. Copying it stamps one ceiling onto all twelve.
Splitting it by catalogue value invents per-stamp limits the collector never stated *and* freezes
them at today's catalogue. Splitting it evenly prices a key value the same as a common one.

What a stamp is worth **at the moment of buying** is already answered, against the copy actually in
front of the collector, by the recommendation engine reading recorded results (ADR-0022, ADR-0029).
Two mechanisms answering one question is how they drift, and this is the one with no evidence behind
it. So a want says *what would satisfy it*, and the price question is asked where the buying happens.

`priority` is what survives of "how much do I care", and it needs no maintenance to stay true.

### 5b. A whole series is added in one go, as one want per stamp

Someone collecting a series wants every stamp on it, usually on identical terms. The add form
therefore takes **one stamp or one checklist** (`WantCreateInput`), the same offer lot intake and
auction lot composition already make: `StampSelect` gained an opt-in `checklist` prop that switches
on the browser's per-checklist *whole set* buttons, and the form's acceptance, priority and note are
filled in once and applied to every want written. (There is no price to share out — §5.)

The fan-out creates one want **per stamp**, never a want that points at a set. Each stamp is found,
priced and closed on its own day, and a set-shaped want could only ever be all-or-nothing.

It skips a stamp that already carries an **open** want — the collector asked for the set, not for a
second copy of what is on the list — and reports how many, since *Add 12 wants* silently writing
nothing reads as a bug. It deliberately does **not** skip a stamp merely because a copy is held:
that is §6's rule, for turning *gaps* into wants, and here the collector is naming what they are
after, where wanting a better copy of something held is the ordinary case.

The copy form does not pass the prop. One copy is one copy, and turning a pick into twelve there
would be a different act wearing the same control — the reason the auction line dialog withholds it
on an edit, which this form does too.

### 5c. The list is flat, and issue grouping is a view of it

Whether the want list should be *issue-oriented* — rows are series, like the Issues list — was asked
and answered: **flat is the shape, grouped is a view.**

A want's subject is a **stamp**, and §1's acceptance sets are per stamp. Within one series they
genuinely differ: the key value wanted MNH with a certificate, the rest "anything". An issue heading
over rows whose terms differ is a heading that overstates what it covers. And the reading the list is
opened for most is the other one — a stamp is in hand at a dealer's table, or on a marketplace page
the assistant has matched — where you want one row found by number, name or picture, not a series to
expand first.

There is also a collision to avoid. The issue detail page already answers "how far along am I with
this series" from the copies **held** (ADR-0031). A want list whose spine were issues would be a
second answer to that, and §6 is precisely about not re-coupling wants to checklists.

But the repetition is real: after a whole-series add (§5b) or a gap generator run (§6), twelve rows
say the same thing twelve times, and "what is left of this set" is a question worth one row. So the
toolbar carries a **By issue** toggle, remembered per collection — a view preference, not a filter.

It is grouped **server-side**, the call inventory's issue groups make (#424): the list is
offset-paginated, and grouping in the browser would split a group at a page boundary and report two
half-counts. A want is reported under **one** issue — its stamp's first membership, the same one
`WantListItem.issueId` states — so the groups partition the list and their counts add up to it, while
a group's members are read back through an `issueId` filter matching **any** membership, the pair
inventory has carried since #172 rather than a third rule. Wants whose stamp is in no issue get their
own bucket, which an absent filter cannot ask for (`NO_ISSUE`).

The row's figure is **`open / total`**, counted with every filter *except* open/closed. "8 of 12" has
to mean the same thing whichever side of the status toggle it is read from, and a denominator that
moved when you flipped to *Closed* would be a fraction of nothing in particular. Which groups
*appear* still obeys that filter — a series with nothing closed is not part of a list showing closed
wants — and since status narrows on `closedAt` alone, that follows from the two counts without a
second query.

### 5d. What a want costs is a range, not a number

§5 removed the price the *collector* types. What the **catalogue** says is a different thing and can
be shown, because nothing has to be maintained for it to stay true.

It has to be a **range**. A want's acceptance sets stand for a set of (condition, certificate,
format) combinations — often the whole grid, since an empty set means "any" — and each carries its
own catalogue value. Any single number would be one combination picked out of that set, quietly
answering a narrower question than the row asks. So the row shows the cheapest and the dearest thing
that would satisfy the want, and narrowing the want narrows the range with it.

`wantCatalogRange` (`want-valuation.ts`, pure) enumerates the accepted combinations and values each
with **`valuateCopy`** — the very function that prices a physical copy. A want's figure and the copy
that eventually satisfies it are therefore computed by one rule and cannot drift. The enumeration is
bounded by the collection's own dictionaries, not by anything that grows with it.

Three things it refuses to fudge. The range is in the **base currency alone**: combinations can come
off catalogues priced in different currencies, and a low and a high in two currencies are not a
range. An unpriced or unconvertible combination is **counted, never zeroed** — a gap in the catalogue
would otherwise drag every range down to nothing — and the row reports `priced / accepted` so a
range built on one price out of twenty-four says so. And `estimated` is inferred from the **absence
of a recorded row** for the format rather than from the presence of a multiplier, since a format can
be both priced explicitly and have a factor, and calling that an estimate would be wrong.

The cost is one pricing pass **per page**: the page's stamps' prices and their variants', plus the
per-collection preamble (`buildEffectivePrimaryCatalogMap`, the base currency, the format factors,
the dictionaries) that the stamps list already loads for its own price column. A page of wants costs
a page of stamps, not a query per row — and it is computed only in `listWantsPaginated`, since the
intake review and the edit form do not draw it.

### 5e. What is already on its way is shown, not stored

A want stays open until the collector closes it (§7). That is right — the stamp is not here — but
it left one case reading wrongly: a copy already **bought and in the post** looked exactly like no
copy at all, so the same stamp coming up at the next auction showed an open want with nothing beside
it and quietly urged a second bid on something already paid for.

The fix is neither a third state on the want nor an early close. What the collection has of a wanted
stamp is a **split** — `WantCopyCounts`: held, ordered, in transit — **derived** from the copies on
every read, stored nowhere, maintained by nobody. `to_sort` folds into *held*: an arrived copy is on
the desk whether or not it has been filed. It rides on the want row and on `StampWantSummary`, so the
crosshair chip's popover says it wherever a stamp is listed.

*Held* and *on its way* are different answers to "should I be bidding on this", and only one of them
is yes. Nothing closes, nothing is written, and §7's rule stands untouched.

The split is counted **twice over**, and conflating the two is the mistake this paragraph exists to
prevent. Per **stamp** is everything held whichever want it answers — the upgrade context, where a
mint-only want sits above a used copy in hand. Per **want** is only what `wantMatchesCopy` says
would satisfy that want, and it is the **only** figure permitted to claim something is on its way.
The reason is concrete: a *used* copy in the post satisfies a want for "anything" and satisfies a
mint-only want not at all, so a single stamp-wide line printed above a list of wants tells the
collector to stop bidding on the mint copy they were right to chase — the precise failure §5e set
out to remove, reintroduced one level up. Both tallies are taken from one read of the copies, so
they can never be computed over different sets.

### 6. Completeness targets are a generator, not a source

Deriving the want list from gaps in a checklist (ADR-0031) was considered and rejected. A checklist
says **what belongs to a set**; a want says **what I would buy and on what terms**. A gap is an
*observation*, not an intent — it carries no acceptance criteria and no priority.
Feeding checklists in as a live source would also mean every edit to a checklist silently rewrites
the want list.

Instead the completeness card offers **"Add missing to want list"**: a one-shot, user-triggered
action that materialises explicit, editable rows for the checklist stamps with no held copy and no
open want. One-directional, so a checklist can change afterwards without touching anything, and
skipping stamps that already have an open want is what makes pressing it twice a no-op rather than a
pile of duplicates.

### 6b. The review belongs to arrival, not to creation

§7's review first fired when a copy's **row was written**. That was right for the hand-added copy
(which starts `delivered`, in the collector's hands) and wrong for every other route: purchase intake
creates copies `ordered`, and a parcel won at auction and settled into a purchase created them
without passing through intake at all — so the whole buying path, the one where wants matter most,
never asked the question.

The rule is now one line: **the review happens when a copy becomes `delivered`.** A hand-added copy
is reviewed on creation because that is when it arrives; an ordered one waits for *Mark sorted* or an
explicit delivery state. This closes the auction-settlement gap without a second review being bolted
onto settlement — every route converges on the same transition — and it asks the question at the only
moment it can be answered honestly, with the stamp in hand.

Mechanically: the bulk lot writes read their candidates **before** the update, because afterwards a
copy that has just arrived cannot be told from one that was already here, and `updateItem` reports
`becameDelivered`. `intakeStampsAction` deliberately returns no copies at all.

### 7. A want closes at intake, deliberately, and can be narrowed instead

When a copy is taken in — purchase intake, and the direct Add-copy path — the **open wants that copy
could satisfy** are surfaced, with three choices per want:

- **Close it.**
- **Narrow it** — the want was "anything", a used copy arrived, so it becomes "any mint". The record
  persists and is refined rather than replaced.
- **Leave it open.**

Auto-closing is wrong here on both counts. It silently discards a record of intent, and narrowing —
the *common* case — is a judgement the app cannot make, for §2's reason: nothing in the dictionary
says which conditions are "better than used".

What the app may do is offer a **seed**. When the condition set is empty ("anything") and a copy
arrives, the narrow editor opens with every condition ticked **except the one that just arrived**.
That is derived from the dictionary's membership, never from its order, it is presented as a
starting point with every box editable, and nothing is written until the collector presses Save.
When the set is already narrower than "anything", it is left exactly as it is — the collector has
already answered this question once.

### 8. What a copy satisfies is a pure function

`wantMatchesCopy` in `src/lib/want-rules.ts` takes a want's three sets and a copy's
`(stampId, conditionId, certificateStatusId, formatId)` and answers yes or no. Same stamp, and each
axis satisfied when its set is empty **or** contains the copy's value — null included, as a value.
No Prisma, no I/O, so the intake review and any later consumer cannot disagree about what "could
satisfy" means.

## Schema

```prisma
model Want {
  id           String    @id @default(cuid())
  collectionId String
  stampId      String
  closedAt     DateTime?          // null = open
  priority     String    @default("normal")   // high | normal | low
  // No price: see §5.
  notes        String?
  createdAt    DateTime  @default(now())
}

model WantCondition          { wantId String; conditionId String }            // @@id, no nulls
model WantCertificateStatus  { id String @id; wantId String; certificateStatusId String? }
model WantFormat             { id String @id; wantId String; formatId String? }
```

Every FK cascades. A want records nothing that *happened* — unlike a purchase or a sale — so
deleting the stamp, the collection or a dictionary row takes the intent with it rather than blocking
on it.

## Consequences

- The want list is a screen of its own under **Buying**, browsable and filterable by open/closed,
  priority, acceptable condition, area, year and free text. It is **cursor-scrolled and filtered on
  the server**, like the stamps and inventory lists: it was first built on the Contacts shape — the
  whole list in one response, narrowed in the browser — and that was wrong about the size of the
  thing. An address book is a few hundred rows; a want list is a collecting plan's shopping list and
  runs to thousands.
- `priority` is stored as its **rank**, because the list is ordered by it and paged on the server,
  and the only order Postgres can put a `text` column in is its spelling. The word never reaches the
  database and never leaves the vocabulary in `want-rules.ts`.
- The page and the year facets share one `where`, so a facet cannot count a row the page would not
  show. The condition filter ORs in "wants with no conditions at all", because an empty acceptance
  set means *any* and such a want really would take the condition being asked about — the same rule
  §8's predicate applies when a copy arrives.
- Nothing anywhere closes a want without the collector saying so, and nothing derives one from a
  checklist except the explicit action in §6.
- The three named consumers in #532 — purchase intake, the browser assistant (#253/#250), and trade
  — share §8's one predicate, so "and it is on your want list" is a small step wherever a stamp has
  already been resolved.

## Still open

- **Named acceptance profiles** ("any mint", "anything") are #533, deliberately separate. Whether
  they are needed depends on how the plain form feels once wants are being entered in bulk.
- Highlighting a want while browsing a marketplace (#253/#250) is not built here.
