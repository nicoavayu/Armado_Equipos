-- Arma2 Torneos · FREE / PREMIUM permanent licensing by tournament edition.
--
-- Commercial scope is public.tournaments.id. A tournament season is an
-- institutional grouping and a category is a sporting subdivision; neither is
-- independently billable. This migration supersedes the former organization
-- subscription resolver without deleting its historical rows.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preserve the former subscription model as non-authoritative history.
-- ---------------------------------------------------------------------------

ALTER TABLE public.tournament_entitlement_plans
  RENAME TO tournament_legacy_subscription_plans;
ALTER TABLE public.tournament_organization_subscriptions
  RENAME TO tournament_legacy_organization_subscriptions;

COMMENT ON TABLE public.tournament_legacy_subscription_plans IS
  'Deprecated organization-subscription policy. Preserved for history only; tournament_plan_catalog is authoritative.';
COMMENT ON TABLE public.tournament_legacy_organization_subscriptions IS
  'Deprecated temporal subscription rows. They do not grant a tournament plan and are not interpreted as purchases.';

REVOKE ALL ON TABLE public.tournament_legacy_subscription_plans
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.tournament_legacy_organization_subscriptions
  FROM PUBLIC,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 2. One configurable server-side catalog for pricing, limits and branding.
-- ---------------------------------------------------------------------------

CREATE TABLE public.tournament_plan_catalog (
  plan_code text PRIMARY KEY,
  gallery_asset_limit integer NOT NULL,
  administrative_collaborator_limit integer NOT NULL,
  branding_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_plan_catalog_plan_check
    CHECK (plan_code IN ('FREE','PREMIUM')),
  CONSTRAINT tournament_plan_catalog_gallery_limit_check
    CHECK (gallery_asset_limit BETWEEN 1 AND 100000),
  CONSTRAINT tournament_plan_catalog_admin_limit_check
    CHECK (administrative_collaborator_limit BETWEEN 0 AND 1000),
  CONSTRAINT tournament_plan_catalog_branding_check
    CHECK (branding_mode IN ('arma2_visible','powered_by_arma2'))
);

CREATE TABLE public.tournament_pricing_config (
  config_key text PRIMARY KEY,
  currency text NOT NULL,
  list_price_minor integer NOT NULL,
  launch_price_minor integer NOT NULL,
  billing_model text NOT NULL,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_pricing_config_key_check CHECK (config_key = 'v1'),
  CONSTRAINT tournament_pricing_config_currency_check CHECK (currency = 'ARS'),
  CONSTRAINT tournament_pricing_config_prices_check CHECK (
    list_price_minor > 0
    AND launch_price_minor > 0
    AND launch_price_minor < list_price_minor
  ),
  CONSTRAINT tournament_pricing_config_billing_check
    CHECK (billing_model = 'one_time'),
  CONSTRAINT tournament_pricing_config_scope_check
    CHECK (scope = 'tournament_edition')
);

INSERT INTO public.tournament_plan_catalog (
  plan_code,gallery_asset_limit,administrative_collaborator_limit,branding_mode
) VALUES
  ('FREE',100,1,'arma2_visible'),
  ('PREMIUM',10000,10,'powered_by_arma2');

INSERT INTO public.tournament_pricing_config (
  config_key,currency,list_price_minor,launch_price_minor,billing_model,scope
) VALUES ('v1','ARS',49900,39900,'one_time','tournament_edition');

CREATE TRIGGER tournament_plan_catalog_touch
BEFORE UPDATE ON public.tournament_plan_catalog
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_workspace_updated_at();

CREATE TRIGGER tournament_pricing_config_touch
BEFORE UPDATE ON public.tournament_pricing_config
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_workspace_updated_at();

ALTER TABLE public.tournament_plan_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_pricing_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tournament_plan_catalog FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.tournament_pricing_config FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.tournament_plan_catalog TO service_role;
GRANT SELECT ON TABLE public.tournament_pricing_config TO service_role;

COMMENT ON TABLE public.tournament_plan_catalog IS
  'Authoritative FREE/PREMIUM limits and branding policy. PREMIUM uses a high configurable quota, never an unlimited promise.';
