import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// The panel's sources are ES modules. Without "type": "module" in package.json, Node loads each one
// as CommonJS first, fails, reparses it and prints MODULE_TYPELESS_PACKAGE_JSON for every file.
test('panel sources load as ES modules with no warning', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '-e', "await import('./src/apiAnswer.ts')", '--input-type=module'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /MODULE_TYPELESS_PACKAGE_JSON/)
})
