-- Arma2 Torneos — the RUNNER of 0018 (decision A2: pg_cron + pg_net inside the Torneos project, USD 0). Not a numbered
-- migration: it needs its own GO (it enables two extensions and creates two jobs) and it is applied after 0018.
-- Rollback: backend/torneos/season-lifecycle/scheduler/season-lifecycle-cron.rollback.sql (unschedules, drops the caller).
--
-- What it schedules (minutes offset from :x0 — the Core :x0 load seen in the 503 investigation):
--   * torneos-season-media-lifecycle, every 15 minutes at :03/:18/:33/:48 → public.run_tournament_season_media_lifecycle():
--     closes expired seasons, sends the 7d / 1d notices, marks photos. SQL only, idempotent.
--   * torneos-season-media-purge, every 15 minutes at :08/:23/:38/:53 → private.request_tournament_media_purge(50):
--     one signed POST (pg_net, asynchronous) to torneos-media-store's media-purge. The function leases, removes and
--     confirms; a failed run leaves the leases to expire and the next run retries.
-- Secrets: the purge secret and the function URL live in Supabase Vault (vault.secrets), created by the operator from a
-- TTY, never in this file. The signature is the function's protocol: HMAC-SHA256 over
--   method \n /torneos-media-store/v1/media-purge \n "" \n ts \n sha256(body) \n sha256("")
-- and the body sent is exactly the text that was signed.
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.run_tournament_season_media_lifecycle()') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_CRON_PRECONDITION_FAILED: 00000000000018 is not in force';
  END IF;
END $pre$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- One signed purge request. Returns pg_net's request id (the answer lands in net._http_response), or null when the Vault
-- entries are not there yet (nothing is sent, nothing fails).
create or replace function private.request_tournament_media_purge(p_limit integer default 50)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
  v_url text;
  v_body text;
  v_ts text := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_input text;
  v_signature text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'torneos_media_purge_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'torneos_media_store_purge_url';
  if v_secret is null or v_url is null or v_secret !~ '^[0-9a-f]{64,128}$' or v_url !~ '^https?://' then
    return null;
  end if;
  -- pg_net sends the jsonb's own text ({"limit": 50}), so that is the text signed — never json's ({"limit" : 50}).
  v_body := jsonb_build_object('limit', least(greatest(coalesce(p_limit, 50), 1), 100))::text;
  v_input := concat_ws(E'\n', 'POST', '/torneos-media-store/v1/media-purge', '', v_ts,
    encode(extensions.digest(convert_to(v_body, 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('', 'UTF8'), 'sha256'), 'hex'));
  v_signature := encode(extensions.hmac(convert_to(v_input, 'UTF8'), decode(v_secret, 'hex'), 'sha256'), 'hex');
  return net.http_post(
    url := v_url,
    body := v_body::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-torneos-store-timestamp', v_ts,
      'x-torneos-store-signature', v_signature),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.request_tournament_media_purge(integer) from public, anon, authenticated, service_role;

SELECT cron.schedule('torneos-season-media-lifecycle', '3-59/15 * * * *', 'select public.run_tournament_season_media_lifecycle()');
SELECT cron.schedule('torneos-season-media-purge', '8-59/15 * * * *', 'select private.request_tournament_media_purge(50)');

DO $post$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('torneos-season-media-lifecycle', 'torneos-season-media-purge') AND active) <> 2 THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_CRON_POSTCONDITION_FAILED: jobs';
  END IF;
  IF has_function_privilege('authenticated', 'private.request_tournament_media_purge(integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'private.request_tournament_media_purge(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_CRON_POSTCONDITION_FAILED: grants';
  END IF;
END $post$;

COMMIT;
