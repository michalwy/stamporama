# Stamporama Assistant (browser extension)

The Assistant is a Chrome extension that matches Colnect catalog pages against your collection while
you browse. On a Colnect list page it tells you which stamps you already have, which need a
decision, and writes the Colnect links back into Stamporama.

It is not part of the web app: you install it into Chrome once per machine, then connect it to your
instance.

## Installing it

Chrome refuses to install extensions that do not come from its store, so the Assistant is installed
through a **Chrome policy** entry that points at your own Stamporama. Your instance serves the
extension, and Chrome keeps it up to date from there — when you upgrade Stamporama, the Assistant
updates itself with it.

You need two values:

- **Extension ID** — `afaeadeheelibafbmhobdnkblmbckehn`
- **Update URL** — `https://<your-instance>/assistant/update.xml`, using the address you normally
  open Stamporama at.

Setting the policy is a one-time step per machine and differs per operating system — a configuration
profile on macOS, a registry value on Windows, a JSON file on Linux. The exact steps are in
[`extension/README.md`](../../extension/README.md#install-for-daily-use-254). Afterwards, restart
Chrome and check `chrome://policy`: the entry should be listed with status OK, and the Assistant
appears in `chrome://extensions` marked as installed by your organisation.

Because it is installed by policy, Chrome will not let you disable or remove the Assistant from the
extensions page. Removing the policy entry uninstalls it.

**If the update URL shows an error page** ("No packaged Stamporama Assistant on this instance"), you
are running Stamporama from source rather than from a released image. Released images carry the
extension; a source build does not, and the extension has to be loaded manually in that case (see
the same document).

## Connecting it to your collection

Nothing is typed in, and no token is copied by hand:

1. Open the collection you want the Assistant to write to.
2. Go to **Settings → Assistant** and choose **Connect Stamporama Assistant**.
3. With that page still in front, click the Assistant's toolbar icon.

The connection appears in the extension's options, active and named after your collection. Repeat it
per collection, or per instance if you run more than one — the extension keeps them side by side and
shows the active one in a coloured badge, so it is always clear where a match will be written.

You can revoke a connection at any time from the same **Settings → Assistant** screen.

## Keeping it up to date

Nothing to do. Chrome checks your instance for a newer version every few hours and after each
restart, so upgrading Stamporama is what upgrades the Assistant. The version Chrome sees is the
Stamporama version it came from.
