BEGIN;

-- Supabase lint hardening:
-- 1) Remove SECURITY DEFINER behavior from exposed views.
-- 2) Enable RLS on exposed tables flagged by the linter.

ALTER VIEW IF EXISTS public.partidos_view
  SET (security_invoker = on);

ALTER VIEW IF EXISTS public.notifications_ext
  SET (security_invoker = on);

DO $$
BEGIN
  IF to_regclass('public.partidos_jugadores_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.partidos_jugadores_log ENABLE ROW LEVEL SECURITY';

    -- Compatibility policy: preserve authenticated/service backend access patterns.
    EXECUTE 'DROP POLICY IF EXISTS partidos_jugadores_log_authenticated_all ON public.partidos_jugadores_log';
    EXECUTE 'CREATE POLICY partidos_jugadores_log_authenticated_all ON public.partidos_jugadores_log FOR ALL TO authenticated USING (true) WITH CHECK (true)';

    EXECUTE 'DROP POLICY IF EXISTS partidos_jugadores_log_service_role_all ON public.partidos_jugadores_log';
    EXECUTE 'CREATE POLICY partidos_jugadores_log_service_role_all ON public.partidos_jugadores_log FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.survey_progress') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.survey_progress ENABLE ROW LEVEL SECURITY';

    -- Compatibility policy: preserve authenticated/service backend access patterns.
    EXECUTE 'DROP POLICY IF EXISTS survey_progress_authenticated_all ON public.survey_progress';
    EXECUTE 'CREATE POLICY survey_progress_authenticated_all ON public.survey_progress FOR ALL TO authenticated USING (true) WITH CHECK (true)';

    EXECUTE 'DROP POLICY IF EXISTS survey_progress_service_role_all ON public.survey_progress';
    EXECUTE 'CREATE POLICY survey_progress_service_role_all ON public.survey_progress FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END
$$;

COMMIT;
