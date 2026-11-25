import { expect, test, navLinkAnyState, openNavTo, screenLoaded } from './fixtures'
import { confirmItsMe, mockApi } from './mock-api'

// Backend-free walk through every screen against the mocked API.

test('Today shows tiles, aging batches and low stock', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: /3\s*Confirmed/ })).toHaveAttribute('href', '/orders?status=CONFIRMED')
  await expect(page.getByRole('link', { name: /2\s*Open claims/ })).toBeVisible()
  await expect(page.getByText(/Last updated \d\d:\d\d IST/)).toBeVisible()
  // The row's first cell links to the batch; the row itself is read cell by cell.
  await expect(page.getByRole('row', { name: /Alphonso batch.*7 days/ }).getByRole('link', { name: 'Alphonso batch' })).toHaveAttribute('href', /^\/batches\//)
  await expect(page.getByText('Alphonso 5kg Box')).toBeVisible()
})

test('Today: Needs attention appears only when something is wrong, and a failed message can be sent again', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toHaveCount(0)

  api.attention = {
    loop: { lastRunAt: '2026-10-15T04:00:00Z', stale: true, failingSteps: [{ step: 'refunds', since: '2026-10-15T04:00:00Z', error: 'Razorpay 503' }] },
    failedMessages: [
      { id: 'ntf1', kind: 'ORDER_CONFIRMED', phone: '9876••••10', error: 'WhatsApp 400: template not approved', attempts: 6, createdAt: '2026-10-15T03:00:00Z', order: { id: 'o1', number: 'ORD-1042' }, preorderNumber: null },
    ],
    stuckRefunds: [{ type: 'order', id: 'o2', number: 'ORD-1040', requestedAt: '2026-10-15T02:00:00Z' }],
    webhookFailures: [{ id: 'w1', source: 'razorpay', reason: "payment.captured for an order we don't have (order_x)", eventKey: 'evt_1', createdAt: '2026-10-15T03:30:00Z' }],
  }
  await page.reload()
  const card = page.getByRole('region', { name: 'Needs attention' })
  await expect(card).toContainText('The background loop has stopped.')
  await expect(card).toContainText('Sending refunds is failing')
  await expect(card).toContainText('Refund not sent for ORD-1040')
  await expect(card).toContainText('template not approved')
  await expect(card).toContainText('Razorpay webhook problem')
  await card.getByRole('button', { name: 'Send again for ORD-1042' }).click()
  await expect(page.getByText('Message queued to send again')).toBeVisible()
  expect(api.calls.some((c) => c.method === 'POST' && c.path === '/notifications/ntf1/retry')).toBe(true)
})

test('Batches lists batches, flags missing QC, and filters by status in the URL', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/batches')
  await expect(page.getByText('No QC: not sellable yet')).toBeVisible()
  // Chips on a wide screen; a select on a phone.
  const select = page.getByRole('combobox', { name: 'Status' })
  if (await select.isVisible()) await select.selectOption('SELLING')
  else await page.getByRole('button', { name: 'Selling', exact: true }).click()
  await expect(page).toHaveURL(/status=SELLING/)
})

test('Receive batch posts the SKU quantities and opens the new batch', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/batches')
  await page.getByRole('button', { name: 'Receive batch' }).click()
  const dialog = page.getByRole('dialog', { name: 'Receive batch' })
  await dialog.getByLabel(/Alphonso 3kg Box/).fill('20')
  await dialog.getByRole('button', { name: 'Receive batch' }).click()
  await expect(page).toHaveURL(/\/batches\/b-new\?focusQC=1/)
  const post = api.calls.find((c) => c.method === 'POST' && c.path === '/batches')
  expect(post?.body).toMatchObject({ variety: 'Alphonso', lines: [{ sku: 'ALP-3', onHand: 20 }] })
})

test('Batch detail: stock, QC warning, ledger and manager condemn', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move to Exhausted' })).toBeVisible()

  await page.getByLabel('Ripe', { exact: true }).check()
  await page.getByLabel('Good').check()
  await page.getByRole('button', { name: 'Log QC' }).click()
  await expect(page.getByText(/QC already logged today/)).toBeVisible()
  expect(api.calls.find((c) => c.path === '/batches/b1/qc')?.body).toMatchObject({ ripenessRating: 'RIPE', condition: 'GOOD' })

  await page.getByRole('tab', { name: 'Ledger' }).click()
  await expect(page.getByText('+20')).toBeVisible()

  await page.getByRole('button', { name: 'Condemn batch' }).click()
  await page.getByRole('button', { name: 'Condemn and move orders' }).click()
  const result = page.getByRole('dialog', { name: 'Batch condemned' })
  await expect(result).toContainText('moved to other batches')
  await expect(result).toContainText('ORD-1042')
  await expect(result).toContainText('ORD-1043')
})

test('Operators see condemn disabled with the manager hint', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/batches/b1')
  const condemn = page.getByRole('button', { name: /Condemn batch/ })
  await expect(condemn).toBeDisabled()
  await expect(condemn).toHaveAttribute('title', 'Requires manager role')
})

