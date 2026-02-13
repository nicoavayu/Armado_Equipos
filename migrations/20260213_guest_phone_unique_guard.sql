-- Ensure jugadores has telefono so guest phone dedupe can run in edge function.
ALTER TABLE public.jugadores
  ADD COLUMN IF NOT EXISTS telefono text;

