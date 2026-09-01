BEGIN;

CREATE OR REPLACE FUNCTION public.promote_substitute_after_player_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted_id bigint;
  v_promoted_user uuid;
  v_promoted_name text;
  v_match_name text;
  v_notification_message text;
  v_notification_payload jsonb;
BEGIN
  IF COALESCE(OLD.is_substitute, false) = false THEN
    SELECT j.id, j.usuario_id, j.nombre
      INTO v_promoted_id, v_promoted_user, v_promoted_name
    FROM public.jugadores j
    WHERE j.partido_id = OLD.partido_id
      AND COALESCE(j.is_substitute, false) = true
    ORDER BY COALESCE(j.substitute_order, 999), j.created_at, j.id
    LIMIT 1;

    IF v_promoted_id IS NOT NULL THEN
      UPDATE public.jugadores
      SET is_substitute = false,
          substitute_order = NULL
      WHERE id = v_promoted_id;

      WITH ordered AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY COALESCE(substitute_order, 999), created_at, id) AS rn
        FROM public.jugadores
        WHERE partido_id = OLD.partido_id
          AND COALESCE(is_substitute, false) = true
      )
      UPDATE public.jugadores j
      SET substitute_order = o.rn
      FROM ordered o
      WHERE j.id = o.id;

      IF v_promoted_user IS NOT NULL THEN
        SELECT COALESCE(NULLIF(trim(nombre), ''), 'Partido')
        INTO v_match_name
        FROM public.partidos
        WHERE id = OLD.partido_id;

        v_notification_message := FORMAT('Subiste de suplente a titular en "%s".', v_match_name);
        v_notification_payload := jsonb_build_object(
          'matchId', OLD.partido_id,
          'match_id', OLD.partido_id,
          'partido_id', OLD.partido_id,
          'match_name', v_match_name,
          'partido_nombre', v_match_name,
          'playerName', v_promoted_name,
          'player_name', v_promoted_name,
          'link', '/partido-publico/' || OLD.partido_id::text,
          'promotion_refreshed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        );

        UPDATE public.notifications
        SET
          title = 'Ahora sos titular',
          message = v_notification_message,
          data = v_notification_payload,
          read = false,
          created_at = now()
        WHERE user_id = v_promoted_user
          AND partido_id = OLD.partido_id
          AND type = 'substitute_promoted';

        IF NOT FOUND THEN
          INSERT INTO public.notifications (user_id, type, title, message, partido_id, data, read, created_at)
          VALUES (
            v_promoted_user,
            'substitute_promoted',
            'Ahora sos titular',
            v_notification_message,
            OLD.partido_id,
            v_notification_payload,
            false,
            now()
          );
        END IF;
      END IF;
    END IF;
  ELSE
    WITH ordered AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY COALESCE(substitute_order, 999), created_at, id) AS rn
      FROM public.jugadores
      WHERE partido_id = OLD.partido_id
        AND COALESCE(is_substitute, false) = true
    )
    UPDATE public.jugadores j
    SET substitute_order = o.rn
    FROM ordered o
    WHERE j.id = o.id;
  END IF;

  RETURN OLD;
END;
$$;

COMMIT;
