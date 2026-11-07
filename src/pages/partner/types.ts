// The staff API's shapes for the Partner Network (docs/partner-network.md, "Staff API").
// Kept beside the pages that use them, like src/warehouse/types.ts.

export type EnquiryStatus = 'NEW' | 'UNDER_REVIEW' | 'CONTACTED' | 'NEGOTIATION' | 'CONVERTED' | 'REJECTED' | 'CLOSED'
export const ENQUIRY_STATUSES: EnquiryStatus[] = ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'NEGOTIATION', 'CONVERTED', 'REJECTED', 'CLOSED']

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

export type ProposalStatus =
  | 'SUBMITTED'
  | 'UNDER_EVALUATION'
  | 'SAMPLE_REQUESTED'
  | 'QUALITY_REVIEW'
  | 'COMMERCIAL_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CLOSED'
export const PROPOSAL_STATUSES: ProposalStatus[] = [
  'SUBMITTED',
  'UNDER_EVALUATION',
  'SAMPLE_REQUESTED',
  'QUALITY_REVIEW',
  'COMMERCIAL_REVIEW',
  'APPROVED',
  'REJECTED',
  'CLOSED',
]
/** Final proposal statuses: managers only, with a reason. */
export const PROPOSAL_FINAL: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['APPROVED', 'REJECTED', 'CLOSED'])

export type Channel = 'PHONE' | 'WHATSAPP' | 'EMAIL'

export interface CategoryRef {
  code: string
  name: string
}

export interface StaffRef {
  id: string
  email: string
}

export interface EnquiryRow {
  id: string
  reference: string
  name: string
  businessName: string | null
  primaryCategory: CategoryRef | null
  categories: CategoryRef[]
  city: string | null
  state: string | null
  mobile: string | null
  email: string | null
  submittedAt: string
  status: EnquiryStatus
  priority: Priority
  assignedTo: StaffRef | null
}

export interface ProposalRow {
  id: string
  reference: string
  productName: string
  productCategory: string | null
  submittedBy: { name: string; enquiryId: string; enquiryReference: string }
  applicantLocation: string | null
  sourceLocation: string | null
  /** Rupees, not paise. */
  procurementPrice: number | null
  suggestedSellingPrice: number | null
  monthlySupplyCapacity: string | null
  sampleAvailable: string | boolean | null
  submittedAt: string
  status: ProposalStatus
}

export interface Followup {
  id: string
  enquiry: { id: string; reference: string; name: string }
  scheduledAt: string
  assignedTo: StaffRef | null
  notes: string | null
  status: 'PENDING' | 'DONE' | 'CANCELLED'
  completedAt: string | null
  overdue: boolean
}

export interface Overview {
  counts: Record<EnquiryStatus, number> & { total: number; pendingReview: number; proposalsAwaiting: number }
  latest: EnquiryRow[]
  byCategory: (CategoryRef & { count: number })[]
  byState: { state: string; count: number }[]
  followups: { overdue: Followup[]; upcoming: Followup[] }
  recentlyConverted: EnquiryRow[]
  proposalsNeedingAttention: ProposalRow[]
}

export interface StaffOption extends StaffRef {
  role: string
}

export interface EnquiryList {
  items: EnquiryRow[]
  total: number
  page: number
  pageSize: number
  staff: StaffOption[]
  states: string[]
}

export type EnquirySort = 'submitted' | 'name' | 'status' | 'priority' | 'state' | 'reference'

export interface EnquiryQuery {
  q?: string
  status?: string
  category?: string
  state?: string
  priority?: string
  assignedTo?: string
  from?: string
  to?: string
  sort?: string
  dir?: string
  page?: number
  pageSize?: number
}

export interface Answer {
  key: string
  label: string
  type: string
  /** Already in words; null when an optional question was left blank. */
  value: string | null
}

export interface AnswerSection {
  key: string
  title: string
  answers: Answer[]
}

export interface PartnerDocument {
  id: string
  name: string
  category: string
  categoryLabel: string
  mime: string
  size: number
  uploadedAt: string
}

export interface Note {
  id: string
  note: string
  author: string
  createdAt: string
  about?: 'ENQUIRY' | 'PROPOSAL'
}

export interface Activity {
  id: string
  type: string
  summary: string
  oldValue: string | null
  newValue: string | null
  actor: string | null
  at: string
}

export interface ContactLinks {
  tel: string | null
  whatsapp: string | null
  mailto: string | null
}

export interface EnquiryActions {
  approve: boolean
  reject: boolean
  close: boolean
  reopen: boolean
  convert: boolean
  assign: boolean
  export: boolean
}

export interface EnquiryDetail extends EnquiryRow {
  pincode: string | null
  country: string | null
  preferredContact: string | null
  callbackTime: string | null
  startTimeline: string | null
  decision: string | null
  assignedAt: string | null
  assignedBy: { email: string } | null
  questionnaireVersion: string
  consent: { text: string; at: string } | null
  sections: AnswerSection[]
  documents: PartnerDocument[]
  notes: Note[]
  followups: Followup[]
  activity: Activity[]
  proposal: { id: string; reference: string; status: ProposalStatus } | null
  opportunity: { title: string; notes: string | null; createdAt: string; createdBy: string | null } | null
  allowedStatuses: EnquiryStatus[]
  actions: EnquiryActions
  contact: ContactLinks
}

export interface ProposalList {
  items: ProposalRow[]
  total: number
  page: number
  pageSize: number
}

export interface ProposalDetail extends ProposalRow {
  description: string | null
  productStage: string | null
  supplierType: string | null
  qualityCertifications: string | null
  commercialAppeal: string | null
  canManage: string | null
  relationships: string | null
  documents: PartnerDocument[]
  notes: Note[]
  activity: Activity[]
  allowedStatuses: ProposalStatus[]
  contact: ContactLinks
  enquiry: { id: string; reference: string; status: EnquiryStatus }
}

export interface PartnerCategory {
  code: string
  name: string
  description: string | null
  active: boolean
  displayOrder: number
  enquiries: number
}

export type EnquiryAction = 'approve' | 'reject' | 'close' | 'reopen' | 'convert'
