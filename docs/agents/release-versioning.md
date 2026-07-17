# Release Versioning

- Never assume the last released version from memory or from local git tags — always run `gh release list` fresh, since a release agent can tag a new version mid-session.
- When asked to cut a new version, first review the changes merged since the previous released tag, then decide patch vs minor (`feat:` commits -> minor, `fix:`/`chore:` only -> patch).
- Never bump the major version unless the user explicitly asks for a major bump.
- After tagging and pushing a new version, always create a GitHub Release (`gh release create vX.Y.Z --title vX.Y.Z --generate-notes`) automatically.
- After creating the GitHub Release, move the `latest` git tag to the same commit and force-push it: `git tag -f latest vX.Y.Z && git push origin latest --force`.
- If, after reviewing the changes since the previous tag, a new release does not seem warranted, ask the user for confirmation before deciding either way.
- Always write a proper, human-readable release description instead of relying on bare `--generate-notes` output. Group changes into sections (e.g. Highlights/Fixes/Other), summarize each commit/PR in plain English with its reference number, and keep the auto-generated "Full Changelog" compare link at the end.
- In backlog-review sessions, only suggest a release — do not prepare, tag, push, or create it yourself. Release preparation is handled by a separate dedicated agent.
