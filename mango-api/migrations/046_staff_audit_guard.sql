-- The staff audit trail is append-only (docs/authorization.md). Add-only: one function and
-- two triggers on staff_audit.
-- locks: CREATE TRIGGER takes a brief SHARE ROW EXCLUSIVE lock on staff_audit and scans nothing.
--
-- A row is never deleted and the table is never truncated. A row is never changed either,
-- with one exception: the privacy scrub (src/privacy.js scrubOrderAudit, used by account
-- deletion and the retention pass) takes personal keys out of `detail`. So an UPDATE is
-- allowed only when every column but `detail` is unchanged and the new `detail` keeps a
-- subset of the old keys, each with its old value. Adding or changing a key is refused.
CREATE OR REPLACE FUNCTION staff_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'detail' = to_jsonb(OLD) - 'detail'
     AND jsonb_typeof(OLD.detail) = 'object'
     AND jsonb_typeof(NEW.detail) = 'object'
     AND OLD.detail @> NEW.detail
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(NEW.detail) n WHERE OLD.detail -> n.key IS DISTINCT FROM n.value) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'staff_audit is append-only: % is not allowed (only the privacy scrub may remove keys from detail)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER staff_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON staff_audit
  FOR EACH ROW EXECUTE FUNCTION staff_audit_append_only();

CREATE TRIGGER staff_audit_no_truncate
  BEFORE TRUNCATE ON staff_audit
  FOR EACH STATEMENT EXECUTE FUNCTION staff_audit_append_only();
