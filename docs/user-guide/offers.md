# Offers

An **offer** is something you list on **one platform** — a marketplace such as Delcampe, Allegro,
or Colnect. The offer **owns what it lists**: you compose it from your inventory copies as one or
more **sets**. Nothing is shared between offers, so the *same* copy listed on two platforms is two
independent offers — each tracked, edited, and sold on its own.

Open the **Offers** screen from the **Trading** section of the sidebar.

## Sets — what an offer is made of

A **set** is one whole sellable unit inside an offer. It holds one or more copies that **sell
together and never split apart**:

- a **single stamp** → a set with one copy,
- a **series / komplet** (several different stamps sold as one) → a set with several copies,
- a **quantity** of interchangeable duplicates → **several sets** (one per copy).

There is no "unit vs quantity" choice to make — every offer is simply "a listing with one or more
sets". A plain single-stamp offer is just the one-set case.

## Creating and composing an offer

1. Click **New offer** and choose the **platform**. The **currency** comes from the platform — it
   is shown locked and applies to every offer and sale there. The first time you list or sell on a
   platform that has no currency yet, you pick one inline and it is saved to the platform. That's
   all you need — you usually don't know the asking price yet (it follows from the copies you add)
   and there's no listing URL until the auction is up. A new offer starts as **Preparing** (still
   being composed, not yet live). Creating the offer opens its detail screen.
2. On the detail screen, use **Add set** to pick copies from your inventory. When you pick more
   than one copy you choose how they go in:
   - **Each copy as its own set** — a quantity of interchangeable singles, and
   - **One set holding all of them** — a series sold together.
3. Repeat **Add set** to build up a quantity, or to add different sets to the same listing.
4. Once you know them, set the **asking price** and paste the **listing URL** **in place** on the
   offer's header — click the value to edit it (Enter or click away saves, Escape reverts). Once a
   listing URL is set, its **🔗 Listing** link opens the listing when clicked; use the **✎** pencil
   beside it to change the URL. The listing URL stays editable in **every** state — including a
   **sold** or **withdrawn** offer — so you can keep the record straight after the fact. The
   **currency** is fixed by the platform and shown read-only, and the offer's **state** actions live
   in the header's **⋮** menu.
