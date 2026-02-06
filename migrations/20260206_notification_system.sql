-- ============================================================================
-- MIGRATION: Notification System Overhaul
-- Date: 2026-02-06
-- Purpose: Add delivery tracking, centralized dispatcher, survey notifications
-- ============================================================================

-- ============================================================================
-- 1. DELIVERY LOG TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  partido_id bigint REFERENCES public.partidos(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.usuarios(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  payload_json jsonb DEFAULT '{}'::jsonb,
  channel text NOT NULL CHECK (channel IN ('in_app', 'push')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error_text text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_count int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  
  -- Prevent duplicate notifications within same correlation
  CONSTRAINT unique_delivery_per_correlation 
    UNIQUE(user_id, partido_id, notification_type, correlation_id)
);

CREATE INDEX idx_delivery_log_partido ON public.notification_delivery_log(partido_id);
CREATE INDEX idx_delivery_log_user ON public.notification_delivery_log(user_id);
CREATE INDEX idx_delivery_log_status ON public.notification_delivery_log(status);
CREATE INDEX idx_delivery_log_type ON public.notification_delivery_log(notification_type);

-- RLS for delivery log (admin + own records)
ALTER TABLE public.notification_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own delivery logs"
ON public.notification_delivery_log
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ============================================================================
-- 2. SURVEY PROGRESS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.survey_progress (
  partido_id bigint PRIMARY KEY REFERENCES public.partidos(id) ON DELETE CASCADE,
  enabled_at timestamptz,
  first_response_at timestamptz,
  response_count int NOT NULL DEFAULT 0,
  results_notified boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_survey_progress_notified ON public.survey_progress(results_notified);

-- ============================================================================
-- 3. SOFT DELETE FOR PARTIDOS
-- ============================================================================
ALTER TABLE public.partidos 
  ADD COLUMN IF NOT EXISTS estado text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_partidos_estado ON public.partidos(estado);

-- ============================================================================
-- 4. CENTRAL NOTIFICATION DISPATCHER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_partido_notification(
  p_partido_id bigint,
  p_type text,
  p_title text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb AS $$
DECLARE
  v_correlation_id uuid := gen_random_uuid();
  v_recipient_id uuid;
  v_admin_id uuid;
  v_recipients uuid[];
  v_count int := 0;
  v_partido record;
BEGIN
  -- Get partido info
  SELECT * INTO v_partido FROM public.partidos WHERE id = p_partido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  -- Resolve recipients based on type
  CASE p_type
    WHEN 'match_cancelled', 'match_deleted' THEN
      -- All players + admin
      SELECT ARRAY_AGG(DISTINCT usuario_id) INTO v_recipients
      FROM public.jugadores WHERE partido_id = p_partido_id;
      
      IF v_partido.admin_id IS NOT NULL THEN
        v_recipients := array_append(v_recipients, v_partido.admin_id);
      END IF;

    WHEN 'survey_start', 'survey_results_ready' THEN
      -- All registered players + admin
      SELECT ARRAY_AGG(DISTINCT usuario_id) INTO v_recipients
      FROM public.jugadores 
      WHERE partido_id = p_partido_id AND usuario_id IS NOT NULL;
      
      IF v_partido.admin_id IS NOT NULL THEN
        v_recipients := array_append(v_recipients, v_partido.admin_id);
      END IF;

    ELSE
      -- Default: admin only
      v_recipients := ARRAY[v_partido.admin_id];
  END CASE;

  -- Remove nulls and duplicates
  v_recipients := ARRAY(SELECT DISTINCT unnest(v_recipients) WHERE unnest IS NOT NULL);

  -- Insert notifications for each recipient
  FOREACH v_recipient_id IN ARRAY v_recipients
  LOOP
    -- Insert in-app notification
    INSERT INTO public.notifications (
      user_id,
      partido_id,
      type,
      title,
      message,
      data,
      read
    ) VALUES (
      v_recipient_id,
      p_partido_id,
      p_type,
      COALESCE(p_title, 'Notificación de partido'),
      COALESCE(p_message, 'Tienes una nueva notificación'),
      p_payload,
      false
    )
    ON CONFLICT DO NOTHING; -- Prevent duplicates if constraint exists

    -- Log delivery (in_app channel)
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status
    ) VALUES (
      p_partido_id,
      v_recipient_id,
      p_type,
      p_payload,
      v_correlation_id,
      'in_app',
      'queued'
    )
    ON CONFLICT DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'correlation_id', v_correlation_id,
    'recipients_count', v_count,
    'recipients', v_recipients
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.enqueue_partido_notification TO authenticated;

-- ============================================================================
-- 5. SURVEY NOTIFICATION FUNCTIONS
-- ============================================================================

-- Initialize survey progress when survey is enabled
CREATE OR REPLACE FUNCTION public.init_survey_progress()
RETURNS trigger AS $$
BEGIN
  IF NEW.encuesta_habilitada = true AND (OLD.encuesta_habilitada IS NULL OR OLD.encuesta_habilitada = false) THEN
    INSERT INTO public.survey_progress (partido_id, enabled_at)
    VALUES (NEW.id, now())
    ON CONFLICT (partido_id) DO UPDATE
      SET enabled_at = now(),
          results_notified = false;

    -- Notify all participants
    PERFORM public.enqueue_partido_notification(
      NEW.id,
      'survey_start',
      'Encuesta disponible',
      'La encuesta del partido ya está disponible para votar',
      jsonb_build_object('match_id', NEW.id, 'match_name', NEW.nombre)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_survey_enabled ON public.partidos;
CREATE TRIGGER on_survey_enabled
AFTER UPDATE ON public.partidos
FOR EACH ROW
EXECUTE FUNCTION public.init_survey_progress();

-- Check survey completion after each response
CREATE OR REPLACE FUNCTION public.check_survey_completion()
RETURNS trigger AS $$
DECLARE
  v_progress record;
  v_should_notify boolean := false;
BEGIN
  -- Update progress count
  UPDATE public.survey_progress
  SET 
    response_count = response_count + 1,
    first_response_at = COALESCE(first_response_at, now()),
    updated_at = now()
  WHERE partido_id = NEW.partido_id
  RETURNING * INTO v_progress;

  -- Check if we should notify (3+ responses and not already notified)
  IF v_progress.response_count >= 3 AND v_progress.results_notified = false THEN
    v_should_notify := true;
  END IF;

  IF v_should_notify THEN
    -- Mark as notified
    UPDATE public.survey_progress
    SET results_notified = true, closed_at = now()
    WHERE partido_id = NEW.partido_id;

    -- Send notification
    PERFORM public.enqueue_partido_notification(
      NEW.partido_id,
      'survey_results_ready',
      'Resultados de encuesta listos',
      'Los resultados de la encuesta ya están disponibles (3+ respuestas)',
      jsonb_build_object(
        'match_id', NEW.partido_id,
        'response_count', v_progress.response_count,
        'reason', '3_responses'
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: This trigger assumes a table 'survey_responses' exists
-- Adjust table name if different
DROP TRIGGER IF EXISTS on_survey_response ON public.votos;
CREATE TRIGGER on_survey_response
AFTER INSERT ON public.votos
FOR EACH ROW
EXECUTE FUNCTION public.check_survey_completion();

-- ============================================================================
-- 6. SURVEY TIMEOUT CHECK (for cron job)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_survey_timeouts()
RETURNS jsonb AS $$
DECLARE
  v_progress record;
  v_count int := 0;
BEGIN
  -- Find surveys that:
  -- 1. Have at least 1 response
  -- 2. First response was >= 2 minutes ago
  -- 3. Haven't been notified yet
  FOR v_progress IN
    SELECT *
    FROM public.survey_progress
    WHERE results_notified = false
      AND response_count >= 1
      AND first_response_at <= now() - interval '2 minutes'
  LOOP
    -- Mark as notified
    UPDATE public.survey_progress
    SET results_notified = true, closed_at = now()
    WHERE partido_id = v_progress.partido_id;

    -- Send notification
    PERFORM public.enqueue_partido_notification(
      v_progress.partido_id,
      'survey_results_ready',
      'Resultados de encuesta listos (timeout)',
      'Los resultados de la encuesta ya están disponibles (2 min timeout)',
      jsonb_build_object(
        'match_id', v_progress.partido_id,
        'response_count', v_progress.response_count,
        'reason', '2min_timeout'
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'surveys_closed', v_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_survey_timeouts TO authenticated;

-- ============================================================================
-- 7. MATCH CANCELLATION WITH NOTIFICATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_partido_with_notification(
  p_partido_id bigint,
  p_reason text DEFAULT 'Partido cancelado'
) RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Send notifications BEFORE cancelling
  v_result := public.enqueue_partido_notification(
    p_partido_id,
    'match_cancelled',
    'Partido cancelado',
    p_reason,
    jsonb_build_object('match_id', p_partido_id, 'reason', p_reason)
  );

  -- Soft delete
  UPDATE public.partidos
  SET estado = 'cancelado', deleted_at = now()
  WHERE id = p_partido_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.cancel_partido_with_notification TO authenticated;

-- ============================================================================
-- 8. DELIVERY LOG UPDATE FUNCTION (for frontend to mark sent/failed)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_delivery_status(
  p_log_id uuid,
  p_status text,
  p_error_text text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE public.notification_delivery_log
  SET 
    status = p_status,
    error_text = p_error_text,
    sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
    attempt_count = attempt_count + 1
  WHERE id = p_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_delivery_status TO authenticated;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
