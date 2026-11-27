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
- **`POST /api/feedback` takes a request with no session, on purpose**, and that is bounded three
  ways: an anonymous request must name a shared page (anything else is `401`); `rate-limit.ts` allows
  five an hour per address and sixty an hour for all anonymous senders together (`429`); and the
  message is capped at 4,000 characters, context trimmed. A hidden field a person never sees is
  answered `200` and stored nowhere. A signed-in sender has thirty an hour.
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
  (`agent-api/admin-registry.ts`): `list_feedback`, `get_feedback`, `update_feedback`. They are about
  the instance, not the token's collection, so they are **not on `/api/v1` and not in its OpenAPI
  document**; `/api/mcp` adds them for a credential whose account is an administrator
  (`operationsForMcpCaller`). For anyone else they do not exist — absent from `tools/list`, and a
  call by name answers as any unknown tool does. The scope check is the ordinary one: a `read`
  credential is refused on `update_feedback`. `get_feedback` returns ids, never a name or an address,
  and says only `contactGiven` — the persona works towards public issues.
- **Nothing here is sent anywhere outside the instance**; #2721 adds the one outbound call, a
  notification that carries no report data.
