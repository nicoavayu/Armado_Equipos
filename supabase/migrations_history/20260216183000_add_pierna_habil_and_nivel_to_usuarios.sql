-- ============================================================================
-- MIGRATION: Add pierna_habil + nivel profile fields to usuarios
-- Date: 2026-02-16
-- Purpose:
--   1) Persist preferred foot (right/left/both)
--   2) Persist self-perceived level (1..5)
-- ============================================================================

BEGIN;

ALTER TABLE IF EXISTS public.usuarios
  ADD COLUMN IF NOT EXISTS pierna_habil text,
  ADD COLUMN IF NOT EXISTS nivel integer;

DO $$
BEGIN
  IF to_regclass('public.usuarios') IS NULL THEN
    RETURN;
  END IF;

  -- Normalize legacy/invalid values before adding constraints.
  UPDATE public.usuarios
  SET pierna_habil = NULL
  WHERE pierna_habil IS NOT NULL
    AND (
      btrim(pierna_habil) = ''
      OR pierna_habil NOT IN ('right', 'left', 'both')
    );

  UPDATE public.usuarios
  SET nivel = NULL
  WHERE nivel IS NOT NULL
    AND (nivel < 1 OR nivel > 5);

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuarios_pierna_habil_check'
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_pierna_habil_check
      CHECK (pierna_habil IS NULL OR pierna_habil IN ('right', 'left', 'both'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuarios_nivel_check'
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_nivel_check
      CHECK (nivel IS NULL OR (nivel >= 1 AND nivel <= 5));
  END IF;
END
$$;

COMMENT ON COLUMN public.usuarios.pierna_habil IS 'Pierna habil del jugador: right, left o both.';
COMMENT ON COLUMN public.usuarios.nivel IS 'Nivel autopercibido del jugador (1 a 5).';

NOTIFY pgrst, 'reload schema';

COMMIT;