test('Adjust stock requires a reason', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  await page.getByRole('button', { name: 'Adjust ALP-3' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('On hand').fill('18')
  await dialog.getByRole('button', { name: 'Save adjustment' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('A reason is required.')
  await dialog.getByLabel('Reason').fill('2 crushed')
  await dialog.getByRole('button', { name: 'Save adjustment' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.method === 'PATCH' && c.path === '/batches/b1/lines/l1')?.body).toEqual({ onHand: 18, reason: '2 crushed', reasonCode: 'CORRECTION' })
})

test('Adjusting below what is promised records a short arrival', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/batches/b1')
  await page.getByRole('button', { name: 'Adjust ALP-3' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('On hand').fill('3')
  await expect(dialog.getByText('Only 3 of the 5 promised boxes.')).toBeVisible()
  await dialog.getByLabel('Reason').fill('2 boxes short off the truck')
  await dialog.getByRole('button', { name: 'Record short arrival' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Short arrival recorded: moved ORD-1044')).toBeVisible()
  expect(api.calls.find((c) => c.path === '/batches/b1/lines/l1/short-arrival')?.body).toEqual({ onHand: 3, reason: '2 boxes short off the truck', reasonCode: 'RECEIVED' })
  expect(api.calls.some((c) => c.method === 'PATCH' && c.path === '/batches/b1/lines/l1')).toBe(false)
})

test('Exhausting a batch with boxes left is a manager write-off with a reason', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/batches/b1')
  await page.getByRole('button', { name: 'Move to Exhausted' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write off the rest of this batch?' })
  await expect(dialog.getByRole('button', { name: 'Write off 30 boxes' })).toBeDisabled()
  await dialog.getByLabel('Reason').fill('Sold off at the gate')
  await dialog.getByRole('button', { name: 'Write off 30 boxes' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.path === '/batches/b1/status')?.body).toEqual({ status: 'EXHAUSTED', reason: 'Sold off at the gate' })
})

test('Operators cannot write off a batch with boxes left', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/batches/b1')
  const exhaust = page.getByRole('button', { name: 'Move to Exhausted' })
  await expect(exhaust).toBeDisabled()
  await expect(exhaust).toHaveAttribute('title', 'Requires manager role')
})

test('Marking delivered without proof is a manager override with a reason; others use the Deliveries page', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  api.order = { ...api.order, status: 'OUT_FOR_DELIVERY' }
  await page.goto('/orders/o1')
  await page.getByRole('button', { name: 'Mark delivered', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Mark ORD-1042 delivered without proof?' })
  await dialog.getByLabel('Reason').fill('Rider phone died; customer confirmed on a call')
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.path === '/orders/o1/status')?.body).toEqual({
    status: 'DELIVERED', override: true, reason: 'Rider phone died; customer confirmed on a call',
  })
})

test('Operators are not offered Mark delivered', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  api.order = { ...api.order, status: 'OUT_FOR_DELIVERY' }
  await page.goto('/orders/o1')
  await expect(page.getByRole('button', { name: 'Delivery failed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark delivered', exact: true })).toHaveCount(0)
  await expect(page.getByText('Record the delivery on the Deliveries page')).toBeVisible()
})

test('Orders list filters and opens a detail page', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders')
  await expect(page.getByText('2 orders · page 1 of 1')).toBeVisible()
  await page.getByLabel('Search by order number, phone, name or address').fill('ORD-1042')
  await expect(page).toHaveURL(/q=ORD-1042/)
  // Each row's first cell is a real link (the row stays a row for screen readers),
  // and it covers the whole row, so a click on any cell opens the order.
  await expect(page.getByRole('link', { name: 'ORD-1042' })).toHaveAttribute('href', '/orders/o1')
  // (A real mouse click: the link sits on top of the cell, so Playwright's own click would refuse it.)
  // Scroll the row into view first: a mouse click does not scroll, and on a phone the row can sit below the fold.
  const asha = page.getByRole('cell', { name: /Asha Rao/ })
  await asha.scrollIntoViewIfNeeded()
  const cell = (await asha.boundingBox())!
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2)
  await expect(page).toHaveURL(/\/orders\/o1$/)
})

test('Order detail: mark packed waits for allocation; cancelling a paid order refunds it and needs a reason', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/orders/o1')
  await expect(page.getByRole('button', { name: 'Mark packed (allocate first)' })).toBeDisabled()
  await page.getByRole('button', { name: 'Allocate stock' }).click()
  await expect.poll(() => api.calls.some((c) => c.path === '/orders/o1/allocate')).toBe(true)

  await page.getByRole('button', { name: 'Cancel and refund' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel and refund order ORD-1042?' })
  await expect(dialog).toContainText('Stock held for this order will be released.')
  await expect(dialog).toContainText('It goes back to them in full')
  const confirm = dialog.getByRole('button', { name: 'Cancel and refund' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Reason').fill('Truck came short')
  await confirm.click()
  await expect.poll(() => api.calls.find((c) => c.path === '/orders/o1/cancel')?.body).toEqual({ reason: 'Truck came short', refund: true })
  // The refund moves money, so the manager confirms it is them and the same cancel is sent again.
  await confirmItsMe(page)
  await expect
    .poll(() => api.calls.filter((c) => c.path === '/orders/o1/cancel').at(-1)?.body)
    .toEqual({ reason: 'Truck came short', refund: true, confirmCode: 'manager123' })
})

test('only managers can cancel a paid order', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/orders/o1')
  await expect(page.getByRole('button', { name: /Cancel and refund/ })).toBeDisabled()
})

test('Delivered orders never offer a refund', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders/o2')
  await expect(page.getByRole('heading', { name: 'Order ORD-1043' })).toBeVisible()
  await expect(page.getByRole('button', { name: /refund/i })).toHaveCount(0)
})

test('the order page shows the proof of delivery with the rider photo', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders/o2')
  const proof = page.locator('section', { has: page.getByRole('heading', { name: 'Proof of delivery' }) })
  await expect(proof).toContainText('Left with Security at the gate, with a photo')
  await expect(proof).toContainText('by rider@mandimangoes.test')
  await expect(proof.getByRole('link', { name: 'where' })).toHaveAttribute('href', /18\.9438,72\.8231/)
  await expect(proof.getByRole('img', { name: 'Delivery photo taken by the rider' })).toBeVisible()
})

test('Pack list: by order with allocate shortcut, by batch with unallocated section', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/pack-list?date=2026-10-16')
  await expect(page.getByRole('link', { name: 'ORD-1042' })).toBeVisible()
  await expect(page.locator('.pack-order').first()).toContainText('Morning')
  await expect(page.getByRole('button', { name: 'Allocate stock for ORD-1042' })).toBeVisible()
  await page.getByRole('button', { name: 'By batch' }).click()
  await expect(page).toHaveURL(/view=batch/)
  await expect(page.getByRole('heading', { name: 'Not allocated yet' })).toBeVisible()
})

test('Claims: start review and resolve as replacement', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/claims')
  await expect(page.getByRole('img', { name: "Customer's photo 1" })).toBeVisible()
  await page.getByRole('button', { name: 'Start review for ORD-1043' }).click()
  await expect.poll(() => api.calls.some((c) => c.path === '/claims/c1/review')).toBe(true)
  await page.getByRole('button', { name: 'Resolve ORD-1043' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/refund/i)).toHaveCount(0)
  // Nothing is picked for the manager: the button waits for a choice.
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Resolve claim' })).toBeDisabled()
  await dialog.getByLabel(/Replacement/).check()
  await dialog.getByRole('button', { name: 'Approve replacement' }).click()
  await expect.poll(() => api.calls.find((c) => c.path === '/claims/c2/resolve')?.body).toEqual({ resolution: 'REPLACEMENT_APPROVED' })
})

