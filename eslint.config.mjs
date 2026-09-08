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
    settings: { react: { version: "detect" } },
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
