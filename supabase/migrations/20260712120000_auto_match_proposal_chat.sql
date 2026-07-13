-- ============================================================================
-- Chat del "partido en gestación" (auto_match_proposals)
-- ----------------------------------------------------------------------------
-- Reutiliza public.mensajes_partido con una tercera dimensión de scope:
-- proposal_id. Los miembros no declinados de la propuesta pueden leer y enviar
-- mensajes, igual que el chat de partido y el de equipos.
--
-- CUIDADO DE SEGURIDAD: la policy de SELECT vigente considera visible cualquier
-- fila con team_match_id IS NULL (rama de partido regular). Sin endurecerla,
-- los mensajes de gestación (team_match_id NULL) quedarían legibles para
-- CUALQUIER usuario autenticado. Por eso se reemplaza la policy para que la
-- rama pública exija además proposal_id IS NULL, y se agrega una rama propia
-- restringida a los miembros de la propuesta.
--
-- LECTURA vs ESCRITURA: la lectura (SELECT) es puramente por membresía y no
-- mira el estado de la propuesta, así que una gestación cancelada, vencida o
-- ya materializada conserva su historial para los miembros. El envío (RPC)
-- sí exige que la propuesta siga viva (collecting|ready y dentro de
-- expires_at): las gestaciones cerradas quedan de solo lectura.
-- ============================================================================

BEGIN;

ALTER TABLE public.mensajes_partido
  ADD COLUMN IF NOT EXISTS proposal_id bigint NULL
    REFERENCES public.auto_match_proposals(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS mensajes_partido_proposal_timestamp_idx
  ON public.mensajes_partido(proposal_id, "timestamp" ASC, id ASC)
  WHERE proposal_id IS NOT NULL;

ALTER TABLE public.mensajes_partido ENABLE ROW LEVEL SECURITY;

-- Helper: ¿el usuario es miembro activo (no declinado) de la propuesta?
-- SECURITY DEFINER para poder evaluarse dentro de la policy sin exponer la
-- tabla de miembros directamente.
CREATE OR REPLACE FUNCTION public.auto_match_user_in_proposal(
  p_proposal_id bigint,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.auto_match_proposal_members m
    WHERE m.proposal_id = p_proposal_id
      AND m.user_id = p_user_id
      AND m.response <> 'declined'
  );
$$;

REVOKE ALL ON FUNCTION public.auto_match_user_in_proposal(bigint, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.auto_match_user_in_proposal(bigint, uuid) TO authenticated, service_role;

-- SELECT: el partido regular (ambos scopes NULL) se mantiene como antes; team y
-- proposal quedan restringidos a sus respectivos miembros.
DROP POLICY IF EXISTS mensajes_partido_select_authenticated_with_team_scope ON public.mensajes_partido;
CREATE POLICY mensajes_partido_select_authenticated_with_team_scope
ON public.mensajes_partido
FOR SELECT
TO authenticated
USING (
  (
    team_match_id IS NULL
    AND proposal_id IS NULL
  )
  OR (
    team_match_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.team_matches tm
      WHERE tm.id = mensajes_partido.team_match_id
        AND (
          public.team_user_is_member(tm.team_a_id, auth.uid())
          OR public.team_user_is_member(tm.team_b_id, auth.uid())
        )
    )
  )
  OR (
    proposal_id IS NOT NULL
    AND public.auto_match_user_in_proposal(mensajes_partido.proposal_id, auth.uid())
  )
);

-- Envío por RPC SECURITY DEFINER (mismo patrón que send_team_match_chat_message).
DROP FUNCTION IF EXISTS public.send_auto_match_proposal_chat_message(bigint, text, text);
CREATE OR REPLACE FUNCTION public.send_auto_match_proposal_chat_message(
  p_proposal_id bigint,
  p_autor text,
  p_mensaje text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_autor text := COALESCE(NULLIF(trim(p_autor), ''), 'Usuario');
  v_mensaje text := trim(COALESCE(p_mensaje, ''));
  -- NULLs tipados: un NULL suelto en EXECUTE ... USING se infiere como text y
  -- rompe contra partido_id bigint / team_match_id uuid (ver la migración
  -- 20260226231000 fix_team_match_chat_partido_null_cast).
  v_partido_id bigint := NULL;
  v_team_match_id uuid := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'Gestación inválida' USING ERRCODE = 'P0001';
  END IF;

  IF v_mensaje = '' THEN
    RAISE EXCEPTION 'Mensaje vacío' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.auto_match_user_in_proposal(p_proposal_id, v_uid) THEN
    RAISE EXCEPTION 'Sin permiso para enviar mensajes en esta gestación' USING ERRCODE = 'P0001';
  END IF;

  -- Historial de solo lectura para gestaciones cerradas: una propuesta
  -- cancelada, vencida (status 'expired' o pasado expires_at) o ya
  -- materializada en partido ('created') conserva sus mensajes para los
  -- miembros vía la policy SELECT (que no filtra por estado), pero no admite
  -- envíos nuevos. La "liveness" usa el mismo predicado que responder o tomar
  -- la organización: collecting|ready y todavía dentro de expires_at.
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_match_proposals p
    WHERE p.id = p_proposal_id
      AND p.status IN ('collecting', 'ready')
      AND p.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Esta gestación ya no admite mensajes nuevos' USING ERRCODE = 'P0001';
  END IF;

  -- user_id puede no existir en todos los entornos (ver send_team_match_chat_message).
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mensajes_partido'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE
      'INSERT INTO public.mensajes_partido (partido_id, team_match_id, proposal_id, autor, mensaje, user_id) VALUES ($1, $2, $3, $4, $5, $6)'
      USING v_partido_id, v_team_match_id, p_proposal_id, v_autor, v_mensaje, v_uid;
  ELSE
    EXECUTE
      'INSERT INTO public.mensajes_partido (partido_id, team_match_id, proposal_id, autor, mensaje) VALUES ($1, $2, $3, $4, $5)'
      USING v_partido_id, v_team_match_id, p_proposal_id, v_autor, v_mensaje;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.send_auto_match_proposal_chat_message(bigint, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_auto_match_proposal_chat_message(bigint, text, text) TO authenticated, service_role;

COMMIT;
