// docs/whatsapp/TEMPLATES.md is written from the registry; it must not drift from the code.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DOC_FILE, render } from '../scripts/whatsapp-templates-doc.mjs'

test('docs/whatsapp/TEMPLATES.md matches the registry (node scripts/whatsapp-templates-doc.mjs)', () => {
  assert.equal(readFileSync(DOC_FILE, 'utf8'), render(), 'run node scripts/whatsapp-templates-doc.mjs and commit the result')
})
