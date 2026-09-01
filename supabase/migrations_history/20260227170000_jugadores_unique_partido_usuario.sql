BEGIN;

-- Keep at most one linked authenticated player row per (partido_id, usuario_id).
-- Extra duplicates are detached instead of deleted to preserve historical manual rows.
WITH ranked AS (
  SELECT
    id,
    partido_id,
    usuario_id,
    ROW_NUMBER() OVER (
      PARTITION BY partido_id, usuario_id
      ORDER BY id ASC
    ) AS rn
  FROM public.jugadores
  WHERE usuario_id IS NOT NULL
)
UPDATE public.jugadores j
SET usuario_id = NULL
FROM ranked r
WHERE j.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_partido_usuario_unique
  ON public.jugadores (partido_id, usuario_id);

COMMIT;
