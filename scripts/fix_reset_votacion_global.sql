-- 1. Ensure columns exist in partidos (best practice)
ALTER TABLE public.partidos ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.partidos ADD COLUMN IF NOT EXISTS equipos_json jsonb;

-- 2. Add DELETE policies for the admin to use as fallback
DROP POLICY IF EXISTS "Admins can delete votes of their matches" ON public.votos;
CREATE POLICY "Admins can delete votes of their matches" ON public.votos
FOR DELETE USING (
  partido_id IN (SELECT id FROM public.partidos WHERE creado_por = auth.uid())
);

DROP POLICY IF EXISTS "Admins can delete public votes" ON public.votos_publicos;
CREATE POLICY "Admins can delete public votes" ON public.votos_publicos
FOR DELETE USING (
  partido_id IN (SELECT id FROM public.partidos WHERE creado_por = auth.uid())
);

DROP POLICY IF EXISTS "Admins can delete public voters" ON public.public_voters;
CREATE POLICY "Admins can delete public voters" ON public.public_voters
FOR DELETE USING (
  partido_id IN (SELECT id FROM public.partidos WHERE creado_por = auth.uid())
);

-- 3. Fix the RPC to be robust
CREATE OR REPLACE FUNCTION public.reset_votacion(match_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete all types of votes
  DELETE FROM public.votos WHERE partido_id = match_id;
  DELETE FROM public.votos_publicos WHERE partido_id = match_id;
  DELETE FROM public.public_voters WHERE partido_id = match_id;

  -- Reset player scores
  UPDATE public.jugadores
  SET score = NULL
  WHERE partido_id = match_id;

  -- Update match status and timestamp to trigger realtime
  UPDATE public.partidos
  SET estado = 'votacion',
      updated_at = now()
  WHERE id = match_id;

EXCEPTION WHEN OTHERS THEN
  -- Even if status update fails, the deletions are the most important
  RAISE WARNING 'Error in reset_votacion: %', SQLERRM;
END;
$$;