test('Pincodes: add validates six digits; operators cannot delete', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/pincodes')
  await expect(page.getByRole('button', { name: 'Delete 400001' })).toBeDisabled()
  await page.getByRole('button', { name: 'Add pincode' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Pincode').fill('4000')
  await dialog.getByLabel('City').fill('Mumbai')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Pincode must be exactly 6 digits.')
  await dialog.getByLabel('Pincode').fill('400050')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => api.calls.find((c) => c.method === 'POST' && c.path === '/pincodes')?.body).toEqual({ pincode: '400050', city: 'Mumbai' })
})

test('Pincodes: a pincode without a centre is flagged; its centre is checked and saved', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/pincodes')
  await expect(page.getByRole('status').filter({ hasText: 'no centre' })).toContainText('400001, 411001')
  await page.getByRole('button', { name: 'Set centre of 400001' }).click()
  const dialog = page.getByRole('dialog')
  // Latitude and longitude the wrong way round are caught before anything is sent.
  await dialog.getByLabel('Centre latitude').fill('72.8354')
  await dialog.getByLabel('Centre longitude').fill('18.9388')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Latitude must be between 6 and 37.5')
  await dialog.getByLabel('Centre latitude').fill('18.9388')
  await dialog.getByLabel('Centre longitude').fill('72.8354')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => api.calls.find((c) => c.method === 'PATCH' && c.path === '/pincodes/400001')?.body).toEqual({ lat: 18.9388, lng: 72.8354 })
})

test('Dialogs close on Escape and return focus', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/pincodes')
  const open = page.getByRole('button', { name: 'Add pincode' })
  await open.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(open).toBeFocused()
})

test('Order detail: move delivery date posts the new date and slot', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/orders/o1')
  await expect(page.getByText('Morning 07:00–11:00')).toBeVisible()
  await page.getByRole('button', { name: 'Move delivery date' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move order ORD-1042' })
  await dialog.getByLabel('New delivery date').fill('2026-12-01')
  await expect(dialog.getByLabel('Delivery slot')).toHaveValue('slt1')
  await dialog.getByLabel('Delivery slot').selectOption({ label: 'Evening (16:00–20:00)' })
  await dialog.getByRole('button', { name: 'Move order' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.path === '/orders/o1/reschedule')?.body).toEqual({ deliveryDate: '2026-12-01', slotId: 'slt2' })
})

test('Order detail lists the WhatsApp updates sent to the customer', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/orders/o1')
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'WhatsApp updates' }) })
  await expect(card).toContainText('Order confirmed')
  await expect(card).toContainText('Sent')
  await expect(page.getByText('WhatsApp chat')).toBeVisible()
})

