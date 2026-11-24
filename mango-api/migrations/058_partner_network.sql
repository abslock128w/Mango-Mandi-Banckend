-- Partner Network (docs/partner-network.md): business enquiries from the shop's
-- Partner With Us form, managed by staff in the panel. Applicants have no
-- account; an enquiry is found by its reference only by staff.
--
-- Operational facts (who, where, status, priority, assignment) are columns.
-- Every answer is also kept in partner_enquiry_answers with the question's label
-- and type as they were, so an old enquiry reads correctly after the form changes.
--
-- Expand-only: new tables, one new nullable column on notifications (no default,
-- so no rewrite), and the notifications checks widened NOT VALID (every existing
-- row already passes them). The previous release never reads any of this.
-- locks: new tables only, plus a brief lock on notifications to add a column, a
-- NOT VALID check and a partial index whose rows are all NULL (as 041 did).

CREATE TABLE partnership_categories (
  code          TEXT PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]{1,39}$'),
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  description   TEXT NOT NULL CHECK (length(description) BETWEEN 2 AND 600),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO partnership_categories (code, name, description, display_order) VALUES
  ('SALES_DISTRIBUTION', 'Sales & Distribution Partners', 'Individuals or businesses who want to sell MandiMangoes products or distribute them in a city, state or region.', 1),
  ('FARMERS_SUPPLIERS', 'Farmers & Suppliers', 'Farmers, producers, manufacturers and suppliers who want to supply products to MandiMangoes.', 2),
  ('RETAIL_RESELLER', 'Retail & Reseller Partners', 'Shops and businesses who want to offer MandiMangoes products through their outlets or sales channels.', 3),
  ('PRODUCT_DEVELOPMENT', 'Product Development & Expansion', 'New products, sourcing opportunities or whole new categories you would like MandiMangoes to carry.', 4),
  ('CORPORATE', 'Corporate & Institutional Partnerships', 'Companies, hotels, restaurants, offices, event organisers and institutions buying in bulk or on a business arrangement.', 5),
  ('BUSINESS_COLLAB', 'Business Collaborations', 'Strategic partnerships, joint ventures and other commercial proposals.', 6),
  ('MARKETING', 'Marketing & Brand Collaborations', 'Creators, influencers, agencies, referral partners and promotional collaborators.', 7),
  ('LOGISTICS', 'Logistics & Operations', 'Transport, warehousing, delivery and fulfilment partners.', 8),
  ('OTHER', 'Other Opportunities', 'Anything that does not fit above. Tell us your idea.', 9);

CREATE TABLE partner_enquiries (
  id                       TEXT PRIMARY KEY,
  -- MMP- and 8 random characters (no 0/O/1/I/L): not guessable, not a count.
  reference                TEXT NOT NULL UNIQUE CHECK (reference ~ '^MMP-[2-9A-HJKMNP-Z]{8}$'),
  applicant_name           TEXT NOT NULL CHECK (length(applicant_name) BETWEEN 2 AND 120),
  mobile_number            TEXT NOT NULL CHECK (mobile_number ~ '^\+91[6-9][0-9]{9}$'),
  email                    TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 200),
  city                     TEXT NOT NULL CHECK (length(city) BETWEEN 2 AND 80),
  state                    TEXT NOT NULL CHECK (length(state) BETWEEN 2 AND 80),
  pincode                  TEXT NOT NULL CHECK (length(pincode) BETWEEN 3 AND 10),
  country                  TEXT NOT NULL DEFAULT 'India' CHECK (length(country) BETWEEN 2 AND 60),
  preferred_contact_method TEXT NOT NULL CHECK (preferred_contact_method IN ('PHONE', 'WHATSAPP', 'EMAIL')),
  represents_business      TEXT NOT NULL CHECK (represents_business IN ('YES', 'NO', 'PLANNING')),
  business_name            TEXT CHECK (business_name IS NULL OR length(business_name) <= 160),
  business_type            TEXT NOT NULL CHECK (business_type IN ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'FARMER', 'ENTREPRENEUR', 'OTHER')),
  website                  TEXT CHECK (website IS NULL OR length(website) <= 300),
  years_operating          INTEGER CHECK (years_operating IS NULL OR years_operating BETWEEN 0 AND 150),
  gstin                    TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  business_address         TEXT CHECK (business_address IS NULL OR length(business_address) <= 500),
  primary_category         TEXT NOT NULL REFERENCES partnership_categories (code),
  start_timeline           TEXT NOT NULL CHECK (start_timeline IN ('IMMEDIATELY', '15_DAYS', 'MONTH', '3_MONTHS', 'EXPLORING')),
  callback_time            TEXT CHECK (callback_time IS NULL OR callback_time IN ('MORNING', 'AFTERNOON', 'EVENING', 'ANY')),
  additional_comments      TEXT CHECK (additional_comments IS NULL OR length(additional_comments) <= 3000),
  status                   TEXT NOT NULL DEFAULT 'NEW'
                             CHECK (status IN ('NEW', 'UNDER_REVIEW', 'CONTACTED', 'NEGOTIATION', 'CONVERTED', 'REJECTED', 'CLOSED')),
  priority                 TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  -- APPROVED: a manager accepted it for a business discussion (it moves to NEGOTIATION).
  decision                 TEXT CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED')),
  assigned_admin_id        TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  assigned_at              TIMESTAMPTZ,
  assigned_by              TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  questionnaire_version    TEXT NOT NULL,
  -- The consent wording they agreed to, and when.
  consent_text             TEXT NOT NULL,
  consent_at               TIMESTAMPTZ NOT NULL,
  -- Duplicate protection: the form's Idempotency-Key, and a hash of what was sent.
  idempotency_key          TEXT NOT NULL UNIQUE,
  content_hash             TEXT NOT NULL,
  -- Documents are uploaded after the enquiry is saved, with a short-lived secret only the submitter holds.
  upload_token_hash        TEXT,
  upload_token_expires_at  TIMESTAMPTZ,
  submitted_at             TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL,
  status_changed_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX partner_enquiries_submitted_idx ON partner_enquiries (submitted_at DESC, id);
