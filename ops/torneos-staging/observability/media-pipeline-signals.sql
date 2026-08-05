-- Arma2 Torneos · Multimedia observability · database collector
--
-- ONE read-only statement. No DDL, no DML, no function creation: this file is
-- not a migration and must never be applied as one. It is what the metrics
-- collector runs on an interval against Staging.
--
-- ---------------------------------------------------------------------------
-- Why the first half of this query is about privileges and not about metrics
-- ---------------------------------------------------------------------------
-- Row Level Security makes `count(*)` a lie by omission. A role that cannot see
-- a single row of `tournament_media_processing_jobs` gets exactly the same
-- answer as a role looking at a genuinely empty queue: zero. Shipping that zero
-- as `queueDepth` would turn a blind collector into a dashboard full of green,
-- which is the worst possible failure mode for a pipeline whose whole gate is
-- "can we see it?".
--
-- So the query proves its own visibility first, and emits the counts only if
-- the proof holds. When it does not hold, every metric is emitted as SQL NULL —
-- never 0 — and `visibility.observable` is false. The evaluator treats an
-- absent value as `unknown`, `unknown` makes the pipeline unobservable, and an
-- unobservable pipeline keeps the Multimedia flag closed. Fail-closed end to
-- end, with no step that can silently turn "invisible" into "healthy".
--
-- ---------------------------------------------------------------------------
-- Role contract required by this collector
-- ---------------------------------------------------------------------------
-- The collector role MUST satisfy ALL of the following, and the query verifies
-- each one rather than assuming it:
--
--   1. SELECT privilege on public.tournament_media_processing_jobs and
--      public.tournament_media_service_attestations.
--   2. EXECUTE privilege on public.tournament_media_pipeline_readiness().
--   3. RLS exemption on both tables, by exactly one of:
--        a. rolbypassrls = true on the role (the intended shape), or
--        b. rolsuper = true, or
--        c. the role owns the table AND the table is not FORCE ROW LEVEL
--           SECURITY (an owner is exempt unless FORCE is set).
--      Being a member of a policy's target role is NOT sufficient: a policy
--      can filter, and a filtered count cannot be distinguished from a small
--      one. Partial visibility is refused exactly like no visibility.
--
-- No role is created or granted anything by this change. See
-- docs/operations/tournament-media-observability.md#contrato-del-rol-colector
-- for the grant statements an operator would run, as their own reviewed change.
--
-- ---------------------------------------------------------------------------
-- What it deliberately does NOT return: object names, quarantine paths,
-- organization/tournament/gallery ids, user ids, lease tokens, session tokens
-- and raw error text. Every value below is a count, an age or a ratio, so the
-- metrics backend cannot become a second copy of the identity map. The role
-- name is reported because it is the contract being asserted, and it is a
-- database role, not a person.
--
-- The two ages are computed with `now()` inside the database so a collector
-- with a skewed clock cannot fabricate freshness.
--
-- NOTE ON DWELL TIME: this query returns instantaneous values only. It emits no
-- `*SustainedSeconds` field, because a single scrape cannot know how long a
-- value has held. The collector process derives dwell across consecutive
-- scrapes (`deriveSustainedSeconds` in scripts/torneos-staging/observability-lib.mjs).
-- A snapshot that carries this query's output and nothing else evaluates any
-- breaching dwell-gated metric as `unknown`, never as `ok`.
--
-- Usage (read-only, single row of JSON):
--   psql "$STAGING_DATABASE_URL_READONLY" -v ON_ERROR_STOP=1 \
--     -f ops/torneos-staging/observability/media-pipeline-signals.sql

WITH collector AS (
  SELECT
    current_user::text                                   AS role_name,
    coalesce(r.rolsuper, false)                          AS is_superuser,
    coalesce(r.rolbypassrls, false)                      AS bypasses_rls
  FROM (SELECT 1) AS one
  LEFT JOIN pg_catalog.pg_roles r ON r.rolname = current_user
),