5. When the listing is up on the platform, **Activate** the offer (in the header's **⋮** menu) to
   move it from **Preparing** to **Active**. An offer needs at least one set before it can be
   activated.

Next to the asking price the header shows a **suggested price** — the **average catalog value per
set** (converted to the **offer's currency**), since an offer's price is per one set a buyer takes.
**Use** applies it as the asking price in one click. It's a starting point; price as you see fit.

When the offer's currency differs from your collection's base currency, the asking price also shows
a base-currency equivalent (**≈ 200 PLN**) — on both the offer list and its detail — converted at
the **current** exchange rate, so you can compare offers across platforms at a glance.

Only copies that are **For sale**, **delivered**, **unsold**, and **not already in this offer**
can be added. To list the same package on another marketplace, just create a second offer and
compose it the same way.

You can also add a single copy to an existing offer straight from the [Inventory](inventory.md)
list — the copy's **⋮** menu carries an **Add to offer** action. Its picker lists your offers (with
state filters and search), and you choose where the copy lands: as a **new set**, or dropped into
an **existing set** to build a series. That's the quick path for listing one copy; use **Add set**
here when composing several copies at once.

The offer's sets render like a [purchase order](purchases.md): each set is a **collapsible card**
showing its copies as full inventory rows. Group by **Set** or **Location**, optionally sub-group
by **Issue**, and **sort** the copies — handy for pulling pieces off the shelf as you list them.
Each copy row has a quick **+ catalog value** link (click the value to edit it) so you can fill in
missing catalog prices without leaving the offer — which also feeds the suggested price. The
**Only** filters — **Unpriced**, **No photo**, and **Unknown variant** — narrow the view to copies
that still need a catalog value, a photo, or their variant identified, so you can clear them before
listing.

## One active offer per copy, per platform

You should keep **at most one active offer per copy, per platform** — otherwise the same stamp
could sell twice on the same marketplace. When you add a copy that another active offer on that
platform already lists, Stamporama shows a **heads-up**. It is only a warning: you can proceed,
but normally you would remove it from the other offer first. (Listing the same copy on *different*
platforms is exactly the point and is never flagged.)

## Listing the same thing on another platform

To offer the same stamps on a second marketplace, you don't re-compose them by hand. From an
offer's **⋮** menu (on the list or the detail screen), choose **List on another platform**. Pick
the new platform; the asking price **and currency** carry over from the original offer. If the new
platform uses a different currency, the price is **re-converted** at the collection's current
exchange rate — still editable, so you can round or adjust it for the new marketplace.

Stamporama then creates a **new draft offer** with the same sets and copies, and opens it so you
can review, price, and activate it. The copy is an independent snapshot: editing either offer
afterwards — renaming a set, changing the price, adding a copy — leaves the other untouched. Any
copy that has already **sold** elsewhere is left out of the clone, with a note telling you how many
were skipped. The new offer's listing URL starts blank — paste it once the listing is live.

Both offers now list the overlapping copies, which is exactly the cross-platform workflow the
[needs-action](#keeping-platforms-in-sync--needs-action) sync is built for: selling on one platform
flags the twin on the other.

## Keeping platforms in sync — "needs action"

Because a copy can be listed on several platforms, selling it in one place leaves the other
listings stale. Stamporama surfaces this automatically: an **active** offer holding a **set whose
copy has sold elsewhere** is flagged **Needs action** — a red badge on the offer row and on the
affected set, plus a **Needs action** filter in the toolbar.

To resolve one, open the offer and:

- **Quantity still available** → **remove the affected set** (this is the decrement — the offer
  now lists one fewer), after updating the quantity on the platform itself.
- **Nothing left to sell** → **withdraw** the offer.

The offer the sale actually went through is handled for you — it becomes **Sold** once *every* set
has sold through it (a partial sale keeps it **Active** for its remaining sets). Nothing is done to
other platforms automatically — you stay in control of each marketplace. The flag is derived live
from what has sold, so it clears the moment the offer no longer holds a sold copy.

## Offer lifecycle

- **Preparing** — composed but not yet published. A new offer starts here. **Activate** it (in the
  **⋮** menu) once the listing is live on the platform.
- **Active** — live on the platform.
- **Paused** — temporarily suspended; the copies stay committed. Resume any time.
- **Withdrawn** — taken down for good. **Final**: to sell there again, create a new offer.
- **Sold** — set automatically when a [sale](sales.md) sells every set through the offer. You do
  not mark an offer sold by hand.

The states are **orientational** — they help you sort and filter your listings. They don't restrict
composing: you can add sets or copies to a Preparing, Active, or Paused offer alike; only Withdrawn
and Sold offers are frozen.

Changing a platform's currency later leaves existing offers and sales untouched — each keeps the
currency it was created with as a permanent record; only new offers and sales use the new currency.

From the row's **⋮** menu you can **edit** the price / platform / URL, **activate** a preparing
offer, **pause** / **resume**, **withdraw**, open the live listing, or **delete** the offer. Deleting removes the offer and its
sets; the copies stay in your inventory. An offer with a sold set can't be deleted — withdraw it.

## Filtering

The toolbar filters offers by **platform**, by **state** (Preparing / Active / Paused / Sold /
Withdrawn), and by **Needs action** (the derived overlay above). The state filters and **Needs action** are
mutually exclusive.

## Related

- [Inventory](inventory.md) — the copies you compose offers from.
- [Sales](sales.md) — record a sale when an offer's set sells.
- [Contacts](contacts.md) — mark a contact as a **platform** to list on it.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used later for profit/loss.
