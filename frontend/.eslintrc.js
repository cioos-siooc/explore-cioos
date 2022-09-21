module.exports = {
  env: {
    browser: true,
    es6: true
  },
  extends: ['standard', 'plugin:react/recommended'],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    quotes: [2, 'single', { avoidEscape: true }],
    semi: [2, 'never'],
    'jsx-quotes': ['error', 'prefer-single']
  },
  settings: {
    react: {
      version: 'detect'
    }
  }
}
