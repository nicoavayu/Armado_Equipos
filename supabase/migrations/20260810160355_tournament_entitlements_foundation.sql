-- Arma2 Torneos · organization plans, entitlements and multimedia retention.
--
-- This is billing-provider agnostic foundation only. It does not activate a
-- payment provider, delete Storage objects, schedule cleanup, or expire any
-- structured sporting record. Existing organizations resolve to FREE because
-- the absence of a valid PRO subscription is the canonical FREE state.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Server-owned plan and entitlement catalog
-- ---------------------------------------------------------------------------

CREATE TABLE public.tournament_entitlement_plans (
  code text PRIMARY KEY,
  max_photos_per_matchday integer,
  retained_matchdays integer,
  retention_grace_days integer NOT NULL,
  post_expiration_retention_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_entitlement_plans_code_check
    CHECK (code IN ('FREE','PRO')),
  CONSTRAINT tournament_entitlement_plans_media_check CHECK (
    (code = 'FREE'
      AND max_photos_per_matchday = 20
      AND retained_matchdays = 3
      AND retention_grace_days = 7
      AND post_expiration_retention_days = 0)
    OR
    (code = 'PRO'
      AND max_photos_per_matchday IS NULL
      AND retained_matchdays IS NULL
      AND retention_grace_days BETWEEN 0 AND 365
      AND post_expiration_retention_days BETWEEN 1 AND 3650)
  )
);

COMMENT ON TABLE public.tournament_entitlement_plans IS
  'Server-owned FREE/PRO policy. NULL PRO limits mean commercially undecided, not unlimited trust in operational safeguards.';

CREATE TABLE public.tournament_entitlement_capabilities (
  capability text PRIMARY KEY,
  free_enabled boolean NOT NULL,
  pro_enabled boolean NOT NULL,
  participant_enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_entitlement_capabilities_name_check
    CHECK (capability ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  CONSTRAINT tournament_entitlement_capabilities_description_check
    CHECK (description = btrim(description) AND char_length(description) BETWEEN 8 AND 240)
);

COMMENT ON TABLE public.tournament_entitlement_capabilities IS
  'Canonical tenant entitlement catalog. Role permissions remain a separate authorization layer.';

INSERT INTO public.tournament_entitlement_plans (
  code,max_photos_per_matchday,retained_matchdays,retention_grace_days,
  post_expiration_retention_days
) VALUES
  ('FREE',20,3,7,0),
  ('PRO',NULL,NULL,7,90);

INSERT INTO public.tournament_entitlement_capabilities (
  capability,free_enabled,pro_enabled,participant_enabled,description
) VALUES
  ('media.upload',true,true,false,'Organization media uploads subject to role permissions and operational safeguards.'),
  ('media.history',false,true,true,'Access to the organization photographic history when the user role is applicable.'),
  ('media.extended_retention',false,true,false,'Retention of photographic Storage objects beyond the FREE rolling window.'),
  ('social_studio.basic',true,true,false,'Basic Social Studio entitlement, still gated by the independent deployment flag.'),
  ('social_studio.full',false,true,false,'Full Social Studio entitlement, still gated by the independent deployment flag.'),
  ('advanced_stats',false,true,true,'Advanced tournament statistics for organizers and applicable participants.'),
  ('higher_limits',false,true,false,'Higher organization limits where a commercial value has been configured.');

-- ---------------------------------------------------------------------------
-- 2. Subscription state and tenant-scoped overrides
-- ---------------------------------------------------------------------------

CREATE TABLE public.tournament_organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.tournament_organizations(id) ON DELETE RESTRICT,
  plan_code text NOT NULL DEFAULT 'PRO'
    REFERENCES public.tournament_entitlement_plans(code) ON DELETE RESTRICT,
  status text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  starts_at timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  grace_until timestamptz,
  cancelled_at timestamptz,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  post_expiration_retention_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_organization_subscriptions_one_per_org
    UNIQUE (organization_id),
  CONSTRAINT tournament_organization_subscriptions_plan_check
    CHECK (plan_code = 'PRO'),
  CONSTRAINT tournament_organization_subscriptions_status_check
    CHECK (status IN ('active','grace_period','past_due','cancelled','expired')),
  CONSTRAINT tournament_organization_subscriptions_source_check
    CHECK (source IN ('manual','apple','google','web')),
  CONSTRAINT tournament_organization_subscriptions_period_check
    CHECK (current_period_end > starts_at),
  CONSTRAINT tournament_organization_subscriptions_grace_check
    CHECK (grace_until IS NULL OR grace_until >= current_period_end),
  CONSTRAINT tournament_organization_subscriptions_cancelled_check
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT tournament_organization_subscriptions_retention_check
    CHECK (post_expiration_retention_days BETWEEN 1 AND 3650)
);

