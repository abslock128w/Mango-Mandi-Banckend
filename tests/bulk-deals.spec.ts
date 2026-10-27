import path from 'node:path'
import { expect, navLinkAnyState, openNavTo, test } from './fixtures'
import { confirmItsMe, mockApi } from './mock-api'

// Bulk Deals in the panel. The role check uses the mocked API; the manager's
// journey runs against a real, seeded mango-api (like the day-in-the-life spec)
// and skips unless E2E_EMAIL / E2E_PASSWORD are set.

const PHOTO = path.join(__dirname, '..', 'customer-app', 'tests', 'fixtures', 'mango.jpg')

test('only managers get Bulk Deals', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(navLinkAnyState(page, 'Bulk Deals')).toHaveCount(0)
  await page.goto('/bulk-deals')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
})

test('a manager sees Bulk Deals under Admin', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'MANAGER' })
  await page.goto('/today')
  await expect(await openNavTo(page, 'Bulk Deals')).toHaveAttribute('href', '/bulk-deals')
})

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

test.describe('against mango-api', () => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD and run mango-api to enable')

  test('create, check, add photos, publish, reprice, unpublish and archive a deal', async ({ page }, info) => {
    const title = `Event pack ${info.project.name} ${Date.now()}`
    await page.goto('/login')
    await page.getByLabel('Work email').fill(email!)
    await page.getByLabel('Password').fill(password!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

    await (await openNavTo(page, 'Bulk Deals')).click()
    await expect(page.getByRole('heading', { name: 'Bulk Deals' })).toBeVisible()
    await page.getByRole('button', { name: 'New bulk deal' }).click()
    await expect(page.getByRole('heading', { name: 'New bulk deal' })).toBeVisible()

    // Mistakes show before anything is sent: no product, no name, a dearer bigger tier.
    await page.getByLabel('Minimum boxes').fill('10')
    await page.getByLabel('Tier 1 price per box, rupees').fill('1700')
    await page.getByRole('button', { name: 'Add a tier' }).click()
    await page.getByLabel('Tier 2 starts at, boxes').fill('25')
    await page.getByLabel('Tier 2 price per box, rupees').fill('1800')
    await page.getByRole('button', { name: 'Save draft' }).click()
    const problems = page.getByRole('alert').filter({ hasText: 'Fix these to save' })
    await expect(problems).toContainText('Choose the product (box) this deal sells')
    await expect(problems).toContainText('Tier 2 must cost less per box than tier 1')

    await page.getByLabel('Product (box)').selectOption({ index: 1 })
    await page.getByLabel('Deal name').fill(title)
    await page.getByLabel('Description').fill('Short')
    await page.getByLabel('Tier 2 price per box, rupees').fill('1600')
    await page.getByRole('button', { name: 'Save draft' }).click()
    // A deal sets prices, so the manager confirms it is them.
    await confirmItsMe(page, password!)
    await expect(page).toHaveURL(/\/bulk-deals\/bulk_/)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()

    // Not ready: no photo, and the description is too short. Publish stays off.
    const publishing = page.getByRole('region', { name: 'Publishing' })
    await expect(publishing).toContainText('Add at least one photo')
    await expect(publishing).toContainText('Write a description of at least 20 characters')
    await expect(publishing.getByRole('button', { name: 'Publish' })).toBeDisabled()

    // The preview shows each tier's range.
    const preview = page.getByRole('region', { name: 'Preview' })
    await expect(preview).toContainText('10 to 24')
    await expect(preview).toContainText('25+')

    // Two photos, the second made the main one, then the first removed.
    await page.getByLabel('Add photos').setInputFiles([PHOTO, PHOTO])
    const photos = page.getByRole('region', { name: /Photos/ })
    await expect(photos.getByRole('listitem')).toHaveCount(2)
    await photos.getByRole('button', { name: 'Make main photo 2' }).click()
    await expect(photos.getByRole('listitem').first()).toContainText('Main photo')
    await photos.getByRole('button', { name: 'Remove photo 2' }).click()
    await expect(photos.getByRole('listitem')).toHaveCount(1)

    await page.getByLabel('Description').fill('Full boxes for weddings, offices and big family get-togethers.')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(publishing.getByRole('button', { name: 'Publish' })).toBeEnabled()
    await publishing.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible()
    await expect(publishing).toContainText('Customers can see and buy this deal now.')

    // A live price change asks again, saves, and the history says what changed. The description change above did not ask.
    await page.getByLabel('Tier 2 price per box, rupees').fill('1550')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await confirmItsMe(page, password!)
    const history = page.getByRole('region', { name: 'History' })
    await expect(history).toContainText('Prices or quantities changed')
    await expect(history).toContainText('now 10+ ₹1,700.00, 25+ ₹1,550.00')
    await expect(history).toContainText('Published')
    await expect(history).toContainText('Photo removed')

    await publishing.getByRole('button', { name: 'Unpublish' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click()
    await expect(page.getByText('Unpublished', { exact: true }).first()).toBeVisible()

    await page.getByRole('region', { name: 'Publishing' }).getByRole('button', { name: 'Archive' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive deal' }).click()
    await expect(page.getByText("This deal is archived. It is kept for past orders and can't be changed.")).toBeVisible()
    await expect(page.getByLabel('Deal name')).toBeDisabled()
  })
})
