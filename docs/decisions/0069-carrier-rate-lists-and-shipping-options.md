# ADR-0069: Carrier Rate Lists Are Global; a Platform Offers Shipping Options

## Status

Accepted. Decided with the collector on 2026-10-14 and built by #1909. Amends the shipping-method
model of #468 (which had no ADR of its own), [ADR-0068](0068-packing-supplies.md) §7 and §8, and the
buyer message's `{shippingOptions}` (#1815). #1910 gives the agent API the same model.

## Context

Until #1909 each platform kept its own **shipping methods**, each with what it cost the collector to
send (#468): *registered letter — 12 PLN* on Allegro, again on Colnect, again on Facebook. A price
change had to be made on every platform, and the copies drifted. The cost of posting a letter has
nothing to do with where the stamp sold.

What does belong to a platform is the shipping the collector **offers buyers** there, at the price
the buyer pays. The one amount a method carried was doing both jobs: it pre-filled the collector's
postage on a sale, and the buyer message listed it to buyers as the price of each option.

The carriers themselves were already global (#491) — a carrier tracks a parcel the same way whichever
marketplace it came from — and a method could name its usual carrier.

## Decision

### 1. Carriers and their rate lists are the collector's own, global, and tied to no platform

A **carrier** (`Carrier`, unchanged from #491) has **services** (`CarrierService`): a name and a cost
with its currency — *List polecony ekonomiczny — 9.50 PLN*. Service names are unique within their
carrier. Both are managed under **Settings → Carriers**, as a two-level tree beside the selected
item's detail, the shape the Catalogs page already has (ADR-0059). **A rate list is never per
platform.**

A carrier with services cannot be deleted, nor can one a sale names; a service a platform option
links to cannot be deleted. Each is `Restrict` with an `*InUseError` naming the count.

### 2. A platform has shipping options, at the buyer's price

`ShippingOption` (the `shipping_method` table renamed) is what the collector offers buyers on one
platform: a name and **the price the buyer pays**, with its currency, linked to **at most one**
carrier service. Names stay unique per platform. The options are not the collector's costs.

### 3. On a sale, the option records what the buyer chose and the service supplies the defaults

Choosing a platform's option on a sale records the option (link + name snapshot, as #468 had it) and
**pre-fills the postage from its linked service**, editable for that parcel. An option with no link
leaves the postage to be entered. The sale's default carrier — the fallback for its tracking link
(#491) — is the linked service's carrier.

### 4. Default packing supplies belong to the carrier service

What goes into a registered letter does not depend on where it sold, so the default supply list of
ADR-0068 §8 moves from the method to the service (`CarrierServiceSupply`). The swap rule is
unchanged; it is applied with the lists of the services the old and the new option are linked to,
**read through each option's link as it stands now** — a sale stores no service of its own.

### 5. `{shippingOptions}` lists buyer prices

The buyer message lists the platform's options at the **buyer's** price, never the collector's cost.

### 6. Sales keep their snapshot

A price change in the rate list or an option never rewrites a sale already recorded, as #468 kept
names and costs.

### 7. Existing data moves over, nothing lost

The migration (`20261014400000_carrier_rate_lists`), with two refinements the collector settled on
2026-10-14:

- Each platform's methods become that platform's options, with the same names; **the buyer price is
  the method's old cost**, which is what `{shippingOptions}` showed buyers until then.
- Each distinct **carrier, name, cost, currency and supply list** among the methods becomes one
  service, linked from every option it came from, and keeps the supply list. A method that named a
  carrier puts its service **under that carrier**, so old sales keep their tracking link; one that
  named none goes under an **Unassigned** carrier (reused if the collection already had one), for the
  collector to sort into real carriers.
- The supply list is part of the key so that two methods merged into one service cannot lose either
  list. Two services that would share a name under one carrier are named with their cost after it —
  *List polecony — 12.00 PLN* — and numbered where even that collides.
- A sale's `shippingMethodId` / `shippingMethodName` become `shippingOptionId` / `shippingOptionName`
  with their values; its postage was always a copy and is untouched.

## Consequences

- The model's words are the domain's: a platform's *options*, a carrier's *services*. The Prisma
  models, the sale's columns and the code follow (`shipping-options.ts`, `carriers.ts`,
  `service-supplies.ts`). One wire name stays: the Colnect import summary's `shippingMethodName`,
  because the browser extension reads it and an installed extension is not updated with the app.
- A collector who sells the same service on three platforms prices it once; re-pricing it reaches
  every platform's next sale and no sale already recorded.
- The Allegro and Colnect imports still match a delivery method to an option **by name**; a match
  pre-fills the postage from the option's service (Allegro) or records no cost (Colnect, as before).
- The agent API has no operations over carriers, services or options yet (#1910).
