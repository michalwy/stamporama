# Allegro

Stamporama talks to Allegro in two independent ways, both set up under **Settings → Allegro**.

- **Which platform is Allegro** — the setting the Assistant's lot capture rides on. Naming one of
  your platforms lets the browser extension record an auction you are watching straight from its
  page. See [Auctions](auctions.md) and the [Assistant guide](assistant.md).
- **Your Allegro account** — this instance's own access to Allegro's API, so your *own* offers and
  orders can be read here directly instead of off a page. That is what this page is about.

The two are separate on purpose. The first is about a marketplace you buy on; the second is about
the account you sell from.

## What connecting gives you

Nothing yet, on its own. Connecting is the foundation the sold-listing worklist and the
order-to-sale flow are built on — this step ends at *connected*, and reads no business data. It is
worth doing now if you sell on Allegro, because it is the part that needs a little setup.

## Registering your own Allegro application

Stamporama is self-hosted, and it deliberately ships with **no Allegro application of its own**. A
client ID and secret baked into a public image would be one shared application for every
installation in the world — revocable by anyone, and rate-limited as a single caller. So your
instance uses an application you register yourself. It is free and takes a few minutes.

1. Sign in at [apps.developer.allegro.pl](https://apps.developer.allegro.pl) with the Allegro
   account you sell from.
2. Create a new application.
3. Choose the type:
   - If your Stamporama has **no public address** (it runs on your own machine, a home server, a NAS
     — anything you reach over your LAN or a VPN), pick the option for an application that signs in
     **without a redirect** — Allegro calls this a device / non-web application. This is the normal
     case.
   - If your Stamporama **does** have a public HTTPS address, you may instead register a web
     application and give it the redirect URI shown on the Settings → Allegro tab. It must match
     exactly, character for character.
4. Grant it read access to your offers and orders. Profile access is **optional**: without it
   everything works, Stamporama just cannot show which Allegro account is connected — the tab then
   says "Connected" without a name.

   What you tick here is exactly what the connection can do — Stamporama asks for no permissions of
   its own, so the access you grant is the access it gets, and nothing else. Grant narrowly; you can
   widen it later and reconnect.
5. Copy the **Client ID** and **Client secret**.

### Before you paste them in: the encryption key

Allegro credentials are stored **encrypted**, so a database dump — a backup, a copy taken to another
machine, a file you send someone for help — does not carry live marketplace credentials in the
clear. The key comes from your environment, not from the database.

**If you installed with `scripts/install.sh`, you already have one** — the installer generates
`STAMPORAMA_SECRET_KEY` into your `.env` and never changes it afterwards. Skip ahead.

Otherwise, generate one:

```bash
openssl rand -base64 32
```

Put it in your `.env` as `STAMPORAMA_SECRET_KEY` and restart Stamporama. Until you do, the Allegro
tab will say so and refuse to save an application.

Two things worth knowing:

- **Back it up with your database.** A database restored without its key still has all your stamps,
  offers, sales and photos — only the Allegro connection is unreadable.
- **Changing it loses the connection and nothing else.** You reconnect from Settings; you do not
  re-register the application.

## Connecting

Open **Settings → Allegro**, fill in the client ID and secret, tick **Use Allegro's sandbox** if you
registered a sandbox application, and press **Save application**.

Then choose how to sign in.

### Connect with a code (recommended)

Press **Connect with a code**. Stamporama shows a short code and a link. Open the link in your own
browser, sign in to Allegro if you are not already, and enter the code. The Settings page is
watching and finishes on its own — you do not need to come back and press anything.

This works on every installation, including one that nothing on the internet can reach, because
Allegro never has to send your browser back to Stamporama. It is the recommended path for that
reason.

The code is good for a few minutes. If it expires, press the button again.

### Sign in on Allegro instead

Offered only when your instance has a configured address (`BETTER_AUTH_URL`). Pressing it sends you
to Allegro, you confirm, and Allegro sends you straight back to the Settings tab, connected. It is
one round trip rather than a wait — but it needs the redirect URI shown on the tab to be registered
with your application, exactly as printed.

## Once connected

The tab names the Allegro account you are connected as — or just says "Connected", if the
application has no profile access — along with when its token was last refreshed and when it
expires. Tokens are renewed automatically before they run out, and they survive a
restart — you connect once.

- **Test connection** makes one real call to Allegro and reports what came back. If the application
  has no profile access it says so and still counts as working — Allegro accepting the token is the
  thing being tested, and that is a different answer from Allegro refusing it.
- **Needs reconnecting** appears when Allegro has refused to renew the connection — typically
  because you revoked it in your Allegro account, or the application's secret changed. Press
  **Reconnect with a code** and go through the short flow again.

### Changing the application

Saving a different client ID, or switching the sandbox toggle, **drops the current connection**: an
access token belongs to the application that issued it. Reconnect afterwards.

Leaving the client secret field blank keeps the secret you already saved — it is never shown again
once stored, so a blank field means "keep it", not "clear it".

### Disconnecting

**Disconnect** forgets the connection here. It does not remove the authorization on Allegro's side
— your application stays listed under your Allegro account's connected applications until you remove
it there. If your intent is to cut access off entirely, do both.

## The sandbox

Allegro runs a sandbox that mirrors the real thing. A sandbox application is registered separately
and has its own client ID and secret, so switching the toggle means pasting the other pair in. It is
worth using while you are trying things out — nothing about orders or sales should first be
exercised against a live selling account.
