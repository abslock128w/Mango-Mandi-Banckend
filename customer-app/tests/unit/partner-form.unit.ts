import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applicableSteps,
  buildAnswers,
  checkAnswer,
  fileProblem,
  fileSize,
  initialAnswers,
  isShown,
  keepMatchingAnswers,
  questionMap,
  setAnswer,
  shownQuestions,
  stepOfKey,
  validateStep,
  type Answers,
  type PartnerStep,
} from '../../src/partner-form.ts'
import { partnerNetwork } from '../partner-fixture.ts'

// Partner With Us (docs/partner-network.md): the shop's form rules, run against the API's own
// questionnaire, so the shop stops on the same problems the API would refuse.

const net = await partnerNetwork()
const all = questionMap(net.steps)
const step = (steps: PartnerStep[], key: string) => steps.find((s) => s.key === key)!
const sectionKeys = (steps: PartnerStep[], key: string) => step(steps, key)?.sections.map((s) => s.key)

test('the details step holds only the sections for the ticked categories', () => {
  const none = applicableSteps(net.steps, {})
  // Nothing ticked yet: the details step is still counted, with nothing in it.
  assert.deepEqual(none.map((s) => s.key), ['contact', 'business', 'proposal', 'specifics', 'final'])
  assert.deepEqual(step(none, 'specifics').sections, [])

  const product = applicableSteps(net.steps, { categories: ['PRODUCT_DEVELOPMENT'] })
  assert.deepEqual(sectionKeys(product, 'specifics'), ['product'])
  const two = applicableSteps(net.steps, { categories: ['LOGISTICS', 'SALES_DISTRIBUTION'] })
  assert.deepEqual(sectionKeys(two, 'specifics'), ['sales', 'logistics'])
  // Business collaborations and Other share one section.
  assert.deepEqual(sectionKeys(applicableSteps(net.steps, { categories: ['BUSINESS_COLLAB', 'OTHER'] }), 'specifics'), ['other'])
})

test('a question in two applying sections is asked once, in the first', () => {
  const both = applicableSteps(net.steps, { categories: ['SALES_DISTRIBUTION', 'RETAIL_RESELLER'] })
  const keys = step(both, 'specifics').sections.flatMap((s) => s.questions.map((q) => q.key))
  assert.equal(keys.filter((k) => k === 'monthlyVolume').length, 1)
  assert.ok(step(both, 'specifics').sections[0].questions.some((q) => q.key === 'monthlyVolume'))
  // Retail alone still asks it.
  const retail = applicableSteps(net.steps, { categories: ['RETAIL_RESELLER'] })
  assert.ok(step(retail, 'specifics').sections[0].questions.some((q) => q.key === 'monthlyVolume'))
})

test('showIf: prior experience only after a yes, the business name only for a business', () => {
  const priorExperience = all.get('priorExperience')!
  assert.equal(isShown(priorExperience, {}), false)
  assert.equal(isShown(priorExperience, { priorCollab: false }), false)
  assert.equal(isShown(priorExperience, { priorCollab: true }), true)
  const businessName = all.get('businessName')!
  assert.equal(isShown(businessName, { representsBusiness: 'NO' }), false)
  assert.equal(isShown(businessName, { representsBusiness: 'PLANNING' }), true)
  const proposal = step(applicableSteps(net.steps, {}), 'proposal')
  assert.ok(!shownQuestions(proposal, { priorCollab: false }).some((q) => q.key === 'priorExperience'))
  assert.ok(shownQuestions(proposal, { priorCollab: true }).some((q) => q.key === 'priorExperience'))
})

test('Next checks only the shown questions of the step', () => {
  const contact = step(applicableSteps(net.steps, {}), 'contact')
  const empty = validateStep(contact, initialAnswers(net), all)
  assert.deepEqual(Object.keys(empty), ['fullName', 'mobile', 'email', 'city', 'state', 'pincode', 'preferredContact'])
  assert.equal(empty.fullName.code, 'required')
  assert.equal(empty.state.code, 'choose')
  // The country has a default (India), so it is not missing.
  assert.equal(empty.country, undefined)

  const ok: Answers = { fullName: 'Asha Rao', mobile: '98450 12345', email: 'asha@example.com', city: 'Mysuru', state: 'Karnataka', pincode: '570001', country: 'India', preferredContact: 'WHATSAPP' }
  assert.deepEqual(validateStep(contact, ok, all), {})

  const proposal = step(applicableSteps(net.steps, {}), 'proposal')
  const base: Answers = { categories: ['OTHER'], primaryCategory: 'OTHER', whyUs: 'x'.repeat(25), valueBrought: 'x'.repeat(25), buildTogether: 'x'.repeat(25), hasNetwork: true, priorCollab: false, expectations: 'x'.repeat(25) }
  assert.deepEqual(validateStep(proposal, base, all), {})
  // A yes brings the experience question in, and it is then required.
  assert.equal(validateStep(proposal, { ...base, priorCollab: true }, all).priorExperience.code, 'required')
})

