# Stamporama Assistant — Privacy Policy

_Last updated: 2026-07-25_

The Stamporama Assistant is a browser extension for [Stamporama](https://github.com/michalwy/stamporama),
a self-hosted stamp collection manager. It matches catalog pages on Colnect against the stamps in a
collection the user hosts themselves.

## What the extension collects

**Nothing.** The developer operates no servers and receives no data of any kind — no analytics, no
telemetry, no crash reports, no usage statistics. There is no account to create and nothing to sign
in to.

## What the extension stores, and where

Everything the extension stores lives in the browser's own extension storage
(`chrome.storage.local`) on the user's machine, and is never transmitted anywhere except to the
user's own Stamporama instance:

- **Connection profiles** — the address of the user's Stamporama instance, the collection to write
  to, and its display name.
- **Access tokens** — issued by the user's own instance, used to authorize requests to it. They can
  be revoked at any time from that instance.
- **Preferences** — a small number of on/off switches for the extension's behaviour.

Uninstalling the extension deletes all of it.

## What the extension sends, and to whom

Only to the address the user themselves registered — their own Stamporama server. There is no other
recipient. What is sent is limited to:

- Catalog identifiers read from the Colnect page in front of the user (item IDs and catalog
  numbers), in order to look up the matching stamps in their collection.
- The user's confirmation of a match, so the instance can record it.

Page content is read on `colnect.com` only. The extension requests broad host access because
Stamporama is self-hosted: the address of a user's instance — a home server, a LAN hostname, a
personal domain — cannot be known when the extension is built, and the extension must be able to
reach whichever one that user configures. No host other than the configured instance is ever
contacted.

## Third parties

None. The extension contains no third-party analytics, advertising, or tracking code, and no remote
code is loaded at runtime — everything it runs ships inside the package.

## Contact

Questions and reports: <https://github.com/michalwy/stamporama/issues>
