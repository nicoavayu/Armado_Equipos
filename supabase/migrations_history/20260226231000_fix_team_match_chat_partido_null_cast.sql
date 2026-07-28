BEGIN;

DROP FUNCTION IF EXISTS public.send_team_match_chat_message(uuid, text, text);
CREATE OR REPLACE FUNCTION public.send_team_match_chat_message(
  p_team_match_id uuid,
  p_autor text,
  p_mensaje text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.team_matches%ROWTYPE;
  v_autor text := COALESCE(NULLIF(trim(p_autor), ''), 'Usuario');
  v_mensaje text := trim(COALESCE(p_mensaje, ''));
  v_partido_id integer := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_match_id IS NULL THEN
    RAISE EXCEPTION 'Partido invalido' USING ERRCODE = 'P0001';
  END IF;

  IF v_mensaje = '' THEN
    RAISE EXCEPTION 'Mensaje vacio' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_team_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.team_user_is_member(v_match.team_a_id, v_uid)
    OR public.team_user_is_member(v_match.team_b_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Sin permiso para enviar mensajes en este partido' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mensajes_partido'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE
      'INSERT INTO public.mensajes_partido (partido_id, team_match_id, autor, mensaje, user_id) VALUES ($1, $2, $3, $4, $5)'
      USING v_partido_id, p_team_match_id, v_autor, v_mensaje, v_uid;
  ELSE
    EXECUTE
      'INSERT INTO public.mensajes_partido (partido_id, team_match_id, autor, mensaje) VALUES ($1, $2, $3, $4)'
      USING v_partido_id, p_team_match_id, v_autor, v_mensaje;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_team_match_chat_message(uuid, text, text) TO authenticated, service_role;

COMMIT;
