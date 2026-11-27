# The administrator's panel

Whoever runs the instance has a panel at **`/admin`** for the instance as a whole: who has an
account, what they keep, how much storage it takes, and whether new accounts can be created.

## Who is an administrator

- On an instance that already had accounts when this feature arrived, the **oldest account** is the
  administrator.
- On a fresh installation, the **first account created** is.

An administrator sees an **Admin** link at the top of the *Your Collections* page. Nobody else can
open `/admin` — for them the address does not exist.

## Accounts, collections and storage

The panel lists every account with its collections. Beside each collection is the number of stored
files and the space they take — photos, scans, album pictures, attachments — read from the storage
itself, on every backend the instance uses. An account's figure is the sum of its collections.

An administrator sees that a collection exists and how large it is, **not what is in it**: the panel
opens nobody's collection.

## Deleting a collection or an account

Open the `⋮` menu on a row and choose **Delete collection…** or **Delete account…**, then type the
collection's name (or the account's email) to confirm.

- **Deleting a collection** removes everything in it — stamps, copies, offers, sales, purchases,
  albums — and its stored files. The account stays.
- **Deleting an account** removes every collection it owns the same way, and the account itself with
  its sign-in, its Assistant tokens and its connected apps.

**Neither can be undone.** An administrator cannot delete their own account from the panel.

## Registration of new accounts

The switch at the top opens or closes registration, at once and without a restart. Until an
administrator has used it, the instance follows `STAMPORAMA_ALLOW_REGISTRATION` from its `.env`
(closed by default); from the first use on, the switch decides. An instance with no account at all
always lets the first one be created. See [Authentication](authentication.md).
