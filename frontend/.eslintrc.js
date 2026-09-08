module.exports = {
  root: true,
  env: {
    browser: true,
    es6: true
  },
  extends: ['standard', 'plugin:react/recommended', 'prettier'],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    indent: ['error', 2],
    quotes: [2, 'single', { avoidEscape: true }],
    semi: [2, 'never'],
    'jsx-quotes': [2, 'prefer-single'],
    'react/prop-types': 0,
    // react-hooks is registered (below) so the `eslint-disable-next-line
    // react-hooks/exhaustive-deps` already in useHarvestFetch.js names a rule
    // that exists — an unknown rule in a disable comment is itself an error.
    //
    // Both rules are OFF rather than enabled: turning on
    // plugin:react-hooks/recommended reports 57 pre-existing findings (54
    // exhaustive-deps, 3 rules-of-hooks). The three rules-of-hooks ones look
    // like genuine bugs. Fixing them changes render behaviour, so they are
    // their own task — see TODO-cde-revisions.md — not something to slip into
    // the change that made `npm run lint` a CI gate.
    'react-hooks/rules-of-hooks': 'off',
    'react-hooks/exhaustive-deps': 'off'
  },
  plugins: ['prettier', 'react-hooks'],
  settings: {
    react: {
      version: 'detect'
    }
  }
}
