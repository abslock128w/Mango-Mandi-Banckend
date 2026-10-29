// How long WhatsApp data is kept (docs/whatsapp/SECURITY.md):
//   message words       WHATSAPP_MESSAGE_RETENTION_DAYS (default 90), then cleared;
//   message records     180 days (direction, type, status, times), as order updates;
//   conversations       deleted 365 days after the last message;
//   account events      90 days;
//   consent             kept: a STOP must keep working (it holds no message content).
// Each delete is bounded per run.
import { query } from '../db.js'
import { env } from '../env.js'

const DAY = 86_400_000

export async function pruneWhatsApp(at) {
  const words = new Date(at.getTime() - env.WHATSAPP_MESSAGE_RETENTION_DAYS * DAY)
  await query(
    `UPDATE wa_messages SET body = NULL, payload = NULL, media = CASE WHEN media IS NULL THEN NULL ELSE jsonb_build_object('pruned', true) END
      WHERE id IN (SELECT id FROM wa_messages WHERE created_at < $1 AND (body IS NOT NULL OR payload IS NOT NULL OR (media IS NOT NULL AND NOT media ? 'pruned')) LIMIT 5000)`,
    [words],
  )
  await query(
    `DELETE FROM wa_messages WHERE id IN (SELECT id FROM wa_messages WHERE created_at < $1 AND status NOT IN ('QUEUED') LIMIT 5000)`,
    [new Date(at.getTime() - 180 * DAY)],
  )
  await query(
    `DELETE FROM wa_conversations WHERE id IN (
       SELECT v.id FROM wa_conversations v WHERE v.updated_at < $1 AND NOT EXISTS (SELECT 1 FROM wa_messages m WHERE m.conversation_id = v.id) LIMIT 1000)`,
    [new Date(at.getTime() - 365 * DAY)],
  )
  await query('DELETE FROM wa_account_events WHERE created_at < $1', [new Date(at.getTime() - 90 * DAY)])
}