test('Planning: managers add and switch off delivery slots', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/planning')
  await expect(page.getByText('Booked: Morning 12 of 40 boxes · Evening 3 boxes')).toBeVisible()
  const table = page.getByRole('region', { name: 'Delivery slots' })
  await expect(table.getByRole('row', { name: /Morning/ })).toContainText('07:00–11:00')

  await page.getByRole('button', { name: 'Add slot' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a delivery slot' })
  await dialog.getByLabel('Name').fill('Late')
  await dialog.getByLabel('Starts').fill('20:00')
  await dialog.getByLabel('Ends').fill('19:00')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('The slot must end after it starts.')
  await dialog.getByLabel('Ends').fill('22:00')
  await dialog.getByLabel('Boxes per day (optional)').fill('10')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.find((c) => c.method === 'POST' && c.path === '/slots')?.body).toEqual({ label: 'Late', startsAt: '20:00', endsAt: '22:00', maxBoxes: 10 })
  await expect(table.getByRole('row', { name: /Late/ })).toBeVisible()

  await page.getByRole('button', { name: 'Switch off Evening' }).click()
  // Switching a slot off asks first and says what happens.
  const off = page.getByRole('dialog', { name: 'Switch off Evening?' })
  await expect(off).toContainText('Orders already booked in it keep their slot.')
  expect(api.calls.some((c) => c.method === 'PATCH' && c.path === '/slots/slt2')).toBe(false)
  await off.getByRole('button', { name: 'Switch off' }).click()
  await expect(off).toHaveCount(0)
  await expect.poll(() => api.calls.find((c) => c.method === 'PATCH' && c.path === '/slots/slt2')?.body).toEqual({ active: false })
})

test('Planning: coverage gaps, closing a day, and manager-only rules', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/planning')
  const grid = page.getByRole('region', { name: /^Stock for/ })
  await expect(grid.getByRole('row', { name: /Alphonso 3kg Box/ })).toContainText('12')
  await expect(grid.getByText('none')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Delivery calendar' })).toContainText('Diwali')

  await page.getByRole('button', { name: 'Change a day' }).click()
  const day = page.getByRole('dialog', { name: 'Change a delivery day' })
  await day.getByLabel('Date').fill('2026-11-01')
  // A new day starts as Open: closing one is a choice, never the default.
  await expect(day.getByLabel('Open')).toBeChecked()
  await day.getByLabel('Closed').check()
  await day.getByLabel('Note (optional)').fill('Bandh')
  await day.getByRole('button', { name: 'Save' }).click()
  await expect(day).toHaveCount(0)
  expect(api.calls.find((c) => c.method === 'PUT' && c.path === '/calendar/2026-11-01')?.body).toEqual({ isOpen: false, maxBoxes: null, note: 'Bandh' })

  await page.getByRole('button', { name: 'Edit rules' }).click()
  const rules = page.getByRole('dialog', { name: 'Edit selling rules' })
  await rules.getByLabel('Order cutoff (hour, IST)').fill('17')
  await rules.getByRole('button', { name: 'Save as new version' }).click()
  // The rules apply to every order: the manager confirms it is them (STEP_UP_ROUTES).
  await confirmItsMe(page)
  await expect(rules).toHaveCount(0)
  await expect(page.getByText('Version 4', { exact: true })).toBeVisible()
  const saved = api.calls.filter((c) => c.method === 'PUT' && c.path === '/config').at(-1)?.body as { rules: { cutoffHourIST: number }; confirmCode: string }
  expect([saved.rules.cutoffHourIST, saved.confirmCode]).toEqual([17, 'manager123'])
})

