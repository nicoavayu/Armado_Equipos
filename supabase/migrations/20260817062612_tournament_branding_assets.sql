BEGIN;

-- Structural branding is intentionally separate from the private
-- tournament-media gallery pipeline and from the legacy global team-crests
-- bucket. The database stores only versioned object paths.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS logo_path text;

ALTER TABLE public.tournament_organizations
  DROP CONSTRAINT IF EXISTS tournament_organizations_logo_path_check;
ALTER TABLE public.tournament_team_entries
  DROP CONSTRAINT IF EXISTS tournament_team_entries_shield_path_check;
ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_logo_path_check;

ALTER TABLE public.tournament_organizations
  ADD CONSTRAINT tournament_organizations_logo_path_check CHECK (
    logo_path IS NULL
    OR logo_path ~ (
      '^' || id::text || '/organizations/' || id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  );

ALTER TABLE public.tournament_team_entries
  ADD CONSTRAINT tournament_team_entries_shield_path_check CHECK (
    shield_path IS NULL
    OR shield_path ~ (
      '^' || organization_id::text || '/teams/' || id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
    -- The canonical QA dataset and historical rows may still carry these
    -- read-only fixture references. The branding RPC never writes this form.
    OR shield_path ~ '^qa/shields/[a-z0-9-]+\.svg$'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tournaments'::regclass
      AND conname = 'tournaments_logo_path_check'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_logo_path_check CHECK (
        logo_path IS NULL
        OR (
          char_length(logo_path) BETWEEN 1 AND 512
          AND logo_path ~ (
            '^' || organization_id::text || '/tournaments/' || id::text
            || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
          )
          AND logo_path !~ '(^|/)\.{1,2}(/|$)'
          AND logo_path !~ '//'
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_teams_context(
  p_organization_id uuid,
  p_tournament_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL
    OR NOT public.has_tournament_organization_capability(
      p_organization_id,
      'team_entries.read'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments
    WHERE id = p_tournament_id
      AND organization_id = p_organization_id
      AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;

  SELECT jsonb_build_object(
    'tournamentId', p_tournament_id,
    'settings', COALESCE((
      SELECT jsonb_build_object(
        'minimumPlayers', minimum_players,
        'maximumPlayers', maximum_players,
        'shirtNumberRequired', shirt_number_required,
        'uniqueShirtNumbers', unique_shirt_numbers,
        'positionRequired', position_required,
        'minimumGoalkeepers', minimum_goalkeepers,
        'allowProvisionalPlayers', allow_provisional_players,
        'allowPlayerMultipleTeams', allow_player_multiple_teams,
        'rosterOpensAt', roster_opens_at,
        'rosterClosesAt', roster_closes_at
      )
      FROM public.tournament_roster_settings
      WHERE tournament_id = p_tournament_id
    ), '{}'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', entry.id,
        'name', entry.name,
        'shortName', entry.short_name,
        'shieldPath', entry.shield_path,
        'primaryColor', entry.primary_color,
        'secondaryColor', entry.secondary_color,
        'categoryId', entry.category_id,
        'categoryName', category.name,
        'arma2TeamId', entry.arma2_team_id,
        'linked', entry.arma2_team_id IS NOT NULL,
        'status', entry.status,
        'registrationSource', entry.registration_source,
        'submittedAt', entry.submitted_at,
        'updatedAt', entry.updated_at,
        'manager', (
          SELECT jsonb_build_object(
            'displayName', manager.display_name,
            'role', manager.role,
            'status', manager.status
          )
          FROM public.tournament_team_managers manager
          WHERE manager.team_entry_id = entry.id
            AND manager.status <> 'revoked'
          ORDER BY (manager.role = 'captain') DESC, manager.created_at
          LIMIT 1
        ),
        'roster', (
          SELECT jsonb_build_object(
            'id', roster.id,
            'version', roster.version,
            'status', roster.status,
            'playerCount', (
              SELECT count(*)
              FROM public.tournament_roster_players player
              WHERE player.roster_id = roster.id AND player.status = 'active'
            ),
            'goalkeeperCount', (
              SELECT count(*)
              FROM public.tournament_roster_players player
              WHERE player.roster_id = roster.id
                AND player.status = 'active'
                AND player.is_goalkeeper
            )
          )
          FROM public.tournament_rosters roster
          WHERE roster.team_entry_id = entry.id
          ORDER BY roster.version DESC
          LIMIT 1
        ),
        'hasObservations', EXISTS (
          SELECT 1
          FROM public.tournament_team_reviews review
          WHERE review.team_entry_id = entry.id
            AND review.decision = 'changes_requested'
        )
      ) ORDER BY category.sort_order, entry.name)
      FROM public.tournament_team_entries entry
      JOIN public.tournament_categories category ON category.id = entry.category_id
      WHERE entry.organization_id = p_organization_id
        AND entry.tournament_id = p_tournament_id
        AND entry.status <> 'archived'
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

COMMENT ON COLUMN public.tournaments.logo_path IS
  'Durable versioned path in the public tournament-branding bucket; never a URL.';

CREATE OR REPLACE FUNCTION public.is_tournament_branding_path(
  p_name text,
  p_kind text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_name IS NOT NULL
    AND p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(organizations|tournaments|teams)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    AND p_name !~ '(^|/)\.{1,2}(/|$)'
    AND p_name !~ '//'
    AND (p_kind IS NULL OR split_part(p_name, '/', 2) = p_kind);
$$;

-- Branding remains mutable after sports approval. This predicate deliberately
-- does not reuse can_edit_tournament_team_entry(), whose status/window checks
-- protect competitive data. Organization staff need the existing
-- team_entries.update capability; the team's active captain/delegate keeps the
-- same relational branding contract they had during registration.
CREATE OR REPLACE FUNCTION public.can_update_tournament_team_branding(
  p_organization_id uuid,
  p_team_entry_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tournament_team_entries entry
    JOIN public.tournament_organizations organization
      ON organization.id = entry.organization_id
    JOIN public.tournaments tournament
      ON tournament.id = entry.tournament_id
     AND tournament.organization_id = entry.organization_id
    WHERE entry.id = p_team_entry_id
      AND entry.organization_id = p_organization_id
      AND entry.status IN (
        'draft', 'invited', 'in_progress', 'changes_requested', 'approved'
      )
      AND organization.status = 'active'
      AND tournament.status <> 'archived'
      AND (
        public.has_tournament_organization_capability(
          p_organization_id,
          'team_entries.update'
        )
        OR EXISTS (
          SELECT 1
          FROM public.tournament_team_managers manager
          WHERE manager.team_entry_id = entry.id
            AND manager.organization_id = entry.organization_id
            AND manager.user_id = auth.uid()
            AND manager.status = 'active'
            AND manager.role IN ('captain', 'delegate')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_tournament_branding_object(
  p_name text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization_id uuid;
  v_entity_id uuid;
  v_kind text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_tournament_branding_path(p_name) THEN
    RETURN false;
  END IF;

  v_organization_id := split_part(p_name, '/', 1)::uuid;
  v_kind := split_part(p_name, '/', 2);
  v_entity_id := split_part(p_name, '/', 3)::uuid;

  IF v_kind = 'organizations' THEN
    RETURN v_entity_id = v_organization_id
      AND public.has_tournament_organization_capability(
        v_organization_id,
        'organization.update'
      );
  END IF;

  IF v_kind = 'tournaments' THEN
    RETURN public.has_tournament_organization_capability(
      v_organization_id,
      'tournaments.update'
    ) AND EXISTS (
      SELECT 1
      FROM public.tournaments tournament
      WHERE tournament.id = v_entity_id
        AND tournament.organization_id = v_organization_id
        AND tournament.status <> 'archived'
    );
  END IF;

  IF v_kind = 'teams' THEN
    RETURN public.can_update_tournament_team_branding(
      v_organization_id,
      v_entity_id
    );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tournament_branding_reference(
  p_organization_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_path text;
  v_tournament_id uuid;
  v_audit_team_id uuid;
  v_expected_folder text;
  v_synced_participant_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;

  v_expected_folder := CASE p_entity_kind
    WHEN 'organization' THEN 'organizations'
    WHEN 'tournament' THEN 'tournaments'
    WHEN 'team' THEN 'teams'
    ELSE NULL
  END;

  IF v_expected_folder IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_BRANDING_INVALID_REFERENCE';
  END IF;

  IF p_path IS NOT NULL AND (
    NOT public.is_tournament_branding_path(p_path, v_expected_folder)
    OR split_part(p_path, '/', 1)::uuid <> p_organization_id
    OR split_part(p_path, '/', 3)::uuid <> p_entity_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_BRANDING_INVALID_REFERENCE';
  END IF;

  IF p_entity_kind = 'organization' THEN
    IF p_entity_id <> p_organization_id
      OR NOT public.has_tournament_organization_capability(
        p_organization_id,
        'organization.update'
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_BRANDING_FORBIDDEN';
    END IF;

    SELECT organization.logo_path
    INTO v_previous_path
    FROM public.tournament_organizations organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_BRANDING_FORBIDDEN';
    END IF;

    UPDATE public.tournament_organizations
    SET logo_path = p_path
    WHERE id = p_organization_id;
  ELSIF p_entity_kind = 'tournament' THEN
    IF NOT public.has_tournament_organization_capability(
      p_organization_id,
      'tournaments.update'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_BRANDING_FORBIDDEN';
    END IF;

    SELECT tournament.logo_path, tournament.id
    INTO v_previous_path, v_tournament_id
    FROM public.tournaments tournament
    WHERE tournament.id = p_entity_id
      AND tournament.organization_id = p_organization_id
      AND tournament.status <> 'archived'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_BRANDING_FORBIDDEN';
    END IF;

    UPDATE public.tournaments
    SET logo_path = p_path
    WHERE id = p_entity_id;
  ELSE
    IF NOT public.can_update_tournament_team_branding(
      p_organization_id,
      p_entity_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_BRANDING_FORBIDDEN';
    END IF;

    SELECT entry.shield_path, entry.tournament_id, entry.id
    INTO v_previous_path, v_tournament_id, v_audit_team_id
    FROM public.tournament_team_entries entry
    WHERE entry.id = p_entity_id
      AND entry.organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_BRANDING_FORBIDDEN';
    END IF;

    UPDATE public.tournament_team_entries
    SET shield_path = p_path
    WHERE id = p_entity_id;

    -- Participant snapshots keep competitive identity frozen (name, colors,
    -- seeding and membership) while projecting the current visual identity.
    -- Existing fixture, standings and public RPCs already render this field.
    UPDATE public.tournament_competition_participants participant
    SET snapshot_shield_path = p_path
    WHERE participant.organization_id = p_organization_id
      AND participant.team_entry_id = p_entity_id;
    GET DIAGNOSTICS v_synced_participant_count = ROW_COUNT;
  END IF;

  PERFORM public.append_tournament_audit(
    p_organization_id,
    'branding.' || p_entity_kind || CASE WHEN p_path IS NULL THEN '.removed' ELSE '.updated' END,
    p_entity_kind || '_branding',
    p_entity_id,
    v_audit_team_id,
    v_tournament_id,
    jsonb_build_object(
      'hadPrevious', v_previous_path IS NOT NULL,
      'hasCurrent', p_path IS NOT NULL,
      'previousPath', v_previous_path,
      'path', p_path,
      'syncedParticipantCount', v_synced_participant_count
    )
  );

  RETURN jsonb_build_object(
    'entityKind', p_entity_kind,
    'entityId', p_entity_id,
    'previousPath', v_previous_path,
    'path', p_path
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_branding_context(
  p_organization_id uuid,
  p_tournament_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization public.tournament_organizations%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_tournaments jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;

  SELECT organization.*
  INTO v_organization
  FROM public.tournament_organizations organization
  WHERE organization.id = p_organization_id
    AND organization.status = 'active';

  IF v_organization.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;

  IF p_tournament_id IS NULL THEN
    IF NOT public.has_tournament_organization_capability(
      p_organization_id,
      'tournaments.read'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', tournament.id,
      'logoPath', tournament.logo_path
    ) ORDER BY tournament.updated_at DESC, tournament.id), '[]'::jsonb)
    INTO v_tournaments
    FROM public.tournaments tournament
    WHERE tournament.organization_id = p_organization_id
      AND tournament.status <> 'archived';
  ELSE
    SELECT tournament.*
    INTO v_tournament
    FROM public.tournaments tournament
    WHERE tournament.id = p_tournament_id
      AND tournament.organization_id = p_organization_id
      AND tournament.status <> 'archived';

    IF v_tournament.id IS NULL OR NOT (
      public.has_tournament_organization_capability(
        p_organization_id,
        'tournaments.read'
      )
      OR public.can_read_tournament_participant_hub(p_tournament_id, NULL)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
    END IF;

    v_tournaments := jsonb_build_array(jsonb_build_object(
      'id', v_tournament.id,
      'logoPath', v_tournament.logo_path
    ));
  END IF;

  RETURN jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_organization.id,
      'name', v_organization.name,
      'logoPath', v_organization.logo_path
    ),
    'tournaments', v_tournaments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_tournament_branding(
  p_public_slug text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_public_slug IS NULL
    OR char_length(p_public_slug) NOT BETWEEN 3 AND 96
    OR p_public_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$'
  THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'organization', jsonb_build_object(
      'id', organization.id,
      'name', organization.name,
      'logoPath', organization.logo_path
    ),
    'tournament', jsonb_build_object(
      'id', tournament.id,
      'name', tournament.name,
      'logoPath', tournament.logo_path
    )
  )
  INTO v_result
  FROM public.tournament_public_pages page
  JOIN public.tournaments tournament
    ON tournament.id = page.tournament_id
   AND tournament.organization_id = page.organization_id
   AND tournament.status IN ('registration', 'scheduled', 'active', 'completed')
  JOIN public.tournament_organizations organization
    ON organization.id = page.organization_id
   AND organization.status = 'active'
  JOIN public.tournament_seasons season
    ON season.id = tournament.season_id
   AND season.organization_id = tournament.organization_id
   AND season.status <> 'archived'
  WHERE page.public_slug = p_public_slug
    AND page.status = 'published';

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.is_tournament_branding_path(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_update_tournament_team_branding(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_write_tournament_branding_object(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tournament_branding_reference(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_tournament_branding_context(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_tournament_branding(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_tournament_branding_path(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_update_tournament_team_branding(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_tournament_branding_object(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_branding_reference(uuid, text, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_branding_context(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_branding(text)
  TO anon, authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tournament-branding',
  'tournament-branding',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS tournament_branding_insert_authorized ON storage.objects;
DROP POLICY IF EXISTS tournament_branding_select_authorized ON storage.objects;
DROP POLICY IF EXISTS tournament_branding_update_denied ON storage.objects;
DROP POLICY IF EXISTS tournament_branding_delete_authorized ON storage.objects;

-- Storage DELETE returns the removed row. PostgREST therefore also needs a
-- matching SELECT policy; without it, remove() reports an idempotent success
-- while RLS keeps the object in place.
CREATE POLICY tournament_branding_select_authorized
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'tournament-branding'
  AND public.can_write_tournament_branding_object(name)
);

CREATE POLICY tournament_branding_insert_authorized
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'tournament-branding'
  AND public.can_write_tournament_branding_object(name)
);

-- Assets are immutable. Replacement means upload a new UUID path, switch the
-- durable reference, then delete the previous object.
CREATE POLICY tournament_branding_update_denied
ON storage.objects FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY tournament_branding_delete_authorized
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'tournament-branding'
  AND public.can_write_tournament_branding_object(name)
);

COMMIT;