COMMENT ON TABLE public.tournament_pricing_config IS
  'Authoritative V1 price: ARS 49,900 list, ARS 39,900 launch, one-time per tournament edition.';

-- ---------------------------------------------------------------------------
-- 3. Central capability catalog. Role authorization stays independent.
-- ---------------------------------------------------------------------------

ALTER TABLE public.tournament_entitlement_capabilities
  RENAME COLUMN pro_enabled TO premium_enabled;

INSERT INTO public.tournament_entitlement_capabilities (
  capability,free_enabled,premium_enabled,participant_enabled,description
) VALUES
  ('sport.teams',true,true,true,'Teams remain part of the sporting core in every plan.'),
  ('sport.rosters',true,true,true,'Rosters remain part of the sporting core in every plan.'),
  ('sport.fixture',true,true,true,'Fixture remains part of the sporting core in every plan.'),
  ('sport.schedule',true,true,true,'Real scheduling remains part of the sporting core in every plan.'),
  ('sport.matches',true,true,true,'Matches remain part of the sporting core in every plan.'),
  ('sport.match_reports',true,true,true,'Match reports remain part of the sporting core in every plan.'),
  ('sport.results',true,true,true,'Results remain part of the sporting core in every plan.'),
  ('sport.standings',true,true,true,'Standings remain part of the sporting core in every plan.'),
  ('sport.basic_scorers',true,true,true,'Basic scorers remain available in every plan.'),
  ('sport.cards',true,true,true,'Cards remain part of the sporting core in every plan.'),
  ('sport.discipline',true,true,true,'Discipline remains part of the sporting core in every plan.'),
  ('sport.sanctions',true,true,true,'Sanctions remain part of the sporting core in every plan.'),
  ('public.basic_page',true,true,true,'The basic public tournament page is included in every plan.'),
  ('identity.essential_assets',true,true,true,'Logos, covers, shields, team photos and player portraits do not consume gallery quota.'),
  ('communications.basic',true,true,true,'Basic tournament communications are included in every plan.'),
  ('statistics.basic',true,true,true,'Essential tournament statistics are included in every plan.'),
  ('statistics.advanced',false,true,true,'Advanced statistics are reserved for PREMIUM.'),
  ('branding.advanced',false,true,false,'Stronger custom branding is reserved for PREMIUM.'),
  ('sponsors',false,true,false,'Sponsor management is reserved for PREMIUM when implemented.'),
  ('social_studio.premium',false,true,false,'Premium Social Studio capabilities are reserved for PREMIUM when implemented.'),
  ('exports.professional',false,true,false,'Professional exports are reserved for PREMIUM when implemented.')
ON CONFLICT (capability) DO UPDATE SET
  free_enabled = excluded.free_enabled,
  premium_enabled = excluded.premium_enabled,
  participant_enabled = excluded.participant_enabled,
  description = excluded.description;

-- Compatibility capabilities used by already-approved multimedia and Social
-- Studio surfaces. They remain catalogued here rather than hardcoded in JSX.
UPDATE public.tournament_entitlement_capabilities
SET free_enabled = CASE capability
      WHEN 'media.history' THEN true
      WHEN 'media.extended_retention' THEN true
      ELSE free_enabled
    END,
    premium_enabled = true,
    description = CASE capability
      WHEN 'media.upload' THEN 'General gallery uploads are available in both plans and use the configured tournament quota.'
      WHEN 'media.history' THEN 'Gallery history is available in both plans within the configured tournament quota.'
      WHEN 'media.extended_retention' THEN 'Existing gallery history is preserved; plan changes do not purge sporting media records.'
      WHEN 'social_studio.basic' THEN 'The already-approved basic Social Studio surface remains available subject to its feature flag.'
      WHEN 'social_studio.full' THEN 'Compatibility alias for future PREMIUM Social Studio capabilities.'
      WHEN 'advanced_stats' THEN 'Compatibility alias for PREMIUM advanced statistics.'
      WHEN 'higher_limits' THEN 'Compatibility alias for the higher PREMIUM limits in the plan catalog.'
      ELSE description
    END
WHERE capability IN (
  'media.upload','media.history','media.extended_retention',
  'social_studio.basic','social_studio.full','advanced_stats','higher_limits'
);

