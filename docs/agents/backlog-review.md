# Backlog Review

When asked to review the backlog and propose next steps:

- Always start with `gh issue list --state open --limit 100` to get the full picture. Never rely on recently closed issues or git log alone — new issues can appear at any time.
- Always check `gh release list` fresh to know the current version. Never assume it from memory or a prior git log in the same session.
- Present results in two sections:
  - **Najbliższe** (2–3 next sessions): three-column table with columns `Sesja`, `Temat` (short theme label), `Opis` (issue links + description, `<br>`-separated when multiple), and `Dlaczego?` (one sentence rationale). No separate Issues column — embed issue links in Opis.
  - **Dalsze** (beyond that): table with columns `Track`, `Opis`, `Dlaczego?` — high-level track descriptions only, no per-session breakdown.
- Before proposing session order for near-term issues, check the "Depends on" section of each issue body (`gh issue view <n> --json body`). Never schedule an issue before its open dependencies are closed.
- Do not ask the user which direction to pursue — just present the plan and let them redirect.
- Proactively suggest when it is a good time to cut a release: after a coherent batch of shippable commits has accumulated since the last tag. Only suggest — do not cut the release yourself; that is handled by a separate agent.
- **Sweep the worktrees.** Run `git worktree list`, then `git worktree prune`, and remove what is stale — a worktree whose branch has already merged, or whose work was dropped; delete the local branch with it, and the remote one too if nothing landed. Two orphaned worktrees from 27 August were found by hand during #780, which is exactly the manual step this sweep exists to replace: a worktree nobody removed holds a port and a database permanently, and the cost surfaces weeks later in an unrelated session as a failure with no visible cause. Report a worktree that is still locked or still has uncommitted changes rather than removing it — it may be a session that is still running.
- **Check that the collaboration model still describes what happens** (`collaboration.md`), and report what you find as a finding rather than quietly fixing it: did a task session stall waiting on the lead, and for how long; did the lead answer something that is not written down anywhere; did anything reach `main` without the user's explicit go-ahead; did a task session open an issue, close one, or merge a pull request; are there `task/` branches left over from work that has already landed.
