# Stamporama Assistant (browser extension)

Platform-neutral MV3 extension shell (#253, part of #155). It matches marketplace catalog pages
against a Stamporama collection via the Colnect matcher endpoints (#250). Colnect DOM extraction is a
pluggable **platform module** added separately (#249); connection profiles (#251) say which instance
and collection a match is written to, and an instance registers itself into one (#252).

## Build

```bash
cd extension
pnpm install        # first time (from the repo root works too)
pnpm build          # → extension/dist (dev flavour — see below)
pnpm dev            # rebuild on change
pnpm typecheck
pnpm test
```

`node build.mjs --release` produces the flavour that goes to the store, into **`dist-release/`** — the two
flavours never share an output directory, so `dist/` is always the dev build and "Load unpacked"
cannot silently pick up a release build left behind by packaging. `pnpm pack:store` runs both steps.
The amber dev icons are generated once, from the release ones, by
`node extension/scripts/make-dev-icons.mjs` (run from the repo root — it borrows the app's `sharp`)
and are committed; regenerate them only if the real icons change.

## Two builds, two extensions

The unpacked dev build and the released build are **separate extensions**, on purpose (#254, #288):

| | Unpacked (`pnpm build`) | Released (`pnpm pack:store`) |
|---|---|---|
| Name | Stamporama Assistant (dev) | Stamporama Assistant |
| Icon | amber | blue |
| Extension ID | `idmgaeimkafaifpfbjonmjdfbmgffcbh` | `lhbaflbkfgahmcbgmlibleedmfcdjedf` (assigned by the store) |
| Identity from | `DEV_KEY` in `identity.mjs` | the store |

So you can run both in one browser: the amber one pointed at a dev instance, the blue one installed
from the store and pointed at the production collection. They cannot collide (Chrome refuses two
extensions with one ID) and cannot leak into each other — profiles and tokens live in per-extension
`chrome.storage.local`, so a dev profile is invisible to the released build.

`manifest.json` itself carries no `key` and no suffix; the dev flavour stamps its own in
(`build.mjs`), and the release flavour leaves the field empty because an uploaded package must not
claim an identity the store is about to assign. Nothing signs with the dev key — only its public
half exists, committed so every machine's unpacked build is the same extension.

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

Unpacked is the **development** path, and stays available alongside the store build — see *Two
builds, two extensions* above. For daily use, install from the store listing — below.

## Install for daily use (#288)

The Assistant is published as an **unlisted Chrome Web Store listing**: not searchable, installed
from a link, updated by the store.

<https://chromewebstore.google.com/detail/lhbaflbkfgahmcbgmlibleedmfcdjedf>

Click **Add to Chrome**, then connect it —
**Settings → Assistant → Connect Stamporama Assistant** in Stamporama, and click the toolbar icon
with that page in front.

There is no policy, profile or MDM anywhere in this, and nothing to set up per machine. Chrome
handles updates on its own.

> Self-hosting the extension was tried first (#254) and does not work: Chrome only force-installs
> from a non-store update URL on an enterprise-managed machine. See ADR-0017.

## Packaging (#288)

```bash
cd extension
pnpm pack:store --version 0.28.0   # → extension/dist-store/stamporama-assistant.zip
```

…or `pnpm assistant:zip --version 0.28.0` from the repo root. The version is stamped into the
archived manifest only; `manifest.json` in the repo keeps its placeholder, because the published
version always mirrors the app release — and the store rejects an upload whose version did not
increase. Omitting `--version` produces `0.0.0`.

The archive is written by hand (`archive.mjs` — a deterministic ZIP writer; `pack.mjs` — the CLI),
with no dependencies and no signing: the store signs. `pnpm test` reads the bytes back out of an
archive and pins the dev build's ID.

### Publishing

CI publishes on release tags — the `publish-extension` job builds the ZIP, exchanges the refresh
token for an access token, and calls `:upload` then `:publish` on `chromewebstore.googleapis.com`.
It needs repository **secrets** `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and
repository **variables** `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`.

Three things have to be done by hand first, because the API can only update an item that exists:

1. **Create the listing.** Chrome Web Store developer account (one-off 5 USD) → new item → upload
   `dist-store/stamporama-assistant.zip` → fill the *Store listing* and *Privacy* tabs → set
   visibility to **Unlisted** → publish once. Both ids are then in the dashboard URL,
   `…/devconsole/<CWS_PUBLISHER_ID>/<CWS_EXTENSION_ID>/edit` — read them there rather than from
   *Account settings*, whose publisher id differs when the item belongs to a publisher group and
   would 404 the upload.
2. **Enable the API.** A Google Cloud project with the Chrome Web Store API enabled and an OAuth
   client (desktop app) for the same account that owns the listing.
3. **Mint a refresh token** once, interactively:

   ```bash
   CWS_CLIENT_ID='…' CWS_CLIENT_SECRET='…' node extension/scripts/cws-refresh-token.mjs
   ```

   It opens a one-shot loopback listener, prints the URL to approve, and exchanges the code Google
   redirects back with — the copy-the-code-from-the-page flow was removed in 2022, so a desktop
   client has no simpler route. The token is printed and never written to disk. **Push the OAuth
   consent screen to production** — left in *Testing* it expires every 7 days, and releases start
   failing for reasons that have nothing to do with the release.

Publishing keeps whatever visibility the dashboard has; changing visibility there means publishing
once by hand again. Every version goes through review, so a green job means *submitted*, not live.

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

Colnect DOM specifics live in `src/platform/colnect/` (#249). Packaging and distribution (#288) are
`archive.mjs` / `pack.mjs` plus the `publish-extension` CI job — see ADR-0017.
