# ADR-0016: Self-Hosted Distribution of the Stamporama Assistant

## Status

Accepted

## Context

The Assistant extension (ADR-0015, #253) has so far only ever been **loaded unpacked** from
`extension/dist`. That is fine while developing it and unacceptable as the way a collector runs it:
an unpacked extension is re-loaded by hand after every change, warns on every browser start, and can
be silently disabled by Chrome.

Chrome will not install a loose `.crx` by drag-and-drop or from a download any more — a
non-store extension has to arrive through **enterprise policy**. That leaves three ways to ship it
(#254):

1. **Chrome Web Store, unlisted.** Auto-update, no policy setup. Costs a Google developer account,
   review latency on every release, and the code goes to Google.
2. **Self-hosted force-install.** Stamporama serves the packaged CRX plus an Omaha update manifest;
   each machine gets one Chrome policy entry (`ExtensionInstallForcelist`) pointing at that update
   URL. Auto-update works, nothing leaves the self-hosted box, and the setup cost is one-time per
   machine.
3. **Unpacked forever.** No packaging work, but the daily-use problems above.

Stamporama is self-hosted on the owner's hardware and its release pipeline already builds and
publishes a multi-arch image per tag. Option 2 matches that shape; option 1 stays as the fallback if
per-OS policy turns out to be too painful.

## Decision

**The instance is the extension's distribution channel.** Chrome policy force-installs the Assistant
from the collector's own Stamporama.

**Dev and release are two extensions, not one** (`extension/identity.mjs`). The obvious design —
one committed key, one ID for both flavours — makes them mutually exclusive: Chrome refuses to load
an unpacked extension whose ID a policy already installed. That is exactly the setup the extension
exists for, though. Development happens against a local instance while the same browser is used
for real work against the production collection on the Pi, so both have to be installed at once,
and the dev build must not be able to touch production data.

So each flavour has its own identity, and `manifest.json` claims neither:

- **Released** — ID `afaeadeheelibafbmhobdnkblmbckehn`, from the RSA-2048 signing key. A CRX's ID is
  the hash of the key that signed it; `pack.mjs` also writes that public key into the archived
  manifest, derived from the private key so the two can never disagree. The private key is never
  committed — `extension/keys/` locally, the `ASSISTANT_CRX_KEY` secret in CI.
- **Unpacked dev** — ID `idmgaeimkafaifpfbjonmjdfbmgffcbh`, from a second, *public-only* key
  committed in `identity.mjs`. An unpacked build has no signature to derive an ID from, so it needs
  `key` in its manifest; nothing ever signs with this one, so there is no dev private key to
  generate, guard, or lose. `build.mjs` adds it along with a ` (dev)` name suffix and amber icons —
  two identical toolbar icons, one wired to production, is a footgun worth a colour.

The flavours also get separate output directories (`dist/` and `dist-release/`). Sharing one meant
packaging left a release build sitting in `dist/`, and the next "Load unpacked" installed the blue,
keyless extension without a word — the failure was silent and looked like the icon change simply
not working.

The isolation follows for free: `chrome.storage.local` is per extension, so connection profiles and
Assistant tokens created in the dev build are invisible to the released one, and neither can write
to the other's instance by accident.

**Packaging is hand-written and dependency-free** (`extension/crx.mjs`, `extension/pack.mjs`). A CRX
is a short protobuf header plus a ZIP; both are ~150 lines of well-specified format, written here
rather than pulling in a packaging library, in keeping with the plain-esbuild choice of ADR-0015.
The ZIP is deterministic (fixed timestamps, sorted entries), so an unchanged build produces
byte-identical output. `extension/crx.test.ts` verifies the container against the format's own
rules, because a malformed CRX otherwise fails late and opaquely — at install time, on someone
else's machine.

**The packaged version mirrors the app version.** `pack.mjs` stamps `STAMPORAMA_VERSION` into the
archived manifest. Upgrading the instance is therefore what makes Chrome see a newer extension;
there is no second version line to remember to bump, and no release can ship an extension change
Chrome ignores.

**CI packs once per release tag and bakes the result into the image.** A `package-extension` job
signs the CRX and hands it to both architecture builds as an artifact, which land in
`public/assistant/` before the Docker build — so the signing key never enters an image layer and
both architectures ship identical extension bytes. `docker compose pull && up -d` is the whole
upgrade path: the new image serves a new extension version, and every force-installed browser picks
it up on its next update check.

**The update URL is the policy's, not the manifest's.** `manifest.json` deliberately carries no
`update_url`. The policy entry is `<extension id>;https://<instance>/assistant/update.xml`, so one
CRX works for any instance origin — a dev box and the Raspberry Pi install the same bytes and each
updates from itself. `GET /assistant/update.xml` renders the Omaha response from
`public/assistant/crx-metadata.json`, deriving the absolute `codebase` URL from the request (proxy
headers first), and is unauthenticated because Chrome fetches it without cookies.

## Consequences

- Source builds and dev instances ship no CRX; `/assistant/update.xml` answers 404 with an
  explanation, and unpacked stays the documented dev path.
- Rotating the signing key changes the extension ID, which invalidates every machine's policy entry.
  Both IDs are asserted in `crx.test.ts` (the release one only where the key file exists — CI gets
  it as a secret for tags only) and documented in `extension/README.md`, so a rotation cannot pass
  unnoticed.
- Both extensions run their content script on Colnect at once, so a Colnect page is matched twice —
  against the dev instance and against production. That is the point (the dev build is there to be
  exercised), but it doubles the requests; turning **Match pages as they load** off in the dev
  build's options keeps it quiet until its window is opened.
- Losing the private key means the same: no further updates for the installed ID, only a fresh
  install under a new one. It is a backup-worthy secret.
- Releasing without `ASSISTANT_CRX_KEY` set fails the release build on purpose — an image that
  quietly shipped no extension would look like a broken auto-update to every browser polling it.
- Chrome policy is per machine and per OS. That one-time setup is documented in
  `extension/README.md`; if it proves too painful in practice, the unlisted Web Store remains the
  fallback and the extension ID is the only thing that would change.
