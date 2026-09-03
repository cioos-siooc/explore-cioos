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
  overrides: [
    {
      // Vitest runs with globals: true, so describe/it/expect/vi are ambient.
      files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
      env: { 'shared-node-browser': true },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly'
      }
    },
    {
      // The Playwright suite and the config files around it are node programs:
      // they read process.env and the filesystem, and import test/expect
      // explicitly rather than relying on globals.
      files: ['e2e/**/*.{js,mjs}', 'playwright.config.js', 'vite.config.mjs'],
      env: { node: true, browser: true },
      parserOptions: { sourceType: 'module' }
    }
  ],
  settings: {
    react: {
      version: 'detect'
    }
  }
}
