# Delcampe

Delcampe is a platform you **sell** on, and Stamporama prepares its listings the way it prepares
every other platform's: the title and description come from that platform contact's
[templates](offers.md#listing-title), the price and quantity from the offer, the photos from its
photo plan. What is different is how a listing gets there — Delcampe takes an uploaded file rather
than a form filled in by the browser extension.

Everything on this page lives under **Settings → Delcampe**.

## Which platform is Delcampe

The first setting on the tab, and the one everything else hangs off. Pick the contact you use for
Delcampe — it needs the **Platform** role (see [Contacts](contacts.md)) — and its currency, listing
templates and photo limits are set on the contact itself, exactly as for any other platform.

Only one platform can be Delcampe at a time. Naming it does **not** switch the
[Assistant](assistant.md) on: there is no Delcampe form for the extension to fill, so no
⚡ *List via Assistant* button appears on those offers, and none of the Colnect checks (a catalog
item-ID on every stamp, a mapped grade) is asked of them.

## Listing profiles

An upload row states a few things no offer knows about itself:

- **the shipping model** it is sent under,
- **how long and how often** the listing renews itself,
- which of Delcampe's **paid promotions** it buys,
- the **minimum bid step** it declares.

A **listing profile** is one answer to all four at once. One profile is the platform's *default* —
what every listing goes up with — and an offer can name a different one. That is what the second
profile is for: the standard letter for most lots, something heavier and tracked for the rest.

### The shipping model is a name, and it has to be exact

Delcampe's upload file names your shipping model **by its name**, and Stamporama cannot read your
list of models from Delcampe (that needs their paid API subscription, which this app does not use).

So type it exactly as it reads on Delcampe. If you rename a model there, uploads using that profile
will be **rejected by Delcampe** until you update the name here — there is nothing Stamporama could
have warned you about beforehand, and the rejection is not a fault in the file.

### Renewal

The defaults are shop-stock behaviour: the listing runs for **28 days** and renews up to **99
times**, which in practice means it stays up until it sells. *Re-buy the paid options on every
renewal* only means anything while one of the promotions is on — each renewal is charged again.

Auction-style listings need a real end date instead, and are not configured here yet.

### Paid promotions

Bold title, background colour, border colour, promoted in lists, promoted on the home page. Each of
these **costs money on Delcampe**, and the upload file states a yes or a no for every one of them,
so they are set here rather than decided for you. All five are off unless you turn them on.

### Minimum bid step

Delcampe's listings declare a bid step that changes with the price — 0.01 on cheap items, 0.10 on
dearer ones. Where exactly it changes was never confirmed, so it is a setting rather than something
buried in the code: a **threshold price**, the step used **below** it, and the step used **at or
above** it. A listing priced exactly at the threshold takes the larger step.

The line under the fields reads the rule back to you in the form it will be applied. If you ever see
a Delcampe listing state a different step, correct the threshold here.

## On an offer

An offer on the Delcampe platform carries an **On Delcampe** card on its own screen, under the
photos. It shows which profile applies — the platform's default, or one this offer names — and what
that profile actually says: the shipping model, the renewal setting, the bid step, and whether any
paid promotion is bought.

Changing the profile here affects this offer only. Editing a *profile* under Settings affects every
future upload that uses it and nothing already listed: Delcampe holds a listing's settings from the
moment the file went up.

## Deleting a profile

Nothing blocks it. Offers that named it fall back to the platform's default, and Stamporama tells
you how many did. If you delete the **default**, the platform is left without one — no other profile
is promoted in its place, because which settings your next upload carries is your decision.
