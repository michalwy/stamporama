# Stamporama on a phone

Stamporama has a small set of **phone screens** for when you are away from the desk — at a stamp fair,
at a dealer's table, or handling the day's sales. They are part of the same Stamporama you use at the
desk: the same address, the same account and password, the same collection. There is nothing to
install from a store.

Every other screen stays as it is at the desk. Opening one on a phone shows the desk's screen, not a
phone version of it.

## What you need first: one HTTPS address

The phone reaches your own Stamporama server over the internet, so the server needs **one HTTPS
address that works from outside your home** — `https://stamps.example.com`, not a local
`http://192.168.…` address — and you use **that same address on the desk and on the phone**.

It has to be the same one because a sign-in belongs to an address: moving between two addresses, or
between `http` and `https`, signs you out (see [Authentication](authentication.md#staying-signed-in)).
Setting the address up is part of installing Stamporama — a reverse proxy or a tunnel in front of the
server, with the address set as `BETTER_AUTH_URL` — and Stamporama itself adds nothing for it.

## Adding the icon to your phone's home screen

On an Android phone, in Chrome:

1. Open your Stamporama address and sign in.
2. Open Chrome's menu (**⋮**) and choose **Add to home screen** — on some versions it is **Install
   app** — and confirm.

A **Stamporama** icon appears on the home screen. Tapping it opens the phone start screen in a window
of its own, without Chrome's address bar.

## The phone start screen

The icon opens straight into your collection. If you have **several collections**, it lists them
first; tap the one to open, and **Other collections** at the bottom of a collection's start screen
brings the list back.

The start screen lists the phone screens, one row each. New ones arrive with new releases.

## Sales to do

**Sales to do** lists the sales waiting for their next step, in the same three groups as the
Dashboard's Sales section — **Awaiting payment**, **To pack** and **To send** — the one that has
waited longest in its group first. Each row shows the sale's number, the buyer, the platform and what
the buyer pays.

Each row has one button that moves the sale a step on — **Mark paid**, **Mark packed** or **Mark
sent**. The sale then shows on the desk exactly as if you had moved it there, status history
included. On the way, the phone asks what the desk would ask:

- **Mark packed** (and **Mark sent**) on a sale whose copies are not all marked as packed asks what to
  do: mark them all packed and move on, move on and leave them, or do nothing.
- **Mark sent** on a sale with no tracking number yet asks for the **carrier** — the one its shipping
  service suggests comes pre-selected — and the **tracking number**. **Skip** marks it sent without a
  number; you can add one on the sale at the desk later.

**Mark paid** asks nothing on the phone: the total the buyer paid, which the desk offers to record at
that moment, is entered at the desk. Everything else on a sale — its lines, amounts, shipping and
corrections to its status — stays at the desk; **Full app** opens the Sales list.

## Offers

**Offers** on the start screen lists your offers, newest first. Two selects at the top narrow it:

- **Platform** — one platform, or all of them.
- **State** — one state, or **Not closed**, which is every offer that is neither sold nor withdrawn,
  as the desk's offers list shows by default.

Each row shows the offer's title, its number, platform, state and price. Tap it to open the offer.

The offer screen shows its picture, title, price, platform and state. The picture is the first
listing image — what a buyer sees first; until those images are generated, it is the photo of the
first copy in the offer that has one.

Below are the moves you can make on the phone, each only where the desk would allow it:

- **Pause** an active offer, and **Resume** a paused one.
- **Withdraw…** any offer that is not sold or withdrawn. It asks first, with the desk's own warning:
  withdrawn is final. A lot of a Facebook post still waiting for approval takes the whole post back
  with it, as at the desk.

These change the offer in Stamporama only — pausing or ending the listing on the platform itself is
done there, as from the desk. Preparing, publishing and editing an offer stay at the desk: **Full
app** opens the same offer there.

## Between the phone and the full app

There is no automatic switch by device — you choose:

- **Full app**, at the top of every phone screen, opens the desk's screen for the same thing (or the
  collection's start, when there is no direct match).
- **Phone screens**, at the bottom of the sidebar on every desk screen, opens the phone start screen.

## Staying signed in

The phone stays signed in exactly as the desk does: until you sign out, or until 400 days pass
without opening Stamporama at all. The home-screen icon shares its sign-in with Chrome on the same
phone, so signing in once in either is enough. If the phone is signed out, the icon shows the sign-in
screen, and signing in takes you back to the phone start screen.

## No connection

The phone screens always work **online**, against your server. Without a connection a phone screen
cannot load, and Chrome says so; nothing is kept on the phone to work from offline.
