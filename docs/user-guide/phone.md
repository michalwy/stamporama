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
