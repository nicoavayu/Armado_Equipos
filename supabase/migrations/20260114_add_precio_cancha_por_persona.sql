-- Migration: add canonical price column to partidos_frecuentes
-- Created: 2026-01-14

BEGIN;

-- Add the canonical per-person price column if it doesn't exist
ALTER TABLE public.partidos_frecuentes
  ADD COLUMN IF NOT EXISTS precio_cancha_por_persona numeric NULL;

-- Migrate existing legacy columns into the new column when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partidos_frecuentes' AND column_name = 'precio_cancha'
  ) THEN
    UPDATE public.partidos_frecuentes
    SET precio_cancha_por_persona = precio_cancha
    WHERE precio_cancha_por_persona IS NULL AND precio_cancha IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partidos_frecuentes' AND column_name = 'valor_cancha'
  ) THEN
    UPDATE public.partidos_frecuentes
    SET precio_cancha_por_persona = valor_cancha
    WHERE precio_cancha_por_persona IS NULL AND valor_cancha IS NOT NULL;
  END IF;
END$$;

COMMIT;
