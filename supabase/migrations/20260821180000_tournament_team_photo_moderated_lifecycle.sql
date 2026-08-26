BEGIN;

-- Multimedia 1C.3B — Foto del equipo, moderada.
--
-- El escudo y la foto del equipo son dos cosas distintas y esta migración no
-- las mezcla: `tournament_team_entries.shield_path` sigue siendo la marca
-- —vive en un bucket público, se dibuja chiquita, y cambiarla es un dato del
-- equipo—, y la foto es una fotografía de personas —vive en un bucket privado,
-- se dibuja grande, y publicarla es una decisión editorial de la organización—.
-- Guardar una fotografía en el campo del escudo habría convertido cada cambio
-- de marca en una publicación sin moderar.
--
-- Lo que NO se reinventa acá, porque ya existe y está aprobado:
--
--   * quién puede gestionar → can_manage_tournament_team_visual_assets_as()
--   * quién puede moderar   → can_moderate_tournament_team_visual_assets_as()
--   * el ciclo de un objeto → el vocabulario de lifecycle de 1C.2A
--   * el veredicto editorial→ pending_review / approved / rejected
--   * la trazabilidad       → append_tournament_audit() y el trigger
--                             tournament_audit_append_only, intactos
--
-- Lo único que cambia de forma respecto del retrato es el reemplazo, y cambia
-- a propósito. En 1C.2A `finalize` jubila al retrato vigente en el mismo
-- momento en que el nuevo se da por subido: para un retrato eso es correcto,
-- porque el retrato no espera moderación para ser el retrato. Para la foto del
-- equipo eso significaría que cualquier habilitado hace desaparecer la foto
-- aprobada subiendo una que todavía nadie miró. Acá conviven dos filas —la
-- vigente y la candidata— y la vigente sólo se mueve cuando la organización
-- aprueba la otra.

-- ---------------------------------------------------------------------------
-- 1. La fila
-- ---------------------------------------------------------------------------

