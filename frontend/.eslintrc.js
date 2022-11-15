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
    indent: ['error', 2],
    quotes: [2, 'single', { avoidEscape: true }],
    semi: [2, 'never'],
    'jsx-quotes': [2, 'prefer-single'],
    'react/prop-types': 0
  },
  plugins: ['prettier'],
  settings: {
    react: {
      version: 'detect'
    }
  }
}
