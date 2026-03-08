BEGIN;

-- 1) Cleanup historical duplicate survey reminder notifications.
-- Keep only one row per user + reminder type + match key, preferring:
--   - unread rows over read rows
--   - newest send_at/created_at timestamp
WITH normalized AS (
  SELECT
    n.id,
    n.user_id,
    n.type,
    COALESCE(
      NULLIF(n.partido_id::text, ''),
      NULLIF(n.data->>'partido_id', ''),
      NULLIF(n.data->>'partidoId', ''),
      NULLIF(n.data->>'match_id', ''),
      NULLIF(n.data->>'matchId', ''),
      substring(COALESCE(n.data->>'link', '') FROM '/encuesta/([0-9]+)')
    ) AS match_key,
    COALESCE(
      NULLIF(lower(n.data->>'reminder_type'), ''),
      NULLIF(lower(n.data->>'reminderType'), ''),
      CASE
        WHEN n.type = 'survey_reminder_12h' THEN '12h_before_deadline'
        WHEN n.type = 'survey_reminder' THEN '1h_before_deadline'
        ELSE ''
      END
    ) AS reminder_key,
    COALESCE(
      NULLIF(lower(btrim(COALESCE(n.data->>'match_name', ''))), ''),
      NULLIF(lower(btrim(COALESCE(n.data->>'partido_nombre', ''))), ''),
      NULLIF(lower(btrim(regexp_replace(COALESCE(n.message, ''), '\s+', ' ', 'g'))), '')
    ) AS fallback_key,
    COALESCE(n.read, false) AS is_read,
    COALESCE(n.send_at, n.created_at) AS sort_ts
  FROM public.notifications n
  WHERE n.type IN ('survey_reminder', 'survey_reminder_12h')
),
ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, type, COALESCE(match_key, fallback_key), reminder_key
      ORDER BY
        CASE WHEN is_read THEN 1 ELSE 0 END ASC,
        sort_ts DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM normalized
  WHERE COALESCE(match_key, fallback_key, '') <> ''
)
DELETE FROM public.notifications n
USING ranked r
WHERE n.id = r.id
  AND r.rn > 1;

-- 2) Prevent future duplicates at DB level for reminders with a resolvable match key.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_survey_reminder_user_match_type
ON public.notifications (
  user_id,
  type,
  COALESCE(
    NULLIF(partido_id::text, ''),
    NULLIF(data->>'partido_id', ''),
    NULLIF(data->>'partidoId', ''),
    NULLIF(data->>'match_id', ''),
    NULLIF(data->>'matchId', ''),
    substring(COALESCE(data->>'link', '') FROM '/encuesta/([0-9]+)')
  ),
  COALESCE(
    NULLIF(lower(data->>'reminder_type'), ''),
    NULLIF(lower(data->>'reminderType'), ''),
    CASE
      WHEN type = 'survey_reminder_12h' THEN '12h_before_deadline'
      WHEN type = 'survey_reminder' THEN '1h_before_deadline'
      ELSE ''
    END
  )
)
WHERE type IN ('survey_reminder', 'survey_reminder_12h')
  AND COALESCE(
    NULLIF(partido_id::text, ''),
    NULLIF(data->>'partido_id', ''),
    NULLIF(data->>'partidoId', ''),
    NULLIF(data->>'match_id', ''),
    NULLIF(data->>'matchId', ''),
    substring(COALESCE(data->>'link', '') FROM '/encuesta/([0-9]+)')
  ) IS NOT NULL;

COMMIT;
