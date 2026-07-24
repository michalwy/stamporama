# Stamporama Assistant (browser extension)

Platform-neutral MV3 extension shell (#253, part of #155). It matches marketplace catalog pages
against a Stamporama collection via the Colnect matcher endpoints (#250). Colnect DOM extraction is a
pluggable **platform module** added separately (#249); this package is the shell those modules and
the connection profiles (#251) plug into.

## Build

```bash
cd extension
pnpm install        # first time (from the repo root works too)
pnpm build          # → extension/dist
pnpm dev            # rebuild on change
pnpm typecheck
```

## Load unpacked (Chrome)

1. `pnpm build`.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, choose
   `extension/dist`.
3. In Stamporama: **Settings → Colnect → Assistant tokens → Generate** and copy the token.
4. Open the extension **Options** and enter the instance URL, collection id, and token.

## Try the flow (before #249's Colnect parser exists)

Open the popup → **Load sample refs** → **Preview matches (dry-run)** to see per-item decisions
(`auto` / `needs-confirm` / `skipped`) without writing. **Write auto-matches** and per-candidate
**Use this** perform writes, each behind a confirm that names the active profile/target. Edit the
sample refs in `src/popup/index.ts` to numbers your collection actually holds.

## Layout

- `src/platform/` — the `PlatformModule` interface + registry (Colnect registers here in #249).
- `src/core/` — profile store (single-profile stub for #251), decision types, message contracts.
- `src/background/` — service worker + instance HTTP client (bearer-token, CORS-free background fetch).
- `src/content/` — on-demand extractor bootstrap (consults the registry).
- `src/popup/`, `src/options/` — the generic flow UI and the profile form.

## Boundaries

Multi-profile management / selector / registration (#251, #252), Colnect DOM specifics (#249),
packaging/distribution (#254) are intentionally out of scope here.
