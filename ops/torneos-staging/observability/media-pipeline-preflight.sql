-- Arma2 Torneos · Multimedia observability · collector PHASE A (preflight)
--
-- ONE read-only statement. No DDL, no DML, no function creation: this file is
-- not a migration and must never be applied as one.
--
-- ===========================================================================
-- Why this file exists, and why the previous single-statement design could not
-- have worked
-- ===========================================================================
-- The earlier collector tried to do both jobs in one statement: prove its own
-- visibility, and then emit the counts only `CASE WHEN` the proof held. That
-- cannot work, and the reason is not a detail of style — it is how PostgreSQL
-- executes a statement:
--
--   1. NAMES ARE RESOLVED AT PARSE TIME. `public.tournament_media_processing_jobs`
--      inside a CASE branch is resolved when the statement is parsed, long
--      before any CASE is evaluated. If the table does not exist, the whole
--      statement fails with 42P01 `relation ... does not exist`. It does not
--      return `blocker: table_absent`; it returns nothing at all, and the
--      collector sees an exception instead of a verdict.
--
--   2. PRIVILEGES ARE CHECKED AT EXECUTOR START-UP, for every relation in the
--      range table, whether or not the plan node that reads it is ever run.
--      A role without SELECT therefore gets 42501 `permission denied for
--      table ...` — again an exception, again not a blocker.
--
--   3. The same is true of `public.tournament_media_pipeline_readiness()`:
--      a missing function is resolved, and fails, at parse time.
--
-- So the very conditions the canary existed to report — table absent, no
-- SELECT, no EXECUTE — were exactly the conditions under which it could not
-- report anything. The scrape failed, and a failed scrape is indistinguishable
-- from a collector that is simply not running yet.
--
-- The contract is therefore split in two:
--
--   PHASE A (this file)   Touches NOTHING but pg_catalog, `to_regclass` and
--                         `to_regprocedure`. Both of those answer NULL for an
--                         object that does not exist instead of raising, and
--                         neither requires any privilege on the object being
--                         named. Nothing here can fail because of a missing
--                         table, a missing function or a missing grant, which
--                         is precisely what makes it able to REPORT all three.
--
--   PHASE B (media-pipeline-signals.sql)   The counts. It references the
--                         protected tables directly and unconditionally, and it
--                         may ONLY be run once Phase A has returned
--                         `observable: true`. Running it earlier is the
--                         collector's bug, not the query's.
--
-- The collector enforces the ordering, and the evaluator refuses a snapshot
-- that cannot show both halves:
-- `snapshotFromCollectorPhases()` in scripts/torneos-staging/observability-lib.mjs.
--
-- ===========================================================================
-- Role contract verified here
-- ===========================================================================
-- The collector role MUST satisfy ALL of the following, and this query checks
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
-- No role is created and nothing is granted by this change. See
-- docs/operations/tournament-media-observability.md#contrato-del-rol-colector
-- for the grant statements an operator would run, as their own reviewed change.
--
-- What it deliberately does NOT return: object names, quarantine paths,
-- organization/tournament/gallery ids, user ids, lease tokens, session tokens
-- and raw error text. The role and database names are reported because they are
-- the contract being asserted, and because Phase B has to be shown to have run
-- as the same role against the same database.
--
-- Usage (read-only, single row of JSON):
--   psql "$STAGING_DATABASE_URL_READONLY" -v ON_ERROR_STOP=1 \
--     -f ops/torneos-staging/observability/media-pipeline-preflight.sql

WITH collector AS (
  SELECT
    current_user::text                                   AS role_name,
    current_database()::text                             AS database_name,
    coalesce(r.rolsuper, false)                          AS is_superuser,
    coalesce(r.rolbypassrls, false)                      AS bypasses_rls
  FROM (SELECT 1) AS one
  LEFT JOIN pg_catalog.pg_roles r ON r.rolname = current_user
),

-- The tables whose counts become metrics in Phase B. Every one of them must be
-- provably visible before Phase B is allowed to run at all.
target(table_name) AS (
  VALUES ('tournament_media_processing_jobs'),
         ('tournament_media_service_attestations')
),

-- to_regclass is the whole trick: it resolves a name to an OID, answers NULL
-- when nothing of that name exists, and needs no privilege on the object. The
-- table is never named in a FROM clause here, so it is never resolved as a
-- relation and never contributes to the range table.
resolved AS (
  SELECT
    t.table_name,
    to_regclass('public.' || quote_ident(t.table_name)) AS rel
  FROM target t
),