CREATE TABLE public.tournament_team_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  team_entry_id uuid NOT NULL,
  bucket text NOT NULL DEFAULT 'tournament-team-photos',
  object_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  -- Lo calcula el Edge function sobre los bytes que ÉL subió, no el navegador:
  -- un checksum declarado por quien manda el archivo no prueba nada. Por eso
  -- es NULL mientras la carga está en vuelo y obligatorio en cuanto la fila
  -- puede llegar a mostrarse.
  checksum_sha256 text,
  editorial_status text NOT NULL DEFAULT 'pending_review',
  lifecycle_status text NOT NULL DEFAULT 'upload_pending',
  review_reason text,
  uploaded_by uuid,
  reviewed_by uuid,
  revoked_by uuid,
  replaced_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  approved_at timestamptz,
  revoked_at timestamptz,
  replaced_at timestamptz,
  removed_at timestamptz,
  storage_purged_at timestamptz,
  CONSTRAINT tournament_team_photos_bucket_check
    CHECK (bucket = 'tournament-team-photos'),
  CONSTRAINT tournament_team_photos_mime_check
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT tournament_team_photos_size_check
    CHECK (byte_size BETWEEN 1 AND 8388608),
  CONSTRAINT tournament_team_photos_dimensions_check
    CHECK (
      width BETWEEN 1 AND 12000
      AND height BETWEEN 1 AND 12000
      AND width::bigint * height::bigint <= 36000000
    ),
  CONSTRAINT tournament_team_photos_editorial_check
    CHECK (editorial_status IN ('pending_review', 'approved', 'rejected')),
  CONSTRAINT tournament_team_photos_lifecycle_check
    CHECK (lifecycle_status IN (
      'upload_pending', 'active', 'delete_pending', 'replaced', 'removed',
      'upload_failed'
    )),
  CONSTRAINT tournament_team_photos_path_check CHECK (
    object_path = (
      'organizations/' || organization_id::text
      || '/team-entries/' || team_entry_id::text
      || '/' || id::text || CASE mime_type
        WHEN 'image/jpeg' THEN '.jpg'
        WHEN 'image/png' THEN '.png'
        WHEN 'image/webp' THEN '.webp'
      END
    )
  ),
  -- Integridad: una fila sin checksum no puede estar en ningún estado desde el
  -- que se muestre o se firme. Una carga fallida se queda sin checksum y por
  -- eso mismo no puede volverse visible por accidente.
  CONSTRAINT tournament_team_photos_checksum_check CHECK (
    (lifecycle_status IN ('upload_pending', 'upload_failed') AND checksum_sha256 IS NULL)
    OR (
      lifecycle_status NOT IN ('upload_pending', 'upload_failed')
      AND checksum_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT tournament_team_photos_review_check CHECK (
    (editorial_status = 'pending_review'
      AND reviewed_by IS NULL AND reviewed_at IS NULL
      AND approved_at IS NULL AND review_reason IS NULL)
    OR (editorial_status = 'approved'
      AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND approved_at IS NOT NULL AND review_reason IS NULL)
    -- El motivo del rechazo es opcional pero, cuando está, es texto útil: ni
    -- vacío ni una novela. La pantalla lo muestra tal cual al que subió.
    OR (editorial_status = 'rejected'
      AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND approved_at IS NULL
      AND (review_reason IS NULL OR (
        review_reason = btrim(review_reason)
        AND char_length(review_reason) BETWEEN 1 AND 500
      )))
  ),
  -- Retirar y ser reemplazada son la misma jubilación con distinto motivo, y
  -- las dos terminan en `replaced`. `replaced_by_id` responde «¿qué ocupó su
  -- lugar?», y en una revocación la respuesta honesta es «nada»: por eso es
  -- nullable y por eso no se inventa ninguna restauración de la anterior.
  CONSTRAINT tournament_team_photos_replace_check CHECK (
    (lifecycle_status = 'replaced' AND replaced_at IS NOT NULL)
    OR (lifecycle_status <> 'replaced' AND replaced_at IS NULL AND replaced_by_id IS NULL)
  ),
  CONSTRAINT tournament_team_photos_revoke_check CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL
      AND editorial_status = 'approved' AND lifecycle_status = 'replaced'
      AND replaced_by_id IS NULL)
  ),
  CONSTRAINT tournament_team_photos_remove_check CHECK (
    (lifecycle_status = 'removed' AND removed_at IS NOT NULL AND storage_purged_at IS NOT NULL)
    OR (lifecycle_status <> 'removed' AND removed_at IS NULL AND storage_purged_at IS NULL)
  ),
  CONSTRAINT tournament_team_photos_object_unique UNIQUE (bucket, object_path),
  CONSTRAINT tournament_team_photos_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT tournament_team_photos_entry_fk FOREIGN KEY (
    organization_id, tournament_id, team_entry_id
  ) REFERENCES public.tournament_team_entries(organization_id, tournament_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tournament_team_photos_uploaded_by_fk FOREIGN KEY (uploaded_by)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_team_photos_reviewed_by_fk FOREIGN KEY (reviewed_by)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_team_photos_revoked_by_fk FOREIGN KEY (revoked_by)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_team_photos_replaced_by_fk FOREIGN KEY (
    organization_id, replaced_by_id
  ) REFERENCES public.tournament_team_photos(organization_id, id)
    ON DELETE RESTRICT
);

-- Las dos invariantes del modelo, en la única capa que no se puede esquivar
-- con una carrera: como mucho una vigente y como mucho una candidata por
-- equipo. Que sean DOS índices y no uno es justamente la semántica pedida: la
-- candidata no le quita el lugar a la vigente. Retirar la vigente la saca de
-- `active` —`tournament_team_photos_revoke_check` lo exige—, así que el lugar
-- queda libre sin que el índice tenga que mirar `revoked_at`.
CREATE UNIQUE INDEX tournament_team_photos_one_current_idx
  ON public.tournament_team_photos(team_entry_id)
  WHERE lifecycle_status = 'active' AND editorial_status = 'approved';
-- `rejected` comparte el índice con `pending_review` porque comparte el lugar:
-- es la misma ranura de «lo último que subió el equipo», ahora con veredicto.
CREATE UNIQUE INDEX tournament_team_photos_one_candidate_idx
  ON public.tournament_team_photos(team_entry_id)
  WHERE lifecycle_status = 'active'
    AND editorial_status IN ('pending_review', 'rejected');
