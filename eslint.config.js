import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `android` and `ios` are tracked native projects, but everything JS inside
  // them is generated: the copied web bundle under `assets/public` /
  // `App/App/public`, Capacitor's `native-bridge.js`, and Gradle build
  // intermediates. Linting a build artifact reports on code this repository does
  // not author and fails on directives it does not control.
  // `.codex` is another tool's scratch directory: it vendors third-party
  // plugin sources that this repository neither authors nor controls, and
  // linting them fails `npm run verify` on rules they were never written for.
  // Same reasoning as `android`/`ios` above.
  { ignores: ["dist", "node_modules", "_original", "android", "ios", ".codex", ".kiro"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": "off"
    },
  }
);
