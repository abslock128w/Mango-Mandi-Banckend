-- WhatsApp Business Platform (docs/whatsapp/README.md): conversations, every
-- message in and out, customer consent, Meta template status, account health
-- events and a switch per automated message.
--
-- Additive only: new tables, no change to an existing column, so the previous
-- release keeps running on this schema (n-minus-1). Rollback: the new code
-- stops reading these tables; drop them with docs/whatsapp/ROLLBACK.sql only
-- after the previous release is back and the data is no longer wanted.
--
-- locks: new, empty tables only; nothing existing is touched.

-- One conversation per WhatsApp number. The number comes from Meta's wa_id,
-- which WhatsApp itself has verified. mode BOT: the chat answers; STAFF: a
-- person has taken over and the bot stays quiet until staff hand it back.
CREATE TABLE wa_conversations (
  id                TEXT PRIMARY KEY,
  phone             TEXT NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  customer_id       TEXT REFERENCES customers (id),
  mode              TEXT NOT NULL DEFAULT 'BOT' CHECK (mode IN ('BOT', 'STAFF')),
  -- WAITING: the customer asked for a person (or sent a photo) and no one has answered yet.
  status            TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'WAITING', 'CLOSED')),
  assigned_admin_id TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  handoff_reason    TEXT CHECK (handoff_reason IS NULL OR length(handoff_reason) <= 200),
  waiting_since     TIMESTAMPTZ,
  -- The customer service window: free-form replies only within 24 hours of this.
  last_inbound_at   TIMESTAMPTZ,
  last_outbound_at  TIMESTAMPTZ,
  unread            INTEGER NOT NULL DEFAULT 0 CHECK (unread >= 0),
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX wa_conversations_activity_idx ON wa_conversations (updated_at DESC);
CREATE INDEX wa_conversations_waiting_idx ON wa_conversations (waiting_since) WHERE status = 'WAITING';
CREATE INDEX wa_conversations_customer_idx ON wa_conversations (customer_id);

-- Every message: the customer's (IN), the bot's, staff replies and order
-- updates (OUT). Outbound free-form messages are written QUEUED in the same
-- transaction as the chat step that made them (an outbox), then sent.
CREATE TABLE wa_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES wa_conversations (id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  type            TEXT NOT NULL CHECK (type ~ '^[a-z_]{1,30}$'),
  -- The words, clipped; set to NULL when the retention window passes.
  body            TEXT CHECK (body IS NULL OR length(body) <= 4096),
  -- What to send (a chat reply: text, buttons, list, link, pay). Cleared once sent.
  payload         JSONB,
  template        TEXT,
  -- 'customer', 'bot', 'system' (order updates) or 'staff:<admin id>'.
  author          TEXT NOT NULL CHECK (length(author) <= 80),
  provider_id     TEXT CHECK (provider_id IS NULL OR length(provider_id) <= 200),
  status          TEXT NOT NULL CHECK (status IN ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN')),
  error           TEXT CHECK (error IS NULL OR length(error) <= 500),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  notification_id TEXT,
  -- Inbound media: Meta's media id, type, size and caption. The file stays at Meta;
  -- staff fetch it through the API (never a Meta URL in the browser).
  media           JSONB,
  correlation_id  TEXT CHECK (correlation_id IS NULL OR length(correlation_id) <= 100),
  created_at      TIMESTAMPTZ NOT NULL,
  status_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX wa_messages_provider_uq ON wa_messages (provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX wa_messages_conversation_idx ON wa_messages (conversation_id, created_at DESC);
CREATE INDEX wa_messages_queued_idx ON wa_messages (next_attempt_at) WHERE status = 'QUEUED';
CREATE INDEX wa_messages_created_idx ON wa_messages (created_at);
CREATE INDEX wa_messages_failed_idx ON wa_messages (created_at) WHERE status IN ('FAILED', 'UNKNOWN');

-- Consent per WhatsApp number. Order and service updates are allowed unless the
-- customer sent STOP; promotional messages need their own opt-in and stop with
-- STOP or STOP OFFERS. A customer account or a phone number alone is never
-- marketing consent.
CREATE TABLE wa_consent (
  phone       TEXT PRIMARY KEY CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  customer_id TEXT REFERENCES customers (id),
  updates     TEXT NOT NULL DEFAULT 'ALLOWED' CHECK (updates IN ('ALLOWED', 'STOPPED')),
  marketing   TEXT NOT NULL DEFAULT 'NONE' CHECK (marketing IN ('NONE', 'OPTED_IN', 'OPTED_OUT')),
  updated_at  TIMESTAMPTZ NOT NULL
);

-- Every consent change and its evidence (the WhatsApp message id, the request
-- id of the shop setting, or the staff member who recorded it).
CREATE TABLE wa_consent_events (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  customer_id TEXT REFERENCES customers (id),
  scope       TEXT NOT NULL CHECK (scope IN ('updates', 'marketing')),
  action      TEXT NOT NULL CHECK (action IN ('OPT_IN', 'OPT_OUT')),
  source      TEXT NOT NULL CHECK (source IN ('whatsapp_keyword', 'shop_account', 'staff')),
  evidence    TEXT CHECK (evidence IS NULL OR length(evidence) <= 200),
  created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX wa_consent_events_phone_idx ON wa_consent_events (phone, created_at DESC);

-- Message templates as Meta last reported them (template sync, or the
-- message_template_status_update webhook). Empty until the first sync: the
-- sender then trusts the names and Meta's own answer.
CREATE TABLE wa_templates (
  name          TEXT NOT NULL CHECK (name ~ '^[a-z0-9_]+$' AND length(name) <= 512),
  language      TEXT NOT NULL CHECK (length(language) <= 20),
  status        TEXT NOT NULL CHECK (length(status) <= 40),
  category      TEXT CHECK (category IS NULL OR length(category) <= 40),
  meta_id       TEXT,
  body_params   INTEGER CHECK (body_params IS NULL OR body_params >= 0),
  url_button    BOOLEAN,
  reason        TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  synced_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (name, language)
);

-- Account, phone-number and template health events from Meta, and the panel's
-- connection checks. Kept 90 days.
CREATE TABLE wa_account_events (
  id         TEXT PRIMARY KEY,
  field      TEXT NOT NULL CHECK (length(field) <= 60),
  event      TEXT CHECK (event IS NULL OR length(event) <= 80),
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX wa_account_events_created_idx ON wa_account_events (created_at DESC);

-- A manager's switch per automated message kind. No row: on (as before this table).
CREATE TABLE wa_automations (
  kind       TEXT PRIMARY KEY CHECK (kind ~ '^[A-Z_]{1,40}$'),
  enabled    BOOLEAN NOT NULL,
  updated_by TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
