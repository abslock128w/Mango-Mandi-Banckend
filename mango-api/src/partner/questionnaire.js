// The Partner With Us questionnaire (docs/partner-network.md): the one place the
// form's steps, sections and questions are defined. The shop draws the form from
// it (GET /v1/partner-network), the API checks a submission against it
// (validate below), and every answer is stored with the label it had then, so an
// old enquiry still reads correctly after a question changes.
//
// To change the form: copy the current version into a new entry of
// QUESTIONNAIRES, change that, and point CURRENT_VERSION at it. Never edit a
// version that has been live: submissions name the version they were made with.
//
// A question:
//   key          unique within a version; also the field name in a submission
//   label        what the applicant and staff read
//   type         TEXT TEXTAREA EMAIL PHONE NUMBER SELECT MULTI_SELECT RADIO
//                CHECKBOX BOOLEAN DATE FILE_UPLOAD CURRENCY
//   required     true, or { when } (required only while shown)
//   options      [{ value, label }] for SELECT, MULTI_SELECT and RADIO
//   showIf       { key, in: [values] }: shown only when that answer is one of these
//                (for BOOLEAN answers the values are true/false)
//   column       stored in its own enquiry column as well as in the answers
//   min/max      lengths for text, values for NUMBER and CURRENCY
//   pattern      a regular expression the text must match (with patternMessage)
//   placeholder, description: hints for the form
// A section with `categories` is shown only when one of them is chosen; a
// question key that more than one shown section lists is asked once.

export const QUESTION_TYPES = ['TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'RADIO', 'CHECKBOX', 'BOOLEAN', 'DATE', 'FILE_UPLOAD', 'CURRENCY']

/** The categories the questionnaire knows (their names and descriptions live in partnership_categories). */
export const CATEGORY_CODES = [
  'SALES_DISTRIBUTION', 'FARMERS_SUPPLIERS', 'RETAIL_RESELLER', 'PRODUCT_DEVELOPMENT', 'CORPORATE',
  'BUSINESS_COLLAB', 'MARKETING', 'LOGISTICS', 'OTHER',
]

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]

/** Kinds of supporting document an applicant can upload (after the enquiry is saved). */
export const DOCUMENT_CATEGORIES = {
  BUSINESS_PROFILE: 'Business profile',
  COMPANY_REGISTRATION: 'Company registration',
  PRODUCT_CATALOGUE: 'Product catalogue',
  PRODUCT_PHOTOS: 'Product photographs',
  CERTIFICATIONS: 'Certifications',
  PORTFOLIO: 'Portfolio',
  QUOTATION: 'Quotation',
  OTHER: 'Other',
}

const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }))
const YES_NO_OPEN = opts([['YES', 'Yes'], ['NO', 'No'], ['OPEN', 'Open to discussion']])
const LONG = { min: 20, max: 3000 }
const SHORT = { max: 200 }

