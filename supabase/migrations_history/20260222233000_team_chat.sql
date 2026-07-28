BEGIN;

CREATE TABLE IF NOT EXISTS public.team_chat_messages (
  id bigserial PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  autor text NOT NULL,
  mensaje text NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_chat_messages_autor_nonempty CHECK (char_length(trim(autor)) > 0),
  CONSTRAINT team_chat_messages_mensaje_nonempty CHECK (char_length(trim(mensaje)) > 0)
);

CREATE INDEX IF NOT EXISTS team_chat_messages_team_timestamp_idx
  ON public.team_chat_messages(team_id, "timestamp" ASC, id ASC);

ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_chat_messages_select_member_only ON public.team_chat_messages;
CREATE POLICY team_chat_messages_select_member_only
ON public.team_chat_messages
FOR SELECT
TO authenticated
USING (public.team_user_is_member(team_id, auth.uid()));

DROP POLICY IF EXISTS team_chat_messages_insert_member_only ON public.team_chat_messages;
CREATE POLICY team_chat_messages_insert_member_only
ON public.team_chat_messages
FOR INSERT
TO authenticated
WITH CHECK (public.team_user_is_member(team_id, auth.uid()));

GRANT SELECT, INSERT ON public.team_chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_chat_messages TO service_role;

CREATE OR REPLACE FUNCTION public.send_team_chat_message(
  p_team_id uuid,
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
  v_autor text := COALESCE(NULLIF(trim(p_autor), ''), 'Usuario');
  v_mensaje text := trim(COALESCE(p_mensaje, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'Equipo invalido' USING ERRCODE = 'P0001';
  END IF;

  IF v_mensaje = '' THEN
    RAISE EXCEPTION 'Mensaje vacio' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.team_user_is_member(p_team_id, v_uid) THEN
    RAISE EXCEPTION 'Sin permiso para enviar mensajes en este equipo' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.team_chat_messages (team_id, user_id, autor, mensaje)
  VALUES (p_team_id, v_uid, v_autor, v_mensaje);
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_team_chat_message(uuid, text, text) TO authenticated;

COMMIT;
