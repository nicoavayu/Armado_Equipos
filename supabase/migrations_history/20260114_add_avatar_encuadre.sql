-- Migration: add avatar encuadre fields to usuarios
-- Adds avatar_zoom (numeric), avatar_pos_x (integer), avatar_pos_y (integer)

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS avatar_zoom numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS avatar_pos_x integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS avatar_pos_y integer DEFAULT 50;

-- Optionally add comment for clarity
COMMENT ON COLUMN public.usuarios.avatar_zoom IS 'Numeric scale for avatar zoom (default 1)';
COMMENT ON COLUMN public.usuarios.avatar_pos_x IS 'Avatar horizontal position in percent (0-100)';
COMMENT ON COLUMN public.usuarios.avatar_pos_y IS 'Avatar vertical position in percent (0-100)';
