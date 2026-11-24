-- Bulk orders placed directly (mango-api/README.md, Bulk enquiries): the shop's bulk page now takes two
-- things. An enquiry, as before, of any size. And a bulk order: 100 kg or more, packed in 5 kg or 10 kg
-- boxes, placed without the back-and-forth; an agent phones and WhatsApps the customer to confirm the
-- wholesale price, the day (5 to 7 days out) and payment. Both live in bulk_enquiries; `kind` says which.
--
-- Expand-only: one new column with a constant default (no table rewrite on Postgres 11+). The previous
-- release never reads it; what it saves gets 'ENQUIRY', which is what it was.
-- locks: ADD COLUMN with a constant default is a catalogue change under a brief ACCESS EXCLUSIVE lock;
-- the check is added NOT VALID (every existing row already passes it) and validated in the same file,
-- which takes only a SHARE UPDATE EXCLUSIVE lock on a small table.

ALTER TABLE bulk_enquiries ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'ENQUIRY';
ALTER TABLE bulk_enquiries DROP CONSTRAINT IF EXISTS bulk_enquiries_kind_check;
ALTER TABLE bulk_enquiries ADD CONSTRAINT bulk_enquiries_kind_check CHECK (kind IN ('ENQUIRY', 'ORDER')) NOT VALID;
ALTER TABLE bulk_enquiries VALIDATE CONSTRAINT bulk_enquiries_kind_check;
