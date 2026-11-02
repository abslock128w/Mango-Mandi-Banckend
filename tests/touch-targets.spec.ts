import { expect, test } from './fixtures'
import { mockApi } from './mock-api'

// On a touch screen every control is at least 44 x 44 px (--tap-min; base.css gives the denser
// sizes only to a mouse on a wide screen). A checkbox counts with its label when the label is the
// bigger target; links inside running text are exempt (WCAG 2.5.8 inline exception).
const small = () => {
  const out: string[] = []
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=checkbox], summary'
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden' || s.display === 'none' || el.closest('[aria-hidden=true], [inert], .sr-only')) continue
    let w = r.width
    let h = r.height
    const label = (el as HTMLInputElement).labels?.[0]
    if (label) {
      const lr = label.getBoundingClientRect()
      w = Math.max(w, lr.width)
      h = Math.max(h, lr.height)
    }
    const inline = el.tagName === 'A' && s.display === 'inline' && /\S/.test((el.parentElement?.textContent ?? '').replace(el.textContent ?? '', '').replace(/[·:,()→\s\d]/g, ''))
    if (!inline && (Math.round(w) < 44 || Math.round(h) < 44)) {
      out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}" ${Math.round(w)}x${Math.round(h)}`)
    }
  }
  return [...new Set(out)]
}

for (const path of ['/today', '/orders', '/pack-list', '/deliveries?date=2026-10-16', '/planning', '/batches', '/preorders', '/warehouse', '/staff', '/reviews']) {
  test(`${path}: every control is at least 44 px on a touch screen`, async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'touch sizes: the phone project')
    await mockApi(page, { signedIn: true })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForTimeout(400)
    expect(await page.evaluate(small)).toEqual([])
  })
}
