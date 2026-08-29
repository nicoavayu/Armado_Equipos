BEGIN;

-- Multimedia 1C.2A: a roster-scoped, private and revocable portrait. The
-- competitive roster row remains the identity anchor; no URL or binary data is
-- copied into snapshots.
CREATE TABLE public.tournament_player_portraits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  team_entry_id uuid NOT NULL,
  roster_player_id uuid NOT NULL,
  bucket text NOT NULL DEFAULT 'tournament-player-portraits',
  object_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  focal_x numeric(5,4) NOT NULL DEFAULT 0.5,
  focal_y numeric(5,4) NOT NULL DEFAULT 0.5,
  editorial_status text NOT NULL DEFAULT 'pending_review',
  publication_consent text NOT NULL DEFAULT 'unknown',
  lifecycle_status text NOT NULL DEFAULT 'upload_pending',
  uploaded_by uuid,
  reviewed_by uuid,
  consent_actor_user_id uuid,
  replaced_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  consent_changed_at timestamptz,
  replaced_at timestamptz,
  removed_at timestamptz,
  storage_purged_at timestamptz,
  CONSTRAINT tournament_player_portraits_bucket_check
    CHECK (bucket = 'tournament-player-portraits'),
  CONSTRAINT tournament_player_portraits_mime_check
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT tournament_player_portraits_size_check
    CHECK (byte_size BETWEEN 1 AND 8388608),
  CONSTRAINT tournament_player_portraits_dimensions_check
    CHECK (
      width BETWEEN 1 AND 12000
      AND height BETWEEN 1 AND 12000
      AND width::bigint * height::bigint <= 36000000
    ),
  CONSTRAINT tournament_player_portraits_focal_check
    CHECK (focal_x BETWEEN 0 AND 1 AND focal_y BETWEEN 0 AND 1),
  CONSTRAINT tournament_player_portraits_editorial_check
    CHECK (editorial_status IN ('pending_review', 'approved', 'rejected')),
  CONSTRAINT tournament_player_portraits_consent_check
    CHECK (publication_consent IN ('unknown', 'granted', 'revoked')),
  CONSTRAINT tournament_player_portraits_lifecycle_check
    CHECK (lifecycle_status IN (
      'upload_pending', 'active', 'delete_pending', 'replaced', 'removed',
      'upload_failed'
    )),
  CONSTRAINT tournament_player_portraits_path_check CHECK (
    object_path = (
      'organizations/' || organization_id::text
      || '/roster-players/' || roster_player_id::text
      || '/' || id::text || CASE mime_type
        WHEN 'image/jpeg' THEN '.jpg'
        WHEN 'image/png' THEN '.png'
        WHEN 'image/webp' THEN '.webp'
      END
    )
  ),
  CONSTRAINT tournament_player_portraits_review_check CHECK (
    (editorial_status = 'pending_review' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (editorial_status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT tournament_player_portraits_consent_actor_check CHECK (
    (publication_consent = 'unknown' AND consent_changed_at IS NULL)
    OR (publication_consent IN ('granted', 'revoked') AND consent_changed_at IS NOT NULL)
  ),
  CONSTRAINT tournament_player_portraits_replace_check CHECK (
    (lifecycle_status = 'replaced' AND replaced_by_id IS NOT NULL AND replaced_at IS NOT NULL)
    OR (lifecycle_status <> 'replaced' AND replaced_at IS NULL)
  ),
  CONSTRAINT tournament_player_portraits_remove_check CHECK (
    (lifecycle_status = 'removed' AND removed_at IS NOT NULL AND storage_purged_at IS NOT NULL)
    OR (lifecycle_status <> 'removed' AND removed_at IS NULL)
  ),
  CONSTRAINT tournament_player_portraits_object_unique UNIQUE (bucket, object_path),
  CONSTRAINT tournament_player_portraits_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT tournament_player_portraits_entry_fk FOREIGN KEY (
    organization_id, tournament_id, team_entry_id
  ) REFERENCES public.tournament_team_entries(organization_id, tournament_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tournament_player_portraits_player_fk FOREIGN KEY (
    organization_id, team_entry_id, roster_player_id
  ) REFERENCES public.tournament_roster_players(organization_id, team_entry_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tournament_player_portraits_uploaded_by_fk FOREIGN KEY (uploaded_by)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_player_portraits_reviewed_by_fk FOREIGN KEY (reviewed_by)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_player_portraits_consent_actor_fk FOREIGN KEY (consent_actor_user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_player_portraits_replaced_by_fk FOREIGN KEY (
    organization_id, replaced_by_id
  ) REFERENCES public.tournament_player_portraits(organization_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX tournament_player_portraits_one_active_idx
  ON public.tournament_player_portraits(roster_player_id)
  WHERE lifecycle_status IN ('active', 'delete_pending');
CREATE INDEX tournament_player_portraits_roster_idx
  ON public.tournament_player_portraits(organization_id, roster_player_id, created_at DESC);
CREATE INDEX tournament_player_portraits_resolver_idx
  ON public.tournament_player_portraits(
    organization_id, tournament_id, lifecycle_status, editorial_status,
    publication_consent
  );
CREATE INDEX tournament_player_portraits_team_idx
  ON public.tournament_player_portraits(organization_id, team_entry_id);

COMMENT ON TABLE public.tournament_player_portraits IS
  'Private mutable visual identity owned by tournament_roster_players.id. 1C.2A exposes no public or social audience.';
COMMENT ON COLUMN public.tournament_player_portraits.object_path IS
  'Internal immutable Storage path. Never expose as an application ImageRef or persist a signed URL.';
COMMENT ON COLUMN public.tournament_player_portraits.publication_consent IS
  'Separate from editorial approval. granted is reserved for a future verified consent flow; 1C.2A can only retain unknown or revoke.';

CREATE OR REPLACE FUNCTION public.can_manage_tournament_player_portrait_as(
  p_organization_id uuid,
  p_roster_player_id uuid,
  p_actor_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tournament_roster_players player
    JOIN public.tournament_team_entries entry
      ON entry.organization_id = player.organization_id
     AND entry.id = player.team_entry_id
    JOIN public.tournament_organizations organization
      ON organization.id = player.organization_id
    JOIN public.tournaments tournament
      ON tournament.organization_id = entry.organization_id
     AND tournament.id = entry.tournament_id
    WHERE player.organization_id = p_organization_id
      AND player.id = p_roster_player_id
      AND organization.status = 'active'
      AND tournament.status <> 'archived'
      AND entry.status <> 'archived'
      AND (
        EXISTS (
          SELECT 1
          FROM public.tournament_organization_members membership
          WHERE membership.organization_id = p_organization_id
            AND membership.user_id = p_actor_user_id
            AND membership.status = 'active'
            AND 'roster_players.update' = ANY(
              public.tournament_role_capabilities(membership.role)
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.tournament_team_managers manager
          WHERE manager.organization_id = p_organization_id
            AND manager.team_entry_id = player.team_entry_id
            AND manager.user_id = p_actor_user_id
            AND manager.status = 'active'
            AND manager.role IN ('captain', 'delegate')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_tournament_player_portrait(
  p_organization_id uuid,
  p_roster_player_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_manage_tournament_player_portrait_as(
    p_organization_id, p_roster_player_id, auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_tournament_player_portrait_as(
  p_organization_id uuid,
  p_roster_player_id uuid,
  p_actor_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tournament_roster_players player
    JOIN public.tournament_team_entries entry
      ON entry.organization_id = player.organization_id
     AND entry.id = player.team_entry_id
    JOIN public.tournament_organizations organization
      ON organization.id = player.organization_id
    WHERE player.organization_id = p_organization_id
      AND player.id = p_roster_player_id
      AND organization.status = 'active'
      AND entry.status <> 'archived'
      AND (
        EXISTS (
          SELECT 1
          FROM public.tournament_organization_members membership
          WHERE membership.organization_id = p_organization_id
            AND membership.user_id = p_actor_user_id
            AND membership.status = 'active'
            AND 'roster_players.read' = ANY(
              public.tournament_role_capabilities(membership.role)
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.tournament_team_managers manager
          WHERE manager.organization_id = p_organization_id
            AND manager.team_entry_id = player.team_entry_id
            AND manager.user_id = p_actor_user_id
            AND manager.status = 'active'
        )
        OR player.arma2_user_id = p_actor_user_id
        OR EXISTS (
          SELECT 1
          FROM public.tournament_provisional_players provisional
          WHERE provisional.organization_id = player.organization_id
            AND provisional.id = player.provisional_player_id
            AND provisional.claim_status = 'claimed'
            AND provisional.claimed_by_user_id = p_actor_user_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_tournament_player_portrait(
  p_organization_id uuid,
  p_roster_player_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_read_tournament_player_portrait_as(
    p_organization_id, p_roster_player_id, auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.request_tournament_player_portrait_upload(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_roster_player_id uuid,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_player public.tournament_roster_players%ROWTYPE;
  v_entry public.tournament_team_entries%ROWTYPE;
  v_portrait_id uuid := gen_random_uuid();
  v_extension text;
  v_path text;
BEGIN
  IF NOT public.can_manage_tournament_player_portrait_as(
    p_organization_id, p_roster_player_id, p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  IF p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
    OR p_byte_size NOT BETWEEN 1 AND 8388608
    OR p_width NOT BETWEEN 1 AND 12000
    OR p_height NOT BETWEEN 1 AND 12000
    OR p_width::bigint * p_height::bigint > 36000000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_PORTRAIT_FILE_INVALID';
  END IF;

  SELECT * INTO v_player
  FROM public.tournament_roster_players player
  WHERE player.organization_id = p_organization_id
    AND player.id = p_roster_player_id
    AND player.status = 'active';
  IF v_player.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  SELECT * INTO v_entry
  FROM public.tournament_team_entries entry
  WHERE entry.organization_id = p_organization_id
    AND entry.id = v_player.team_entry_id;

  v_extension := CASE p_mime_type
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
  END;
  v_path := 'organizations/' || p_organization_id::text
    || '/roster-players/' || p_roster_player_id::text
    || '/' || v_portrait_id::text || '.' || v_extension;

  INSERT INTO public.tournament_player_portraits (
    id, organization_id, tournament_id, team_entry_id, roster_player_id,
    object_path, mime_type, byte_size, width, height, uploaded_by
  ) VALUES (
    v_portrait_id, p_organization_id, v_entry.tournament_id,
    v_player.team_entry_id, p_roster_player_id, v_path, p_mime_type,
    p_byte_size, p_width, p_height, p_actor_user_id
  );

  RETURN jsonb_build_object(
    'portraitId', v_portrait_id,
    'bucket', 'tournament-player-portraits',
    'objectPath', v_path,
    'imageRef', jsonb_build_object(
      'kind', 'player_portrait', 'id', v_portrait_id, 'variant', 'original'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_tournament_player_portrait_upload(
  p_actor_user_id uuid,
  p_portrait_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.tournament_player_portraits portrait
  SET lifecycle_status = 'upload_failed', updated_at = now()
  WHERE portrait.id = p_portrait_id
    AND portrait.uploaded_by = p_actor_user_id
    AND portrait.lifecycle_status = 'upload_pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_tournament_player_portrait_upload(
  p_actor_user_id uuid,
  p_portrait_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portrait public.tournament_player_portraits%ROWTYPE;
  v_previous_id uuid;
BEGIN
  SELECT * INTO v_portrait
  FROM public.tournament_player_portraits portrait
  WHERE portrait.id = p_portrait_id
    AND portrait.lifecycle_status = 'upload_pending'
  FOR UPDATE;
  IF v_portrait.id IS NULL
    OR v_portrait.uploaded_by IS DISTINCT FROM p_actor_user_id
    OR NOT public.can_manage_tournament_player_portrait_as(
      v_portrait.organization_id, v_portrait.roster_player_id, p_actor_user_id
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;

  PERFORM 1 FROM public.tournament_roster_players player
  WHERE player.id = v_portrait.roster_player_id FOR UPDATE;

  SELECT portrait.id INTO v_previous_id
  FROM public.tournament_player_portraits portrait
  WHERE portrait.roster_player_id = v_portrait.roster_player_id
    AND portrait.lifecycle_status = 'active'
  FOR UPDATE;

  IF v_previous_id IS NOT NULL THEN
    UPDATE public.tournament_player_portraits
    SET lifecycle_status = 'replaced', replaced_by_id = v_portrait.id,
        replaced_at = now(), updated_at = now()
    WHERE id = v_previous_id;
  END IF;
  UPDATE public.tournament_player_portraits
  SET lifecycle_status = 'active', updated_at = now()
  WHERE id = v_portrait.id;

  INSERT INTO public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, team_entry_id, tournament_id, metadata
  ) VALUES (
    v_portrait.organization_id, p_actor_user_id, 'user',
    CASE WHEN v_previous_id IS NULL THEN 'portrait.uploaded' ELSE 'portrait.replaced' END,
    'player_portrait', v_portrait.id, v_portrait.team_entry_id,
    v_portrait.tournament_id,
    jsonb_build_object('rosterPlayerId', v_portrait.roster_player_id,
      'replacedPortraitId', v_previous_id)
  );
  RETURN jsonb_build_object(
    'imageRef', jsonb_build_object(
      'kind', 'player_portrait', 'id', v_portrait.id, 'variant', 'original'
    ),
    'replacedPortraitId', v_previous_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tournament_player_portrait_editorial_status(
  p_organization_id uuid,
  p_portrait_id uuid,
  p_editorial_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portrait public.tournament_player_portraits%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_editorial_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_PORTRAIT_STATE_INVALID';
  END IF;
  SELECT * INTO v_portrait FROM public.tournament_player_portraits
  WHERE id = p_portrait_id AND organization_id = p_organization_id
    AND lifecycle_status = 'active' FOR UPDATE;
  IF v_portrait.id IS NULL OR NOT public.can_manage_tournament_player_portrait_as(
    p_organization_id, v_portrait.roster_player_id, auth.uid()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  UPDATE public.tournament_player_portraits
  SET editorial_status = p_editorial_status, reviewed_by = auth.uid(),
      reviewed_at = now(), updated_at = now()
  WHERE id = p_portrait_id;
  PERFORM public.append_tournament_audit(
    p_organization_id, 'portrait.reviewed', 'player_portrait', p_portrait_id,
    v_portrait.team_entry_id, v_portrait.tournament_id,
    jsonb_build_object('editorialStatus', p_editorial_status,
      'rosterPlayerId', v_portrait.roster_player_id)
  );
  RETURN jsonb_build_object('portraitId', p_portrait_id,
    'editorialStatus', p_editorial_status);
END;
$$;

-- 1C.2A deliberately exposes only revocation. Granting public consent needs
-- the verified subject/guardian flow planned for 1C.2C.
CREATE OR REPLACE FUNCTION public.revoke_tournament_player_portrait_publication(
  p_organization_id uuid,
  p_portrait_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portrait public.tournament_player_portraits%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  SELECT * INTO v_portrait FROM public.tournament_player_portraits
  WHERE id = p_portrait_id AND organization_id = p_organization_id
    AND lifecycle_status IN ('active', 'delete_pending') FOR UPDATE;
  IF v_portrait.id IS NULL OR NOT public.can_manage_tournament_player_portrait_as(
    p_organization_id, v_portrait.roster_player_id, auth.uid()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  UPDATE public.tournament_player_portraits
  SET publication_consent = 'revoked', consent_actor_user_id = auth.uid(),
      consent_changed_at = now(), updated_at = now()
  WHERE id = p_portrait_id;
  PERFORM public.append_tournament_audit(
    p_organization_id, 'portrait.publication_revoked', 'player_portrait',
    p_portrait_id, v_portrait.team_entry_id, v_portrait.tournament_id,
    jsonb_build_object('rosterPlayerId', v_portrait.roster_player_id)
  );
  RETURN jsonb_build_object('portraitId', p_portrait_id,
    'publicationConsent', 'revoked');
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_tournament_player_portrait_read(
  p_actor_user_id uuid,
  p_portrait_id uuid,
  p_variant text,
  p_audience text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_portrait public.tournament_player_portraits%ROWTYPE;
BEGIN
  IF p_variant <> 'original' OR p_audience <> 'authenticated_roster' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_AUDIENCE_DISABLED';
  END IF;
  SELECT * INTO v_portrait FROM public.tournament_player_portraits portrait
  WHERE portrait.id = p_portrait_id AND portrait.lifecycle_status = 'active';
  IF v_portrait.id IS NULL OR NOT public.can_read_tournament_player_portrait_as(
    v_portrait.organization_id, v_portrait.roster_player_id, p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  RETURN jsonb_build_object(
    'bucket', v_portrait.bucket, 'objectPath', v_portrait.object_path,
    'mimeType', v_portrait.mime_type, 'width', v_portrait.width,
    'height', v_portrait.height, 'focalX', v_portrait.focal_x,
    'focalY', v_portrait.focal_y, 'audience', p_audience
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_player_portrait_ref(
  p_organization_id uuid,
  p_roster_player_id uuid,
  p_variant text DEFAULT 'original'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_portrait_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_variant <> 'original'
    OR NOT public.can_read_tournament_player_portrait(
      p_organization_id, p_roster_player_id
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  SELECT id INTO v_portrait_id FROM public.tournament_player_portraits
  WHERE organization_id = p_organization_id
    AND roster_player_id = p_roster_player_id
    AND lifecycle_status = 'active';
  IF v_portrait_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'kind', 'player_portrait', 'id', v_portrait_id, 'variant', p_variant
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_tournament_player_portrait_delete(
  p_actor_user_id uuid,
  p_portrait_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_portrait public.tournament_player_portraits%ROWTYPE;
BEGIN
  SELECT * INTO v_portrait FROM public.tournament_player_portraits portrait
  WHERE portrait.id = p_portrait_id
    AND portrait.lifecycle_status IN ('active', 'delete_pending') FOR UPDATE;
  IF v_portrait.id IS NULL OR NOT public.can_manage_tournament_player_portrait_as(
    v_portrait.organization_id, v_portrait.roster_player_id, p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  IF v_portrait.lifecycle_status = 'active' THEN
    UPDATE public.tournament_player_portraits
    SET lifecycle_status = 'delete_pending', publication_consent = 'revoked',
        consent_actor_user_id = p_actor_user_id, consent_changed_at = now(),
        updated_at = now()
    WHERE id = p_portrait_id;
  END IF;
  RETURN jsonb_build_object('bucket', v_portrait.bucket,
    'objectPath', v_portrait.object_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tournament_player_portrait_delete(
  p_actor_user_id uuid,
  p_portrait_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_portrait public.tournament_player_portraits%ROWTYPE;
BEGIN
  SELECT * INTO v_portrait FROM public.tournament_player_portraits portrait
  WHERE portrait.id = p_portrait_id AND portrait.lifecycle_status = 'delete_pending'
  FOR UPDATE;
  IF v_portrait.id IS NULL OR NOT public.can_manage_tournament_player_portrait_as(
    v_portrait.organization_id, v_portrait.roster_player_id, p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  UPDATE public.tournament_player_portraits
  SET lifecycle_status = 'removed', removed_at = now(),
      storage_purged_at = now(), updated_at = now()
  WHERE id = p_portrait_id;
  INSERT INTO public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, team_entry_id, tournament_id, metadata
  ) VALUES (
    v_portrait.organization_id, p_actor_user_id, 'user', 'portrait.removed',
    'player_portrait', v_portrait.id, v_portrait.team_entry_id,
    v_portrait.tournament_id,
    jsonb_build_object('rosterPlayerId', v_portrait.roster_player_id)
  );
  RETURN jsonb_build_object('portraitId', p_portrait_id, 'deleted', true);
END;
$$;

ALTER TABLE public.tournament_player_portraits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tournament_player_portraits_read_authorized
ON public.tournament_player_portraits FOR SELECT TO authenticated
USING (public.can_read_tournament_player_portrait(
  organization_id, roster_player_id
));

REVOKE ALL ON TABLE public.tournament_player_portraits FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, organization_id, tournament_id, team_entry_id, roster_player_id,
  mime_type, byte_size, width, height, focal_x, focal_y, editorial_status,
  publication_consent, lifecycle_status, uploaded_by, reviewed_by, created_at,
  updated_at, reviewed_at, consent_changed_at, replaced_at, removed_at
) ON public.tournament_player_portraits TO authenticated;
GRANT ALL ON TABLE public.tournament_player_portraits TO service_role;

REVOKE ALL ON FUNCTION public.can_manage_tournament_player_portrait_as(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_tournament_player_portrait(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_tournament_player_portrait_as(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_tournament_player_portrait(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_tournament_player_portrait_upload(uuid, uuid, uuid, text, bigint, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_tournament_player_portrait_upload(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_tournament_player_portrait_upload(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_tournament_player_portrait_read(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_tournament_player_portrait_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tournament_player_portrait_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tournament_player_portrait_editorial_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_tournament_player_portrait_publication(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_tournament_player_portrait_ref(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.can_manage_tournament_player_portrait_as(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_tournament_player_portrait(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_tournament_player_portrait_as(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_tournament_player_portrait(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_tournament_player_portrait_upload(uuid, uuid, uuid, text, bigint, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_tournament_player_portrait_upload(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_tournament_player_portrait_upload(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_tournament_player_portrait_read(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_tournament_player_portrait_delete(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tournament_player_portrait_delete(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_player_portrait_editorial_status(uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_tournament_player_portrait_publication(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_player_portrait_ref(uuid, uuid, text)
  TO authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tournament-player-portraits', 'tournament-player-portraits', false,
  8388608, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- There is intentionally no authenticated storage.objects policy for this
-- bucket. All object paths are derived and all mutations/signing happen in the
-- trusted Edge function after database authorization.
DROP POLICY IF EXISTS tournament_player_portraits_select ON storage.objects;
DROP POLICY IF EXISTS tournament_player_portraits_insert ON storage.objects;
DROP POLICY IF EXISTS tournament_player_portraits_update ON storage.objects;
DROP POLICY IF EXISTS tournament_player_portraits_delete ON storage.objects;

COMMIT;
