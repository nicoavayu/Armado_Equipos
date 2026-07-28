-- Post-match payments (MVP — NO Mercado Pago integration).
-- Arma2 ONLY ORGANIZES payment state; it never receives, holds or processes money.
-- The app opens/copies the collector's alias/link and tracks who paid / who owes.
-- Consumed by src/services/db/payments.js and src/pages/PaymentsView.js.
--
-- Compatibility: matches without payment settings keep working exactly as before
-- (no rows here => survey/results/navigation untouched).

BEGIN;

-- ============================================================
-- Tables
-- ============================================================

-- One settings row per match (who collects + amount + closed state).
CREATE TABLE IF NOT EXISTS public.match_payment_settings (
  partido_id BIGINT PRIMARY KEY REFERENCES public.partidos(id) ON DELETE CASCADE,
  amount_per_player NUMERIC(12,2) NULL,
  collector_user_id UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  collector_name TEXT NULL,
  collector_alias TEXT NULL,
  collector_payment_link TEXT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  closed_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT match_payment_settings_amount_non_negative
    CHECK (amount_per_player IS NULL OR amount_per_player >= 0)
);

-- One payment row per roster player per match.
CREATE TABLE IF NOT EXISTS public.match_player_payments (
  id BIGSERIAL PRIMARY KEY,
  partido_id BIGINT NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  jugador_id BIGINT NULL REFERENCES public.jugadores(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  player_name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reported_paid_at TIMESTAMPTZ NULL,
  confirmed_paid_at TIMESTAMPTZ NULL,
  confirmed_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  last_reminder_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT match_player_payments_status_check
    CHECK (status IN ('pending', 'reported_paid', 'paid', 'exempt'))
);

CREATE UNIQUE INDEX IF NOT EXISTS match_player_payments_partido_jugador_uidx
  ON public.match_player_payments (partido_id, jugador_id);

CREATE INDEX IF NOT EXISTS match_player_payments_partido_id_idx
  ON public.match_player_payments (partido_id);

CREATE INDEX IF NOT EXISTS match_player_payments_user_id_idx
  ON public.match_player_payments (user_id);

-- ============================================================
-- Membership predicates (SECURITY DEFINER avoids RLS recursion when
-- the policies below read partidos / jugadores).
-- Namespaced with payments_ prefix to avoid clobbering existing functions.
-- ============================================================

CREATE OR REPLACE FUNCTION public.payments_is_match_admin(p_partido_id BIGINT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partidos p
    WHERE p.id = p_partido_id
      AND p.creado_por = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.payments_is_match_member(p_partido_id BIGINT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.payments_is_match_admin(p_partido_id, p_user_id)
    OR EXISTS (
      SELECT 1 FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
        AND j.usuario_id = p_user_id
    );
$$;

-- ============================================================
-- RLS — everyone in the match can READ; only the admin can WRITE directly.
-- Player writes and row creation go through the SECURITY DEFINER RPCs below.
-- ============================================================

ALTER TABLE public.match_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_player_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_payment_settings_select_member ON public.match_payment_settings;
CREATE POLICY match_payment_settings_select_member
ON public.match_payment_settings
FOR SELECT TO authenticated
USING (public.payments_is_match_member(partido_id, auth.uid()));

DROP POLICY IF EXISTS match_payment_settings_write_admin ON public.match_payment_settings;
CREATE POLICY match_payment_settings_write_admin
ON public.match_payment_settings
FOR ALL TO authenticated
USING (public.payments_is_match_admin(partido_id, auth.uid()))
WITH CHECK (public.payments_is_match_admin(partido_id, auth.uid()));

DROP POLICY IF EXISTS match_player_payments_select_member ON public.match_player_payments;
CREATE POLICY match_player_payments_select_member
ON public.match_player_payments
FOR SELECT TO authenticated
USING (public.payments_is_match_member(partido_id, auth.uid()));

DROP POLICY IF EXISTS match_player_payments_write_admin ON public.match_player_payments;
CREATE POLICY match_player_payments_write_admin
ON public.match_player_payments
FOR ALL TO authenticated
USING (public.payments_is_match_admin(partido_id, auth.uid()))
WITH CHECK (public.payments_is_match_admin(partido_id, auth.uid()));

-- ============================================================
-- RPCs (SECURITY DEFINER) — centralize business rules + authorization.
-- ============================================================

-- Lazily create settings + a payment row per non-substitute roster player.
-- Any match member can call (e.g. when opening the payments view).
CREATE OR REPLACE FUNCTION public.ensure_match_payments(p_partido_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.payments_is_match_member(p_partido_id, v_uid) THEN
    RAISE EXCEPTION 'not_match_member';
  END IF;

  INSERT INTO public.match_payment_settings (partido_id, created_by)
  VALUES (p_partido_id, v_uid)
  ON CONFLICT (partido_id) DO NOTHING;

  INSERT INTO public.match_player_payments (partido_id, jugador_id, user_id, player_name, status)
  SELECT j.partido_id, j.id, j.usuario_id, j.nombre, 'pending'
  FROM public.jugadores j
  WHERE j.partido_id = p_partido_id
    AND COALESCE(j.is_substitute, false) = false
  ON CONFLICT (partido_id, jugador_id) DO NOTHING;
END;
$$;

-- A player marks ONLY their own row as "reported_paid" (never "paid").
CREATE OR REPLACE FUNCTION public.report_my_payment(p_partido_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.match_player_payments
  SET status = 'reported_paid',
      reported_paid_at = now(),
      updated_at = now()
  WHERE partido_id = p_partido_id
    AND user_id = v_uid
    AND status IN ('pending', 'reported_paid');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'no_payment_row_or_locked';
  END IF;
END;
$$;

-- Admin sets any player's status. "paid" stamps confirmed_paid_at / confirmed_by.
CREATE OR REPLACE FUNCTION public.admin_set_payment_status(
  p_partido_id BIGINT,
  p_jugador_id BIGINT,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.payments_is_match_admin(p_partido_id, v_uid) THEN
    RAISE EXCEPTION 'not_match_admin';
  END IF;
  IF p_status NOT IN ('pending', 'reported_paid', 'paid', 'exempt') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  UPDATE public.match_player_payments
  SET status = p_status,
      confirmed_paid_at = CASE WHEN p_status = 'paid' THEN now() ELSE NULL END,
      confirmed_by = CASE WHEN p_status = 'paid' THEN v_uid ELSE NULL END,
      reported_paid_at = CASE
        WHEN p_status = 'reported_paid' AND reported_paid_at IS NULL THEN now()
        ELSE reported_paid_at
      END,
      updated_at = now()
  WHERE partido_id = p_partido_id
    AND jugador_id = p_jugador_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'payment_row_not_found';
  END IF;
END;
$$;

-- Admin edits the collector configuration.
CREATE OR REPLACE FUNCTION public.admin_update_payment_settings(
  p_partido_id BIGINT,
  p_amount NUMERIC,
  p_collector_user_id UUID,
  p_collector_name TEXT,
  p_collector_alias TEXT,
  p_collector_link TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.payments_is_match_admin(p_partido_id, v_uid) THEN
    RAISE EXCEPTION 'not_match_admin';
  END IF;

  INSERT INTO public.match_payment_settings (
    partido_id, amount_per_player, collector_user_id, collector_name,
    collector_alias, collector_payment_link, created_by, updated_at
  ) VALUES (
    p_partido_id, p_amount, p_collector_user_id, NULLIF(btrim(p_collector_name), ''),
    NULLIF(btrim(p_collector_alias), ''), NULLIF(btrim(p_collector_link), ''), v_uid, now()
  )
  ON CONFLICT (partido_id) DO UPDATE SET
    amount_per_player = EXCLUDED.amount_per_player,
    collector_user_id = EXCLUDED.collector_user_id,
    collector_name = EXCLUDED.collector_name,
    collector_alias = EXCLUDED.collector_alias,
    collector_payment_link = EXCLUDED.collector_payment_link,
    updated_at = now();
END;
$$;

-- Admin closes payments. Refuses while pending unless p_force = true.
CREATE OR REPLACE FUNCTION public.admin_close_payments(
  p_partido_id BIGINT,
  p_force BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pending INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.payments_is_match_admin(p_partido_id, v_uid) THEN
    RAISE EXCEPTION 'not_match_admin';
  END IF;

  IF NOT p_force THEN
    SELECT count(*) INTO v_pending
    FROM public.match_player_payments
    WHERE partido_id = p_partido_id
      AND status IN ('pending', 'reported_paid');
    IF v_pending > 0 THEN
      RAISE EXCEPTION 'pending_payments_exist';
    END IF;
  END IF;

  INSERT INTO public.match_payment_settings (partido_id, is_closed, closed_at, created_by, updated_at)
  VALUES (p_partido_id, true, now(), v_uid, now())
  ON CONFLICT (partido_id) DO UPDATE SET
    is_closed = true,
    closed_at = now(),
    updated_at = now();
END;
$$;

-- Admin reminds pending players: stamp last_reminder_at and return the
-- pending recipients so the client can insert internal notifications
-- (notification copy stays in JS, consistent with the rest of the app).
CREATE OR REPLACE FUNCTION public.admin_remind_pending_payments(p_partido_id BIGINT)
RETURNS TABLE (user_id UUID, player_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.payments_is_match_admin(p_partido_id, v_uid) THEN
    RAISE EXCEPTION 'not_match_admin';
  END IF;

  UPDATE public.match_player_payments m
  SET last_reminder_at = now(), updated_at = now()
  WHERE m.partido_id = p_partido_id
    AND m.status = 'pending';

  RETURN QUERY
  SELECT m.user_id, m.player_name
  FROM public.match_player_payments m
  WHERE m.partido_id = p_partido_id
    AND m.status = 'pending'
    AND m.user_id IS NOT NULL;
END;
$$;

-- ============================================================
-- Grants
-- ============================================================

GRANT SELECT ON public.match_payment_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_payment_settings TO service_role;

GRANT SELECT ON public.match_player_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_player_payments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.match_player_payments_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.match_player_payments_id_seq TO service_role;

GRANT EXECUTE ON FUNCTION public.payments_is_match_admin(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payments_is_match_member(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_match_payments(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_my_payment(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_payment_status(BIGINT, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_payment_settings(BIGINT, NUMERIC, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_close_payments(BIGINT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remind_pending_payments(BIGINT) TO authenticated;

-- ============================================================
-- Documentation
-- ============================================================

COMMENT ON TABLE public.match_payment_settings
  IS 'Per-match payment configuration (collector + amount + closed flag). Arma2 never holds money.';
COMMENT ON TABLE public.match_player_payments
  IS 'Per-player payment state for a match: pending | reported_paid | paid | exempt.';

COMMIT;
