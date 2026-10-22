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

- **An offer can carry its own post template** (#1780, decided with the collector on 2026-10-11;
  ADR-0061 §6). `Offer.facebookPostTemplate`: null follows the group's template for the offer's type,
  text — **even empty** — is the offer's own (an empty one is an empty lot, named by
  `facebookPostGaps().emptyOwnTemplates`, not the group's template reported missing; #1692's no
  fallbacks). `facebookLotTemplate` is the one place a lot's template is chosen; `renderFacebookPostParts`
  and `facebookPostGaps` both go through it, so in a multi-lot post the override shapes its own lot
  only and `missingTemplates` counts only the lots that follow the group. It is written by
  `patchOffer(… { facebookPostTemplate })` (`setFacebookOfferTemplateAction`), refused off Facebook,
  allowed in every state like the listing texts, and counted as a text change for #542's drift. It is
  for the offer's **current type**: `updateOffer` drops it when the type changes or the offer leaves
  Facebook (the integration test fails with that drop removed — checked when written), and the offer
  form warns first off `OfferListItem.facebookOwnTemplate`. A duplicate does not carry it — a clone
  starts from its own group, as its texts do. The card (`offer-facebook-card.tsx`) shows it under the
  post text: *Same as group* with the effective group template, or the field once *Custom for this
  offer* is ticked, prefilled with the group's and written only by *Save template*; unticking a saved
  one writes null at once. The field is `shared/facebook-post-template-field.tsx`, which Settings →
  Facebook uses too, so the placeholders and formatting it lists cannot drift between the two.

