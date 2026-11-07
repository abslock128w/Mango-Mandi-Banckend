// Every Partner Network call (mango-api /admin/v1/partner-network/*, docs/partner-network.md).
// Goes through the same signed-in request as the rest of the panel; see src/api.ts.

import { apiBlobUrl, apiRequest } from '../../api'
import type {
  Channel,
  EnquiryAction,
  EnquiryDetail,
  EnquiryList,
  EnquiryQuery,
  Overview,
  PartnerCategory,
  Priority,
  ProposalDetail,
  ProposalList,
  ProposalStatus,
  EnquiryStatus,
} from './types'

const P = '/partner-network'
const id = encodeURIComponent

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface EnquiryPatch {
  status?: EnquiryStatus
  priority?: Priority
  assignedTo?: string | null
  reason?: string
}

export interface FollowupInput {
  scheduledAt?: string
  assignedTo?: string | null
  notes?: string
  status?: 'DONE' | 'CANCELLED' | 'PENDING'
}

export const pn = {
  overview: () => apiRequest<Overview>('GET', `${P}/overview`),

  enquiries: (q: EnquiryQuery) => apiRequest<EnquiryList>('GET', `${P}/enquiries${qs({ ...q })}`),
  /** Managers: the same filters as the list, at most 5,000 rows, recorded in the activity log. */
  exportUrl: (q: EnquiryQuery) => apiBlobUrl(`${P}/enquiries/export.csv${qs({ ...q })}`),
  enquiry: (enquiryId: string) => apiRequest<EnquiryDetail>('GET', `${P}/enquiries/${id(enquiryId)}`),
  patchEnquiry: (enquiryId: string, patch: EnquiryPatch) => apiRequest<EnquiryDetail>('PATCH', `${P}/enquiries/${id(enquiryId)}`, patch),
  addNote: (enquiryId: string, note: string) => apiRequest<unknown>('POST', `${P}/enquiries/${id(enquiryId)}/notes`, { note }),
  addFollowup: (enquiryId: string, body: { scheduledAt: string; assignedTo?: string; notes?: string }) =>
    apiRequest<unknown>('POST', `${P}/enquiries/${id(enquiryId)}/followups`, body),
  patchFollowup: (enquiryId: string, followupId: string, body: FollowupInput) =>
    apiRequest<unknown>('PATCH', `${P}/enquiries/${id(enquiryId)}/followups/${id(followupId)}`, body),
  /** Records that staff opened a call, chat or email from the panel; nothing is sent. */
  contactAttempt: (enquiryId: string, channel: Channel, note?: string) =>
    apiRequest<unknown>('POST', `${P}/enquiries/${id(enquiryId)}/contact-attempts`, note ? { channel, note } : { channel }),
  requestInfo: (enquiryId: string, channel: Channel, message: string) =>
    apiRequest<unknown>('POST', `${P}/enquiries/${id(enquiryId)}/request-info`, { channel, message }),
  /** Approve, reject, close, reopen, convert: managers only. Each returns the detail. */
  action: (enquiryId: string, action: EnquiryAction, body: Record<string, string>) =>
    apiRequest<EnquiryDetail>('POST', `${P}/enquiries/${id(enquiryId)}/${action}`, body),
  /** A supporting document as an object URL; images can be asked for inline. */
  documentUrl: (enquiryId: string, documentId: string, inline = false) =>
    apiBlobUrl(`${P}/enquiries/${id(enquiryId)}/documents/${id(documentId)}${inline ? '?inline=1' : ''}`),

  proposals: (q: { status?: string; q?: string; page?: number; pageSize?: number }) => apiRequest<ProposalList>('GET', `${P}/product-proposals${qs(q)}`),
  proposal: (proposalId: string) => apiRequest<ProposalDetail>('GET', `${P}/product-proposals/${id(proposalId)}`),
  patchProposal: (proposalId: string, status: ProposalStatus, reason?: string) =>
    apiRequest<unknown>('PATCH', `${P}/product-proposals/${id(proposalId)}`, reason ? { status, reason } : { status }),
  proposalNote: (proposalId: string, note: string) => apiRequest<unknown>('POST', `${P}/product-proposals/${id(proposalId)}/notes`, { note }),
  requestSample: (proposalId: string, note?: string) =>
    apiRequest<unknown>('POST', `${P}/product-proposals/${id(proposalId)}/request-sample`, note ? { note } : {}),

  categories: () => apiRequest<PartnerCategory[]>('GET', `${P}/categories`),
  patchCategory: (code: string, patch: Partial<Pick<PartnerCategory, 'name' | 'description' | 'active' | 'displayOrder'>>) =>
    apiRequest<unknown>('PATCH', `${P}/categories/${id(code)}`, patch),
}
