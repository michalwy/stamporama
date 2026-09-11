/**
 * This file exists to be linted, and for nothing else. Do not delete it as stray.
 *
 * `eslint-config-next` registers `react-hooks`, `react`, `import` and `jsx-a11y` under a `files:`
 * glob of `js, jsx, mjs, ts, tsx, mts, cts` — `cjs` is absent, `cts` is present. A config object
 * naming one of those plugins' rules without a `files:` of its own therefore asks ESLint to apply a
 * rule to a `.cjs` file whose plugin is not registered for it, which is a **configuration error**
 * rather than a violation: `pnpm lint` exits 2 before reading a line of code. An empty `.cjs` file
 * reproduced it (#1126), and there was no `.cjs` file in the repository, so the defect sat latent —
 * the next session to add one would have met an abort that looks exactly like a broken toolchain.
 *
 * `eslint.config.mjs` now scopes `react-hooks/exhaustive-deps` to the glob its plugin is registered
 * for. Nothing else in the repository is a `.cjs` file, so without this fixture neither `pnpm lint`
 * nor the `Static checks` job would ever read one again and the regression would be latent a second
 * time. The content is deliberately only this comment: the defect is a configuration error raised
 * before parsing, so what the file *says* is irrelevant and its extension is the whole of the test.
 */
