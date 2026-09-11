# The merge gate, as an artifact

**Two files, because the gate has two halves and GitHub keeps them in two places.**

- **`main.json`** — the branch **ruleset** that protects `main`: what may not be done to the branch,
  and which checks must pass.
- **`merge-settings.json`** — the **repository settings** that gate a merge: which merge methods
  exist at all, whether auto-merge and *Update branch* are offered, whether a merged branch deletes
  itself, and which branch is the default.

**Together they are the record.** Where a sentence anywhere in this repository describes how `main`
is protected or how a pull request merges — in `AGENTS.md`, in `docs/agents/collaboration.md`, in the
comments in `ci.yml`, in a `renovate.json` `description` — that sentence is a summary, and these
files are what it summarises.

Everything below about the red-is-correct window, normalisation and the rule against editing an
artifact to match GitHub applies to **both** files. Where only one is meant, it is named.

Before `main.json` existed, the ruleset lived in this repository only as prose, and prose drifts
silently from the thing it describes. It already had: a sweep found the required-check count
asserted as live fact on twenty-two lines across five files, and `ci.yml` carried three claims about the
ruleset of which two went wrong the moment it changed (#937, #790). A reader had no way to tell a
sentence that was still true from one that used to be.

## The red-is-correct window

**A drift check between an artifact and GitHub is legitimately red while a change to it is in
flight**, and that is the control working rather than failing. The ruleset is changed on GitHub and
the artifact is changed by a pull request, and those two acts cannot be simultaneous — so between
them the two disagree on purpose.

**The fix is never to edit the artifact to match GitHub.** The file is the *intent*; GitHub is the
current state. Editing the artifact to agree with whatever the API returns converts the control
into a mirror, which is green by construction and can no longer report anything. If you find it
red:

- **A change was in flight** → land the pull request that carries the matching edit. The red goes
  away because the intent and the state agree again, in that order.
- **Nothing was in flight** → somebody changed the ruleset, or a repository setting, without a pull
  request. That is the finding. Report it; do not absorb it.

`main.json` was committed while the ruleset still had **four** required checks, deliberately, so that
its first drift check was a real comparison against a live ruleset rather than a tautology. #790
adds the fifth (`Closing reference check`) immediately afterwards, and the window above is exactly
the gap between those two landing. A control whose first green is also its first run cannot be
distinguished from one that is incapable of going red (#814).

## The ruleset: what is recorded, and what is stripped

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

**`source_type` is compared and `source` is not, and they are not the symmetry they look like**
(settled across the estate on 2026-09-08). `source_type` is a **policy fact**: `Organization` over
`main` is not a field changing value, it is the artifact no longer describing a ruleset this
repository controls, and that premise change should be the loudest thing the check can say.
`source` is the repository's **own name**, so comparing it would fire the check on a **rename** —
not a policy event at all, and a false positive on the one instrument whose credibility is its
entire value.

**So `source` moves from the input to the output**: `scripts/check-ruleset.mjs` prints the live
`source` whenever `source_type` differs. A diagnostic in the compared set costs a false positive on
every rename; a diagnostic in the failure message costs nothing and is there at the moment the
alarm fires. The message **branches on what is live, never on what the artifact claims**, and says
which way the gate moved:

| live `source_type` | what the message says |
| --- | --- |
| `Repository` | the gate is still this repository's own — **nothing is inherited, the artifact is stale**, and there is no incident in this direction |
| anything else | the gate is administered on the named `source`, where this repository cannot see it change — **an incident, not drift**; do not run `--write` |

**That second sentence is why the first exists.** The upstream implementation of this message had
one direction and used it for both: fed an artifact claiming `Organization` against a live gate
that is `Repository`, it announced that the gate was now inherited — and would have sent somebody
hunting an incident that does not exist, on the first execution of a message written for an
emergency. Reading the code would not have shown it; it reads correctly. Both directions are now
planted as fixtures in `tests/unit/ruleset-drift.test.ts` (dev-agent `rules/R-013`). **The incident
branch cannot be reached against this repository** — `michalwy/stamporama` is owned by a `User`
account, so no organisation ruleset can exist over it — and that is recorded as **unexercised**
rather than assumed working, here, in the script and in `.github/workflow-rules.yaml`.

**`id` is stripped on purpose, and this is the one worth arguing about.** The ruleset's numeric id
is a fact about which object GitHub happens to be holding, not about what is intended. If the
ruleset were ever deleted and recreated with identical rules, a stored id would go stale for a
change that is not drift — and the obvious repair would be to write the new number into this file,
which is the "edit the artifact to match GitHub" failure above, arriving by a route that looks like
housekeeping. So **the ruleset is resolved by target, never by a stored id.**

## The ruleset: reproducing it

Resolution by target, in one pipeline. The id is discovered at runtime and never written down; the
`jq` guard fails loudly rather than picking one if a second default-branch ruleset ever appears.

```bash
tmp=$(mktemp) \
&& gh api repos/michalwy/stamporama/rulesets --jq '.[] | select(.target == "branch") | .id' \
| while read -r id; do gh api "repos/michalwy/stamporama/rulesets/$id"; done \
| jq -S -s '
    map(select(.conditions.ref_name.include == ["~DEFAULT_BRANCH"]))
    | if length != 1 then error("expected exactly one default-branch ruleset, found \(length)") else .[0] end
    | del(.id, .node_id, .created_at, .updated_at, ._links, .source, .current_user_can_bypass)
    | .rules |= sort_by(.type)
    | (.rules[] | select(.type == "required_status_checks").parameters.required_status_checks) |= sort_by(.context)
  ' > "$tmp" \
&& mv "$tmp" .github/rulesets/main.json \
|| { rm -f "$tmp"; false; }
```

The two-step fetch is not clumsiness: the list endpoint does not return `conditions` or `rules`, so
selecting the right ruleset by what it *does* requires fetching each candidate.

**The `length != 1` guard is the other half of that, and the two halves fail together** (#932).
Fold the fetches into one call on the list endpoint and the selector has nothing to match — no
`conditions` come back at all — so `map(select(...))` yields `[]` for a repository whose gate is
intact, which is byte-for-byte what it yields for one that has no ruleset at all. As written the
guard converts that into `error("expected exactly one default-branch ruleset, found 0")` and the
trailing `false` carries it out as a non-zero exit. **Shorten the pipeline and drop the guard with
it — the tempting simplification, since with one fetch the guard looks redundant — and it writes
the empty selection and exits `0`.** *Nothing matched* and *nothing is there* have to be told apart
by something, and here that is the guard rather than the fetch; `docs/agents/collaboration.md`
§ *Verification, not trust* collects the rest of this family.

**The temp file is load-bearing here for the same reason it is in the other pipeline**, and it is
worth saying where this one bites. The `jq` guard exists for the case R-007 calls drift: a second
ruleset appearing that also governs the default branch. A redirection straight at `main.json` opens
and truncates the target *before* `jq` runs, so the guard firing would empty the artifact — at
exactly the moment somebody has found drift and least wants the file gone. It is recoverable from
git, but the reader is then debugging two problems, one of which this document caused. The trailing
`false` is there so a failed derivation does not exit `0` having written nothing; without it the
cleanup is the last command in the list and supplies the status.

**In practice, run `pnpm check:ruleset --write` instead.** It produces byte-identical output — the
unit suite pins that against this very file — and it refuses in the one case the pipeline above
cannot: a token that cannot read `bypass_actors` gets a `200` with the key simply missing, and `jq`
would happily write an artifact without the most security-relevant field in the gate while looking
complete. The pipeline stays here because it is the contract in a form a person can read and check
by eye, not because it is the way to run it.

**The pipeline also selects more narrowly than the script does**, and the script is right.
`select(.conditions.ref_name.include == ["~DEFAULT_BRANCH"])` filters out a second ruleset added as
`refs/heads/*` — which would govern `main` without ever naming it — and then finds exactly one
survivor and reports success. What applies to a branch is the **union** of every ruleset matching
it, so a second one is drift rather than something to filter away; `pnpm check:ruleset` takes every
branch ruleset and fails when there is more than one.

**The script does not need the temporary file, because it never opens the artifact until it has the
bytes to put in it.** Every refusal above exits before the write is reached, and the content is
serialised before the file is touched — so a failed `--write` leaves `main.json` exactly as it was.
Pinned by the case in `tests/unit/ruleset-drift.test.ts` that refuses a write and then asserts the
file is unchanged, because "nothing truncated it" is the kind of property that stays true by
accident until it does not.

**The normalisation contract, and which instrument enforces which half of it.** The recipe is one
recipe, but two different things depend on it and they depend on different properties — so it is
set out as two lists rather than four equal rules (#940).

**What the comparison depends on**, and the whole of what it depends on:

- **Which fields are stripped** — the seven above, argued one at a time.
  `scripts/check-ruleset.mjs` parses both sides and compares the structures, so this is the only
  part of the contract it can see.
- **Nothing else.** `differences()` pairs array elements by identity rather than by position, so key
  order, indentation, the trailing newline, and whether `rules[]` is sorted at all are invisible to
  it. A formatting slip on this side would not fail the daily check.

**What is ours, and is enforced somewhere else entirely** — by
`tests/unit/ruleset-drift.test.ts`, under the required `Unit tests` context. It runs on any pull
request that touches `main.json`, which is not a `*.md` path and so is outside the safe list
`Detect changes` skips the suite for — unlike this README, which is inside it:

- **Object keys sorted** at every level (`jq -S`), so the file does not churn when GitHub changes
  the order it serialises fields in.
- **`rules[]` sorted by `type`**, and **`required_status_checks[]` sorted by `context`**. Neither
  order is semantic, so sorting costs nothing and makes a diff mean something.
- **2-space indent, one trailing newline** — `jq`'s defaults, so the pipeline above needs no
  formatting flags.
- Re-deriving over an unchanged ruleset produces a **byte-identical** file.

**The byte-exact round-trip is worth having whether or not a comparison reads it, which is why the
answer here is two lists rather than a shorter first one.** It is what `--write` rests on: a
`--write` that churned formatting would rewrite the artifact on a ruleset nobody changed, and every
reader afterwards is looking at churn instead of at a decision. And it is what makes this contract
**checkable at all**: a second implementation of it was believed because it produced byte-identical
output (#938), and `scripts/check-ruleset.mjs` is a third, pinned byte-for-byte against this file by
that unit test (#946). A contract that is *complete* and one that is merely *followed by whoever
wrote it* look identical until somebody re-implements it — and no structural comparison can tell
them apart, because everything a structural comparison would use to tell them apart it has already
parsed away.

**So a formatting difference is never evidence that this artifact is stale relative to GitHub.**
That inference is the one this file most needs a reader not to make, because its next step is the
failure everything here exists to prevent: bytes differ → the artifact must be wrong → edit it until
it matches the API. If the bytes differ, the drift check is unaffected and the fault is in the
derivation; the unit suite is what goes red, and it names the divergence. **The repair is
`pnpm check:ruleset --write` after a deliberate ruleset change, and never a hand edit toward
whatever the API happened to return.**

**A neighbouring project's normaliser may strip a superset of these seven, and that is not a
disagreement to reconcile.** The one this contract was first written against strips eight,
`source_type` among them, which this artifact deliberately records (#940, and the argument for
keeping it is above). It produces no false drift, because a normaliser strips from both sides before
comparing — our extra key goes with it. The reverse would matter: a tool comparing a field this
artifact does not record. **What governs here is this contract**, and the tool that reads it is
`scripts/check-ruleset.mjs`.

## The repository settings: what is recorded, and why so few

`merge-settings.json` holds **seven fields and nothing else**. Six of them decide whether a merge is
possible at all; the seventh is what the ruleset's `~DEFAULT_BRANCH` condition resolves to.
`main.json` does not record that, despite appearances — its `"name": "main"` is the ruleset's own
label, and would still read `main` if the default branch were renamed tomorrow. This file is where
the branch name is actually written down:

- `allow_rebase_merge`, `allow_squash_merge`, `allow_merge_commit` — which merge methods exist. The
  ruleset's `allowed_merge_methods: ["rebase"]` narrows this set; it cannot widen it, so the two
  files answer *"can this be squashed"* only when read together.
- `allow_auto_merge` — whether `gh pr merge --auto` is offered at all.
- `allow_update_branch` — whether GitHub will bring a behind branch up to date on its own. This is
  the field the merge loop rests on: `docs/agents/collaboration.md` § *Branches and pull requests* has
  the session that opened a pull request keep it current by hand, because an armed pull request never
  becomes mergeable by itself. Read the value here rather than from that section, which is why it no
  longer states one.
- `delete_branch_on_merge` — whether a merged branch removes itself.
- `default_branch` — the branch name every one of the above is about.

**The enumeration is the design, not a first instalment.** The repository object also carries
`description`, `topics`, star and fork counts, `pushed_at`, and permission fields that differ by
*who is asking*. A snapshot of the whole object could never compare equal twice, and a check that is
noisy is a check people learn to ignore — the same reason the ruleset snapshot strips
`current_user_can_bypass`. Adding a field "while we are here" is how that is undone
(`dev-agent decisions/0004`, whose consequences section says exactly this).

**The filename is part of that defence.** It says *merge*, so a field that has nothing to do with
merging looks out of place in it — which a file called `repository.json` would not.

**A contradiction between this file and `renovate.json` is the failure this exists to make visible.**
`automergeStrategy` there names a merge method, and a method the repository has turned off is a
valid enum value everywhere except here, so no schema can catch it. Today they agree; compare
`automergeStrategy` against the merge-method fields here rather than taking that on trust, because
it is the comparison, not the current answer, that this file exists for. When automerge was silently
impossible for eight
weeks (`collaboration.md`, *Automerge is the one exception*), the config asked for `squash` against
a repository that had already turned it off, and nothing anywhere reported it. That disagreement is
now one a diff can show.

## The repository settings: reproducing it

The same normalisation contract as the ruleset — keys sorted, 2-space indent, one trailing newline,
byte-identical on a re-run over unchanged state.

**Here the byte-exact re-run is not one property among several: it is the whole check.** Nothing
compares this file to anything (*The drift check*, below), so the half the ruleset gets from
`scripts/check-ruleset.mjs` does not exist for `merge-settings.json` at all — a person re-deriving
it and finding no diff is the only instrument it has, and that instrument reads bytes.

```bash
tmp=$(mktemp) \
&& gh api repos/michalwy/stamporama | jq -S '
      {
        allow_rebase_merge, allow_squash_merge, allow_merge_commit,
        allow_auto_merge, delete_branch_on_merge, allow_update_branch,
        default_branch
      } as $s
    | ($s | to_entries | map(select(.value == null) | .key)) as $missing
    | if ($missing | length) > 0
      then error("not returned by the API: \($missing | join(", ")) — the credential cannot see them — an unauthenticated read of a public repository returns 200 without them")
      else $s
      end
  ' > "$tmp" \
&& mv "$tmp" .github/rulesets/merge-settings.json \
|| { rm -f "$tmp"; false; }
```

Two things in that pipeline are deliberate and are the parts to keep if it is ever rewritten.

**The null guard, because "could not read" is not "false".** Measured on 2026-09-08: this
repository is public, so an **unauthenticated** `GET /repos/michalwy/stamporama` returns **200** and
a complete-looking object with all six merge fields simply **absent** — `default_branch` is still
there, which makes the response look fine. A bare `jq '{allow_squash_merge}'` turns that into
`null`: an absent field normalised into a value, so a comparison reports drift on what is really a
credential problem, or matches `false` and reports nothing at all. There is no error to notice,
because nothing errored. The guard names the fields it could not read and exits non-zero. It matters
most for anything running unattended under a credential other than the one the person deriving this
file was using — a scheduled comparison, for instance.

**The temp file, because a guard that fires must not destroy what it was guarding.** A shell
redirection opens its target and truncates it *before* the command runs, so
`gh api … | jq '…' > merge-settings.json` empties the artifact on any failure — the guard included.
Measured, not reasoned about: the target went from 5 bytes to 0. Write to a temporary file and move
it into place only on success.

**And `false` at the end of the cleanup, because otherwise the whole thing exits `0`.** The cleanup
branch is the last command in the list, so without it a failed derivation reports success while
having written nothing — the guard shouts on stderr and the exit status says everything is fine.
That is tolerable for a person watching the terminal and not for anything running unattended, which
is the case that needed the guard in the first place. Both branches were exercised rather than
reasoned about: the artifact survived untouched, no temporary file was left, and the status is
non-zero.

## The drift check

`.github/workflows/ruleset-drift.yml` compares **`main.json`** to the live ruleset **daily at
06:17 UTC**, running `scripts/check-ruleset.mjs` (`pnpm check:ruleset`). It also runs on a pull
request that touches `main.json`, the workflow or the script, and on `workflow_dispatch` (#946).

**It covers the ruleset and not `merge-settings.json`**, which is derived here but compared to
nothing — the state #945 left deliberately, having decided that deriving an artifact and comparing
it are two different acts. So of the two files above, one is checked daily and one is still verified
by a person re-running its pipeline. Extending the check is a follow-up rather than an oversight,
and the null guard in that pipeline is already written for it: a scheduled comparison runs under a
credential that is not the one somebody derived the file with, which is exactly the case that guard
exists for.

**It is advisory, and it is never a required status context.** The reason is not caution and not
cost:

- **A required check cannot see the event this exists to catch.** An unprompted platform write
  belongs to no branch and no pull request, so there is nothing for a pull-request-triggered context
  to run on, however required it is. It would notice the next time somebody happened to open a pull
  request — a human trigger wearing an automation costume. The cron is the load-bearing trigger, not
  a backstop.
- **Required would convert the red-is-correct window above into a total merge freeze**, blocking
  every unrelated pull request in the repository, with `bypass_actors` empty and nobody able to
  escape it — the owner included. The predictable answer to a hard block that is red for a correct
  reason is to edit this file until it matches the platform, which is this artifact defeated from
  the inside.

Making it required would itself be a ruleset change, and therefore the user's decision rather than a
session's.

### What the check could not see, it says

**A check's coverage is a property of the credential it runs under, not of its code**, and the same
script run by two identities verifies different things. So this one reports **three** outcomes and
never two: equal, differs, and **could not see**. It never normalises *absent* to *empty* — that
turns a blind spot into a confident negative.

**The workflow token's blind spot is real and it is in the worst possible field** — which is the
whole reason this job runs under a token of its own. `GITHUB_TOKEN` fetches the ruleset
successfully and GitHub simply omits `bypass_actors` from the response: measured on this repository
on 2026-09-08, an owner token returns `[]`, the workflow token returns no key at all, and every
other field is identical. That field is the *"no bypass for anyone"* clause this whole gate rests
on — an actor able to bypass `main` makes every other line in this file advisory.

**So a gap is declared, not inferred — and today there is no gap to declare.**
`RULESET_READ_TOKEN` is set, the run compares the whole gate including `bypass_actors`, and **the
workflow passes no declaration at all** (#956). The mechanism below stays in the script, unused,
because the next field the platform is observed to redact will need it. It answers in four states:

| state | behaviour |
| --- | --- |
| declared, and absent from the response | excluded, **named on every run**, exit 0 |
| **undeclared**, and absent | not comparable — **exit 1** |
| declared, but actually visible | compared normally, and the run says to drop the declaration |
| `--write`, and absent | **refused**, declaration or not |

Three things make that different from downgrading a failure to a warning. The exclusion is
**written and reviewed in a diff** rather than decided at runtime by the thing being excused.
**Anything undeclared still fails**, so a blind spot cannot grow silently — if the platform redacts
a second field tomorrow, the job goes red. And a declaration that has stopped being true **says so
on the run summary**, not in the log of a green run nobody opens.

**The third property used to be that it retired itself, and that is the one #956 removed.** The
workflow declared the field as
`${{ secrets.RULESET_READ_TOKEN == '' && '--allow-unverifiable=bypass_actors' || '' }}`, evaluated
when the file is parsed, so the declaration disappeared by itself the day the secret arrived. It
worked, with nobody touching it: `workflow_dispatch` run `34201991671` printed *"Verified all 7
recorded fields, including bypass_actors."* **The same expression would have brought the
declaration back the day the secret was deleted** — the check returning to green-and-partial,
passing, naming its exclusion, byte-for-byte the run it had been producing the day before, for an
event nobody reads. With the conditional gone that deletion instead leaves `bypass_actors` absent
and undeclared, which is exit 1. **The removal converts a silent regression into a loud one**;
it is not tidying, and reinstating the conditional undoes it.

**Deletion is the exposure. Expiry is not, and the two look alike.** An expired
`RULESET_READ_TOKEN` is still a *set* secret, so the old conditional passed no declaration on its
account either: the run reached the API call and failed there. Expiry was already loud and needed
nothing, then and now. This is written down because a reader who conflates the two concludes the
conditional was guarding expiry — and puts it back.

The declarable set is an **enumerated allowlist of one**. Not a key-prefix match and not "any
top-level key", because `rules` is a top-level key: `--allow-unverifiable=rules` would exclude every
required context, linear history and the allowed merge methods in a single word and pass, wearing
the appearance of a reviewed concession. A field joins the list when a caller has been *observed*
unable to read it.

**Why a declared gap is allowed to pass at all**, since the instinct is that it should not: a
scheduled check's entire delivery mechanism is the mail GitHub sends when it fails. A job red every
day for a known, permanent, one-action-fixes-it gap makes real drift arrive in the same envelope as
that gap, so a permanently red check does not merely get ignored — it makes red *ambiguous*, which
kills the primary instrument to protect a secondary one.

**The credential that closed the gap is the owner's alone**: a fine-grained token with
`Administration: read` on this repository, stored as the `RULESET_READ_TOKEN` secret. No session and
no lead creates it — or deletes it. While it was missing the check was genuinely partial and said so
on every run, which was the acceptable state; silently partial is not. **Deleting the secret now is
not a return to that acceptable state**: it is a red check, deliberately, because nothing declares
the field any more.

**While CI was declaring `bypass_actors` unchecked, this file went on asserting
`bypass_actors: []`, and that was correct rather than a contradiction to tidy away.** The artifact
is the reviewed *intent*, written by a token that could see the field; a declaration is about *this
caller's* reach. Stripping the field to make the two agree would have lost the intent and made the
credential useless the day it arrived — and it did arrive, to an artifact that was already right.
The reasoning outlives the episode: it is what to do the next time a caller cannot read something
this file records.

**And the coverage question is answered by running it, not by reading it.** Both times this family
of failure was found on the estate it was found by running the check under the *other* identity;
reading the code surfaced neither. So a change to this check is exercised under every credential it
will run with — the workflow token and an owner token — before it is believed. #946 did that, red
under both, on a branch that was allowed to die rather than on the one that merged. #956 did the
same for the removal above, and had to: a change justified entirely by *this failure becomes loud*
is worth nothing until somebody has watched it become loud.

The estate reasoning behind all of the above is dev-agent's `rules/R-004` and `rules/R-007`, and
`decisions/0003` and `decisions/0005`.
