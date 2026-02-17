-- ============================================================================
-- MIGRATION: Cleanup invalid coordinates in public.usuarios
-- Date: 2026-02-17
-- Purpose:
--   1) Nullify invalid lat/lng values already stored
--   2) Prevent future invalid coordinates via CHECK constraints
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.usuarios') IS NULL THEN
    RETURN;
  END IF;

  -- Cleanup existing invalid coordinates.
  -- Cases considered invalid:
  -- - latitude outside [-90, 90]
  -- - longitude outside [-180, 180]
  -- - Null Island / placeholder coordinates (0,0)
  UPDATE public.usuarios
  SET latitud = NULL,
      longitud = NULL
  WHERE (
    latitud IS NOT NULL
    AND (latitud < -90 OR latitud > 90)
  ) OR (
    longitud IS NOT NULL
    AND (longitud < -180 OR longitud > 180)
  ) OR (
    latitud IS NOT NULL
    AND longitud IS NOT NULL
    AND abs(latitud) < 0.0001
    AND abs(longitud) < 0.0001
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuarios_latitud_range_check'
      AND conrelid = 'public.usuarios'::regclass
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_latitud_range_check
      CHECK (
        latitud IS NULL
        OR (latitud >= -90 AND latitud <= 90)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuarios_longitud_range_check'
      AND conrelid = 'public.usuarios'::regclass
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_longitud_range_check
      CHECK (
        longitud IS NULL
        OR (longitud >= -180 AND longitud <= 180)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuarios_latlng_not_zero_zero_check'
      AND conrelid = 'public.usuarios'::regclass
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_latlng_not_zero_zero_check
      CHECK (
        latitud IS NULL
        OR longitud IS NULL
        OR NOT (
          abs(latitud) < 0.0001
          AND abs(longitud) < 0.0001
        )
      );
  END IF;
END
$$;

COMMENT ON CONSTRAINT usuarios_latitud_range_check ON public.usuarios IS 'Latitud valida entre -90 y 90 o NULL.';
COMMENT ON CONSTRAINT usuarios_longitud_range_check ON public.usuarios IS 'Longitud valida entre -180 y 180 o NULL.';
COMMENT ON CONSTRAINT usuarios_latlng_not_zero_zero_check ON public.usuarios IS 'Bloquea coordenadas placeholder (0,0).';

NOTIFY pgrst, 'reload schema';

COMMIT;
