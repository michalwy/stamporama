# ADR-0073: The Conversation Log — Entries on a Buyer, Optionally About One of Their Sales

## Status

Accepted. Decided with the collector on 2026-10-24 in #2149, which built it. #2150 adds attachments
to entries and builds on this model.

## Context

What was agreed with a buyer — which copies, the price, shipping, payment, the address, a complaint —
lives in Messenger, e-mail or marketplace messages, and finding it again means searching those
histories. The collector wants it in the app, as a log of the conversation reachable from the sale.
It will be written mostly by an AI assistant reading those conversations, so the agent API covers
it completely from the first release.

## Decision

### 1. An entry belongs to a contact, and optionally to one of their sales

`ConversationEntry` names a **contact** (required) and a **sale** (optional). A conversation often
spans several sales, or happens before a sale exists, so the person is the owner and the sale is a
pointer. One table rather than a log per sale: the sale's card and the contact's page read the same
rows, narrowed differently.

### 2. What an entry holds

When it was said (`occurredAt`, an instant), the **channel** (`messenger`, `email`, `allegro`,
`phone`, `other`), the **direction** (`from_buyer`, `to_buyer`, `note`), a **summary** (required,
capped at 2,000 characters), an optional verbatim **quote** (5,000) of what matters, an optional
**link** to the source (`http(s)://`), and **who wrote it** (`assistant` or `collector`). The
vocabularies are closed lists in `conversation-log-rules.ts`, stored as text, as the sale's status is.

### 3. The sale an entry names is always a sale of its contact

Every write checks it (`conversation-log.ts`). The schema cannot say it without a composite key on
`sale`, and an `ON UPDATE` action could only move the entry to the sale's new buyer — the opposite of
what is wanted. So the domain holds it, at the two places a sale stops being the contact's:

- **A sale's buyer changes** (`updateSaleHeader`) — the entries stay with the previous buyer and
  drop the sale (`keepConversationWithBuyer`). They record a conversation with that person; changing
  who the sale went to does not change who was spoken with.
- **Two sales merge** (`mergeSales`) — the other sale's entries move to the remaining sale when they
  are with its buyer; any others drop the sale, as the delete that follows would.

Deleting a sale drops the link (`ON DELETE SET NULL`). **Merging contacts moves the whole log** with
the sales its entries name. **Deleting a contact deletes its log** (`ON DELETE CASCADE`): the log is
about the person, and the delete confirmation says so.

### 4. A record, not an act

An entry changes no sale, status or amount, so nothing waits for the collector's review — unlike a
sale the API records (#1948). `author` is set when the entry is written and never changes; a
collector correcting an assistant's entry leaves it the assistant's.

### 5. Where it is shown

A **Conversation** card on a sale's screen (while the sale has a buyer) lists that sale's entries,
with *All with this buyer* switching to the whole history; the same card on the contact's page lists
every entry, each naming its sale. The collector adds, edits and deletes entries in it.

### 6. The agent API covers it whole

`list_conversation_entries` (read and search — buyer, sale, channel, words, days),
`add_conversation_entries` (a batch, answered per entry), `update_conversation_entry`,
`move_conversation_entry` and `delete_conversation_entry`. A buyer is named as the sale operations
name one, or by their Facebook profile as *Sell* finds one (#1777); a sale by its number. One entry
in a batch is one string with a field per line, since free text cannot use the `;`-separated
grammar of the other batches. See `docs/agents/agent-api.md`, *The conversation log*.

## Consequences

- The log is one query per view and needs no paging on a buyer's card; past 200 entries the card
  says how many more there are.
- #2150's attachments hang off an entry and are deleted with it.
- An entry has no effect anywhere else, so nothing in profit, statuses or the dashboard reads it.
