-- Align provider normalization with real native token sources.
-- iOS (Capacitor PushNotifications) -> APNS token
-- Android (Capacitor PushNotifications) -> FCM token

CREATE OR REPLACE FUNCTION public.normalize_push_provider(
  p_provider text,
  p_platform text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE public.normalize_push_platform($2)
    WHEN 'ios' THEN 'apns'
    WHEN 'android' THEN 'fcm'
    WHEN 'web' THEN 'unknown'
    ELSE CASE lower(trim(COALESCE($1, '')))
      WHEN 'fcm' THEN 'fcm'
      WHEN 'apns' THEN 'apns'
      WHEN 'unknown' THEN 'unknown'
      ELSE 'unknown'
    END
  END;
$$;

-- Backfill existing rows to canonical provider by platform.
UPDATE public.device_tokens
SET
  provider = 'apns',
  updated_at = now()
WHERE platform = 'ios'
  AND provider IS DISTINCT FROM 'apns';

UPDATE public.device_tokens
SET
  provider = 'fcm',
  updated_at = now()
WHERE platform = 'android'
  AND provider IS DISTINCT FROM 'fcm';
