-- Migration: Add modalidad column to partidos_frecuentes
-- Purpose: Align modality (F5/F7/F11) between templates and matches

ALTER TABLE public.partidos_frecuentes ADD COLUMN IF NOT EXISTS modalidad text DEFAULT 'F5';

-- Backfill NULL values to 'F5' (optional, for data consistency)
UPDATE public.partidos_frecuentes SET modalidad = 'F5' WHERE modalidad IS NULL;
