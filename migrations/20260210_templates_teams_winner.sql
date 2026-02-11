-- Migration: Templates (Historial) linkage + Team confirmation snapshot + Winner survey fields
-- Date: 2026-02-10
-- Notes:
-- - Safe/idempotent: uses IF NOT EXISTS where possible.
-- - Does not remove/rename legacy columns (e.g. from_frequent_match_id).

-- 1) Link partidos -> plantilla (template)
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS template_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'partidos'
      AND constraint_name = 'partidos_template_id_fkey'
  ) THEN
    ALTER TABLE public.partidos
      ADD CONSTRAINT partidos_template_id_fkey
      FOREIGN KEY (template_id)
      REFERENCES public.partidos_frecuentes(id)
      ON DELETE SET NULL;
  END IF;
END$$;

-- 2) Templates: store cupo + optional short address label
ALTER TABLE public.partidos_frecuentes
  ADD COLUMN IF NOT EXISTS cupo_jugadores int,
  ADD COLUMN IF NOT EXISTS direccion_corta text;

-- 3) Team confirmation flags on partido
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS teams_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teams_confirmed_at timestamptz;

-- 4) Snapshot table for "equipos confirmados" + participants snapshot
CREATE TABLE IF NOT EXISTS public.partido_team_confirmations (
  partido_id bigint PRIMARY KEY REFERENCES public.partidos(id) ON DELETE CASCADE,
  template_id uuid NULL REFERENCES public.partidos_frecuentes(id) ON DELETE SET NULL,
  confirmed_by uuid NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  -- Stable snapshot (includes guests + logged users) at the time of confirmation
  participants jsonb NOT NULL,
  -- Store actual team membership by player UUID (jugadores.uuid)
  team_a uuid[] NOT NULL,
  team_b uuid[] NOT NULL,
  -- Optional: store the full team objects (same shape as partidos.equipos_json) for UI convenience
  teams_json jsonb NOT NULL
);

ALTER TABLE public.partido_team_confirmations ENABLE ROW LEVEL SECURITY;

-- Read: match creator OR a registered player of the match can read
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='partido_team_confirmations'
      AND policyname='ptc_select_creator_or_player'
  ) THEN
    CREATE POLICY ptc_select_creator_or_player
    ON public.partido_team_confirmations
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.partidos p
        WHERE p.id = partido_team_confirmations.partido_id
          AND p.creado_por = auth.uid()
      )
      OR
      EXISTS (
        SELECT 1 FROM public.jugadores j
        WHERE j.partido_id = partido_team_confirmations.partido_id
          AND j.usuario_id = auth.uid()
      )
    );
  END IF;
END$$;

-- Write: only match creator can insert/update/delete snapshots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='partido_team_confirmations'
      AND policyname='ptc_insert_creator_only'
  ) THEN
    CREATE POLICY ptc_insert_creator_only
    ON public.partido_team_confirmations
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.partidos p
        WHERE p.id = partido_team_confirmations.partido_id
          AND p.creado_por = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='partido_team_confirmations'
      AND policyname='ptc_update_creator_only'
  ) THEN
    CREATE POLICY ptc_update_creator_only
    ON public.partido_team_confirmations
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.partidos p
        WHERE p.id = partido_team_confirmations.partido_id
          AND p.creado_por = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.partidos p
        WHERE p.id = partido_team_confirmations.partido_id
          AND p.creado_por = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='partido_team_confirmations'
      AND policyname='ptc_delete_creator_only'
  ) THEN
    CREATE POLICY ptc_delete_creator_only
    ON public.partido_team_confirmations
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.partidos p
        WHERE p.id = partido_team_confirmations.partido_id
          AND p.creado_por = auth.uid()
      )
    );
  END IF;
END$$;

-- 5) Survey: store winner A/B/(draw) and optional scoreline at survey-level
ALTER TABLE public.post_match_surveys
  ADD COLUMN IF NOT EXISTS ganador text,
  ADD COLUMN IF NOT EXISTS resultado text;

-- 6) Results: store aggregated winner on survey_results (used by templates stats)
ALTER TABLE public.survey_results
  ADD COLUMN IF NOT EXISTS winner_team text,
  ADD COLUMN IF NOT EXISTS scoreline text;

