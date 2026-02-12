-- ============================================================================
-- MIGRATION: Sync auth.users -> public.usuarios
-- Date: 2026-02-12
-- Purpose:
--   1) Auto-create/update public.usuarios when auth.users changes
--   2) Backfill any missing rows in public.usuarios
-- ============================================================================

BEGIN;

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
    0,
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

DROP TRIGGER IF EXISTS trg_sync_usuarios_from_auth_insert ON auth.users;
CREATE TRIGGER trg_sync_usuarios_from_auth_insert
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_usuarios_from_auth_users();

DROP TRIGGER IF EXISTS trg_sync_usuarios_from_auth_update ON auth.users;
CREATE TRIGGER trg_sync_usuarios_from_auth_update
AFTER UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_usuarios_from_auth_users();

-- Backfill guard for already-created auth users without row in public.usuarios.
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
)
SELECT
  a.id,
  COALESCE(
    NULLIF(trim(a.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(a.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(a.email, ''), '@', 1), ''),
    'Jugador'
  ) AS nombre,
  a.email,
  COALESCE(
    NULLIF(trim(a.raw_user_meta_data ->> 'avatar_url'), ''),
    NULLIF(trim(a.raw_user_meta_data ->> 'picture'), '')
  ) AS avatar_url,
  0,
  0,
  true,
  false,
  0,
  0,
  now()
FROM auth.users a
LEFT JOIN public.usuarios u ON u.id = a.id
WHERE u.id IS NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;
