module.exports = {
  // Node CommonJS, not a browser ES module. This declared `env.browser: true`
  // and `sourceType: "module"` for a service that is `require()` top to bottom
  // — so `require`/`module`/`process` were undefined globals and every `window`
  // typo would have linted clean.
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: "airbnb-base",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "script",
  },
  // `npm run lint` is a CI gate now, so each relaxation below is a place where
  // airbnb-base disagrees with something this service does on purpose. They are
  // listed with the reason rather than silenced file by file.
  rules: {
    quotes: ["warn", "double"],

    // Query parameters and Postgres columns are snake_case (the API contract
    // and the schema), so destructuring them binds snake_case names.
    camelcase: "off",

    // Express route handlers legitimately mix `return res.send(...)` for an
    // early exit with a bare `res.send(...)` at the end.
    "consistent-return": "off",

    // This service's log is stdout — `docker logs` is the only place it goes.
    "no-console": "warn",

    // Matches the Python side (ruff line-length = 120) rather than airbnb's
    // 100. Comments are exempt: the swagger JSDoc blocks carry long prose
    // descriptions that read worse hard-wrapped.
    "max-len": [
      "error",
      {
        code: 120,
        ignoreComments: true,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],

    // Express identifies an error handler by ARITY: dropping an unused `next`
    // from a 4-argument handler silently turns it into a normal middleware.
    // ignoreRestSiblings is airbnb's own default and has to be repeated here
    // because this replaces the whole options object: `const { timeMin,
    // ...rest } = req.query` is how routes drop a parameter on purpose.
    "no-unused-vars": [
      "error",
      {
        args: "after-used",
        argsIgnorePattern: "^_|^next$",
        ignoreRestSiblings: true,
      },
    ],

    // Function declarations hoist; the rule's value here is for `const`/`let`.
    "no-use-before-define": ["error", { functions: false }],

    // utils/dbFilter.js holds two small classes that only make sense together.
    "max-classes-per-file": "off",
  },
};
