BEGIN;

CREATE OR REPLACE FUNCTION public.notify_admin_join_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

ALTER FUNCTION public.notify_admin_join_request() OWNER TO postgres;

COMMIT;