capability AS (
  SELECT
    r.table_name,
    r.rel IS NOT NULL                                            AS table_present,
    coalesce(c.relrowsecurity, false)                            AS rls_enabled,
    coalesce(c.relforcerowsecurity, false)                       AS rls_forced,
    -- Every probe is guarded on the OID being non-NULL. The catalog functions
    -- are strict and would answer NULL anyway, but being explicit keeps the
    -- "absent" case a stated branch rather than a coincidence of coalesce.
    CASE WHEN r.rel IS NULL THEN false ELSE
      coalesce(pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE'), false)
    END                                                          AS is_owner,
    CASE WHEN r.rel IS NULL THEN false ELSE
      coalesce(pg_catalog.has_table_privilege(current_user, r.rel::oid, 'SELECT'), false)
    END                                                          AS can_select,
    CASE WHEN r.rel IS NULL THEN 0 ELSE
      (SELECT count(*)::int FROM pg_catalog.pg_policy p WHERE p.polrelid = r.rel::oid)
    END                                                          AS policy_count
  FROM resolved r
  LEFT JOIN pg_catalog.pg_class c ON c.oid = r.rel::oid
),

-- One verdict per table. `rls_exempt` is the only thing that makes a count
-- trustworthy; membership in a policy role deliberately does not count.
verdict AS (
  SELECT
    cap.table_name,
    cap.table_present,
    cap.can_select,
    cap.rls_enabled,
    cap.rls_forced,
    cap.is_owner,
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
      -- Ownership without exemption is its own blocker: an owner IS exempt
      -- unless FORCE is set, so an owner that is still filtered means FORCE is
      -- on, and saying so is more useful than repeating "no bypass".
      WHEN v.rls_enabled AND NOT v.rls_exempt AND v.is_owner AND v.rls_forced
        THEN 'rls_forced_on_owned_table'
      WHEN v.rls_enabled AND NOT v.rls_exempt AND v.policy_count = 0
        THEN 'rls_enabled_without_policies_and_without_bypass'
      WHEN v.rls_enabled AND NOT v.rls_exempt
        THEN 'rls_enabled_with_policies_and_without_bypass'
      ELSE NULL
    END                                                          AS blocker
  FROM verdict v
),

-- The readiness function is a third capability: EXECUTE, not SELECT.
-- to_regprocedure answers NULL for a function that does not exist rather than
-- raising, so a missing function is a named blocker instead of a parse error
-- that would lose the entire preflight.
readiness AS (
  SELECT to_regprocedure('public.tournament_media_pipeline_readiness()') AS proc
),

readiness_capability AS (
  SELECT
    r.proc IS NOT NULL                                           AS function_present,
    CASE WHEN r.proc IS NULL THEN false ELSE
      coalesce(pg_catalog.has_function_privilege(current_user, r.proc::oid, 'EXECUTE'), false)
    END                                                          AS can_execute
  FROM readiness r
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

gate AS (
  SELECT
    c.all_observable AND rc.can_execute                          AS ok,
    c.blockers
      || CASE
           WHEN rc.can_execute THEN ARRAY[]::text[]
           WHEN NOT rc.function_present
             THEN ARRAY['tournament_media_pipeline_readiness:function_absent']
           ELSE ARRAY['tournament_media_pipeline_readiness:no_execute_privilege']
         END                                                     AS blockers
  FROM canary c CROSS JOIN readiness_capability rc
)

SELECT jsonb_build_object(
  'phase', 'preflight',
  'contractVersion', 1,
  'collectedAt', now(),
  'collector', jsonb_build_object(
    'role', (SELECT role_name FROM collector),
    'database', (SELECT database_name FROM collector),
    'bypassesRls', (SELECT bypasses_rls FROM collector),
    'isSuperuser', (SELECT is_superuser FROM collector)
  ),

  -- The canary. `observable` false means Phase B MUST NOT be run: every metric
  -- would either be a filtered count masquerading as a small one, or an
  -- exception that loses the scrape.
  'observable', (SELECT ok FROM gate),
  'blockers', to_jsonb((SELECT blockers FROM gate)),

  'tables', (
    SELECT jsonb_object_agg(table_name, jsonb_build_object(
      'present', table_present,
      'canSelect', can_select,
      'rlsEnabled', rls_enabled,
      'rlsForced', rls_forced,
      'isOwner', is_owner,
      'rlsExempt', rls_exempt,
      'policyCount', policy_count,
      'observable', observable,
      'blocker', blocker
    ))
    FROM observed
  ),

  'functions', jsonb_build_object(
    'tournament_media_pipeline_readiness', jsonb_build_object(
      'present', (SELECT function_present FROM readiness_capability),
      'canExecute', (SELECT can_execute FROM readiness_capability)
    )
  )
) AS media_pipeline_preflight;