- **A published offer's post text is frozen** (#1800, decided with the collector on 2026-10-11;
  ADR-0061 §3). `Offer.facebookPostSnapshot` (JSONB, `FacebookFrozenLot` in `facebook-post-rules.ts`,
  read back by `readFacebookFrozenLot`) holds the lot's template (its own or the group's for its type,
  through `facebookLotTemplate`), the group's note and the raw figures — **inputs, not words**: the
  closing time stays an instant because only the browser knows the zone (#490). Written by
  `freezeFacebookPostText` (`facebook-auctions.ts`, which reads lots through the same `readKitLots` the
  kit does): from `setOfferState` on any move into Pending or Active **where none is frozen yet** (so an
  approval or a resume adds nothing), from `finishOfferCreation` / `duplicateOffer` for an offer made
  already up, and from `repostOffer` **afresh** (a repost is a new publication). `setOfferState`
  clears it on any move to Ready or Preparing — a rejection is the case that matters. The one thing
  that moves a frozen lot is `setFrozenFacebookClosing`, called by `publishOfferOrPost` with the
  closing time an approval states (the collector's choice; the issue had said nothing moves it). The
  card draws through `facebookPostSource` (pure): a lot with a snapshot from it, the note from the last
  lot's, everything else live; `frozenAt` is set only when every lot is frozen, and then the card names
  no gaps (nothing there can be fixed) and says *As posted on …*. `facebook-kit-post.ts` beside the
  card is the one place the browser renders a kit's post — the card and the repost dialog, whose
  `live` predicate draws the lots the repost takes from the current template. **Offers already up**
  when this landed have no snapshot; `freezeUnfrozenFacebookPosts` freezes every posted Facebook offer
  without one at boot (`instrumentation-node.ts`) — SQL could not, since the title and catalogue
  numbers are built in TypeScript — and is an idempotent no-op after. `prisma-text-trim` leaves the
  column alone like every `Json` column: a template's whitespace is part of what was posted. The
  integration test is `tests/integration/facebook-post-freeze.test.ts`; removing the transition freeze,
  the Ready clear, the approval's closing write, the repost refreeze or the creation freeze each fails
  it (checked when written).

- **A post template is Markdown, limited to Facebook's editor** (#1772, decided with the collector on
  2026-10-11: bold, italic, `#`/`##` headings, bulleted and numbered lists, a quote — what the group
  post editor's toolbar offers). There is no format setting: every template is read this way.
  `renderFacebookPostParts` keeps the template's own text apart from each placeholder's value, and
  `formatFacebookPost` (`facebook-post-format.ts`, pure, the `marked` of ADR-0019) lexes the template
  with each value standing as one Supplementary-PUA code point, putting the value back as escaped
  text afterwards — so `**{title}**` is bold and a value is **never** formatting. Everything else is
  off in the lexer (setext headings matter most: `Lot\n---` would otherwise be an `<h2>`) and the
  token walk writes only the tags above, so a link or a `###` stays as typed. It returns the HTML
  (sanitised by the card with `sanitizeDescriptionHtml`) and the plain text — symbols gone, the
  template's line and blank-line spacing kept, bullets as `•`. The card shows it rendered with a
  Source switch (#319's pattern); `CopyButton`'s `html` puts the HTML on `text/html` and the plain
  text on `text/plain`. `renderFacebookPostText` is the source, unchanged. Whether Facebook keeps
  the formatting on paste was the collector's to check — no session drives a browser.

- **One platform, groups under it** (#1543; ADR-0061 §1). Facebook is the `Platform` carrying
  `platformModule = "facebook"` (`FACEBOOK_PLATFORM_MODULE`) — since #1955 (ADR-0071) the collection's
  one Facebook module platform, configured and switched on on the Platform tab of Settings → Facebook
  (`src/lib/facebook.ts`, Delcampe's thin-file shape). A group is a
  `FacebookGroup` row owned by that platform (`platformId`, cascading with it), unique by name per
  platform, archived ones included — an archived group comes back under the name it had. The marker is
  in **neither** rule table of `platform-modules.ts`: no listing half, no capture, no close, so it
  inherits nobody's rules by existing (`tests/unit/platform-modules.test.ts` pins that).

- **The Platform tab offers only what Facebook uses** (#1958, the list confirmed by the collector on
  2026-10-16 and kept in the issue's body under *What the Facebook page keeps*). The rule was #1944's:
  a setting is dropped only where nothing about selling on Facebook reads it, so the trim changes no
  output. A Facebook offer is an ordinary offer with a kit beside it — its generated title,
  description and private note, the counters against the text limits, the photo plan and covers, the
  *min* button and a sale's shipping options all read the platform as they do anywhere — so the
  measure left exactly the four #1661/#1671 had already moved to `FacebookDefaults` and the groups:
  `defaultListingType`, `defaultStartingPrice`, `refreshQuickBuysAfterDays`, `buyerMessageTemplate`.
  `PlatformFields` leaves them out when `platformModule` is Facebook and puts one `FieldNote` in their
  place naming where they went. Saving the tab clears whatever was still stored in them
  (`parsePlatformFields` reads an absent field as blank), which is harmless: nothing reads them for
  Facebook — `readRefreshThresholds` and `sale-buyer-message.ts` skip the platform's columns there,
  and the offer form's seed from the platform's `defaultListingType` is overwritten by the group,
  which `resolveFacebookOffer` requires. Before dropping another, find its readers: a setting that
  looks foreign to Facebook (the private note, the text limits) is still read on a Facebook offer.

- **A group's settings follow the platform's unless set custom** (#1661, amending ADR-0061 §6). The
  platform's own are a `FacebookDefaults` row keyed by the platform (`readFacebookDefaults`,
  no row = `FACEBOOK_BLANK_SETTINGS`), with the group's columns bar the currency — that is
  `platformCurrency`, which a group naming none already used. A group lists its own settings in
  `customSettings` (`FACEBOOK_GROUP_SETTINGS`; `startingPrice` is mode and value together), and a
  followed column is **stored blank** — `cleanFacebookGroupValues` blanks it whatever was sent, so
  switching back drops the value. A custom setting may be empty (a custom *no increment* where
  Facebook has one), which is why this is a key list and not "null means follow". Every reader goes
  through `effectiveFacebookGroupSettings` — the offer form's choices, `resolveFacebookOffer` and the
  kit — read live, so a changed default reaches every following group and, being read at creation,
  no auction already made. The kit's template and note are read live until the offer is published,
  then frozen with it (#1800, above). The
  migration made a setting custom exactly where it differed from the platform's, and moved the
  Facebook contact's `defaultStartingPrice` (never read by a Facebook auction) into the defaults row
  as an `amount`; the platform's settings no longer offer that field for the Facebook platform. The post
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
  this file), and the group's `amount` stands in for `Platform.defaultStartingPrice` as the
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

- **The message to a buyer is a followed setting too** (#1815; ADR-0061 §6). `buyerMessageTemplate`
  is in `FacebookDefaults`, on each group and in `FACEBOOK_GROUP_SETTINGS`; the Facebook contact's
  own column is not read (the contact dialog hides it there, the `refreshQuickBuysAfterDays` shape).
  A sale has no group, so `sale-buyer-message.ts` takes the group's effective template only when
  **every** line's offer names that one group, and Facebook's default otherwise — offers from several
  groups, or a line whose offer has none (decided with the collector, 2026-10-11). The rest — the
  placeholders and the sale's screen — is `offers.md`'s.

- **Quick buys have a refresh threshold, a followed setting like the rest** (#1718).
  `refreshQuickBuysAfterDays` is in `FacebookDefaults` and on each group, keyed
  `refreshQuickBuysAfterDays` in `customSettings` — a custom null is a group's own *never* where
  Facebook has one. The Facebook contact's `refreshQuickBuysAfterDays` column is not read (the
  contact dialog hides it there), the `defaultStartingPrice` reasoning of #1661. The card's
  **Repost…** (an active quick buy posted alone, since #1842) opens the offer screen's dialog; a lot
  reposts from the offer's ⋮, and takes every active quick-buy lot of the post, since they are one post. The rest is in `offers.md`.

- **A group's currency wins over the platform's** (settled with the collector on 2026-10-03, the
  question ADR-0061 left to #1544). An auction in a group with `currency` set is created in it and
  `resolvePlatformCurrency` is not called, so the platform's lock (#196) is neither read nor written;
  a group naming none falls through to the lock as before. An edit never re-currencies an offer
  (#196's snapshot rule), including when its group changes.

- **A copy is in one Facebook offer that is up** (ADR-0061 §5; quick buys included since #1671,
  either can sell it — the query was already keyed on `facebookGroupId`, so only the words changed). "Up" is
  `FACEBOOK_AUCTION_HOLDING_STATES` = `pending | active | paused` (`pending` since #1778: the group's
  administrator may approve the post at any moment); drafts compete for nothing (#639's reading).
  `→ pending` asks every gate `→ active` does.
  `facebookAuctionRefusal` is asked **only by a Facebook offer**, at every composition path that asks
  `assertNotCommittedElsewhere`, at `createOffer`/`duplicateOffer` seeding, and at `→ active` in
  `setOfferState` — the second door, two drafts of the same stamps where the first went up later. It
  refuses the whole add by name (`describeFacebookAuctionCopies`), #639's shape. The integration test
  fails with the activation guard removed (checked when written). Another platform holding the same
  copy is not asked: listing in two places is the collector's business.

- **A post is a row; its lots are offers** (ADR-0061 §2). `FacebookPost` (group only) holds several
  lots, or one offer posted alone once it has gone up (#1989, below); its lots are offers with
  `facebookPostId` + `facebookLotNo`, unique per post. An offer in no post is published through the
  ordinary `publishOffer`, which makes its post of one lot on the way. **The post's link is every lot's own `url` too** (#1668, decided
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
  `detachFacebookLot` is the one way out: renumbers in two passes (the unique index), deletes a post
  left with none, dissolves one left with one lot **not yet up** (#1989 — one left with a lot that went
  up stays, a post of one), and runs on take-out, on `deleteOffer` and on `updateOffer` moving a lot
  off Facebook.

- **Every Facebook offer that goes up is in a post** (#1989, decided with the collector on
  2026-10-16, amending ADR-0061 §2): an offer posted alone is a post of one lot, made **when it is
  published**, never when it is created. `placeInOneLotFacebookPost` (`offers.ts`, private — it needs
  `allocateEntityNumber`, which `offers.ts` already imports from `items.ts`) is the one writer: it runs
  in `setOfferState` on any move into Pending/Active **before** `freezeFacebookPostText`, so the freeze
  reads the post, in `freezeIfPublished` for an offer created or duplicated already up, and in
  `updateOffer` for an offer moved onto Facebook once already up — a no-op for an offer in a post or
  off Facebook. Every publish path reaches it through the transition, so `publishOfferOrPost` needs
  no branch of its own beyond the title. **A post of one is titled with its offer's title** (#2068,
  decided with the collector on 2026-10-18): `placeInOneLotFacebookPost` creates it with
  `readOfferPostTitles` (`offers.ts` — the offer's display title, its `name` else the label derived
  from its sets, as `readKitLots` names the lot; an offer with neither is left out rather than given
  the *Untitled listing* stand-in, #1692). It is **stored once**, not a stand-in at display time:
  renaming the offer later does not rename the post. `postTitle` (asked by `ActivateOfferDialog`'s
  `askPostTitle`, a Facebook offer in no post and not approving; the field starts on `offerLabel`) is
  written with `setFacebookPostTitle` after `publishOffer` when not blank, so a typed title replaces
  the offer's and a cleared field keeps it. The snapshot is written before a typed title, so its
  `postTitle` is the offer's; nothing a post of one renders reads it, since `{postTitle}` is in no
  post template. **Existing untitled posts of one** were titled by `titleUntitledFacebookPostsOfOne`
  (`facebook-posts.ts`), run once at boot beside the freeze (`instrumentation-node.ts`) — the display
  title is built in TypeScript — and an idempotent no-op after; posts of several lots keep asking for
  their own (#1862). The integration test is the *its title* suite of
  `tests/integration/facebook-single-posts.test.ts`. **A post of one reads as an offer
  posted alone**: `facebookPostLayout` takes `{ layout, lotCount }` and is `text` under two lots;
  `getFacebookOfferKit` nulls the lone lot's `lotNo` (so `{lot}` and the gaps behave as on a single
  post) and gives the offer's own `photoZipPath`; `OfferListItem.facebookPost.lotNo` is null there
  (the chip reads *Post #N*). On the client "posted alone" is `kit.lots.length < 2`, not `!kit.post`:
  the card keeps its kit, listing link and *Repost…* and adds the post's name, stage and *Open post*;
  the kit's `multiLot` (layout select, lot numbers) is `kit.post && lots > 1`, while its `renderLots`
  is drawn for any post, so the post's screen has its one row. Taking out the only lot of a post not
  up (after a rejection) removes the post. **The migration**
  (`20261016180000_facebook_every_offer_in_post`) gave every Facebook offer in no post in a state past
  Ready (`isFacebookLotPosted`'s reading — a withdrawn or sold offer included) a post of one, numbered
  from `nextFacebookPostNo` in `createdAt` order, untitled (titled since by #2068's boot pass); link, state and snapshot stay on the
  offer, where they already were. The integration test is
  `tests/integration/facebook-single-posts.test.ts`, which runs the migration's SQL in a rolled-back
  transaction over seeded rows; removing the transition's placement or restoring the old dissolve
  rule each fails it (checked when written).

- **A post of several lots can be captioned** (#1841, decided with the collector on 2026-10-12;
  ADR-0061 §2). `multiLotLayout` (`text` | `captions`, `FACEBOOK_MULTI_LOT_LAYOUTS`) and three
  templates — `auctionCaptionTemplate`, `quickBuyCaptionTemplate`, `captionPostTemplate` — are
  followed settings under #1661's rule (in `FACEBOOK_GROUP_SETTINGS`, on `FacebookDefaults` and each
  group; the migration made every row `text`, so nothing changed). `FacebookPost.layout` is the post's
  own choice, null following the group live; `facebookPostLayout` (`facebook-auctions.ts`) is the one
  reading of it — always `text` for an offer posted alone — and `setFacebookPostLayout`
  (`facebook-posts.ts`) refuses once any lot is past Ready. **Rendering** is
  `renderFacebookCaptionedPost` (pure): the shared text from `captionPostTemplate` with `{offer}` (the
  lots' offer numbers, `, `-joined in lot order) and `{terms}`; each caption from
  `facebookCaptionLotTemplate` — the offer's own template (#1780) where it has one, else its type's
  caption template — with the type's placeholders bar `{terms}` (`facebookTemplatePlaceholders(role,
  type)`, the role `post | caption | captionPost` also driving `unknownPostPlaceholders` and the shared
  field's list; `{catalog}` is unknown outside a post template). `facebookCaptionedPostGaps` adds
  `missingPostText` and names the shared text's empty placeholders with `lotNo: null`. **`{post}`**
  (#1854, `FACEBOOK_POST_NUMBER_PLACEHOLDER`) is the post's `postNo`, bare, in the shared text and
  every caption — an offer's own template included, since it writes the caption — and in **no** post
  template: an offer posted alone has no number until it is published (its post of one lot, #1989, is
  written from the post templates all the same) and nothing stands in for it (#1692), so there it is
  *unknown* and kept as typed. Both functions take `postNo` explicitly (the kit's `post.postNo`); it
  is the post's identity rather than its content, so it is read live and not frozen. **Freezing**:
  `FacebookFrozenLot` gained `layout` and `postText` (a snapshot without them reads as `text`), and
  `freezeFacebookPostText` stores the caption template as `template` in a captioned post through
  `facebookLayoutLotTemplate`; `facebookPostSource` takes the layout and shared text off the last lot's
  snapshot, as the note. `standingNoteUnused` counts `captionPostTemplate` as a place for `{terms}`.
  **Photos**: `arrangeFacebookLotPhoto` (`facebook-lot-photo-rules.ts`, pure) turns a lot's upload set
  into one photo — the only image as it is; otherwise fronts and backs as two halves of one grid
  (a back matched to its front by `pairKey`; a paired image, an attachment, and a back whose front is
  held back stand alone), a separator line between, side by side or stacked and the half's columns
  chosen together by the auto grid's cost (empty cells + 3 × log distance outside the band) against
  the offer's `collageGridShape`, or square on a fixed grid, which keeps its own column count.
  `facebook-lot-photos.ts` draws it with sharp from the offer's upload set (which now carries each
  image's side, pair and size), within the platform's edge and size limits — **once, in the
  background, and stored since #1861** (below); `buildFacebookPostPhotos` is the post's ZIP — one
  `lot-NN-<offer slug>.jpg` per lot when captioned (the frozen layout first),
  `buildFacebookPostPhotoArchive` otherwise. Either ZIP is named `facebookPostPhotoArchiveName` (pure,
  `facebook-post-rules.ts`, #1871): `<postNo>-<title slug>-photos.zip`, the stem `offerFileSlug`
  (`offer-rules.ts`) makes for an offer's, so two posts never download under one name. The kit
  (on the post's screen since #1842) shows a **Layout** select (a plain line once posted) and, captioned, each lot's photo
  and caption with its own copy button (in the lot's row since #1863); the repost dialog lists the captions too. The integration
  test is `tests/integration/facebook-captioned-posts.test.ts`.

- **A captioned lot's photo is drawn once and stored** (#1861, decided with the collector on
  2026-10-12; ADR-0061 §2 as amended), no longer drawn on every view and download. `FacebookLotPhoto`
  (one per offer) is the queue row and the record of the stored image, as `OfferPhotoGeneration` is for
  the offer's own: `status` `queued | running | ready | failed`, `photoId` → a `Photo` of the offer
  with `kind = generated` and **no plan entry** (`SetNull`, so the closed-offer sweep taking it leaves
  the row), and `fingerprint` — sha256 of `lotPhotoFingerprintPayload` (pure, `facebook-lot-photo-rules.ts`):
  the upload set's photo ids in order with each one's side, pair and size, the offer's collage mode,
  shape, columns, gap and background, the platform's edge and size limits, and
  `FACEBOOK_LOT_PHOTO_DRAWING` (raise it when the drawing changes). The upload set is read **without
  bytes** through `readOfferUploadPlan` (split out of `readOfferUploadSet`), so whether a photo is
  current is answered without reading an image. **`syncFacebookPostLotPhotos(postId)` is the one
  place that decides**, through `decideLotPhoto` (pure): a lot in no captioned post is dropped (row,
  photo row, then bytes); a run queued or under way is *generating*; **a lot with a frozen snapshot
  (#1800) keeps a ready photo whatever has changed** — a repost keeps it too, the repost dialog showing
  no photos; an offer with nothing going up is *none* with the reason, its photo dropped; a ready photo
  of the current fingerprint is served; a failure on the current fingerprint stays *failed*, so a broken
  image is not retried in a loop; anything else is queued and shown as *generating*, never served
  stale. Every read goes through it (`readFacebookPostLotPhotos` behind `GET …/facebook-posts/[postId]/lot-photos`,
  which kicks the worker; `buildFacebookPostPhotos`), and so do the writes that change what a photo is
  made of: `createFacebookPost`, `setFacebookPostLayout`, the worker after an offer run succeeds
  (`refreshFacebookLotPhotosForOffer`), and Settings → Facebook's saves (`refreshFacebookLotPhotos` /
  `refreshFacebookGroupLotPhotos`, in the actions — `facebook-groups.ts` cannot import it,
  `facebook-auctions.ts` importing that). `pruneFacebookLotPhotos(collectionId)` drops the photos of
  offers in no post, after `removeFacebookLot`, `deleteOffer` and an `updateOffer` moving a lot off
  Facebook — a dissolved post's last lot included. **The worker** (`offer-photo-worker.ts`) drains this
  queue behind the offer queue, one job at a time, offers first; `runFacebookLotPhoto` reads the plan,
  fingerprints it, reads the bytes as `work`, draws, writes the new photo before the old one goes and
  records the fingerprint it drew — or, failing, the one it tried. **The offer's own run never swaps
  the lot photo out** (`facebookLotPhoto: { is: null }` on its swap), since a published post keeps it.
  **The ZIP waits** (the collector, 2026-10-12): `lotPhotosNotReady` names the lots still generating or
  failed and `FacebookLotPhotosNotReadyError` is a 409; the kit greys **↓ Photos** with that sentence
  as its tooltip. The kit reads the states through `useFacebookPostLotPhotos` (`offerKeys.facebookLotPhotos`,
  polled every 2 s while any lot is generating) and `PostLots` hands each lot's row a `LotPhoto` — a
  ready photo from the ordinary photo route,
  downloading it as `fileName`; the per-lot drawing route is gone. The integration test is
  `tests/integration/facebook-captioned-posts.test.ts`.

- **A multi-lot post has a number and a screen of its own** (#1842, decided with the collector on
  2026-10-12; ADR-0061 §2). `FacebookPost.postNo` comes from `Collection.nextFacebookPostNo` through
  `allocateEntityNumber(…, "facebookPost")` in `createFacebookPost` — the one writer, so not ADR-0062's
  trigger — unique per collection and never reused (the integration test dissolves the **newest** post
  so a `max + 1` would fail it; checked when written). The migration numbered existing posts oldest
  first. The screen is `/c/[slug]/offers/posts/[postNo]` (`findFacebookPostId` resolves the number;
  the static `posts` segment shadows no offer id), drawn by `facebook-post-panel.tsx` off
  `getFacebookPostScreen` (`facebook-posts.ts`: the kit read once off the first lot, the platform for
  *Sell* — one lot, or the ticked lots together (#2050), ticked in a `CheckCell` that is the row's first
  cell, its whole height (#2082: the row does not wrap, its body after the cell does; an unsellable lot
  keeps the cell empty) — and each lot's sales from `SaleLine.offerId`) through `GET …/facebook-posts/[postId]`, under
  `offerKeys.all` so `invalidateAll` refreshes it. **Which whole-post moves it offers is
  `facebookPostMoves`** (pure, `facebook-post-rules.ts`), written to match the gates of
  `publishFacebookPost`, `rejectOfferOrPost` and `withdrawOfferOrPost`; the moves themselves are the
  existing actions asked of a lot — any lot to publish, a pending one to approve, reject or withdraw —
  so nothing new runs server-side. `facebookPostStage` is where the post stands, said on the screen and
  on each lot's card. The kit section moved out of `offer-facebook-card.tsx` into `facebook-post-kit.tsx`
  (`FacebookPostKit`, `selfOfferId` null on the post's screen so every lot's gap links to its offer):
  the card draws it only for an offer posted alone, and a lot's card is the post's number, the lot's,
  the stage and *Open post*, keeping the lot's own template and bidding; its *Listing link* and
  *Repost…* are for an offer posted alone (a lot reposts from the offer's ⋮). **The offers list**:
  `OfferListItem.facebookPost` (`{ postNo, lotNo }`) draws `FacebookPostChip` in `offer-badges.tsx`, and
  `facebookPostNo` in `OfferListFilters` (URL `post`, parsed by `parseFacebookPostNo`) narrows the list,
  the summary and the detail walk (`list-context.ts`) but not the toolbar's counts, as `bidding`. The
  integration test is `tests/integration/facebook-post-screen.test.ts`.

- **A list of every post** (#1850, decided with the collector on 2026-10-12): the sidebar's
  **Marketplaces → Facebook** — there, not under Offers as the issue first proposed, since the
  *Sold on Allegro* entry it was to sit beside had moved to Marketplaces as *Allegro* (#762, #971) —
  at `/c/[slug]/offers/posts`, headed *Facebook posts*; the post screens under it light that entry and
  the Offers group's `except` list yields the route. `listFacebookPostsPaginated` (`facebook-posts.ts`,
  newest `postNo` first, offset-paged like trades) through `GET …/facebook-posts`, under
  `offerKeys.facebookPosts` so a write to any offer refreshes it. A row is the number, the group, the
  lots and those still for sale (not `CLOSED_OFFER_STATES`), `facebookPostStage`, the layout through
  `facebookPostLayout` (the group's read live when the post follows it), the earliest lot's
  `listingDate` and `facebookPostLink`. **The stage filter is a query over the lots**
  (`facebookPostStageWhere`), written to `facebookPostStage`'s precedence — pending, up, over, ready,
  preparing — since the stage is no column; the integration test
  (`tests/integration/facebook-posts-list.test.ts`) checks every filtered row's own stage. The group
  filter's options are the groups holding posts (`listFacebookPostGroups`). Since #1989 every post is
  listed, a post of one lot included (its row says *Posted alone* in place of the lots and layout), and
  **Not in a post yet** sits above the rows: `listFacebookOffersNotInPost` (Facebook offers with no
  post in Preparing or Ready, read through `readKitLots` for the title) behind
  `GET …/facebook-posts/not-in-post` (a static segment shadowing `[postId]`), under
  `offerKeys.facebookNotInPost`. The group filter narrows it; the *Being prepared* / *Ready to post*
  chips narrow it to that state; the other stages and *No title* hide it. It **folds to one line**, its
  heading and count (#1991, decided with the collector on 2026-10-17): sixty-odd offers in no post
  pushed the posts far down, useful when wanted and noise otherwise. Folded the first time, and then
  as last left — a `usePersistedFlag` per collection (`…:notInPostExpanded:<collectionId>`), like the
  Offers summary bar's *More*; a client preference, not URL state, since it is not a filter. The count
  is the filtered list's length, so it follows the group filter.
  **The group, stage and *No title* filters are remembered per collection and kept in the address**
  (#2108, decided with the collector on 2026-10-22): the Intake documents list's arrangement (#1392),
  in `offers/posts/posts-view-params.ts` (pure, unit-tested) and `use-posts-view.ts` over
  `usePersistedFilterParams` — the address wins where it names a filter, the memory fills in the rest,
  every press writes both, and a restored filter is written back into the address with `replace`
  (#844). The params keep their pre-#2108 names (`group`, `stage`, `untitled`). A **stored** group that
  no longer holds a post is pruned against the menu's options; one a link names is taken as written.
  While any filter narrows the list, the band under the toolbar names them with *Clear filters*. The
  fold of *Not in a post yet* stays its own flag, not part of the set.

- **A post is deleted with every offer in it** (#2060, decided with the collector on 2026-10-18), in
  any stage, from the ⋮ beside the post screen's title and from the row's ⋮ on the list of posts —
  both open `DeleteFacebookPostDialog` (`offers/posts/delete-post-dialog.tsx`). The dialog reads
  `readFacebookPostDeletion` first (`facebook-posts.ts`: offer count, `submitted` —
  `isFacebookLotPosted` on any lot — and the lots with a sold set), so the confirmation states the count
  and, for a submitted post, that the post in the group stays; a sold lot turns the dialog into the
  refusal with only *Close*. **A lot with a sold set refuses the whole post**, named by
  `facebookPostDeleteRefusal` (pure, `facebook-post-rules.ts`) — `deleteOffer`'s own guard, the same
  `SaleLine → offerSet` reading, since such an offer is withdrawn and never deleted. `deleteFacebookPost`
  asks it again inside its transaction, so a sale recorded while the dialog was open still refuses;
  it then deletes the offers and the post in one write and the offers' image files after the commit
  (the photo rows go by cascade; the files are read first, `dropLotPhotos`' shape). Nothing goes
  through `detachFacebookLot` — no lot outlives the post, so there is nothing to renumber or dissolve —
  and the number is never reused, `allocateEntityNumber` being a counter. The integration test is
  `tests/integration/facebook-post-delete.test.ts`.

- **The post's screen shows every photo the post puts up** (#1848, decided with the collector on
  2026-10-12), so posting needs no lot opened. Photos are `PHOTO_SIZE` (18rem) drawn from the `full`
  variant — the 320px thumb is too small to tell stamps apart: captioned, each lot's one photo with its
  caption and *Copy*; as text (`TextLayoutPhotos`), the lot's upload set without captions. The text
  layout reads each lot's photo plan client-side through `useOfferPhotoPlans` (`useQueries` under each
  offer's own `offerKeys.photoPlan`, shared with the lot's Photos card) and keeps what
  `facebookLotUploadPhotos` (pure, `facebook-post-rules.ts`: publish and not over the limit —
  `readOfferUploadSet`'s filter) keeps; one photo downloads as `facebookLotPhotoFileName` names
  it, which `buildFacebookPostPhotoArchive` now uses too, so the one file and the ZIP's agree. A lot
  with nothing to put up says so in its row. `FacebookOfferKit.collectionId` is what the photos are
  read through. An offer posted alone keeps its kit as it was: text and ZIP only.

- **A click on a post's photo opens it enlarged; one photo downloads from a discreet button** (#1865,
  decided with the collector on 2026-10-12). #1848 made the click a download, but the collector takes
  the whole post through *↓ Photos* and clicks a photo to look at it, as everywhere else in the app.
  `PostLots` builds the post's photos in lot order (`PostPhotoEntry`: captioned, each lot's stored photo once
  #1861's worker has drawn it — `LotPhoto` keeps the placeholder until then; as text, each lot's upload
  set once its plan has loaded), each labelled with its lot, and opens the shared
  `PhotoLightbox` on the one clicked, stepping through them all. `PostPhoto` draws the photo as a
  button and, in its corner, the one-photo download (`Icon` `download`, hint *Download this photo*),
  hidden until the photo is hovered or the button has focus — the `.post-photo` rule in `globals.css`.

- **A post's screen lists its lots once** (#1863, decided with the collector on 2026-10-12): #1842's
  *Lots* table and #1848's per-lot photos and captions were the same lots twice. The kit keeps the
  post-wide part (layout, text, ZIP, gaps) and takes a `renderLots` prop; its `PostLots` hands the post
  panel a `lotKit(lot)` → `FacebookLotKit` (`photos`, and `caption` when captioned, under the kit's own
  Source switch), and the panel's `LotRow` draws one flex-wrapping row per lot — photos, lot and offer
  with its `⋮`, type, price, state, link, sale, caption — that wraps rather than shrinking the photo.
  The kit still owns what a lot puts up; the panel owns where it stands and what it can do.

- **Every multi-lot post has a title** (#1862, decided with the collector on 2026-10-12; ADR-0061 §2).
  `FacebookPost.title`, nullable only for posts made before it (the migration backfills nothing — a
  title is the collector's words, #1692). `createFacebookPost` takes it and `setFacebookPostTitle`
  renames, both refusing a blank one through `facebookPostTitleRefusal` (pure) before anything is
  written; *Post together…* is now `PostTogetherDialog` (`offers/post-together-dialog.tsx`), which asks
  for it, and the post's screen edits it in its heading through `InlineText`, at any stage. It is named
  through `facebookPostLabel` (*Post #N · title*, or *Post #N*) on the screen, the lot's card and the
  chip's hover (`OfferListItem.facebookPost.title`); the list of posts shows it and filters to the
  untitled (`untitled`, URL `untitled=1`). **`{postTitle}`** (`FACEBOOK_POST_TITLE_PLACEHOLDER`) sits
  beside `{post}` in the caption and captioned-post lists only. The render and gap functions take a
  `FacebookPostName` (`{ postNo, title }`) where they took `postNo`. A missing title is
  `FacebookCaptionedPostGaps.missingPostTitle` — **one** gap for the post, kept out of
  `emptyPlaceholders` so it is not named per lot. **Unlike the number, the title is content**: frozen as
  `FacebookFrozenLot.postTitle` (`""` when the post had none; null on a snapshot older than titles,
  which reads the live one), and `facebookPostSource` returns the `post` to render, its title off the
  last lot's snapshot — so a rename after posting leaves the posted text as it was. The integration
  test is the *its title* suite in `tests/integration/facebook-post-screen.test.ts`.

- **Offers can join a post that exists** (#1870, decided with the collector on 2026-10-12; ADR-0061 §2
  as amended), only while it is not up — `facebookPostMoves().addLots`, the same `!posted` as
  `takeOut`. `addFacebookLots` (`facebook-posts.ts`) refuses a post with a lot past Ready whole, then
  asks each offer `facebookLotAddRefusal` (pure, `facebook-post-rules.ts`: *Post together*'s conditions
  against the post — its group, in no post, not yet up, one of the post's `lotTypes` unless
  `mixedListingTypes`), phrased to follow the offer's number. **Partial by design**: the qualifying
  offers become lots `max + 1…` in the order given, the rest come back in `refused` and as one
  `describeRefusedLots` sentence; when none qualifies nothing is written and that sentence is the
  error. The auctions then share the first closing time in lot order, `createFacebookPost`'s rule, so
  a post with none takes an added auction's. `syncFacebookPostLotPhotos` queues a captioned post's new
  lots. **Two doors**: the offers list's *Add to post…* (`AddToPostDialog`) lists posts through
  `listFacebookPostsPaginated`'s `notUp` filter (URL `notUp=1`) for the ticked offers' groups — composed
  with the stage filter as separate `AND` clauses, since both are queries over the lots — and puts the
  refused into the bulk-skip strip, leaving them ticked; the post's screen's *Add lots…*
  (`AddLotsDialog`) picks from `listFacebookLotCandidates` (`GET …/facebook-posts/[postId]/candidates`,
  `offerKeys.facebookLotCandidates`, read as kit lots through the now-exported `readKitLots`) and names
  the refused under the *Lots* heading. The integration test is
  `tests/integration/facebook-post-add-lots.test.ts`.

- **Generate offers can make its new offers the lots of a new post** (#2030, decided with the
  collector on 2026-10-18; the first of #2030–#2033, *the post is the one workspace*). The dialog's
  **In a new post** + title rides the commit only, as `GeneratorRequest.postTitle` (absent = no post,
  like `skip` never in the preview's query), and is offered while `canGenerateIntoPost` (the bar's
  status not past Ready) on a Facebook bar. `commitOfferGeneration` asks `generatorPostRefusal`
  (pure, `offer-generator-rules.ts`: a Facebook group, not yet up, **at least two new offers**, a
  title) before anything is written, then makes the post **inside the pass's transaction** through
  `writeGeneratedOffers`' `inTransaction` hook — so a refused post rolls the offers back.
  `writeFacebookPost` (`facebook-posts.ts`) is `createFacebookPost`'s write half, split out for this,
  reading the offers and asking `facebookPostRefusal` in the caller's transaction; `offers.ts` cannot
  import it (`facebook-posts.ts` imports `offers.ts`), hence the hook. **Only the created offers** are
  lots, in the preview's line order (the dialog shows *· lot N*); an addition to an existing offer
  stays where it is. The toast links to the post's screen. The integration test is
  `tests/integration/offer-generator-facebook-post.test.ts`.

- **Generate offers starts with *In a new post* ticked and the title suggested** (#2105, settled with
  the collector on 2026-10-22). Both are the plan's until touched: the dialog keeps
  `inPostChoice` / `typedTitle` null until the collector ticks, unticks or types, and reads the plan
  meanwhile — ticked while the ticked lines create at least two new offers, and the title from
  `suggestGeneratorPostTitle` (`generator-post-title.ts`, pure) over the copies of the ticked *new*
  lines. The plan's answer is kept from the last preview read (React's state-during-render pattern),
  so a mode change does not untick the box and empty the field while the next plan loads. The title
  is **the deepest area holding every stamp** — at any level, a top-level area included (the
  collector's answer on 2026-10-22; the issue's *below the top level* read as "no shared area") — by
  `areaOwnTitleName` in the default language, then the **issues' years** as `1940–44` (one century:
  the end's last two digits; across one: in full). No shared area: the years alone; no years either:
  empty, and the refusal asks for a title as before. Unticked where fewer than two new offers, the
  box shows `generatorPostRefusal`'s reason beside it. Nothing reaches the server that did not before.

- **A post's lots can be reordered before it goes up** (#1986, raised on 2026-10-16; ADR-0061 §2 as
  amended). `reorderFacebookLots` (`facebook-posts.ts`) takes **every** lot's offer id in the new order
  and renumbers them in two passes (the unique index, `detachFacebookLot`'s shape); it refuses once a
  lot is past Ready (#1800) and, through `facebookLotOrderRefusal` (pure), an order that does not name
  exactly the post's lots — a lot added or taken out meanwhile makes the browser's order stale. The
  lot number **is** the order, so the kit (`readKitLots` orders by it), the captioned post's `{offer}`,
  the ZIP's `lot-NN-` names and each lot photo's download name all follow with nothing else written;
  the lot photo's fingerprint holds no lot number, so nothing is redrawn, and the auctions already share
  one closing time. **Sorting is the browser's**: `sortFacebookLots` (pure) gives the ids for
  `catalog` — `FacebookKitLot.catalogSortKey`, the lowest of the lot's copies' numbers through
  `catalogSortKeyOf`, compared by `compareCatalogSortKeys` — or `priceAsc` / `priceDesc` over
  `facebookLotPrice` (the row's own figure, moved there from the panel); unnumbered or unpriced lots
  last, ties in their order, and the result goes through the same write. The panel drags rows with
  `reorder-list.tsx` (`handleOnly`, the grip beside *Lot N*, an `<li>` drop line since the lots are an
  `<ol>`) and draws the asked order (`movedOrder`) until the screen is read again. The integration test
  is `tests/integration/facebook-post-reorder.test.ts` (checked when written to fail with the posted
  gate removed).

- **A post's screen lists the names it prints untranslated** (#1889, raised by the collector on
  2026-10-13; #1733's links on a third surface). `FacebookPostScreen.translations` — null once any lot
  is up, its text frozen (#1800) — is `facebookPostTranslations`: per lot, the template it is written
  from in the post's layout (`facebookLayoutLotTemplate`), which of its offer's texts that prints
  (`facebookLotPrintedTexts`, pure: `{title}` the name, `{description}` the description; nothing else
  a post or caption prints is translatable), then `offersPrintedTextGaps` (`offers.ts`). That one is
  **not** `offerTranslationGaps`: it reads a field only while it **follows** its template (not
  `*Edited`, not null) and off the template ↻ would use (`effectiveTemplate`, the offer's own first),
  so it names what is actually in the words and exactly what `syncGeneratedTexts` would rewrite; one
  copy read per language for the whole post. The answer is the names once each in lot order plus
  `byLot` (offer id → `titleFallbackKey`s). **Each lot's row draws its own as the links** (#1980,
  raised on 2026-10-16: on a post of twenty lots one paragraph of every name above *Lots* could not be
  worked through) — `TranslationGapLinks` (`shared/title-preview.tsx`, split out of
  `TitleFallbackNote`, so one popover and one save path) with `withLanguage={false}`, the line above
  the lots naming the language once; that line is only a count of the rows needing one and *Next lot
  ↓*, which steps in lot order from the row it last stepped to (so a row just translated still counts
  as the place to step on from). `gaps` is the union of `byLot` by construction — the post text prints
  no translatable name of its own — so nothing is listed under the post text. **Saving re-renders, unlike the offer
  screen's panel (#299)**: its `onSaved` calls `refreshFacebookPostTexts` → `syncGeneratedTexts(name,
  description)` on every lot, refused once the post is up — the issue asked for the text to change at
  once, and the `*Edited` flags already keep hand-written wording, which was #299's reason not to. The
  integration test is `tests/integration/facebook-post-translations.test.ts` (checked when written to
  fail with the edited filter, the refresh, the layout's template or the posted gate removed).

- **A post's screen regenerates its lots' texts at once** (#1983, raised on 2026-10-16; the marks'
  meaning decided with the collector that day). `FacebookPostScreen.lotTexts` — null once any lot is up
  (#1800), like `translations` — is `offersTextStatus` (`offers.ts`, writes nothing) per lot:
  `handWritten` is either `*Edited` flag; `outOfDate` is **exactly what `syncGeneratedTexts` would
  rewrite** — a field following its template (not `*Edited`) whose fresh, non-empty render differs from
  what is stored, never on a terminal offer. **A hand-written text is never out of date** (the
  collector's pick): it was never the template's, and calling it stale would mark it forever. After a
  translation saved on the screen the lots following their templates are already re-rendered (#1889),
  so the mark is for what nothing re-rendered — a template changed in Settings, a translation entered
  on the entity's own screen. `regenerateFacebookLotTexts` (`facebook-posts.ts`) takes the lots to go
  through and the ticked hand-written ones (`overwrite`): those get `regenerateOfferTitleAndDescription`
  (↻ on both fields, only where `hasEffectiveTemplate`, so a field with no template is not emptied),
  the rest `syncGeneratedTexts`, which keeps hand-written words; refused once up and for an offer that
  is not the post's lot. The dialog is `RegenerateLotTextsDialog` beside the post panel: *All lots* or
  *Only the out-of-date*, hand-written lots of that scope listed unticked. The integration test is
  `tests/integration/facebook-post-regenerate.test.ts` (checked when written to fail with the overwrite,
  the posted gate, the edited filter or the own-lots check removed).

- **A post's lot titles are changed all at once** (#2033, settled with the collector on 2026-10-18 as
  one of #2030–#2033: the post is the one workspace until it is up). Two actions beside *Regenerate lot
  texts…*, offered while `FacebookPostScreen.lotTitles` is non-null — null once any lot is up (#1800).
  **Nothing is kept on the post**: `setFacebookPostTitleTemplate` (`facebook-posts.ts`) writes the
  template into every lot's own `Offer.nameTemplate` (#774's column, preferred over the platform's by
  `effectiveTemplate`), then `regenerateOfferText(name)` for each lot not `nameEdited`, plus the ticked
  hand-written ones — so a lot added later keeps its own title by construction, and the template
  follows each lot through a composition change like any offer-own template. A blank template is
  refused: an own template of `""` would render no title. The issue said the dialog starts *from the
  group's* template, but **a group has no title template** (the title template is the platform's,
  `Platform.titleTemplate`); `lotTitles.template` is the lots' own when they all share one — the one
  given here before — else the platform's. `changeFacebookLotTitleWords` adds or removes words at the
  start or end of each lot's **display** title (`readKitLots`, so a lot with no name of its own starts
  from its derived label) through `facebookTitleWithWords` (`facebook-post-rules.ts`, pure, which the
  dialog also uses for its preview) and writes through `patchOffer({ name })`, which sets `nameEdited`
  — the issue's rule that added words make the title hand-written. Removing matches exactly and only on
  a word boundary (a cut between two letters or digits is refused), and never empties a title. The
  integration test is `tests/integration/facebook-post-lot-titles.test.ts`.

- **A post's screen changes every lot's photo settings at once** (#2032, one of #2030–#2033 — the post
  as the one workspace, settled with the collector on 2026-10-18). **The post holds no settings of its
  own**: each lot is an offer keeping its own, written through `updateOfferPhotoConfig` exactly as its
  own dialog writes them, so a lot added later keeps what it had. The dialog **is** the offer's
  `PhotoSettingsDialog`, given `bulk` (`lotCount`, `differing`) — one set of controls, so the two cannot
  drift; `readPhotoConfigFields` and `offerPhotoConfigFromRow` (`offer-photo-config.ts`) were split out
  for the same reason, the row mapping out of `getOfferDetail`. A **setting** is what the offer dialog
  writes as one — each select, label and switch, and **each collage group whole** (#307's
  all-or-nothing numbers: a lot cannot be given one number of a collage it lacks). `sharedPhotoSettings`
  (`facebook-post-photo-settings-rules.ts`, pure) says per setting whether every lot shares it; a
  differing one opens as *Differs by lot* — a select's extra option, an indeterminate checkbox, a blank
  label with that placeholder, a collage with its numbers hidden until a template is picked — and the
  form posts `changed` once per setting changed, of which `parsePostPhotoSettingsPatch` keeps only those
  (a differing collage travels blank, which the offer's parser already reads as valid). **A template
  picked while the sides differ** posts `collagePairSides`, and `applyPostPhotoSettingsPatch` runs
  `applyCollagePairing` on each lot's own sides, as the offer dialog does on its one; while the sides are
  shared the dialog pairs them itself. `updateFacebookPostPhotoSettings`
  (`facebook-post-photo-settings.ts`) writes a lot only when the patch changes it and answers those
  lots, which the dialog's *Regenerate photos after saving* (ticked, #328) hands to
  `generateOffersPhotosAction` — refusals collected, the rest queued. Both read and write are refused
  once any lot is posted. The actions are in `actions/facebook-post-photos.ts`; the button is
  `PostPhotoSettingsButton` beside *Regenerate lot texts…*, reading the lots' settings when opened rather
  than with the screen. Tests: `tests/unit/facebook-post-photo-settings-rules.test.ts`,
  `tests/integration/facebook-post-photo-settings.test.ts`.

- **A post's screen narrows its lots to the ones still for sale** (#2081, raised on 2026-10-19). One
  `FilterChip`, *Still for sale*, above the lots — drawn once the post is up and has more than one lot,
  since before that no lot can be sold or withdrawn (a sold or withdrawn lot stays behind in the old post
  on *Back to Ready*, #1998) and a post of one has nothing to narrow; that is also why it never meets the
  drag-to-reorder, which is only before the post is up. On, the rows are `facebookLotsInView`
  (`facebook-post-ui-state.ts`, pure): the lots `isFacebookLotForSale` — not sold or withdrawn, the
  list of posts' `forSaleCount` reading — in lot order; its count is on the chip and a status line says
  how many of the post's lots are shown. **Remembered per post** in `localStorage`, not the URL, as the
  purchase order's chips are: one entry per post through `createRecordUiStore`
  (`offers/posts/[postNo]/post-ui-state.ts`, `stamporama:fbpost:ui:`), stored only while on. **Ticks**:
  the chip never touches the ticked set, and the bar and *Sell…* read the ticked lots **in view** —
  which here changes nothing in practice, since the chip hides only lots that can no longer be sold and
  those never counted. The kit, the photos' ZIP and the post text read `kit.lots`, the whole post.
  The unit test is `tests/unit/facebook-post-ui-state.test.ts`.

- **A post's screen prices its lots and marks them ready, as Prepare does — until it is up** (#2031,
  settled with the collector on 2026-10-18; the issue's *to be confirmed* points implemented as
  written). One of the four issues #2030–#2033 making the post the one workspace from generating the
  offers to publishing them. **The rows are Prepare rows by construction**: `getFacebookPostLotsPrepare`
  (`facebook-posts.ts`) reads the post's lots through `readPrepareOffers` (`offers.ts`, now exported
  and given the states to read — `preparing` and `ready` here, since a Ready lot is still repriced) and
  so through `buildPrepareOffers`, keyed by offer id; null once any lot is up (#1800). It is a read of
  its own — `GET …/facebook-posts/[postId]/prepare`, `offerKeys.facebookPostPrepare`, polled while a lot
  waits for its photos — and not a field of `FacebookPostScreen`, because each row costs a valuation and
  a photo-plan read: a saved price goes through `settlePostLotPrice`, which writes the lot's row in the
  cache and marks every *other* offer read stale, the post's own screen included, so the kit's text
  follows the figure without every lot's figures being rebuilt per Enter (#1894's rule). **The row's
  parts are one component each**, `prepare/prepare-offer-parts.tsx` — `PrepareTitleField`,
  `PreparePriceField` (the compact `OfferPriceStrip` with the standing field), `PrepareReadiness` (the
  blockers, the photo half said as *Photos generated on Mark ready*, the covers as *Check covers (N)*) —
  which `PrepareOfferRow` draws too, so the two screens cannot price or ready an offer differently. The
  post's `LotRow` draws them under its heading while the read has a row for the lot (the readiness only
  on a Preparing lot), dropping its static title link and *Price* fact; the offer's number becomes the
  link. Enter moves down the lots' price fields in the order drawn. **Above the lots**, *Use estimated
  price* (`applyEstimatedPricesAction`, the unpriced lots with an estimate), *Check covers*
  (`OffersCoverWalk` over every lot with unchecked photos) and *Mark ready* (`markOffersReadyAction`,
  every Preparing lot) — Prepare's own actions over the lots' ids, so nothing new runs server-side; a
  refusal is named by its lot number under the buttons. Prepare itself is unchanged. The integration
  test is `tests/integration/facebook-post-prepare.test.ts`.

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

- **On Facebook, publishing has one door: *Publish…*** (#1847, decided with the collector on
  2026-10-12). *Activate…* and *Submit for approval…* opened the same `ActivateOfferDialog`, so a
  Ready Facebook offer — its header's quick advance, its ⋮, its row in the Offers list — and a post's
  screen show one *Publish…*, and live or waiting for approval is chosen only in the dialog, which
  still ticks *Waiting for approval* for a `pending_posts` link (#1779). `menuTransitions` and
  `isFacebookPublish` (`offer-rules.ts`) are the rule; a Facebook offer is one with a group. *Publish…*
  always opens the dialog, even for an offer posted alone that already carries a link — the dialog is
  where the choice is. On a post's screen `facebookPostMoves.submit` stays and becomes the dialog's
  `canWait`: a post half up after a refusal can only finish going live. Other platforms keep
  *Activate* and *Submit for approval…*.

- **The kit's text is rendered in the browser** (`renderFacebookPostText`, pure): `{closesAt}` is a
  local time and the browser is the only place the zone is known (#490's rule). **A post is only what
  its template places** (#1692, decided with the collector on 2026-10-09): nothing is substituted,
  added or fallen back to. `{description}` is the offer's description and nothing else — empty when it
  has none (the kit's title stand-in is gone); `{title}` the display title; `{price}` a quick buy's
  asking price. **Every amount is `generatedAmount`'s** (#1787, `decimal-input.ts`, through
  `facebookMoney`): whole without decimals, otherwise both (`15`, `15.50`, never `15.5`) — the
  collector's rule for every template that generates text; the card's own *Highest bid* keeps two. **The
  currency is the symbol by default** (#2028, settled with the collector on 2026-10-18): every amount
  placeholder — here `{startingPrice}`, `{increment}`, `{price}`; in the buyer message `{itemsTotal}`,
  `{shipping}`, `{total}`, `{shippingOptions}` — takes `:symbol`, `:code` or `:none`, the bare token
  being `:symbol`. The table is `CURRENCY_SYMBOLS` (`currencies.ts`, typed over `COMMON_CURRENCIES` so a
  currency added to the pickers without a symbol fails the typecheck; a stored code outside it writes
  its code); `template-amount.ts` holds `writtenAmount`, the `TEMPLATE_TOKEN` that matches a parameter,
  `resolveTemplateToken` and `isKnownTemplateToken`. A placeholder flagged `amount` in its list takes
  the parameter; a parameter anywhere else, or one that is not a style, makes the token unknown — kept as
  typed and named under the field, nothing new to learn. `FacebookPostLotText` therefore carries the
  raw 2-dp figures and the currency rather than words, and `facebookPostGaps` names an empty amount by
  its bare placeholder whatever parameter it was written with, so the card's reasons still match. **A
  frozen lot keeps the default it went up with**: `FacebookFrozenLot.currencyStyle`, written `symbol`
  by `freezeFacebookPostText`, and read back as `code` from a snapshot older than the field — those
  posts said `PLN`, and the card says *As posted*. Screens are untouched. **A number placeholder takes
  `:N` the same way** (#2097, settled with the collector on 2026-10-21): every placeholder whose value
  is an internal number — here `{lot}`, `{offer}`, `{post}`; in the buyer message `{sale}`; in a listing
  text `{itemNo}` — writes it plain bare and zero-padded to N digits with `:N` (1–10, `parseNumberPad`,
  never cut). It is flagged `number` in its list, and its value is a `TemplateNumbers` (`templateNumbers`)
  rather than text, so a list — the captioned post's `{offer}` — pads every number alike. A width that
  is not one is the misspelt parameter again: kept as typed, named under the field. The retired `{catalog}` is every copy's leading number through
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
  When the card shows the bidding and calls it closed is `facebookBidding`
  (`facebook-bidding-rules.ts`, pure), shared with the phone offer screen, which records the bid
  through the same action (#2010, `phone.md`).

- **A closed Facebook auction asks for its result with or without a bid** — `auctionNeedsResolution`
  takes `facebook` and skips the *somebody bid* part for it, and `endedAuctionWhere` adds
  `facebookGroupId: { not: null }` to the bid `OR`: nobody reads Facebook bids, so a zero is no
  evidence. The integration test fails with that clause removed (checked when written). Since #1777
  it is answered with *Sell* or *Withdraw*; `tests/integration/facebook-sales.test.ts` holds it now.

- **A Facebook offer is sold with the ordinary *Sell* and taken down with the ordinary *Withdraw***
  (#1777, decided with the collector on 2026-10-11, amending #1545/#1671; ADR-0061 §4). The card's
  *Record result…* / *Record sale…* and *No bids* are gone, with `facebook-results.ts`, its dialog and
  `cleanFacebookWin`/`splitAuctionPrice`. What Facebook adds to *Sell* is `facebook-sales.ts` (imports
  only `db`, `platform-modules` and the pure `facebook-profile-rules.ts`, so `sale-header-input.ts` can
  import it without a cycle). **The buyer**: `SellOfferFlowDialog` passes `buyerByFacebookProfile`
  (the offer has a `facebookGroupId`) to `SaleFormDialog`, which swaps the buyer picker for a name and
  a profile link, asks `lookupFacebookBuyerAction` while it is typed, and submits
  `buyerFacebookProfileUrl` — whose presence routes `resolveSaleHeader` to `resolveFacebookBuyer`
  instead of `resolvePurchaseContact`. Both go through `findFacebookBuyer`: by profile link first —
  any of the contact's `ContactFacebookProfile` rows (#2042) — then by name (case-insensitive, any
  role); a name match whose contact has links, none of them this one, is refused as somebody else (or
  the same person on an account not yet on the contact — only the collector can tell), since
  `Contact.name` is unique. A found contact gets the buyer role and, where it has no link at all, the
  link; otherwise a buyer is created with both — a link alone that matches
  nobody is refused, a contact needing a name, and nothing typed is no buyer. It refuses a platform
  that is not Facebook's — the one check `resolveFacebookBuyer` adds to `findOrCreateBuyer`, which the
  agent API's `find_or_create_buyer` reaches directly, with or without a link (#1949). `createSaleAction` checks the collection before that write, since
  `createSale` would only check it after. **The currency**: `createSaleAction` takes `forOfferId`, and
  `facebookOfferSaleCurrency` hands a Facebook offer's currency to `createSale` as `offerCurrency`, so
  a group's own currency survives and the platform lock is neither read nor written — #1545's rule,
  kept. Everything else is *Sell* as anywhere: an existing sale on the platform in the offer's
  currency, or a new one; each set at the offer's current price (no split). The card keeps the bid
  field after the close (*Record winning bid*), which is how the winning figure reaches the price
  *Sell* uses. Sales recorded through the old dialog are untouched.

- **A post waiting for the group's approval moves as one** (#1778). `publishFacebookPost` takes
  `to`: `pending` moves each Ready lot `ready → pending` with the pending post's link; `active` moves
  each Ready **or** pending lot up, and on an approval writes the final link over the **post's**
  pending link — `facebookPostLink`, the link most lots carry (first lot wins a tie), read off the
  lots rather than off the lot the approval was asked from, because that lot may carry its own
  photo's link. `rejectOfferOrPost` takes every pending lot back to Ready (links cleared, the
  ordinary `pending → ready`); `setOfferStateAction` routes every `→ ready` through it.

- **A post that is up goes back to Ready** (#1998, decided with the collector on 2026-10-17; ADR-0061
  §2 as amended). `takeFacebookPostBackToReady` (`facebook-posts.ts`), asked of any lot, through
  `takeFacebookPostBackToReadyAction` (`actions/facebook.ts`) from the post's screen and each lot's card
  (`BackToReadyDialog`, `offers/back-to-ready-dialog.tsx`, names the lots that stay and the bids
  cleared). `active | paused → ready` is **not** a manual transition — every other platform's listing
  that went up stays one, and `menuTransitions` must not offer it — so it is
  `takeFacebookOfferBackToReady` (`offers.ts`), `transitionOffer` with `takeDown`: a Facebook offer that
  is up only, no ready gate (a rejection's reason: it was ready when it went up), and on top of the
  move's own unfreezing it clears `url`/`colnectSaleId` as a rejection does, `listingDate` and
  `lastPostedAt` (publishing again is a first Publish, `approvalStamp` included), and an auction's bid
  (`price` 0 — the card's *no bid* — `priceCheckedAt`, `bidderCount`, `inActiveBidding`,
  `biddingNoticeAt`); `endsAt` stays. Which lots go is `facebookBackToReadyPlan` (pure): sold and
  withdrawn stay, everything else goes, and `facebookPostMoves().backToReady` is no pending lot and
  one active or paused. **The split** (some lot stays) makes a post through `allocateEntityNumber` with
  the old one's group, title and `layout` column verbatim (null follows the group, as the old one
  did), and moves the going lots into it numbered from 1 in lot order **before** any transition, so a
  refusal halfway leaves one post with nothing sold in it and asking again finishes it; the staying
  lots keep their lot numbers, gaps and all, which is why the post screen's row number is the lot's
  `lotNo` now rather than its index (the index only while a drag is drawn). The integration test is
  `tests/integration/facebook-post-back-to-ready.test.ts` (checked when written to fail with the split
  or the bid clearing removed).

- **What the Facebook side of Pending adds** (#1779; the collector decided the closing time on
  2026-10-11, the rest was decided in writing the issue). **A pending-post link proposes Pending**:
  `isFacebookPendingPostUrl` (pure, `facebook-post-rules.ts`: a facebook.com host and a
  `pending_posts` path segment) ticks *Waiting for approval* in `ActivateOfferDialog` and
  `RepostOfferDialog` the moment such a link arrives — a proposal, the tick stays the collector's.
  **Approving an auction asks its closing time**: the dialog, given `offerId` while approving, asks
  `readFacebookApprovalClosingAction` → `readFacebookApprovalClosing` (`facebook-posts.ts`), which
  answers for the **pending auction lots** of the post, or the offer alone (`pendingFacebookAuctions`),
  with their `endsAt` and the group's `auctionDays`/`closingTime` read **now**
  (`readFacebookGroupSettings`) — null off Facebook, for a quick buy, or with nothing pending, and
  then nothing is asked. The browser proposes `facebookDefaultEndsAt(today, …)` (#490's rule, the
  zone), the field starts on it (else on the time as posted) with *Proposed* / *As posted* beside
  it, and `publishOfferAction(…, endsAt)` → `publishOfferOrPost(…, endsAt)` writes the answer to
  every auction that approval took up (ids read **before** anything moves). An `endsAt` left
  `undefined` writes nothing, so every other publish path is unchanged. **Withdrawing a pending lot
  withdraws the post**: `withdrawOfferOrPost` takes every pending lot of the post to `withdrawn`;
  a lot of a post that is up is withdrawn alone (each lot keeps its own result once up), and a lot
  already withdrawn with its post is a no-op, so the list's bulk withdraw (which goes through it too)
  reads two ticked lots of one post as done. **A repost can wait** and **the refresh count starts at
  approval** — both are `offers.md`'s (`repostOffer`'s `to`, `approvalStamp`).

- **The profile link is stored normalised** (`normalizeFacebookProfileUrl`, pure in
  `facebook-profile-rules.ts`): `https://www.facebook.com/<path>`, lower case, no trailing slash, no
  query except `profile.php`'s `id`, the phone and desktop hosts folded together — so the lookup is an
  equality. `contacts.ts` normalises on every write and refuses a non-Facebook address with
  `ContactFieldError`; an update that omits the field leaves it alone.

- **A contact holds several profiles, and a profile is one contact's** (#2042, decided with the
  collector on 2026-10-18; ADR-0061 §4 as amended). `ContactFacebookProfile` (`collectionId`,
  `contactId`, `url`), **unique on `(collectionId, url)`**, replaced `Contact.facebookProfileUrl`; the
  migration kept a link that stood on two contacts on the **oldest**, the one the old
  `findFirst … orderBy createdAt` lookup answered with. Every reader selects them through
  `FACEBOOK_PROFILES_SELECT` (`facebook-sales.ts`; added order, the id breaking a tie within one save),
  and `ContactData.facebookProfileUrls` is that list. The contact form submits one `facebookProfileUrl`
  field per row and the action reads them with `getAll`: the list submitted **is** the contact's set,
  and `writeFacebookProfiles` (in the create/update transaction) deletes what is gone, adds what is new
  and refuses — naming the holder — a link another contact has, before the unique index would say so
  bare. The row and the page show each by `facebookProfileLabel` (the path after the host). The agent
  API's buyer keeps `facebookProfile` — the link the request named when it is theirs, else their first —
  and adds `facebookProfiles` (an added key, not a version: ADR-0050). Merging two contacts (#2043)
  builds on this.

- **Where it is seen.** Settings → Facebook (`facebook-settings-page.tsx`): the platform choice in the
  header (`MarketplacePlatformSelect`, *Facebook platform*), then list beside detail (#1471) with no
  page tabs and no summary strip — the tabs are the detail pane's (#1849, below). The list's first row is **Facebook defaults** (`DEFAULTS_ROW`, the
  page's default selection), then the groups; a group's pane shows each setting as *Same as Facebook*
  with its value, or with its field once *Custom for this group* — a checkbox named `custom` carrying
  the key, so the pane's unsaved measure sees it. Archive/Restore is the detail
  pane's header action; Delete is disabled with its reason while offers name the group. The user guide
  is `docs/user-guide/facebook.md`.
  **The pane is in tabs by case** (#1849, decided with the collector on 2026-10-12, amending #1801's
  one grid of sections): **General** (type, currency, mixing, the note), **Auctions** (post template,
  caption, the figures), **Quick buys** (post template, caption, refresh days), **Several-lot posts**
  (layout, captioned post text), **Buyer messages** — each holding everything for its case and
  nothing else. Which setting is on which tab is `facebook-settings-cases.ts` (pure, a `Record` over
  `FacebookGroupSetting`, so a new setting without a tab does not compile; the split is pinned in
  `facebook-settings-cases.test.ts`). Facebook's pane and a group's are one layout,
  `FacebookSettingsTabs`, drawn through a `Slot` — a label and field there, `FollowableSetting` here.
  **Every panel stays mounted**, the others `hidden`: the tabs are grouping in one form, and a panel
  unmounted would drop its fields from `FormData`, so a save would blank them. The tab shown is
  `&case=` (`FACEBOOK_CASE_PARAM`, a Settings view parameter, written with `history.replaceState`
  like `&row=`), so it stays while moving between the defaults and the groups; the kit's links to a
  missing setting carry it, landing on the setting's tab. A group's tab holding a custom setting
  carries a dot (`facebookCustomCases`), live as *Custom* is ticked. **Every template says when it
  is used** in one line under its label (`USED_WHEN`), followed or own. A group's name and link are
  the group, not settings, so they sit above the tabs.
  An offer is the offer form (group, the listing type seeded from it until touched, and an auction's
  increment, shown only on the Facebook platform, the group locked on a lot of a post), the
  **Facebook** card on the offer's screen, directly under the description like every platform's card
  (#1667: the post text is read and copied right after it) (`offer-facebook-card.tsx`, with a **Bidding** part while an
  auction is up — and nothing of its own for a quick buy, which is sold and withdrawn from the offer's
  actions (#1777)), and **Post together** in the offers list's
  selection bar, offered while every ticked offer in view is a Facebook offer and numbering the lots
  in tick order; its toast links to the new post's screen (#1842).
