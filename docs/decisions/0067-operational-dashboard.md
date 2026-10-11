# ADR-0067: An Operational Dashboard Beside the Bell

## Status

Accepted. Decided with the collector on 2026-10-11 and built by #1808; its sections are #1809–#1813.
Amends #397's decision that the app has no operational dashboard.

## Context

The work waiting on the collector — sales to chase, pack and send, purchases arriving, offers to
publish or fix, auctions to bid on or settle, trades to send — is spread over the Sales, Intake,
Offers, Auctions and Trades screens. The Action items bell (#367) gathers part of it, but as a small
panel of **exceptions**: it lists what has gone wrong or is about to, graded by severity, and is
empty most of the time.

#397 decided against an operational dashboard for exactly that reason: the bell already aggregated
"needs your attention", and a second list would drift from it. The Overview was kept to holdings,
value and progress, with "nothing operational" on it.

## Decision

### 1. A separate Dashboard screen

A **Dashboard** entry heads the sidebar, outside every section and never folded, above Overview —
entries are ordered by how often the screen is wanted (#971), and this is the one opened every day.
It opens `/c/[slug]/dashboard`, a full-width screen of **five sections in a grid**: Sales, Incoming
purchases, Offers to handle, Auctions I bid in, Trades. What each section holds is its own issue.

**Rejected** (by the collector, 2026-10-11): a full-screen bell, new bell groups only, and a section
on the Overview. The bell is a panel of exceptions and stays one; the Overview is a picture of the
collection and stays one.

### 2. A section is groups, a group is a count and its rows

Each group shows its count and the head of its rows (`DASHBOARD_ROW_LIMIT`, then *N more →*), oldest
or most urgent first. **Every row links to the screen where the thing is dealt with**, and every
group to that screen filtered to exactly its set. **The dashboard decides nothing and acts on
nothing**, the bell's rule: an action taken away from its screen is taken without the context that
makes it the right one.

### 3. Where a group means what a bell group means, both read the same source

This is why #397's objection no longer holds: the drift it worried about is **prevented rather than
accepted**. A dashboard group that means the same as a bell group is the bell's own derivation,
handed over by `dashboardGroupFromBell` (`src/lib/dashboard-rules.ts`), which keeps what the group
*is* and leaves behind its severity and collapse — how the bell's panel reads it. Every other group
reads through the function its own screen reads through, the rule the bell already follows. The bell
itself is unchanged.

### 4. An empty group is shown with its zero

A group with nothing in it stays on screen, collapsed to its title and a zero, so a quiet dashboard
reads as *nothing to do* rather than *nothing loaded*. A provider returns its groups even when empty;
nothing filters them out.

### 5. Shape

The pure shape lives in `src/lib/dashboard-rules.ts`; the reads in `src/lib/dashboard.ts`, as
**providers per section** — the bell's extension point, so filling a section is entries in
`SECTION_PROVIDERS` and the route, the query and the screen never change. Each section is its own
route (`dashboard/[section]`) and query (`["dashboard", collectionId, section]`), so one slow or
failing section leaves the others standing, the Overview's pattern (#649).

## Consequences

- Two surfaces report some of the same states. They agree by construction where they overlap, and
  differ on purpose in what they are: the bell is the worst things, now; the dashboard is all the
  work, by subject.
- The Overview keeps "nothing operational" — the operational screen is this one.
