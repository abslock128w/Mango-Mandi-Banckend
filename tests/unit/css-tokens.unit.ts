import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// design/COMPONENTS.md: spacing in 4 px steps (--space-*), only the token radii (--radius-*).
// Print styles are exempt (paper, in points). 1 and 2 px are hairline offsets, allowed.
const dir = new URL('../../src/styles/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'print.css')
const decls = files.flatMap((f) =>
  readFileSync(new URL(f, dir), 'utf8')
    .split('\n')
    .map((line, i) => ({ where: `${f}:${i + 1}`, m: /^\s*([\w-]+)\s*:\s*([^;]+);/.exec(line) }))
    .filter((d) => d.m)
    .map((d) => ({ where: d.where, prop: d.m![1], value: d.m![2] })),
)

test('panel radii are the tokens', () => {
  const raw = decls.filter((d) => d.prop === 'border-radius' && /\d+px/.test(d.value)).map((d) => `${d.where} ${d.value}`)
  assert.deepEqual(raw, [])
})

test('panel spacing is on the 4 px grid', () => {
  const spacing = /^(padding|margin)(-|$)|^(gap|row-gap|column-gap|top|left|right|bottom|inset)$/
  const off = decls
    .filter((d) => spacing.test(d.prop))
    .flatMap((d) => [...d.value.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)].map((m) => ({ ...d, px: Number(m[1]) })))
    .filter((d) => d.px % 4 !== 0 && d.px !== 1 && d.px !== 2)
    .map((d) => `${d.where} ${d.prop}: ${d.value}`)
  assert.deepEqual(off, [])
})
