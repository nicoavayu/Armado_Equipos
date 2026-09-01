-- Match history snapshots (2-phase): participants at match end + survey aggregates at survey close
-- Additive and idempotent. Does not change existing flows.

ALTER TABLE public.survey_results
  ADD COLUMN IF NOT EXISTS snapshot_participantes_listo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snapshot_participantes jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_equipos jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_participantes_at timestamptz,
  ADD COLUMN IF NOT EXISTS resultados_encuesta_listos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snapshot_resultados_encuesta jsonb,
  ADD COLUMN IF NOT EXISTS encuesta_cerrada_at timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_resultados_at timestamptz;

COMMENT ON COLUMN public.survey_results.snapshot_participantes_listo IS 'Snapshot de participantes/equipos ya capturado para historial';
COMMENT ON COLUMN public.survey_results.snapshot_participantes IS 'Lista congelada de participantes del partido';
COMMENT ON COLUMN public.survey_results.snapshot_equipos IS 'Equipos congelados (A/B) cuando existen equipos confirmados';
COMMENT ON COLUMN public.survey_results.resultados_encuesta_listos IS 'Snapshot final de resultados de encuesta disponible para historial';
COMMENT ON COLUMN public.survey_results.snapshot_resultados_encuesta IS 'Resultados agregados congelados al cierre de encuesta';
COMMENT ON COLUMN public.survey_results.encuesta_cerrada_at IS 'Marca de tiempo de cierre lógico de encuesta';

CREATE OR REPLACE FUNCTION public.lock_match_history_snapshots()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Participants snapshot is immutable once set.
  IF OLD.snapshot_participantes_listo THEN
    IF NEW.snapshot_participantes_listo IS DISTINCT FROM OLD.snapshot_participantes_listo
      OR NEW.snapshot_participantes IS DISTINCT FROM OLD.snapshot_participantes
      OR NEW.snapshot_equipos IS DISTINCT FROM OLD.snapshot_equipos
      OR NEW.snapshot_participantes_at IS DISTINCT FROM OLD.snapshot_participantes_at THEN
      RAISE EXCEPTION 'snapshot_participantes is immutable once set';
    END IF;
  END IF;

  -- Survey results snapshot is immutable once set.
  IF OLD.resultados_encuesta_listos THEN
    IF NEW.resultados_encuesta_listos IS DISTINCT FROM OLD.resultados_encuesta_listos
      OR NEW.snapshot_resultados_encuesta IS DISTINCT FROM OLD.snapshot_resultados_encuesta
      OR NEW.encuesta_cerrada_at IS DISTINCT FROM OLD.encuesta_cerrada_at
      OR NEW.snapshot_resultados_at IS DISTINCT FROM OLD.snapshot_resultados_at THEN
      RAISE EXCEPTION 'snapshot_resultados_encuesta is immutable once set';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_match_history_snapshots ON public.survey_results;
CREATE TRIGGER trg_lock_match_history_snapshots
  BEFORE UPDATE ON public.survey_results
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_match_history_snapshots();
