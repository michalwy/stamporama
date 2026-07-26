# Agent Instructions

This project is intentionally vibe-coded. Future agents must preserve product intent, avoid invented requirements, and ask clarifying questions when the next step is not clear.

## Product Context

- Product name: Stamporama
- Purpose: a self-hosted web app for stamp collectors
- Desktop browsers only; no mobile layouts or breakpoints.
- Core concept: **collection** — the top-level organizing unit that scopes all stamp data for a user

## Working Rules

- Do not assume domain behavior. Ask before defining catalog standards, condition scales, trade workflows, auction integration behavior, or pricing logic. Ask one question at a time.
- Do not add user-facing functionality unless the current task explicitly asks for it.
- Prefer small, reversible changes with clear documentation.
- When changing user-visible behavior, update `docs/user-guide/` in the same task.
- When changing behavior, data model, setup flow, or architecture assumptions, update every affected document (`README.md`, `docs/product/brief.md`, `docs/architecture/overview.md`, relevant ADRs, `docs/user-guide/`).
- When introducing a framework, library, or major pattern, add or update an ADR in `docs/decisions/`.
- Update this `AGENTS.md` file when new project knowledge or workflow rules would help future agents.
- Favor boring, well-supported tools over novelty. Preserve existing user changes.
- Use GitHub Issues as the shared backlog. Use Conventional Commits for issue titles. Always assign labels (`backlog` + type + priority when known). Do not maintain a local `TODO.md`.
- If GitHub connector cannot create issues, use `gh` CLI as fallback.
- All GitHub content must be in English.
- Do not create git commits unless the user explicitly asks. Do not push unless explicitly asked.
- Solo project: commit directly to `main` by default. Create feature branches only when the user asks for a PR.
- When pushing to `main`, try `git push origin main` first. If rejected, fetch, rebase, rerun verification, push again.
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, etc. Include GitHub issue reference when one exists.
- When a commit title alone would omit useful context, include an extended commit message body.
- Use a separate git worktree only when the user explicitly asks for one.

## Backlog Review & Release Versioning

See `docs/agents/backlog-review.md` and `docs/agents/release-versioning.md` for detailed instructions on these workflows.

## Multi-Step Implementation Plans

When a task spans more than one logical area, write an implementation plan before starting. Store it under `.claude/plans/`. A plan is executed fully within a single session.

- Begin with a `## Progress` section containing a checkbox list of numbered steps.
- Steps are executed in order. Mark each step `[x]` immediately after completing it.
- Each step must state a **Done when** criterion.

## Agent Collaboration

Use specialized roles only when the task benefits from them. Small, localized tasks can be handled by one agent.

Use specialized roles for larger changes that cross domain, data, authorization, or user-flow boundaries:

- Architect: schema, ADRs, major patterns.
- Designer: UI flows, dialogs, interaction design.
- Developer: scoped implementation.
- Tester/Reviewer: browser flows, regressions.

Prefer Architect before changing Prisma schema, permissions, collection scoping, authentication, routing, or ADR-documented patterns. Prefer Tester/Reviewer after changing forms, dialogs, collection routing, authentication, permissions, or migrations.

## Technical Direction

