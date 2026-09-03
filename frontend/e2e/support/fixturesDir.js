import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Where the fixtures live, found without import.meta.url.
//
// These modules are loaded two ways: Vitest imports them as ESM, and Playwright
// transpiles them to CJS, where import.meta is a syntax error. Walking up from
// the working directory works under both, and under either runner's cwd.
function findFixtures () {
  let directory = resolve(process.cwd())
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(directory, 'e2e', 'fixtures')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(
    `could not find e2e/fixtures from ${process.cwd()} — run the tests from the frontend directory`
  )
}

export const FIXTURES_DIR = findFixtures()
