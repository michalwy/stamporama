# Phone Screens

The phone-only screens under `/c/[collectionSlug]/phone/`, and the rule that keeps every other screen
desktop-only.

- **Mobile web, not an Android app** (#2000, ADR-0072, decided with the collector on 2026-10-17). The
  phone is always online against the collector's own server, signs in with the same account and
  password and keeps the desk's 400-day session (ADR-0052). It is **not an agent API client**: the
  moves the phone makes — sale status, shipment, offer state, a Facebook bid — are deliberately absent
  from `/api/v1` (ADR-0050), and the phone reuses the desk's server actions instead. No offline mode,
  no service worker cache; a web app manifest only, for the home-screen icon.
- **A separate, reduced set of phone screens, never a breakpoint on a desktop screen.** Phone pages
  live under `/c/[collectionSlug]/phone/…`, with `/phone` as the start (straight into the collection,
  or the list when there are several). They are drawn at phone width without the desktop sidebar, and
  share the desk's domain logic and server actions — never a second copy of a rule. A phone screen has
  no desktop layout; a desktop screen gains no phone layout, and opened on a phone it renders as it
  always has. Making the existing screens responsive was rejected: they are built on the window's full
  width (#1851) with no breakpoint anywhere.
- **No redirect by device.** The home-screen icon opens `/phone`; every phone screen links to the full
  app and the full app links to `/phone`. A redirect guesses, and guesses wrong for a tablet or a
  narrow desktop window.
- **Reaching the server from outside home is the installation's job**: one HTTPS address, the same on
  the desk and on the phone, since a move to another address or between http and https ends the
  session. The app adds nothing for it.
- **The screen-frame rule (`Screen`, `SCREEN_CAPS`) is a desktop rule.** Phone pages use a phone frame
  of their own, and the screen-frame test knows the difference (#2002).

## The shell (#2002)

- **`/phone`** (`src/app/phone/page.tsx`) is the manifest's `start_url`. `phoneStart` (`src/lib/phone.ts`,
  pure, unit-tested) decides it: one collection → its phone start, several → a phone list of them,
  none → a line pointing at the full app. **No collection is remembered** — with several the list is
  one tap. Signed out, it goes to `/sign-in?next=/phone` like any screen (#1176), so signing in on
  the phone lands back on the phone.
- **A collection's phone start** is `/c/[collectionSlug]/phone` (`phoneHomePath`). Its rows come from
  `PHONE_ENTRIES` (`phone/phone-entries.ts`) — each screen in the table below adds its own row,
  except the stamp screen, which search and browsing open. *Other collections* shows only when
  there are several.
- **No sidebar on a phone screen**: the collection layout hands the sidebar to `CollectionFrame`,
  which leaves it out when the open segment is `phone` (`useSelectedLayoutSegment`). The phone
  screens stay inside the layout's providers and collection check — no route group, no second copy.
- **`PhoneScreen`** (`src/app/phone-screen.tsx`) is the phone frame: `PHONE_SCREEN_WIDTH` (30rem,
  centred when opened on a desk), a sticky header with the title and **Full app**, `fullAppHref`
  required so every phone screen names its desk counterpart. `PHONE_TAP_TARGET` (3rem) is the floor
  for a thumb's control; `phoneRow` is the list row. `tests/unit/screen-frame.test.ts` holds every
  page under `phone/` and `src/app/phone/` to `PhoneScreen` and away from `Screen`.
- **The full app's link** is *Phone screens* in the sidebar footer.
- **The manifest** is `src/app/manifest.ts`, `scope: "/"` so *Full app* stays in the home-screen
  window. Its icons are in `public/`: `phone-icon-192/512.png` rendered from `src/app/icon.svg`, and
  `phone-icon-maskable-512.png` from `public/phone-icon-maskable.svg` (the mark inside Android's safe
  zone on white) — the render command is in that file. The manifest is fetched without the session
  cookie, so nothing in it depends on who is signed in.
- **The sign-in screen** keeps a margin from a phone's edges and shrinks its padding with the window
  (`clamp`); it is not a breakpoint, and the desk sees the card as before.

## Sales to do (#2007)

- **`phone/sales`** lists the Dashboard's Sales section's three status groups — the same reader
  (`listSalesAwaitingFulfilment`), the same groups and order (`salesInStatus`), the row's wording from
  `saleDashboardItem`. The bell's *Sold on Allegro, no sale recorded* group is not here: it is the
  step before a sale exists, and recording a sale is the desk's. Rules in `phone-sales-rules.ts`
  (pure); *Full app* is the Sales list.
- **One step forward per sale** (`phoneSaleStep`): *Mark paid*, *Mark packed*, *Mark sent*. No other
  status, no step back.
- **The desk's writes and the desk's questions, never a copy of them**: `setSaleStatusAction`,
  `markSaleCopiesPackedAction`, `updateSaleShipmentAction`; the questions are `asksAboutUnpackedCopies`
  (#973) then `asksForShipment` (#491) in `sale-status.ts`, which the desk's sale screen asks through
  too, and the shipment step's *going by* is `shipmentGoingBy` (`sale-rules.ts`). The reader works the
  parcel out with `parcelInForce`, the one the sale screen's read uses. Asked inline in the row, not a
  dialog.
- **Mark paid asks nothing** — the desk's total-paid prompt (#443) is skippable, and the phone skips
  it, since the issue settled that *sent* is the one step that takes input and the amounts stay at the
  desk (decided in writing #2007).

## Offers (#2008)

- **The list** (`phone/offers/`) is the desk's own pages of offers (`useOffersInfinite`, the offers
  route) under two narrowings kept in the URL as the desk keeps them, `platform` and `state` — one
  state or none, none being the desk's default of every offer not closed. **Two selects, not the
  desk's `FilterChip` row**: a toolbar chip is under `PHONE_TAP_TARGET`, and seven states do not fit a
  phone's width. The select keeps a style of its own at the tap target rather than spreading
  `formControl` and overriding its height, which `form-control-height.test.ts` forbids.
- **The offer screen** (`phone/offers/[offerId]/`) is a server page over `getPhoneOffer`
  (`src/lib/phone-offers.ts`), which takes its title, price and conversion from `getOfferDetail` so
  they are the desk's to the letter. **Its picture** (decided with the collector on 2026-10-17): the
  first image of the upload set (`readOfferUploadPlan`) — what a buyer sees first — else the photo of
  the first copy, in set order, that has one, front before back (`sortPhotos`).
- **The moves are pause, resume and withdraw**, from `phoneOfferMoves` (`src/lib/phone-offer-moves.ts`,
  pure, unit-tested), read off `manualTransitions` rather than listed: the phone offers a move exactly
  when the desk allows it. **Resume is `paused → active` only** — `ready → active` is publishing and
  `pending → active` an approval, both desk work that asks for the listing's link. Each move is the
  desk's `setOfferStateAction`, so a withdrawn lot of a pending Facebook post takes the post with it
  (#1779) here too; the confirmation's sentence is `withdrawOfferMessage`, shared with the desk's.
  Afterwards `router.refresh()` reads the page again and `invalidateAll` marks the lists stale.
- **No back link** on either screen, as on the shell's: the phone's own back gesture goes back, and
  keeps the list's narrowing, which a link would have to carry.

## The stamp screen (#2003)

- **`/c/[collectionSlug]/phone/stamps/[stampId]`** (`phoneStampPath`). It has **no row on the start
  screen**: a stamp is opened from a search hit (#2004) or a browsed issue (#2005), never chosen
  bare. *Full app* and *The stamp's full page* both go to the desk's stamp page.
- **The desk's reads, nothing of its own**: `getPhoneStamp` (`src/lib/phone-stamp.ts`) gathers the
  stamp as its page reads it, the copies as the Copies card (held only — `excludeGone`, disposed left
  out), the wants as the Wants card (open and closed), market value from
  `getStampMarketEvidenceByStamp` (the Valuation dialog's) and the cross-catalogue average from
  `getStampPriceDetails` (the Catalog prices card's). The words are pure, in `phone-stamp-view.ts`,
  unit-tested.
- **A want's acceptance sets are worded by `wantAxisTexts`** (`src/lib/want-axes.ts`), the rule the
  desk's Wants card was rewired to — one wording on both screens.
- **One column, the desk's grids flattened**: a value is a row labelled `MNH · No cert.` (plus the
  format for a multiple), in the grid's order (`sortByValueAxes`). Market confidence is **spelled
  out** (`7 results · high confidence`), not a colour: the desk colours the amount and explains it on
  hover, and a phone has no hover.
- **The picture** is the stamp's own photos, else its copies' (#1290) with a line saying so, else
  *No picture*; a tap opens the full-size bytes — no lightbox, whose arrows and measuring are a
  desk's. It is the screen's one client module, because the photo addresses and `THUMB_OBJECT_FIT`
  live in client modules.
- Copies are listed up to `PHONE_STAMP_COPY_LIMIT` (100); past that the screen says the rest are at
  the desk.

## Browse (#2005)

- **Area → year → issue → stamp, one page a level, the level in the path**: `phone/browse` (the
  top-level areas), `browse/areas/[areaId]` (its sub-areas, then the years of its **own** issues),
  `browse/areas/[areaId]/[year]` (`none` for no year, as the desk's Issues list says it) and
  `browse/issues/[issueId]`. Addresses in `src/lib/phone.ts`; the phone's back gesture walks back up.
- **A year is the issues of the area itself**, not of its sub-areas — those are browsed on their own,
  so a stamp is never reached twice by two routes. An area row's count is its whole subtree's,
  rolled up from each area's own (`phoneAreaChildren`), as the desk's area rail rolls them (#843).
- **The desk's reads**: the years are `listIssueYearFacets`, an area-year's issues are
  `listIssuesPaginated` under its area and year filters (up to `PHONE_BROWSE_ISSUE_LIMIT`), an issue's
  stamps are `listIssueMembers` — copies and want summaries exactly as the issue tree shows them — and
  catalogue numbers are labelled by `makeCatalogLabeller`, as the stamp screen labels them. Reads in
  `src/lib/phone-browse.ts`; layout and words in `phone-browse-view.ts` (pure, unit-tested).
- **A stamp's marks** (`phoneStampMarks`): `N held` or *Not held* — the stamp's own copies, the desk
  badge's figure — the copies under its variants beside it, never in it (#528), and *Wanted* in
  `WANT_PRIORITY_CHIP`'s colour for the loudest open want, the desk's want chip's colour.
- **Every empty level says so in a sentence**; *Full app* goes to the area tree, the Issues list under
  the same `areaId`/`year`, or the issue screen.

## The phone screens

The first step, each its own issue (ADR-0072 §5):

| Screen | Issue |
| --- | --- |
| Shell: path, manifest and icon, phone frame, links both ways, sign-in at phone width | #2002 |
| Stamp: picture, copies, wants, market and catalogue value | #2003 |
| Search: catalogue number, name, stamp number, with held and wanted marks | #2004 |
| Browse: area → year → issue → stamp | #2005 |
| Start a purchase, completed at the desk | #2006 |
| Photos on a purchase, from the phone's camera | #2011 |
| Sales to do: paid, packed, sent | #2007 |
| Offers: list, offer screen, pause / resume / withdraw | #2008 |
| Sell an offer | #2009 |
| Facebook group auction: record bid, close | #2010 |

**Browsing is read only** except starting a purchase and its photos. **Stays at the desk**: preparing,
editing and publishing offers; intake, lots and the cost split; everything not in the table.
**Rejected for now**: recognising a stamp from a photo (2026-10-17). A new phone screen is a decision
of its own and is added to this table.
