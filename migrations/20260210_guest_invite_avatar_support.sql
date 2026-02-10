-- Ensure guest-link joins can persist uploaded avatar data
ALTER TABLE public.jugadores
  ADD COLUMN IF NOT EXISTS avatar_url text;