- Collection-scoped access control: `collectionId` on data, owner has full access, checks live server-side.
- Collection URLs: `/c/[collectionSlug]/...`; slug resolution authorizes by internal `collectionId`.
- Better Auth for authentication.
- Prisma with PostgreSQL (minimum **version 15** — migrations use `NULLS NOT DISTINCT`; see ADR-0006). Treat schema changes as product decisions.
- SPA-like collection interaction: Next.js App Router as route/auth shell, client-side queries/mutations for rich screens.
- TanStack Query for data fetching, TanStack Table for list views.
- Cursor-backed infinite scrolling for large lists via shared primitives.
- Keep domain logic out of UI components. Keep authorization server-side.
- Explicit module boundaries under `src/`.
- Self-hosted deployment: CI pushes multi-arch image to `ghcr.io/michalwy/stamporama` for release tags only. `docker-compose.prod.yml` + `.env` for production. `scripts/install.sh` is the curl-able installer. Version baked via `STAMPORAMA_VERSION` build arg, shown through `getAppVersion()` in `src/lib/version.ts`.
- Browser extension (Stamporama Assistant, #253; ADR-0015) lives in `extension/` — a separate pnpm-workspace package (MV3, esbuild + hand-written `manifest.json`, own `tsconfig`). It is **excluded from the app's** `pnpm lint`/`typecheck`; build and check it on its own with `cd extension && pnpm build|typecheck`. It calls the Colnect matcher endpoints with an `AssistantToken` bearer (session-or-token auth via `src/lib/route-auth.ts`), because the extension reaches us cross-site from colnect.com. Tokens are obtained by **self-registration** (#252): Settings → Assistant exposes a one-time code + the instance's own origin on the page, and a toolbar-icon click exchanges it at `POST /api/assistant/register` (`src/lib/assistant-registration.ts`).
- Assistant **distribution** (#288; ADR-0017, superseding ADR-0016) — published to an **unlisted Chrome Web Store listing**; the store assigns the ID and signs, so there is no CRX, no signing key and nothing served by the instance. `extension/pack.mjs` (`pnpm assistant:zip` from the root) writes a store ZIP with the app version stamped in; CI's `publish-extension` job uploads and publishes it per release tag (`CWS_CLIENT_ID`/`CWS_CLIENT_SECRET`/`CWS_REFRESH_TOKEN` secrets, `CWS_PUBLISHER_ID`/`CWS_EXTENSION_ID` variables). Self-hosted force-install was tried and fails: Chrome honours a non-store `update_url` only on an enterprise-managed machine. The unpacked dev build and the store build stay **two extensions** with two IDs (`extension/identity.mjs`; `manifest.json` carries no `key`), so both can live in one browser and a dev profile can never reach a production collection.
- Binary assets (photos, #112) sit behind the `src/lib/storage/` interface (filesystem + GCS, #138; ADR-0011; active write backend via `STAMPORAMA_STORAGE_BACKEND`, per-photo reads) — async/streaming, `resolveUrl` returns stream-or-redirect, write-one/read-many by per-row `storageBackend`. Bytes live under `STAMPORAMA_DATA_DIR` (the `stamporama-data` volume), never in `public/`; serve them through collection-scoped route handlers. Multipart uploads use route handlers, not server actions. `Photo` is polymorphic over **three** owners — `Item`, `Stamp`, `Offer` (#311, generated listing images, `kind = generated`; #313, images uploaded straight to an offer for a manual attachment, `kind = original`) — with a `num_nonnulls(...) = 1` CHECK; deleting any owner must delete the bytes explicitly (the cascade only drops rows). An offer's photo plan is part rule-derived and part manual: `OfferPhotoAttachment` (#313) is the *plan entry* that carries the distinction, so a regeneration recomputes the collages and leaves the attachments alone (#315). An attachment is **N tiles in C columns** — `copy_photo` and `upload` being N = C = 1, and `manual_collage` (#331) the collector's own selection (`OfferPhotoAttachmentTile`, mixing copy scans and offer uploads) at a width they pick, rows never stored because the contents are explicit. In the plan's vocabulary a plain `collage` is always one the rules derived, hence `manual_collage` for the hand-built one. Sets that have gone — sold here, sold from under the offer, or held by an offer in active bidding — are dropped from the plan's inputs in `readInputs` (whole sets, never single copies), which marks the stored images out of date through the fingerprint alone; terminal offers are exempt. Attachments render through the same one-tile collage path as everything else — there is no unlabelled pass-through (#312). The **upload order** over the whole plan (collages and attachments) is the collector's to set: `Offer.photoPlanOrder` is a `String[]` of stable per-image tokens (`c:<side>:<sortedItemIds>` / `a:<attachmentId>`, also written on each stored `OfferPhotoEntry.token`), an *override* the pure engine reconciles against the derived order at read time — so a manual order survives a composition change or regeneration. A reorder is **applied to the stored images** (their entries are renumbered; bytes untouched), so either list can be the drag surface and reordering never marks anything out of date. **Nothing is ever dropped from the plan**: an image the collector marked do-not-publish (`Offer.photoPlanUnpublished`) or one past the platform's `maxPhotos` is still rendered and shown, just kept out of the numbered upload run and the ZIP — and the limit fills from the front of the order, protecting nothing, because the order is the priority order.
- The **bulk listing workspace** (#322) is a *sub-route* of Offers (`offers/listing/`), not a nav page: posting a prepared batch is a step in the offer lifecycle, and the static segment takes precedence over `[offerId]`. It is scoped to one **platform** and to `ready` offers, reads its batch through one unpaginated route handler (`offers/listing`), and does grouping, filtering and year facets **client-side** from pure helpers in `src/lib/listing-groups.ts` (unit-tested) — a `ready` batch is bounded by what a person is about to type in by hand, and instant facets beat a page boundary. The per-offer posting kit (texts, photos) is loaded **on expand** through the existing `useOfferDetail` / `useOfferPhotoPlan` endpoints, so a forty-offer batch does not fetch forty descriptions to draw forty collapsed lines. Grouping and filtering are deliberately **different questions**: an offer is *grouped* under the `(area, year)` pair every copy shares (else **Mixed**, which the area rail carries as its own entry via `AreaFilterSidebar`'s `extraEntry`), but it *matches* an area filter when every copy is inside that subtree — so a year-spanning offer is Mixed yet still appears under its area. A copy's area is its stamp's **primary** area link and its year is `stamp.issuedYear`, matching the inventory list (#142). Publishing goes through `publishOffer`, which transitions first and writes the URL after, so a refused publication leaves no listing URL behind. Which card is open is **derived, not stored** — a tri-state (`undefined` = nothing chosen for this batch yet → open the first; `null` = the collector shut it → honour that; an id → that card), so the first offer opens on arrival and after any batch change without a `setState`-in-effect. Publishing resolves its successor *before* the mutation, while the published offer is still in the list, and falls back to `undefined` when it was the last.
- A listing **description** (#266) carries a **format** — `plain | html | markdown` (#319; ADR-0019). It is configured on the platform next to the description template it applies to, and **seeded** onto each offer (`Offer.descriptionFormat`), so changing the platform never re-reads a listing already written. Rendering goes `descriptionToUnsafeHtml` (`src/lib/description-format.ts`, pure, DOM-free, unit-tested) → **DOMPurify** in `shared/rendered-description.tsx`; never inject the unsanitised HTML anywhere else. The same sanitised markup is what the copy control puts on `text/html` (with the source on `text/plain`) when copying formatted. The private note (#267) has no format.
- Background work runs **in-process**, started from `src/instrumentation.ts` `register()` — no extra compose service. Two shapes: *periodic* stateless sweeps (the photo orphan GC, #112) and *triggered* jobs queued in a **table** whose row is also the state the UI polls (offer photo generation, #311; ADR-0018). A queued job must be idempotent — `running` rows are requeued at boot — and enqueuing must be a no-op while a run is already queued or in flight. Pin worker state to `globalThis` so `next dev` HMR cannot stack a second interval.

## UI Direction

- Modal dialogs for list actions (add, edit). Build with shared `src/app/dialog-shell.tsx` primitives — do not duplicate dialog header, close, viewport constraint, or height behavior.
- Row-level actions go in a single `⋮` menu, not a cluster of per-row buttons. Use the shared `RowActionsMenu` (`src/app/c/[collectionSlug]/shared/row-actions-menu.tsx`); destructive actions get `danger` + `separatorBefore`. Dialog-opening actions expose `{ action, dialog }` hooks rendered at the row level (see `use-price-details-action.tsx`, `use-inventory-copy-actions.tsx`) so the dialog survives the menu closing. Section-level adds (e.g. + Add area) stay as standalone buttons.
- Config screen placement: **catalog taxonomy** that is set up once (Areas, Catalogs, Conditions) lives in **Settings** tabs; **operational data** touched routinely (Locations) gets its own **Collection** nav page. Both reuse the same adjacency-list tree pattern (`buildTree`, `*-tree-select.tsx`, `RowActionsMenu`) — mirror `areas-panel.tsx` / `locations-panel.tsx` rather than reinventing tree/list/dialog scaffolding.
- Drag-to-reorder lists use the shared kit in `src/app/c/[collectionSlug]/shared/reorder-list.tsx` (`useReorderList`, `InsertionLine`, `DragGrip`, `showLineAt`, `dragStyle`) — the container is the drop target, not the row. `handleOnly` starts a drag only from a row's ⠿ grip, so a stray press on the row body doesn't (offer photo plan, #313).
- Quick-adding a catalog value is one shared dialog (`shared/quick-price-dialog.tsx`) over a `QuickPriceSubject` — a **stamp × condition × certificate**, not a copy. The Copies list, PO intake and sale-lot views pass an `ItemListItem` (it satisfies the shape structurally, a copy carrying its own condition); the Issue list builds one from a stamp-tree node plus the list's **display condition** with certificate = none, matching what the price column renders (#341). `useQuickPriceDialog` returns `{ open, dialog }` and owns the save. The trigger is a **+ catalog value** link in the row's price slot — never a `⋮` entry: pricing belongs where the price is, so every list opens it the same way (#228, #341).
- Tabs inside dialogs are visual grouping only — one logical save action. Dialog height determined by default tab; switching tabs must not change height. Body scrolls, header/footer fixed.
- Prefer in-place editing for fields where inline edits are practical.
- Shared base components for list screens (loading, empty, filters, table, endless scroll).
- Use semantic color tokens from `src/app/globals.css` for UI intent. New tokens must have values in both `:root` (light) and `.dark` blocks.
- URL state for navigation/filters/sorting/pagination; toast for ephemeral feedback.
- Printable views (#330, the sale packing list) are their own route rendering a plain server-side sheet — no filters, no lazy loading — because the artifact is the printout, not an interactive screen. Print support lives in `globals.css`: mark app chrome and on-screen controls `.no-print`, wrap the sheet in `.print-sheet` (drops screen padding), and rely on the `@media print` block that forces the colour tokens to an ink-friendly light palette (so the dark theme never prints as a black page). Use real `<table>` markup so headers repeat across pages, and `.print-footer` to pin a provenance footer to the foot of the page (fixed in paged media; the sheet reserves the strip with its bottom padding). Which columns a sheet prints is a per-user choice stored **globally** (one `usePersistentString` key holding a CSV of column keys — a stored empty string must read as "all off", which a set of booleans can't express), not scoped to the collection or the record.
- In-location refs (`A234`) are ordered by `compareLocationRef` (`src/lib/location-ref.ts`): prefix first, then the trailing number, separators ignored, blanks last. Use it anywhere refs are sorted — a plain numeric collator disagrees as soon as the separator varies.

## Testing Direction

- `pnpm lint` — run before finishing any task that touches source files.
- `pnpm typecheck` — TypeScript verification.
- `pnpm test:unit` — pure logic only, no Prisma imports.
- `pnpm test:integration` — requires real database via `docker-compose.e2e.yml`. Run before committing schema or domain logic changes.
- Write migration SQL manually. Create directory and `migration.sql` by hand under `prisma/migrations/`. Then `pnpm exec prisma generate`.
- Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` directly. Exception: `pnpm e2e:db:reset` is safe.
- When starting a local dev server for verification, use `pnpm exec next dev --webpack -p 3002` and stop it before finishing.
- Always run the dev server on **webpack** (`next dev --webpack`), never the default Turbopack: Turbopack's dev/HMR leaks memory until the container OOMs (an open, idle browser tab grows the server heap unbounded; webpack plateaus). The `docker-compose.dev.yml` overlay is pinned to `--webpack` for this reason. See issue #161; re-test Turbopack after Next.js upgrades and revert once fixed upstream.
- The user tests the app through Docker Compose. Do not leave dev servers running.

## Before Implementing Features

If a request would require defining product behavior, ask targeted questions first. Good questions are concrete and bounded:

- What is the first workflow we want to support?
- Should catalog numbers be per-standard (Michel, Scott, Fischer) or free-form?
- Should condition follow a standard scale or be free-form?
- Should a collection be shareable with other users?