test("Pre-order plan: a full delivery week, a delayed booking and its order, the bookings filters, and a manager changing one week's kg", async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/preorders')
  await expect(page.getByRole('tab', { name: 'Plan and weeks' })).toHaveAttribute('aria-selected', 'true')
  // The plan's lines and the delivery weeks come from GET /preorder-weeks: the week of 1 Mar is full, 8 Mar has room.
  await expect(page.getByLabel('Alphonso', { exact: true })).toHaveValue('30')
  const weeks = page.locator('section', { has: page.getByRole('heading', { name: 'Delivery weeks' }) })
  await expect(weeks).toContainText('4 bookings wait on the waitlist')
  const week = (label: string) => weeks.getByRole('listitem').filter({ has: page.getByRole('heading', { name: label }) })
  await expect(week('Week of 1 Mar 2027')).toContainText('350 kg booked · 58 pre-orders')
  await expect(week('Week of 1 Mar 2027')).toContainText('Alphonso 210 of 210 kg · full')
  await expect(week('Week of 1 Mar 2027').getByRole('img', { name: 'Kesar: 140 of 140 kg booked' })).toBeVisible()
  const next = week('Week of 8 Mar 2027')
  await expect(next).toContainText('New pre-orders start here')
  await expect(next).toContainText('Alphonso 45 of 210 kg')

  // A manager gives the week of 8 Mar its own Alphonso kg: a preview first, then Apply.
  const change = { weeks: [{ weekStart: '2027-03-08', variety: 'Alphonso', limitKg: 250 }] }
  await next.getByRole('listitem').filter({ hasText: 'Alphonso' }).getByLabel('Expected this week').fill('250')
  await next.getByRole('button', { name: /^Check this week.s change$/ }).click()
  const preview = page.getByRole('dialog', { name: 'Check before you apply' })
  await expect(preview).toContainText('No pre-order is delayed.')
  await expect(preview).toContainText('1 week changes.')
  await expect(preview.getByRole('row', { name: /8 Mar 2027 Alphonso/ })).toContainText('250 kg')
  expect(api.calls.find((c) => c.method === 'POST' && c.path === '/preorder-plan/preview')?.body).toEqual(change)
  await preview.getByRole('button', { name: 'Apply', exact: true }).click()
  // A week's own kg is not a rules change, so no password is asked.
  await expect.poll(() => api.calls.find((c) => c.method === 'POST' && c.path === '/preorder-plan/apply')?.body).toEqual(change)
  await expect(preview).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Done.' })).toContainText('No pre-order was delayed. 1 week changed.')
  await expect(next).toContainText('Alphonso 45 of 250 kg')

  // The Bookings tab: PRE-1001 was delayed a week; PRE-1002 is an order now.
  await page.getByRole('tab', { name: 'Bookings' }).click()
  await expect(page).toHaveURL(/tab=bookings/)
  const list = page.getByRole('region', { name: 'Pre-orders' })
  const pre1001 = list.getByRole('row', { name: /PRE-1001/ })
  await expect(pre1001).toContainText('22 Feb 2027 → 1 Mar 2027')
  await expect(pre1001).toContainText('Delay message: sent')
  await expect(pre1001.getByText('Delayed', { exact: true })).toBeVisible()
  await expect(list.getByRole('row', { name: /PRE-1002/ }).getByRole('link', { name: 'ORD-1042' })).toHaveAttribute('href', '/orders/o1')

  // The filters: chips on a wide screen, a select on a phone; each writes ?filter=.
  const phone = (page.viewportSize()?.width ?? 1280) < 640
  const pick = async (label: string, value: string) =>
    phone ? page.getByLabel('Status', { exact: true }).selectOption(value) : page.getByRole('button', { name: label, exact: true }).click()
  await pick('Delayed', 'delayed')
  await expect(page).toHaveURL(/filter=delayed/)
  await expect(list.getByRole('row', { name: /PRE-1001/ })).toBeVisible()
  await expect(list.getByRole('row', { name: /PRE-1002/ })).toHaveCount(0)
  await pick('Unpaid', 'unpaid')
  await expect(page).toHaveURL(/filter=unpaid/)
  await expect(page.getByText('No pre-orders are unpaid.')).toBeVisible()
})

test("Operators cannot change a week's kg or cancel bookings", async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/preorders')
  await expect(page.getByText('Only a manager can change the plan.')).toBeVisible()
  await expect(page.getByText('Changing the plan: requires manager role.')).toBeVisible()
  // The kg a day and each week's kg are read-only, with no buttons to save or check a change.
  await expect(page.getByLabel('Alphonso', { exact: true })).not.toBeEditable()
  await expect(page.getByRole('button', { name: '10 kg more a day of Alphonso' })).toBeDisabled()
  const weeks = page.locator('section', { has: page.getByRole('heading', { name: 'Delivery weeks' }) })
  await expect(weeks.getByLabel('Expected this week').first()).toBeVisible()
  for (const input of await weeks.getByLabel('Expected this week').all()) await expect(input).not.toBeEditable()
  await expect(page.getByRole('button', { name: /^Save changes/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Check this week/ })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Bookings' }).click()
  await expect(page.getByRole('button', { name: /^Move PRE-1001/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^Cancel and refund PRE-1001/ })).toBeDisabled()
  await expect(page.getByText('Moving or cancelling a pre-order: requires manager role.')).toBeVisible()
  expect(api.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/preorder'))).toEqual([])
})

test('Pre-order plan Bookings: a pre-order bag reads as one bag, not a gift; a gift reads as a gift', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  const base = api.preorders[0]
  // P-180 339 890: a plain pre-order bag of three lines (kind BAG, no recipient), and one gift booked alone.
  const bag = { id: 'pgr_bag', number: 'P180339890', kind: 'BAG' as const, people: 3, total: 389700, position: null }
  for (const [i, n] of ['P180339891', 'P180339892', 'P180339893'].entries())
    api.preorders.push({ ...base, id: `pb${i}`, number: n, delayed: null, message: null, gift: null, group: { ...bag, position: i + 1 } })
  api.preorders.push({ ...base, id: 'pg1', number: 'G100200300', delayed: null, message: null, gift: { recipientName: 'Meera', recipientPhone: '+919000000001', message: null }, group: null })
  await page.goto('/preorders?tab=bookings')
  const list = page.getByRole('region', { name: 'Pre-orders' })
  // The panel shows every number formatted (P-180 339 891).
  for (const n of ['P-180 339 891', 'P-180 339 892', 'P-180 339 893']) {
    const row = list.getByRole('row', { name: new RegExp(`^${n} `) })
    await expect(row.getByText('Bag P-180 339 890', { exact: true })).toBeVisible()
    await expect(row.getByText('Gift', { exact: true })).toHaveCount(0)
  }
  await expect(list.getByRole('row', { name: /^G-100 200 300 / }).getByText('Gift', { exact: true })).toBeVisible()
  await expect(list.getByRole('row', { name: /PRE-1001/ }).getByText('Gift', { exact: true })).toHaveCount(0)
  // The Gift filter keeps gifts and leaves the bag out (as the API).
  if ((page.viewportSize()?.width ?? 1280) >= 640) {
    await page.getByRole('button', { name: 'Gift', exact: true }).click()
    await expect(list.getByRole('row', { name: /^G-100 200 300 / })).toBeVisible()
    await expect(list.getByRole('row', { name: /^P-180 339 891 / })).toHaveCount(0)
  }
})