CREATE INDEX partner_enquiries_status_idx ON partner_enquiries (status, submitted_at DESC);
CREATE INDEX partner_enquiries_state_idx ON partner_enquiries (state);
CREATE INDEX partner_enquiries_assigned_idx ON partner_enquiries (assigned_admin_id) WHERE assigned_admin_id IS NOT NULL;
CREATE INDEX partner_enquiries_mobile_idx ON partner_enquiries (mobile_number);
CREATE INDEX partner_enquiries_email_idx ON partner_enquiries (lower(email));
CREATE INDEX partner_enquiries_content_idx ON partner_enquiries (content_hash, submitted_at);

-- Every category the applicant ticked; exactly one is primary.
CREATE TABLE partner_enquiry_categories (
  enquiry_id    TEXT NOT NULL REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  category_code TEXT NOT NULL REFERENCES partnership_categories (code),
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (enquiry_id, category_code)
);
CREATE UNIQUE INDEX partner_enquiry_one_primary ON partner_enquiry_categories (enquiry_id) WHERE is_primary;
CREATE INDEX partner_enquiry_categories_code_idx ON partner_enquiry_categories (category_code);

-- Every answer, with the question as the applicant saw it.
CREATE TABLE partner_enquiry_answers (
  id                    TEXT PRIMARY KEY,
  enquiry_id            TEXT NOT NULL REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  section_key           TEXT NOT NULL,
  section_title         TEXT NOT NULL,
  question_key          TEXT NOT NULL,
  question_label        TEXT NOT NULL,
  question_type         TEXT NOT NULL,
  -- JSON so lists and yes/no keep their type; display_value is the same answer as words.
  answer_value          JSONB,
  display_value         TEXT,
  position              INTEGER NOT NULL,
  questionnaire_version TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL,
  UNIQUE (enquiry_id, question_key)
);
CREATE INDEX partner_enquiry_answers_enquiry_idx ON partner_enquiry_answers (enquiry_id, position);

-- A product the applicant proposes (from the Product Development section).
-- APPROVED means accepted for further consideration; it never creates a shop product.
CREATE TABLE partner_product_proposals (
  id                      TEXT PRIMARY KEY,
  reference               TEXT NOT NULL UNIQUE,
  enquiry_id              TEXT NOT NULL UNIQUE REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  product_name            TEXT NOT NULL CHECK (length(product_name) BETWEEN 2 AND 120),
  product_category        TEXT NOT NULL CHECK (length(product_category) BETWEEN 2 AND 80),
  description             TEXT,
  product_stage           TEXT CHECK (product_stage IS NULL OR product_stage IN ('EXISTING', 'CONCEPT')),
  source_location         TEXT,
  supplier_type           TEXT,
  procurement_price       NUMERIC(14, 2) CHECK (procurement_price IS NULL OR procurement_price >= 0),
  suggested_selling_price NUMERIC(14, 2) CHECK (suggested_selling_price IS NULL OR suggested_selling_price >= 0),
  monthly_supply_capacity TEXT,
  quality_certifications  TEXT,
  sample_available        BOOLEAN,
  status                  TEXT NOT NULL DEFAULT 'SUBMITTED'
                            CHECK (status IN ('SUBMITTED', 'UNDER_EVALUATION', 'SAMPLE_REQUESTED', 'QUALITY_REVIEW', 'COMMERCIAL_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED')),
  created_at              TIMESTAMPTZ NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL
);
CREATE INDEX partner_product_proposals_status_idx ON partner_product_proposals (status, created_at DESC);

