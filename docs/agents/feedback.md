# In-app feedback

*Report a problem* (#2720): where it is offered, what a report carries, where it is read. Read this
before touching `src/lib/feedback*.ts`, `src/app/feedback/`, `/api/feedback` or the admin MCP tools.
The triage persona is [`feedback-triage.md`](feedback-triage.md); the panel is [`admin.md`](admin.md).

- **Two entry points, one dialog.** Inside a collection it is the sidebar's *Report a problem* (a
  row when the sidebar is open, an icon on the rail), signed in. On the five pages shared with a
  customer — `/p`, `/s`, `/t`, `/spec`, `/fb` — it is `SharedPageFeedback`: one muted, non-printing
  line at the foot of the page, in the page's language (`feedback-labels.ts`: en, pl, de, English
  otherwise), for a visitor with no account. **Discreet is the owner's word** (2026-11-27): the page
  is the seller's document for their buyer and the link is not part of it. It is not on the dead-link
  notices, and `/o/…` is a signed-in redirect, not a shared page. The contact field is offered only
  to the anonymous visitor; a collector is reachable through their account.
- **The dialog is portalled to `<body>`** (#2725). The sidebar that opens it is `position: sticky`,
  its own stacking context, so drawn in place the dialog ranked only within the sidebar and the
  stamp cards of the main column painted over its fields (v1.4.0). `FeedbackDialog` returns
  `createPortal(<DialogShell …>, document.body)` for every entry point, shared pages included;
  `tests/unit/feedback-dialog-portal.test.ts` holds it there.
- **`POST /api/feedback` takes a request with no session, on purpose**, and that is bounded three
  ways: an anonymous request must name a shared page (anything else is `401`); `rate-limit.ts` allows
  five an hour per address and sixty an hour for all anonymous senders together (`429`); and the
  message is capped at 4,000 characters, context trimmed. A hidden field a person never sees is
  answered `200` and stored nowhere. A signed-in sender has thirty an hour.
- **Pictures ride along, from anyone who may send** (#2727; the owner, 2026-11-28): images only —
  PNG, JPEG, WebP, read from the bytes (`sniffFeedbackAttachment`, the conversation log's reader with
  PDF refused) — **at most 5 per report, 10 MB each**, for an anonymous visitor of a shared page as
  for a signed-in collector. The rules are `feedback-attachment-rules.ts` (pure; the dialog checks
  count, size and declared type as files are added, the route checks them again, the bytes are the
  server's); the dialog takes them from a picker or **pasted anywhere in it**. The request is then
  `multipart/form-data` — the report as JSON in `report`, the files in `file` — and a report without
  pictures may still be plain JSON. A refused picture refuses the whole report (`400` too many,
  `413` too large, `422` not a picture), and nothing is stored. **`/api/feedback` is out of the
  proxy's matcher** (`src/proxy.ts`): Next buffers a body for the proxy only up to
  `proxyClientMaxBodySize`, 10 MB by default, and hands the route the cut copy. The rows are
  `FeedbackAttachment`, shaped like a sale's files and prepared by the same
  `prepareConversationAttachment` (thumbnail, cleaned name), but **owned by no collection**: bytes
  under `feedback/<uuid>/`, written before the rows and removed on a failure, not counted in any
  collection's storage. The cascade from a report drops rows only — and nothing deletes a report
  today; whatever starts to must delete the bytes. The panel shows them through
  `/api/admin/feedback-attachments/<id>` (an administrator's session, `404` for anyone else);
  `get_feedback` lists them, and **`get_feedback_attachment` answers with the picture itself**, an
  MCP `image` block — as it came when it is at most 1568 px and 3.5 MB, otherwise a WebP fitted
  inside 1568 px — so the triage persona can look at a screenshot.
- **A share link's token never reaches the table.** `redactRoute` (`feedback-rules.ts`) replaces it
  with `[token]` and drops the query before anything is stored — the token is a credential, and a
  report is read by more people than the link was sent to. Which kind of page it was is `sharedPage`.
  `tests/unit/feedback-rules.test.ts` and the integration test both assert the secret is gone.
- **Context is flat text columns, not one `Json`**: `route`, `appVersion` (the server's own), `userAgent`,
  `viewport`, `language`, `timeZone`, `theme`, `recentErrors` (the page's last five script errors,
  remembered by `feedback-context.ts` from the moment a screen carrying the entry point is drawn). A
  `Json` column would also have to be added to the list `tests/unit/prisma-text-trim.test.ts` pins.
- **The collection is resolved from the slug for the sender's own account**, so a report cannot be
  attached to somebody else's collection. `userId` and `collectionId` go null when either is deleted:
  a report outlives both.
- **Reading and updating are an administrator's, checked in `feedback.ts`** whichever surface asks —
  the panel's server action or the MCP tools. Status is `new` / `triaged` / `resolved` / `dismissed`;
  `issueUrl` must be `https://github.com/<owner>/<repo>/issues/<n>`.
- **The admin MCP tools are a second list, `ADMIN_OPERATIONS`, not part of `OPERATIONS`**
  (`agent-api/admin-registry.ts`): `list_feedback`, `get_feedback`, `get_feedback_attachment`,
  `update_feedback`. They are about
  the instance, not the token's collection, so they are **not on `/api/v1` and not in its OpenAPI
  document**; `/api/mcp` adds them for a credential whose account is an administrator
  (`operationsForMcpCaller`). For anyone else they do not exist — absent from `tools/list`, and a
  call by name answers as any unknown tool does. The scope check is the ordinary one: a `read`
  credential is refused on `update_feedback`. `get_feedback` returns ids, never a name or an address,
  and says only `contactGiven` — the persona works towards public issues.
- **One thing leaves the instance, and it carries nothing** (#2721). After a report is stored the
  route calls `fireFeedbackNotification()` (`src/lib/feedback-notify.ts`): `POST FEEDBACK_NOTIFY_URL`
  with `authorization: Bearer FEEDBACK_NOTIFY_TOKEN`, `anthropic-version: 2023-06-01`,
  `content-type: application/json` and the body **exactly `{}`** — a claude.ai routine's API trigger,
  which refuses a body with a `text` field (403 *this project is paused*). The routine answers
  "New in-app feedback." in the project and the coordinator starts the triage
  ([`feedback-triage.md`](feedback-triage.md)). The rules, each held by
  `tests/unit/feedback-notify.test.ts`: it is **not awaited and cannot throw**, so a report is
  stored and answered whatever the trigger does; **at most one fire per 30 seconds** (in memory, per
  process — the claim is taken before the request, so a trigger that is down is not hammered);
  **both settings or nothing**, silently; `https` only; a five-second timeout; and **the log line is
  the status code or the error's name — never the token, the address or the response body**. Not
  fired for a refused request or a filled hidden field. Do not add report content to the body: the
  triage reads reports through the admin tools, and the trigger would refuse it anyway.
- **The two settings reach the Pi with a deploy, not by hand**: variable `FEEDBACK_NOTIFY_URL` and
  secret `FEEDBACK_NOTIFY_TOKEN` in GitHub's `prod` environment → `deploy.yml`'s `env:` →
  `scripts/deploy.sh` writes both into the installation's `.env` (only when both are given, never
  printing either) → [`platform-deployment.md`](platform-deployment.md), `docs/deployment/pi-deploy.md`.
