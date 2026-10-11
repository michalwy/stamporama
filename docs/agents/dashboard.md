# Dashboard Screen

The operational Dashboard at `/c/[collectionSlug]/dashboard` — the work waiting on the collector, in
five sections (#1808; [ADR-0067](../decisions/0067-operational-dashboard.md)). Reverses #397's *no
operational dashboard*; read the ADR before changing what the screen is.

- **Separate from the bell and the Overview** — chosen by the collector on 2026-10-11 over a
  full-screen bell, new bell groups only, or an Overview section. The bell (#367, `ui-shell.md`)
  stays a panel of exceptions graded by severity; the Overview (`overview.md`) stays the picture of
  the collection and keeps *nothing operational*.

- **Sidebar**: the first entry, outside every section and never folded, above Overview — the screen
  opened every day, and entries go by how often they are wanted (#971). `/dashboard` is in no
  `SECTION_ROUTES` entry, so it lights in the accent like Overview (`nav-sections.test.ts` pins it).

- **Five sections, fixed and in this order** (`DASHBOARD_SECTIONS`, `src/lib/dashboard-rules.ts`):
  Sales (#1809), Incoming purchases (#1810), Offers to handle (#1811), Auctions I bid in (#1812),
  Trades (#1813). Each section's `href` is the screen its work is mostly done on: the heading links
  there and the card takes that screen's sidebar tint through `sectionTintForHref`, not a palette of
  its own. A section with no groups yet says so in words, never as a zero.

- **A section is groups, a group is a count and its rows** — `DashboardGroup` is the bell's group
  less severity and collapse, its items the bell's `ActionItem` shape. Rows are capped at
  `DASHBOARD_ROW_LIMIT` with *N more →* to the group's `href`; the count is everything matching.
  Rows come **oldest or most urgent first** — the provider's order, the screen never re-sorts.
  **Every row links to the screen where the thing is dealt with, and nothing is acted on here.**

- **Shared-source rule** (ADR-0067 §3): where a group means what a bell group means, the provider
  reads the bell's derivation and hands it over with `dashboardGroupFromBell`. Any other group reads
  through the function its own screen reads through. Never a second derivation of a set the app
  already computes — that is the drift #397 refused.

- **An empty group is kept**: a provider returns its groups even at zero, and the screen shows them
  collapsed to title and `0` (`isEmptyGroup`). Do not filter empty groups out — the bell does, the
  dashboard deliberately does not.

- **Providers per section** in `src/lib/dashboard.ts` (`SECTION_PROVIDERS`): adding a group is an
  entry there and nothing else. `getDashboardSection` asserts the collection itself as well, so a
  section with no providers still refuses a stranger's collection. One route per section,
  `api/collections/[collectionId]/dashboard/[section]`, and one query per section under its own
  `["dashboard", collectionId, …]` root — nothing invalidates it by hand; it goes stale on the shared
  clock and is read afresh on the next visit.

- **Sales** (#1809): four groups, in this order — the bell's *Sold on Allegro, no sale recorded*
  (`platformSaleGroup` in `action-items.ts`, handed over with `dashboardGroupFromBell`), first because
  it is the step before a sale exists; then *Awaiting payment* (`ordered`), *To pack* (`paid`) and *To
  send* (`packed`). Sent and received sales are done and not shown. The status groups are the Sales
  list's status chips: `listSalesAwaitingFulfilment` reads through `saleListWhere`, the list's own
  filter, and each group links to `sales?status=<status>`; grouping and rows are pure, in
  `dashboard-sales-rules.ts`. A row is aged from when the sale entered its status — the latest
  `SaleStatusEvent` *of that status*, never simply the latest event (two can share an instant, which
  the integration test hit), the sale's creation where there is none — oldest first. Its amount is
  **what the buyer pays**, in the sale's currency (the collector, 2026-10-11): `buyerPaidTotal` where
  that is the anchor (#205), otherwise the lines plus buyer handling — not the list's net in base
  currency, because on an unpaid sale this is the money being waited for.

- **Auctions I bid in** (#1812): *Closing soon* and *Waiting to be closed* are the bell's groups,
  read through `auctionLotWindows` (`action-items.ts`) — the bell's own derivation, exported with
  the lots rather than rows so the dashboard draws its rows with the sale beside the seller
  (`auctionLotRowDetail`, which drops whichever of the two the row has already said). *Won, not yet
  purchased* is the lots list's `notPurchased` filter (#1812): **won**, and the lot itself neither a
  purchase lot nor an expense — a lot-level test, not the sale's status, so a won lot held back from
  its sale's settlement stays until it is moved into a sale and settled. The filter names its own
  outcome and so stands in for the hide-closed default, as picking an outcome does — unlike *To
  review*, which narrows under it (`auctions.md`): every lot in this set is closed, so under the
  default the chip could only ever read 0. The band's `of N` then counts open lots, exactly as it
  already does beside *Won*, and the group's link names `outcome=won` beside it, which also keeps a
  remembered outcome from emptying the list. It reads oldest first and is a chip on the lots toolbar
  labelled `NOT_PURCHASED_LABEL`, the group's own title. Every row opens the lot in its sale.
