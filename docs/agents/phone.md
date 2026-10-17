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