-- Supporting files, stored privately (Vercel Blob, or in the row locally) and
-- served only to staff through the API.
CREATE TABLE partner_enquiry_documents (
  id                TEXT PRIMARY KEY,
  enquiry_id        TEXT NOT NULL REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 160),
  mime_type         TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_size         INTEGER NOT NULL CHECK (file_size > 0),
  document_category TEXT NOT NULL CHECK (document_category IN ('BUSINESS_PROFILE', 'COMPANY_REGISTRATION', 'PRODUCT_CATALOGUE', 'PRODUCT_PHOTOS', 'CERTIFICATIONS', 'PORTFOLIO', 'QUOTATION', 'OTHER')),
  blob_path         TEXT,
  bytes             BYTEA,
  uploaded_at       TIMESTAMPTZ NOT NULL,
  CHECK (blob_path IS NOT NULL OR bytes IS NOT NULL)
);
CREATE INDEX partner_enquiry_documents_enquiry_idx ON partner_enquiry_documents (enquiry_id, uploaded_at);

-- Staff notes on an enquiry or its product proposal. Never shown outside the panel.
CREATE TABLE partner_enquiry_notes (
  id            TEXT PRIMARY KEY,
  enquiry_id    TEXT NOT NULL REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  proposal_id   TEXT REFERENCES partner_product_proposals (id) ON DELETE CASCADE,
  admin_user_id TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  author_email  TEXT NOT NULL,
  note          TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 3000),
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX partner_enquiry_notes_enquiry_idx ON partner_enquiry_notes (enquiry_id, created_at);

-- Callbacks and other follow-ups.
CREATE TABLE partner_enquiry_followups (
  id                TEXT PRIMARY KEY,
  enquiry_id        TEXT NOT NULL REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  assigned_admin_id TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  notes             TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'CANCELLED')),
  completed_at      TIMESTAMPTZ,
  created_by        TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  -- Set once its "due soon" or "overdue" alert is queued, so each goes once.
  due_alert_at      TIMESTAMPTZ,
  overdue_alert_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);
-- Two pending follow-ups for the same enquiry at the same moment are one too many (a double tap).
CREATE UNIQUE INDEX partner_followups_no_twin ON partner_enquiry_followups (enquiry_id, scheduled_at) WHERE status = 'PENDING';
CREATE INDEX partner_followups_due_idx ON partner_enquiry_followups (scheduled_at) WHERE status = 'PENDING';

-- What happened to an enquiry, and who did it (status, priority, assignment,
-- notes, follow-ups, contact attempts, decisions). Staff-only.
CREATE TABLE partner_enquiry_activities (
  id             TEXT PRIMARY KEY,
  enquiry_id     TEXT NOT NULL REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  proposal_id    TEXT REFERENCES partner_product_proposals (id) ON DELETE CASCADE,
  actor_admin_id TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  actor_email    TEXT,
  activity_type  TEXT NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX partner_enquiry_activities_enquiry_idx ON partner_enquiry_activities (enquiry_id, created_at);

-- A converted enquiry becomes a recorded business opportunity: the seed of a
-- future partner record.
CREATE TABLE partner_opportunities (
  id          TEXT PRIMARY KEY,
  enquiry_id  TEXT NOT NULL UNIQUE REFERENCES partner_enquiries (id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  notes       TEXT CHECK (notes IS NULL OR length(notes) <= 3000),
  created_by  TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------- messages

-- The outbox carries the applicant's "we received your enquiry" and the
-- business team's alerts (both templates need Meta approval: WHATSAPP_PARTNER_UPDATES).
ALTER TABLE notifications ADD COLUMN partner_enquiry_id TEXT REFERENCES partner_enquiries (id) ON DELETE CASCADE;
-- The template's words, fixed when queued (what happened, reference, detail, link).
ALTER TABLE notifications ADD COLUMN partner_params JSONB;
-- Both checks keep everything 041 (care) and 053 (rider app: the delivery-code kinds) added.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_target;
ALTER TABLE notifications ADD CONSTRAINT notifications_target CHECK (
  order_id IS NOT NULL OR preorder_id IS NOT NULL OR stock_alert_id IS NOT NULL
  OR referral_reward_id IS NOT NULL OR manager_summary_id IS NOT NULL
  OR help_ticket_id IS NOT NULL OR subscription_cycle_id IS NOT NULL OR partner_enquiry_id IS NOT NULL) NOT VALID;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'ORDER_CONFIRMED','REPLACEMENT_CONFIRMED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUNDED',
  'PREORDER_BOOKED','PREORDER_SPOT_OPEN','PREORDER_MOVED','DATE_MOVED','GIFT_OUT_FOR_DELIVERY',
  'RIPENESS_GUIDE','BACK_IN_STOCK','REORDER_REMINDER','REVIEW_REQUEST',
  'CLAIM_RECEIVED','CLAIM_REJECTED','REFERRAL_REWARD','MANAGER_DAILY_SUMMARY','HELP_REPLY','SUBSCRIPTION_DUE',
  'DELIVERY_CODE','GIFT_DELIVERY_CODE',
  'PARTNER_ENQUIRY_RECEIVED','PARTNER_TEAM_ALERT')) NOT VALID;
CREATE INDEX notifications_partner_idx ON notifications (partner_enquiry_id) WHERE partner_enquiry_id IS NOT NULL;
