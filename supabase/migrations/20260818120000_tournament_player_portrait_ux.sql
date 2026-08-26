BEGIN;

-- Multimedia 1C.2B: superficie mínima para que Plantel pueda consumir la
-- infraestructura de 1C.2A. No cambia el bucket, el ciclo de vida, las
-- audiencias ni el contrato de consentimiento: agrega el escritor que le
-- faltaba al encuadre y una lectura por equipo para no resolver la fila jugador
-- por jugador desde el navegador.

-- El encuadre que el usuario acomoda son tres fracciones: el punto focal —el
-- punto de la foto que queda en el centro del marco— y el zoom. 1C.2A ya tenía
-- las dos primeras columnas; la tercera es la única extensión del modelo, y es
-- aditiva: `1.0` significa «lo más lejos que se puede ir sin dejar un hueco»,
-- así que toda fila existente ya está descrita correctamente por el default.
--
-- El zoom se mide contra ese mínimo y no contra el tamaño original justamente
-- para que no dependa del viewport: la misma terna reconstruye el encuadre en
-- el editor grande, en el avatar de 42 px y después de recargar. Nunca se
-- persiste un píxel.
ALTER TABLE public.tournament_player_portraits
  ADD COLUMN IF NOT EXISTS crop_zoom numeric(6,4) NOT NULL DEFAULT 1.0;

-- El techo es el mismo que ofrece la UI: 4× sobre el mínimo que cubre el marco.
-- Es un límite de producto —más que eso ya es interpolación visible— y el
-- servidor no acepta lo que la interfaz no ofrece.
DO $$
BEGIN
  ALTER TABLE public.tournament_player_portraits
    ADD CONSTRAINT tournament_player_portraits_crop_zoom_check
    CHECK (crop_zoom BETWEEN 1 AND 4);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.tournament_player_portraits.crop_zoom IS
  'Escala del encuadre relativa al mínimo que cubre el marco (1.0 = cubrir exacto). Metadata: no recorta ni reescribe el objeto de Storage.';

-- 1C.2A creó `focal_x`/`focal_y` con default 0.5 y ninguna operación capaz de
-- escribirlas. El encuadre es metadata, no un recorte: nunca toca los píxeles
-- ni el objeto de Storage, así que vive fuera del pipeline de carga y puede
-- ajustarse sobre un retrato ya activo.