test("Planning: moving a day's orders checks first, then lists what didn't move", async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/planning')
  await page.getByRole('button', { name: "Move a day's orders" }).click()
  const dialog = page.getByRole('dialog', { name: "Move a day's orders" })
  await dialog.getByLabel('Move orders from').fill('2026-10-17')
  await dialog.getByLabel('To', { exact: true }).selectOption('2026-10-16')
  await dialog.getByLabel('Only these pincodes (optional)').fill('400001, 4000')
  await dialog.getByLabel('Reason').fill('Heavy rain')
  await dialog.getByRole('button', { name: 'Check orders' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Pincodes must be 6 digits, separated by commas.')
  await dialog.getByLabel('Only these pincodes (optional)').fill('400001')
  await dialog.getByRole('button', { name: 'Check orders' }).click()
  await expect(dialog.getByRole('status')).toContainText('2 confirmed orders')
  await dialog.getByRole('button', { name: 'Move 2 orders' }).click()
  const done = page.getByRole('dialog', { name: 'Orders moved' })
  await expect(done).toContainText('1 of 2 orders moved')
  await expect(done.getByRole('link', { name: 'ORD-1044' })).toHaveAttribute('href', '/orders/o3')
  const moves = api.calls.filter((c) => c.path === '/orders/bulk-reschedule')
  expect(moves.map((c) => c.body)).toEqual([
    { fromDate: '2026-10-17', toDate: '2026-10-16', reason: 'Heavy rain', pincodes: ['400001'], dryRun: true },
    { fromDate: '2026-10-17', toDate: '2026-10-16', reason: 'Heavy rain', pincodes: ['400001'] },
  ])
})

test('Deliveries: the rider run by slot and pincode, flagging unpacked orders', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/deliveries?date=2026-10-16')
  await expect(page.getByText('2 orders, 3 boxes. Every order is paid: riders collect nothing.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Morning · 07:00–11:00' })).toBeVisible()
  const stop = page.getByRole('list', { name: 'Morning · 07:00–11:00, 400001' })
  await expect(stop.getByRole('listitem', { name: 'ORD-1042' })).toContainText('12 Marine Drive')
  await expect(stop.getByRole('listitem', { name: 'ORD-1044' })).toContainText('Not packed yet')
  await expect(stop.getByRole('listitem', { name: 'ORD-1042' })).toContainText('9876543210')
  await expect(stop.getByRole('link', { name: 'Call ORD-1042' })).toHaveAttribute('href', 'tel:+919876543210')
  await expect(stop.getByRole('link', { name: 'Map for ORD-1042' })).toHaveAttribute('href', /google\.com\/maps\/search\/.*12%20Marine%20Drive%20opposite%20the%20bus%20stop%20400001/)
  expect(api.calls.some((c) => c.path === '/manifest')).toBe(true)
})

test('a rider starts the run and proves each delivery with the code, or says why it failed', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'RIDER' })
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 18.9438, longitude: 72.8231 })
  await page.goto('/')
  await expect(page).toHaveURL(/\/deliveries/)
  await expect(await openNavTo(page, 'Deliveries')).toBeVisible()
  for (const name of ['Today', 'Orders', 'Pack list', 'Staff']) await expect(navLinkAnyState(page, name)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'rider@mandimangoes.test · Rider' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/deliveries?date=2026-10-16')
  const stop = page.getByRole('list', { name: 'Morning · 07:00–11:00, 400001' })
  // Riders don't open the staff order page.
  await expect(stop.getByRole('link', { name: 'ORD-1042' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start run Morning · 07:00–11:00 (1)' }).click()
  await expect(page.getByText('1 order out for delivery')).toBeVisible()
  await expect(page.getByText('Not sent: ORD-1044 (not packed yet)')).toBeVisible()
  expect(api.calls.find((c) => c.path === '/manifest/dispatch')?.body).toEqual({ date: '2026-10-16', slotId: 'slt1' })

  await stop.getByRole('button', { name: 'Delivered ORD-1042' }).click()
  const dialog = page.getByRole('dialog', { name: 'Deliver ORD-1042' })
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter the 4-digit code the customer gives you.')
  await dialog.getByLabel("Customer's delivery code").fill('1111')
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog.getByRole('alert')).toContainText('That code is not right. 4 tries left.')
  await dialog.getByLabel("Customer's delivery code").fill('4821')
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('ORD-1042 delivered')).toBeVisible()
  const sent = api.calls.filter((c) => c.path === '/orders/o1/delivery').map((c) => c.body)
  const at = { lat: 18.9438, lng: 72.8231 }
  // The attempt number from the manifest goes back with each report, so a late resend can be refused.
  expect(sent).toEqual([{ outcome: 'DELIVERED', code: '1111', ...at, attempt: 1 }, { outcome: 'DELIVERED', code: '4821', ...at, attempt: 1 }])
  // Delivered stops fold away for the rider; the summary and the folded list still show them.
  await expect(page.getByRole('status', { name: 'Run summary' })).toContainText('0 to deliver · 1 delivered · 1 not packed yet')
  await page.getByRole('button', { name: 'Show delivered (1)' }).click()
  await expect(page.getByRole('list', { name: 'Morning · 07:00–11:00, delivered' }).getByRole('listitem', { name: 'ORD-1042' })).toContainText('Delivered')
})

