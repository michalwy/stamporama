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

`node build.mjs --release` produces the flavour that gets signed, into **`dist-release/`** — the two
flavours never share an output directory, so `dist/` is always the dev build and "Load unpacked"
cannot silently pick up a release build left behind by packaging. `pnpm pack:crx` runs both steps.
The amber dev icons are generated once, from the release ones, by
`node extension/scripts/make-dev-icons.mjs` (run from the repo root — it borrows the app's `sharp`)
and are committed; regenerate them only if the real icons change.

## Two builds, two extensions

The unpacked dev build and the released build are **separate extensions**, on purpose (#254):

| | Unpacked (`pnpm build`) | Released (`pnpm pack:crx`) |
|---|---|---|
| Name | Stamporama Assistant (dev) | Stamporama Assistant |
| Icon | amber | blue |
| Extension ID | `idmgaeimkafaifpfbjonmjdfbmgffcbh` | `afaeadeheelibafbmhobdnkblmbckehn` |
| Identity from | `DEV_KEY` in `identity.mjs` | the signature (`keys/assistant.pem`) |

So you can run both in one browser: the amber one pointed at a dev instance, the blue one
force-installed from your Pi and pointed at the production collection. They cannot collide (Chrome
refuses two extensions with one ID) and cannot leak into each other — profiles and tokens live in
per-extension `chrome.storage.local`, so a dev profile is invisible to the released build.

`manifest.json` itself carries no `key` and no suffix; each flavour stamps its own in
(`build.mjs`, `pack.mjs`). Nothing signs with the dev key — only its public half exists, committed
so every machine's unpacked build is the same extension.

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

Unpacked is the **development** path, and stays available alongside the installed one — see *Two
builds, two extensions* above. For daily use, install from your own instance — below.

## Install for daily use (#254)

Chrome no longer installs a loose `.crx`, so a non-store extension arrives through **enterprise
policy**. Your Stamporama instance is the distribution channel: release images ship a signed CRX and
an update manifest, and one policy entry per machine points Chrome at them. Auto-update then comes
for free — `docker compose pull && up -d` on the instance is what ships a new extension version
(ADR-0016).

Two constants:

| | |
|---|---|
| Extension ID | `afaeadeheelibafbmhobdnkblmbckehn` |
| Update URL | `https://<your-instance>/assistant/update.xml` |

This is the *released* extension's ID, fixed by the signing key. A dev build loaded unpacked has a
different one and installs alongside it. Check the instance serves the pair first:

```bash
curl https://<your-instance>/assistant/update.xml
```

A 404 means this instance has no packaged extension (a source or dev build) — use unpacked there.

Then add the policy, as `<extension id>;<update url>`:

**macOS** — a **configuration profile**, not `defaults`. Chrome reads mandatory policy from
`/Library/Managed Preferences`, which only a profile or an MDM creates; writing there by hand does
nothing on a machine that was never enrolled (the directory does not even exist).

Copy `policy/stamporama-assistant.mobileconfig.example`, put your instance URL in it, give both
`PayloadUUID`s fresh values from `uuidgen`, then:

```bash
plutil -lint stamporama-assistant.mobileconfig   # catch typos before macOS does
open stamporama-assistant.mobileconfig
```

Approve it under **System Settings → General → Device Management** — since Ventura a manually
downloaded profile installs only after that confirmation. Removing the profile there uninstalls the
extension.

**Windows** (elevated prompt)

```bat
reg add "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "afaeadeheelibafbmhobdnkblmbckehn;https://<your-instance>/assistant/update.xml" /f
```

**Linux** — write `/etc/opt/chrome/policies/managed/stamporama-assistant.json` (Chromium:
`/etc/chromium/policies/managed/`):

```json
{
  "ExtensionInstallForcelist": [
    "afaeadeheelibafbmhobdnkblmbckehn;https://<your-instance>/assistant/update.xml"
  ]
}
```

Restart Chrome, open `chrome://policy` → **Reload policies**, and confirm the entry is listed and
its status is OK. The Assistant then appears in `chrome://extensions` as installed by policy — the
user cannot disable or remove it, which is the trade for auto-update without a store. Finish with
the normal one-click registration: **Settings → Assistant → Connect Stamporama Assistant**, then
click the toolbar icon.

Remove it by deleting the same policy value (`sudo defaults delete …`, `reg delete …`, or removing
the JSON file) and reloading policies.

## Packaging (#254)

```bash
cd extension
pnpm pack:crx --key keys/assistant.pem --version 0.28.0   # → extension/dist-crx/
```

…or, from the repo root, straight into what the app serves:

```bash
pnpm assistant:pack --key keys/assistant.pem --version 0.28.0   # → public/assistant/
```

Both write `stamporama-assistant.crx` and `crx-metadata.json` (id, version, size, sha256 — the
metadata `/assistant/update.xml` reports to Chrome). The version is stamped into the archived
manifest only; `manifest.json` in the repo keeps its placeholder, because the shipped version always
mirrors the app release. Omitting `--version` produces `0.0.0`.

Packaging is hand-written and dependency-free (`crx.mjs` — a deterministic ZIP writer plus the CRX3
protobuf header; `pack.mjs` — the CLI). `pnpm test` checks the container against the format's rules,
including that the extension ID still matches the key in `manifest.json`.

### Signing key

The private key is **not** in the repository. It lives in `extension/keys/assistant.pem` (gitignored)
and, for CI, in the `ASSISTANT_CRX_KEY` repository secret as a base64-encoded PEM:

```bash
base64 -i extension/keys/assistant.pem | gh secret set ASSISTANT_CRX_KEY
```

Back it up. Losing it means no further updates for the installed extension ID — only a fresh install
under a new one, with every machine's policy entry to redo. Rotating it has the same effect, which
is why `crx.test.ts` asserts the ID whenever the key file is present: changing the key fails the
tests until the ID is updated in `identity.mjs`, here, and in the ADR.

Releases pack automatically: the `package-extension` CI job signs the CRX for a `v*` tag and both
image builds bake it into `public/assistant/`. Without the secret set, the release build fails
loudly rather than shipping an image with no extension.

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

Colnect DOM specifics live in `src/platform/colnect/` (#249). Packaging and distribution
(#254) are `crx.mjs` / `pack.mjs` plus the app's `/assistant/update.xml` route — see ADR-0016.