-- ---------------------------------------------------------------------------
-- 4. Permanent grants by tournament edition and first-Free consumption.
-- ---------------------------------------------------------------------------

CREATE TABLE public.tournament_plan_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  plan_code text NOT NULL
    REFERENCES public.tournament_plan_catalog(plan_code) ON DELETE RESTRICT,
  source text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_plan_grants_tournament_fk
    FOREIGN KEY (organization_id,tournament_id)
    REFERENCES public.tournaments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT tournament_plan_grants_source_check
    CHECK (source IN ('first_free','purchase','legacy_grant')),
  CONSTRAINT tournament_plan_grants_plan_source_check CHECK (
    (plan_code = 'FREE' AND source = 'first_free')
    OR (plan_code = 'PREMIUM' AND source IN ('purchase','legacy_grant'))
  ),
  CONSTRAINT tournament_plan_grants_reason_check CHECK (
    reason = btrim(reason) AND char_length(reason) BETWEEN 8 AND 500
  ),
  CONSTRAINT tournament_plan_grants_unique
    UNIQUE (organization_id,tournament_id,plan_code,source)
);

CREATE INDEX tournament_plan_grants_resolution_idx
  ON public.tournament_plan_grants
  (organization_id,tournament_id,plan_code,granted_at);

CREATE TABLE public.tournament_organization_plan_state (
  organization_id uuid PRIMARY KEY
    REFERENCES public.tournament_organizations(id) ON DELETE RESTRICT,
  first_free_consumed_at timestamptz NOT NULL,
  first_free_tournament_id uuid,
  initialization_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_organization_plan_state_tournament_fk
    FOREIGN KEY (organization_id,first_free_tournament_id)
    REFERENCES public.tournaments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT tournament_organization_plan_state_source_check
    CHECK (initialization_source IN ('first_free','legacy_backfill')),
  CONSTRAINT tournament_organization_plan_state_shape_check CHECK (
    (initialization_source = 'first_free' AND first_free_tournament_id IS NOT NULL)
    OR (initialization_source = 'legacy_backfill' AND first_free_tournament_id IS NULL)
  )
);

ALTER TABLE public.tournament_plan_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_organization_plan_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tournament_plan_grants FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.tournament_organization_plan_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.tournament_plan_grants TO service_role;
GRANT SELECT ON TABLE public.tournament_organization_plan_state TO service_role;

COMMENT ON TABLE public.tournament_plan_grants IS
  'Immutable permanent grants scoped to one public.tournaments.id. No expiry and no transfer to another edition.';
COMMENT ON TABLE public.tournament_organization_plan_state IS
  'Deterministic record that the organization consumed its single first-Free opportunity; legacy organizations are initialized without inventing a purchase.';

-- Every organization that predates licensing is initialized as already having
-- consumed its Free opportunity. Every pre-existing tournament retains full
-- access through a permanent legacy grant. No purchase or transaction is made.
INSERT INTO public.tournament_organization_plan_state (
  organization_id,first_free_consumed_at,first_free_tournament_id,
  initialization_source
)
SELECT organization.id,statement_timestamp(),NULL,'legacy_backfill'
FROM public.tournament_organizations organization
WHERE EXISTS (
  SELECT 1 FROM public.tournaments tournament
  WHERE tournament.organization_id = organization.id
)
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO public.tournament_plan_grants (
  organization_id,tournament_id,plan_code,source,granted_at,reason
)
SELECT tournament.organization_id,tournament.id,'PREMIUM','legacy_grant',
  statement_timestamp(),'Acceso preexistente preservado por el backfill de licencias V1'
FROM public.tournaments tournament
ON CONFLICT (organization_id,tournament_id,plan_code,source) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assign_first_free_plan_on_tournament_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.organization_id::text,41)
  );
  IF EXISTS (
    SELECT 1 FROM public.tournament_organization_plan_state state
    WHERE state.organization_id = new.organization_id
  ) THEN
    RETURN new;
  END IF;

  INSERT INTO public.tournament_organization_plan_state (
    organization_id,first_free_consumed_at,first_free_tournament_id,
    initialization_source
  ) VALUES (new.organization_id,now(),new.id,'first_free');

  INSERT INTO public.tournament_plan_grants (
    organization_id,tournament_id,plan_code,source,reason
  ) VALUES (
    new.organization_id,new.id,'FREE','first_free',
    'Primer torneo gratuito asignado automáticamente por el dominio'
  );
  RETURN new;
