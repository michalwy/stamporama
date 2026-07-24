import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // The extension is a separate workspace package with its own tsconfig, chrome globals, and
    // typecheck (`extension/`); the app's Next lint config does not apply to it.
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "extension/**"]
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