/** Every question of version 2026-11-v1, by key. */
const Q1 = {
  // ---- step 1: about you
  fullName: { label: 'Full name', type: 'TEXT', required: true, column: true, min: 2, max: 120, placeholder: 'As you would like us to address you' },
  mobile: { label: 'Mobile number', type: 'PHONE', required: true, column: true, placeholder: '10-digit mobile number', description: 'We do not send a code to check it. Please make sure it is right.' },
  email: { label: 'Email address', type: 'EMAIL', required: true, column: true, max: 200 },
  city: { label: 'City', type: 'TEXT', required: true, column: true, min: 2, max: 80 },
  state: { label: 'State', type: 'SELECT', required: true, column: true, options: opts([...INDIAN_STATES.map((s) => [s, s]), ['Outside India', 'Outside India']]) },
  pincode: {
    label: 'PIN code', type: 'TEXT', required: true, column: true, max: 10, placeholder: '6 digits',
    pattern: '^[1-9][0-9]{5}$', patternMessage: 'Enter a 6-digit PIN code', patternUnlessCountryNot: 'India',
  },
  country: { label: 'Country', type: 'TEXT', required: true, column: true, min: 2, max: 60, default: 'India' },
  preferredContact: { label: 'How should we contact you?', type: 'RADIO', required: true, column: true, options: opts([['PHONE', 'Phone call'], ['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email']]) },

  // ---- step 2: your business
  representsBusiness: { label: 'Are you representing an existing business?', type: 'RADIO', required: true, column: true, options: opts([['YES', 'Yes'], ['NO', 'No'], ['PLANNING', 'Planning to start one']]) },
  businessName: { label: 'Business or organisation name', type: 'TEXT', required: { when: true }, column: true, min: 2, max: 160, showIf: { key: 'representsBusiness', in: ['YES', 'PLANNING'] } },
  businessType: {
    label: 'What type of organisation are you representing?', type: 'SELECT', required: true, column: true,
    options: opts([['PROPRIETORSHIP', 'Proprietorship'], ['PARTNERSHIP', 'Partnership firm'], ['LLP', 'LLP'], ['PRIVATE_LIMITED', 'Private limited company'],
      ['FARMER', 'Farmer / individual producer'], ['ENTREPRENEUR', 'Independent entrepreneur'], ['OTHER', 'Other']]),
  },
  website: { label: 'Website or social media profile', type: 'TEXT', required: false, column: true, max: 300, placeholder: 'https://' },
  yearsOperating: { label: 'How many years have you been operating?', type: 'NUMBER', required: false, column: true, min: 0, max: 150, showIf: { key: 'representsBusiness', in: ['YES'] } },
  gstin: { label: 'GSTIN', type: 'TEXT', required: false, column: true, max: 15, description: 'Optional. Only if your business is registered for GST.', placeholder: '15 characters' },
  businessAddress: { label: 'Business address', type: 'TEXTAREA', required: false, column: true, max: 500, showIf: { key: 'representsBusiness', in: ['YES'] } },

  // ---- step 3: your proposal
  categories: { label: 'What type of partnership are you interested in?', type: 'MULTI_SELECT', required: true, column: true, description: 'Choose all that apply.' },
  primaryCategory: { label: 'Which one matters most?', type: 'RADIO', required: true, column: true, description: 'Your main interest. We route your enquiry by it.' },
  whyUs: { label: 'Why do you want to work with MandiMangoes?', type: 'TEXTAREA', required: true, ...LONG },
  valueBrought: { label: 'What can you bring to the table?', type: 'TEXTAREA', required: true, ...LONG, description: 'Skills, customers, products, places, people or capital.' },
  buildTogether: { label: 'What would you like to build together?', type: 'TEXTAREA', required: true, ...LONG, description: 'The opportunity you see in working with us.' },
  hasNetwork: { label: 'Do you already have an established customer base or business network?', type: 'BOOLEAN', required: true },
  priorCollab: { label: 'Have you previously collaborated with other brands or businesses?', type: 'BOOLEAN', required: true },
  priorExperience: { label: 'Tell us about that experience', type: 'TEXTAREA', required: { when: true }, ...LONG, showIf: { key: 'priorCollab', in: [true] } },
  expectations: { label: 'What are your expectations from MandiMangoes?', type: 'TEXTAREA', required: true, ...LONG },

  // ---- step 4 A: sales and distribution
  sd_region: { label: 'Which state, city or region would you like to operate in?', type: 'TEXT', required: true, ...SHORT },
  sd_customerBase: { label: 'Do you have an existing customer base?', type: 'BOOLEAN', required: true },
  sd_networkType: { label: 'What type of sales network do you operate?', type: 'TEXT', required: false, ...SHORT },
  sd_hasOutlet: { label: 'Do you own or operate a physical retail outlet?', type: 'BOOLEAN', required: true },
  sd_channels: {
    label: 'How do you plan to sell MandiMangoes products?', type: 'MULTI_SELECT', required: true,
    options: opts([['DIRECT', 'Direct sales'], ['RETAIL', 'Retail outlets'], ['ONLINE', 'Online selling'], ['WHOLESALE', 'Wholesale'], ['SOCIAL', 'Social media'], ['NETWORK', 'Independent sales network'], ['OTHER', 'Other']]),
  },
  sd_hasLogistics: { label: 'Do you have existing logistics or delivery infrastructure?', type: 'BOOLEAN', required: true },
  monthlyVolume: { label: 'What approximate monthly sales volume do you expect?', type: 'TEXT', required: true, ...SHORT, placeholder: 'For example, 200 boxes a month' },
  sd_exclusive: { label: 'Are you interested in exclusive regional distribution?', type: 'RADIO', required: true, options: YES_NO_OPEN },
  sd_investment: { label: 'What investment capacity can you allocate, if any?', type: 'CURRENCY', required: false, min: 0, max: 1e10, description: 'Optional. In rupees.' },

  // ---- B: farmers and suppliers
  fs_products: { label: 'What products can you supply?', type: 'TEXTAREA', required: true, min: 3, max: 2000 },
  fs_role: { label: 'Are you the producer, manufacturer, supplier or intermediary?', type: 'RADIO', required: true, options: opts([['PRODUCER', 'Producer / farmer'], ['MANUFACTURER', 'Manufacturer'], ['SUPPLIER', 'Supplier'], ['INTERMEDIARY', 'Intermediary']]) },
  fs_source: { label: 'Where are your products sourced?', type: 'TEXT', required: true, ...SHORT },
  fs_capacity: { label: 'What is your approximate monthly supply capacity?', type: 'TEXT', required: true, ...SHORT, placeholder: 'For example, 5 tonnes a month in season' },
  fs_consistent: { label: 'Can you maintain consistent supply?', type: 'RADIO', required: true, options: opts([['YES', 'Yes'], ['SEASONAL', 'Only in season'], ['NO', 'No']]) },
  fs_certifications: { label: 'Do you have quality certifications?', type: 'TEXT', required: false, ...SHORT, placeholder: 'For example, FSSAI, organic, GAP' },
  fs_samples: { label: 'Can you provide product samples?', type: 'BOOLEAN', required: true },
  fs_price: { label: 'What is your expected procurement price or quotation?', type: 'TEXT', required: false, ...SHORT, placeholder: 'For example, Rs 90 a kg at the farm' },
  fs_packaging: { label: 'Can you support packaging and transportation?', type: 'BOOLEAN', required: true },

  // ---- C: retail and resellers
  rr_businessType: { label: 'What type of business do you operate?', type: 'TEXT', required: true, ...SHORT, placeholder: 'For example, fruit shop, supermarket, online store' },
  rr_location: { label: 'Where is your business located?', type: 'TEXT', required: true, ...SHORT },
  rr_years: { label: 'How long have you been operating?', type: 'TEXT', required: false, max: 60, placeholder: 'For example, 6 years' },
  rr_currentProducts: { label: 'What products do you currently sell?', type: 'TEXTAREA', required: true, min: 3, max: 2000 },
  rr_segments: { label: 'What customer segments do you serve?', type: 'TEXT', required: true, ...SHORT },
  rr_infrastructure: { label: 'Do you have physical or online selling infrastructure?', type: 'RADIO', required: true, options: opts([['PHYSICAL', 'Physical'], ['ONLINE', 'Online'], ['BOTH', 'Both'], ['NONE', 'Neither yet']]) },
  rr_interest: { label: 'What MandiMangoes products interest you?', type: 'TEXT', required: false, ...SHORT },

  // ---- D: product development and expansion (also becomes a product proposal)
  pd_productName: { label: 'What product would you like to introduce?', type: 'TEXT', required: true, min: 2, max: 120 },
  pd_category: { label: 'Which category does it belong to?', type: 'TEXT', required: true, min: 2, max: 80, placeholder: 'For example, fresh fruit, pickles, honey, spices' },
  pd_stage: { label: 'Is this an existing product or a new concept?', type: 'RADIO', required: true, options: opts([['EXISTING', 'Existing product'], ['CONCEPT', 'New concept']]) },
  pd_description: { label: 'Describe the product', type: 'TEXTAREA', required: false, max: 2000 },
  pd_source: { label: 'Where will you source or manufacture it?', type: 'TEXT', required: true, ...SHORT },
  pd_appeal: { label: 'What makes the product commercially attractive?', type: 'TEXTAREA', required: true, ...LONG },
  pd_cost: { label: 'What is the estimated procurement cost?', type: 'CURRENCY', required: false, min: 0, max: 1e9, description: 'In rupees, per unit you would sell.' },
  pd_price: { label: 'What is the expected selling price?', type: 'CURRENCY', required: false, min: 0, max: 1e9, description: 'In rupees, per unit.' },
  pd_capacity: { label: 'What monthly quantity could you supply?', type: 'TEXT', required: false, ...SHORT },
  pd_canManage: { label: 'Can you manage production or sourcing?', type: 'RADIO', required: true, options: opts([['YES', 'Yes'], ['PARTLY', 'Partly'], ['NO', 'No']]) },
  pd_samples: { label: 'Can you provide samples or a product catalogue?', type: 'BOOLEAN', required: true },
  pd_relationships: { label: 'Do you have existing distribution or sourcing relationships?', type: 'TEXTAREA', required: false, max: 2000 },

  // ---- E: corporate and institutional
  co_orgName: { label: 'Organisation name', type: 'TEXT', required: true, min: 2, max: 160 },
  co_orgType: { label: 'Organisation type', type: 'TEXT', required: true, ...SHORT, placeholder: 'For example, hotel, office, school, event company' },
  co_quantity: { label: 'Expected order quantity', type: 'TEXT', required: true, ...SHORT },
  co_requirements: { label: 'Product requirements', type: 'TEXTAREA', required: true, min: 3, max: 2000 },
  co_locations: { label: 'Delivery locations', type: 'TEXT', required: true, ...SHORT },
  co_frequency: { label: 'How often would you order?', type: 'RADIO', required: true, options: opts([['ONCE', 'One time'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['SEASONAL', 'Through the season'], ['FESTIVE', 'Festivals and events']]) },
  co_budget: { label: 'Approximate procurement budget', type: 'CURRENCY', required: false, min: 0, max: 1e10, description: 'Optional. In rupees.' },
  co_additional: { label: 'Additional requirements', type: 'TEXTAREA', required: false, max: 2000 },

  // ---- F: marketing and brand collaborations
  mk_platforms: {
    label: 'Which platforms do you operate on?', type: 'MULTI_SELECT', required: true,
    options: opts([['INSTAGRAM', 'Instagram'], ['YOUTUBE', 'YouTube'], ['FACEBOOK', 'Facebook'], ['WHATSAPP', 'WhatsApp'], ['X', 'X (Twitter)'], ['BLOG', 'Blog or website'], ['OFFLINE', 'Offline events'], ['OTHER', 'Other']]),
  },
  mk_audience: { label: 'What is your approximate audience size?', type: 'TEXT', required: true, ...SHORT },
  mk_markets: { label: 'What geographical markets do you reach?', type: 'TEXT', required: true, ...SHORT },
  mk_type: { label: 'What type of collaboration are you proposing?', type: 'TEXTAREA', required: true, min: 3, max: 2000 },
  mk_brands: { label: 'Have you worked with other brands?', type: 'BOOLEAN', required: true },
  mk_portfolio: { label: 'Portfolio or examples of previous work', type: 'TEXT', required: false, max: 300, placeholder: 'A link, or upload files at the end' },
  mk_terms: { label: 'What is your expected commercial arrangement?', type: 'TEXT', required: false, ...SHORT },

  // ---- G: logistics and operations
  lg_services: {
    label: 'What services do you provide?', type: 'MULTI_SELECT', required: true,
    options: opts([['LAST_MILE', 'Last-mile delivery'], ['LINEHAUL', 'Transport between cities'], ['COLD_CHAIN', 'Cold chain'], ['WAREHOUSING', 'Warehousing'], ['FULFILMENT', 'Packing and fulfilment'], ['OTHER', 'Other']]),
  },
  lg_coverage: { label: 'Which cities and states do you cover?', type: 'TEXT', required: true, ...SHORT },
  lg_fleet: { label: 'Do you own or operate your own fleet?', type: 'RADIO', required: true, options: opts([['OWN', 'Own fleet'], ['PARTNER', 'Partner fleet'], ['BOTH', 'Both'], ['NONE', 'No fleet']]) },
  lg_capacity: { label: 'What is your approximate operational capacity?', type: 'TEXT', required: true, ...SHORT, placeholder: 'For example, 500 deliveries a day' },
  lg_warehouses: { label: 'Do you operate warehouses or storage facilities?', type: 'BOOLEAN', required: true },
  lg_sla: { label: 'Can you provide service-level commitments?', type: 'BOOLEAN', required: true },
  lg_terms: { label: 'What are your expected commercial terms?', type: 'TEXT', required: false, ...SHORT },

  // ---- H: other opportunities and business collaborations
  ot_idea: { label: 'Describe your business idea', type: 'TEXTAREA', required: true, ...LONG },
  ot_problem: { label: 'What problem does it solve?', type: 'TEXTAREA', required: true, min: 3, max: 2000 },
  ot_resources: { label: 'What resources can you contribute?', type: 'TEXTAREA', required: true, min: 3, max: 2000 },
  ot_needs: { label: 'What would you need from MandiMangoes?', type: 'TEXTAREA', required: true, min: 3, max: 2000 },
  ot_success: { label: 'What would a successful collaboration look like?', type: 'TEXTAREA', required: true, min: 3, max: 2000 },

  // ---- step 5: final details
  startWhen: { label: 'When would you like to start?', type: 'RADIO', required: true, column: true, options: opts([['IMMEDIATELY', 'Immediately'], ['15_DAYS', 'Within 15 days'], ['MONTH', 'Within a month'], ['3_MONTHS', 'Within 3 months'], ['EXPLORING', 'Just exploring opportunities']]) },
  callbackTime: { label: 'Preferred time for a callback', type: 'SELECT', required: false, column: true, options: opts([['MORNING', 'Morning (9 AM to 12 PM)'], ['AFTERNOON', 'Afternoon (12 PM to 4 PM)'], ['EVENING', 'Evening (4 PM to 7 PM)'], ['ANY', 'Any time']]) },
  additionalComments: { label: 'Additional comments', type: 'TEXTAREA', required: false, column: true, max: 3000 },
  documents: { label: 'Supporting documents', type: 'FILE_UPLOAD', required: false, description: 'Optional. PDF, JPEG, PNG or WebP. You can add them after you submit.' },
  consent: { label: 'I agree that MandiMangoes may contact me about this enquiry by phone, WhatsApp or email, and store these details as described in the privacy notice.', type: 'CHECKBOX', required: true, column: true },
}

const STEPS_1 = [
  { key: 'contact', title: 'About you', description: 'So we know who to get back to.', sections: [{ key: 'personal', title: 'Personal information', questions: ['fullName', 'mobile', 'email', 'city', 'state', 'pincode', 'country', 'preferredContact'] }] },
  { key: 'business', title: 'Your business', description: 'No registration is needed to apply. Individuals are welcome.', sections: [{ key: 'business', title: 'Business information', questions: ['representsBusiness', 'businessName', 'businessType', 'website', 'yearsOperating', 'gstin', 'businessAddress'] }] },
  { key: 'proposal', title: 'Your proposal', description: 'This is the part we read most closely.', sections: [{ key: 'proposal', title: 'Partnership proposal', questions: ['categories', 'primaryCategory', 'whyUs', 'valueBrought', 'buildTogether', 'hasNetwork', 'priorCollab', 'priorExperience', 'expectations'] }] },
  {
    key: 'specifics', title: 'The details', description: 'A few questions about the kind of partnership you chose.',
    sections: [
      { key: 'sales', title: 'Sales and distribution', categories: ['SALES_DISTRIBUTION'], questions: ['sd_region', 'sd_customerBase', 'sd_networkType', 'sd_hasOutlet', 'sd_channels', 'sd_hasLogistics', 'monthlyVolume', 'sd_exclusive', 'sd_investment'] },
      { key: 'supply', title: 'Farmers and suppliers', categories: ['FARMERS_SUPPLIERS'], questions: ['fs_products', 'fs_role', 'fs_source', 'fs_capacity', 'fs_consistent', 'fs_certifications', 'fs_samples', 'fs_price', 'fs_packaging'] },
      { key: 'retail', title: 'Retail and resellers', categories: ['RETAIL_RESELLER'], questions: ['rr_businessType', 'rr_location', 'rr_years', 'rr_currentProducts', 'rr_segments', 'rr_infrastructure', 'rr_interest', 'monthlyVolume'] },
      { key: 'product', title: 'Product development and expansion', categories: ['PRODUCT_DEVELOPMENT'], questions: ['pd_productName', 'pd_category', 'pd_stage', 'pd_description', 'pd_source', 'pd_appeal', 'pd_cost', 'pd_price', 'pd_capacity', 'pd_canManage', 'pd_samples', 'pd_relationships'] },
      { key: 'corporate', title: 'Corporate and institutional', categories: ['CORPORATE'], questions: ['co_orgName', 'co_orgType', 'co_quantity', 'co_requirements', 'co_locations', 'co_frequency', 'co_budget', 'co_additional'] },
      { key: 'marketing', title: 'Marketing and brand collaborations', categories: ['MARKETING'], questions: ['mk_platforms', 'mk_audience', 'mk_markets', 'mk_type', 'mk_brands', 'mk_portfolio', 'mk_terms'] },
      { key: 'logistics', title: 'Logistics and operations', categories: ['LOGISTICS'], questions: ['lg_services', 'lg_coverage', 'lg_fleet', 'lg_capacity', 'lg_warehouses', 'lg_sla', 'lg_terms'] },
      { key: 'other', title: 'Your idea', categories: ['BUSINESS_COLLAB', 'OTHER'], questions: ['ot_idea', 'ot_problem', 'ot_resources', 'ot_needs', 'ot_success'] },
    ],
  },
  { key: 'final', title: 'Final details', description: 'Almost done.', sections: [{ key: 'final', title: 'Final details', questions: ['startWhen', 'callbackTime', 'additionalComments', 'documents', 'consent'] }] },
]

export const QUESTIONNAIRES = {
  '2026-11-v1': { version: '2026-11-v1', questions: Q1, steps: STEPS_1 },
}
export const CURRENT_VERSION = '2026-11-v1'

for (const q of Object.values(QUESTIONNAIRES)) {
  for (const [key, def] of Object.entries(q.questions)) {
    if (!QUESTION_TYPES.includes(def.type)) throw new Error(`questionnaire ${q.version}: ${key} has unknown type ${def.type}`)
  }
  for (const s of q.steps.flatMap((st) => st.sections)) {
    for (const k of s.questions) if (!q.questions[k]) throw new Error(`questionnaire ${q.version}: section ${s.key} names unknown question ${k}`)
    for (const c of s.categories ?? []) if (!CATEGORY_CODES.includes(c)) throw new Error(`questionnaire ${q.version}: section ${s.key} names unknown category ${c}`)
  }
}

/** The questionnaire as the shop draws it: categories (from the database) fill the two category questions' options. */
export function publicQuestionnaire(categories, version = CURRENT_VERSION) {
  const q = QUESTIONNAIRES[version]
  const catOptions = categories.map((c) => ({ value: c.code, label: c.name }))
  const question = (key) => {
    const d = q.questions[key]
    const out = { key, label: d.label, type: d.type, required: d.required === true ? true : d.required ? 'whenShown' : false }
    for (const f of ['description', 'placeholder', 'min', 'max', 'pattern', 'patternMessage', 'default']) if (d[f] !== undefined) out[f] = d[f]
    if (d.showIf) out.showIf = d.showIf
    if (d.patternUnlessCountryNot) out.patternOnlyWhen = { key: 'country', equals: d.patternUnlessCountryNot }
    if (key === 'categories' || key === 'primaryCategory') out.options = catOptions
    else if (d.options) out.options = d.options
    if (key === 'primaryCategory') out.optionsFrom = 'categories'
    return out
  }
  return {
    version: q.version,
    steps: q.steps.map((st) => ({
      key: st.key, title: st.title, description: st.description,
      sections: st.sections.map((s) => ({ key: s.key, title: s.title, categories: s.categories ?? null, questions: s.questions.map(question) })),
    })),
  }
}

// ---------------------------------------------------------------- checking a submission

const isBlank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

/** True when the question is shown for these answers (its showIf, and its section's categories). */
function shown(def, answers) {
  if (!def.showIf) return true
  return def.showIf.in.includes(answers[def.showIf.key])
}

/** The sections that apply to these chosen categories, each question once (the first section that lists it). */
export function applicableSections(version, chosen) {
  const q = QUESTIONNAIRES[version]
  const seen = new Set()
  const out = []
  for (const st of q.steps) {
    for (const s of st.sections) {
      if (s.categories && !s.categories.some((c) => chosen.includes(c))) continue
      const keys = s.questions.filter((k) => !seen.has(k))
      keys.forEach((k) => seen.add(k))
      if (keys.length) out.push({ step: st.key, key: s.key, title: s.title, keys })
    }
  }
  return out
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
/** Control characters other than tab and newlines: never stored. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/** '+91 98765-43210' → '+919876543210'; null when not a 10-digit Indian mobile. */
export function normaliseMobile(raw) {
  const s = String(raw).replace(/[\s()-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
  return /^[6-9]\d{9}$/.test(s) ? `+91${s}` : null
}

/** Checks one answer; returns [cleanValue, null] or [undefined, message]. */
function checkOne(key, def, raw, answers, categories) {
  const text = (min, max) => {
    if (typeof raw !== 'string') return [undefined, 'Enter text']
    const v = raw.replace(/\r\n?/g, '\n').trim()
    if (CONTROL.test(v)) return [undefined, 'Remove the unusual characters']
    if (min && v.length < min) return [undefined, `Write at least ${min} characters`]
    if (max && v.length > max) return [undefined, `Keep it under ${max} characters`]
    return [v, null]
  }
  switch (def.type) {
    case 'TEXT':
    case 'TEXTAREA': {
      const [v, err] = text(def.min, def.max ?? (def.type === 'TEXT' ? 200 : 3000))
      if (err) return [undefined, err]
      const patternApplies = def.pattern && (!def.patternUnlessCountryNot || String(answers.country ?? 'India').trim().toLowerCase() === def.patternUnlessCountryNot.toLowerCase())
      if (patternApplies && !new RegExp(def.pattern).test(v)) return [undefined, def.patternMessage ?? 'Check the format']
      return [v, null]
    }
    case 'EMAIL': {
      const [v, err] = text(3, def.max ?? 200)
      if (err) return [undefined, err]
      return EMAIL_RE.test(v) ? [v.toLowerCase(), null] : [undefined, 'Enter a valid email address']
    }
    case 'PHONE': {
      if (typeof raw !== 'string') return [undefined, 'Enter a mobile number']
      const v = normaliseMobile(raw)
      return v ? [v, null] : [undefined, 'Enter a 10-digit Indian mobile number']
    }
    case 'NUMBER':
    case 'CURRENCY': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+(\.\d{1,2})?\s*$/.test(raw.replace(/,/g, '')) ? Number(raw.replace(/,/g, '')) : NaN
      if (!Number.isFinite(n)) return [undefined, def.type === 'CURRENCY' ? 'Enter an amount in rupees' : 'Enter a number']
      if (def.type === 'NUMBER' && !Number.isInteger(n)) return [undefined, 'Enter a whole number']
      if (def.min != null && n < def.min) return [undefined, `Enter ${def.min} or more`]
      if (def.max != null && n > def.max) return [undefined, 'That number is too large']
      return [Math.round(n * 100) / 100, null]
    }
    case 'SELECT':
    case 'RADIO': {
      const allowed = key === 'primaryCategory' ? categories : def.options.map((o) => o.value)
      if (typeof raw !== 'string' || !allowed.includes(raw)) return [undefined, 'Choose one of the options']
      if (key === 'primaryCategory' && !(answers.categories ?? []).includes(raw)) return [undefined, 'Choose one of the partnership types you picked']
      return [raw, null]
    }
    case 'MULTI_SELECT': {
      const allowed = key === 'categories' ? categories : def.options.map((o) => o.value)
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !allowed.includes(v))) return [undefined, 'Choose from the options']
      const v = [...new Set(raw)]
      return v.length ? [v, null] : [undefined, 'Choose at least one']
    }
    case 'BOOLEAN':
      return typeof raw === 'boolean' ? [raw, null] : [undefined, 'Choose yes or no']
    case 'CHECKBOX':
      if (raw !== true && raw !== false) return [undefined, 'Tick the box or leave it']
      return [raw, null]
    case 'DATE':
      return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? [raw, null] : [undefined, 'Enter a date']
    default:
      return [undefined, 'Not accepted here']
  }
}

/**
 * Checks a whole submission against its questionnaire version.
 * `activeCategories` are the codes applicants may choose now.
 * Returns { answers, sections, fields } when valid, or { errors: { key: message } }.
 * Only shown questions are kept: an answer to a hidden question is dropped, so a
 * value typed and then hidden (a category unticked) is never stored.
 */
export function validateSubmission(version, input, activeCategories) {
  const q = QUESTIONNAIRES[version]
  const errors = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: { _: 'Send the answers' } }
  const unknown = Object.keys(input).filter((k) => !q.questions[k])
  if (unknown.length) return { errors: Object.fromEntries(unknown.slice(0, 5).map((k) => [k, 'Not a question on this form'])) }

  const clean = {}
  // Categories first: they decide which sections apply.
  for (const key of ['categories', 'primaryCategory']) {
    const def = q.questions[key]
    if (isBlank(input[key])) {
      errors[key] = key === 'categories' ? 'Choose at least one type of partnership' : 'Choose your main interest'
      continue
    }
    const [v, err] = checkOne(key, def, input[key], { ...input, ...clean }, activeCategories)
    if (err) errors[key] = err
    else clean[key] = v
  }
  const chosen = clean.categories ?? []
  const sections = applicableSections(version, chosen)
  for (const s of sections) {
    for (const key of s.keys) {
      if (key === 'categories' || key === 'primaryCategory') continue
      const def = q.questions[key]
      if (def.type === 'FILE_UPLOAD') continue // files arrive after the enquiry is saved
      const answersSoFar = { ...input, ...clean }
      if (!shown(def, answersSoFar)) continue
      let raw = input[key]
      if (isBlank(raw) && def.default !== undefined) raw = def.default
      if (typeof raw === 'string' && raw.trim() === '' && def.type !== 'CHECKBOX') raw = undefined
      if (isBlank(raw)) {
        if (def.required) errors[key] = def.type === 'BOOLEAN' || def.type === 'RADIO' || def.type === 'SELECT' ? 'Choose an answer' : 'This is needed'
        continue
      }
      const [v, err] = checkOne(key, def, raw, answersSoFar, activeCategories)
      if (err) errors[key] = err
      else clean[key] = v
    }
  }
  if (clean.consent !== true) errors.consent = 'We need your agreement to contact you about this enquiry'
  if (Object.keys(errors).length) return { errors }
  return { answers: clean, sections }
}

// ---------------------------------------------------------------- reading answers back

const YES_NO = { true: 'Yes', false: 'No' }

/** An answer as a person reads it, using the question as it was in its version. */
export function displayValue(def, value, categoryNames = {}) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null
  const label = (v) => def.options?.find((o) => o.value === v)?.label ?? categoryNames[v] ?? String(v)
  switch (def.type) {
    case 'BOOLEAN':
    case 'CHECKBOX':
      return YES_NO[String(value)] ?? String(value)
    case 'MULTI_SELECT':
      return (Array.isArray(value) ? value : [value]).map(label).join(', ')
    case 'SELECT':
    case 'RADIO':
      return label(value)
    case 'CURRENCY':
      return `Rs ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
    default:
      return String(value)
  }
}
