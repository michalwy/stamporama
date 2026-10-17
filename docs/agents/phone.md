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
  `PHONE_ENTRIES` (`phone/phone-entries.ts`), **empty until the first phone screen lands** — each
  screen in the table below adds its own row. *Other collections* shows only when there are several.
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
