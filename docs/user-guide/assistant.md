# Stamporama Assistant (browser extension)

The Assistant is a Chrome extension that matches Colnect catalog pages against your collection while
you browse. On a Colnect list page it tells you which stamps you already have, which need a
decision, and writes the Colnect links back into Stamporama.

It reads three kinds of Colnect page: a catalog **list** page, a single **stamp** page (its minor
variants), and the site-wide **search results** page — so a stamp you found by searching can be
matched without opening it first.

It is not part of the web app: you install it into Chrome once per machine, then connect it to your
instance.

## Installing it

The Assistant is published as an **unlisted Chrome Web Store listing** — not searchable, but
installable by anyone with the link:

<https://chromewebstore.google.com/detail/lhbaflbkfgahmcbgmlibleedmfcdjedf>

Click **Add to Chrome**. That is the whole installation: no settings, no policy, nothing per
machine.

Chrome keeps it up to date on its own, the same way it updates any other extension.

## Connecting it to your collection

Nothing is typed in, and no token is copied by hand:

1. Open the collection you want the Assistant to write to.
2. Go to **Settings → Assistant** and choose **Connect Stamporama Assistant**.
3. With that page still in front, click the Assistant's toolbar icon.

The connection appears in the extension's options, active and named after your collection. Repeat it
per collection, or per instance if you run more than one — the extension keeps them side by side and
shows the active one in a coloured badge, so it is always clear where a match will be written.

You can revoke a connection at any time from the same **Settings → Assistant** screen.

## Decisions that are already made

The Assistant never silently replaces a Colnect ID you already have. So when one of your stamps is
linked to a *neighbouring* Colnect item, that stamp keeps coming back under **Needs your decision**
every time you re-scan the page — even though you settled it long ago.

Those rows are hidden by default. A row disappears only when **every** stamp it could be linked to
already carries a Colnect ID; if one of the candidates is still free, the row stays, because that
free stamp is most likely the answer.

When there are hidden rows, a **Show N already linked elsewhere** checkbox appears beside *Fill
missing catalog numbers* — tick it to bring them back and change one. It only filters what is on
screen (nothing is re-matched), and the extension remembers the setting.

## Filling a sale form for you

The Assistant also works the other way round: from the [bulk listing
workspace](offers.md#list-via-assistant), **⚡ List via Assistant** on a ready offer opens the
platform's sale form in a new tab and fills it in — the items being sold, each copy's condition in the
platform's own grades, the price, the number of sets and the two texts.

It **never submits**. The form is filled and left in front of you to check and post yourself, and no
photos are uploaded. When it is done, the offer's card in Stamporama lists what was filled and what
was skipped, so a field it couldn't answer — a condition with no grade on that platform, a text over
the platform's limit — is something you learn there rather than after posting.

For this to be offered, the connection has to be the one this instance is scripting: the Assistant
registers your instance's address when you connect it, which is what lets a page of yours hand an
offer over without any click on the toolbar. Connect it again from **Settings → Assistant** if the
button says it is not installed on a browser where it plainly is.

## Keeping it up to date

Nothing to do — Chrome updates it from the store. Each Stamporama release publishes a matching
version of the Assistant, which goes live once the store has reviewed it, usually within a day.