test('a rider records a missed delivery with a reason, and a handover with a photo', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, role: 'RIDER' })
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 18.9438, longitude: 72.8231 })
  api.manifest.runs[0].stops[0].orders[0].status = 'OUT_FOR_DELIVERY'
  await page.goto('/deliveries?date=2026-10-16')
  const stop = page.getByRole('list', { name: 'Morning · 07:00–11:00, 400001' })

  await stop.getByRole('button', { name: 'Delivered ORD-1042' }).click()
  let dialog = page.getByRole('dialog', { name: 'Deliver ORD-1042' })
  await dialog.getByRole('button', { name: 'No code? Leave it with someone and take a photo' }).click()
  await dialog.getByLabel('Photo of the handover').setInputFiles({
    name: 'door.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  })
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Say who took it, or where you left it.')
  await dialog.getByLabel('Who took it, or where you left it').fill('Security at the gate')
  await dialog.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(dialog).toHaveCount(0)
  expect(api.calls.filter((c) => c.path === '/orders/o1/delivery-photos')).toHaveLength(1)
  expect(api.calls.find((c) => c.path === '/orders/o1/delivery')?.body).toEqual({ outcome: 'DELIVERED', photoId: 'dph9', receivedBy: 'Security at the gate', lat: 18.9438, lng: 72.8231, attempt: 1 })

  api.manifest.runs[0].stops[0].orders[0].status = 'OUT_FOR_DELIVERY'
  await page.reload()
  await stop.getByRole('button', { name: "Couldn't deliver ORD-1042" }).click()
  dialog = page.getByRole('dialog', { name: "Couldn't deliver ORD-1042" })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Pick what happened.')
  await dialog.getByLabel('Customer not home').check()
  await dialog.getByLabel('Note (optional)').fill('Called twice')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('ORD-1042 will be tried again on the next delivery day')).toBeVisible()
  expect(api.calls.filter((c) => c.path === '/orders/o1/delivery').at(-1)?.body).toEqual({ outcome: 'FAILED', reason: 'NOT_HOME', note: 'Called twice', lat: 18.9438, lng: 72.8231, attempt: 1 })
})

test('Analytics: season tiles, weekly charts with hover detail, and the tables', async ({ page }) => {
  await mockApi(page, { signedIn: true })
  await page.goto('/analytics')
  await expect(page.locator('.tile', { hasText: 'Boxes sold' })).toContainText('72')
  await expect(page.getByText('10 of 100 received')).toBeVisible()
  await expect(page.getByText('9.5%')).toBeVisible()
  const bar = page.getByRole('group', { name: /Weekly boxes, 3 weeks, highest 52/ })
  await expect(bar).toBeVisible()
  // Hovering a week's bar shows that week's numbers (the drawing is hidden from screen readers; the table has them).
  await bar.locator('.recharts-bar-rectangle').last().hover()
  await expect(bar.locator('.tip')).toContainText('Week of 12 Oct')
  await expect(bar.locator('.tip')).toContainText('52 boxes')
  await expect(page.getByRole('group', { name: /Weekly sales, 3 weeks, highest ₹46,800/ })).toBeVisible()
  const weeks = page.getByRole('region', { name: 'Week by week' })
  await expect(weeks.getByRole('row', { name: /12 Oct/ })).toContainText('52')
  await expect(page.getByRole('region', { name: 'By product' }).getByRole('row', { name: /Alphonso 3kg Box/ })).toContainText('10%')
})