CREATE INDEX tournament_team_photos_entry_idx
  ON public.tournament_team_photos(organization_id, team_entry_id, created_at DESC);
CREATE INDEX tournament_team_photos_moderation_idx
  ON public.tournament_team_photos(
    organization_id, tournament_id, editorial_status, lifecycle_status
  );

COMMENT ON TABLE public.tournament_team_photos IS
  'Foto grupal del plantel, privada y moderada, propiedad de tournament_team_entries.id. Distinta del escudo: el escudo es marca pública, esto es una fotografía de personas.';
COMMENT ON COLUMN public.tournament_team_photos.object_path IS
  'Path interno e inmutable de Storage. Nunca se expone como ImageRef ni se persiste una URL firmada.';
COMMENT ON COLUMN public.tournament_team_photos.checksum_sha256 IS
  'SHA-256 de los bytes efectivamente almacenados, calculado por el Edge function. Obligatorio en todo estado desde el que la fila pueda mostrarse.';
COMMENT ON COLUMN public.tournament_team_photos.replaced_by_id IS
  'Qué foto ocupó su lugar. NULL en una revocación: retirar la vigente no promueve ninguna anterior.';

-- ---------------------------------------------------------------------------
-- 2. Quién ve qué
-- ---------------------------------------------------------------------------

-- La lectura tiene dos alcances distintos y confundirlos filtraría material sin
-- moderar: la foto VIGENTE la ve cualquiera que ya podía ver la inscripción
-- —incluido COLLABORATOR, que tiene `team_entries.read` y ninguna capability de
-- escritura—, más los miembros del equipo que la política habilite. La
-- CANDIDATA y la RECHAZADA las ven sólo quien las gestiona y quien las modera.
--
-- El actor viaja por parámetro porque el resolver corre en el Edge function con
-- credencial de servicio; `can_read_tournament_team_entry()` no sirve ahí
-- porque resuelve el actor con auth.uid().
CREATE OR REPLACE FUNCTION public.can_read_tournament_team_photo_as(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_actor_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.tournament_team_entries entry
      JOIN public.tournament_organizations organization
        ON organization.id = entry.organization_id
      JOIN public.tournaments tournament
        ON tournament.id = entry.tournament_id
       AND tournament.organization_id = entry.organization_id
      WHERE entry.id = p_team_entry_id
        AND entry.organization_id = p_organization_id
        AND entry.status <> 'archived'
        AND organization.status = 'active'
        AND tournament.status <> 'archived'
        AND (
          EXISTS (
            SELECT 1
            FROM public.tournament_organization_members membership
            WHERE membership.organization_id = p_organization_id
              AND membership.user_id = p_actor_user_id
              AND membership.status = 'active'
              AND 'team_entries.read' = ANY(
                public.tournament_role_capabilities(membership.role)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.tournament_team_managers manager
            WHERE manager.organization_id = p_organization_id
              AND manager.team_entry_id = entry.id
              AND manager.user_id = p_actor_user_id
              AND manager.status = 'active'
          )
        )
    )
    OR public.can_manage_tournament_team_visual_assets_as(
      p_organization_id, p_team_entry_id, p_actor_user_id, 'team_entries.update'
    )
  );
$$;

COMMENT ON FUNCTION public.can_read_tournament_team_photo_as(uuid, uuid, uuid) IS
  'Quién ve la foto VIGENTE de un equipo. La candidata y la rechazada exigen gestión o moderación, no esto.';

