-- Allow captains to reopen a closed squad even after scheduled_at,
-- as long as the challenge is not completed/canceled.

CREATE OR REPLACE FUNCTION public.rpc_set_challenge_squad_status(
  p_challenge_id uuid,
  p_squad_status text
)
RETURNS public.challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_next_status text := lower(COALESCE(p_squad_status, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_next_status NOT IN ('open', 'closed', 'finalized') THEN
    RAISE EXCEPTION 'Estado de convocatoria inválido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF NOT public.challenge_user_is_owner_or_captain(p_challenge_id, v_uid) THEN
    RAISE EXCEPTION 'Solo capitán puede cambiar la convocatoria';
  END IF;

  IF v_challenge.status IN ('completed', 'canceled') THEN
    RAISE EXCEPTION 'El desafío ya está finalizado o cancelado';
  END IF;

  IF v_next_status = 'open' THEN
    UPDATE public.challenges c
    SET
      squad_status = 'open',
      squad_opened_at = COALESCE(c.squad_opened_at, now()),
      squad_closed_at = NULL,
      updated_at = now()
    WHERE c.id = p_challenge_id
    RETURNING * INTO v_challenge;
  ELSIF v_next_status = 'closed' THEN
    UPDATE public.challenges c
    SET
      squad_status = 'closed',
      squad_closed_at = now(),
      updated_at = now()
    WHERE c.id = p_challenge_id
    RETURNING * INTO v_challenge;
  ELSE
    UPDATE public.challenges c
    SET
      squad_status = 'finalized',
      squad_closed_at = COALESCE(c.squad_closed_at, now()),
      updated_at = now()
    WHERE c.id = p_challenge_id
    RETURNING * INTO v_challenge;
  END IF;

  RETURN v_challenge;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_challenge_squad_status(uuid, text) TO authenticated, service_role;
