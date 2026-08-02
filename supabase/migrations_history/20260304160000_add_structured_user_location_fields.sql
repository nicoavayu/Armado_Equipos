-- ============================================================================
-- MIGRATION: Add structured location fields to public.usuarios
-- Date: 2026-03-04
-- Purpose:
--   1) Persist user location metadata for proximity filtering
--   2) Keep backward compatibility with existing localidad/latitud/longitud
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.usuarios') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS location_accuracy_m double precision NULL,
    ADD COLUMN IF NOT EXISTS location_updated_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS location_label text NULL,
    ADD COLUMN IF NOT EXISTS location_city text NULL,
    ADD COLUMN IF NOT EXISTS location_state text NULL,
    ADD COLUMN IF NOT EXISTS location_country text NULL;

  UPDATE public.usuarios
  SET location_label = NULLIF(btrim(localidad), '')
  WHERE location_label IS NULL
    AND NULLIF(btrim(localidad), '') IS NOT NULL;
END
$$;

COMMENT ON COLUMN public.usuarios.location_accuracy_m IS 'GPS accuracy in meters for latest profile location.';
COMMENT ON COLUMN public.usuarios.location_updated_at IS 'Timestamp when profile location metadata was last refreshed.';
COMMENT ON COLUMN public.usuarios.location_label IS 'Short UI label for profile location (e.g. Palermo, CABA).';
COMMENT ON COLUMN public.usuarios.location_city IS 'Resolved city/locality from reverse geocoding.';
COMMENT ON COLUMN public.usuarios.location_state IS 'Resolved state/province from reverse geocoding.';
COMMENT ON COLUMN public.usuarios.location_country IS 'Resolved country from reverse geocoding.';

NOTIFY pgrst, 'reload schema';

COMMIT;
