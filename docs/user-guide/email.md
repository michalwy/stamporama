# Email

Your instance can send you email — so far the [morning auction reminder](auctions.md#a-morning-email-of-todays-lots),
with more reminders and reports as features arrive that use it. Mail only
ever goes to **your own account's address**. There is no separate *send to* address and no other
recipients; to get mail somewhere else, change your account's address.

## Setting it up

Email is optional and is set up when the instance is **installed**, not in Settings. Whoever runs the
instance chooses a mail provider, and the installer asks for its settings; they can also be set by
hand in `.env` (see the mail section of `.env.prod.example`). Without a provider the instance sends
no mail at all, and nothing that sends mail can be switched on.

**Resend** ([resend.com](https://resend.com)) is the one provider so far. It needs:

- **An API key** (`STAMPORAMA_RESEND_API_KEY`), from resend.com/api-keys. *Sending access* is enough.
- **A sender address** (`STAMPORAMA_RESEND_FROM`), such as `Stamporama <stamps@example.com>`. Its
  domain **must be verified** at resend.com/domains, by adding the DNS records Resend gives you.
  Until a domain is verified, Resend refuses to send from it.

Restart the instance after changing either.

## Settings → Email

**Settings → Email**, in the *System* group, shows how the instance sends mail:

- **Provider** and **Sent from** — the provider and sender address it was set up with. The API key
  is never shown.
- **Sent to** — your account's address.
- **Send a test message** — sends a message to that address straight away. Beside the button you see
  either where it went, or the provider's own reason for refusing it, such as a sender domain that is
  not verified or a wrong key.

If no provider is set up, the page says so. If one is named but its settings are incomplete, the page
says what is missing.

## When a message does not arrive

A message that fails to send is **tried again** in the background for about an hour: after 1, 5, 15,
30 and 60 minutes. A short outage at the provider therefore loses nothing, and a message that gets
through on a later attempt is not reported anywhere.

When the last attempt fails too, the [notification bell](action-items.md) shows **Email not
delivered**, with the provider's reason. It leads to Settings → Email, which lists what did not arrive:

- messages **still being tried**, with how many attempts so far and when the next one is;
- messages **given up on** in the last 30 days, with the last reason.

Opening that page clears the notification; the list stays.
