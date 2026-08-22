# ADR-0039: Trades — the Give/Receive Asymmetry and the Frozen Agreement

## Status

Accepted

## Context

Collectors swap stamps. The app records buying (ADR-0009) and selling (ADR-0012/ADR-0013) in detail
and records exchanging not at all, which is a gap in the *acquisition* side as much as in the
disposal side: material that comes in by swap arrives with no cost basis, no record of what it cost
in stamps, and no trace of who it came from.

Three anchors for it already exist and were deliberately reused rather than duplicated:

- `Item.forTrade` — the disposition flag beside `forSale` and `inCollection` (ADR-0007 §4).
- `Contact.exchangePartner` — the partner's role on a contact (ADR-0008).
- `Want` — the `stamp x condition x certificate x format` key with nullable members (ADR-0032),
  which is exactly the shape a "what is coming to me" line needs.

Two obvious models were considered and both are wrong.

**A purchase with a price of zero, or a negative one.** A `Purchase` has one supplier, one currency
and a pool of money spread across its lines (ADR-0009 §3). A trade has neither a price nor a pool:
the consideration *is stamps*, and modelling it as money would require a fictional figure on both
sides that every ROI and cost-basis reader would then take literally.

**A sale paid in goods.** A `Sale` disposes of copies and receives money (ADR-0012). Making the
"money" a bag of stamps breaks the one thing a sale is for — realized proceeds — and would leave the
incoming material with nowhere to live until it is identified, which for a swap is weeks later.

A trade is its own transaction with its own shape, and the shape is unusual enough to be worth
writing down.

## Decisions

### 1. `side` is an axis of the line, not two optional columns on one row

A `TradeLine` carries `side: give | receive` and, depending on it, either an `itemId` or the `Want`
key.

The give side names a **concrete copy**: the stamps are in the collection, a copy is a copy, and
naming anything vaguer would make it impossible to know afterwards what actually left. The receive
side **cannot** name a copy: the partner's stamps are in nobody's inventory, so it names a stamp, a
condition, an optional certificate status, an optional format and a quantity — where, exactly as on a
`Want`, a null certificate status *is* a value ("no certificate", ADR-0006 §2) and a null format
means single.

That asymmetry is why the two sides are one table with a discriminator rather than two nullable FKs
on one row: the shapes genuinely differ, and a CHECK constraint can state which columns each side
may fill. A give line's quantity is always 1 — a multiple is one copy in one format, never N singles
(ADR-0020).

### 2. There is no pairing between the sides

The two sides are two independent bags. The only structure over them is the **section**, and the
counts routinely differ: ten cheap ones for two good ones is a normal value trade. Nothing anywhere
matches a give line to a receive line, and no schema, screen or engine may assume one does.

### 3. A section inherits its balance rule whole, or states its own whole

`TradeSection` carries four nullable override columns, written and cleared as a unit, with
`balanceByValue` as the discriminator: null means inherit everything.

Per-field inheritance was rejected. Two half-inherited settings are two things to keep in step for no
gain, and "tolerance 0 because the trade says so" and "tolerance 0 because this section says so"
would be indistinguishable on screen while behaving identically — a distinction with no consequence
is a distinction that will be got wrong.

Every trade has **at least one section**, created with it, because `TradeLine.sectionId` is required.
A trade with no sections is a trade nothing can be put into; deleting the last one is refused.

### 4. Shipping is two timestamps, not two states

`sentAt` and `receivedAt` are independent and are set in either order. The parcels cross in the post,
and one of them is routinely delayed for a month. Folding them into the linear status would force an
ordering the world does not have — the same split `Purchase` already makes between its delivery
status and its lot lifecycle (ADR-0009 §1/§5).

### 5. The lifecycle is `preparing → shared → agreed → closed`, and `agreed` freezes the list

- `preparing` — composing; nothing has left the building.
- `shared` — the partner's link is live.
- `agreed` — both sides have committed. Valuations freeze and the list locks against editing.
- `closed` — both parcels have arrived and the incoming material has been identified.

`cancelled` is reachable from every live status and leads back to `preparing`; `closed` is terminal
here, because what un-closing would have to undo is the cost basis a close writes.

