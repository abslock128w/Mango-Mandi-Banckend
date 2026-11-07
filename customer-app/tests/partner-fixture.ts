// The Partner With Us form as GET /v1/partner-network serves it, built from the API's own
// questionnaire (mango-api/src/partner/questionnaire.js) and the categories migration 052 adds,
// so the shop's unit tests and mocked specs always follow the real definition.
import type { PartnerNetwork } from '../src/partner-form.ts'

/** The nine categories as migration 052_partner_network.sql adds them. */
export const CATEGORIES = [
  { code: 'SALES_DISTRIBUTION', name: 'Sales & Distribution Partners', description: 'Individuals or businesses who want to sell MandiMangoes products or distribute them in a city, state or region.' },
  { code: 'FARMERS_SUPPLIERS', name: 'Farmers & Suppliers', description: 'Farmers, producers, manufacturers and suppliers who want to supply products to MandiMangoes.' },
  { code: 'RETAIL_RESELLER', name: 'Retail & Reseller Partners', description: 'Shops and businesses who want to offer MandiMangoes products through their outlets or sales channels.' },
  { code: 'PRODUCT_DEVELOPMENT', name: 'Product Development & Expansion', description: 'New products, sourcing opportunities or whole new categories you would like MandiMangoes to carry.' },
  { code: 'CORPORATE', name: 'Corporate & Institutional Partnerships', description: 'Companies, hotels, restaurants, offices, event organisers and institutions buying in bulk or on a business arrangement.' },
  { code: 'BUSINESS_COLLAB', name: 'Business Collaborations', description: 'Strategic partnerships, joint ventures and other commercial proposals.' },
  { code: 'MARKETING', name: 'Marketing & Brand Collaborations', description: 'Creators, influencers, agencies, referral partners and promotional collaborators.' },
  { code: 'LOGISTICS', name: 'Logistics & Operations', description: 'Transport, warehousing, delivery and fulfilment partners.' },
  { code: 'OTHER', name: 'Other Opportunities', description: 'Anything that does not fit above. Tell us your idea.' },
]

// Held in a variable: the module is the API's JavaScript, loaded at run time and not type-checked
// here. Relative to this file, both under Node's test runner (ESM) and Playwright (CommonJS).
const QUESTIONNAIRE = '../../mango-api/src/partner/questionnaire.js'

/** The whole GET /v1/partner-network answer. */
export async function partnerNetwork(): Promise<PartnerNetwork> {
  const mod = (await import(QUESTIONNAIRE)) as {
    publicQuestionnaire: (c: { code: string; name: string }[]) => Pick<PartnerNetwork, 'version' | 'steps'>
    DOCUMENT_CATEGORIES: Record<string, string>
  }
  const q = mod.publicQuestionnaire(CATEGORIES)
  return {
    version: q.version,
    categories: CATEGORIES,
    steps: q.steps,
    documentCategories: Object.entries(mod.DOCUMENT_CATEGORIES).map(([code, label]) => ({ code, label })),
    uploads: { maxFiles: 10, maxFileBytes: 5 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
    consent: {
      text: 'I agree that MandiMangoes may contact me about this enquiry by phone, WhatsApp or email, and store these details as described in the privacy notice.',
      privacyPath: '/privacy',
    },
    captcha: { siteKeyRequired: false, siteKey: null, action: 'partner' },
  }
}
