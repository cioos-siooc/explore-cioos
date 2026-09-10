import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

// Three runtimes live in this repo, so each gets its own scope: the frontend is
// browser ESM with JSX, web-api is Node CommonJS, test/ is Node ESM.
const shared = {
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": "error",
  "no-use-before-define": ["error", { functions: false }],
  "no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      // `const { [key]: _drop, ...rest } = obj` is how a key gets omitted.
      ignoreRestSiblings: true,
    },
  ],
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.venv/**",
      "**/venv/**",
    ],
  },

  {
    files: ["frontend/**/*.{js,jsx,mjs}"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Vite's `define` substitutes process.env.* at build time.
        process: "readonly",
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ["frontend/**/*.{js,jsx,mjs}"],
    ...react.configs.flat.recommended,
    // The root tooling package intentionally does not depend on React; the
    // application package pins React 18.3. Detection from the root would
    // otherwise warn before ESLint reaches app code.
    settings: { react: { version: "18.3" } },
  },
  reactHooks.configs.flat.recommended,
  {
    files: ["frontend/**/*.{js,jsx,mjs}"],
    rules: {
      ...shared,
      "react/prop-types": "off",
      // All 16 rules in react-hooks/recommended are on. exhaustive-deps is the
      // one kept at "warn" — it is the rule with legitimate exceptions (a
      // debounce, a one-shot, an imperative map command), and each of those is
      // marked with an eslint-disable comment saying which it is.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Vite config runs in Node, not the browser.
    files: ["frontend/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    // Vitest runs with globals: true, so these are ambient in the unit tests
    // and in the helpers under src/test/ that they share.
    files: ["frontend/src/**/*.test.{js,jsx}", "frontend/src/test/**/*.{js,jsx}"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        afterAll: "readonly",
        afterEach: "readonly",
      },
    },
  },
  {
    // The Playwright suite is a set of Node programs that read process.env and
    // the filesystem, but their page.evaluate bodies are browser code, so both
    // sets of globals are in scope for a single file.
    files: ["frontend/e2e/**/*.{js,mjs}"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    files: ["web-api/**/*.js", "web-api/bin/www"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...shared,
      // Express identifies an error handler by ARITY: dropping an unused
      // `next` from a 4-argument handler silently turns it into normal
      // middleware.
      "no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_|^next$",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    files: ["test/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: shared,
  },

  prettier,
];
