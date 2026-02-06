
-- Add a unique constraint to jugadores table to support ON CONFLICT
ALTER TABLE public.jugadores
ADD CONSTRAINT jugadores_partido_usuario_unique UNIQUE (partido_id, usuario_id);
