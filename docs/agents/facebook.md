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

- **A group's settings are defaults, every one optional** (ADR-0061 §6). The post template with its
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

- **`Offer.facebookGroupId` exists before its writer.** #1543 added it so the delete rule is real;
  #1544 creates the offers that set it. A group's own currency against the platform-currency lock
  (#196) is #1544's to settle.

- **Where it is seen.** Settings → Facebook (`facebook-settings-page.tsx`): the platform choice in the
  header (`MarketplacePlatformSelect`, *Facebook platform*), then list beside detail (#1471) with no
  tabs and no summary strip — the groups are the one thing configured. Archive/Restore is the detail
  pane's header action; Delete is disabled with its reason while offers name the group. The user guide
  is `docs/user-guide/facebook.md`.
