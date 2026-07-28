BEGIN;

CREATE TABLE IF NOT EXISTS public.guest_join_attempt_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text NOT NULL,
  partido_id bigint NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  invite_token_hash text NOT NULL,
  guest_uuid uuid NULL,
  outcome text NOT NULL,
  failure_reason text NULL,
  user_agent text NULL
);

CREATE INDEX IF NOT EXISTS guest_join_attempt_log_created_at_idx
  ON public.guest_join_attempt_log (created_at DESC);

CREATE INDEX IF NOT EXISTS guest_join_attempt_log_ip_created_at_idx
  ON public.guest_join_attempt_log (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS guest_join_attempt_log_match_ip_created_at_idx
  ON public.guest_join_attempt_log (partido_id, ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS guest_join_attempt_log_invite_created_at_idx
  ON public.guest_join_attempt_log (invite_token_hash, created_at DESC);

ALTER TABLE public.guest_join_attempt_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_join_attempt_log FROM anon;
REVOKE ALL ON TABLE public.guest_join_attempt_log FROM authenticated;

COMMIT;