test('each check matches the API', () => {
  const q = (k: string) => all.get(k)!
  assert.deepEqual(checkAnswer(q('fullName'), 'A', {}), { code: 'tooShort', vars: { min: 2 } })
  assert.equal(checkAnswer(q('whyUs'), 'x'.repeat(3001), {})?.code, 'tooLong')
  assert.equal(checkAnswer(q('email'), 'not-an-email', {})?.code, 'email')
  assert.equal(checkAnswer(q('mobile'), '12345', {})?.code, 'phone')
  assert.equal(checkAnswer(q('mobile'), '+91 98450-12345', {}), null)
  assert.equal(checkAnswer(q('yearsOperating'), '2.5', {})?.code, 'wholeNumber')
  assert.equal(checkAnswer(q('yearsOperating'), '200', {})?.code, 'tooLarge')
  assert.equal(checkAnswer(q('pd_cost'), 'ten', {})?.code, 'amount')
  assert.equal(checkAnswer(q('pd_cost'), '1,20,000.50', {}), null)
  assert.equal(checkAnswer(q('hasNetwork'), undefined, {})?.code, 'choose')
  assert.equal(checkAnswer(q('hasNetwork'), false, {}), null)
  assert.equal(checkAnswer(q('categories'), [], {})?.code, 'chooseOne')
  assert.equal(checkAnswer(q('primaryCategory'), 'LOGISTICS', { categories: ['OTHER'] })?.code, 'primaryNotTicked')
  assert.equal(checkAnswer(q('consent'), false, {})?.code, 'consent')
  assert.equal(checkAnswer(q('consent'), true, {}), null)
  // Optional and blank is fine.
  assert.equal(checkAnswer(q('gstin'), '  ', {}), null)
})

test('the PIN code pattern applies only in India', () => {
  const pin = all.get('pincode')!
  const p = checkAnswer(pin, '1234', { country: 'India' }, all)
  assert.equal(p?.code, 'pattern')
  assert.equal(p?.message, 'Enter a 6-digit PIN code')
  assert.equal(checkAnswer(pin, '1234', { country: ' india ' }, all)?.code, 'pattern')
  // A blank country is India (its default).
  assert.equal(checkAnswer(pin, '1234', { country: '' }, all)?.code, 'pattern')
  assert.equal(checkAnswer(pin, 'SW1A 1AA', { country: 'United Kingdom' }, all), null)
  assert.equal(checkAnswer(pin, '570001', { country: 'India' }, all), null)
})

test('the main interest follows the ticked categories', () => {
  let a = setAnswer({}, 'categories', ['LOGISTICS'])
  assert.equal(a.primaryCategory, 'LOGISTICS')
  a = setAnswer(a, 'categories', ['LOGISTICS', 'MARKETING'])
  assert.equal(a.primaryCategory, 'LOGISTICS')
  a = setAnswer(a, 'primaryCategory', 'MARKETING')
  a = setAnswer(a, 'categories', ['LOGISTICS', 'CORPORATE'])
  assert.equal(a.primaryCategory, undefined)
  // A category from the landing page starts ticked and chosen.
  const start = initialAnswers(net, 'CORPORATE')
  assert.deepEqual(start.categories, ['CORPORATE'])
  assert.equal(start.primaryCategory, 'CORPORATE')
  assert.equal(start.country, 'India')
  assert.equal(initialAnswers(net, 'NOT_A_CATEGORY').categories, undefined)
})

test('the submission holds only shown answers, numbers as numbers, and no files', () => {
  const a: Answers = {
    fullName: '  Asha Rao ',
    representsBusiness: 'NO',
    businessName: 'Typed then hidden',
    categories: ['CORPORATE'],
    primaryCategory: 'CORPORATE',
    priorCollab: false,
    priorExperience: 'Typed then hidden as well',
    co_budget: '1,50,000',
    sd_region: 'From a category no longer ticked',
    documents: 'ignored',
    consent: true,
    gstin: '',
  }
  const out = buildAnswers(net.steps, a)
  assert.equal(out.fullName, 'Asha Rao')
  assert.equal(out.co_budget, 150000)
  assert.equal(out.country, 'India')
  assert.equal(out.consent, true)
  for (const gone of ['businessName', 'priorExperience', 'sd_region', 'documents', 'gstin']) assert.ok(!(gone in out), gone)
})

test('a 400 field is found on its step', () => {
  const steps = applicableSteps(net.steps, { categories: ['MARKETING'] })
  assert.equal(stepOfKey(steps, 'email'), 0)
  assert.equal(stepOfKey(steps, 'whyUs'), 2)
  assert.equal(stepOfKey(steps, 'mk_audience'), 3)
  assert.equal(stepOfKey(steps, 'consent'), 4)
  assert.equal(stepOfKey(steps, 'lg_fleet'), -1)
})

test('after QUESTIONNAIRE_CHANGED only answers that still fit are kept', () => {
  const kept = keepMatchingAnswers(net.steps, net.categories.filter((c) => c.code !== 'OTHER'), {
    fullName: 'Asha',
    state: 'Karnataka',
    preferredContact: 'PIGEON',
    categories: ['OTHER', 'LOGISTICS'],
    primaryCategory: 'OTHER',
    lg_services: ['COLD_CHAIN', 'TELEPORT'],
    hasNetwork: true,
    removedQuestion: 'x',
  })
  assert.deepEqual(kept, { fullName: 'Asha', state: 'Karnataka', categories: ['LOGISTICS'], lg_services: ['COLD_CHAIN'], hasNetwork: true })
})

test('files are checked for type and size before upload', () => {
  assert.equal(fileProblem({ type: 'application/pdf', size: 1000 }, net.uploads), null)
  assert.equal(fileProblem({ type: 'application/zip', size: 1000 }, net.uploads), 'type')
  assert.equal(fileProblem({ type: 'image/png', size: net.uploads.maxFileBytes + 1 }, net.uploads), 'size')
  assert.equal(fileSize(40), '1 KB')
  assert.equal(fileSize(240 * 1024), '240 KB')
  assert.equal(fileSize(1.4 * 1024 * 1024), '1.4 MB')
})
