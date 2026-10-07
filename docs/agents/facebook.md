# Facebook Group Auctions

Which platform is Facebook, the groups under it and what each holds, and what is deliberately not
here yet. The design is [ADR-0061](../decisions/0061-facebook-groups.md); the track is #1543–#1547,
read together.

- **One platform, groups under it** (#1543; ADR-0061 §1). Facebook is the `Contact` carrying
  `platformModule = "facebook"` (`FACEBOOK_PLATFORM_MODULE`), set on Settings → Facebook through the
  shared exclusive `setModulePlatform` (`src/lib/facebook.ts`, Delcampe's thin-file shape). A group is a
  `FacebookGroup` row owned by that contact (`platformId`, cascading with it), unique by name per
  platform, archived ones included — an archived group comes back under the name it had. The marker is
  in **neither** rule table of `platform-modules.ts`: no listing half, no capture, no close, so it
  inherits nobody's rules by existing (`tests/unit/platform-modules.test.ts` pins that).

- **A group's settings follow the platform's unless set custom** (#1661, amending ADR-0061 §6). The
  platform's own are a `FacebookDefaults` row keyed by the platform contact (`readFacebookDefaults`,
  no row = `FACEBOOK_BLANK_SETTINGS`), with the group's columns bar the currency — that is
  `platformCurrency`, which a group naming none already used. A group lists its own settings in
  `customSettings` (`FACEBOOK_GROUP_SETTINGS`; `startingPrice` is mode and value together), and a
  followed column is **stored blank** — `cleanFacebookGroupValues` blanks it whatever was sent, so
  switching back drops the value. A custom setting may be empty (a custom *no increment* where
  Facebook has one), which is why this is a key list and not "null means follow". Every reader goes
  through `effectiveFacebookGroupSettings` — the offer form's choices, `resolveFacebookOffer` and the
  kit — read live, so a changed default reaches every following group and, being read at creation,
  no auction already made. The kit's template and note are read live as they always were. The
  migration made a setting custom exactly where it differed from the platform's, and moved the
  Facebook contact's `defaultStartingPrice` (never read by a Facebook auction) into the defaults row
  as an `amount`; the contact dialog no longer offers that field for the Facebook platform. The post
  template is **not** the contact's `descriptionTemplate` (decided with the collector, 2026-10-06):
  that one writes the offer's description, which `{description}` puts into the post.

- **What a setting holds, every one optional** (ADR-0061 §6). The post template with its
  six `{token}` placeholders (`FACEBOOK_POST_PLACEHOLDERS` — `{catalog}` is the title template's own
  word, so it means one thing across templates), the standing note, the starting price as a **mode
  plus one value** (`startingPriceMode` = `amount | catalogPercent`, `startingPriceValue` cleared
  whenever the mode is null), the increment, the length in days, the closing time as `HH:MM`, and the
  currency (null = `platformCurrency`). They are read when an offer is created (#1544) and then owned
  by the offer, so nothing here reaches into an auction already made. Validation is
  `cleanFacebookGroupValues` (pure, `facebook-group-rules.ts`); reads and writes are
  `facebook-groups.ts`. An unknown `{token}` is **kept, not refused**, the title template's rule, and
  the editor names it while it is typed (`unknownPostPlaceholders`).

- **Archive, never delete, once a group has offers** (ADR-0061 §7). `deleteFacebookGroup` counts the
  offers naming the group and refuses with *archive it instead*; `Offer.facebookGroupId` is
  `ON DELETE RESTRICT` behind it, and a `P2003` from that key is translated into the same refusal.
  The integration test asserts both halves, and removing both makes it fail (checked when written).
  Archiving is `archivedAt`; listed after the groups in use, offered to no new auction (#1544's to
  enforce), cleared to restore.

- **A Facebook offer is an auction in a group, resolved in one place** (#1544).
  `resolveFacebookOffer` (`facebook-auctions.ts`) is asked by `createOffer`, `duplicateOffer` and
  `updateOffer`: on the Facebook platform a group **of that platform** is required, a new auction may
  name only one in use (an edit may keep its archived one), and everything Facebook is null off it —
  so moving an offer away clears it. The listing type is forced to `auction` before
  `resolveOfferPricing`, and the group's `amount` stands in for `Contact.defaultStartingPrice` as the
  blank-submission fallback (`facebookPricingDefaults`); `catalogPercent` was the **form's** job
  alone, over the catalogue suggestion it already holds (#230), until #1663 gave the server the same
  figure over the seed (below) — the form's stated figure still outranks it. `Offer.bidIncrement` is seeded from the group on create only.
  `patchOffer` refuses moving an offer onto or off Facebook in place — only the form asks the group.

- **Every creation without the form asks the group too** (#1663). The Lot builder, quick offer mode
  and its generator on the Copies list, and *Series from singles* (a new offer only) each draw
  `FacebookGroupSelect` beside their create button through `useFacebookGroupChoice`
  (`offers/use-facebook-group-choice.ts`), which starts on the **last group used on that platform**
  (localStorage per collection and platform, written by the shortcuts and by the form on create) and
  holds the button off with the reason beside it until one is chosen — the server's refusal stays
  behind it. What travels is `FacebookCreateChoice` (`facebook-post-rules.ts`): the group and the
  closing time the browser worked out from it (#490's rule), read server-side by
  `readFacebookCreateChoice` into `createOffer`'s input — an action argument for the Lot builder and
  the series, FormData for quick mode, the query string for the generator (not a lot criterion, so no
  preset or address carries it). Everything else is the ordinary create: the increment, currency and
  `amount` from `resolveFacebookOffer`, and a **`catalogPercent`** starting price now worked out
  server-side by `prepareOfferCreation` (`catalogShareOfSets`) over the seed whenever none was
  submitted — the share of one set's catalogue value, averaged over the valued sets in the offer's
  currency, the offer screen's suggested price (#230); decided with the collector on 2026-10-07. No
  catalogue value is no price, so a `ready`/`active` creation over unvalued copies is refused as
  unpriced. `quickOfferCreationBlock` takes the group, so the generator's preview names a missing one;
  a percentage blocks nothing there, since it is per offer. The generator's *additions* go into
  existing offers in whatever group they are in. The agent API's `draft_offer` names no group, so it
  still cannot draft a Facebook offer.

- **A group's currency wins over the platform's** (settled with the collector on 2026-10-03, the
  question ADR-0061 left to #1544). An auction in a group with `currency` set is created in it and
  `resolvePlatformCurrency` is not called, so the platform's lock (#196) is neither read nor written;
  a group naming none falls through to the lock as before. An edit never re-currencies an offer
  (#196's snapshot rule), including when its group changes.

- **A copy is in one Facebook auction that is up** (ADR-0061 §5). "Up" is
  `FACEBOOK_AUCTION_HOLDING_STATES` = `active | paused`; drafts compete for nothing (#639's reading).
  `facebookAuctionRefusal` is asked **only by a Facebook offer**, at every composition path that asks
  `assertNotCommittedElsewhere`, at `createOffer`/`duplicateOffer` seeding, and at `→ active` in
  `setOfferState` — the second door, two drafts of the same stamps where the first went up later. It
  refuses the whole add by name (`describeFacebookAuctionCopies`), #639's shape. The integration test
  fails with the activation guard removed (checked when written). Another platform holding the same
  copy is not asked: listing in two places is the collector's business.

- **A multi-lot post is a row; a single post is not** (ADR-0061 §2). `FacebookPost` (group, `url`)
  exists only for several lots; its lots are offers with `facebookPostId` + `facebookLotNo`, unique
  per post. An offer posted alone has no post row and its own `url` is the post's link, so publishing
  it is the ordinary `publishOffer`. The **closing time stays on each offer** (`endsAt`, where the
  ended-auction flag and every list read it) and `updateOffer` writes it to every lot of the post —
  one fact written in several places rather than a second column readers would have to join.
  `detachFacebookLot` is the one way out: renumbers in two passes (the unique index), dissolves a
  post left with one lot, and runs on take-out and on `deleteOffer`.

- **Posting a multi-lot post goes through `setOfferState` per lot** (`facebook-posts.ts`, which
  imports `offers.ts`; `facebook-auctions.ts` is the half `offers.ts` imports — keep it that way, lib
  cycles throw at module-init). Every lot must be `ready` or already `active` before anything moves;
  ready lots are activated one by one, then the link is written, so a refusal halfway through is
  finished by pasting again. A posted post's lots cannot be taken out.

- **The kit's text is rendered in the browser** (`renderFacebookPostText`, pure): `{closesAt}` is a
  local time and the browser is the only place the zone is known (#490's rule). `{description}` is
  the offer's description, else its display title; `{catalog}` is every copy's leading number through
  `compactCatalogNumberGroups`, the title's own `{catalog}` vocabulary; `{lot}` is empty on a single
  post. Lots are joined by a blank line and the standing note goes under the last, once. The photos
  are the offer's own ZIP for a single post and `GET …/facebook-posts/[postId]/photos/zip` for a
  multi-lot one — every lot's upload set, flat, prefixed `lot-NN-`.

- **The running bid is the offer's own price, typed** (#1545; ADR-0061 §4, decided with the
  collector on 2026-10-03). No bidder is recorded — amount only. The card's **Record bid** is
  `patchOfferAction(…, "price")`, so `priceCheckedAt` dates it by #449's existing rule and nothing
  raises drift (#542 keeps an auction's current price outside it). The offers list carries
  `priceCheckedAt` and draws the age beside a running auction's figure, in every platform's row.

- **A closed Facebook auction asks for its result with or without a bid** — `auctionNeedsResolution`
  takes `facebook` and skips the *somebody bid* part for it, and `endedAuctionWhere` adds
  `facebookGroupId: { not: null }` to the bid `OR`: nobody reads Facebook bids, so a zero is no
  evidence. The integration test fails with that clause removed (checked when written).

- **The result is `facebook-results.ts`** (imports `offers.ts` and `sales.ts`; nothing imports it but
  the actions). A win: the winner contact is found by `facebookProfileUrl` first, then by name
  (case-insensitive, any role); a name match carrying a **different** link is refused as somebody
  else, since `Contact.name` is unique and cannot be taken twice. A found contact gets the buyer role
  and, where it has none, the link; otherwise a buyer is created with both. The winning bid is written
  to the offer (`patchOffer`), then every unsold set goes into the chosen sale at the price split in
  cents (`splitAuctionPrice`, odd cents first) — the winner's open Facebook sale (`ordered | paid |
  packed`, same platform, buyer and currency, re-checked on save) or a new one, which `createSale`
  makes in the **offer's** currency through `offerCurrency`, so a group's own currency survives and
  the platform lock is untouched. A new sale whose lines fail is deleted again. *No bids* is
  `setOfferState(…, "withdrawn")`. Both refuse anything not `active | paused`.

- **The profile link is stored normalised** (`normalizeFacebookProfileUrl`, pure in
  `facebook-result-rules.ts`): `https://www.facebook.com/<path>`, lower case, no trailing slash, no
  query except `profile.php`'s `id`, the phone and desktop hosts folded together — so the lookup is an
  equality. `contacts.ts` normalises on every write and refuses a non-Facebook address with
  `ContactFieldError`; an update that omits the field leaves it alone.

- **Where it is seen.** Settings → Facebook (`facebook-settings-page.tsx`): the platform choice in the
  header (`MarketplacePlatformSelect`, *Facebook platform*), then list beside detail (#1471) with no
  tabs and no summary strip. The list's first row is **Facebook defaults** (`DEFAULTS_ROW`, the
  page's default selection), then the groups; a group's pane shows each setting as *Same as Facebook*
  with its value, or with its field once *Custom for this group* — a checkbox named `custom` carrying
  the key, so the pane's unsaved measure sees it. Archive/Restore is the detail
  pane's header action; Delete is disabled with its reason while offers name the group. The user guide
  is `docs/user-guide/facebook.md`.
  An auction is the offer form (group + increment, shown only on the Facebook platform, the group
  locked on a lot of a post), the **Facebook** card on the offer's screen (`offer-facebook-card.tsx`,
  with a **Bidding** part while it is up and the result dialog, `facebook-result-dialog.tsx`),
  and **Post together** in the offers list's selection bar, offered while every ticked offer in view
  is a Facebook auction and numbering the lots in tick order.
