# Platform & Architecture

Stack, collection scoping, routing, RSC boundaries and module rules. **This file is the core and the
index**: the rest of what used to be here is split by topic (#2700) — read the file for what you are
touching. Code comments that cite `platform.md` for one of these topics mean the file named below.

| Touching… | Read |
| --- | --- |
| Sessions, `src/proxy.ts`, sign-in redirects and return addresses | [`platform-auth.md`](platform-auth.md) |
| Prisma: the extended client, the generated client, PostgreSQL, migrations, triggers, `prisma migrate diff` | [`platform-prisma.md`](platform-prisma.md) |
| pnpm, corepack, TypeScript, ESLint, the dev server on webpack | [`platform-toolchain.md`](platform-toolchain.md) |
| Worktree slots and ports; `docker` on the PATH | [`platform-slots-and-docker.md`](platform-slots-and-docker.md) |
| The connection pool, integration-suite isolation, measuring the suites, `Static checks` | [`platform-test-performance.md`](platform-test-performance.md) |
| `MaxListenersExceededWarning`, `scripts/listener-probe.mjs` | [`platform-listeners.md`](platform-listeners.md) |
| Release image, the Pi deploy workflow and runner, `update.sh`, the version label | [`platform-deployment.md`](platform-deployment.md) |

## Core

- Collection-scoped access control: `collectionId` on data, owner has full access, checks live server-side.

- Collection URLs: `/c/[collectionSlug]/...`; slug resolution authorizes by internal `collectionId`.

- Better Auth for authentication.

- SPA-like collection interaction: Next.js App Router as route/auth shell, client-side queries/mutations for rich screens.

- TanStack Query for data fetching. **TanStack Table is not used** — it is in no dependency and no
  source file imports it; list views are built from the shared list-screen components over plain
  markup (`ui-patterns.md`).

- Cursor-backed infinite scrolling for large lists via shared primitives.

- Keep domain logic out of UI components. Keep authorization server-side.

- Explicit module boundaries under `src/`.

- A **server component must not import a value from a `"use client"` module**. Under RSC those exports arrive as *client references*, not as values, and nothing warns: `Math.min(MAX_CARDS, n)` where `MAX_CARDS` came from a client file is `NaN`, which is how the ref-card sheet (#565) printed one card for every count typed — silently, and only once a `count` was in the URL, because the no-count path returned its default before ever touching the constant. A constant both halves read belongs in a **pure `src/lib/` module** neither owns (`MAX_REF_CARDS` / `parseRefCardCount` in `location-ref.ts`, moved there by #569), and the parse belongs there too so a unit test can hold it. The reverse direction — a client component importing a pure module — is fine and is the idiom.

- **A runtime import cycle between `src/lib/` modules fails at module-init time, and neither the type check nor the test suites see it.** #658 closed one — `trade-candidates.ts` → `trade-lines.ts` → `trade-line-actions.ts` → `trade-proposals.ts` → back — and the whole thing typechecked and passed 3598 tests, because `tsx` happened to enter the ring at a module whose constants were already evaluated. Under webpack's RSC graph it entered elsewhere, and a `const` read at module scope from the half-initialized module threw `Cannot access 'X' before initialization` on a route that had nothing to do with the change. Two things follow. Each layered pair here states which side is **above** in its own header (`trade-access.ts`'s no-imports-upward rule, `trade-reservations.ts`'s, `item-valuation.ts`'s) — read those before adding an import, since a module that is imported *by* a lower one is below it whatever its header claims about the domain. And where a rule needs only the *fact* that a record exists, take the ids rather than the read that produces them: `TradeActionSources.unvaluedLineIds` and `proposedLineIds` are that shape, and it is what keeps a low module from reaching up for a high one's read. A cycle is cheap to check for — walk the non-`import type` edges under `src/` and look for a back edge — and worth checking whenever a new domain module is wired into an existing chain.

- **A control character in source is written as an escape, never as a raw byte.** A composite map key is a natural place to want one — `` `${vendorId}\u0000${number}` `` cannot alias another concatenation the way a `-` or a `:` can — and five files had been typing the NUL *literally* into the template. It runs correctly and it typechecks, and the cost lands somewhere else entirely: `grep` and `ripgrep` classify a file holding a 0x00 byte as **binary** and skip it in silence. `grep -n "export" src/lib/issues.ts` answered with nothing at all, on a 2,500-line module exporting fifty-two things, and `rg` said only "binary file matches" — so the module was invisible to every ordinary code search until somebody happened to open it. What makes it dangerous is that the failure looks like an *answer*: a search that returns no hits reads as "this codebase does not have that", which is how `listIssueYearFacets` came to look like it did not exist. `\u0000` is the house spelling (it was already what `offer-title-template.ts` used for `EMPTY_MARK` two lines above the raw ones), it is unambiguous inside a regex literal as well as a string, and unlike `\0` no following digit can turn it into something else. The same goes for `\u0003` and any other invisible sentinel: the point of the character is that data never contains it, and none of that requires the *source file* to contain it either.