**The lock at `agreed` is the point of the whole lifecycle.** The partner is holding a copy of the
list. Silently changing what was agreed is how a trade turns into an argument, so recording that
reality diverged — a withdrawal, a shortfall, a substitution — is a **different act with its own
shape**, never an edit made quietly to the thing both sides shook hands on.

### 6. *Partner has responded* is a derived badge, not a status

A negotiation goes back and forth several times. Were "responded" a status, every round would mean
clicking a state back and forth by hand, and the column would record the collector's diligence rather
than the trade. It is derived from partner feedback instead. Concretely (§10): it is on while the trade has
feedback nobody has accepted or dismissed, so it clears itself as the collector works through what was
said and comes back when the partner answers again.

### 7. Two valuations, never merged — and the agreed catalog is a **vendor**

A trade carries an optional **agreed catalog** alongside the collector's own valuation, which always
comes from the area's primary catalog exactly as everywhere else in the app. They answer different
questions: what the two sides are negotiating in, and what the collector is actually giving away.
That StampWorld says something different from Fischer is a property of the negotiation, not a
discrepancy to reconcile. The columns that name them live on the trade because they are terms of the
agreement.

**Revised in place by #638**, which built the engine this section anticipated, on the ADR-0029 §8
precedent — the decision below is unchanged and what follows is the shape it took rather than a
contradiction of it.

Own valuation is `valuateItemRows` **called, not restated**: the identical function the copies list
prices a copy with, with no override of any kind, so the trade screen cannot quote a different figure
for a stamp than the rest of the app does. Agreed valuation is the same call against a different
book, through one swapped input — the area → catalogue map (`buildVendorCatalogMap`) — because the
rollup, the format factors, the edition selection and the strict certificate match are the *same*
rule asked of a different publisher, and a second valuator would be two copies of ADR-0020 and #238
to keep in step. A **per-line** vendor may override the trade's ("this one we look up in Fischer");
it is one more map and one more pass, never a second rule, and it touches the agreed valuation only.

