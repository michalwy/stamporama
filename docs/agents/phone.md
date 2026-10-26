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
  except the stamp screen, which search and browsing open, and the search, which is the start
  screen's own field above the rows. *Other collections* shows only when
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

## Search (#2004)

- **On the start screen, above the rows** — the search is the start screen's, not a row of its own
  in `PHONE_ENTRIES`. A plain GET form (`phone-stamp-search.tsx`): the query is the page's `q`, read
  on the server, so the back gesture returns to the hits and there is no client state.
- **The desk's *have I got this?* search, its stamps only**: `searchCollection`
  (`collection-search.ts`), whose stamp half is the stamp pickers' `searchStampsForPicker`. Issues
  are reached by browsing (#2005) and a copy is read on its stamp's screen. The row's words are
  `phoneSearchHit` (`src/lib/phone-search-view.ts`, pure): the title as the stamp screen titles
  itself, *N held* / *Not held* with the variants' figure beside it (#528), and *Wanted* off the open
  wants, with the loudest priority when it is not normal. A full answer (`PICKER_LIMIT`, 20) says so.
- **The stamp's short number is matched in the shared search, not on the phone**
  (`parseStampNoSearch` in `quick-jump.ts`): `#901` as a row shows it, or `st 901` as the box takes
  it, finds that stamp *in addition to* the text and leads the list; a bare `901` stays a catalogue
  number (#1574's rule). It lives in `searchStampsForPicker` so the phone, the desk's pickers, *Find
  in Stamporama* and the agent API's `search_collection` match alike — a phone-only number match
  would have been a second notion of *match*. The numbered stamp is read on its own, beside the
  capped recall net, since `#901` also recalls every catalogue number containing 901.

## Stamp row thumbnails (#2075)

- **Every phone stamp row starts with the stamp's thumbnail** — an issue's stamps when browsing and
  the search's hits; area, year and issue rows have none. Decided with the collector on 2026-10-19.
- **One picture rule for the row and the stamp screen**: `phoneStampPictures` (`phone-stamp-view.ts`,
  pure) — the stamp's own photos, else its copies' (#1290) — and a row's thumbnail is the lead of that
  list, chosen by `phoneStampThumbIds` in the order the screen draws: own front → back → extras, else
  the lowest copy number's, the same order within it. The search's own `photoId` is **not** used: it
  is the stamp's photo only, with no copy fallback. One read per page, `loadPhoneStampThumbs`
  (`phone-stamp-thumbs.ts`); copies disposed of are left out, as on the screen.
- **`sortPhotos` moved to `photo-order.ts`** (pure) so the rule can be unit-tested; `photos.ts`
  re-exports it.
- **`PhoneStampThumb`** (`phone/phone-stamp-thumb.tsx`, a client module for the photo address and
  `THUMB_OBJECT_FIT`): a 4rem square at the row's start, fitted never cropped; a stamp with no picture
  keeps an empty frame of the same size so rows stay aligned. It is inside the row's link, not a
  target of its own.

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
- **Add photo** on each row (#2198, `phone-sale-attachments.tsx`) keeps pictures with the sale — its
  attachments on the desk. A file input with `multiple` and **no `capture`**, so the phone offers its
  own choice of camera or gallery (the issue's *camera or gallery*), where #2011's `PhoneCameraButton`
  forces the camera; `accept="image/*"` for #2011's reason. Each picture is posted straight to the
  sale's upload route (`uploadSaleAttachments`, one at a time so one refusal does not hold back the
  rest) — no staging, since the sale already exists. Thumbnails come from `listAttachmentsOfSales`,
  one read for the page, kept out of `listSalesAwaitingFulfilment` so the Dashboard does not pay for
  them. A tap opens the file; **removing is the desk's**. Hidden while the row asks a question.

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

## Sell an offer (#2009)

- **On the offer screen, first among the moves**, while the offer has a set left to sell
  (`PhoneOffer.setsLeft`, from the desk's own `listSellableOffers`, narrowed to the offer by its
  `offerId` option — so the phone offers *Sell* exactly where the desk's sale flow would list the
  offer). Inline, not a dialog: buyer and price, nothing else.
- **The desk's *Sell* → *Create new sale*, in one act**: `sellPhoneOffer` (`src/lib/phone-offers.ts`)
  resolves the header through `resolveSaleHeader` — the buyer a picked contact or a typed name found
  or created, a Facebook offer's buyer by their profile (`buyerByFacebookProfile`, #1777) in the
  offer's currency (`facebookOfferSaleCurrency`) — dated today, the other header fields blank, and
  writes the sale **and** its line in one transaction (`createSaleWithLines`, which the agent API's
  new-sale branch now shares), so a refused set leaves no empty sale behind for the collector to find
  at the desk. Adding to a sale already open stays at the desk. The Facebook lookup and its words are
  `useFacebookBuyerLookup`, shared with the desk's sale form; the buyer picker is the desk's
  `PurchaseContactSelect`, drawn at the tap target through its `inputStyle`.
- **One set at a time** (decided with the collector on 2026-10-17): the first set left, at the price
  given (the offer's own, blank when it has none — `phoneSalePriceDefault`). With other sets left the
  line is **picked, not chosen** (`setChoicePending`, #697, also decided then), so the desk's *Set not
  chosen* chip and picker carry the choice to the packing table; the only set left is a choice. Pure,
  in `src/lib/phone-offer-sale.ts`.
- Afterwards the phone goes to **Sales to do** (`phoneSalesPath`), where the sale waits for payment —
  its further steps are #2007's.

## A Facebook group auction (#2010)

- **The desk card's *Bidding*, on the offer screen above *Sell***: `PhoneOfferBidding`
  (`phone/offers/[offerId]/phone-offer-bidding.tsx`), shown while `PhoneOffer.bidding` is set. When
  it is set is **one rule for both screens**, `facebookBidding` (`src/lib/facebook-bidding-rules.ts`,
  pure, unit-tested): an auction, `active` or `paused` — the caller has checked the group — closed once
  `endsAt` has passed, *has a bid* off a non-zero price. The desk's `OfferFacebookCard` was rewired to
  it, and the button's words (`recordBidLabel`) and the closed line's advice (`FACEBOOK_CLOSED_ADVICE`)
  are shared with it.
- **The write is the desk card's**, `patchOfferAction(…, "price")`, so the bid is the offer's price
  dated by `priceCheckedAt` (#1545) and the desk cannot tell where it was typed. `closed` is decided
  in `getPhoneOffer` at the read, so the server render and hydration agree; the relative times
  (*closes in*, *recorded … ago*) are the phone's clock and locale, drawn after mount (`useHydrated`).
  *Closes in …* is a line the desk card does not have — the desk shows the closing time on the
  offer's header and rows, the phone screen nowhere else.
- **Closing is the screen's existing *Sell* (#2009) and *Withdraw* (#2008)**, as #1777 made it at the
  desk — nothing of its own. `PhoneOfferSell` is keyed on the offer's price, so a bid just recorded
  becomes the price *Sell* starts at (`phoneSalePriceDefault`).

## Start a purchase (#2006)

- **What the phone writes** (decided with the collector on 2026-10-17): a real purchase through
  `startPurchaseOnPhone` (`purchases.ts`), never a loose note — stored **`arrived`** (bought at a fair
  is in hand), with **one open lot** priced at the amount paid and titled by the description, so the
  order has its figure, its spend and its ROI from the start. No copies and no cost split: closing
  the lot stays at the desk, which may re-price, split or add lots as for any purchase. A separate
  *amount* column on `Purchase` was rejected — it would have been a second notion of what an order
  cost beside its lines.
- **The stamps are noted, only the stamp** (`PurchaseNotedStamp`: stamp and position, no condition or
  quantity — the collector's choice): a reminder of what is in the parcel, which makes no copy and
  takes no part in intake. Picked through **the phone search** — the collection search route behind
  the start screen's field, rows worded by `phoneSearchHit` — so a hit says held / wanted before
  paying. At most `PHONE_PURCHASE_STAMP_LIMIT` (50). Read back by `listPurchaseNotedStamps`
  (`purchase-noted-stamps.ts`), labelled as the pickers label them.
- **The seller is the desk's own picker**, `PurchaseContactSelect` with `role="seller"`, drawn at the
  tap target through its `inputStyle` (as #2009's buyer): a picked seller by id, a typed name resolved
  on save by `resolvePurchaseContact` — an existing contact by name in any case, else a new seller.
- **The mark** is `Purchase.toCompleteSince` — when the phone started it, null once the collector
  says **Done at the desk** (`markPurchaseDoneAtDesk`; the label is `DONE_AT_DESK_LABEL`, named apart
  from the status's *Mark completed*, decided 2026-10-17). **Nothing else clears it** — not closing
  the lot, not marking the order completed (#2006's *Done when*). A purchase only, by CHECK
  `purchase_to_complete_kind`. The words are `PHONE_PURCHASE_MARK`, the same on the list row, the
  desk's card and the phone. Form rules in `phone-purchase-rules.ts` (pure, unit-tested).
- **Screens**: `phone/purchases/new` (the form; *Full app* is the purchase list) and
  `phone/purchases/[purchaseId]` (what was saved, read back; *Full app* is the desk's purchase
  screen). At the desk, `PurchasePhoneCard` on the purchase screen carries the mark, the noted stamps
  and *Done at the desk*; it stays after the mark only while stamps were noted.

## Photos on a purchase (#2011)

- **The purchase is a fifth `Photo` owner** (`Photo.purchaseId`, decided with the collector on
  2026-10-17): pictures of what was bought as a whole, never of single copies, which keep their own
  from intake. No role — a plain list in `sortOrder`. It goes through `PhotoOwner` in `photos.ts`
  (`addPurchasePhotos`, `removePurchasePhoto`, `listPurchasePhotos`), so ownership, the byte moves,
  serving and the storage total are the copies' own; it is added and removed one act at a time
  rather than through a dialog's change-set. `deletePurchase` reads the bytes' addresses first and
  deletes them only once the delete went through, as it does a card scan's.
- **The camera** is `PhoneCameraButton` (`phone/purchases/phone-camera-button.tsx`): a file input
  with `capture="environment"` and `accept="image/*"` — a narrower list makes some phones offer the
  file picker instead. Each picture is **staged the moment it is taken** through the collection's
  upload route (`stagePurchasePhoto`), so saving waits only for the last. On the form the upload ids
  go with the purchase (`photoUploadIds`): `startPurchaseOnPhone` checks every one is staged in the
  collection **before** writing, so a lost upload refuses the purchase rather than leaving one to be
  started twice, and attaches them after — a failure there keeps the purchase and says so
  (`warning`). On the purchase screen *Take a photo* adds to it at once (`addPurchasePhotosAction`).
  **Removing is the desk's**; a tap opens the full-size bytes, as on the stamp screen.
- **At the desk** `PurchasePhotosCard`, drawn once there is a photo (as the Expenses card, #1907); the
  header's `⋮ → Add photos` opens its file input, mounted regardless. A click enlarges one in the
  **bare** `PhotoLightbox` (`photo-viewer.tsx`), whose action is *Remove photo* — not the
  collection's lightbox, whose *Measure and mark* needs a stamp the picture does not have.

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
| Photos on a sale, from the camera or the gallery | #2198 |
| Offers: list, offer screen, pause / resume / withdraw | #2008 |
| Sell an offer: buyer and price, one set at a time | #2009 |
| Facebook group auction: record bid, close | #2010 |

**Browsing is read only** except starting a purchase (#2006, above) and its photos (#2011). **Stays at the desk**: preparing,
editing and publishing offers; intake, lots and the cost split; everything not in the table.
**Rejected for now**: recognising a stamp from a photo (2026-10-17). A new phone screen is a decision
of its own and is added to this table.
