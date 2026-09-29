# ADR-0060: Mail Goes Out Through a Provider Chosen at Deployment, Resend First

## Status

Accepted and implemented in #1372. The collector settled on 2026-09-29 that mail goes through an
external provider's API rather than SMTP, behind an abstraction with Resend as its first
implementation, chosen at deployment rather than in Settings; that a failed send is retried in the
background and only the final failure is reported; and that the recipient is always the account's own
address. On the same day he chose that opening Settings → Email is what takes an undelivered-mail
notification away. Refs ADR-0011 (the storage backend, the model for *chosen at deployment*),
ADR-0018 (in-process table-queued jobs), #367 (the notification centre), #1373 (the first feature
that sends mail).

## Context

The app sent no email of any kind. Reminders about watched auctions ending that day (#1373) need the
instance to send mail, and later reminders and reports will too, so sending is a capability of its
own with its own configuration and failure modes.

Three things shape it. It is **self-hosted**: whatever carries the mail belongs to the operator, and a
key to it is their secret. A reminder that fails to arrive **looks exactly like having no reminder**,
so a failure has to be said somewhere the collector will see it. And a provider's outage of a few
minutes is ordinary, so one failed request must not be the end of a message.

## Decision

### 1. An HTTP provider behind `MailProvider`, not SMTP

`src/lib/mail/provider.ts` is the whole seam: `send({ to, subject, text, idempotencyKey })` resolves
with the provider's id or throws `MailSendError`, whose message is written for the collector and
carries the provider's own words. Callers never learn which service carried a message. SMTP was
rejected as the way in and as a fallback beside a provider: a transactional API reports a refusal as
a sentence at request time — *the domain is not verified* — where SMTP defers much of it to a bounce
the app would never read.

**Resend is the one implementation** (`resend.ts`): one `POST /emails` over plain `fetch`. No SDK — the
whole API used is that call, and a client library would be a dependency kept current for a body of
four fields. Another provider is another implementation and one more name in `MAIL_PROVIDERS`, in an
issue of its own.

### 2. Chosen at deployment, never in Settings

`STAMPORAMA_MAIL_PROVIDER` names the provider and its own settings sit beside it
(`STAMPORAMA_RESEND_API_KEY`, `STAMPORAMA_RESEND_FROM`), exactly as `STAMPORAMA_STORAGE_BACKEND` and
the GCS settings do. All optional: without them the instance sends nothing, `enqueueMail` writes no
row, the worker does nothing, and Settings → Email says mail is not configured. A provider named with
its settings missing is reported as *not usable* with what is missing, in Settings and in the boot
log, rather than half-working. The installer asks for all three. Settings shows the provider and the
sender and **never the key**: the summary handed to the screen (`summarizeMailConfig`) has no field
that could hold it.

### 3. One table is the queue and the record; retries over about an hour

`MailMessage` follows ADR-0018: a feature queues a row, the in-process worker (`mail/worker.ts`,
started from `instrumentation-node.ts`) claims a due one with a conditional update, and the row is
also what Settings reads. What it adds is time: a failed attempt goes back to `queued` with a later
`nextAttemptAt`, and the worker's poll is what brings it round. Attempts start at 0, 1, 5, 15, 30 and
60 minutes (`retry-rules.ts`) — a blip is caught early, a longer outage late, and a real
misconfiguration is still reported the same morning. **Every failure is retried**, a refusal included:
a key or sender fixed within the hour should still deliver.

A send that succeeds on a retry raises nothing. After the sixth failure the row is `failed` and
reported. Each attempt carries its own idempotency key, `mail-<id>-<attempt>`: per attempt so a retry
after the operator fixed something is a new request rather than a replay of a remembered refusal, and
a restart mid-attempt gives the attempt number back (`requeueStalledMail`) so the repeat goes under
the same key and is not sent twice.

### 4. Only the final failure is a notification, and opening Settings → Email reads it

The notification centre (#367) has no table of its own — every group is a derivation — so a failed
row with no `seenAt` is the derivation: the `mail-undelivered` group, `warning`, pointing at
Settings → Email. Opening that page sets `seenAt` on every failed message of the collection, as opening
an offer reads its bidding notice (#481). The rows stay on the page — the ones still being retried and
the ones given up on in the last 30 days, each with the provider's last error.

### 5. The recipient is the account's address, read when sending

There is no recipient column and no *send to* setting. A message goes to the collection owner's
account email as it stands at the moment of the attempt, so a changed address is where the next
attempt goes; `sentTo` records where it went.

### 6. The test message skips the queue

**Send a test message** is sent at once through the same provider, so its answer — delivered to the
address shown, or the provider's own error — appears beside the button. It writes no row.

## Consequences

- A feature that sends mail calls `queueMail(collectionId, { subject, text })`, which returns null and
  queues nothing on an instance without a provider. It asks `isMailConfigured()` first and says so
  where it is switched on, rather than being switchable and then doing nothing.
- Mail is plain text. HTML is a field to add to `OutgoingMail` when something needs it.
- Resend only sends from a domain verified in its dashboard; until one is, it sends only to the Resend
  account's own address. The installer, `.env.prod.example` and the README say so, and a wrong sender
  shows Resend's own refusal on the test button.
- Settings → Email is an entry of the *System* group (ADR-0059, #1469), beside Assistant & API.
- The first feature to send mail is the morning auction reminder (#1373). It queues through
  `enqueueMail` inside its own transaction (the optional `db` argument), so the claim that makes it
  once a day and the message it queues are written together or not at all.
