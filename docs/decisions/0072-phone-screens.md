# ADR-0072: Stamporama on a Phone — a Separate Set of Phone Screens in the Same Web App

## Status

Accepted. Decided with the collector in #2000 on 2026-10-17. **Narrows the product rule "Desktop
browsers only; no mobile layouts or breakpoints"** (`AGENTS.md`, *Product Context*), which until now
stood with no ADR behind it. Built by #2002–#2011.

## Context

Stamporama was used only at a desk. The collector needs it in hand away from the desk for two things:

- **Browsing on the go** — at a stamp fair or a dealer's table: do I already have this stamp, how many
  copies, is it on my wants, what is it worth.
- **Handling sales** — the moves on offers and sales that come up during the day.

Two facts were settled before the session: **the phone always works online**, against the collector's
own server, and taking photos with the phone's camera and the whole app on the phone are not the first
step. No screen had a breakpoint, a viewport setting, a manifest or a service worker.

## Decision

### 1. Mobile web, not an Android app

The phone uses the same Next.js app in its browser. Being online always removes the one thing a
native app would have bought — working without a connection — and what is left favours the web: the
same sign-in (Better Auth, email and password, the 400-day session of ADR-0052), the same server
actions and domain rules, nothing to sign or install. A native app would have talked to `/api/v1`
with a token, and the moves it needs are deliberately absent there — no sale status, no shipment, no
offer state change, no bid recording (ADR-0050) — so it would have meant growing the agent API for
a client that is not an agent. *Rejected:* an Android app.

The site carries a web app manifest so it can be added to the phone's home screen as an icon. **No
offline mode and no service worker cache**: a page the phone cannot reach the server for says so.

### 2. A separate, reduced set of phone screens, not the existing screens made to fit

Phone screens are **their own pages under `/c/[collectionSlug]/phone/…`**, with `/phone` as the start
that goes into the collector's collection (or offers the list when there are several). They are drawn
at phone width, without the desktop sidebar, for a thumb, and they reuse the domain logic and the
server actions the desk uses — never a second copy of a rule. A phone screen is **phone-only**: it has
no desktop layout, and no desktop screen gains a phone layout. *Rejected:* making the existing
screens responsive — every screen is built on full window width (#1851) with no breakpoint anywhere,
so fitting them would touch nearly every component for screens the phone does not need.

### 3. Getting there: an icon and a link, no redirect

The home-screen icon opens `/phone`. Every phone screen links to the full app and the full app links
to `/phone`. **There is no automatic redirect by device**: it guesses, and guesses wrong for a tablet
or a narrow desktop window. A desktop page opened on a phone simply renders as it does today.

### 4. Reaching the server is the installation's job

The app adds nothing for access from outside home. The installation gives the server **one HTTPS
address, the same on the desk and on the phone** — a session ends on a move to another address or
between http and https (`docs/user-guide/authentication.md`). The collector already has one; the user
guide's phone page states the requirement.

### 5. The first step

**Browsing on the go — read only, with one write:**

- **#2003** — the phone stamp screen: picture, copies (condition, location, disposition), wants and
  what satisfies them, market and catalogue value, on one screen.
- **#2004** — finding a stamp by typing: catalogue number, name or stamp number, on the existing
  collection search; each hit says at a glance whether copies are held and whether it is wanted.
- **#2005** — browsing area → year → issue → stamp.
- **#2006** — starting a purchase on the phone: seller, amount, date, optionally the stamps bought
  and a description. No copies, no cost split. At the desk it is an ordinary purchase marked
  *started on the phone — to complete*, listed on the Dashboard's *Incoming purchases* until the
  collector marks it complete.
- **#2011** — photos on a purchase, taken with the phone's camera so a stockbook or a set can be told
  apart at the desk; the desk shows, adds and removes them. Raised by the collector during the
  session: **the one use of the phone's camera in the first step**.

**Handling sales:**

- **#2007** — sales to do: awaiting payment, to pack, to send; marking paid, packed and sent with
  carrier and tracking code.
- **#2008** — offers: a phone list and offer screen; pause, resume, withdraw.
- **#2009** — selling an offer to a buyer at a price.
- **#2010** — a Facebook group auction: recording the current bid, and closing by selling to the
  winner or withdrawing.

**#2002** is the shell all of them stand on: the path, the manifest and icon, the phone frame, the
links both ways and a sign-in screen usable at phone width.

**Stays at the desk:** preparing, editing and publishing offers; intake, lots and the cost split;
everything not listed above. **Rejected for now:** recognising a stamp from a photo (2026-10-17) — it
comes back only if the collector raises it.

## Consequences

- The product rule becomes: **desktop browsers only, no mobile layouts or breakpoints — except the
  phone screens under `/c/[collectionSlug]/phone/`, which are phone-only.** `AGENTS.md`, the product
  brief and the architecture overview say so, and `docs/agents/phone.md` carries the detail.
- The screen-frame rule (`Screen`, `SCREEN_CAPS`, #1851) keeps applying to every non-phone screen;
  phone pages are drawn in a phone frame of their own, and #2002 teaches the screen-frame test the
  difference.
- The agent API stays as ADR-0050 left it: the phone is not an API client.
- A phone screen added later is a decision of its own, named in `docs/agents/phone.md`, not a
  breakpoint added to a desktop screen.
