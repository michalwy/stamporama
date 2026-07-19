# Inventory

Your **inventory** is the physical copies you own. A **copy** is a single physical stamp:
each copy is its own record, so two copies of the same stamp can differ in condition,
certificate, disposition, purchase details, and notes. There is no "quantity" — three
copies of the same stamp are three rows.

Open the **Inventory** screen from the **Collection** section of the sidebar.

## The inventory list

Each row shows:

- The linked stamp's **catalog number**, **name**, and **issue**.
- The **condition** and any **certificate status**.
- **Disposition** markers — *In collection*, *For sale*, *For trade* — a copy can carry
  any combination at once.
- The copy's **catalog value** (see [Copy value and holdings total](#copy-value-and-holdings-total)).
- The **purchase price** and **acquired date**, when recorded.
- A notes indicator when the copy has notes (hover to read them).

If a copy is linked to a base stamp whose specific variant is unknown, it is flagged
**unknown variant**. Such a copy is valued cautiously and its uncertainty stays visible;
you can pin down the exact variant later — see [Identifying a variant](#identifying-a-variant).

The list loads more rows as you scroll. Your filters, sort, and position are kept in the
page URL, so you can bookmark or share a filtered view.

### Filters and sorting

- **Disposition** — toggle *In collection*, *For sale*, and *For trade*. With none
  selected, all copies are shown. Selecting several narrows to copies matching every
  chosen marker.
- **Condition** — show only copies of one condition.
- **Sort** — by date added or acquired date, ascending or descending.

## Copy value and holdings total

Each copy is valued from your **catalog prices** — this is independent of what you paid
(the purchase price). A copy's value is the price for its **own condition and certificate
status**, taken from the **primary catalog of the stamp's area** at that catalog's
**latest recorded edition**:

- **Identified copy** — the price of its specific variant.
- **Unknown-variant copy** — if the base stamp itself has a price, that is used;
  otherwise the **lowest** price among the base stamp's variants (compared in your base
  currency). Either way the value is an estimate: it is shown in italics with a leading
  `~`, because the exact variant isn't settled. Resolving the variant later replaces the
  estimate with that variant's own price.

The certificate status must match exactly — a copy with a certificate is only valued from
a price recorded *for that certificate status*; there is no fall-back to the no-certificate
price. A copy with no matching catalog price shows **—** (unpriced).

Values are converted to your collection's **base currency** for display and totalling. A
price in a currency with no available exchange rate is shown in its own currency and left
out of the total.

Above the list, the **Holdings value** bar sums the value of every copy that matches your
current filters (change the filters and the total follows). It also tells you how much of
the total is uncertain (unknown-variant estimates) and how many copies are unpriced or
could not be converted.

## Viewing copies from the catalog

You don't have to open the Inventory screen to see what you own. Both the **Stamps**
list and the **Issues** list carry a **Copies** button:

- On a **stamp** row, **Copies** opens a popup listing every copy you own of that stamp.
- On an **issue** row, **Copies** opens a popup listing every copy of *any* stamp in that
  issue — a quick way to see your holdings for a whole issue at once.
- Expanding an issue reveals its individual stamps, each with its own **Copies** button
  for the copies of just that stamp.

The popup shows the same copy details as the Inventory list (condition, disposition,
value, purchase and acquisition details), but is **read-only** — it's for looking, not
editing. Close it to return to the list exactly where you were; nothing navigates away.
To add, edit, or delete copies, use the **Inventory** screen.

## Adding a copy

1. Click **Add copy**.
2. **Choose the stamp or variant** in one of two ways:
   - **Type to search** in the field. Suggestions match the stamp name, its issue name,
     and **catalog numbers** — including the vendor and area prefix. Catalog search
     ignores spacing, so `Mi PL 200`, `Mi PL200`, `MiPL200`, and just `200` all find the
     same stamp. Each suggestion shows its catalog number, name, issue, year, and area so
     you can tell similar stamps apart.
   - **Browse…** opens a larger picker: pick an **area** on the left, filter its **issues**
     on the right, then expand an issue to choose a stamp or one of its variants.

   Choose a specific variant if you know it, or the **base stamp** if the variant is
   unknown. The chosen stamp appears as a summary with a **Change** link to reselect.

   If the stamp isn't in your catalog yet, you can add it without leaving the browser
   (you must still pick an existing **area** first):
   - **+ New issue** (top of the issue list) adds an issue to the selected area. It then
     appears in the list, ready for you to add a stamp to it.
   - **+ New stamp** (inside an expanded issue) adds a stamp to that issue and selects it
     for the copy straight away.
   - **+ variant** (next to a base stamp) adds a variant under that stamp and selects it.
3. Choose the **condition** (required) and, optionally, a **certificate status**. Both
   come from your collection's configurable sets.
4. Set the **disposition** flags. New copies default to *In collection*.
5. Optionally record the **acquisition source**, **acquired date**, **purchase price and
   currency**, and free-form **notes**. The **source** is a contact: start typing to
   search your existing contacts, or type a new name and choose **Create** to add it —
   a new contact is created and linked to the copy. (You can fill in that contact's
   roles and details later from your contacts.)
6. Click **Add copy**. Everything is saved together in one step.

## Editing a copy

Hover a row and click **Edit**. The same dialog opens with the copy's current values.
Changing the stamp to a more specific variant re-points the copy and records the change
in its refinement history.

## Identifying a variant

When you record a copy against a **base stamp** because you don't yet know its exact
variant, the copy is flagged **unknown variant**. Once you work out which variant it
actually is, resolve it:

1. On an unknown-variant row, click **Identify variant**.
2. Pick the specific variant from the list — only the variants of that copy's own stamp
   are offered, so you can only refine to a *more specific* variant, never re-point the
   copy to an unrelated stamp.
3. Optionally add a **reason** (for example, what let you tell the variants apart).
4. Click **Identify variant**. The copy is re-pointed to the chosen variant, the
   *unknown variant* flag clears, and the change is recorded in the copy's refinement
   history.

## Refinement history

Every time a copy is re-pointed to a different variant — whether through **Identify
variant** or by changing the stamp in **Edit** — the change is appended to that copy's
**refinement history**: what it was, what it became, when, and any reason you noted. Any
copy that has been refined shows a **History** button; click it to see the full trail.
The trail is never erased, so a copy's identification path stays traceable even after the
variant is settled.

## Deleting a copy

Hover a row and click **Delete**, then confirm. This permanently removes that physical
copy record and cannot be undone.
