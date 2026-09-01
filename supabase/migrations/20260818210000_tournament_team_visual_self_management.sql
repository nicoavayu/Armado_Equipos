BEGIN;

-- Multimedia 1C.3A — Autogestión visual del equipo / Policy foundation.
--
-- El organizador no puede cargar a mano el escudo y las fotos de cientos de
-- equipos, así que necesita poder delegar ese trabajo. Lo que esta migración
-- agrega es exactamente eso y nada más: una política por torneo que AMPLÍA
-- permisos hacia miembros del equipo, y un único predicado que la responde.
--
-- Dos invariantes que el resto del archivo respeta sin excepción:
--
--   1. La organización conserva siempre el control total. La política nunca le
--      quita nada a quien ya tiene la capability correspondiente.
--   2. Cada usuario habilitado gestiona únicamente SU equipo. La política no
--      es un permiso sobre el torneo: se evalúa contra un team_entry concreto.
--
-- Y una separación que no se toca: poder subir una foto no es poder publicarla.
-- El estado editorial, el consentimiento y las audiencias pública/social siguen
-- siendo de la organización y siguen siendo fail-closed.

-- ---------------------------------------------------------------------------
-- 1. La política, persistente y por torneo
-- ---------------------------------------------------------------------------

-- El default es el valor cerrado: aplicar esta migración no le da acceso a
-- nadie que no lo tuviera por capability de organización. Habilitar la
-- autogestión es una decisión explícita del organizador, torneo por torneo.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS team_visual_management_policy text
  NOT NULL DEFAULT 'organization_only';

