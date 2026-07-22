# Offers

An **offer** is a [lot](lots.md) listed on **one platform** — a marketplace such as Delcampe,
Allegro, or Colnect. The lot is *what* you are selling; the offer is *where*. Because a lot is
platform-agnostic, the **same lot can carry several offers at once** (one per platform), each
with its own asking price, currency, and listing URL.

Open the **Offers** screen from the **Trading** section of the sidebar.

## Listing a lot

You can list a lot two ways:

- **From the lot's detail screen** — open a lot and use **List on platform** in its *Offers*
  section. The lot is already chosen, so you only pick the platform and price.
- **From the Offers screen** — click **New offer**. Because an offer always lists a lot, you
  first **choose the lot** in a browse dialog: filter by kind (Unit / Quantity) and state
  (Draft / Ready), search by title or catalog number, and pick from a list showing each lot's
  copy count and catalog value. Choosing the lot opens the offer form.

Either way you fill in:

- **Platform** — start typing to search your [contacts](contacts.md) that are marked as
  platforms; pick one, or type a new name to create it on the fly.
- **Asking price** and **currency** — priced per offer, because platforms price independently.
- **Listing URL** (optional) — a link to the live listing, so you can jump straight to it later.

Only lots that are still composed (not [dissolved](lots.md)) and hold at least one member can be
listed.

## One active offer per platform

You should keep **at most one active offer per copy, per platform** — otherwise the same stamp
could sell twice on the same marketplace. When you list (or edit) an offer, Stamporama checks
for this and shows a **heads-up** if another active offer on that platform already includes a
copy from this lot. It is only a warning: you can still proceed, but normally you would pause or
withdraw the other offer first. (Listing the *same* lot on *different* platforms is exactly the
point and is never flagged.)

## Offer lifecycle

An offer moves through these states:

- **Active** — live on the platform. This is where a new offer starts.
- **Paused** — temporarily suspended (for example, while you rethink the price). Copies stay
  committed to the lot. Resume it back to active any time.
- **Withdrawn** — taken down for good. This is **final**: to sell there again, list the lot as a
  new offer.
- **Sold** — set automatically when you [record a sale](sales.md) through the offer. You do not
  mark an offer sold by hand.

From the row's **⋮** menu you can **edit** the price / platform / URL, **pause** or **resume**,
**withdraw**, open the live listing, or **delete** the offer. Deleting an offer never touches the
lot or the copies inside it — it only removes the listing record.

## Filtering

The toolbar filters offers by **platform** and by **state** (Active / Paused / Sold / Withdrawn),
so you can, for example, see everything still live on one marketplace at a glance.

## Related

- [Lots](lots.md) — the packages you list.
- [Sales](sales.md) — record a sale when an offer sells.
- [Contacts](contacts.md) — mark a contact as a **platform** to list on it.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used later for profit/loss.
