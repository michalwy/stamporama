# The administrator's panel

Whoever runs the instance has a panel at **`/admin`** for the instance as a whole: who has an
account, what they keep, how much storage it takes, and whether new accounts can be created.

## Who is an administrator

The administrators are named by whoever runs the instance: an account is an administrator when its
**email address is listed in `ADMIN_EMAILS`** in the instance's `.env` — several addresses separated
by commas, in any letter case. With the variable unset, nobody is an administrator. Being the first
or the oldest account makes no difference. A changed list takes effect when the app is restarted; on
the owner's Raspberry Pi it is set in GitHub and arrives with the next release
([deployment runbook](../deployment/pi-deploy.md#administrators)).

An administrator sees an **Admin** link at the top of the *Your Collections* page. Nobody else can
open `/admin` — for them the address does not exist.

## Accounts, collections and storage

The panel lists every account with its collections. Beside each collection is the number of stored
files and the space they take — photos, scans, album pictures, attachments — read from the storage
itself, on every backend the instance uses. An account's figure is the sum of its collections.
Reading every stored file takes a moment, so the list appears at once and the figures say
*measuring…* until they arrive.

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

## Feedback reports

Under the accounts is the list of reports sent with [Report a problem](feedback.md) — from inside
the app and from pages shared with customers. It opens on the **new** ones; the chips above the list
switch to *Triaged*, *Resolved*, *Dismissed* or *All*.

Click a report to read it in full, with everything that was sent with it (the screen's address, the
version, the browser, the window, any script errors) and who sent it — the account, or the contact a
visitor chose to leave. **Pictures** sent with it are shown as thumbnails above those details; click
one to open it at full size in a new tab. There you set:

- its **status** — *New*, *Triaged* (it has an issue or an answer), *Resolved* (done) or *Dismissed*;
- the **GitHub issue** it became, as a link;
- a **note** of your own, never shown to the sender.

An agent connected to the instance as an administrator can do the same through the admin tools
`list_feedback`, `get_feedback`, `get_feedback_attachment` (one of a report's pictures, which the
agent sees as a picture) and `update_feedback` ([Agent API](agent-api.md)).