DO $$
BEGIN
  ALTER TABLE public.tournaments
    ADD CONSTRAINT tournaments_team_visual_management_policy_check
    CHECK (team_visual_management_policy IN (
      'organization_only', 'delegates', 'roster'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.tournaments.team_visual_management_policy IS
  'Quién puede mantener los recursos visuales de cada equipo. Sólo amplía permisos hacia miembros del propio equipo; la organización conserva el control total en los tres valores.';

-- ---------------------------------------------------------------------------
-- 2. La relación «este usuario juega en este equipo»
-- ---------------------------------------------------------------------------

-- La identidad es la misma que usa get_my_current_tournament_roster_players()
-- —cuenta Arma2 vinculada, o jugador provisional reclamado—, con el actor como
-- parámetro porque los predicados de retrato se evalúan también en nombre de
-- otro usuario. Lo que cambia es qué plantel cuenta como el vigente.
--
-- get_my_current_tournament_roster_players() exige `approved`/`locked` porque
-- responde una pregunta DEPORTIVA: quién puede ser convocado. Para eso el
-- plantel tiene que estar cerrado por la organización. Ésta es otra pregunta
-- —«¿este usuario juega hoy en este equipo?»— y atarla al cierre deportivo deja
-- la autogestión inservible justo cuando sirve: mientras el equipo se está
-- armando y todavía no hay ni escudo ni fotos.
--
-- El plantel vigente es la última versión del roster del equipo. Una sola por
-- team_entry en el modelo actual (`create_tournament_team_entry` inserta la
-- versión 1 y ninguna ruta inserta otra), y el mismo `order by version desc
-- limit 1` que ya usa get_team_registration_context para decidir cuál mostrar.
-- `superseded` queda excluido explícitamente: es la marca de versión histórica,
-- y un plantel histórico no habilita a nadie.
--
-- Lo que esto NO amplía, porque el modelo ya lo cierra aguas arriba:
--   * a un jugador se lo agrega sólo con el roster en `draft`/`changes_requested`
--     (add_tournament_roster_player) y sólo con can_edit_tournament_team_entry,
--     o sea capability de organización o capitán/delegado del equipo: nadie se
--     agrega a sí mismo;
--   * `player.status = 'active'` deja fuera a los removidos;
--   * una invitación o una solicitud no aceptada no es una fila de roster;
--   * un provisional SIN reclamar no entra por ninguna de las dos ramas: no hay
--     identidad autenticable a la que darle un permiso.
CREATE OR REPLACE FUNCTION public.is_tournament_team_roster_member_as(
  p_team_entry_id uuid,
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
    WHERE player.team_entry_id = p_team_entry_id
      AND player.status = 'active'
      AND player.roster_id = (
        SELECT roster.id
        FROM public.tournament_rosters roster
        WHERE roster.team_entry_id = p_team_entry_id
          AND roster.status <> 'superseded'
        ORDER BY roster.version DESC
        LIMIT 1
      )
      AND (
        player.arma2_user_id = p_actor_user_id
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

COMMENT ON FUNCTION public.is_tournament_team_roster_member_as(uuid, uuid) IS
  'Vínculo autenticable entre un usuario y el plantel vigente de un equipo: fila activa en la última versión no superseded del roster, con cuenta Arma2 vinculada o provisional reclamado.';

-- ---------------------------------------------------------------------------
-- 3. La fuente de verdad
-- ---------------------------------------------------------------------------

-- Escudo y retrato hacían cada uno su propia cuenta de quién manda. Acá hay una
-- sola respuesta a «¿este actor puede gestionar los recursos visuales de este
-- equipo?», y cada asset le agrega después sus restricciones propias (la
-- ventana de estados del escudo, el ciclo de vida del retrato).
--
-- La capability de organización viaja como parámetro porque no es la misma en
-- los dos assets —el escudo es dato del equipo, el retrato es dato del plantel—
-- y respetar la capability real es justamente lo que mantiene a COLLABORATOR
-- fuera: su rol no tiene ninguna de las dos.
--
-- Sobre los estados de la inscripción hay DOS gates, y son distintos a propósito:
--
--   * `entry.status <> 'archived'` está en el WHERE exterior, o sea que corre
--     ANTES de abrir las ramas y alcanza a las tres —incluida la de
--     organización—. Una inscripción archivada es historia cerrada: ni el
--     owner de la organización le edita el escudo ni le toca el retrato. Por
--     eso `archived` NO figura en la lista de la rama de autogestión: ya quedó
--     afuera arriba, y repetirlo ahí sugeriría que el override lo salvaría.
--   * `entry.status NOT IN ('rejected', 'withdrawn')` está adentro de la rama
--     de autogestión y sólo la limita a ella. Ahí sí la organización conserva
--     el alcance que ya tenía: una inscripción rechazada o retirada sigue
--     siendo administrable por la organización, pero deja de habilitar a los
--     miembros del equipo.
--
-- El mismo `entry.status <> 'archived'` exterior gobierna la moderación más
-- abajo, con idéntico alcance.
CREATE OR REPLACE FUNCTION public.can_manage_tournament_team_visual_assets_as(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_actor_user_id uuid,
  p_organization_capability text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor_user_id IS NOT NULL
    -- El parámetro es interno, pero se valida igual: una capability arbitraria
    -- no puede convertirse en una llave nueva.
    AND p_organization_capability IN ('team_entries.update', 'roster_players.update')
    AND EXISTS (
      SELECT 1
      FROM public.tournament_team_entries entry
      JOIN public.tournament_organizations organization
        ON organization.id = entry.organization_id
      JOIN public.tournaments tournament
        ON tournament.id = entry.tournament_id
       AND tournament.organization_id = entry.organization_id
      -- El par (organización, equipo) se valida en el WHERE: un team_entry_id
      -- de otro tenant no se vuelve alcanzable cambiando el organization_id.
      WHERE entry.id = p_team_entry_id
        AND entry.organization_id = p_organization_id
        AND entry.status <> 'archived'
        AND organization.status = 'active'
        AND tournament.status <> 'archived'
        AND (
          -- Rama 1: la organización. Independiente de la política.
          EXISTS (
            SELECT 1
            FROM public.tournament_organization_members membership
            WHERE membership.organization_id = p_organization_id
              AND membership.user_id = p_actor_user_id
              AND membership.status = 'active'
              AND p_organization_capability = ANY(
                public.tournament_role_capabilities(membership.role)
              )
          )
          -- Ramas 2 y 3: miembros de ESTE equipo. Las dos exigen además que la
          -- inscripción siga viva: una inscripción rechazada o retirada ya no
          -- es un equipo del torneo, y mantenerle la autogestión sería dejar
          -- permisos colgando de un vínculo que la organización ya cerró. La
          -- rama de organización no pasa por acá: conserva el alcance que ya
          -- tenía y sigue siendo el override.
          OR (
            entry.status NOT IN ('rejected', 'withdrawn')
            AND (
              -- Rama 2: responsables. `captain` y `delegate` son roles reales
              -- de tournament_team_managers; `assistant` no entra.
              (
                tournament.team_visual_management_policy IN ('delegates', 'roster')
                AND EXISTS (
                  SELECT 1
                  FROM public.tournament_team_managers manager
                  WHERE manager.organization_id = entry.organization_id
                    AND manager.team_entry_id = entry.id
                    AND manager.user_id = p_actor_user_id
                    AND manager.status = 'active'
                    AND manager.role IN ('captain', 'delegate')
                )
              )
              -- Rama 3: el plantel.
              OR (
                tournament.team_visual_management_policy = 'roster'
                AND public.is_tournament_team_roster_member_as(entry.id, p_actor_user_id)
              )
            )
          )
        )
    );
$$;

COMMENT ON FUNCTION public.can_manage_tournament_team_visual_assets_as(uuid, uuid, uuid, text) IS
  'Fuente de verdad de la autogestión visual: organización siempre, más los miembros del propio equipo que la política del torneo habilite.';

-- La moderación no es autogestión. Este predicado se queda con la rama de
-- organización sola y es el que gobierna estado editorial y consentimiento:
-- habilitar que un equipo cargue su foto nunca puede habilitarlo a aprobarla.
CREATE OR REPLACE FUNCTION public.can_moderate_tournament_team_visual_assets_as(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_actor_user_id uuid,
  p_organization_capability text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor_user_id IS NOT NULL
    AND p_organization_capability IN ('team_entries.update', 'roster_players.update')
    AND EXISTS (
      SELECT 1
      FROM public.tournament_team_entries entry
      JOIN public.tournament_organizations organization
        ON organization.id = entry.organization_id
      JOIN public.tournaments tournament
        ON tournament.id = entry.tournament_id
       AND tournament.organization_id = entry.organization_id
      JOIN public.tournament_organization_members membership
        ON membership.organization_id = entry.organization_id
       AND membership.user_id = p_actor_user_id
       AND membership.status = 'active'
      WHERE entry.id = p_team_entry_id
        AND entry.organization_id = p_organization_id
        AND entry.status <> 'archived'
        AND organization.status = 'active'
        AND tournament.status <> 'archived'
        AND p_organization_capability = ANY(
          public.tournament_role_capabilities(membership.role)
        )
    );
$$;

COMMENT ON FUNCTION public.can_moderate_tournament_team_visual_assets_as(uuid, uuid, uuid, text) IS
  'Rama de organización sola. Gobierna moderación y consentimiento, que la autogestión no amplía en ningún valor de la política.';

-- ---------------------------------------------------------------------------
-- 4. El escudo pasa por la política
-- ---------------------------------------------------------------------------

-- 1C.1 le daba al capitán/delegado acceso incondicional al escudo. Ahora ese
-- acceso lo concede la política, y el default `organization_only` lo deja
-- cerrado hasta que el organizador lo habilite.
--
-- La ventana de estados se conserva tal cual: el branding sigue siendo mutable
-- después de la aprobación deportiva, y cambiar un escudo no reabre inscripción
-- ni toca el freeze. Reemplazar este único predicado alcanza para que la RPC,
-- la validación de path y las cuatro policies de Storage queden alineadas.
CREATE OR REPLACE FUNCTION public.can_update_tournament_team_branding(
  p_organization_id uuid,
  p_team_entry_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_team_entries entry
    WHERE entry.id = p_team_entry_id
      AND entry.organization_id = p_organization_id
      AND entry.status IN (
        'draft', 'invited', 'in_progress', 'changes_requested', 'approved'
      )
  ) AND public.can_manage_tournament_team_visual_assets_as(
    p_organization_id, p_team_entry_id, auth.uid(), 'team_entries.update'
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. El retrato pasa por la misma política
-- ---------------------------------------------------------------------------

-- El retrato cuelga de un roster_player; la política se evalúa contra el equipo
-- de ese jugador. Todo lo que 1C.2A/1C.2B construyeron encima —alta, encuadre,
-- baja, resolver privado— hereda la decisión sin cambiar de forma.
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
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_roster_players player
    WHERE player.organization_id = p_organization_id
      AND player.id = p_roster_player_id
      AND public.can_manage_tournament_team_visual_assets_as(
        p_organization_id, player.team_entry_id, p_actor_user_id,
        'roster_players.update'
      )
  );
$$;

-- Quien puede gestionar puede ver. Sin esto la política `roster` dejaría al
-- jugador con botones sobre un marco vacío: la lectura de 1C.2A sólo alcanzaba
-- su propia fila. Es aditivo —ninguna rama anterior se retira—, y el retrato
-- sigue viviendo en el bucket privado detrás de URLs firmadas.
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
  SELECT p_actor_user_id IS NOT NULL AND (
    EXISTS (
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
    )
    OR public.can_manage_tournament_player_portrait_as(
      p_organization_id, p_roster_player_id, p_actor_user_id
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Moderación y consentimiento no se amplían
-- ---------------------------------------------------------------------------

-- Las dos operaciones que mueven estado editorial y consentimiento pasan a
-- pedir la rama de organización. Antes aceptaban a cualquier capitán/delegado,
-- lo que con autogestión habilitada habría convertido «puedo subir la foto» en
-- «puedo aprobar su publicación». Son cosas distintas y siguen separadas.
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
  IF v_portrait.id IS NULL OR NOT public.can_moderate_tournament_team_visual_assets_as(
    p_organization_id, v_portrait.team_entry_id, auth.uid(), 'roster_players.update'
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
  IF v_portrait.id IS NULL OR NOT public.can_moderate_tournament_team_visual_assets_as(
    p_organization_id, v_portrait.team_entry_id, auth.uid(), 'roster_players.update'
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

-- ---------------------------------------------------------------------------
-- 7. La inscripción devuelve permisos, no roles
-- ---------------------------------------------------------------------------

-- El frontend calculaba `canEditBranding` mirando el rol del usuario dentro de
-- `managers`. Con una política de por medio esa cuenta se desincroniza sola, y
-- una cuenta desincronizada del lado del navegador es un CTA que miente. Acá se
-- devuelve la decisión ya tomada por el servidor.

CREATE OR REPLACE FUNCTION "public"."get_team_registration_context"("p_organization_id" "uuid", "p_team_entry_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_result jsonb;
  v_is_privileged boolean;
begin
  -- Quien ya podía leer la inscripción la sigue leyendo entera. La política
  -- `roster` suma una segunda puerta, y sólo esa: el jugador entra a la misma
  -- pantalla que el delegado, pero sin el historial de revisión, sin la
  -- auditoría y sin la lista de responsables, que no son datos suyos.
  v_is_privileged := public.can_read_tournament_team_entry(
    p_organization_id, p_team_entry_id
  );
  if auth.uid() is null or not (
    v_is_privileged
    or public.can_manage_tournament_team_visual_assets_as(
      p_organization_id, p_team_entry_id, auth.uid(), 'roster_players.update'
    )
  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  select jsonb_build_object(
    'entry', jsonb_build_object(
      'id', entry.id, 'organizationId', entry.organization_id,
      'seasonId', entry.season_id, 'tournamentId', entry.tournament_id,
      'categoryId', entry.category_id, 'name', entry.name, 'slug', entry.slug,
      'shortName', entry.short_name, 'shieldPath', entry.shield_path,
      'primaryColor', entry.primary_color, 'secondaryColor', entry.secondary_color,
      'status', entry.status, 'registrationSource', entry.registration_source,
      'linked', entry.arma2_team_id is not null, 'submittedAt', entry.submitted_at
    ),
    'tournament', jsonb_build_object(
      'id', tournament.id, 'name', tournament.name, 'status', tournament.status,
      'registrationClosesAt', tournament.registration_closes_at
    ),
    'category', jsonb_build_object('id', category.id, 'name', category.name),
    'settings', (
      select jsonb_build_object(
        'minimumPlayers', settings.minimum_players,
        'maximumPlayers', settings.maximum_players,
        'shirtNumberRequired', settings.shirt_number_required,
        'uniqueShirtNumbers', settings.unique_shirt_numbers,
        'positionRequired', settings.position_required,
        'minimumGoalkeepers', settings.minimum_goalkeepers,
        'allowProvisionalPlayers', settings.allow_provisional_players
      ) from public.tournament_roster_settings settings
      where settings.tournament_id = entry.tournament_id
    ),
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', manager.id, 'displayName', manager.display_name,
        'role', manager.role, 'status', manager.status,
        'isCurrentUser', manager.user_id = auth.uid()
      ) order by manager.created_at)
      from public.tournament_team_managers manager
      where v_is_privileged
        and manager.team_entry_id = entry.id and manager.status <> 'revoked'
    ), '[]'::jsonb),
    'roster', (
      select jsonb_build_object(
        'id', roster.id, 'version', roster.version, 'status', roster.status,
        'players', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', player.id, 'arma2UserId', player.arma2_user_id,
            'provisionalPlayerId', player.provisional_player_id,
            'displayName', player.display_name, 'avatarUrl', player.avatar_url,
            'shirtNumber', player.shirt_number,
            'primaryPosition', player.primary_position,
            'secondaryPosition', player.secondary_position,
            'isGoalkeeper', player.is_goalkeeper,
            'eligibilityStatus', player.eligibility_status
          ) order by player.shirt_number nulls last, player.display_name)
          from public.tournament_roster_players player
          where player.roster_id = roster.id and player.status = 'active'
        ), '[]'::jsonb)
      )
      from public.tournament_rosters roster
      where roster.team_entry_id = entry.id order by roster.version desc limit 1
    ),
    -- Con qué alcance entró el que mira. `full` es la inscripción entera de
    -- siempre; `visual` es el jugador o el responsable que entra sólo por la
    -- política de autogestión, y para el que `managers`, `reviews` y `audit`
    -- vienen vacíos porque no son datos suyos. Sin este dato la pantalla no
    -- puede distinguir «no hay responsables» de «no te los muestro», y termina
    -- afirmando lo primero cuando lo cierto es lo segundo.
    'viewer', jsonb_build_object(
      'scope', case when v_is_privileged then 'full' else 'visual' end
    ),
    -- La capacidad viaja desde el mismo predicado que después autoriza la
    -- escritura. Es lo que impide pintar un CTA que el servidor va a rechazar.
    'visualAssets', jsonb_build_object(
      'policy', tournament.team_visual_management_policy,
      'canManageShield', public.can_update_tournament_team_branding(
        p_organization_id, entry.id
      ),
      'canManagePortraits', public.can_manage_tournament_team_visual_assets_as(
        p_organization_id, entry.id, auth.uid(), 'roster_players.update'
      )
    ),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', review.id, 'decision', review.decision, 'reason', review.reason,
        'issues', review.issues, 'createdAt', review.created_at
      ) order by review.created_at desc)
      from public.tournament_team_reviews review
      where v_is_privileged and review.team_entry_id = entry.id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id, 'action', audit.action, 'resourceType', audit.resource_type,
        'metadata', audit.metadata, 'createdAt', audit.created_at
      ) order by audit.created_at desc)
      from (
        select * from public.tournament_audit_log
        where v_is_privileged and team_entry_id = entry.id
        order by created_at desc limit 50
      ) audit
    ), '[]'::jsonb)
  ) into v_result
  from public.tournament_team_entries entry
  join public.tournaments tournament on tournament.id = entry.tournament_id
  join public.tournament_categories category on category.id = entry.category_id
  where entry.id = p_team_entry_id and entry.organization_id = p_organization_id;
  if v_result is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  return v_result;