CREATE INDEX tournament_organization_subscriptions_effective_idx
  ON public.tournament_organization_subscriptions
  (organization_id,status,current_period_end,grace_until);

COMMENT ON TABLE public.tournament_organization_subscriptions IS
  'At most one PRO lifecycle row per organization. No row, invalid data, or non-entitled state resolves to FREE.';
COMMENT ON COLUMN public.tournament_organization_subscriptions.post_expiration_retention_days IS
  'Policy snapshot for this PRO lifecycle so later catalog changes do not rewrite historical retention meaning.';

CREATE TABLE public.tournament_organization_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.tournament_organizations(id) ON DELETE RESTRICT,
  capability text NOT NULL
    REFERENCES public.tournament_entitlement_capabilities(capability) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  expires_at timestamptz,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_organization_entitlement_overrides_unique
    UNIQUE (organization_id,capability),
  CONSTRAINT tournament_organization_entitlement_overrides_reason_check
    CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 8 AND 500)
);

CREATE INDEX tournament_organization_entitlement_overrides_active_idx
  ON public.tournament_organization_entitlement_overrides
  (organization_id,capability,expires_at);

CREATE INDEX tournament_organization_entitlement_overrides_capability_idx
  ON public.tournament_organization_entitlement_overrides (capability);

-- The resolver already accepts tournament_id and this table supplies the
-- future tournament-specific override without changing its public contract.
-- It is service-only and intentionally has no UI in this phase.
CREATE TABLE public.tournament_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  capability text NOT NULL
    REFERENCES public.tournament_entitlement_capabilities(capability) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  expires_at timestamptz,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_entitlement_overrides_tenant_fk
    FOREIGN KEY (organization_id,tournament_id)
    REFERENCES public.tournaments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT tournament_entitlement_overrides_unique
    UNIQUE (organization_id,tournament_id,capability),
  CONSTRAINT tournament_entitlement_overrides_reason_check
    CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 8 AND 500)
);

CREATE INDEX tournament_entitlement_overrides_active_idx
  ON public.tournament_entitlement_overrides
  (organization_id,tournament_id,capability,expires_at);

CREATE INDEX tournament_entitlement_overrides_capability_idx
  ON public.tournament_entitlement_overrides (capability);

CREATE TRIGGER tournament_entitlement_plans_touch
BEFORE UPDATE ON public.tournament_entitlement_plans
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_workspace_updated_at();

CREATE TRIGGER tournament_entitlement_capabilities_touch
BEFORE UPDATE ON public.tournament_entitlement_capabilities
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_workspace_updated_at();

CREATE TRIGGER tournament_organization_subscriptions_touch
BEFORE UPDATE ON public.tournament_organization_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_workspace_updated_at();

CREATE TRIGGER tournament_organization_entitlement_overrides_touch
BEFORE UPDATE ON public.tournament_organization_entitlement_overrides
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_workspace_updated_at();

CREATE TRIGGER tournament_entitlement_overrides_touch
BEFORE UPDATE ON public.tournament_entitlement_overrides
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_workspace_updated_at();

ALTER TABLE public.tournament_entitlement_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_entitlement_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_organization_entitlement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_entitlement_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tournament_entitlement_plans FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.tournament_entitlement_capabilities FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.tournament_organization_subscriptions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.tournament_organization_entitlement_overrides FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.tournament_entitlement_overrides FROM PUBLIC,anon,authenticated;