test('Analytics: the week still filling up is not compared, and none the week before reads "New"', async ({ page }) => {
  // Wednesday 25 Nov 2026: the range runs to Sunday 29 Nov, so the week of 23 Nov has no sales yet.
  await page.clock.setFixedTime(new Date('2026-11-25T06:00:00Z'))
  const api = await mockApi(page, { signedIn: true })
  const week = (weekStart: string, boxes: number, revenue: number, claims: number) => ({ ...api.analytics.weeks[1], weekStart, boxes, revenue, orders: boxes ? 10 : 0, claims })
  api.analytics = {
    ...api.analytics, from: '2026-11-09', to: '2026-11-29',
    weeks: [week('2026-11-09', 40, 7_393_600, 0), week('2026-11-16', 84, 15_526_600, 2), week('2026-11-23', 0, 0, 0)],
    totals: { ...api.analytics.totals, boxes: 124, revenue: 22_920_200, claims: 2 },
  }
  await page.goto('/analytics')
  const tile = (label: string) => page.locator('.tile', { hasText: label })
  // The week of 16 Nov against the week of 9 Nov: up, not "−100%" against the empty week of 23 Nov.
  await expect(tile('Sales')).toContainText('+110%')
  await expect(tile('Sales')).toContainText('up 110% on the week of 9 Nov')
  await expect(tile('Boxes sold')).toContainText('+110%')
  await expect(page.locator('.kpis').first()).not.toContainText('−100%')
  // No claims the week before: "New", not a percentage.
  await expect(tile('Claims')).toContainText('New')
})

test('Operators cannot edit selling rules', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/planning')
  await expect(page.getByRole('button', { name: /Edit rules/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Move a day's orders/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Add slot/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Switch off Morning/ })).toBeDisabled()
})

for (const path of ['/today', '/batches', '/batches/b1', '/orders', '/orders/o1', '/pack-list', '/deliveries', '/claims', '/pincodes', '/planning', '/preorders', '/analytics', '/promos', '/products']) {
  test(`${path} has no horizontal page scroll`, async ({ page }) => {
    await mockApi(page, { signedIn: true })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('a packer sees only the pack list, deliveries and order steps', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'PACKER' })
  await page.goto('/')
  await expect(page).toHaveURL(/\/pack-list/)
  await expect(await openNavTo(page, 'Pack list')).toBeVisible()
  await expect(await openNavTo(page, 'Deliveries')).toBeVisible()
  for (const name of ['Today', 'Batches', 'Orders', 'Claims', 'Pincodes', 'Planning', 'Staff']) {
    await expect(navLinkAnyState(page, name)).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: 'packer@mandimangoes.test · Packer' })).toBeVisible()

  await page.goto('/orders/o1')
  await expect(page.getByRole('heading', { name: /^Order ORD-1042/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Move delivery date' })).toHaveCount(0)

  await page.goto('/orders')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
  await page.getByRole('link', { name: 'Go to your home screen' }).click()
  await expect(page).toHaveURL(/\/pack-list/)
})

test('QC staff land on batches and see nothing else', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'QC' })
  await page.goto('/')
  await expect(page).toHaveURL(/\/batches/)
  await expect(await openNavTo(page, 'Batches')).toBeVisible()
  await expect(navLinkAnyState(page, 'Pack list')).toHaveCount(0)
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
})

test('Staff: a manager adds a packer, changes a role and reads the activity log', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/staff')
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Role for manager@mandimangoes.test')).toBeDisabled()

  await page.getByRole('button', { name: 'Add person' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add person' })
  await dialog.getByLabel('Work email').fill('ravi@mandimangoes.test')
  await dialog.getByLabel('First password').fill('short')
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(dialog).toContainText('at least 12 characters')
  await dialog.getByLabel('First password').fill('long-enough-1')
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('ravi@mandimangoes.test added as Packer')).toBeVisible()
  expect(api.calls.find((c) => c.method === 'POST' && c.path === '/staff')?.body).toEqual({ email: 'ravi@mandimangoes.test', role: 'PACKER', password: 'long-enough-1' })
  // Their two-step setup code is shown once, to hand over with the password.
  await expect(page.getByRole('dialog', { name: 'Setup code for ravi@mandimangoes.test' })).toContainText('mnpq-7890')
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

  // A role change is staged and confirmed; Cancel puts the select back.
  const role = page.getByLabel('Role for ops@mandimangoes.test')
  await role.selectOption('RIDER')
  const confirm = page.getByRole('dialog', { name: 'Make ops@mandimangoes.test a Rider?' })
  await expect(confirm).toContainText("They'll be signed out")
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(role).toHaveValue('OPERATOR')
  expect(api.calls.some((c) => c.method === 'PATCH' && c.path.startsWith('/staff/'))).toBe(false)

  await role.selectOption('QC')
  await page.getByRole('dialog', { name: 'Make ops@mandimangoes.test a QC?' }).getByRole('button', { name: 'Make QC' }).click()
  await expect(page.getByText('ops@mandimangoes.test is now QC. They will need to sign in again.')).toBeVisible()

  const log = page.getByRole('region', { name: 'Activity' })
  await expect(log).toContainText('Set order to Packed')
  await expect(log).toContainText('Logged QC')
  await expect(log.getByRole('link', { name: 'Open order' })).toHaveAttribute('href', '/orders/o1')
})

test('Staff is a manager-only screen', async ({ page }) => {
  await mockApi(page, { signedIn: true, role: 'OPERATOR' })
  await page.goto('/today')
  await screenLoaded(page)
  await expect(navLinkAnyState(page, 'Staff')).toHaveCount(0)
  await page.goto('/staff')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
})