Three things follow from "never merged". They are summed apart (`trade-balance.ts` keeps two fields
of two units rather than one field and a flag), they are printed apart in two named currencies, and
a **missing figure is counted, never assumed to be zero** — which is what the gate is. A trade may
not leave `preparing`, nor reach `agreed`, while any line on either side has no own valuation at all;
the check is re-run on every attempt rather than stamped once, and it refuses **by name** (#418's
shape). An unknown-variant rollup (#238) satisfies it, flagged as the estimate it is: blocking on one
would throw every umbrella stamp out of every trade, and a negotiating figure claims nothing of what
a listing claims (#617). `TradeLine.manualValue` satisfies it too, in the base currency and marked as
the collector's own figure wherever it is shown — material no catalog prices must not deadlock a
trade, and that is categorically different from the zero the app refuses to assume. The agreed gate
applies only where value balancing decides, and a value-balanced trade naming *no* catalog is refused
as the one fault it is rather than as every line being blamed for a figure nothing was asked for.

**Freezing is by status, and there are three regimes.** `preparing` reads live catalogs at live
rates. The first move to `shared` writes `TradeFxRate` — `ExchangeRate`'s own shape with the
collection swapped for a trade, keyed on `(tradeId, fromCurrency, toCurrency)` because a trade
converts toward two targets and one row cannot mean both — refreshable while the negotiation runs and
hard-frozen at `agreed`. `agreed` writes `TradeLineValuation`, one row per `(line, kind)`: `kind` is
an axis for §1's reason, and the catalogue's name and currency are stored as **text** rather than as
foreign keys, because the whole point is that a catalog renamed or deleted next week cannot restate
what two people shook hands on. The snapshot is **released** whenever the trade returns to a status
its list can be edited in — what is editable is not frozen, and a snapshot shadowing a live edit is
the one way that table could lie.

`Trade.catalogVendorId` points at a **`CatalogVendor`** — Michel, StampWorld, Fischer — and
deliberately **not** at a `CatalogName`. A catalog name is one book covering one part of the world:
*Michel Deutschland* prices nothing Polish. A trade routinely spans several areas, so agreeing on a
single book would leave every line outside its scope unvaluable, and the trade would have to carry a
list of books instead — one per area — which is a thing the collection already knows. What two
collectors actually agree on is the publisher ("we go by Michel"), and which volume a given line is
read in then follows from that line's stamp and its area, through the same `CollectionAreaCatalog`
resolution every other valuation in the app uses. One agreed fact, no per-area bookkeeping, and no
way to name a catalog that cannot price half the trade.

The own-valuation skew raises a **warning and never a block**: a deliberately uneven trade is a
normal thing between collectors and the app has no business forbidding it.

### 8. A trade number is a per-collection sequence, never reused

`Trade.tradeNo` is allocated from a counter on `Collection` by the same atomic bump every other short
number uses, and is quoted to somebody else — it heads the partner's copy of the list. Two different
exchanges answering to "trade 7" would be worse here than anywhere.

### 9. The partner's link names one trade, and only its hash is stored

A trade is shown to the partner through a secret link (#640) rather than by giving them an account:
the other collector is not a user of this instance and never will be, and an exchange runs on two
people reading the same list.

**One `TradeShareToken` per trade**, `AssistantToken`'s shape with the collection swapped for a single
trade — and that swap is the whole security argument. An Assistant token acts as the collection's
owner across the collection; this one names one trade, and every read it authorises (the page, the
figures, the scans) is scoped to that trade's own lines. A leaked link therefore exposes exactly the
list the collector chose to hand over. One row per trade, because a second live link is a second thing
to remember to revoke and no way to tell which is in whose hands; regenerating replaces the row, which
is what revoking means. Only the SHA-256 hash is persisted, so the address is shown once and cannot be
recovered — a collector who loses it regenerates.

**Every live status serves, and `cancelled` does not.** A link is an address for a list, not a stage
of the negotiation, so a collector who generates one while still composing did so on purpose. Minting
is deliberately **not** the `preparing → shared` transition: that move is the collector's own act and
is gated on the valuation check, and a button doing both would be a button doing two things. `closed`
still serves — the partner is entitled to the list of what was actually exchanged. `cancelled`
refuses by name, because a partner refreshing an old link should be told the exchange is off rather
than shown a list nobody intends to honour.

**`showValues` is the only thing that lets a figure out**, and it is off by default. With an agreed
catalog every line is priced in it, in one currency, and the book is named once in the header. Without
one the page falls back to the collector's **own** valuation with per-line attribution (`Fischer
Polska 2026`), because a column of numbers out of different books with nothing to say so cannot be
read — and that fallback is the collector's own valuation reaching the partner, which is exactly why
the switch exists and why a default that disclosed would not be a choice. The two valuations are
**still never merged** (§7): own figures print in the collection's base currency and agreed ones in
the trade's, each named. #640's issue asked for both totals converted into `Trade.currency`; that was
written before §7 existed, and re-converting an own total would invent a third figure nobody could
check. What the issue was after — a rate note — is printed from `TradeFxRate`.

**The page is server-rendered whole.** #640 gave the reason as printing — a list that prints only
what has been scrolled to is not a list — and **#665 took printing off this page entirely** (revised
here in place): the printout a trade needs is the parcel enclosure (#643), which the collector prints
from their own side and puts in the box, and two print surfaces for one list is two layouts to keep in
step while paper and a reader at arm's length want opposite densities. The whole-list render stands on
its own reason, which was always the better one: **the partner has no filters and no search**, so
there is no view of this list but all of it, and a page that fetched as it scrolled would be a page
whose end a reader can never be sure they reached — on a list they are being asked to agree to. How
the material is arranged is therefore links rather than state: the partner gets the trade screen's own
grouping levels, and an arrangement is a different address for the same page. The page carried **no
client bundle at all** until #641 gave it something to say back; see §10, which revises that half of
this sentence and leaves the rest of it standing — the *list* is still one server render.

**What the page is instead is a screen that reads and answers** (#665, #666, #667). Freed of paper it
is a wide sheet with the two sides far apart, rows and groups and sections visibly separated, and
scans at a size worth looking at: they enlarge on hover and open full size on click, through the same
preview and the same overlay every other screen in the app draws (`@/app/photo-viewer`, made
collection-agnostic for it) and through the token's own photo route, which serves nothing outside this
trade's lines. And what the partner has already said is **on the row** — a remark readable in place, a
struck line drawn struck, and a count at the head of each side — the same argument #662 made on the
collector's screen, for the same reason: a signal about a line belongs on that line.

### 10. Partner feedback is feedback, never an edit — and *responded* falls out of it

The partner needs a way to answer (#641), and the shape of that answer is decided by one thing: **a
list must not rearrange itself under the person who agreed it**. So feedback is a separate record —
`TradeFeedback`, one row per line the partner marked or wrote on plus at most one about the whole
exchange — and the collector accepts or ignores each item. Accepting a rejection deletes the line, and
that is the collector's act, subject to the same lock every other line write obeys (§5): while the
trade is `agreed` the removal is refused **by name**, with the step that would unfreeze it. Past
`agreed` partner input is therefore a *request to reopen* rather than a change, which is exactly what
the lock means; `closed` takes nothing more.

**One row per line, replaced rather than appended.** There are no accounts on that page and no
per-person attribution: one trade, one partner, one link (§9), so a second row for the same line would
be the same person talking over themselves. `lineId` is unique for that, and the whole-trade row is
held to one by a partial unique index. Saying nothing — no mark, no words — deletes the row, because
an empty row would stand as an outstanding item reading as feedback and containing none.

**Unresolved is unread**, and there is no separate read marker. An item stays outstanding until it is
accepted or dismissed, and an edit by the partner clears the resolution and puts it back. That is what
§6's derived badge is read off: *Partner has responded* is `open > 0` on the trade's own screen and on
its list row, so dealing with what the partner said is what clears it.

**A signal about a line belongs on that line** — revised in place (#662), replacing the *inbox above
the columns* this section originally argued for. The first shape gathered the partner's answers into
a panel over the two columns, on the reasoning that what a collector does with feedback is work
through it, so gathering beats scattering. In use the opposite holds: a banner that says something
about eight lines is eight lines to go and find in four section cards, and the row is where the
collector is already looking — the one place where *this one* needs no explaining. So each remark, and
each of #639's per-copy notices with it, is a **mark on its own row**, drawn in the chip vocabulary
the copy row already uses for row-level state, with the words in the shared tooltip and the decision
in the row's single `⋮`. Nothing about the record changed: the same rows, the same resolutions, the
same lock, and a handled remark still stays — muted, on the line it was about, which is #641's
disclosure re-homed rather than dropped. What stays above the columns is what has **no row to hang
on**: the partner's note about the whole exchange, and a count of what is still unhandled with a jump
to the first of it. The count is deliberate rather than decorative — it is what keeps the refusal on
**Agree** something met while the list is being read rather than by pressing the button, which is the
argument #639 made for stating the collision on the trade at all.

**The controls are the page's first client code, and only the controls.** An answer is given one line
at a time, and a Send button under two hundred rows is a button somebody forgets to press — so each
control saves its own line the moment it is given, through a `POST` route of the token's own beside
the photo route, rate-limited like everything else reachable without a session. The list around them
is still one server render. What the controls hold is **one state** (#667): the entries the server
rendered go into a provider wrapping the server-rendered list, so the mark on a row, the words on it
and the count at the head of its side are the same fact drawn three times, and an answered line
settles back into what was said with the editor a click away.

### 11. Realisation is a second layer on the line, never an edit to the first

A trade list is a **plan, not a fact** (#642). Pieces are withdrawn while packing, pieces never
arrive, and the collector has to record that — but §5's lock exists precisely because the partner is
holding a copy of the agreed list, so what actually happened cannot be written by editing what was
agreed. Two layers on one line, then: `TradeLine.fulfillment` (`pending | fulfilled | missing |
withdrawn`) with a note beside it, and the quantity, the key, `manualValue` and both frozen
`TradeLineValuation` rows untouched by it.

**The window is the mirror image of the lock.** Every other write on a line is refused at `agreed`; a
verdict is refused *everywhere but* `agreed`. Before the agreement nothing has happened — a list being
composed describes a parcel nobody has packed — and after `closed` it is history. That inversion is
the decision, not an accident of where the check landed: the lock and the verdict are two different
acts with two different windows, which is exactly what makes recording a divergence not an edit.

**One flag with two words on top**, §10's shape. `withdrawn` reads *I withdrew it* of the collector's
material and *Partner withdrew it* of the partner's; `missing` reads *never arrived* from either end,
because inventing a second phrasing there would suggest a distinction that is not there. Both are
offered on **both** sides: a parcel that arrives two short is as ordinary going out as coming in.

**Two balances, and the difference is the point.** From `agreed` the screen shows what was struck and
what actually moved, computed from the same lines and the same figures — the realised one is simply
the agreed one *minus what was struck off*, which is why nothing above it changes and why the two can
be read against each other at all. `pending` counts as realised, deliberately: at the moment a trade
is agreed every line is pending, and a realised total that counted only the `fulfilled` ones would
start at zero and report the whole trade as its own difference. The difference is reported per side
and per measure, each in its own unit, and never as one number — pieces, the base currency and the
trade's do not add, which is §7's rule holding here too.

**A withdrawal is what releases a copy** (§ #639). Only a withdrawal: a fulfilled line's copy went in
the envelope and a missing one's went too, so neither is back on the shelf. That closes the loop #639
left open — the departure warning it raises on a copy that has sold out from under a promise says the
resolution is a withdrawal, and now it literally is, because a withdrawn line drops out of the read
the warning is computed from.

**Two different moves.** Recording a fact leaves the trade `agreed` and lives on the row. Deciding to
renegotiate is an explicit `agreed → shared`, which unlocks the list and shows the partner the change
— the verdicts are marked on the shared page too, neutrally worded, since the collector's own
per-side words would be a lie read from the other end of the table. The lifecycle already allowed
that step; what this adds is that it is **named** for what it does rather than for the column it
writes, because *Mark shared* makes undoing a handshake read like a filing action.

**`closed` requires a verdict on every line**, refused by name through the same labeller §7's gate
names its lines with. A trade closed with lines nobody ever answered for is a record that says
nothing about the parcel — and #644 reads exactly these verdicts to decide what actually left and
what actually arrived.

**Two things #642 asked for are deliberately not here.** A **substituted variant** needs no field:
the receive line says what was promised, the copy created from the scan tile says what came, and the
difference is derived rather than stored as a second version of the truth. A **bonus** needs nothing
either: a tile bound to no line becomes a copy in the same lot, and the pool splits pro-rata by
catalogue value, so extra material simply lowers the unit cost of everything else — and the opposite
case, a line that never arrived, raises it. Both rest on a tile → line → copy binding a trade does not
have until #644 gives it a purchase, so both ship there.

### 12. Closing carries the cost over; it recognises nothing

*(#644.)*

**Fair value was rejected.** Treating an exchange as a purchase *and* a sale at the agreed figure
balances in cash — X in, X out — but not in the result. Copies whose cost basis is 30 "sold" for 300
book 270 of profit that never reached an account; the incoming material then enters at 300, and its
eventual real sale at 200 books a loss of 100 despite a total gain of 170. The result is invented in
both directions and displaced in time, and #168 would read it literally at exactly the moment it
matters.

**Carry-over is what happens.** The outgoing copies leave at their cost basis, and the sum of those
becomes the cost pool of the incoming material. No revenue, no profit, no cash: value changes form —
the same money now sits in different stamps — and the profit appears, truthfully, on a real sale
later. This is also the standard treatment of a non-monetary exchange: at carrying amount, with no
gain recognised.

**A `Purchase`, yes; a `Sale`, no.** The incoming half becomes a purchase with the partner as
supplier and `Purchase.tradeId` saying where it came from — exactly as `Purchase.auctionSale` marks
one transcribed from an auction settlement (ADR-0021). That inherits the whole intake apparatus: scan
sheets, tiles, the pool split, ROI. A sale, by contrast, is a named buyer, an amount, a platform, a
shipment and the cycle `ordered → paid → packed → sent → received`, in which `paid` would be a lie and
the amount fiction. **The record of the exit is the give line of a closed trade** — a third path
beside `SaleLineItem` and `disposedAt`, each with its own meaning and none impersonating another, and
read rather than written, for §"Consequences"'s reason about a second place for the truth to live.

**One lot per receive line**, and not one lot for the whole trade. That is what gives the intake
apparatus a line to bind a tile to: a tile becomes a copy, the copy sits on a lot, the lot names the
line — which is exactly the chain §11 parked the substituted variant and the bonus on. The pool is
split across those lots pro-rata by the **frozen own valuation** (§7) times quantity, and each lot is
then split across its copies by catalogue price, which is the split `PurchaseLot` has always
performed. Two levels of one rule, both reconciling to the cent through one apportionment.

**Everything that left carries its cost, and only a withdrawal did not leave.** `missing` — it went in
the envelope and never arrived — carries, because dropping it would make value evaporate from the
books with no loss recorded anywhere and the app has no loss concept. `withdrawn` carries nothing:
that copy is still on the shelf, which is the same judgement §11 releases a commitment on.

**Pending cost basis is not a blocker, it is a gate on the lot.** A large auction lot is intaken over
weeks and its copies are tradeable long before it closes, so a source copy may itself be `pending`.
Only the trigger changes: the incoming lot stays `open` while any source copy is, its close is refused
**by name** — naming the orders to go and close — and the incoming copies report `pending` of their
own accord meanwhile. Chains resolve themselves, because a copy that has been given away cannot be
given away again, so the dependencies always point into the past. Closing the *trade* is independent
of the money maturing: `closed` is about physical facts and the agreement, exactly as a parcel is
`arrived` while its lot is still `open`.

**Postage is the only real cash** and has a home already: `Purchase.shippingCost`, distributed over
the incoming copies by the engine that distributes every other shared cost. Cash adjustments in
either direction are out of scope by decision.

### 13. The alternatives to a give line are derived; blocking is a row

*(#657.)*

A trade is agreed on **stamps** — a catalogue number in a condition — but on the collector's side it
resolves to a concrete copy. Where the collection holds several copies that answer the same
requirement, which one travels is not yet decided, and the partner is the one who should decide it
(#658). What that decision is made over is a **candidate pool**, and this is what it is.

**The pool is derived, never stored.** For a give line its candidates are the copies
`listOfferableCopies` (#639) would allow — in hand, unsold, not disposed of, not promised to another
live trade, not already on this one — matched on the line's key. A candidate table would be a table
that is wrong the first time a copy is sold and nobody re-runs anything, which is the same argument
that keeps a commitment a give line rather than a flag on `Item` (§"Consequences").

**The line still names a copy.** The alternative — turning a give line into a requirement with copies
attached at packing time — was rejected. `TradeLine.itemId` is what the reservation gate (#639), the
balance figures (§7), the packing list (#643) and the closing exit record (§12) all read, and a
nullable copy would make every one of them grow an exclusion for a state that exists between two
clicks. The line names a copy; what is added is the set that could take its place.

**The key is matched in full: stamp × condition × certificate × format.** This is the load-bearing
rule. §7 values a line on exactly that key, so a swap inside it changes neither valuation, neither
total and neither verdict — the substitution is invisible to every figure on the screen and to the
snapshots frozen at `agreed`. A pool matched on stamp and condition alone would let a certified copy
replace an uncertified one, or a block of four replace a single, and silently rewrite a balance both
sides had shaken hands on. A copy differing in certificate or format is not an alternative to a line;
it is a different line. It is `copy-groups.ts`'s key with both optional axes joined, which is the same
key catalogue valuation is computed on — not a fifth grouping rule.

**Blocking is an explicit row, and absence is availability.** Everything eligible is offered by
default; the collector removes individual copies. `TradeCopyBlock` is one row per `(trade, copy)`,
following `ItemPlatformExclusion` exactly: the presence of the row is the whole state, so setting it
twice is a no-op and clearing it is a delete, and there is no reason field, because anything worth
writing down goes in the trade line's own notes. Both FKs **cascade** — a block records nothing that
happened, so it follows the trade or the copy out of existence without leaving a trace to guard.

**Scoped to the trade, not to the line.** "This one is not going to this person" is what a collector
means, and two lines of one trade sharing a key would otherwise need the same decision taken twice.

**The pool is live while the trade is `preparing` or `shared`.** From `agreed` on the choice is
settled along with everything else the lock covers (§5): blocking there would change what the partner
is looking at after they agreed to it. So the read returns nothing outside that window rather than
returning a set nothing may be done with.

### 14. A requirement resolves to a copy by a fixed, stated order

*(#659.)*

A partner's wish list says one thing: *this stamp, in this condition*. It cannot say which of your
three copies, because it does not know you hold three. Something has to choose, and §13's pool is not
that choice — it is the set a choice can be made from, and its members are interchangeable by
construction. Here the candidates are **not** interchangeable: matched on stamp and condition alone,
they differ on exactly the two axes that carry value.

**The order is fixed, documented and deterministic**, and each step is a decision a collector would
recognise:

1. **`forTrade` copies first.** The disposition (ADR-0007 §4) is precisely where a collector files
   what they are willing to part with. Picking past it would offer a partner the album copy while a
   duplicate sat in the box.
2. **The plain single next** — no certificate, no format. Handing over a block of four or a certified
   piece because somebody asked for "this stamp" would be a bad trade *and* a silent change to the
   balance, which is §13's argument read from the other end.
3. **A copy that has a photo**, because the partner is going to look at it and the shared page (§9)
   has nothing to show otherwise.
4. **Lowest `itemNo`** to settle it — arbitrary but stable, so the same list resolved twice picks the
   same copies rather than shuffling a list the partner is already reading.

**A quantity of N takes N distinct copies** down that same order, and no copy is served twice across
a batch: two rows asking for the same thing are two pieces the partner expects. Fewer copies than
asked for is a **shortfall**, stated with the number served and the number missing, never silently
rounded down.

**Nothing to serve is information, not an error.** *You do not hold this in this condition* is exactly
what the collector sends back, and on an imported wish list it is the main output — so a gap is an
outcome carried out to the report, never a dropped row or an exception.

**The candidate set is §13's**, minus the copies held back on this trade: what `listOfferableCopies`
allows, matched on the requirement rather than on a copy's own key. Blocked copies are excluded here
rather than listed, because an automatic pick has no business reaching past a decision the collector
already took.

**Eligibility is re-checked on write.** The resolver runs over a whole imported file, and a copy can
be sold in the minutes between resolving it and confirming it — so the write goes through the same
bulk add the picker uses, which names its refusals per copy, and the report puts a refused copy back
on the shortfall it came from.

The chosen copy is the **effective** one, written to `TradeLine.itemId` like any other give line:
§13's pool then exposes the rest, and the partner may still propose a different one (#658).

## Consequences

- A new module: `trade`, `trade_section`, `trade_line`, plus `collection.nextTradeNo`.
- `Contact` gains a `Restrict` guard from `Trade.partnerId`, like every other counterparty link, and
  `Item` gains one from `TradeLine.itemId`: a copy promised to a partner must not vanish from under
  the agreement.
- The disposition flag `Item.forTrade` becomes the default filter of the give-side copy picker; it
  keeps its existing meaning and gains no new one.
- Downstream work — the trade screen, the balancing engine, copy reservation, the partner's share
  link, partner feedback, realisation, the printouts, closing into a purchase, and the Colnect
  list import — all build on this model rather than extending it. Columns those changes read ship
  with them, not here.
- `trade_copy_block` (§13) is the one table added since, and it stores an **exception** rather than a
  set: the candidate pool itself is derived on every read.
- #638 shipped its own, per that rule: `trade_line.manualValue` and `trade_line.catalogVendorId`
  (the two escape hatches), `trade_line_valuation` (the freeze) and `trade_fx_rate` (the rates). It
  also lifted the three access guards into `trade-access.ts`, below both halves of the domain, so
  that `trades.ts` calling the engine's gate and the engine calling those guards is not a cycle —
  the same move `item-valuation.ts` made for `items.ts` and `market-values.ts`.
- #639 shipped **none**, which is the rule holding rather than an exception to it: reservation is a
  give line on an agreed trade and a live listing is an active offer, so both questions are asked of
  records that already answer them. A flag on `Item` would be a second place for the truth to live,
  and the day it disagreed with the trade there would be no way to tell which was right — the same
  reasoning that makes `SaleLineItem` the record of a sale.
- #640 shipped `trade_share_token` and one new surface: `/t/[token]`, the app's first page reachable
  without a session, with a photo route beside it (`/api/t/[token]/photos/…`) rather than a second
  kind of caller taught to the collection-scoped one — a mistake in that route would be a mistake
  about a whole collection instead of about one list. It also added `rate-limit.ts`, in-process and
  coarse, because a bearer token in a URL is the one thing here an account is not.
- #641 shipped `trade_feedback`, one `POST /api/t/[token]/feedback` route, and the partner page's
  first client code — the per-line control and the note box, and nothing else. It also lifted the
  line labeller out of the balancing engine into `trade-line-label.ts`, so a line named in a
  valuation refusal and the same line named in a piece of feedback are recognisably the same line.
- #642 shipped two columns — `trade_line.fulfillment` and `trade_line.fulfillmentNote` — and no
  table, because a verdict is one fact about one line and a row of its own would be a second place
  for the same answer to live. It also lifted the per-line access guard into `trade-access.ts` beside
  the other three, for #638's reason: `trades.ts` asks the realisation half whether a trade may close,
  so the realisation half reaching back into `trade-lines.ts` for that guard would be a cycle.
- #644 shipped two columns and no table: `purchase.tradeId` and `purchase_lot.tradeLineId`, both
  `UNIQUE` and both `RESTRICT`. A trade already turned into inventory must not vanish from under the
  purchase holding its carried-over cost, so deleting a closed trade is refused by name, with the
  order to delete first. The outgoing side gained **nothing** — §11's rule holding again: a copy has
  left when a give line of a closed trade names it, so `trade-exit.ts` is one `where` fragment spread
  wherever the sold guard already sits (the copies list and its chip, the copy counts, the wants, the
  two completeness reads, the purchase-cost section, the give-side picker and the reservation read).
  The Copies list's *include sold* toggle became *include sold & traded* rather than growing a second
  one beside it: to a collector, gone is gone.
- #643 shipped **no schema at all**, which is §11's rule holding once more: what a printout needs is
  what the list already records. The give side is copies, the sections are the trade's own, and the
  tick on the checklist is `fulfillment` — a second *packed* flag beside it (the sale's, #192) would
  be a second record of one fact, and the two would disagree the first time a collector ticked one
  and not the other. What it did do is take the sale's packing list apart: `packing-list.ts` was pure
  and coupled to sales through one thing, its input type, so the input became a structural projection
  and the shaping now serves three sheets — the sale's list, the trade's checklist, and the parcel
  enclosure. The sheet component moved to `shared/packing-sheet.tsx` with its column chips and its
  global preference key intact, and each printout brings its own columns.
- #645 shipped two: `trade_section.defaultConditionId` and the `trade_colnect_list` table. The
  column is what a Colnect row *stating no grade* means — a real export states one on three rows in
  eight, and a condition is required on both sides — put on the **section** because a section is
  already the unit a list is grouped into, so the grade belongs to it far more often than to a row.
  Null means the section states none, and then a silent row is a gap rather than a guess. The table
  holds the addresses of the lists the exchange is about, each with a side and a label: a Colnect
  trade *is* two lists, a partner routinely sends several, and the link travels to the partner's page
  because they are reading stamps they wrote themselves and have no other way back to their own copy.
  It is **ungated by status**, unlike everything under §5's lock — that lock guards the contents of a
  list somebody is holding a copy of, and an address is not contents. No import record was added and
  none will be: a line is a promise about a copy and stands on its own, and a provenance column would
  be a second story about it that nothing keeps true. It also moved `parseCsvRows` out of the
  Delcampe reader into `csv.ts` and gave it a line number per record, so both file readers agree
  about quotes, blank lines and which line a refusal is pointing at. The export's `List` /
  `Quantity` / `Condition` columns are **positional per list** — one stamp is mint on the wish list
  and used on the swap list in the same row — so which list is being imported is asked, with the one
  the most rows carry offered as the answer, and rows outside it are not part of the import rather
  than gaps in it.

- `CopyValuation` gained `catalogNameId` and `editionYear`. Every other reader ignores them; the
  freeze needs them, because a snapshot recording an amount but not the book and edition behind it is
  a number the partner's printout can never be checked against.