-- Escribir el punto focal sin el zoom sería un encuadre a medias, así que la
-- operación es una sola y con los tres valores. La forma de cuatro argumentos
-- —de la primera pasada de esta misma fase, nunca publicada— no sobrevive:
-- dejarla habilitada permitiría guardar medio encuadre.
DROP FUNCTION IF EXISTS public.set_tournament_player_portrait_focal_point(
  uuid, uuid, numeric, numeric
);
CREATE OR REPLACE FUNCTION public.set_tournament_player_portrait_crop(
  p_organization_id uuid,
  p_portrait_id uuid,
  p_focal_x numeric,
  p_focal_y numeric,
  p_zoom numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portrait public.tournament_player_portraits%ROWTYPE;
  v_focal_x numeric(5,4);
  v_focal_y numeric(5,4);
  v_zoom numeric(6,4);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF p_focal_x IS NULL OR p_focal_y IS NULL
    OR p_focal_x < 0 OR p_focal_x > 1
    OR p_focal_y < 0 OR p_focal_y > 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_PORTRAIT_FOCAL_INVALID';
  END IF;
  IF p_zoom IS NULL OR p_zoom < 1 OR p_zoom > 4 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_PORTRAIT_ZOOM_INVALID';
  END IF;
  v_focal_x := round(p_focal_x, 4);
  v_focal_y := round(p_focal_y, 4);
  v_zoom := round(p_zoom, 4);

  SELECT * INTO v_portrait FROM public.tournament_player_portraits
  WHERE id = p_portrait_id AND organization_id = p_organization_id
    AND lifecycle_status = 'active' FOR UPDATE;
  IF v_portrait.id IS NULL OR NOT public.can_manage_tournament_player_portrait_as(
    p_organization_id, v_portrait.roster_player_id, auth.uid()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;

  UPDATE public.tournament_player_portraits
  SET focal_x = v_focal_x, focal_y = v_focal_y, crop_zoom = v_zoom, updated_at = now()
  WHERE id = p_portrait_id;

  PERFORM public.append_tournament_audit(
    p_organization_id, 'portrait.crop_updated', 'player_portrait', p_portrait_id,
    v_portrait.team_entry_id, v_portrait.tournament_id,
    jsonb_build_object(
      'rosterPlayerId', v_portrait.roster_player_id,
      'focalX', v_focal_x, 'focalY', v_focal_y, 'cropZoom', v_zoom
    )
  );
  RETURN jsonb_build_object(
    'portraitId', p_portrait_id, 'focalX', v_focal_x, 'focalY', v_focal_y,
    'cropZoom', v_zoom
  );
END;
$$;

-- Plantel necesita, en una sola lectura, saber por cada jugador del equipo si
-- hay retrato activo y si este actor puede administrarlo. Devolver la capacidad
-- desde el mismo predicado que después autoriza la escritura es lo que impide
-- pintar un botón que el servidor va a rechazar. No expone bucket, path ni URL:
-- sólo el `ImageRef` durable de 1C.2A.
CREATE OR REPLACE FUNCTION public.list_tournament_player_portrait_refs(
  p_organization_id uuid,
  p_team_entry_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.can_read_tournament_team_entry(
    p_organization_id, p_team_entry_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PORTRAIT_FORBIDDEN';
  END IF;
  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'teamEntryId', p_team_entry_id,
    'players', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'rosterPlayerId', player.id,
        'canManage', public.can_manage_tournament_player_portrait_as(
          p_organization_id, player.id, v_actor
        ),
        'portrait', (
          SELECT CASE WHEN public.can_read_tournament_player_portrait_as(
            p_organization_id, player.id, v_actor
          ) THEN jsonb_build_object(
            'ref', jsonb_build_object(
              'kind', 'player_portrait', 'id', portrait.id, 'variant', 'original'
            ),
            'focalX', portrait.focal_x,
            'focalY', portrait.focal_y,
            'cropZoom', portrait.crop_zoom,
            'width', portrait.width,
            'height', portrait.height,
            'editorialStatus', portrait.editorial_status,
            'publicationConsent', portrait.publication_consent,
            'updatedAt', portrait.updated_at
          ) END
          FROM public.tournament_player_portraits portrait
          WHERE portrait.organization_id = p_organization_id
            AND portrait.roster_player_id = player.id
            AND portrait.lifecycle_status = 'active'
        )
      ) ORDER BY player.shirt_number NULLS LAST, player.display_name)
      FROM public.tournament_roster_players player
      WHERE player.organization_id = p_organization_id
        AND player.team_entry_id = p_team_entry_id
        AND player.status = 'active'
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.set_tournament_player_portrait_crop(uuid, uuid, numeric, numeric, numeric) IS
  'Encuadre no destructivo del retrato activo: punto focal y zoom normalizados. No modifica el objeto de Storage ni el estado editorial o de consentimiento.';
COMMENT ON FUNCTION public.list_tournament_player_portrait_refs(uuid, uuid) IS
  'ImageRef y capability real por jugador del plantel. Nunca devuelve bucket, object_path ni URL firmada.';

REVOKE ALL ON FUNCTION public.set_tournament_player_portrait_crop(uuid, uuid, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_tournament_player_portrait_refs(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tournament_player_portrait_crop(uuid, uuid, numeric, numeric, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_tournament_player_portrait_refs(uuid, uuid)
  TO authenticated, service_role;

COMMIT;
