# Stamporama Assistant (browser extension)

Platform-neutral MV3 extension shell (#253, part of #155). It matches marketplace catalog pages
against a Stamporama collection via the Colnect matcher endpoints (#250). Colnect DOM extraction is a
pluggable **platform module** added separately (#249); connection profiles (#251) say which instance
and collection a match is written to, and an instance registers itself into one (#252).

## Build

```bash
cd extension
pnpm install        # first time (from the repo root works too)
pnpm build          # → extension/dist
pnpm dev            # rebuild on change
pnpm typecheck
pnpm test
```

## Load unpacked (Chrome)

1. `pnpm build`.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, choose
   `extension/dist`.
3. In Stamporama: **Settings → Assistant → Connect Stamporama Assistant**.
4. With that page still in front, click the extension's toolbar icon. That is the whole setup —
   the profile appears in **Options**, active, with nothing typed.

Adding a profile by hand (Options → *Add profile*: instance URL, collection id, token from
**Settings → Assistant → Generate token by hand**) still works, for a browser or a script that cannot
register.

## Connection profiles (#251)

A **profile** is one instance plus one collection — `{ name, apiBaseUrl, collectionId,
collectionName, token }`. A dev server and the Raspberry Pi are separate profiles, and so are two
collections on the same instance. Only the **active** profile is ever contacted, and its
`apiBaseUrl` + token are what every request uses.

The target is never inferred: both instances are driven from the same browser on the same
`colnect.com` origin, so it has to be an explicit choice. That choice is:

- **persisted** in `chrome.storage.local` (the list under `profiles`, the choice under
  `activeProfileId`; #253's single-profile key is migrated on first read),
- **switchable from both surfaces** — Options creates, edits and deletes profiles; the Assistant
  window has a selector in its header, because that is where picking the wrong target costs
  something,
- **always visible** as the badge at the top of the Assistant window, and named again in every write
  confirm.

Each profile carries a **colour derived from its target** (`apiBaseUrl` + collection, hashed, then
de-collided across the stored set) rather than a configured one: the Raspberry Pi always looks the
same, no two profiles look alike, and renaming a profile doesn't change how it looks. Two profiles
pointing at the same instance *and* collection are rejected — they would be indistinguishable in the
badge, which is the confusion profiles exist to prevent.

Switching profile is a real re-point: the results on screen, the cached stamp photos, and the
background's per-tab match cache all belong to the instance being left, so they are dropped and the
page is matched again against the new target.

## Registration (#252)

A profile is normally not typed in at all: the instance registers itself.

**Settings → Assistant** in Stamporama mints a short-lived, single-use code and exposes it, with the
instance's own origin and the current collection, as JSON in a hidden element
(`#stamporama-assistant-registration`). Clicking the toolbar icon on that page reads the payload,
`POST`s the code to `/api/assistant/register`, and stores the token it gets back as a profile — made
active, because registering is an explicit "talk to this one".

Three properties are the point:

- **Nothing is typed.** The `apiBaseUrl` is the origin that served the payload, so it cannot be wrong,
  and dev vs production separates itself: you register from each instance.
- **The long-lived token is never on the page** — only the one-time code is, for minutes, and it is
  redeemed server-side. Tokens are revocable per registration from the same screen.
- **The icon click is what grants access.** `activeTab` lets us read a page on an origin the
  extension does not otherwise script, so no instance origin has to be declared up front. (The
  redemption `fetch` runs in the background worker, CORS-exempt under the manifest's
  `host_permissions`.)

The extension reports the outcome by setting `data-registration-state` / `-message` on the payload
element, which the page renders as a success or error line — attributes rather than an event, because
the extension's world is isolated and the page owns that node.

Registering a target the extension **already has updates that profile in place**: same id, same name
if you renamed it, fresh token. That is deliberate — two profiles with one target are rejected
anyway, and re-registering is how a revoked or lost token is meant to be replaced.

## The flow

On a Colnect stamp **list** page (a country/year list — cards are `div.pl-it`) the toolbar icon
carries a **badge counting the stamps that need action** — `auto` matches waiting to be written plus
the ones needing a decision. Amber means something needs deciding, green means everything is
unambiguous, and no badge means there is nothing to do on this page.

Producing that count matches the page against your instance as it loads (read-only — a dry-run never
writes). Turn **Match pages as they load** off in Options to keep the extension silent until you open
the window; the badge then just counts the stamps found on the page, in blue. Blue is also the
fallback when the instance can't be reached, so a missing badge never quietly means "offline".

Clicking the icon opens the Assistant as a **centred window** (920×760) rather than a toolbar popup —
a popup is capped at 800×600 and anchored to the icon, too cramped to compare an item against
candidate stamps. On a wide window each row shows the Colnect item and the stamp it resolved to
**side by side**. Clicking the icon again re-points and reloads the same window instead of opening a
second one — that click *is* the refresh gesture, so there is no rescan/re-match button.

The window reuses the load-time match when it is still current, so it opens instantly; otherwise it
extracts the page and **matches it** as a **dry-run** (sent in chunks,
with a progress bar) — so you land directly on the decisions. That call only reads: nothing is
written until you confirm. **Re-match** re-runs it; **Rescan** re-reads the page and matches again
after you navigate.

Both sides of a row use the **same layout** — label, then picture plus name / secondary line /
catalog numbers — so the Colnect item and your stamp can be read across, line against line, with the
two pictures meeting in the middle.

The Colnect catalog numbers are **marked by what each one means** for you: green = matched your
stamp (the evidence the match was made on), blue = you keep that catalog but your stamp has no number
for it (Colnect knows something you don't — the backfill of #280), red = your stamp has a different
number there, grey = a catalog you don't keep. A colour key sits above the results.

Each row also shows a **picture on both sides** (#282): the Colnect thumbnail and the stamp's own
photo from your collection. The Colnect one is captured from the already-rendered image in the page
(canvas → `data:` URL) rather than hotlinked, since the extension page is a different origin; the
Stamporama one is fetched with the Assistant token and shown via an object URL, because an
`<img src>` cannot carry an auth header. Either side simply shows nothing when there is no image (or
when Colnect serves its thumbnails from a CORS-less CDN, which taints the capture canvas).

Each item shows its Colnect side (name, item-ID, catalog codes) next to
the stamp it resolved to in your collection (name, year, area, catalog numbers). Results are grouped
so only what matters stays open:

- **Needs your decision** — ambiguous or conflicting, pick a stamp.
- **Will link automatically** — unambiguous, ready to write.
- **Already linked** / **Skipped** — folded away (click to expand).

Then **Write auto-matches** commits the unambiguous ones, and **Use this** commits a specific
candidate; each is gated by an in-popup confirm naming the active profile and instance URL (a native
`confirm()` is avoided — it can dismiss an MV3 popup). Written items move to *Already linked*
immediately. **Rescan** re-reads the page after you navigate.

## Layout

- `src/platform/` — the `PlatformModule` interface + registry; `colnect/` is the first module (#249),
  registered by the content bootstrap. It reads two page shapes: catalog **list** pages (`div.pl-it`
  cards) and a **single stamp's** page, where the minor-variant rows carry catalog codes in the same
  abbreviated form. The main stamp on that page is skipped — its codes are printed with full catalog
  names, which the abbreviation mapping (#248) can't key off.
- `src/core/` — profile store + colour derivation (#251), the registration payload contract (#252),
  decision types, message contracts.
- `src/background/` — service worker + instance HTTP client (bearer-token, CORS-free background
  fetch) + the registration exchange (#252).
- `src/content/` — extractor bootstrap: runs declaratively on `colnect.com` (for the badge) and is
  also injected on demand by the popup (covers tabs already open before an extension reload).
- `src/popup/`, `src/options/` — the generic flow UI (with the target badge + profile selector) and
  the profile manager.

## Boundaries

Colnect DOM specifics (#249) and packaging/distribution (#254) are intentionally out of scope here.
