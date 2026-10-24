# ADR-0073: The Conversation Log — Entries on a Buyer, Optionally About One of Their Sales

## Status

Accepted. Decided with the collector on 2026-10-24 in #2149, which built it. #2150 adds attachments
to entries and builds on this model (§7).

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

### 7. An entry keeps files (#2150)

A buyer's message often carries what matters as a file. `ConversationAttachment` hangs off an entry:
**pictures (JPEG, PNG, WebP) and PDFs**, several per entry (at most 20), each up to the upload limit
photos have (`MAX_UPLOAD_BYTES`), with the file's name.

- **What a file is comes from its bytes** (`sniffAttachment`), never from its name or a declared
  type; anything else is refused before a byte is stored. The name is kept cleaned of path
  separators and control characters, given the extension its bytes say when it has none.
- **Kept as it came**, through `src/lib/storage/` under `<collectionId>/conversation/<uuid>/`, with a
  WebP thumbnail for a picture. It belongs to its entry alone — never an offer photo or anything
  else's — so it is a table of its own rather than a sixth owner of `Photo`, which would have taken a
  PDF only by growing columns no photo has.
- **Deleted with its entry.** The cascade from an entry, and from a contact through its entries,
  drops rows only; `deleteConversationEntry` and `deleteContact` read the files first and delete
  them after, as every other owner of stored bytes does. Bytes are written before the rows, so a row
  never names a file that is not there; a failed delete leaves an orphan file, never a dangling row.
- **Shown on the entry** — a picture's thumbnail enlarging in the shared lightbox, a PDF by name,
  opening in a new tab — and added (*⋮ → Attach files*) and removed (*×*) by hand in the same card.
  They count in the collection's storage figure.
- **The agent API** sends a file as base64 in a string of the entry grammar (`name=`, `data=`): a
  parameter carries nothing richer, and it is the one spelling an MCP client can send too. Files go
  with `add_conversation_entries` (each naming its entry by place) or to one entry afterwards
  (`attach_conversation_files`), each answered on its own; `remove_conversation_attachment` removes
  one. An entry reads its files back as **links, never bytes** (#706) — the attachment route, which
  takes the same token, so a *read only* token lists and fetches them.

## Consequences

- The log is one query per view and needs no paging on a buyer's card; past 200 entries the card
  says how many more there are.
- #2150's attachments hang off an entry and are deleted with it (§7); a delete path added later
  for entries must delete their files too.
- An entry has no effect anywhere else, so nothing in profit, statuses or the dashboard reads it.