END;
$$;

CREATE TRIGGER tournaments_assign_first_free_plan
AFTER INSERT ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.assign_first_free_plan_on_tournament_insert();

CREATE OR REPLACE FUNCTION public.grant_tournament_premium(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_source text,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grant_id uuid;
BEGIN
  IF p_source NOT IN ('purchase','legacy_grant')
    OR p_reason IS NULL
    OR p_reason <> btrim(p_reason)
    OR char_length(p_reason) NOT BETWEEN 8 AND 500
    OR NOT EXISTS (
      SELECT 1 FROM public.tournaments tournament
      WHERE tournament.organization_id = p_organization_id
        AND tournament.id = p_tournament_id
    )
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_PLAN_GRANT_INVALID';
  END IF;

  INSERT INTO public.tournament_plan_grants (
    organization_id,tournament_id,plan_code,source,reason
  ) VALUES (
    p_organization_id,p_tournament_id,'PREMIUM',p_source,p_reason
  )
  ON CONFLICT (organization_id,tournament_id,plan_code,source) DO UPDATE SET
    reason = public.tournament_plan_grants.reason
  RETURNING id INTO v_grant_id;
  RETURN v_grant_id;
END;
$$;

-- The former temporal subscription mutation remains present only so an old
-- operator receives an explicit failure instead of silently changing dead data.
CREATE OR REPLACE FUNCTION public.set_tournament_organization_subscription(
  p_organization_id uuid,
  p_status text,
  p_starts_at timestamptz,
  p_current_period_end timestamptz,
  p_grace_until timestamptz DEFAULT NULL,
  p_cancelled_at timestamptz DEFAULT NULL,
  p_post_expiration_retention_days integer DEFAULT 90
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING errcode = '0A000', message = 'TORNEOS_LEGACY_SUBSCRIPTION_DISABLED';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Eligibility and effective plan projection.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_organization_consumed_free_tournament(
  p_organization_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF NOT public.is_tournament_organization_member(p_organization_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_PLAN_FORBIDDEN';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.tournament_organization_plan_state state
    WHERE state.organization_id = p_organization_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_creation_eligibility(
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_consumed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF NOT public.is_tournament_organization_member(p_organization_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_PLAN_FORBIDDEN';
  END IF;
  v_consumed := EXISTS (
    SELECT 1 FROM public.tournament_organization_plan_state state
    WHERE state.organization_id = p_organization_id
  );
  RETURN jsonb_build_object(
    'schemaVersion',1,
    'organizationId',p_organization_id,
    'status',CASE WHEN v_consumed THEN 'premium_required' ELSE 'free_available' END,
    'hasConsumedFreeTournament',v_consumed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_effective_tournament_entitlements_at(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_as_of timestamptz,
  p_participant_only boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan text := 'FREE';
  v_source text := 'unassigned';
  v_policy public.tournament_plan_catalog%rowtype;
  v_pricing public.tournament_pricing_config%rowtype;
  v_capabilities jsonb := '{}'::jsonb;
  v_admin_usage integer := 0;
BEGIN
  IF p_organization_id IS NULL OR p_as_of IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_tournament_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tournaments tournament
    WHERE tournament.organization_id = p_organization_id
      AND tournament.id = p_tournament_id
  ) THEN
    RETURN NULL;
  END IF;

  IF p_tournament_id IS NOT NULL THEN
    SELECT grant_row.plan_code,grant_row.source
      INTO v_plan,v_source
    FROM public.tournament_plan_grants grant_row
    WHERE grant_row.organization_id = p_organization_id
      AND grant_row.tournament_id = p_tournament_id
    ORDER BY
      CASE grant_row.plan_code WHEN 'PREMIUM' THEN 0 ELSE 1 END,
      CASE grant_row.source WHEN 'purchase' THEN 0 WHEN 'legacy_grant' THEN 1 ELSE 2 END,
      grant_row.granted_at,
      grant_row.id
    LIMIT 1;
    IF NOT FOUND THEN
      v_plan := 'FREE';
      v_source := 'unassigned';
    END IF;
  END IF;

  SELECT * INTO v_policy
  FROM public.tournament_plan_catalog catalog
  WHERE catalog.plan_code = v_plan;
  SELECT * INTO v_pricing
  FROM public.tournament_pricing_config pricing
  WHERE pricing.config_key = 'v1';

  SELECT coalesce(jsonb_object_agg(catalog.capability,
    CASE
      WHEN p_participant_only AND NOT catalog.participant_enabled THEN false
      ELSE coalesce(
        tournament_override.enabled,
        CASE WHEN v_plan = 'PREMIUM'
          THEN catalog.premium_enabled ELSE catalog.free_enabled END,
        false
      )
    END ORDER BY catalog.capability
  ),'{}'::jsonb)
  INTO v_capabilities
  FROM public.tournament_entitlement_capabilities catalog
  LEFT JOIN public.tournament_entitlement_overrides tournament_override
    ON p_tournament_id IS NOT NULL
   AND tournament_override.organization_id = p_organization_id
   AND tournament_override.tournament_id = p_tournament_id
   AND tournament_override.capability = catalog.capability
   AND (tournament_override.expires_at IS NULL OR tournament_override.expires_at > p_as_of);

  SELECT count(*)::integer INTO v_admin_usage
  FROM public.tournament_organization_members membership
  WHERE membership.organization_id = p_organization_id
    AND membership.status = 'active'
    AND membership.role IN ('admin','collaborator');

  RETURN jsonb_build_object(
    'schemaVersion',2,
    'plan',v_plan,
    'assignmentSource',v_source,
    'scope',jsonb_build_object(
      'type','tournament_edition',
      'organizationId',p_organization_id,
      'tournamentId',p_tournament_id,
      'audience',CASE WHEN p_participant_only THEN 'participant' ELSE 'organization_member' END
    ),
    'pricing',jsonb_build_object(
      'currency',v_pricing.currency,
      'listPrice',v_pricing.list_price_minor,
      'launchPrice',v_pricing.launch_price_minor,
      'billingModel',v_pricing.billing_model,
      'scope',v_pricing.scope
    ),
    'capabilities',v_capabilities,
    'limits',jsonb_build_object(
      'galleryAssetLimit',v_policy.gallery_asset_limit,
      'administrativeCollaboratorLimit',v_policy.administrative_collaborator_limit
    ),
    'media',jsonb_build_object(
      'galleryAssetLimit',v_policy.gallery_asset_limit,
      'essentialAssetsCountTowardLimit',false
    ),
    'administration',jsonb_build_object(
      'currentAdministrativeSeatUsage',v_admin_usage,
      'administrativeSeatLimit',v_policy.administrative_collaborator_limit,
      'ownerIncluded',true,
      'ownerCountsTowardLimit',false
    ),
    'branding',jsonb_build_object(
      'mode',v_policy.branding_mode,
      'arma2Visible',true,
      'label',CASE v_policy.branding_mode
        WHEN 'powered_by_arma2' THEN 'Powered by Arma2'
        ELSE 'Arma2 Torneos'
      END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_tournament_entitlements(
  p_organization_id uuid,
  p_tournament_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_member boolean := false;
  v_is_participant boolean := false;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_ENTITLEMENTS_FORBIDDEN';
  END IF;

  v_is_member := public.is_tournament_organization_member(p_organization_id);
  IF p_tournament_id IS NOT NULL THEN
    v_is_participant := EXISTS (
      SELECT 1 FROM public.tournaments tournament
      WHERE tournament.id = p_tournament_id
        AND tournament.organization_id = p_organization_id
        AND public.can_read_tournament_participant_hub(tournament.id,NULL)
    );
  END IF;
  IF NOT v_is_member AND NOT v_is_participant THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_ENTITLEMENTS_FORBIDDEN';
  END IF;

  v_result := public.resolve_effective_tournament_entitlements_at(
    p_organization_id,p_tournament_id,now(),NOT v_is_member
  );
  IF v_result IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_ENTITLEMENTS_FORBIDDEN';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_tournament_entitlement(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_capability text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entitlements jsonb;
BEGIN
  IF p_capability IS NULL OR p_tournament_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tournament_entitlement_capabilities catalog
    WHERE catalog.capability = p_capability
  ) THEN
    RETURN false;
  END IF;
  BEGIN
    v_entitlements := public.get_effective_tournament_entitlements(
      p_organization_id,p_tournament_id
    );
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN false;
  END;
  RETURN coalesce((v_entitlements->'capabilities'->>p_capability)::boolean,false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Gallery quota counts only general gallery assets. Essential identity
-- assets live in their own branding/shield/team-photo/portrait domains.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tournament_media_upload_sessions_matchday_limit
  ON public.tournament_media_upload_sessions;

CREATE OR REPLACE FUNCTION public.enforce_tournament_media_gallery_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy jsonb;
  v_limit integer;
  v_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.organization_id::text || ':' || new.tournament_id::text,
      43
    )
  );
  v_policy := public.resolve_effective_tournament_entitlements_at(
    new.organization_id,new.tournament_id,now(),false
  );
  v_limit := (v_policy->'media'->>'galleryAssetLimit')::integer;

  SELECT
    (SELECT count(*)
     FROM public.tournament_media_assets asset
     WHERE asset.organization_id = new.organization_id
       AND asset.tournament_id = new.tournament_id
       AND asset.status NOT IN ('rejected','revoked','failed')
       AND asset.storage_state <> 'storage_purged')
    +
    (SELECT count(*)
     FROM public.tournament_media_upload_sessions session
     WHERE session.organization_id = new.organization_id
       AND session.tournament_id = new.tournament_id
       AND session.status IN ('issued','uploaded')
       AND session.expires_at > now())
  INTO v_count;

  IF v_limit IS NOT NULL AND v_count >= v_limit THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_QUOTA_EXCEEDED';
  END IF;
  new.quota_snapshot := coalesce(new.quota_snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'plan',v_policy->>'plan',
      'galleryAssetLimit',v_limit,
      'galleryAssetUsage',v_count
    );
  RETURN new;
END;
$$;

CREATE TRIGGER tournament_media_upload_sessions_gallery_limit
BEFORE INSERT ON public.tournament_media_upload_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_tournament_media_gallery_limit();

-- The previous rolling matchday retention policy is retired. This read-only
-- compatibility function deliberately returns no purge candidates.
CREATE OR REPLACE FUNCTION public.list_tournament_media_retention_candidates(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_as_of timestamptz DEFAULT now()
) RETURNS TABLE (
  asset_id uuid,
  gallery_id uuid,
  sports_round_id uuid,
  sports_round_number integer,
  window_exited_at timestamptz,
  eligible_at timestamptz,
  bucket text,
  object_paths jsonb,
  reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_tournament_id IS NULL OR p_as_of IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.tournaments tournament
      WHERE tournament.organization_id = p_organization_id
        AND tournament.id = p_tournament_id
    )
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_ENTITLEMENT_SCOPE_INVALID';
  END IF;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.list_tournament_media_retention_candidates(uuid,uuid,timestamptz) IS
  'Compatibility read-only surface. FREE/PREMIUM V1 uses a gallery asset quota and never purges historical media because a plan changed.';

-- ---------------------------------------------------------------------------
-- 7. Exact privileges. Browser users read projections only and cannot grant.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assign_first_free_plan_on_tournament_insert()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.grant_tournament_premium(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.has_organization_consumed_free_tournament(uuid)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_tournament_creation_eligibility(uuid)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.resolve_effective_tournament_entitlements_at(
  uuid,uuid,timestamptz,boolean
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_effective_tournament_entitlements(uuid,uuid)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.has_tournament_entitlement(uuid,uuid,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.enforce_tournament_media_gallery_limit()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_tournament_organization_subscription(
  uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,integer
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.grant_tournament_premium(uuid,uuid,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.has_organization_consumed_free_tournament(uuid)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_creation_eligibility(uuid)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_effective_tournament_entitlements_at(
  uuid,uuid,timestamptz,boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_tournament_entitlements(uuid,uuid)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.has_tournament_entitlement(uuid,uuid,text)
  TO authenticated,service_role;

COMMIT;
