# Facebook Group Auctions and Quick Buys

Which platform is Facebook, the groups under it and what each holds, and what is deliberately not
here yet. The design is [ADR-0061](../decisions/0061-facebook-groups.md); the track is #1543–#1547,
read together, and #1671 (ADR-0061 §8) adds quick buys beside the auctions.

- **An offer on Facebook is an auction or a quick buy** (#1671; ADR-0061 §8, decided with the
  collector on 2026-10-07). Three settings joined the group/default pair under #1661's rule:
  `listingType` (what a new offer starts as; the platform's blank is `auction`, so the migration
  changed nothing), `quickBuyTemplate` beside `postTemplate` (which stayed the **auction** template —
  renaming it would have been a migration for a word), and `mixedListingTypes` (whether one post may
  hold both; off unless set). `resolveFacebookOffer` returns the group's `listingType` on create only,
  and `facebookPricingDefaults` hands it to `resolveOfferPricing` as the platform default would be —
  so the form's own answer outranks it and nothing is forced any more. `facebookIncrementFor` drops the
  increment on a quick buy, and `endsAt` is already dropped there by the ordinary rule. An edit naming
  **no** type keeps a Facebook offer's (`updateOffer`), since a save without one is no reason to turn
  an old auction into a quick buy; off Facebook that path is unchanged. A quick buy is asked for its
  asking price by the same `missingPriceField` as anywhere, and a group starting quick buys skips the
  `catalogPercent` short-cut in `quickOfferCreationBlock`. The contact dialog no longer offers the
  Facebook platform's `defaultListingType` — it is Settings → Facebook's now.