-- The tables whose counts become metrics. Every one of them must be provably
-- visible before any count is emitted.
target(table_name) AS (
  VALUES ('tournament_media_processing_jobs'),
         ('tournament_media_service_attestations')
),

capability AS (
  SELECT
    t.table_name,
    c.oid IS NOT NULL                                            AS table_present,
    coalesce(c.relrowsecurity, false)                            AS rls_enabled,
    coalesce(c.relforcerowsecurity, false)                       AS rls_forced,
    coalesce(pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE'), false) AS is_owner,
    coalesce(
      pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT'), false
    )                                                            AS can_select,
    (
      SELECT count(*)::int FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid
    )                                                            AS policy_count
  FROM target t
  LEFT JOIN pg_catalog.pg_class c
    ON c.relname = t.table_name
   AND c.relnamespace = 'public'::regnamespace
),

-- One verdict per table. `rls_exempt` is the only thing that makes a count
-- trustworthy; membership in a policy role deliberately does not count.
verdict AS (
  SELECT
    cap.table_name,
    cap.table_present,
    cap.can_select,
    cap.rls_enabled,
    cap.policy_count,
    (col.bypasses_rls
     OR col.is_superuser
     OR (cap.is_owner AND NOT cap.rls_forced))                   AS rls_exempt
  FROM capability cap CROSS JOIN collector col
),

observed AS (
  SELECT
    v.*,
    (v.table_present AND v.can_select
     AND (NOT v.rls_enabled OR v.rls_exempt))                    AS observable,
    CASE
      WHEN NOT v.table_present THEN 'table_absent'
      WHEN NOT v.can_select    THEN 'no_select_privilege'
      WHEN v.rls_enabled AND NOT v.rls_exempt AND v.policy_count = 0
        THEN 'rls_enabled_without_policies_and_without_bypass'
      WHEN v.rls_enabled AND NOT v.rls_exempt
        THEN 'rls_enabled_with_policies_and_without_bypass'
      ELSE NULL
    END                                                          AS blocker
  FROM verdict v
),

canary AS (
  SELECT
    bool_and(observable)                                         AS all_observable,
    coalesce(
      array_agg(table_name || ':' || blocker ORDER BY table_name)
        FILTER (WHERE blocker IS NOT NULL),
      ARRAY[]::text[]
    )                                                            AS blockers
  FROM observed
),

-- The readiness function is a third capability: EXECUTE, not SELECT. It is
-- probed by privilege rather than by calling it, so a missing grant is a named
-- blocker instead of an exception that loses the whole scrape.
readiness_capability AS (
  -- Resolved through to_regprocedure, which answers NULL for a function that
  -- does not exist instead of raising. has_function_privilege is strict, so a
  -- missing function becomes `false` here rather than an exception that would
  -- lose the entire scrape, including the visibility verdict.
  SELECT coalesce(
    pg_catalog.has_function_privilege(current_user, target.oid, 'EXECUTE'), false
  ) AS can_execute
  FROM (
    SELECT to_regprocedure('public.tournament_media_pipeline_readiness()')::oid AS oid
  ) AS target
),

gate AS (
  SELECT
    c.all_observable
      AND coalesce((SELECT can_execute FROM readiness_capability), false) AS ok,
    c.blockers
      || CASE
           WHEN coalesce((SELECT can_execute FROM readiness_capability), false)
             THEN ARRAY[]::text[]
           ELSE ARRAY['tournament_media_pipeline_readiness:no_execute_privilege']
         END                                                     AS blockers
  FROM canary c
)

SELECT jsonb_build_object(
  'collectedAt', now(),
  'collector', jsonb_build_object(
    'role', (SELECT role_name FROM collector),
    'bypassesRls', (SELECT bypasses_rls FROM collector),
    'isSuperuser', (SELECT is_superuser FROM collector)
  ),

  -- The canary. `observable` false means every metric below is NULL and the
  -- collector must abort rather than publish anything.
  'visibility', jsonb_build_object(
    'observable', (SELECT ok FROM gate),
    'blockers', to_jsonb((SELECT blockers FROM gate)),
    'tables', (
      SELECT jsonb_object_agg(table_name, jsonb_build_object(
        'present', table_present,
        'canSelect', can_select,
        'rlsEnabled', rls_enabled,
        'rlsExempt', rls_exempt,
        'policyCount', policy_count,
        'observable', observable
      ))
      FROM observed
    )
  ),

  -- Quarantine depth: every object that has been uploaded and has not finished
  -- processing. Counted from the queue, which is the only place that knows an
  -- object exists before an asset does.
  'quarantineDepth', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE status <> 'succeeded'
  ) END,

  'queueDepth', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE status = 'queued'
  ) END,

  'oldestJobAgeSeconds', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT coalesce(
      floor(extract(epoch FROM now() - min(created_at)))::bigint, 0
    )
    FROM public.tournament_media_processing_jobs
    WHERE status IN ('queued', 'leased')
  ) END,

  -- A lease that has expired but is still marked leased: the sweeper
  -- (`cleanup_tournament_media_processing_jobs`) has not run, or is failing.
  'expiredLeases', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE status = 'leased' AND lease_expires_at <= now()
  ) END,

  'stuckLeaseAgeSeconds', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT coalesce(
      floor(extract(epoch FROM now() - min(lease_expires_at)))::bigint, 0
    )
    FROM public.tournament_media_processing_jobs
    WHERE status = 'leased' AND lease_expires_at <= now()
  ) END,

  -- Attestation headroom. A missing row reports -1 rather than null so the
  -- evaluator treats "absent" as "already expired" instead of "unknown". That
  -- substitution is only sound because the gate above already proved the rows
  -- would have been visible had they existed.
  'signerAttestationExpiresInSeconds', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT coalesce(
      (SELECT floor(extract(epoch FROM expires_at - now()))::bigint
       FROM public.tournament_media_service_attestations WHERE service = 'signer'),
      -1
    )
  ) END,
  'processorAttestationExpiresInSeconds', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT coalesce(
      (SELECT floor(extract(epoch FROM expires_at - now()))::bigint
       FROM public.tournament_media_service_attestations WHERE service = 'processor'),
      -1
    )
  ) END,

  -- Signature age comes from the processor's own attested evidence, so it
  -- reflects what the database accepted, not what a scanner claims out of band.
  -- Absent evidence reports the seven-day failure threshold, never zero.
  'clamavSignatureAgeSeconds', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT coalesce(
      (SELECT floor(extract(epoch FROM now() - (
         (capabilities #>> '{evidence,antivirus,signaturesAt}')::timestamptz
       )))::bigint
       FROM public.tournament_media_service_attestations
       WHERE service = 'processor'
         AND (capabilities #>> '{evidence,antivirus,signaturesAt}') IS NOT NULL),
      604800
    )
  ) END,

  -- Share of the last hour's jobs that ended without a published asset. The
  -- sample count travels with it so an idle hour ("0 of 0") is distinguishable
  -- from a proven-clean hour ("0 of 400") without either of them being NULL:
  -- an empty window is genuinely not an alert, but it is also not evidence.
  'uploadFailureRatio', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT CASE WHEN count(*) = 0 THEN 0
      ELSE round(
        count(*) FILTER (WHERE status IN ('failed', 'abandoned'))::numeric
        / count(*)::numeric, 4)
    END
    FROM public.tournament_media_processing_jobs
    WHERE created_at >= now() - interval '1 hour'
  ) END,
  'uploadFailureRatioSampleCount', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE created_at >= now() - interval '1 hour'
  ) END,

  -- The database's own verdict, never recomputed by the collector.
  'uploadReady', CASE WHEN (SELECT ok FROM gate) THEN (
    SELECT CASE WHEN (public.tournament_media_pipeline_readiness() ->> 'uploadReady')::boolean
      THEN 1 ELSE 0 END
  ) END
) AS media_pipeline_signals;
