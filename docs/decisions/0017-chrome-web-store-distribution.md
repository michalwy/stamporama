# ADR-0017: Distributing the Stamporama Assistant Through an Unlisted Chrome Web Store Listing

## Status

Accepted. Supersedes [ADR-0016](0016-self-hosted-extension-distribution.md).

## Context

ADR-0016 had the instance serve a signed CRX and an Omaha update manifest, with each machine
force-installing it through an `ExtensionInstallForcelist` policy entry. The policy reached Chrome
exactly as designed — and Chrome refused it:

```
Value    ["[BLOCKED]afaeadeheelibafbmhobdnkblmbckehn;https://<instance>/assistant/update.xml"]
Error    Error at ExtensionInstallForcelist[0]: Invalid extension ID.
Warning  This computer is not detected as enterprise managed so policy can only automatically
         install extensions hosted on the Chrome Webstore.
```

Force-installing from a non-store update URL requires the machine to be **enterprise managed** —
MDM-enrolled, or enrolled in Chrome Browser Cloud Management. Installing a configuration profile by
hand delivers policy but does not make a Mac managed, and the `defaults write` route documented
first does not even reach Chrome: mandatory policy is read from `/Library/Managed Preferences`,
which only an MDM or a profile creates.

That leaves three ways out: enrol the browser in Chrome Browser Cloud Management (free, but routes
management through a Google admin console and needs a verified domain), publish to the store, or
stay on unpacked loads forever with no auto-update. The store was already named as the fallback in
#254.

## Decision

**Publish to an unlisted Chrome Web Store listing.** It installs from a link, updates itself from
the store, and needs no policy, no profile and no MDM on any machine — which is the entire problem
ADR-0016 was trying to solve.

**The store owns the released identity.** It assigns the extension ID and signs the package, so the
RSA signing key, the hand-written CRX3 container and the pinned release ID all retire. What remains
of the packaging code is the deterministic ZIP writer (`extension/archive.mjs`) and the version
stamp — a store upload is an ordinary ZIP.

**The dev/release split from ADR-0016 stays, and matters more than before.** `manifest.json` carries
no `key`; `build.mjs` stamps in a committed public-only dev key with a ` (dev)` suffix and amber
icons, and `build.mjs --release` leaves the manifest bare for the store to identify. The unpacked
dev build and the store build therefore remain two extensions with two IDs, installable side by
side, with separate `chrome.storage.local` — a dev profile cannot reach a production collection.
An uploaded package must *not* carry `key`, which the release flavour satisfies by construction.
The **mark the extension draws inside somebody else's page** (#417, #466) follows the same split: it
is picked off a `__DEV_BUILD__` define in `core/mark.ts`, so a link an unpacked build writes into a
Colnect note or an Allegro row is amber like its toolbar. The colour is how a collector running both
copies knows which extension is telling them something, and it is worth nothing if only the toolbar
wears it.

**CI publishes on release tags.** `publish-extension` builds the ZIP with the release version
stamped in, exchanges the refresh token for an access token, then calls `:upload` and `:publish` on
`chromewebstore.googleapis.com/v2` with plain `curl`. Credentials are repository secrets
(`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`) plus two variables
(`CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`).

**Nothing is served by the instance any more.** `/assistant/update.xml`, the CRX in
`public/assistant/`, its baking into the image and the per-OS policy documentation are all removed.

## Consequences

- The extension's code goes to Google and each version passes store review. Review is asynchronous:
  the release job succeeds when the version is *submitted*, not when it is live.
- The first submission cannot be automated. The item, its store listing, its Privacy tab and its
  unlisted visibility are created by hand, and publishing thereafter keeps whatever visibility is
  configured there.
- The OAuth consent screen must be pushed to production. Left in *Testing*, the refresh token
  expires every 7 days and the release job starts failing for reasons unrelated to the release.
- Upgrading Stamporama no longer upgrades the extension — the two version lines are independent
  again in practice, even though the packaged version still mirrors the app's.
- Unlisted means the listing is not searchable but anyone with the link can install it. The
  Assistant is useless without an instance and a token, so this is acceptable; a private listing
  restricted to specific accounts is the tighter option if that ever changes.
