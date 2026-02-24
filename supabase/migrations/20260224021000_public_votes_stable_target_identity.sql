BEGIN;

-- Persist stable player identifiers inside authenticated votes too.
ALTER TABLE public.votos
  ADD COLUMN IF NOT EXISTS votado_usuario_id uuid;

CREATE OR REPLACE FUNCTION public.votos_sync_target_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id uuid;
BEGIN
  IF NEW.votado_id IS NULL OR NEW.partido_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT j.usuario_id
  INTO v_usuario_id
  FROM public.jugadores j
  WHERE j.partido_id = NEW.partido_id
    AND (
      j.uuid::text = NEW.votado_id::text
      OR j.usuario_id::text = NEW.votado_id::text
    )
  LIMIT 1;

  IF NEW.votado_usuario_id IS NULL THEN
    NEW.votado_usuario_id := v_usuario_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_votos_sync_target_identity ON public.votos;
CREATE TRIGGER trg_votos_sync_target_identity
BEFORE INSERT OR UPDATE OF votado_id, partido_id
ON public.votos
FOR EACH ROW
EXECUTE FUNCTION public.votos_sync_target_identity();

UPDATE public.votos v
SET votado_usuario_id = COALESCE(v.votado_usuario_id, j.usuario_id)
FROM public.jugadores j
WHERE j.partido_id = v.partido_id
  AND (
    j.uuid::text = v.votado_id::text
    OR j.usuario_id::text = v.votado_id::text
  )
  AND v.votado_usuario_id IS NULL;

CREATE INDEX IF NOT EXISTS votos_partido_votado_usuario_idx
  ON public.votos (partido_id, votado_usuario_id);

-- Persist stable player identifiers inside public votes.
-- This prevents vote orphaning when jugadores rows are replaced (new id/uuid).
ALTER TABLE public.votos_publicos
  ADD COLUMN IF NOT EXISTS votado_uuid uuid,
  ADD COLUMN IF NOT EXISTS votado_usuario_id uuid;

CREATE OR REPLACE FUNCTION public.votos_publicos_sync_target_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid uuid;
  v_usuario_id uuid;
BEGIN
  IF NEW.votado_jugador_id IS NULL OR NEW.partido_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT j.uuid, j.usuario_id
  INTO v_uuid, v_usuario_id
  FROM public.jugadores j
  WHERE j.id = NEW.votado_jugador_id
    AND j.partido_id = NEW.partido_id
  LIMIT 1;

  IF NEW.votado_uuid IS NULL THEN
    NEW.votado_uuid := v_uuid;
  END IF;

  IF NEW.votado_usuario_id IS NULL THEN
    NEW.votado_usuario_id := v_usuario_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_votos_publicos_sync_target_identity ON public.votos_publicos;
CREATE TRIGGER trg_votos_publicos_sync_target_identity
BEFORE INSERT OR UPDATE OF votado_jugador_id, partido_id
ON public.votos_publicos
FOR EACH ROW
EXECUTE FUNCTION public.votos_publicos_sync_target_identity();

-- Backfill existing votes while current roster rows still exist.
UPDATE public.votos_publicos vp
SET
  votado_uuid = COALESCE(vp.votado_uuid, j.uuid),
  votado_usuario_id = COALESCE(vp.votado_usuario_id, j.usuario_id)
FROM public.jugadores j
WHERE j.id = vp.votado_jugador_id
  AND j.partido_id = vp.partido_id
  AND (vp.votado_uuid IS NULL OR vp.votado_usuario_id IS NULL);

CREATE INDEX IF NOT EXISTS votos_publicos_partido_votado_uuid_idx
  ON public.votos_publicos (partido_id, votado_uuid);

CREATE INDEX IF NOT EXISTS votos_publicos_partido_votado_usuario_idx
  ON public.votos_publicos (partido_id, votado_usuario_id);

COMMIT;