-- ---------------------------------------------------------------------------
-- 3. Subir
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_tournament_team_photo_upload(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_team_entry_id uuid,
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
  v_entry public.tournament_team_entries%ROWTYPE;
  v_photo_id uuid := gen_random_uuid();
  v_path text;
BEGIN
  IF NOT public.can_manage_tournament_team_visual_assets_as(
    p_organization_id, p_team_entry_id, p_actor_user_id, 'team_entries.update'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;
  IF p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
    OR p_byte_size NOT BETWEEN 1 AND 8388608
    OR p_width NOT BETWEEN 1 AND 12000
    OR p_height NOT BETWEEN 1 AND 12000
    OR p_width::bigint * p_height::bigint > 36000000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_TEAM_PHOTO_FILE_INVALID';
  END IF;

  SELECT * INTO v_entry
  FROM public.tournament_team_entries entry
  WHERE entry.organization_id = p_organization_id
    AND entry.id = p_team_entry_id;
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;

  v_path := 'organizations/' || p_organization_id::text
    || '/team-entries/' || p_team_entry_id::text
    || '/' || v_photo_id::text || '.' || CASE p_mime_type
      WHEN 'image/jpeg' THEN 'jpg'
      WHEN 'image/png' THEN 'png'
      WHEN 'image/webp' THEN 'webp'
    END;

  INSERT INTO public.tournament_team_photos (
    id, organization_id, tournament_id, team_entry_id, object_path, mime_type,
    byte_size, width, height, uploaded_by
  ) VALUES (
    v_photo_id, p_organization_id, v_entry.tournament_id, p_team_entry_id,
    v_path, p_mime_type, p_byte_size, p_width, p_height, p_actor_user_id
  );

  RETURN jsonb_build_object(
    'teamPhotoId', v_photo_id,
    'bucket', 'tournament-team-photos',
    'objectPath', v_path,
    'imageRef', jsonb_build_object(
      'kind', 'team_photo', 'id', v_photo_id, 'variant', 'original'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_tournament_team_photo_upload(
  p_actor_user_id uuid,
  p_team_photo_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.tournament_team_photos photo
  SET lifecycle_status = 'upload_failed', updated_at = now()
  WHERE photo.id = p_team_photo_id
    AND photo.uploaded_by = p_actor_user_id
    AND photo.lifecycle_status = 'upload_pending';
END;
$$;

-- Confirmar la carga NO toca la foto vigente. Lo único que jubila es la
-- candidata anterior —la que estaba esperando revisión, o la que quedó
-- rechazada—, porque es la misma ranura. Mientras la organización no apruebe,
-- el equipo sigue mostrando exactamente lo que mostraba antes.
CREATE OR REPLACE FUNCTION public.finalize_tournament_team_photo_upload(
  p_actor_user_id uuid,
  p_team_photo_id uuid,
  p_checksum_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_photo public.tournament_team_photos%ROWTYPE;
  v_previous_candidate_id uuid;
  v_current_id uuid;
BEGIN
  IF p_checksum_sha256 IS NULL OR p_checksum_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_TEAM_PHOTO_CHECKSUM_INVALID';
  END IF;
  SELECT * INTO v_photo
  FROM public.tournament_team_photos photo
  WHERE photo.id = p_team_photo_id
    AND photo.lifecycle_status = 'upload_pending'
  FOR UPDATE;
  IF v_photo.id IS NULL
    OR v_photo.uploaded_by IS DISTINCT FROM p_actor_user_id
    OR NOT public.can_manage_tournament_team_visual_assets_as(
      v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id,
      'team_entries.update'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;

  -- El equipo es el recurso que se serializa: dos cargas simultáneas del mismo
  -- equipo se ordenan acá y no en el índice único.
  PERFORM 1 FROM public.tournament_team_entries entry
  WHERE entry.id = v_photo.team_entry_id FOR UPDATE;

  SELECT photo.id INTO v_previous_candidate_id
  FROM public.tournament_team_photos photo
  WHERE photo.team_entry_id = v_photo.team_entry_id
    AND photo.lifecycle_status = 'active'
    AND photo.editorial_status IN ('pending_review', 'rejected')
  FOR UPDATE;

  IF v_previous_candidate_id IS NOT NULL THEN
    UPDATE public.tournament_team_photos
    SET lifecycle_status = 'replaced', replaced_by_id = v_photo.id,
        replaced_at = now(), updated_at = now()
    WHERE id = v_previous_candidate_id;
  END IF;

  SELECT photo.id INTO v_current_id
  FROM public.tournament_team_photos photo
  WHERE photo.team_entry_id = v_photo.team_entry_id
    AND photo.lifecycle_status = 'active'
    AND photo.editorial_status = 'approved';

  UPDATE public.tournament_team_photos
  SET lifecycle_status = 'active', checksum_sha256 = p_checksum_sha256,
      updated_at = now()
  WHERE id = v_photo.id;

  INSERT INTO public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, team_entry_id, tournament_id, metadata
  ) VALUES (
    v_photo.organization_id, p_actor_user_id, 'user', 'team_photo.uploaded',
    'team_photo', v_photo.id, v_photo.team_entry_id, v_photo.tournament_id,
    jsonb_build_object(
      'replacedCandidateId', v_previous_candidate_id,
      'currentTeamPhotoId', v_current_id,
      'checksumSha256', p_checksum_sha256
    )
  );

  RETURN jsonb_build_object(
    'imageRef', jsonb_build_object(
      'kind', 'team_photo', 'id', v_photo.id, 'variant', 'original'
    ),
    'editorialStatus', 'pending_review',
    'replacedCandidateId', v_previous_candidate_id,
    -- Que la vigente siga siendo la vigente no es un detalle de implementación:
    -- es la promesa del producto, y viaja en la respuesta para que la pantalla
    -- lo pueda afirmar sin recalcularlo.
    'currentTeamPhotoId', v_current_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Moderar
-- ---------------------------------------------------------------------------

-- Aprobar es el único punto donde la vigente cambia, y cambia entera dentro de
-- una transacción: la anterior se jubila y la candidata queda vigente, o no
-- pasa ninguna de las dos cosas. Rechazar no toca la vigente en absoluto.
CREATE OR REPLACE FUNCTION public.set_tournament_team_photo_editorial_status(
  p_organization_id uuid,
  p_team_photo_id uuid,
  p_editorial_status text,
  p_review_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_photo public.tournament_team_photos%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_review_reason, '')), '');
  v_previous_current_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF p_editorial_status NOT IN ('approved', 'rejected')
    OR (p_editorial_status = 'approved' AND v_reason IS NOT NULL)
    OR (v_reason IS NOT NULL AND char_length(v_reason) > 500)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_TEAM_PHOTO_STATE_INVALID';
  END IF;

  SELECT * INTO v_photo
  FROM public.tournament_team_photos photo
  WHERE photo.id = p_team_photo_id
    AND photo.organization_id = p_organization_id
    AND photo.lifecycle_status = 'active'
    AND photo.editorial_status = 'pending_review'
  FOR UPDATE;
  -- Una fila que no existe, que ya tiene veredicto o que está en otro estado no
  -- se distingue de una prohibida: las dos respuestas son la misma puerta
  -- cerrada, y separarlas sería contar qué hay del otro lado.
  IF v_photo.id IS NULL OR NOT public.can_moderate_tournament_team_visual_assets_as(
    p_organization_id, v_photo.team_entry_id, auth.uid(), 'team_entries.update'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;

  PERFORM 1 FROM public.tournament_team_entries entry
  WHERE entry.id = v_photo.team_entry_id FOR UPDATE;

  IF p_editorial_status = 'approved' THEN
    SELECT photo.id INTO v_previous_current_id
    FROM public.tournament_team_photos photo
    WHERE photo.team_entry_id = v_photo.team_entry_id
      AND photo.lifecycle_status = 'active'
      AND photo.editorial_status = 'approved'
    FOR UPDATE;

    IF v_previous_current_id IS NOT NULL THEN
      UPDATE public.tournament_team_photos
      SET lifecycle_status = 'replaced', replaced_by_id = v_photo.id,
          replaced_at = now(), updated_at = now()
      WHERE id = v_previous_current_id;
    END IF;

    UPDATE public.tournament_team_photos
    SET editorial_status = 'approved', reviewed_by = auth.uid(),
        reviewed_at = now(), approved_at = now(), updated_at = now()
    WHERE id = p_team_photo_id;
  ELSE
    UPDATE public.tournament_team_photos
    SET editorial_status = 'rejected', reviewed_by = auth.uid(),
        reviewed_at = now(), review_reason = v_reason, updated_at = now()
    WHERE id = p_team_photo_id;
  END IF;

  PERFORM public.append_tournament_audit(
    p_organization_id,
    CASE WHEN p_editorial_status = 'approved'
      THEN 'team_photo.approved' ELSE 'team_photo.rejected' END,
    'team_photo', p_team_photo_id, v_photo.team_entry_id, v_photo.tournament_id,
    jsonb_build_object(
      'editorialStatus', p_editorial_status,
      'reviewReason', v_reason,
      'replacedTeamPhotoId', v_previous_current_id
    )
  );

  RETURN jsonb_build_object(
    'teamPhotoId', p_team_photo_id,
    'editorialStatus', p_editorial_status,
    'reviewReason', v_reason,
    'replacedTeamPhotoId', v_previous_current_id
  );
END;
$$;

-- Retirar la vigente. No promueve ninguna anterior: una foto jubilada es
-- historia cerrada y no vuelve. El equipo cae al fallback —su escudo— hasta que
-- alguien suba otra y la organización la apruebe.
CREATE OR REPLACE FUNCTION public.revoke_tournament_team_photo(
  p_organization_id uuid,
  p_team_photo_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_photo public.tournament_team_photos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  SELECT * INTO v_photo
  FROM public.tournament_team_photos photo
  WHERE photo.id = p_team_photo_id
    AND photo.organization_id = p_organization_id
    AND photo.lifecycle_status = 'active'
    AND photo.editorial_status = 'approved'
  FOR UPDATE;
  IF v_photo.id IS NULL OR NOT public.can_moderate_tournament_team_visual_assets_as(
    p_organization_id, v_photo.team_entry_id, auth.uid(), 'team_entries.update'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;

  UPDATE public.tournament_team_photos
  SET lifecycle_status = 'replaced', replaced_at = now(), replaced_by_id = NULL,
      revoked_at = now(), revoked_by = auth.uid(), updated_at = now()
  WHERE id = p_team_photo_id;

  PERFORM public.append_tournament_audit(
    p_organization_id, 'team_photo.revoked', 'team_photo', p_team_photo_id,
    v_photo.team_entry_id, v_photo.tournament_id, '{}'::jsonb
  );

  RETURN jsonb_build_object('teamPhotoId', p_team_photo_id, 'revoked', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Dar de baja el objeto
-- ---------------------------------------------------------------------------

-- Bajar la candidata propia es gestión: quien la subió puede arrepentirse antes
-- de que nadie la mire. Bajar la vigente es moderación, igual que aprobarla.
CREATE OR REPLACE FUNCTION public.begin_tournament_team_photo_delete(
  p_actor_user_id uuid,
  p_team_photo_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_photo public.tournament_team_photos%ROWTYPE;
  v_is_current boolean;
BEGIN
  SELECT * INTO v_photo
  FROM public.tournament_team_photos photo
  WHERE photo.id = p_team_photo_id
    AND photo.lifecycle_status IN ('active', 'delete_pending')
  FOR UPDATE;
  IF v_photo.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;
  v_is_current := v_photo.editorial_status = 'approved';
  IF NOT (
    CASE WHEN v_is_current
      THEN public.can_moderate_tournament_team_visual_assets_as(
        v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id,
        'team_entries.update')
      ELSE public.can_manage_tournament_team_visual_assets_as(
        v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id,
        'team_entries.update')
    END
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;
  IF v_photo.lifecycle_status = 'active' THEN
    UPDATE public.tournament_team_photos
    SET lifecycle_status = 'delete_pending', updated_at = now()
    WHERE id = p_team_photo_id;
  END IF;
  RETURN jsonb_build_object(
    'bucket', v_photo.bucket, 'objectPath', v_photo.object_path
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tournament_team_photo_delete(
  p_actor_user_id uuid,
  p_team_photo_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_photo public.tournament_team_photos%ROWTYPE;
BEGIN
  SELECT * INTO v_photo
  FROM public.tournament_team_photos photo
  WHERE photo.id = p_team_photo_id
    AND photo.lifecycle_status = 'delete_pending'
  FOR UPDATE;
  IF v_photo.id IS NULL OR NOT (
    public.can_manage_tournament_team_visual_assets_as(
      v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id,
      'team_entries.update')
    OR public.can_moderate_tournament_team_visual_assets_as(
      v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id,
      'team_entries.update')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;
  UPDATE public.tournament_team_photos
  SET lifecycle_status = 'removed', removed_at = now(),
      storage_purged_at = now(), updated_at = now()
  WHERE id = p_team_photo_id;
  INSERT INTO public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, team_entry_id, tournament_id, metadata
  ) VALUES (
    v_photo.organization_id, p_actor_user_id, 'user', 'team_photo.removed',
    'team_photo', v_photo.id, v_photo.team_entry_id, v_photo.tournament_id,
    jsonb_build_object('editorialStatus', v_photo.editorial_status)
  );
  RETURN jsonb_build_object('teamPhotoId', p_team_photo_id, 'deleted', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Leer
-- ---------------------------------------------------------------------------

-- El resolver del Edge function. Fail-closed en las dos preguntas: qué audiencia
-- está habilitada, y si este actor puede ver ESTA fila en el estado en que está.
-- `public_page` y `social_export` no están habilitadas y por eso no figuran.
CREATE OR REPLACE FUNCTION public.authorize_tournament_team_photo_read(
  p_actor_user_id uuid,
  p_team_photo_id uuid,
  p_variant text,
  p_audience text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_photo public.tournament_team_photos%ROWTYPE;
  v_allowed boolean;
BEGIN
  IF p_variant <> 'original' OR p_audience <> 'authenticated_team' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_AUDIENCE_DISABLED';
  END IF;
  SELECT * INTO v_photo
  FROM public.tournament_team_photos photo
  WHERE photo.id = p_team_photo_id
    AND photo.lifecycle_status = 'active';
  IF v_photo.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;
  v_allowed := CASE v_photo.editorial_status
    -- Vigente: la ve quien ya veía la inscripción.
    WHEN 'approved' THEN public.can_read_tournament_team_photo_as(
      v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id)
    -- Candidata y rechazada: sólo quien gestiona o quien modera. Nadie más
    -- recibe una firma de material sin publicar.
    ELSE public.can_manage_tournament_team_visual_assets_as(
      v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id,
      'team_entries.update')
      OR public.can_moderate_tournament_team_visual_assets_as(
        v_photo.organization_id, v_photo.team_entry_id, p_actor_user_id,
        'team_entries.update')
  END;
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;
  RETURN jsonb_build_object(
    'bucket', v_photo.bucket, 'objectPath', v_photo.object_path,
    'mimeType', v_photo.mime_type, 'width', v_photo.width,
    'height', v_photo.height, 'audience', p_audience
  );
END;
$$;

-- Una sola lectura por equipo: la vigente, la candidata si el que mira puede
-- verla, y las dos capabilities que gobiernan los botones. Devuelve `ImageRef`
-- y nunca bucket, path ni URL firmada.
CREATE OR REPLACE FUNCTION public.get_tournament_team_photo_state(
  p_organization_id uuid,
  p_team_entry_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_can_manage boolean;
  v_can_moderate boolean;
  v_current public.tournament_team_photos%ROWTYPE;
  v_candidate public.tournament_team_photos%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.can_read_tournament_team_photo_as(
    p_organization_id, p_team_entry_id, v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_TEAM_PHOTO_FORBIDDEN';
  END IF;
  v_can_manage := public.can_manage_tournament_team_visual_assets_as(
    p_organization_id, p_team_entry_id, v_actor, 'team_entries.update');
  v_can_moderate := public.can_moderate_tournament_team_visual_assets_as(
    p_organization_id, p_team_entry_id, v_actor, 'team_entries.update');

  SELECT * INTO v_current FROM public.tournament_team_photos photo
  WHERE photo.organization_id = p_organization_id
    AND photo.team_entry_id = p_team_entry_id
    AND photo.lifecycle_status = 'active'
    AND photo.editorial_status = 'approved';

  IF v_can_manage OR v_can_moderate THEN
    SELECT * INTO v_candidate FROM public.tournament_team_photos photo
    WHERE photo.organization_id = p_organization_id
      AND photo.team_entry_id = p_team_entry_id
      AND photo.lifecycle_status = 'active'
      AND photo.editorial_status IN ('pending_review', 'rejected');
  END IF;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'teamEntryId', p_team_entry_id,
    'canManage', v_can_manage,
    'canModerate', v_can_moderate,
    'current', CASE WHEN v_current.id IS NULL THEN NULL ELSE jsonb_build_object(
      'teamPhotoId', v_current.id,
      'ref', jsonb_build_object(
        'kind', 'team_photo', 'id', v_current.id, 'variant', 'original'),
      'width', v_current.width, 'height', v_current.height,
      'approvedAt', v_current.approved_at, 'updatedAt', v_current.updated_at
    ) END,
    'candidate', CASE WHEN v_candidate.id IS NULL THEN NULL ELSE jsonb_build_object(
      'teamPhotoId', v_candidate.id,
      'ref', jsonb_build_object(
        'kind', 'team_photo', 'id', v_candidate.id, 'variant', 'original'),
      'width', v_candidate.width, 'height', v_candidate.height,
      'editorialStatus', v_candidate.editorial_status,
      'reviewReason', v_candidate.review_reason,
      'createdAt', v_candidate.created_at, 'updatedAt', v_candidate.updated_at
    ) END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS y grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.tournament_team_photos ENABLE ROW LEVEL SECURITY;

-- La policy sólo deja ver la fila VIGENTE. Todo lo demás —candidata, rechazada,
-- jubilada— viaja únicamente por get_tournament_team_photo_state(), que sabe
-- distinguir quién gestiona de quién solamente mira.
CREATE POLICY tournament_team_photos_read_current
ON public.tournament_team_photos FOR SELECT TO authenticated
USING (
  lifecycle_status = 'active'
  AND editorial_status = 'approved'
  AND public.can_read_tournament_team_photo_as(
    organization_id, team_entry_id, auth.uid()
  )
);

REVOKE ALL ON TABLE public.tournament_team_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, organization_id, tournament_id, team_entry_id, mime_type, byte_size,
  width, height, checksum_sha256, editorial_status, lifecycle_status,
  uploaded_by, reviewed_by, created_at, updated_at, reviewed_at, approved_at
) ON public.tournament_team_photos TO authenticated;
GRANT ALL ON TABLE public.tournament_team_photos TO service_role;

-- Mismo criterio que 1C.2A y 1C.3A: los helpers con actor por parámetro son
-- service-only. Respondérselos al navegador sería un oráculo —«¿el usuario X ve
-- el equipo Y?»— sobre gente y equipos de los que el que pregunta no es parte.
REVOKE ALL ON FUNCTION public.can_read_tournament_team_photo_as(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_tournament_team_photo_upload(uuid, uuid, uuid, text, bigint, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_tournament_team_photo_upload(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_tournament_team_photo_upload(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_tournament_team_photo_read(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_tournament_team_photo_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tournament_team_photo_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tournament_team_photo_editorial_status(uuid, uuid, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_tournament_team_photo(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_tournament_team_photo_state(uuid, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_read_tournament_team_photo_as(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.request_tournament_team_photo_upload(uuid, uuid, uuid, text, bigint, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_tournament_team_photo_upload(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_tournament_team_photo_upload(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_tournament_team_photo_read(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_tournament_team_photo_delete(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tournament_team_photo_delete(uuid, uuid)
  TO service_role;
-- Las dos operaciones editoriales resuelven el actor con auth.uid(), así que
-- `authenticated` las puede llamar sin que el actor sea un parámetro que
-- alguien pueda falsear.
GRANT EXECUTE ON FUNCTION public.set_tournament_team_photo_editorial_status(uuid, uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_tournament_team_photo(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_team_photo_state(uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. El bucket
-- ---------------------------------------------------------------------------

-- Privado, igual que el retrato y por la misma razón: es una fotografía de
-- personas identificables. El escudo vive en `tournament-branding`, que sí es
-- público, y esa diferencia es exactamente la que justifica dos assets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tournament-team-photos', 'tournament-team-photos', false,
  8388608, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Sin policies de storage.objects para `authenticated`, a propósito: todos los
-- paths se derivan y todas las escrituras y firmas pasan por el Edge function
-- después de que la base autorizó.
DROP POLICY IF EXISTS tournament_team_photos_select ON storage.objects;
DROP POLICY IF EXISTS tournament_team_photos_insert ON storage.objects;
DROP POLICY IF EXISTS tournament_team_photos_update ON storage.objects;
DROP POLICY IF EXISTS tournament_team_photos_delete ON storage.objects;

COMMIT;
