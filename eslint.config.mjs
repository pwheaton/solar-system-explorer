import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

export default defineConfig([
  ...nextVitals,
  {
    // Catch references to things that don't exist (TypeScript does this for
    // .ts/.tsx files; the plain .js/.jsx files need ESLint to).
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.worker, ...globals.node } },
    rules: { "no-undef": "error" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),
]);
