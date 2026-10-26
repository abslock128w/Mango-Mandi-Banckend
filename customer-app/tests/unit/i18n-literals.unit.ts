import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

// No English left in the shop's JSX (SHOP_LANGUAGES, docs/languages.md). Every word a
// customer sees goes through useT() and the dictionaries; this reads every .tsx file in
// customer-app/src and fails on text written straight into the markup: JSX text, a text
// attribute (aria-label, title, label, hint, …) given a literal, or a literal shown from
// inside {…} (`{busy ? 'Saving…' : 'Save'}`). Words that are the same in every language
// (the brand, "+91") are in ALLOWED below, each with its reason; text deliberately kept in
// English (the legal text) is marked lang="en" in the markup and skipped. To fix a failure, add the words to customer-app/src/i18n/ (en, hi, kn)
// and show them with t('key').

const SRC = join(import.meta.dirname, '../../src')

/** Attributes whose value a customer reads or hears. */
const TEXT_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'alt',
  'title',
  'placeholder',
  'label',
  'hint',
  'legend',
  'keepLabel',
  'confirmLabel',
  'busyLabel',
  'lessLabel',
  'moreLabel',
  'emptyLabel',
])

/** file (relative to src) → literals allowed there, with the reason. */
const ALLOWED: Record<string, { text: string; why: string }[]> = {
  '*': [
    { text: '+91', why: 'the dialling code, the same in every language' },
    { text: 'MandiMangoes', why: 'the brand stays as it is' },
    { text: '·', why: 'a separator' },
    { text: '—', why: 'a separator' },
    { text: '×', why: 'a multiplication sign' },
    { text: '→', why: 'an arrow' },
    { text: '←', why: 'an arrow' },
  ],
}

interface Hit {
  file: string
  line: number
  text: string
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []))
}

const words = (s: string) => /[A-Za-z]{2,}/.test(s)

/** Literals inside {…} that reach the screen as they are: through ?:, &&, ||, ?? or a template. */
function shownLiterals(node: ts.Node, out: ts.Node[]) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node)
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head)
    for (const span of node.templateSpans) {
      out.push(span.literal)
      shownLiterals(span.expression, out)
    }
  } else if (ts.isParenthesizedExpression(node)) shownLiterals(node.expression, out)
  else if (ts.isConditionalExpression(node)) {
    shownLiterals(node.whenTrue, out)
    shownLiterals(node.whenFalse, out)
  } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    shownLiterals(node.left, out)
    shownLiterals(node.right, out)
  }
}

function literalText(n: ts.Node): string {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) return n.text
  return n.getText()
}

function scan(path: string): Hit[] {
  const file = relative(SRC, path)
  const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const allowed = [...ALLOWED['*'], ...(ALLOWED[file] ?? [])].map((a) => a.text)
  const hits: Hit[] = []
  const report = (node: ts.Node, text: string) => {
    let rest = text.replace(/\s+/g, ' ').trim()
    for (const a of allowed) rest = rest.split(a).join(' ')
    if (words(rest)) hits.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: text.replace(/\s+/g, ' ').trim() })
  }
  const visit = (node: ts.Node) => {
    // Text marked as another language on purpose (the English legal text, lang="en") is left alone.
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'lang')) return
    if (ts.isJsxText(node)) report(node, node.text)
    else if (ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer
      if (ts.isStringLiteral(init)) report(init, init.text)
      else if (ts.isJsxExpression(init) && init.expression) {
        const found: ts.Node[] = []
        shownLiterals(init.expression, found)
        for (const n of found) report(n, literalText(n))
      }
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const found: ts.Node[] = []
      shownLiterals(node.expression, found)
      for (const n of found) report(n, literalText(n))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

test('no English is written straight into the shop JSX', () => {
  const all = files(SRC).flatMap(scan)
  assert.deepEqual(all, [], `Move these words into customer-app/src/i18n (en, hi, kn) and show them with t():\n${all.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join('\n')}`)
})

test('the check finds English when it is there', () => {
  // A guard on the guard: the scanner itself must catch each kind of literal.
  const probe = join(import.meta.dirname, 'i18n-literals.probe.tsx')
  const hits = scan(probe).map((h) => h.text)
  assert.deepEqual(hits, ['Pay now', 'Close the dialog', 'Saving…', 'Save', 'Hello', 'Your basket'])
})
