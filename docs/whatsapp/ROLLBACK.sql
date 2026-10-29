-- Drops the WhatsApp tables added by migration 051_whatsapp.sql (docs/whatsapp/ROLLBACK.md).
-- Run ONLY after the release before 051 is back in production and the conversation, consent and
-- template data is no longer wanted. Consent records (STOP) are evidence: export them first.
-- Try it on a Neon branch before production.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/whatsapp/ROLLBACK.sql

BEGIN;
DROP TABLE IF EXISTS wa_messages;
DROP TABLE IF EXISTS wa_conversations;
DROP TABLE IF EXISTS wa_consent_events;
DROP TABLE IF EXISTS wa_consent;
DROP TABLE IF EXISTS wa_templates;
DROP TABLE IF EXISTS wa_account_events;
DROP TABLE IF EXISTS wa_automations;
-- So the migration runner would apply 051 again if the release came back.
DELETE FROM schema_migrations WHERE version = '051_whatsapp.sql';
COMMIT;