end;
$$;

-- La lista por equipo abre también para el plantel cuando la política lo
-- habilita: es la lectura que alimenta las mismas tarjetas de Plantel. Sigue
-- devolviendo `ImageRef` y capability, nunca bucket, path ni URL firmada.
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
  IF v_actor IS NULL OR NOT (
    public.can_read_tournament_team_entry(p_organization_id, p_team_entry_id)
    OR public.can_manage_tournament_team_visual_assets_as(
      p_organization_id, p_team_entry_id, v_actor, 'roster_players.update'
    )
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

-- ---------------------------------------------------------------------------
-- 8. Leer y cambiar la política
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_tournament_team_visual_policy(
  p_organization_id uuid,
  p_tournament_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy text;
BEGIN
  IF auth.uid() IS NULL
    OR NOT public.has_tournament_organization_capability(
      p_organization_id, 'tournaments.read'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;

  SELECT tournament.team_visual_management_policy
  INTO v_policy
  FROM public.tournaments tournament
  WHERE tournament.id = p_tournament_id
    AND tournament.organization_id = p_organization_id
    AND tournament.status <> 'archived';

  IF v_policy IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'tournamentId', p_tournament_id,
    'policy', v_policy,
    -- Quien sólo puede leer ve la política pero no el control.
    'canUpdate', public.has_tournament_organization_capability(
      p_organization_id, 'tournaments.update'
    )
  );
END;
$$;

-- Cambiar la política no toca ninguna imagen. Deshabilitar la autogestión
-- retira la posibilidad de modificar; no borra assets, ni metadata, ni
-- consentimiento, ni estado editorial.
CREATE OR REPLACE FUNCTION public.set_tournament_team_visual_policy(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_policy text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_policy text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF p_policy IS NULL OR p_policy NOT IN (
    'organization_only', 'delegates', 'roster'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_VISUAL_POLICY_INVALID';
  END IF;
  IF NOT public.has_tournament_organization_capability(
    p_organization_id, 'tournaments.update'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_VISUAL_POLICY_FORBIDDEN';
  END IF;

  SELECT tournament.team_visual_management_policy
  INTO v_previous_policy
  FROM public.tournaments tournament
  WHERE tournament.id = p_tournament_id
    AND tournament.organization_id = p_organization_id
    AND tournament.status <> 'archived'
  FOR UPDATE;

  IF v_previous_policy IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_VISUAL_POLICY_FORBIDDEN';
  END IF;

  IF v_previous_policy IS DISTINCT FROM p_policy THEN
    UPDATE public.tournaments
    SET team_visual_management_policy = p_policy
    WHERE id = p_tournament_id;

    -- Auditoría por el mecanismo existente: actor y timestamp los pone
    -- append_tournament_audit, el antes y el después viajan en la metadata.
    PERFORM public.append_tournament_audit(
      p_organization_id,
      'tournament.team_visual_policy_updated',
      'tournament_team_visual_policy',
      p_tournament_id,
      NULL,
      p_tournament_id,
      jsonb_build_object(
        'previousPolicy', v_previous_policy,
        'policy', p_policy
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'tournamentId', p_tournament_id,
    'previousPolicy', v_previous_policy,
    'policy', p_policy,
    'canUpdate', true
  );
END;
$$;

COMMENT ON FUNCTION public.set_tournament_team_visual_policy(uuid, uuid, text) IS
  'Cambia la política de autogestión visual del torneo. No modifica assets, metadata, consentimiento ni estado editorial.';

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------

-- Los helpers que reciben el actor por parámetro NO se le dan a `authenticated`.
-- Un predicado con actor explícito respondido al navegador es un oráculo: deja
-- preguntar «¿el usuario X está en el plantel del equipo Y?» sobre cualquier
-- usuario y cualquier equipo, sin ser ninguno de los dos. La regla ya existía
-- en 1C.2A —las variantes `_as` eran service-only y la puerta de `authenticated`
-- eran los wrappers que leen auth.uid()— y se sostiene acá. Que sean internos
-- no cuesta nada: quien los llama son funciones SECURITY DEFINER de este mismo
-- esquema, que corren como su dueño y no necesitan el grant del que llama.
REVOKE ALL ON FUNCTION public.is_tournament_team_roster_member_as(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_tournament_team_visual_assets_as(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_moderate_tournament_team_visual_assets_as(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_tournament_team_visual_policy(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tournament_team_visual_policy(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_tournament_team_roster_member_as(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_tournament_team_visual_assets_as(uuid, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.can_moderate_tournament_team_visual_assets_as(uuid, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_team_visual_policy(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_team_visual_policy(uuid, uuid, text)
  TO authenticated, service_role;

-- Las funciones reemplazadas conservan el contrato de acceso que traían de
-- 1C.1 y 1C.2A. Se reafirma explícitamente para que el resultado no dependa
-- de lo que CREATE OR REPLACE arrastre.
REVOKE ALL ON FUNCTION public.can_update_tournament_team_branding(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_tournament_player_portrait_as(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_tournament_player_portrait_as(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tournament_player_portrait_editorial_status(uuid, uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_tournament_player_portrait_publication(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_tournament_player_portrait_refs(uuid, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_update_tournament_team_branding(uuid, uuid)
  TO authenticated, service_role;
-- Mismo criterio, y además el contrato exacto que 1C.2A dejó escrito: las dos
-- variantes `_as` del retrato son service-only y `authenticated` entra por
-- can_manage_tournament_player_portrait()/can_read_tournament_player_portrait(),
-- que resuelven el actor con auth.uid().
GRANT EXECUTE ON FUNCTION public.can_manage_tournament_player_portrait_as(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_tournament_player_portrait_as(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_player_portrait_editorial_status(uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_tournament_player_portrait_publication(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_tournament_player_portrait_refs(uuid, uuid)
  TO authenticated, service_role;

-- get_team_registration_context es una lectura de la baseline: anon nunca la
-- tuvo por GRANT explícito y no la gana acá.
GRANT EXECUTE ON FUNCTION public.get_team_registration_context(uuid, uuid)
  TO authenticated, service_role;

COMMIT;