- **Templates by type, `{catalog}` retired** (#1671). `FACEBOOK_AUCTION_PLACEHOLDERS` and
  `FACEBOOK_QUICK_BUY_PLACEHOLDERS` (`facebookPostPlaceholders(type)`) are what each editor lists and
  what `renderFacebookLotText` fills for a lot of that type; both carry `{title}`. A lot is rendered
  from `facebookTemplateFor(templates, lot.listingType)`, never the other, so a post of mixed lots is
  each lot in its own words. `{catalog}` is in `FACEBOOK_RETIRED_PLACEHOLDERS`: not listed, not
  *unknown*, still filled in, and flagged — `retiredPostPlaceholders` under the field and
  `usesRetiredPostPlaceholder` as a row tag (a group's own templates only; one it follows is flagged on
  the defaults row). Another type's token in a template is *unknown*, so it stays as typed and is named
  while it is typed.

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

- **What a setting holds, every one optional** (ADR-0061 §6). The listing type, whether a post may
  mix types, the auction and quick-buy post templates with their `{token}` placeholders (above), the
  standing note, the starting price as a **mode
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

- **A Facebook offer is in a group, resolved in one place** (#1544).
  `resolveFacebookOffer` (`facebook-auctions.ts`) is asked by `createOffer`, `duplicateOffer` and
  `updateOffer`: on the Facebook platform a group **of that platform** is required, a new auction may
  name only one in use (an edit may keep its archived one), and everything Facebook is null off it —
  so moving an offer away clears it. The listing type was forced to `auction` here until #1671 (top of
  this file), and the group's `amount` stands in for `Contact.defaultStartingPrice` as the
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
  behind it. Each place labels and styles the select as its own fields are — in the Lot builder's
  create step that is the templates' frame, inset and label, with their gap above the action row
  (#1669) — while the component itself carries the width rule everywhere: only as wide as its longest
  name, never wider than its field, a name that does not fit ellipsised and the chosen group's full
  name in the `Tooltip`. What travels is `FacebookCreateChoice` (`facebook-post-rules.ts`): the group and the
  closing time the browser worked out from it (#490's rule), read server-side by
  `readFacebookCreateChoice` into `createOffer`'s input — an action argument for the Lot builder and
  the series, FormData for quick mode, the query string for the generator. **The Lot builder also
  holds the group in its address** (`fbGroup`, #1688) so a preset can keep it: it passes it to the
  hook as `held`, and a held group that is archived or gone is left unchosen and reported
  (`unavailable`, `FACEBOOK_GROUP_UNAVAILABLE`) rather than replaced by the last used. The action
  argument is still what the commit reads; the address is only where the screen keeps it. Everything else is the ordinary create: the increment, currency and
  `amount` from `resolveFacebookOffer`, and a **`catalogPercent`** starting price now worked out
  server-side by `prepareOfferCreation` (`catalogShareOfSets`) over the seed whenever none was
  submitted — the share of one set's catalogue value, averaged over the valued sets in the offer's
  currency, the offer screen's suggested price (#230); decided with the collector on 2026-10-07. No
  catalogue value is no price, so a `ready`/`active` creation over unvalued copies is refused as
  unpriced. `quickOfferCreationBlock` takes the group, so the generator's preview names a missing one;
  a percentage blocks nothing there, since it is per offer. The generator's *additions* go only into
  auctions **in the chosen group** (decided with the collector, 2026-10-07): `readOffers` in
  `offer-generator.ts` reads no other group's offers, so a line one of them would have matched plans a
  new auction instead, and `writeGeneratedOffers` re-checks the group with the rest of the receiving
  offer. The agent API names the group too: the Facebook platform's vocabulary entry carries
  `facebookGroups` (in use, by name), and `draft_offer` requires `facebook_group` there and refuses it
  anywhere else — resolved by `resolveVocabularyValue`, so a wrong name returns the accepted ones. Its
  draft has **no closing time**: the API has no zone to turn the group's time of day into an instant.

- **A group's currency wins over the platform's** (settled with the collector on 2026-10-03, the
  question ADR-0061 left to #1544). An auction in a group with `currency` set is created in it and
  `resolvePlatformCurrency` is not called, so the platform's lock (#196) is neither read nor written;
  a group naming none falls through to the lock as before. An edit never re-currencies an offer
  (#196's snapshot rule), including when its group changes.

- **A copy is in one Facebook offer that is up** (ADR-0061 §5; quick buys included since #1671,
  either can sell it — the query was already keyed on `facebookGroupId`, so only the words changed). "Up" is
  `FACEBOOK_AUCTION_HOLDING_STATES` = `active | paused`; drafts compete for nothing (#639's reading).
  `facebookAuctionRefusal` is asked **only by a Facebook offer**, at every composition path that asks
  `assertNotCommittedElsewhere`, at `createOffer`/`duplicateOffer` seeding, and at `→ active` in
  `setOfferState` — the second door, two drafts of the same stamps where the first went up later. It
  refuses the whole add by name (`describeFacebookAuctionCopies`), #639's shape. The integration test
  fails with the activation guard removed (checked when written). Another platform holding the same
  copy is not asked: listing in two places is the collector's business.

- **A multi-lot post is a row; a single post is not** (ADR-0061 §2). `FacebookPost` (group only)
  exists only for several lots; its lots are offers with `facebookPostId` + `facebookLotNo`, unique
  per post. An offer posted alone has no post row and its own `url` is the post's link, so publishing
  it is the ordinary `publishOffer`. **The post's link is every lot's own `url` too** (#1668, decided
  with the collector on 2026-10-07): the post's own column and the card's *Post link* field were a
  second field for one address, and both are gone — the migration moved a recorded post link into
  each lot whose `url` was empty, then dropped the column. A post is up once any lot is
  (`isFacebookLotPosted`, past Ready), the same reading `facebookPostRefusal` already used. The **closing time stays on each offer** (`endsAt`, where the
  ended-auction flag and every list read it) and `updateOffer` writes it to every **auction** lot of
  the post — one fact written in several places rather than a second column readers would have to
  join; a quick buy neither writes one nor takes one (#1671). **A post's lots share one type** unless
  the group's `mixedListingTypes` says otherwise: `facebookPostRefusal` takes the group's setting
  (`facebookGroupMixesTypes`) and `facebookMixedTypesRefusal` names each type's offers, and
  `updateOffer` asks `facebookLotTypeRefusal` before a lot changes type inside such a post.
  `detachFacebookLot` is the one way out: renumbers in two passes (the unique index), dissolves a
  post left with one lot, and runs on take-out and on `deleteOffer`.

- **Activate takes the whole post live** (#1668). `publishOfferAction` goes through
  `publishOfferOrPost` (`facebook-posts.ts`): an offer in no post is the ordinary `publishOffer`, a lot
  is `publishFacebookPost`, which goes through `setOfferState` per lot (`facebook-posts.ts` imports
  `offers.ts`; `facebook-auctions.ts` is the half `offers.ts` imports — keep it that way, lib cycles
  throw at module-init). Every lot must be `ready` or already `active` before anything moves; ready
  lots are activated one by one, then the link is written into **every lot with no `url` of its own**
  — a lot carrying its own photo's link keeps it — so a refusal halfway through is finished by
  activating again. A blank link activates and writes nothing, as on every platform. On the offer's
  screen a lot is asked for the link every time, starting blank (its own `url`, if any, is its
  photo's); an offer posted alone is asked only while it has no `url`, the ordinary rule. A posted
  post's lots cannot be taken out.

- **The kit's text is rendered in the browser** (`renderFacebookPostText`, pure): `{closesAt}` is a
  local time and the browser is the only place the zone is known (#490's rule). **A post is only what
  its template places** (#1692, decided with the collector on 2026-10-09): nothing is substituted,
  added or fallen back to. `{description}` is the offer's description and nothing else — empty when it
  has none (the kit's title stand-in is gone); `{title}` the display title; `{price}` a quick buy's
  asking price; the retired `{catalog}` is every copy's leading number through
  `compactCatalogNumberGroups`; `{lot}` is empty on a single post; `{offer}` (#1694) is each lot's own offer number, bare as `{lot}` is,
  so the template writes any `#` itself. A type with **no template gives an
  empty lot** (the `{description}` fallback template is gone), and the lot's text is not trimmed, so
  the template's line breaks stay where it has them, around empty placeholders too — collapsing blank
  lines was withdrawn from the issue. Lots are joined by a blank line, and a lot with no text is left
  out of the join rather than leaving a gap. **What is missing is named, not filled in**:
  `facebookPostGaps` lists the types with lots and no template, and each placeholder a lot's template
  places that comes out empty — bar `{lot}` on a single post and `{terms}` before the last lot, empty
  by the post's own rule — and the card names each under the text, linking a template or the note to
  Settings → Facebook (`?tab=facebook&row=`, the group's own row when `kit.group.custom` holds the
  setting, else `facebook:defaults`) and an empty offer field in another lot to that offer. **Copy**
  still copies what there is. The standing note is **placed, never appended** (#1689, decided with
  the collector on 2026-10-09): `{terms}` (`FACEBOOK_TERMS_PLACEHOLDER`, in both types' lists) is
  filled in the **last** lot only, so a multi-lot post states it once as it always did; a template
  without it posts no note. **Existing templates were not migrated** (amended with the collector the
  same day, following #1692): they post no note until the collector places `{terms}`. `standingNoteUnused` is the warning
  under the note field, read off what is being typed (the pane holds both templates and the note in
  one state for it); a group following Facebook's note is warned too, beside the followed value. The photos
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
  the actions). `recordFacebookSale` records an auction's win and a quick buy's sale alike (#1671) —
  the one difference is that only an auction's price is patched to the sale's figure; a quick buy's
  asking price is the seller's own and stays. `cleanFacebookWin` takes the type for its wording, and
  *No bids* refuses a quick buy. A win: the winner contact is found by `facebookProfileUrl` first, then by name
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
  The panes group the settings as the collector asked (#1671): *Every offer* (type, currency, mixing),
  the note, *New auctions* (auction template and figures), *Quick buys* (its template).
  An offer is the offer form (group, the listing type seeded from it until touched, and an auction's
  increment, shown only on the Facebook platform, the group locked on a lot of a post), the
  **Facebook** card on the offer's screen, directly under the description like every platform's card
  (#1667: the post text is read and copied right after it) (`offer-facebook-card.tsx`, with a **Bidding** part while an
  auction is up, a **Sale** part while a quick buy is, and the result dialog,
  `facebook-result-dialog.tsx`, in either's words), and **Post together** in the offers list's
  selection bar, offered while every ticked offer in view is a Facebook offer and numbering the lots
  in tick order.
