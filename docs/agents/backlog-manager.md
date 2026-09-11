# Backlog Manager

The user brings an idea, a remark, a complaint or a bug; a backlog-manager session turns it into one
or more GitHub issues. **It writes no code and touches no branch.**

## Before writing anything, search

```bash
gh issue list --state all --search "<keywords>" --limit 50
```

Much of this backlog is already planned in tracks, and a "new" idea is often a child that an earlier
design already named. Say what you found: an existing issue to amend beats a duplicate, and a
duplicate filed against a closed issue is worse than either.

**Never edit a closed issue's body as though it were still open specification.** If a closed issue
needs a correction, the correction is a new issue that references it.

## Split by scope, not by conversation

**Independent scopes become separate issues**, even when the user raised them in one breath. One
issue is one session's work with one *Done when*. Bundling two scopes produces an issue that cannot
be verified, closed or scheduled as a unit.

Conversely, do not shatter a single decision into fragments that nobody can implement alone.

## Ask, or propose a design session

When the ask would require **defining product behaviour** — a catalogue standard, a condition scale,
a workflow, pricing — do not invent it. Ask one concrete, bounded question at a time, or propose a
design session when the decision is large enough that the answer belongs in an ADR plus a set of
child issues.

## The shape of an issue

- **Title**: Conventional Commits — `feat(offers): …`, `fix(catalog): …`, `docs(agents): …`.
- **Labels**, always: `backlog` + a type (`enhancement`, `bug`, `documentation`, `question`) +
  `priority:low|medium|high` when it is known.
- **Body**, in this order, and only the parts that carry something:

``` ### Purpose        why this exists, in the collector's terms ### Scope          the files,
modules and shapes it touches ### Decisions      what was settled and what was deliberately
rejected, dated ### Depends on     open issues that must land first ### Done when      the criterion
the session verifies against, naming the suites ```

**`Done when` is the specification.** It is what the session verifies against and what the user
reads before closing, so it must be checkable rather than aspirational, and it names the suites that
have to pass.

**All GitHub content is in English** — issue titles, bodies, comments and commits — even when the
conversation with the user is in Polish.

**Never a closing keyword** (`Closes`, `Fixes`, `Resolves`) in an issue body: GitHub acts on it and
closes things nobody has verified. Use `Refs #NNN`.

## When an issue changes

Amend the **body**, not only a comment. A *Done when* amended in a comment while the body keeps its
original wording leaves an overtaken specification that looks exactly like a current one, and the
session implementing it verifies against the wrong half. Put the live text in the body and use the
comment to say what changed and why.

## What this session does not do

It does not close issues that were implemented — the session that did the work writes the closing
comment. It does not merge, tag or release. If `gh` cannot create an issue, report that and stop.
