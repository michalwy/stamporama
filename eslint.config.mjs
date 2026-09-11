import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // The extension is a separate workspace package with its own tsconfig, chrome globals, and
    // typecheck (`extension/`); the app's Next lint config does not apply to it.
    // `.claude/**` holds agent scratch space — plans and git worktrees, whose copies of the repo
    // would otherwise be linted a second time (and under paths the `extension/**` ignore misses).
    ignores: [
      ".next/**",
      // The typecheck's copy of `.next/types` and of `next-env.d.ts`, made by
      // `scripts/static-checks.sh` (#881) and generated code like their originals.
      ".next-typecheck/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "extension/**",
      ".claude/**"
    ]
  },
  {
    // No `files:`, so this reaches everything ESLint reads — which is what is wanted, and what is
    // safe here: `@typescript-eslint` is registered by `typescript-eslint`'s own `base` config,
    // which carries no `files:` either, so the rule below resolves for every extension.
    linterOptions: {
      reportUnusedDisableDirectives: "error"
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error"
    }
  },
  {
    // `react-hooks` is the one plugin referenced here that is *not* registered for everything:
    // `eslint-config-next`'s `next` config object registers it under this exact glob, and `cjs` is
    // not in it (`cts` is). A rule naming a plugin that is not registered for the file being linted
    // is a **configuration error** rather than a violation, so it aborts the whole run with exit 2
    // before a line of code is read — an *empty* `.cjs` file anywhere under a linted path was
    // enough, which is what made this a config defect rather than a lint failure (#1126).
    //
    // Of the two candidate fixes this is the narrow one: scope the rule to where its plugin exists,
    // rather than widen the glob `eslint-config-next` registers its plugins under. Widening would
    // run all 67 of that config's React/Next rules over CommonJS scripts that have no React in
    // them, and would mean either reaching into the upstream array's shape or taking a direct
    // dependency on `eslint-plugin-react-hooks` to register it ourselves.
    //
    // `tests/fixtures/lint/commonjs-regression.cjs` is what keeps `pnpm lint` exercising this at
    // all; there is no other `.cjs` file in the repository.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "react-hooks/exhaustive-deps": "error"
    }
  }
];

export default eslintConfig;
