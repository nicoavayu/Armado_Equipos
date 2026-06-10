-- Deep-link invites + secure accept flow
-- - public.invites stores opaque tokens
-- - get_invite_landing can be called by anon/authenticated (token-only metadata)
-- - accept_invite_for_user is service_role only (called from Edge Function)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.invites (
  id bigserial PRIMARY KEY,
  token text NOT NULL UNIQUE,
  partido_id bigint NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  max_uses integer NULL,
  uses_count integer NOT NULL DEFAULT 0,
  accepted_at timestamptz NULL,
  CONSTRAINT invites_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
  CONSTRAINT invites_uses_non_negative CHECK (uses_count >= 0)
);

CREATE INDEX IF NOT EXISTS invites_partido_id_idx ON public.invites (partido_id);
CREATE INDEX IF NOT EXISTS invites_expires_at_idx ON public.invites (expires_at);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Keep direct table access closed by default. Admin-facing operations should use RPCs.
DROP POLICY IF EXISTS invites_admin_select ON public.invites;
CREATE POLICY invites_admin_select
ON public.invites
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = invites.partido_id
      AND p.creado_por = auth.uid()
  )
);

DROP POLICY IF EXISTS invites_admin_insert ON public.invites;
CREATE POLICY invites_admin_insert
ON public.invites
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = invites.partido_id
      AND p.creado_por = auth.uid()
  )
);

DROP POLICY IF EXISTS invites_admin_update ON public.invites;
CREATE POLICY invites_admin_update
ON public.invites
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = invites.partido_id
      AND p.creado_por = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = invites.partido_id
      AND p.creado_por = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.create_invite(
  p_partido_id bigint,
  p_expires_in_hours integer DEFAULT 24,
  p_max_uses integer DEFAULT NULL
)
RETURNS TABLE(token text, expires_at timestamptz, max_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
  v_expires_at timestamptz;
  v_max_uses integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_expires_in_hours IS NULL OR p_expires_in_hours <= 0 THEN
    RAISE EXCEPTION 'invalid_expiry';
  END IF;

  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'invalid_max_uses';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = p_partido_id
      AND p.creado_por = v_uid
  ) THEN
    RAISE EXCEPTION 'not_match_admin';
  END IF;

  v_token := replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '/', '_'), '+', '-'), '=', '');
  v_expires_at := now() + make_interval(hours => p_expires_in_hours);
  v_max_uses := p_max_uses;

  INSERT INTO public.invites (
    token,
    partido_id,
    created_by,
    expires_at,
    max_uses
  ) VALUES (
    v_token,
    p_partido_id,
    v_uid,
    v_expires_at,
    v_max_uses
  );

  RETURN QUERY SELECT v_token, v_expires_at, v_max_uses;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_invite(bigint, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_invite_landing(p_token text)
RETURNS TABLE(
  valid boolean,
  reason text,
  partido_id bigint,
  nombre text,
  fecha date,
  hora time,
  sede text,
  admin_nombre text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invites%ROWTYPE;
BEGIN
  SELECT *
  INTO v_invite
  FROM public.invites i
  WHERE i.token = trim(COALESCE(p_token, ''))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid', NULL::bigint, NULL::text, NULL::date, NULL::time, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked', NULL::bigint, NULL::text, NULL::date, NULL::time, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_invite.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'expired', NULL::bigint, NULL::text, NULL::date, NULL::time, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.uses_count >= v_invite.max_uses THEN
    RETURN QUERY SELECT false, 'max_uses_reached', NULL::bigint, NULL::text, NULL::date, NULL::time, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true,
    'ok',
    p.id,
    p.nombre,
    p.fecha,
    p.hora,
    p.sede,
    COALESCE(pr.nombre, u.nombre, 'Administrador')
  FROM public.partidos p
  LEFT JOIN public.usuarios u ON u.id = p.creado_por
  LEFT JOIN public.profiles pr ON pr.id = p.creado_por
  WHERE p.id = v_invite.partido_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_landing(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_invite_landing(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_invite_for_user(
  p_token text,
  p_user_id uuid
)
RETURNS TABLE(status text, partido_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invites%ROWTYPE;
  v_nombre text;
  v_avatar_url text;
  v_inserted_id bigint;
BEGIN
  IF trim(COALESCE(p_token, '')) = '' OR p_user_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint;
    RETURN;
  END IF;

  SELECT *
  INTO v_invite
  FROM public.invites i
  WHERE i.token = trim(p_token)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint;
    RETURN;
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, NULL::bigint;
    RETURN;
  END IF;

  IF v_invite.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::bigint;
    RETURN;
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.uses_count >= v_invite.max_uses THEN
    RETURN QUERY SELECT 'max_uses_reached'::text, NULL::bigint;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.jugadores j
    WHERE j.partido_id = v_invite.partido_id
      AND j.usuario_id = p_user_id
  ) THEN
    RETURN QUERY SELECT 'already_accepted'::text, v_invite.partido_id;
    RETURN;
  END IF;

  SELECT COALESCE(pr.nombre, u.nombre, 'Jugador'), COALESCE(pr.avatar_url, u.avatar_url)
  INTO v_nombre, v_avatar_url
  FROM (SELECT p_user_id AS id) x
  LEFT JOIN public.usuarios u ON u.id = x.id
  LEFT JOIN public.profiles pr ON pr.id = x.id;

  BEGIN
    INSERT INTO public.jugadores (
      partido_id,
      usuario_id,
      nombre,
      avatar_url,
      score,
      is_goalkeeper
    ) VALUES (
      v_invite.partido_id,
      p_user_id,
      v_nombre,
      v_avatar_url,
      5,
      false
    )
    ON CONFLICT (partido_id, usuario_id) DO NOTHING
    RETURNING id INTO v_inserted_id;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RETURN QUERY SELECT 'match_full'::text, v_invite.partido_id;
      RETURN;
  END;

  IF v_inserted_id IS NULL THEN
    RETURN QUERY SELECT 'already_accepted'::text, v_invite.partido_id;
    RETURN;
  END IF;

  UPDATE public.invites
  SET uses_count = uses_count + 1,
      accepted_at = now()
  WHERE id = v_invite.id;

  RETURN QUERY SELECT 'accepted'::text, v_invite.partido_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite_for_user(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_invite_for_user(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.accept_invite_for_user(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite_for_user(text, uuid) TO service_role;
