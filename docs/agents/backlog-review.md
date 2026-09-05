# Backlog Review

When asked to review the backlog and propose next steps:

- Always start with `gh issue list --state open --limit 100` to get the full picture. Never rely on recently closed issues or git log alone — new issues can appear at any time.
- Always check `gh release list` fresh to know the current version. Never assume it from memory or a prior git log in the same session.
- Present results in two sections:
  - **Najbliższe** (2–3 next sessions): three-column table with columns `Sesja`, `Temat` (short theme label), `Opis` (issue links + description, `<br>`-separated when multiple), and `Dlaczego?` (one sentence rationale). No separate Issues column — embed issue links in Opis.
  - **Dalsze** (beyond that): table with columns `Track`, `Opis`, `Dlaczego?` — high-level track descriptions only, no per-session breakdown.
- Before proposing session order for near-term issues, check the "Depends on" section of each issue body (`gh issue view <n> --json body`). Never schedule an issue before its open dependencies are closed.
- Do not ask the user which direction to pursue — just present the plan and let them redirect.
- Proactively suggest when it is a good time to cut a release: after a coherent batch of shippable commits has accumulated since the last tag. Only suggest — do not cut the release yourself; that is handled by a separate release session, spawned fresh (`release-versioning.md`, `collaboration.md`).
- **Sweep the worktrees**: `git worktree list`, then `git worktree prune`, and remove what is stale — the worktree, its local `task/` branch, and the remote branch too if the work was dropped rather than merged. A merged branch deletes itself on GitHub and the lead removes the worktree it came from (`collaboration.md`), but that is the layer that gets forgotten; this sweep is what makes forgetting it harmless. Two orphaned worktrees from 27 August were found by hand before this rule existed, and a worktree nobody removed holds a slot and a database permanently — the cost surfaces weeks later, in an unrelated session, as a failure with no visible cause.
- **Check that `collaboration.md` still describes what actually happens**, and report what you find as a finding rather than quietly fixing it. Did a task session stall waiting on the lead, and for how long? Did the lead answer something that was not written down anywhere? Did anything reach `main` without the user's explicit go-ahead? Did a task session open an issue, close one, or merge a pull request? The model has one day of practice behind it, and each of these is one of its rules failing in a way that looks like nothing at the time.
