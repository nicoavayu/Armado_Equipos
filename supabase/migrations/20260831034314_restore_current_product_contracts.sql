-- Restore current product contracts omitted from the canonical schema and from
-- the authenticated EXECUTE allowlist. This migration is intentionally
-- additive: historical migrations and the canonical baseline remain frozen.

CREATE TABLE IF NOT EXISTS public.jugadores_sin_partido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    CONSTRAINT jugadores_sin_partido_user_id_fkey
    REFERENCES auth.users(id)
    ON DELETE CASCADE,
  nombre text NOT NULL,
  localidad text NOT NULL,
  avatar_url text,
  disponible boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jugadores_sin_partido_user_disponible_idx
  ON public.jugadores_sin_partido (user_id, disponible);

CREATE INDEX IF NOT EXISTS jugadores_sin_partido_disponible_created_at_idx
  ON public.jugadores_sin_partido (disponible, created_at DESC);

ALTER TABLE public.jugadores_sin_partido ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jugadores_sin_partido_select_authenticated
  ON public.jugadores_sin_partido;
CREATE POLICY jugadores_sin_partido_select_authenticated
  ON public.jugadores_sin_partido
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS jugadores_sin_partido_insert_own
  ON public.jugadores_sin_partido;
CREATE POLICY jugadores_sin_partido_insert_own
  ON public.jugadores_sin_partido
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS jugadores_sin_partido_update_own
  ON public.jugadores_sin_partido;
CREATE POLICY jugadores_sin_partido_update_own
  ON public.jugadores_sin_partido
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS jugadores_sin_partido_delete_own
  ON public.jugadores_sin_partido;
CREATE POLICY jugadores_sin_partido_delete_own
  ON public.jugadores_sin_partido
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.jugadores_sin_partido
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.jugadores_sin_partido
  TO authenticated;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS nacionalidad text,
  ADD COLUMN IF NOT EXISTS pais_codigo text,
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date,
  ADD COLUMN IF NOT EXISTS numero integer,
  ADD COLUMN IF NOT EXISTS lesion_activa boolean DEFAULT false;

-- The v2 view is security_invoker, so authenticated needs both the view grant
-- and EXECUTE on the exact invoker helpers used by its predicate/projection.
REVOKE ALL ON TABLE public.partidos_abiertos_operativos_v2
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.partidos_abiertos_operativos_v2
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_open_matches_for_quiero_jugar_v2(
  double precision,
  double precision,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_matches_for_quiero_jugar_v2(
  double precision,
  double precision,
  integer
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.partido_is_operationally_open(
  text,
  timestamp with time zone,
  text,
  text,
  timestamp with time zone,
  date,
  text,
  boolean,
  timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partido_is_operationally_open(
  text,
  timestamp with time zone,
  text,
  text,
  timestamp with time zone,
  date,
  text,
  boolean,
  timestamp with time zone
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.normalize_partido_estado(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_partido_estado(text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.partido_kickoff_at(date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partido_kickoff_at(date, text)
  TO authenticated;
