-- Create function to send survey notifications
CREATE OR REPLACE FUNCTION public.fanout_survey_start_notifications()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  WITH eligible_matches AS (
    SELECT id, creado_por, jugadores
    FROM partidos
    WHERE (fecha::TEXT || ' ' || hora)::TIMESTAMP <= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::TIMESTAMP
      AND surveys_sent = false
  ),
  recipients AS (
    SELECT DISTINCT
      em.id AS match_id,
      COALESCE(
        (elem->>'usuario_id')::UUID,
        (elem->>'uuid')::UUID,
        em.creado_por
      ) AS user_id
    FROM eligible_matches em
    LEFT JOIN LATERAL jsonb_array_elements(em.jugadores) AS elem ON true
    WHERE COALESCE(
      (elem->>'usuario_id')::UUID,
      (elem->>'uuid')::UUID,
      em.creado_por
    ) IS NOT NULL
    
    UNION
    
    SELECT id AS match_id, creado_por AS user_id
    FROM eligible_matches
    WHERE creado_por IS NOT NULL
  ),
  inserted_notifications AS (
    INSERT INTO notifications (user_id, type, title, message, data, partido_id)
    SELECT
      r.user_id,
      'survey_start',
      '¡HORA DE CALIFICAR!',
      'Completá la encuesta del partido.',
      jsonb_build_object('match_id', r.match_id, 'link', '/encuesta/' || r.match_id::TEXT),
      r.match_id::bigint
    FROM recipients r
    ON CONFLICT ON CONSTRAINT uniq_notifications_user_matchref_type DO NOTHING
    RETURNING partido_id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted_notifications;

  -- Only mark partidos as surveys_sent if we actually inserted notifications
  IF v_inserted > 0 THEN
    UPDATE partidos
    SET surveys_sent = true
    WHERE id IN (SELECT DISTINCT partido_id FROM inserted_notifications);
  END IF;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fanout_survey_start_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_survey_start_notifications() TO anon;

-- Schedule cron job to run every minute
-- Note: This requires pg_cron extension or Supabase Edge Functions
-- For Supabase, create this as a Database Webhook or Edge Function scheduled task
-- Example for pg_cron (if available):
-- SELECT cron.schedule('survey_fanout', '* * * * *', 'SELECT public.fanout_survey_start_notifications();');

-- For Supabase Dashboard: Go to Database > Cron Jobs and create:
-- Name: survey_fanout
-- Schedule: * * * * * (every minute)
-- Command: SELECT public.fanout_survey_start_notifications();
