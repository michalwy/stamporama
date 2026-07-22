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
   and there's no listing URL until the auction is up. Creating the offer opens its detail screen.
2. On the detail screen, use **Add set** to pick copies from your inventory. When you pick more
   than one copy you choose how they go in:
   - **Each copy as its own set** — a quantity of interchangeable singles, and
   - **One set holding all of them** — a series sold together.
3. Repeat **Add set** to build up a quantity, or to add different sets to the same listing.
4. Once you know them, set the **asking price** and paste the **listing URL** **in place** on the
   offer's header — click the value to edit it (Enter or click away saves, Escape reverts). The
   **currency** is fixed by the platform and shown read-only, and the offer's **state** actions live
   in the header's **⋮** menu.

Next to the asking price the header shows a **suggested price** — the **average catalog value per
set** (converted to the **offer's currency**), since an offer's price is per one set a buyer takes.
**Use** applies it as the asking price in one click. It's a starting point; price as you see fit.

Only copies that are **For sale**, **delivered**, **unsold**, and **not already in this offer**
can be added. To list the same package on another marketplace, just create a second offer and
compose it the same way.

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

- **Active** — live on the platform. A new offer starts here.
- **Paused** — temporarily suspended; the copies stay committed. Resume any time.
- **Withdrawn** — taken down for good. **Final**: to sell there again, create a new offer.
- **Sold** — set automatically when a [sale](sales.md) sells every set through the offer. You do
  not mark an offer sold by hand.

Changing a platform's currency later leaves existing offers and sales untouched — each keeps the
currency it was created with as a permanent record; only new offers and sales use the new currency.

From the row's **⋮** menu you can **edit** the price / platform / URL, **pause** / **resume**,
**withdraw**, open the live listing, or **delete** the offer. Deleting removes the offer and its
sets; the copies stay in your inventory. An offer with a sold set can't be deleted — withdraw it.

## Filtering

The toolbar filters offers by **platform**, by **state** (Active / Paused / Sold / Withdrawn), and
by **Needs action** (the derived overlay above). The state filters and **Needs action** are
mutually exclusive.

## Related

- [Inventory](inventory.md) — the copies you compose offers from.
- [Sales](sales.md) — record a sale when an offer's set sells.
- [Contacts](contacts.md) — mark a contact as a **platform** to list on it.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used later for profit/loss.