GRANT SELECT ON TABLE public.tournament_entitlement_plans TO service_role;
GRANT SELECT ON TABLE public.tournament_entitlement_capabilities TO service_role;
GRANT SELECT ON TABLE public.tournament_organization_subscriptions TO service_role;
GRANT SELECT ON TABLE public.tournament_organization_entitlement_overrides TO service_role;
GRANT SELECT ON TABLE public.tournament_entitlement_overrides TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Fail-closed subscription and entitlement resolution
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_tournament_subscription_plan(
  p_plan_code text,
  p_status text,
  p_starts_at timestamptz,
  p_current_period_end timestamptz,
  p_grace_until timestamptz,
  p_cancelled_at timestamptz,
  p_as_of timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_as_of IS NULL
      OR p_plan_code IS DISTINCT FROM 'PRO'
      OR p_starts_at IS NULL
      OR p_current_period_end IS NULL
      OR p_current_period_end <= p_starts_at
      OR p_starts_at > p_as_of
    THEN 'FREE'
    WHEN p_status = 'active'
      AND p_cancelled_at IS NULL
      AND p_grace_until IS NULL
      AND p_current_period_end > p_as_of
    THEN 'PRO'
    WHEN p_status = 'cancelled'
      AND p_cancelled_at IS NOT NULL
      AND p_cancelled_at <= p_as_of
      AND p_current_period_end > p_as_of
    THEN 'PRO'
    WHEN p_status = 'grace_period'
      AND p_cancelled_at IS NULL
      AND p_grace_until IS NOT NULL
      AND p_grace_until >= p_current_period_end
      AND p_current_period_end <= p_as_of
      AND p_grace_until > p_as_of
    THEN 'PRO'
    ELSE 'FREE'
  END;
$$;

CREATE OR REPLACE FUNCTION public.tournament_subscription_is_consistent(
  p_plan_code text,
  p_status text,
  p_starts_at timestamptz,
  p_current_period_end timestamptz,
  p_grace_until timestamptz,
  p_cancelled_at timestamptz,
  p_status_changed_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    p_plan_code = 'PRO'
    AND p_status IN ('active','grace_period','past_due','cancelled','expired')
    AND p_starts_at IS NOT NULL
    AND p_current_period_end IS NOT NULL
    AND p_current_period_end > p_starts_at
    AND p_status_changed_at IS NOT NULL
    AND (p_grace_until IS NULL OR p_grace_until >= p_current_period_end)
    AND ((p_status = 'cancelled') = (p_cancelled_at IS NOT NULL))
    AND (p_status <> 'grace_period' OR p_grace_until IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.tournament_subscription_pro_access_ended_at(
  p_plan_code text,
  p_status text,
  p_starts_at timestamptz,
  p_current_period_end timestamptz,
  p_grace_until timestamptz,
  p_cancelled_at timestamptz,
  p_status_changed_at timestamptz,
  p_as_of timestamptz
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT public.tournament_subscription_is_consistent(
      p_plan_code,p_status,p_starts_at,p_current_period_end,p_grace_until,
      p_cancelled_at,p_status_changed_at
    ) THEN NULL
    WHEN public.resolve_tournament_subscription_plan(
      p_plan_code,p_status,p_starts_at,p_current_period_end,p_grace_until,
      p_cancelled_at,p_as_of
    ) = 'PRO' THEN NULL
    WHEN p_status = 'grace_period' THEN p_grace_until
    WHEN p_status IN ('cancelled','active') THEN p_current_period_end
    WHEN p_status = 'past_due' THEN p_status_changed_at
    WHEN p_status = 'expired' THEN coalesce(p_grace_until,p_current_period_end,p_status_changed_at)
    ELSE NULL
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
  v_subscription public.tournament_organization_subscriptions%rowtype;
  v_plan text := 'FREE';
  v_media public.tournament_entitlement_plans%rowtype;
  v_capabilities jsonb := '{}'::jsonb;
  v_pro_ended_at timestamptz;
  v_post_pro_protected_until timestamptz;
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

  SELECT * INTO v_subscription
  FROM public.tournament_organization_subscriptions subscription
  WHERE subscription.organization_id = p_organization_id;

  IF v_subscription.id IS NOT NULL THEN
    v_plan := public.resolve_tournament_subscription_plan(
      v_subscription.plan_code,v_subscription.status,v_subscription.starts_at,
      v_subscription.current_period_end,v_subscription.grace_until,
      v_subscription.cancelled_at,p_as_of
    );
    v_pro_ended_at := public.tournament_subscription_pro_access_ended_at(
      v_subscription.plan_code,v_subscription.status,v_subscription.starts_at,
      v_subscription.current_period_end,v_subscription.grace_until,
      v_subscription.cancelled_at,v_subscription.status_changed_at,p_as_of
    );
    IF v_pro_ended_at IS NOT NULL THEN
      v_post_pro_protected_until := v_pro_ended_at
        + make_interval(days => v_subscription.post_expiration_retention_days);
    END IF;
  END IF;

  SELECT * INTO v_media
  FROM public.tournament_entitlement_plans plan
  WHERE plan.code = v_plan;
  IF v_media.code IS NULL THEN
    SELECT * INTO v_media FROM public.tournament_entitlement_plans WHERE code = 'FREE';
    v_plan := 'FREE';
  END IF;

  SELECT coalesce(jsonb_object_agg(catalog.capability,
    CASE
      WHEN p_participant_only AND NOT catalog.participant_enabled THEN false
      ELSE coalesce(
        tournament_override.enabled,
        organization_override.enabled,
        CASE WHEN v_plan = 'PRO' THEN catalog.pro_enabled ELSE catalog.free_enabled END,
        false
      )
    END ORDER BY catalog.capability
  ),'{}'::jsonb)
  INTO v_capabilities
  FROM public.tournament_entitlement_capabilities catalog
  LEFT JOIN public.tournament_organization_entitlement_overrides organization_override
    ON organization_override.organization_id = p_organization_id
   AND organization_override.capability = catalog.capability
   AND (organization_override.expires_at IS NULL OR organization_override.expires_at > p_as_of)
  LEFT JOIN public.tournament_entitlement_overrides tournament_override
    ON p_tournament_id IS NOT NULL
   AND tournament_override.organization_id = p_organization_id
   AND tournament_override.tournament_id = p_tournament_id
   AND tournament_override.capability = catalog.capability
   AND (tournament_override.expires_at IS NULL OR tournament_override.expires_at > p_as_of);

  RETURN jsonb_build_object(
    'schemaVersion',1,
    'plan',v_plan,
    'subscriptionStatus',coalesce(v_subscription.status,'none'),
    'scope',jsonb_build_object(
      'organizationId',p_organization_id,
      'tournamentId',p_tournament_id,
      'audience',CASE WHEN p_participant_only THEN 'participant' ELSE 'organization_member' END
    ),
    'capabilities',v_capabilities,
    'media',jsonb_build_object(
      'maxPhotosPerMatchday',v_media.max_photos_per_matchday,
      'retainedMatchdays',v_media.retained_matchdays,
      'retentionGraceDays',v_media.retention_grace_days,
      'postExpirationRetentionDays',v_media.post_expiration_retention_days,
      'postProProtectedUntil',v_post_pro_protected_until
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
  IF p_capability IS NULL OR NOT EXISTS (
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
-- 4. Trusted manual transitions and append-only audit
-- ---------------------------------------------------------------------------

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
DECLARE
  v_existing public.tournament_organization_subscriptions%rowtype;
  v_subscription_id uuid;
  v_action text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_organizations organization
    WHERE organization.id = p_organization_id
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_ENTITLEMENT_SCOPE_INVALID';
  END IF;
  IF p_status NOT IN ('active','grace_period','past_due','cancelled','expired')
    OR p_starts_at IS NULL
    OR p_current_period_end IS NULL
    OR p_current_period_end <= p_starts_at
    OR (p_status = 'grace_period' AND (
      p_grace_until IS NULL OR p_grace_until < p_current_period_end
    ))
    OR ((p_status = 'cancelled') <> (p_cancelled_at IS NOT NULL))
    OR p_post_expiration_retention_days NOT BETWEEN 1 AND 3650
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_SUBSCRIPTION_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text,17)
  );
  SELECT * INTO v_existing
  FROM public.tournament_organization_subscriptions subscription
  WHERE subscription.organization_id = p_organization_id
  FOR UPDATE;

  INSERT INTO public.tournament_organization_subscriptions (
    organization_id,plan_code,status,source,starts_at,current_period_end,
    grace_until,cancelled_at,status_changed_at,
    post_expiration_retention_days
  ) VALUES (
    p_organization_id,'PRO',p_status,'manual',p_starts_at,p_current_period_end,
    p_grace_until,p_cancelled_at,now(),p_post_expiration_retention_days
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    plan_code = 'PRO',
    status = excluded.status,
    source = 'manual',
    starts_at = excluded.starts_at,
    current_period_end = excluded.current_period_end,
    grace_until = excluded.grace_until,
    cancelled_at = excluded.cancelled_at,
    status_changed_at = CASE
      WHEN public.tournament_organization_subscriptions.status IS DISTINCT FROM excluded.status
      THEN now()
      ELSE public.tournament_organization_subscriptions.status_changed_at
    END,
    post_expiration_retention_days = excluded.post_expiration_retention_days
  RETURNING id INTO v_subscription_id;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.tournament_audit_log (
      organization_id,actor_user_id,actor_type,action,resource_type,
      resource_id,metadata
    ) VALUES (
      p_organization_id,NULL,'system','subscription.created','organization_subscription',
      v_subscription_id,jsonb_build_object('plan','PRO','source','manual')
    );
  END IF;

  v_action := CASE p_status
    WHEN 'active' THEN CASE WHEN v_existing.status IS DISTINCT FROM 'active'
      THEN 'subscription.activated' ELSE 'subscription.changed' END
    WHEN 'grace_period' THEN 'subscription.grace_started'
    WHEN 'cancelled' THEN 'subscription.cancelled'
    WHEN 'expired' THEN 'subscription.expired'
    ELSE 'subscription.changed'
  END;
  INSERT INTO public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,
    resource_id,metadata
  ) VALUES (
    p_organization_id,NULL,'system',v_action,'organization_subscription',
    v_subscription_id,jsonb_build_object(
      'plan','PRO','status',p_status,'source','manual',
      'currentPeriodEnd',p_current_period_end,
      'graceUntil',p_grace_until,
      'postExpirationRetentionDays',p_post_expiration_retention_days
    )
  );
  RETURN v_subscription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tournament_entitlement_override(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_capability text,
  p_enabled boolean,
  p_expires_at timestamptz,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_override_id uuid;
BEGIN
  IF p_enabled IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) <> p_reason
    OR char_length(p_reason) NOT BETWEEN 8 AND 500
    OR (p_expires_at IS NOT NULL AND p_expires_at <= now())
    OR NOT EXISTS (
      SELECT 1 FROM public.tournament_entitlement_capabilities catalog
      WHERE catalog.capability = p_capability
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.tournament_organizations organization
      WHERE organization.id = p_organization_id
    )
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_ENTITLEMENT_OVERRIDE_INVALID';
  END IF;

  IF p_tournament_id IS NULL THEN
    INSERT INTO public.tournament_organization_entitlement_overrides (
      organization_id,capability,enabled,expires_at,reason
    ) VALUES (
      p_organization_id,p_capability,p_enabled,p_expires_at,p_reason
    )
    ON CONFLICT (organization_id,capability) DO UPDATE SET
      enabled = excluded.enabled,
      expires_at = excluded.expires_at,
      reason = excluded.reason
    RETURNING id INTO v_override_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.tournaments tournament
      WHERE tournament.organization_id = p_organization_id
        AND tournament.id = p_tournament_id
    ) THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_ENTITLEMENT_SCOPE_INVALID';
    END IF;
    INSERT INTO public.tournament_entitlement_overrides (
      organization_id,tournament_id,capability,enabled,expires_at,reason
    ) VALUES (
      p_organization_id,p_tournament_id,p_capability,p_enabled,p_expires_at,p_reason
    )
    ON CONFLICT (organization_id,tournament_id,capability) DO UPDATE SET
      enabled = excluded.enabled,
      expires_at = excluded.expires_at,
      reason = excluded.reason
    RETURNING id INTO v_override_id;
  END IF;

  INSERT INTO public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,
    resource_id,tournament_id,metadata
  ) VALUES (
    p_organization_id,NULL,'system','entitlement.override_added',
    'entitlement_override',v_override_id,p_tournament_id,
    jsonb_build_object(
      'capability',p_capability,'enabled',p_enabled,
      'expiresAt',p_expires_at,'scope',CASE WHEN p_tournament_id IS NULL
        THEN 'organization' ELSE 'tournament' END
    )
  );
  RETURN v_override_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_tournament_entitlement_override(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_capability text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_override_id uuid;
BEGIN
  IF p_tournament_id IS NULL THEN
    DELETE FROM public.tournament_organization_entitlement_overrides override_row
    WHERE override_row.organization_id = p_organization_id
      AND override_row.capability = p_capability
    RETURNING id INTO v_override_id;
  ELSE
    DELETE FROM public.tournament_entitlement_overrides override_row
    WHERE override_row.organization_id = p_organization_id
      AND override_row.tournament_id = p_tournament_id
      AND override_row.capability = p_capability
    RETURNING id INTO v_override_id;
  END IF;
  IF v_override_id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,
    resource_id,tournament_id,metadata
  ) VALUES (
    p_organization_id,NULL,'system','entitlement.override_removed',
    'entitlement_override',v_override_id,p_tournament_id,
    jsonb_build_object('capability',p_capability)
  );
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Logical media lifecycle and read-only retention candidates
-- ---------------------------------------------------------------------------

ALTER TABLE public.tournament_media_assets
  ADD COLUMN storage_state text NOT NULL DEFAULT 'active',
  ADD COLUMN retention_marked_at timestamptz,
  ADD COLUMN storage_purged_at timestamptz,
  ADD COLUMN retention_reason text,
  ADD CONSTRAINT tournament_media_assets_storage_state_check
    CHECK (storage_state IN ('active','retention_marked','storage_purged')),
  ADD CONSTRAINT tournament_media_assets_storage_lifecycle_check CHECK (
    (storage_state = 'active'
      AND retention_marked_at IS NULL AND storage_purged_at IS NULL
      AND retention_reason IS NULL)
    OR
    (storage_state = 'retention_marked'
      AND retention_marked_at IS NOT NULL AND storage_purged_at IS NULL
      AND retention_reason IS NOT NULL)
    OR
    (storage_state = 'storage_purged'
      AND retention_marked_at IS NOT NULL AND storage_purged_at IS NOT NULL
      AND storage_purged_at >= retention_marked_at
      AND retention_reason IS NOT NULL)
  ),
  ADD CONSTRAINT tournament_media_assets_retention_reason_check CHECK (
    retention_reason IS NULL OR (
      retention_reason = btrim(retention_reason)
      AND char_length(retention_reason) BETWEEN 8 AND 240
    )
  );

CREATE INDEX tournament_media_assets_retention_idx
  ON public.tournament_media_assets
  (organization_id,tournament_id,storage_state,created_at)
  WHERE storage_state <> 'storage_purged';

COMMENT ON COLUMN public.tournament_media_assets.storage_state IS
  'Logical asset survives physical Storage purge. Future cleanup must preserve this row, relations and audit.';

CREATE OR REPLACE FUNCTION public.tournament_media_gallery_sports_round(
  p_gallery_id uuid
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN gallery.match_id IS NULL THEN gallery.round_id
    WHEN match_row.id IS NULL THEN NULL
    WHEN gallery.round_id IS NULL THEN match_row.round_id
    WHEN gallery.round_id = match_row.round_id THEN gallery.round_id
    ELSE NULL
  END
  FROM public.tournament_media_galleries gallery
  LEFT JOIN public.tournament_matches match_row
    ON match_row.id = gallery.match_id
   AND match_row.organization_id = gallery.organization_id
   AND match_row.tournament_id = gallery.tournament_id
  WHERE gallery.id = p_gallery_id;
$$;

-- First vertical integration: the entitlement policy now protects the upload
-- boundary across every gallery attached to the same canonical sports round.
-- Existing operational byte/rate/gallery ceilings remain independent.
CREATE OR REPLACE FUNCTION public.enforce_tournament_media_matchday_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round_id uuid;
  v_policy jsonb;
  v_max integer;
  v_count integer;
BEGIN
  v_round_id := public.tournament_media_gallery_sports_round(new.gallery_id);
  IF v_round_id IS NULL THEN
    RETURN new;
  END IF;
  -- Serialize the count/check/insert boundary for one official sports date.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.organization_id::text || ':' || new.tournament_id::text || ':' || v_round_id::text,
      23
    )
  );
  v_policy := public.resolve_effective_tournament_entitlements_at(
    new.organization_id,new.tournament_id,now(),false
  );
  v_max := (v_policy->'media'->>'maxPhotosPerMatchday')::integer;
  IF v_max IS NULL THEN
    RETURN new;
  END IF;

  SELECT
    (SELECT count(*)
     FROM public.tournament_media_assets asset
     WHERE asset.organization_id = new.organization_id
       AND asset.tournament_id = new.tournament_id
       AND asset.status <> 'revoked'
       AND asset.storage_state <> 'storage_purged'
       AND public.tournament_media_gallery_sports_round(asset.gallery_id) = v_round_id)
    +
    (SELECT count(*)
     FROM public.tournament_media_upload_sessions session
     WHERE session.organization_id = new.organization_id
       AND session.tournament_id = new.tournament_id
       AND session.status = 'issued'
       AND session.expires_at > now()
       AND public.tournament_media_gallery_sports_round(session.gallery_id) = v_round_id)
  INTO v_count;

  IF v_count >= v_max THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_QUOTA_EXCEEDED';
  END IF;
  RETURN new;
END;
$$;

CREATE TRIGGER tournament_media_upload_sessions_matchday_limit
BEFORE INSERT ON public.tournament_media_upload_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_tournament_media_matchday_limit();

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
DECLARE
  v_subscription public.tournament_organization_subscriptions%rowtype;
  v_effective jsonb;
  v_retained integer;
  v_grace integer;
  v_pro_ended_at timestamptz;
  v_protected_until timestamptz;
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

  v_effective := public.resolve_effective_tournament_entitlements_at(
    p_organization_id,p_tournament_id,p_as_of,false
  );
  IF v_effective->>'plan' = 'PRO' THEN
    RETURN;
  END IF;
  v_retained := (v_effective->'media'->>'retainedMatchdays')::integer;
  v_grace := (v_effective->'media'->>'retentionGraceDays')::integer;
  IF v_retained IS NULL OR v_grace IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_subscription
  FROM public.tournament_organization_subscriptions subscription
  WHERE subscription.organization_id = p_organization_id;
  IF v_subscription.id IS NOT NULL THEN
    -- Inconsistent subscription data never grants PRO access, but also never
    -- authorizes destructive cleanup. An operator must repair it first.
    IF NOT public.tournament_subscription_is_consistent(
      v_subscription.plan_code,v_subscription.status,v_subscription.starts_at,
      v_subscription.current_period_end,v_subscription.grace_until,
      v_subscription.cancelled_at,v_subscription.status_changed_at
    ) THEN
      RETURN;
    END IF;
    v_pro_ended_at := public.tournament_subscription_pro_access_ended_at(
      v_subscription.plan_code,v_subscription.status,v_subscription.starts_at,
      v_subscription.current_period_end,v_subscription.grace_until,
      v_subscription.cancelled_at,v_subscription.status_changed_at,p_as_of
    );
    IF v_pro_ended_at IS NULL THEN
      RETURN;
    END IF;
    v_protected_until := v_pro_ended_at
      + make_interval(days => v_subscription.post_expiration_retention_days);
    IF p_as_of < v_protected_until THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  WITH canonical_assets AS (
    SELECT
      asset.id AS asset_id,
      asset.gallery_id,
      asset.bucket,
      asset.internal_path,
      asset.created_at AS asset_created_at,
      round_row.id AS sports_round_id,
      round_row.category_id,
      round_row.fixture_version_id,
      round_row.phase_id,
      round_row.round_number,
      round_row.sort_order,
      phase.sequence_number AS phase_sequence
    FROM public.tournament_media_assets asset
    JOIN public.tournament_media_galleries gallery ON gallery.id = asset.gallery_id
    JOIN public.tournament_rounds round_row
      ON round_row.id = public.tournament_media_gallery_sports_round(gallery.id)
     AND round_row.organization_id = asset.organization_id
     AND round_row.tournament_id = asset.tournament_id
    JOIN public.tournament_fixture_versions fixture
      ON fixture.id = round_row.fixture_version_id
     AND fixture.organization_id = asset.organization_id
     AND fixture.tournament_id = asset.tournament_id
     AND fixture.status = 'published'
     AND fixture.invalidated_at IS NULL
    JOIN public.tournament_phases phase
      ON phase.id = round_row.phase_id
     AND phase.fixture_version_id = round_row.fixture_version_id
    WHERE asset.organization_id = p_organization_id
      AND asset.tournament_id = p_tournament_id
      AND asset.status <> 'revoked'
      AND asset.storage_state IN ('active','retention_marked')
  ), sports_dates AS (
    SELECT
      category_id,fixture_version_id,phase_id,phase_sequence,round_number,
      min(sort_order) AS sort_order,
      min(asset_created_at) AS first_media_at
    FROM canonical_assets
    GROUP BY category_id,fixture_version_id,phase_id,phase_sequence,round_number
  ), dated_assets AS (
    SELECT candidate.*,
      later_date.window_exited_at
    FROM canonical_assets candidate
    JOIN LATERAL (
      SELECT later.first_media_at AS window_exited_at
      FROM sports_dates later
      WHERE later.category_id = candidate.category_id
        AND later.fixture_version_id = candidate.fixture_version_id
        AND (later.phase_sequence,later.sort_order,later.round_number)
          > (candidate.phase_sequence,candidate.sort_order,candidate.round_number)
      ORDER BY later.phase_sequence,later.sort_order,later.round_number
      OFFSET (v_retained - 1) LIMIT 1
    ) later_date ON true
  )
  SELECT
    candidate.asset_id,
    candidate.gallery_id,
    candidate.sports_round_id,
    candidate.round_number,
    candidate.window_exited_at,
    greatest(candidate.window_exited_at,candidate.asset_created_at)
      + make_interval(days => v_grace),
    candidate.bucket,
    jsonb_build_array(jsonb_build_object(
      'kind','source','bucket',candidate.bucket,'path',candidate.internal_path
    )) || coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'kind',variant.kind,'bucket',variant.bucket,'path',variant.internal_path
      ) ORDER BY variant.kind)
      FROM public.tournament_media_variants variant
      WHERE variant.asset_id = candidate.asset_id
        AND variant.status <> 'revoked'
    ),'[]'::jsonb),
    'free_matchday_window'
  FROM dated_assets candidate
  WHERE greatest(candidate.window_exited_at,candidate.asset_created_at)
      + make_interval(days => v_grace) <= p_as_of
  ORDER BY candidate.window_exited_at,candidate.asset_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Exact privileges: client reads projection only; mutations are service-only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.resolve_tournament_subscription_plan(
  text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tournament_subscription_is_consistent(
  text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tournament_subscription_pro_access_ended_at(
  text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resolve_effective_tournament_entitlements_at(
  uuid,uuid,timestamptz,boolean
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_effective_tournament_entitlements(uuid,uuid)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.has_tournament_entitlement(uuid,uuid,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_tournament_organization_subscription(
  uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,integer
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_tournament_entitlement_override(
  uuid,uuid,text,boolean,timestamptz,text
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clear_tournament_entitlement_override(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tournament_media_gallery_sports_round(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enforce_tournament_media_matchday_limit()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_tournament_media_retention_candidates(
  uuid,uuid,timestamptz
) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.get_effective_tournament_entitlements(uuid,uuid)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.has_tournament_entitlement(uuid,uuid,text)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_organization_subscription(
  uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_entitlement_override(
  uuid,uuid,text,boolean,timestamptz,text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_tournament_entitlement_override(uuid,uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_effective_tournament_entitlements_at(
  uuid,uuid,timestamptz,boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_tournament_media_retention_candidates(
  uuid,uuid,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.list_tournament_media_retention_candidates(uuid,uuid,timestamptz) IS
  'Read-only eligibility. Uses official sports-round order, never photo created_at as matchday order, and never deletes Storage or sporting data.';

COMMIT;
