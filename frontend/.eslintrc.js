module.exports = {
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
    quotes: [2, 'single', { avoidEscape: true }],
    semi: [2, 'never'],
    'jsx-quotes': [2, 'prefer-single'],
    'prettier/prettier': 'error'
  },
  plugins: ['prettier'],
  settings: {
    react: {
      version: 'detect'
    }
  }
}
