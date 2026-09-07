# The branch ruleset, as an artifact

`main.json` is a normalised snapshot of the branch ruleset that protects `main`. **It is the
record.** Where a sentence anywhere in this repository describes how `main` is protected — in
`AGENTS.md`, in `docs/agents/collaboration.md`, in the comments in `ci.yml`, in a `renovate.json`
`description` — that sentence is a summary, and this file is what it summarises.

Before this file existed, the ruleset lived in this repository only as prose, and prose drifts
silently from the thing it describes. It already had: a sweep found fourteen places asserting the
required-check count as live fact across five files, and `ci.yml` carried three claims about the
ruleset of which two went wrong the moment it changed (#937). A reader had no way to tell a
sentence that was still true from one that used to be.

## The red-is-correct window

**A drift check between this file and GitHub is legitimately red while a ruleset change is in
flight**, and that is the control working rather than failing. The ruleset is changed on GitHub and
the artifact is changed by a pull request, and those two acts cannot be simultaneous — so between
them the two disagree on purpose.

**The fix is never to edit `main.json` to match GitHub.** This file is the *intent*; GitHub is the
current state. Editing the artifact to agree with whatever the API returns converts the control
into a mirror, which is green by construction and can no longer report anything. If you find it
red:

- **A change was in flight** → land the pull request that carries the matching edit. The red goes
  away because the intent and the state agree again, in that order.
- **Nothing was in flight** → somebody changed the ruleset without a pull request. That is the
  finding. Report it; do not absorb it.

This file was committed while the ruleset still had **four** required checks, deliberately, so that
its first drift check was a real comparison against a live ruleset rather than a tautology. #790
adds the fifth (`Closing reference check`) immediately afterwards, and the window above is exactly
the gap between those two landing. A control whose first green is also its first run cannot be
distinguished from one that is incapable of going red (#814).

## What is recorded, and what is stripped

Everything left in `main.json` is a decision somebody made — including the ones nobody made
deliberately, which is half the point of writing it down:

- `bypass_actors: []` — nobody bypasses this, the repository owner included.
- `enforcement: "active"`, `target: "branch"`, `conditions` — it applies to the default branch.
- `deletion`, `non_fast_forward`, `required_linear_history` — no deleting, no force-pushing, no
  merge commits.
- `pull_request` — `allowed_merge_methods: ["rebase"]`, and `required_approving_review_count: 0`.
- `required_status_checks` — the required contexts by name, and
  `strict_required_status_checks_policy: true`, which is what makes merges serialise here.
- `require_extra_approval_for_unattributed_changes` is kept **precisely because nobody chose it**.
  It is a platform default GitHub adds at ruleset creation; it is `false` here and `true` in a
  sibling repository, which is how it was noticed at all. With zero required approvals and no
  bypass actors it can deadlock a solo repository, since an author cannot approve their own pull
  request. From inside one repository a silent default and a deliberate decision are the same
  bytes — recording it is what makes them different.

Stripped, because none of it is intent: `id`, `node_id`, `created_at`, `updated_at`, `_links`,
`source` (the repository's own name), and `current_user_can_bypass` (which varies by *who is
asking*, so it would never compare equal twice).

**`id` is stripped on purpose, and this is the one worth arguing about.** The ruleset's numeric id
is a fact about which object GitHub happens to be holding, not about what is intended. If the
ruleset were ever deleted and recreated with identical rules, a stored id would go stale for a
change that is not drift — and the obvious repair would be to write the new number into this file,
which is the "edit the artifact to match GitHub" failure above, arriving by a route that looks like
housekeeping. So **the ruleset is resolved by target, never by a stored id.**

## Reproducing it

Resolution by target, in one pipeline. The id is discovered at runtime and never written down; the
`jq` guard fails loudly rather than picking one if a second default-branch ruleset ever appears.

```bash
gh api repos/michalwy/stamporama/rulesets --jq '.[] | select(.target == "branch") | .id' \
| while read -r id; do gh api "repos/michalwy/stamporama/rulesets/$id"; done \
| jq -S -s '
    map(select(.conditions.ref_name.include == ["~DEFAULT_BRANCH"]))
    | if length != 1 then error("expected exactly one default-branch ruleset, found \(length)") else .[0] end
    | del(.id, .node_id, .created_at, .updated_at, ._links, .source, .current_user_can_bypass)
    | .rules |= sort_by(.type)
    | (.rules[] | select(.type == "required_status_checks").parameters.required_status_checks) |= sort_by(.context)
  ' > .github/rulesets/main.json
```

The two-step fetch is not clumsiness: the list endpoint does not return `conditions` or `rules`, so
selecting the right ruleset by what it *does* requires fetching each candidate.

**The normalisation contract**, so that any comparison tool agrees with this file rather than
merely happening to:

- **Object keys sorted** at every level (`jq -S`), so the file does not churn when GitHub changes
  the order it serialises fields in.
- **`rules[]` sorted by `type`**, and **`required_status_checks[]` sorted by `context`**. Neither
  order is semantic, so sorting costs nothing and makes a diff mean something.
- **2-space indent, one trailing newline** — `jq`'s defaults, so the pipeline above needs no
  formatting flags.
- Re-running the pipeline over an unchanged ruleset must produce a **byte-identical** file. That is
  the property to check first if a comparison disagrees for reasons that look like formatting.

## Not in scope here

**Nothing in this repository's CI checks this file against GitHub.** Wiring a drift check into
`ci.yml` is a separate decision with its own cost — it would add a required context, on top of the
one #790 is already adding — and it was deliberately left out of #937. The comparison tooling
exists outside this repository. Until that decision is taken, this file is verified by a person
re-running the pipeline above.
