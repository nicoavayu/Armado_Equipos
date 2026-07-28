BEGIN;

-- Product invariant: every player starts at 5.0 and no persisted player rating
-- can exceed 5.0. Normalize legacy overflow before enforcing the invariant.
UPDATE public.usuarios
SET ranking = 5.0
WHERE ranking > 5.0;

ALTER TABLE public.usuarios
  ALTER COLUMN ranking SET DEFAULT 5.0;

CREATE OR REPLACE FUNCTION public.clamp_usuario_player_rating()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.ranking := LEAST(COALESCE(NEW.ranking, 5.0), 5.0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clamp_usuario_player_rating ON public.usuarios;
CREATE TRIGGER trg_clamp_usuario_player_rating
BEFORE INSERT OR UPDATE OF ranking ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.clamp_usuario_player_rating();

ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_ranking_max_five_check;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_ranking_max_five_check
  CHECK (ranking IS NULL OR ranking <= 5.0)
  NOT VALID;
ALTER TABLE public.usuarios
  VALIDATE CONSTRAINT usuarios_ranking_max_five_check;

-- The auth sync migration explicitly inserted 0. Recreate it with the real
-- initial rating while preserving its metadata/update behavior.
CREATE OR REPLACE FUNCTION public.sync_usuarios_from_auth_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_nombre text;
  v_avatar_url text;
BEGIN
  v_nombre := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Jugador'
  );

  v_avatar_url := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'avatar_url'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'picture'), '')
  );

  INSERT INTO public.usuarios (
    id,
    nombre,
    email,
    avatar_url,
    ranking,
    partidos_jugados,
    acepta_invitaciones,
    perfil_completo,
    profile_completion,
    partidos_abandonados,
    updated_at
  ) VALUES (
    NEW.id,
    v_nombre,
    NEW.email,
    v_avatar_url,
    5.0,
    0,
    true,
    false,
    0,
    0,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    updated_at = now(),
    nombre = CASE
      WHEN public.usuarios.nombre IS NULL OR btrim(public.usuarios.nombre) = '' THEN EXCLUDED.nombre
      ELSE public.usuarios.nombre
    END,
    avatar_url = COALESCE(public.usuarios.avatar_url, EXCLUDED.avatar_url);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clamp_usuario_player_rating() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_usuarios_from_auth_users() FROM PUBLIC;

COMMIT;
