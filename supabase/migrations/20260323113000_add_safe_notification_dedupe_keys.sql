BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_match_key text
    GENERATED ALWAYS AS (
      COALESCE(
        NULLIF(partido_id::text, ''),
        NULLIF(data->>'partido_id', ''),
        NULLIF(data->>'partidoId', ''),
        NULLIF(data->>'match_id', ''),
        NULLIF(data->>'matchId', '')
      )
    ) STORED;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_request_key text
    GENERATED ALWAYS AS (
      COALESCE(
        NULLIF(data->>'request_id', ''),
        NULLIF(data->>'requestId', '')
      )
    ) STORED;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text
    GENERATED ALWAYS AS (
      CASE
        WHEN type IN ('match_join_request', 'match_join_approved') THEN
          CASE
            WHEN COALESCE(
              NULLIF(data->>'request_id', ''),
              NULLIF(data->>'requestId', '')
            ) IS NOT NULL
            THEN 'request:' || COALESCE(
              NULLIF(data->>'request_id', ''),
              NULLIF(data->>'requestId', '')
            )
            ELSE NULL
          END
        WHEN type IN (
          'match_invite',
          'call_to_vote',
          'match_kicked',
          'match_update',
          'match_cancelled',
          'match_deleted',
          'survey_start',
          'post_match_survey',
          'survey_reminder',
          'survey_reminder_12h',
          'survey_results_ready',
          'awards_ready',
          'match_reminder_1h'
        ) THEN
          CASE
            WHEN COALESCE(
              NULLIF(partido_id::text, ''),
              NULLIF(data->>'partido_id', ''),
              NULLIF(data->>'partidoId', ''),
              NULLIF(data->>'match_id', ''),
              NULLIF(data->>'matchId', '')
            ) IS NOT NULL
            THEN 'match:' || COALESCE(
              NULLIF(partido_id::text, ''),
              NULLIF(data->>'partido_id', ''),
              NULLIF(data->>'partidoId', ''),
              NULLIF(data->>'match_id', ''),
              NULLIF(data->>'matchId', '')
            )
            ELSE NULL
          END
        ELSE NULL
      END
    ) STORED;

CREATE OR REPLACE FUNCTION public.normalize_request_scoped_notification_keys()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_type text := lower(trim(COALESCE(NEW.type, '')));
  v_match_key text;
  v_request_key text;
  v_link text;
BEGIN
  IF v_type NOT IN ('match_join_request', 'match_join_approved') THEN
    RETURN NEW;
  END IF;

  NEW.data := COALESCE(NEW.data, '{}'::jsonb);

  v_match_key := COALESCE(
    CASE WHEN NEW.partido_id IS NOT NULL THEN NEW.partido_id::text ELSE NULL END,
    NULLIF(NEW.data->>'partido_id', ''),
    NULLIF(NEW.data->>'partidoId', ''),
    NULLIF(NEW.data->>'match_id', ''),
    NULLIF(NEW.data->>'matchId', '')
  );

  v_request_key := COALESCE(
    NULLIF(NEW.data->>'request_id', ''),
    NULLIF(NEW.data->>'requestId', '')
  );

  IF v_request_key IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.data := NEW.data - 'match_id' - 'matchId';

  IF v_match_key IS NOT NULL THEN
    NEW.data := NEW.data || jsonb_build_object(
      'partido_id', v_match_key,
      'partidoId', v_match_key
    );
  END IF;

  NEW.data := NEW.data || jsonb_build_object(
    'request_id', v_request_key,
    'requestId', v_request_key
  );

  v_link := NULLIF(COALESCE(NEW.data->>'link', NEW.data->>'route'), '');
  IF v_link IS NULL AND v_match_key IS NOT NULL THEN
    v_link := CASE
      WHEN v_type = 'match_join_request' THEN '/admin/' || v_match_key || '?tab=solicitudes'
      ELSE '/partido-publico/' || v_match_key
    END;
    NEW.data := NEW.data || jsonb_build_object(
      'link', v_link,
      'route', v_link
    );
  END IF;

  -- Request-scoped notifications intentionally avoid legacy match-based unique
  -- constraints. Match context is preserved in payload for routers and push logic.
  NEW.partido_id := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_request_scoped_notification_keys ON public.notifications;
CREATE TRIGGER trg_normalize_request_scoped_notification_keys
BEFORE INSERT OR UPDATE OF type, data, partido_id
ON public.notifications
FOR EACH ROW
WHEN (lower(trim(COALESCE(NEW.type, ''))) IN ('match_join_request', 'match_join_approved'))
EXECUTE FUNCTION public.normalize_request_scoped_notification_keys();

CREATE OR REPLACE FUNCTION public.notify_admin_join_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_requester_name text;
  v_fecha date;
  v_hora text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT creado_por, fecha, hora
  INTO v_admin, v_fecha, v_hora
  FROM public.partidos
  WHERE id = NEW.match_id;

  IF v_admin IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(u.nombre, p.nombre, 'Un jugador')
  INTO v_requester_name
  FROM public.usuarios u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = NEW.user_id;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    partido_id,
    data,
    read,
    created_at
  ) VALUES (
    v_admin,
    'match_join_request',
    'Nueva solicitud para unirse',
    v_requester_name || ' quiere unirse al partido del ' ||
      COALESCE(to_char(v_fecha, 'DD/MM'), 'fecha pendiente') || ' · ' ||
      substring(COALESCE(v_hora, '00:00') from 1 for 5),
    NULL,
    jsonb_build_object(
      'partido_id', NEW.match_id::text,
      'partidoId', NEW.match_id,
      'request_id', NEW.id::text,
      'requestId', NEW.id::text,
      'request_user_id', NEW.user_id,
      'link', '/admin/' || NEW.match_id || '?tab=solicitudes'
    ),
    false,
    now()
  )
  ON CONFLICT (user_id, type, dedupe_key)
    WHERE dedupe_key IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE dedupe_key IS NOT NULL
    GROUP BY user_id, type, dedupe_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'notifications has duplicates under proposed (user_id, type, dedupe_key); aborting additive unique index creation';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_user_type_dedupe_key
ON public.notifications (user_id, type, dedupe_key)
WHERE dedupe_key IS NOT NULL;

COMMIT;
