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
  no auction already made. The kit's template and note are read live until the offer is published,
  then frozen with it (#1800, above). The
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
  template: an offer posted alone has no number and nothing stands in for it (#1692), so there it is
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
  `facebook-lot-photos.ts` draws it with sharp from `readOfferUploadSet` (which now carries each
  image's side, pair and size), on demand and never stored, within the platform's edge and size
  limits; `GET …/facebook-posts/[postId]/lots/[offerId]/photo` serves it (refused for an offer not
  in the post), and `buildFacebookPostPhotos` is the post's ZIP — one `lot-NN-<offer slug>.jpg` per
  lot when captioned (the frozen layout first), `buildFacebookPostPhotoArchive` otherwise. The kit
  (on the post's screen since #1842) shows a **Layout** select (a plain line once posted) and, captioned, each lot's photo
  and caption with its own copy button; the repost dialog lists the captions too. The integration
  test is `tests/integration/facebook-captioned-posts.test.ts`.

- **A multi-lot post has a number and a screen of its own** (#1842, decided with the collector on
  2026-10-12; ADR-0061 §2). `FacebookPost.postNo` comes from `Collection.nextFacebookPostNo` through
  `allocateEntityNumber(…, "facebookPost")` in `createFacebookPost` — the one writer, so not ADR-0062's
  trigger — unique per collection and never reused (the integration test dissolves the **newest** post
  so a `max + 1` would fail it; checked when written). The migration numbered existing posts oldest
  first. The screen is `/c/[slug]/offers/posts/[postNo]` (`findFacebookPostId` resolves the number;
  the static `posts` segment shadows no offer id), drawn by `facebook-post-panel.tsx` off
  `getFacebookPostScreen` (`facebook-posts.ts`: the kit read once off the first lot, the platform for
  *Sell*, and each lot's sales from `SaleLine.offerId`) through `GET …/facebook-posts/[postId]`, under
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

- **A list of every multi-lot post** (#1850, decided with the collector on 2026-10-12): the sidebar's
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
  filter's options are the groups holding posts (`listFacebookPostGroups`). Only multi-lot posts are
  listed — an offer posted alone has no row (ADR-0061 §2).

- **The post's screen shows every photo the post puts up** (#1848, decided with the collector on
  2026-10-12), so posting needs no lot opened. In `FacebookPostKit`, a grid across the card's width
  (`PHOTO_GRID`, 18rem photos drawn from the `full` variant — the 320px thumb is too small to tell
  stamps apart): captioned, each lot's one photo with its caption and *Copy* under it; as text
  (`TextLayoutPhotos`), every lot's upload set in lot order without captions. The text layout reads
  each lot's photo plan client-side through `useOfferPhotoPlans` (`useQueries` under each offer's own
  `offerKeys.photoPlan`, shared with the lot's Photos card) and keeps what `facebookLotUploadPhotos`
  (pure, `facebook-post-rules.ts`: publish and not over the limit — `readOfferUploadSet`'s filter)
  keeps; a click downloads a photo as `facebookLotPhotoFileName` names it, which
  `buildFacebookPostPhotoArchive` now uses too, so the one file and the ZIP's agree. A lot with nothing
  to put up is named with a link to its offer. `FacebookOfferKit.collectionId` is what the photos are
  read through. An offer posted alone keeps its kit as it was: text and ZIP only.

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
  collector's rule for every template that generates text; the card's own *Highest bid* keeps two; the retired `{catalog}` is every copy's leading number through
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
  instead of `resolvePurchaseContact`. Both go through `findFacebookBuyer`: by `facebookProfileUrl`
  first, then by name (case-insensitive, any role); a name match carrying a **different** link is
  refused as somebody else, since `Contact.name` is unique. A found contact gets the buyer role and,
  where it has none, the link; otherwise a buyer is created with both — a link alone that matches
  nobody is refused, a contact needing a name, and nothing typed is no buyer. It refuses a platform
  that is not Facebook's. `createSaleAction` checks the collection before that write, since
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

- **Where it is seen.** Settings → Facebook (`facebook-settings-page.tsx`): the platform choice in the
  header (`MarketplacePlatformSelect`, *Facebook platform*), then list beside detail (#1471) with no
  tabs and no summary strip. The list's first row is **Facebook defaults** (`DEFAULTS_ROW`, the
  page's default selection), then the groups; a group's pane shows each setting as *Same as Facebook*
  with its value, or with its field once *Custom for this group* — a checkbox named `custom` carrying
  the key, so the pane's unsaved measure sees it. Archive/Restore is the detail
  pane's header action; Delete is disabled with its reason while offers name the group. The user guide
  is `docs/user-guide/facebook.md`.
  The panes group the settings as the collector asked (#1671): *Every offer* (type, currency, mixing),
  the note, *New auctions* (auction template and figures), *Quick buys* (its template), then
  *Posts of several lots* (layout, captioned post text) beside *Captions* (#1841).
  An offer is the offer form (group, the listing type seeded from it until touched, and an auction's
  increment, shown only on the Facebook platform, the group locked on a lot of a post), the
  **Facebook** card on the offer's screen, directly under the description like every platform's card
  (#1667: the post text is read and copied right after it) (`offer-facebook-card.tsx`, with a **Bidding** part while an
  auction is up — and nothing of its own for a quick buy, which is sold and withdrawn from the offer's
  actions (#1777)), and **Post together** in the offers list's
  selection bar, offered while every ticked offer in view is a Facebook offer and numbering the lots
  in tick order; its toast links to the new post's screen (#1842).
