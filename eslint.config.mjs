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
    linterOptions: {
      reportUnusedDisableDirectives: "error"
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  }
];

export default eslintConfig;
