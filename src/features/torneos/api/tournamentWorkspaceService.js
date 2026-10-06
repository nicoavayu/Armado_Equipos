import { v4 as uuidv4 } from 'uuid';
import {
  ERROR_MESSAGES,
  TournamentWorkspaceError,
  toWorkspaceError,
} from './tournamentWorkspaceErrors';
import { supabase } from '../../../services/api/supabase';
import { normalizeMatchOutcome } from '../domain/matchOutcome';
import { resolveBrandingAssetUrl } from '../domain/brandingAssets';
import { loadTournamentBrandingContext } from './tournamentBrandingService';
import {
  deleteTournamentMediaAsset,
  signTournamentMediaReadUrls,
  uploadTournamentMediaPhoto,
} from './tournamentMediaUploadClient';

export {
  ERROR_MESSAGES,
  TournamentWorkspaceError,
  toWorkspaceError,
} from './tournamentWorkspaceErrors';

function unwrapRpc(result, fallbackMessage) {
  if (result?.error) throw toWorkspaceError(result.error, fallbackMessage);
  return result?.data;
}

export function createIdempotencyKey() {
  return uuidv4();
}

export async function loadTournamentWorkspaceContext() {
  try {
    return unwrapRpc(
      await supabase.rpc('get_tournament_workspace_context'),
      'No pudimos cargar tus espacios. Revisá la conexión y volvé a intentar.',
    );
  } catch (error) {
    throw toWorkspaceError(
      error,
      'No pudimos cargar tus espacios. Revisá la conexión y volvé a intentar.',
    );
  }
}

export async function loadEffectiveTournamentEntitlements({
  organizationId,
  tournamentId = null,
}) {
  return unwrapRpc(await supabase.rpc('get_effective_tournament_entitlements', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar las funcionalidades disponibles.');
}

export async function loadEffectiveTournamentSeasonEntitlements({
  organizationId,
  seasonId,
}) {
  return unwrapRpc(await supabase.rpc('get_effective_tournament_season_entitlements', {
    p_organization_id: organizationId,
    p_season_id: seasonId,
  }), 'No pudimos cargar las funcionalidades disponibles para esta temporada.');
}

export async function loadTournamentCreationEligibility({ organizationId }) {
  return unwrapRpc(await supabase.rpc('get_tournament_creation_eligibility', {
    p_organization_id: organizationId,
  }), 'No pudimos verificar si FREE está disponible para este torneo.');
}

export async function createTournamentCheckout({
  organizationId,
  seasonId,
  idempotencyKey = createIdempotencyKey(),
}) {
  const { data, error } = await supabase.functions.invoke('tournament-checkout', {
    body: { organizationId, seasonId, idempotencyKey },
  });
  if (error || !data?.purchase) {
    throw toWorkspaceError(error || data?.error, 'No pudimos iniciar la compra.');
  }
  return data;
}

export function isMercadoPagoCheckoutUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      hostname === 'mercadopago.com'
      || hostname.endsWith('.mercadopago.com')
      || hostname === 'mercadopago.com.ar'
      || hostname.endsWith('.mercadopago.com.ar')
    );
  } catch {
    return false;
  }
}

export async function loadTournamentPurchase({
  purchaseId,
  organizationId,
  seasonId = null,
  tournamentId = null,
}) {
  const purchase = unwrapRpc(await supabase.rpc('get_tournament_purchase', {
    p_purchase_id: purchaseId,
  }), 'No pudimos consultar el estado de la compra.');
  if (!purchase
    || purchase.organizationId !== organizationId
    || (seasonId && purchase.seasonId !== seasonId)
    || (!seasonId && tournamentId && purchase.tournamentId !== tournamentId)) {
    throw new TournamentWorkspaceError(
      'TORNEOS_PURCHASE_FORBIDDEN',
      ERROR_MESSAGES.TORNEOS_PURCHASE_FORBIDDEN,
    );
  }
  return purchase;
}

export async function loadTournamentSeasonMediaUsage({ organizationId, seasonId }) {
  return unwrapRpc(await supabase.rpc('get_tournament_season_media_usage', {
    p_organization_id: organizationId,
    p_season_id: seasonId,
  }), 'No pudimos calcular el uso multimedia de la temporada.');
}

export async function listTournamentSeasonMemberAssignments({ organizationId, seasonId }) {
  return unwrapRpc(await supabase.rpc('list_tournament_season_member_assignments', {
    p_organization_id: organizationId,
    p_season_id: seasonId,
  }), 'No pudimos cargar los colaboradores de la temporada.');
}

export async function assignTournamentSeasonMember({ organizationId, seasonId, membershipId }) {
  return unwrapRpc(await supabase.rpc('assign_tournament_season_member', {
    p_organization_id: organizationId,
    p_season_id: seasonId,
    p_membership_id: membershipId,
  }), 'No pudimos asignar el colaborador a la temporada.');
}

export async function removeTournamentSeasonMemberAssignment({
  organizationId,
  seasonId,
  membershipId,
}) {
  return unwrapRpc(await supabase.rpc('remove_tournament_season_member_assignment', {
    p_organization_id: organizationId,
    p_season_id: seasonId,
    p_membership_id: membershipId,
  }), 'No pudimos quitar el colaborador de la temporada.');
}

export async function simulateFakeTournamentPayment({ purchaseId, status }) {
  const { data, error } = await supabase.functions.invoke('tournament-fake-payment', {
    body: { purchaseId, status },
  });
  if (error || !data?.purchase) {
    throw toWorkspaceError(error || data?.error, 'No pudimos simular el pago FAKE.');
  }
  return data.purchase;
}

export async function cancelTournamentPurchase({ purchaseId }) {
  return unwrapRpc(await supabase.rpc('cancel_tournament_purchase', {
    p_purchase_id: purchaseId,
  }), 'No pudimos cancelar la compra.');
}

export async function loadTournamentPublicPageSettings({
  organizationId,
  tournamentId,
}) {
  return unwrapRpc(await supabase.rpc('get_tournament_public_page_settings', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar el estado de la página pública.');
}

export async function loadTournamentTeamVisualPolicy({
  organizationId,
  tournamentId,
}) {
  return unwrapRpc(await supabase.rpc('get_tournament_team_visual_policy', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar la gestión de imágenes por los equipos.');
}

export async function setTournamentTeamVisualPolicy({
  organizationId,
  tournamentId,
  policy,
}) {
  return unwrapRpc(await supabase.rpc('set_tournament_team_visual_policy', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_policy: policy,
  }), 'No pudimos actualizar la gestión de imágenes por los equipos.');
}

export async function setTournamentPublicPagePublished({
  organizationId,
  tournamentId,
  published,
}) {
  return unwrapRpc(await supabase.rpc('set_tournament_public_page_published', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_published: Boolean(published),
  }), 'No pudimos actualizar la página pública.');
}

export async function createTournamentOrganization({
  name,
  slug,
  idempotencyKey,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('create_tournament_organization', {
        p_name: name,
        p_slug: slug,
        p_idempotency_key: idempotencyKey,
      }),
      'No pudimos crear la organización. Tus datos no se guardaron.',
    );
  } catch (error) {
    throw toWorkspaceError(
      error,
      'No pudimos crear la organización. Tus datos no se guardaron.',
    );
  }
}

export async function setTournamentWorkspacePreference(
  workspaceType,
  organizationId = null,
) {
  try {
    return unwrapRpc(
      await supabase.rpc('set_tournament_workspace_preference', {
        p_workspace_type: workspaceType,
        p_organization_id: organizationId,
      }),
      'No pudimos cambiar de espacio. Volvé a intentarlo.',
    );
  } catch (error) {
    throw toWorkspaceError(
      error,
      'No pudimos cambiar de espacio. Volvé a intentarlo.',
    );
  }
}

export async function checkTournamentOrganizationSlugAvailability(slug) {
  try {
    const result = await supabase.rpc(
      'is_tournament_organization_slug_available',
      { p_slug: slug },
    );
    return Boolean(unwrapRpc(
      result,
      'No pudimos comprobar el identificador.',
    ));
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos comprobar el identificador.');
  }
}

export async function updateTournamentOrganization({
  organizationId,
  name = null,
  slug = null,
  status = null,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('update_tournament_organization', {
        p_organization_id: organizationId,
        p_name: name,
        p_slug: slug,
        p_status: status,
      }),
      'No pudimos guardar los cambios.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos guardar los cambios.');
  }
}

export async function listTournamentOrganizationMembers(organizationId) {
  try {
    const { data, error } = await supabase
      .from('tournament_organization_members')
      .select('id,user_id,role,status,joined_at,created_at')
      .eq('organization_id', organizationId)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar los miembros.');
  }
}

export async function loadTournamentCompetitionContext(organizationId) {
  try {
    const context = unwrapRpc(
      await supabase.rpc('get_tournament_competition_context', {
        p_organization_id: organizationId,
      }),
      'No pudimos cargar temporadas y torneos.',
    );
    const branding = await loadTournamentBrandingContext({ organizationId });
    const logoByTournament = new Map(
      (branding?.tournaments || []).map((item) => [item.id, item.logoPath || null]),
    );
    return {
      ...context,
      organizationBranding: branding?.organization || null,
      tournaments: (context?.tournaments || []).map((tournament) => ({
        ...tournament,
        logoPath: logoByTournament.get(tournament.id) || null,
        organizationLogoPath: branding?.organization?.logoPath || null,
      })),
    };
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar temporadas y torneos.');
  }
}

export async function createTournamentSeason({
  organizationId,
  name,
  slug,
  startDate = null,
  endDate = null,
  idempotencyKey,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('create_tournament_season', {
        p_organization_id: organizationId,
        p_name: name,
        p_slug: slug,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_idempotency_key: idempotencyKey,
      }),
      'No pudimos crear la temporada.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos crear la temporada.');
  }
}

export async function updateTournamentSeason({
  organizationId,
  seasonId,
  name = null,
  slug = null,
  startDate = null,
  endDate = null,
  status = null,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('update_tournament_season', {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_name: name,
        p_slug: slug,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_status: status,
        p_clear_start_date: startDate === '',
        p_clear_end_date: endDate === '',
      }),
      'No pudimos actualizar la temporada.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos actualizar la temporada.');
  }
}

export async function createTournamentCompetition({
  organizationId,
  seasonId,
  name,
  slug,
  description = null,
  sportModality,
  competitionFormat,
  genderCategory,
  startDate = null,
  endDate = null,
  idempotencyKey,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('create_tournament_with_defaults', {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_name: name,
        p_slug: slug,
        p_description: description || null,
        p_sport_modality: sportModality,
        p_competition_format: competitionFormat,
        p_gender_category: genderCategory,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_idempotency_key: idempotencyKey,
      }),
      'No pudimos crear el torneo.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos crear el torneo.');
  }
}

export async function updateTournamentCompetition({
  organizationId,
  tournamentId,
  patch,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('update_tournament_configuration', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_patch: patch,
      }),
      'No pudimos guardar la configuración.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos guardar la configuración.');
  }
}

export async function saveTournamentCategory({
  organizationId,
  tournamentId,
  categoryId = null,
  name,
  slug,
  description = null,
  sortOrder = 0,
  minAge = null,
  maxAge = null,
  genderCategory = null,
  sportModality = null,
  teamSize = null,
  status = 'active',
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('save_tournament_category', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_category_id: categoryId,
        p_name: name,
        p_slug: slug,
        p_description: description || null,
        p_sort_order: sortOrder,
        p_min_age: minAge,
        p_max_age: maxAge,
        p_gender_category: genderCategory,
        p_sport_modality: sportModality,
        p_team_size: teamSize,
        p_status: status,
      }),
      'No pudimos guardar la categoría.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos guardar la categoría.');
  }
}

export async function changeTournamentCompetitionStatus({
  organizationId,
  tournamentId,
  status,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('change_tournament_status', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_status: status,
      }),
      'No pudimos cambiar el estado del torneo.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cambiar el estado del torneo.');
  }
}

export async function startTournamentCompetition({ organizationId, tournamentId }) {
  try {
    return unwrapRpc(
      await supabase.rpc('start_tournament_competition', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
      }),
      'No pudimos iniciar la competencia.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos iniciar la competencia.');
  }
}

export async function finishTournamentCompetition({ organizationId, tournamentId }) {
  try {
    return unwrapRpc(
      await supabase.rpc('finish_tournament_competition', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
      }),
      'No pudimos finalizar la competencia.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos finalizar la competencia.');
  }
}

export async function reopenTournamentCompetition({
  organizationId,
  tournamentId,
  reason,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('reopen_tournament_competition', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_reason: reason,
      }),
      'No pudimos reabrir la competencia.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos reabrir la competencia.');
  }
}

export async function withdrawTournamentCompetitionParticipant({
  organizationId,
  tournamentId,
  teamEntryId,
  reasonCode,
  reasonText = null,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('withdraw_tournament_competition_participant', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_team_entry_id: teamEntryId,
        p_reason_code: reasonCode,
        p_reason_text: reasonText,
      }),
      'No pudimos retirar el equipo.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos retirar el equipo.');
  }
}

export async function setActiveTournamentContext({
  organizationId,
  seasonId,
  tournamentId = null,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('set_active_tournament_context', {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_tournament_id: tournamentId,
      }),
      'No pudimos cambiar el contexto competitivo.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cambiar el contexto competitivo.');
  }
}

export async function loadTournamentTeamsContext(organizationId, tournamentId) {
  try {
    return unwrapRpc(
      await supabase.rpc('get_tournament_teams_context', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
      }),
      'No pudimos cargar los equipos.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar los equipos.');
  }
}

export async function loadTeamRegistrationContext(organizationId, teamEntryId) {
  try {
    return unwrapRpc(
      await supabase.rpc('get_team_registration_context', {
        p_organization_id: organizationId,
        p_team_entry_id: teamEntryId,
      }),
      'No pudimos cargar la inscripción.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar la inscripción.');
  }
}

export async function createTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_arma2_team_id: input.arma2TeamId || null,
    p_name: input.name,
    p_short_name: input.shortName || null,
    p_primary_color: input.primaryColor || null,
    p_secondary_color: input.secondaryColor || null,
    p_registration_source: input.registrationSource,
    p_manager_user_id: input.managerUserId || null,
    p_manager_email: input.managerEmail || null,
    p_manager_display_name: input.managerDisplayName || null,
    p_idempotency_key: input.idempotencyKey,
  }), 'No pudimos crear la inscripción.');
}

export async function updateTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('update_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_patch: input.patch,
  }), 'No pudimos guardar los datos del equipo.');
}

export async function createTournamentProvisionalPlayer(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_provisional_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_display_name: input.displayName,
  }), 'No pudimos crear el jugador provisional.');
}

export async function addTournamentRosterPlayer(input) {
  return unwrapRpc(await supabase.rpc('add_tournament_roster_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_id: input.rosterId,
    p_arma2_user_id: input.arma2UserId || null,
    p_provisional_player_id: input.provisionalPlayerId || null,
    p_display_name: input.displayName,
    p_avatar_url: input.avatarUrl || null,
    p_shirt_number: input.shirtNumber === '' ? null : input.shirtNumber,
    p_primary_position: input.primaryPosition || null,
    p_secondary_position: input.secondaryPosition || null,
    p_is_goalkeeper: Boolean(input.isGoalkeeper),
  }), 'No pudimos agregar el jugador.');
}

export async function updateTournamentRosterPlayer(input) {
  return unwrapRpc(await supabase.rpc('update_tournament_roster_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_player_id: input.rosterPlayerId,
    p_shirt_number: input.shirtNumber === '' ? null : input.shirtNumber,
    p_primary_position: input.primaryPosition || null,
    p_secondary_position: input.secondaryPosition || null,
    p_is_goalkeeper: Boolean(input.isGoalkeeper),
  }), 'No pudimos actualizar el jugador.');
}

export async function removeTournamentRosterPlayer(input) {
  return unwrapRpc(await supabase.rpc('remove_tournament_roster_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_player_id: input.rosterPlayerId,
  }), 'No pudimos quitar el jugador.');
}

export async function submitTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('submit_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
  }), 'No pudimos presentar la inscripción.');
}

export async function reviewTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('review_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_decision: input.decision,
    p_reason: input.reason,
    p_issues: input.issues || [],
  }), 'No pudimos completar la revisión.');
}

export async function withdrawTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('withdraw_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_reason: input.reason,
  }), 'No pudimos retirar la inscripción.');
}

export async function archiveTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('archive_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_reason: input.reason,
  }), 'No pudimos archivar la inscripción.');
}

export async function lockTournamentRoster(input) {
  return unwrapRpc(await supabase.rpc('lock_tournament_roster', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_id: input.rosterId,
  }), 'No pudimos bloquear el plantel.');
}

export async function inviteTournamentTeamManager(input) {
  return unwrapRpc(await supabase.rpc('invite_tournament_team_manager', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_email: input.email,
    p_display_name: input.displayName,
    p_role: input.role || 'captain',
  }), 'No pudimos generar la invitación.');
}

export async function acceptTournamentTeamInvitation(token) {
  return unwrapRpc(await supabase.rpc('accept_tournament_team_invitation', {
    p_token: token,
  }), 'No pudimos aceptar la invitación.');
}

export async function searchTournamentPlayers(input) {
  return unwrapRpc(await supabase.rpc('search_tournament_players', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_query: input.query,
    p_limit: input.limit || 8,
    p_team_entry_id: input.teamEntryId || null,
  }), 'No pudimos buscar jugadores.');
}

export async function searchTournamentArma2Teams(input) {
  return unwrapRpc(await supabase.rpc('search_tournament_arma2_teams', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_query: input.query,
    p_limit: input.limit || 8,
  }), 'No pudimos buscar equipos de Arma2.');
}

export async function loadTournamentFixtureContext(organizationId, tournamentId, categoryId) {
  return unwrapRpc(await supabase.rpc('get_tournament_fixture_context', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
  }), 'No pudimos cargar el fixture.');
}

export async function loadTournamentScheduleContext(organizationId, tournamentId, categoryId) {
  return unwrapRpc(await supabase.rpc('get_tournament_schedule_context', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
  }), 'No pudimos cargar la programación.');
}

export async function freezeTournamentParticipants(input) {
  return unwrapRpc(await supabase.rpc('freeze_tournament_participants', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_idempotency_key: input.idempotencyKey,
  }), 'No pudimos cerrar los participantes.');
}

export async function reopenTournamentParticipants(input) {
  return unwrapRpc(await supabase.rpc('reopen_tournament_participants', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_reason: input.reason,
  }), 'No pudimos reabrir los participantes.');
}

export async function saveTournamentDrawPots(input) {
  return unwrapRpc(await supabase.rpc('save_tournament_draw_pots', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_pots: input.pots,
  }), 'No pudimos guardar los bombos.');
}

export async function executeTournamentGroupDraw(input) {
  return unwrapRpc(await supabase.rpc('execute_tournament_group_draw', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_group_count: input.groupCount,
    p_seed: input.seed,
    p_publish: Boolean(input.publish),
  }), 'No pudimos ejecutar el sorteo.');
}

export async function generateTournamentFixture(input) {
  return unwrapRpc(await supabase.rpc('generate_tournament_fixture', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_seed: input.seed || null,
    p_configuration: input.configuration || {},
    p_idempotency_key: input.idempotencyKey,
  }), 'No pudimos generar el fixture.');
}

export async function createManualTournamentFixture(input) {
  return unwrapRpc(await supabase.rpc('create_manual_fixture_version', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_source_fixture_version_id: input.sourceFixtureVersionId || null,
    p_idempotency_key: input.idempotencyKey,
  }), 'No pudimos crear la versión manual.');
}

export async function updateDraftTournamentFixture(input) {
  return unwrapRpc(await supabase.rpc('update_draft_fixture', {
    p_organization_id: input.organizationId,
    p_fixture_version_id: input.fixtureVersionId,
    p_action: input.action,
    p_payload: input.payload || {},
  }), 'No pudimos editar el fixture.');
}

export async function validateTournamentFixture(input) {
  return unwrapRpc(await supabase.rpc('validate_tournament_fixture', {
    p_organization_id: input.organizationId,
    p_fixture_version_id: input.fixtureVersionId,
  }), 'No pudimos validar el fixture.');
}

export async function publishTournamentFixture(input) {
  return unwrapRpc(await supabase.rpc('publish_tournament_fixture', {
    p_organization_id: input.organizationId,
    p_fixture_version_id: input.fixtureVersionId,
  }), 'No pudimos publicar el fixture.');
}

export async function appendTournamentPlayoffPhase(input) {
  return unwrapRpc(await supabase.rpc('append_tournament_playoff_phase', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_source_phase_id: input.sourcePhaseId,
    p_qualifier_count: input.qualifierCount,
    p_double_leg: Boolean(input.doubleLeg),
    p_idempotency_key: input.idempotencyKey,
  }), 'No pudimos agregar los Playoffs.');
}

export async function archiveTournamentFixture(input) {
  return unwrapRpc(await supabase.rpc('archive_tournament_fixture', {
    p_organization_id: input.organizationId,
    p_fixture_version_id: input.fixtureVersionId,
    p_reason: input.reason,
  }), 'No pudimos descartar el borrador.');
}

export async function supersedeTournamentFixture(input) {
  return unwrapRpc(await supabase.rpc('supersede_tournament_fixture', {
    p_organization_id: input.organizationId,
    p_fixture_version_id: input.fixtureVersionId,
    p_idempotency_key: input.idempotencyKey,
  }), 'No pudimos preparar una nueva versión.');
}

/**
 * Lectura de sedes y canchas a nivel organización.
 *
 * `tournament_venues` y `tournament_courts` pertenecen a la organización y no
 * tienen `tournament_id`: pedirlas a través de `get_tournament_schedule_context`
 * obligaba a tener un torneo y una categoría activos para ver un recurso que no
 * depende de ninguno de los dos. Eso es lo que ataba la pantalla de Sedes al
 * contexto de competencia.
 *
 * La autorización sigue siendo del servidor: ambas tablas tienen RLS con
 * `has_tournament_organization_capability(organization_id, 'venues.read'
 * /'courts.read')` y sólo `GRANT SELECT` a `authenticated`, así que esta lectura
 * no puede ver nada que el RPC dejara ver.
 */
export async function loadTournamentOrganizationVenues(organizationId) {
  const [venues, courts] = await Promise.all([
    supabase
      .from('tournament_venues')
      .select('id, name, address, place_id, latitude, longitude, locality, timezone, status, notes')
      .eq('organization_id', organizationId)
      .order('status', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('tournament_courts')
      .select('id, venue_id, name, sport_modality, status, notes')
      .eq('organization_id', organizationId)
      .order('status', { ascending: true })
      .order('name', { ascending: true }),
  ]);
  if (venues.error) throw toWorkspaceError(venues.error, 'No pudimos cargar las sedes.');
  if (courts.error) throw toWorkspaceError(courts.error, 'No pudimos cargar las canchas.');
  return {
    venues: (venues.data || []).map((venue) => ({
      id: venue.id,
      name: venue.name,
      address: venue.address,
      placeId: venue.place_id,
      latitude: venue.latitude,
      longitude: venue.longitude,
      locality: venue.locality,
      timezone: venue.timezone,
      status: venue.status,
      notes: venue.notes,
    })),
    courts: (courts.data || []).map((court) => ({
      id: court.id,
      venueId: court.venue_id,
      name: court.name,
      sportModality: court.sport_modality,
      status: court.status,
      notes: court.notes,
    })),
  };
}

export async function createTournamentVenue(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_venue', {
    p_organization_id: input.organizationId,
    p_name: input.name,
    p_address: input.address,
    p_place_id: input.placeId || null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_locality: input.locality || null,
    p_timezone: input.timezone || 'America/Argentina/Buenos_Aires',
    p_notes: input.notes || null,
  }), 'No pudimos crear la sede.');
}

export async function updateTournamentVenue(input) {
  return unwrapRpc(await supabase.rpc('update_tournament_venue', {
    p_organization_id: input.organizationId,
    p_venue_id: input.venueId,
    p_patch: input.patch,
  }), 'No pudimos actualizar la sede.');
}

export async function createTournamentCourt(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_court', {
    p_organization_id: input.organizationId,
    p_venue_id: input.venueId,
    p_name: input.name,
    p_sport_modality: input.sportModality,
    p_notes: input.notes || null,
  }), 'No pudimos crear la cancha.');
}

export async function updateTournamentCourt(input) {
  return unwrapRpc(await supabase.rpc('update_tournament_court', {
    p_organization_id: input.organizationId,
    p_court_id: input.courtId,
    p_patch: input.patch,
  }), 'No pudimos actualizar la cancha.');
}

export async function saveTournamentScheduleWindows(input) {
  return unwrapRpc(await supabase.rpc('save_tournament_schedule_windows', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_windows: input.windows,
  }), 'No pudimos guardar las ventanas.');
}

export async function validateTournamentMatchSchedule(input) {
  return unwrapRpc(await supabase.rpc('validate_tournament_match_schedule', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_scheduled_at: input.scheduledAt,
    p_venue_id: input.venueId,
    p_court_id: input.courtId,
    p_duration_minutes: input.durationMinutes,
  }), 'No pudimos validar la programación.');
}

export async function scheduleTournamentMatch(input) {
  return unwrapRpc(await supabase.rpc('schedule_tournament_match', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_scheduled_at: input.scheduledAt,
    p_venue_id: input.venueId,
    p_court_id: input.courtId,
    p_duration_minutes: input.durationMinutes,
    p_override_warnings: Boolean(input.overrideWarnings),
    p_override_reason: input.overrideReason || null,
  }), 'No pudimos programar el partido.');
}

export async function rescheduleTournamentMatch(input) {
  return unwrapRpc(await supabase.rpc('reschedule_tournament_match', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_scheduled_at: input.scheduledAt,
    p_venue_id: input.venueId,
    p_court_id: input.courtId,
    p_duration_minutes: input.durationMinutes,
    p_reason: input.reason,
    p_override_warnings: Boolean(input.overrideWarnings),
  }), 'No pudimos reprogramar el partido.');
}

export async function changeTournamentMatchPlan(input) {
  const rpc = {
    postpone: 'postpone_tournament_match',
    cancel: 'cancel_tournament_match',
    restore: 'restore_tournament_match_unscheduled',
  }[input.action];
  if (!rpc) throw new TournamentWorkspaceError('TORNEOS_INVALID_MATCH_ACTION', 'Acción inválida.');
  return unwrapRpc(await supabase.rpc(rpc, {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_reason: input.reason,
  }), 'No pudimos actualizar el partido.');
}

export async function autoScheduleTournamentMatches(input) {
  return unwrapRpc(await supabase.rpc('auto_schedule_tournament_matches', {
    p_organization_id: input.organizationId,
    p_fixture_version_id: input.fixtureVersionId,
  }), 'No pudimos completar la programación automática.');
}

//
// "Mis partidos" une dos relaciones distintas con el mismo partido, y el
// merge borraba de cuál venía cada fila.
//
// `get_player_tournament_matches` devuelve los partidos donde el usuario está
// en un plantel vigente; `get_managed_tournament_matches`, aquellos donde es
// capitán o delegado del equipo. Son cosas distintas: responder disponibilidad
// es un acto del jugador sobre sí mismo —`respond_match_availability` exige un
// `tournament_roster_players` propio— mientras que dirigir la convocatoria es
// del cuerpo técnico. Fundidas en un objeto plano, la pantalla no podía
// distinguirlas y ofrecía "Voy / No voy" también sobre filas donde el usuario
// no es jugador, que el backend rechaza con TORNEOS_MATCH_FORBIDDEN.
//
// Por eso cada fila viaja etiquetada con su origen, y quien tiene las dos
// relaciones conserva las dos capacidades.
//
export async function loadPlayerTournamentMatches() {
  const [playerMatches, managedMatches] = await Promise.all([
    supabase.rpc('get_player_tournament_matches'),
    supabase.rpc('get_managed_tournament_matches'),
  ]);
  const playerRows = unwrapRpc(playerMatches, 'No pudimos cargar tus partidos del torneo.') || [];
  const managedRows = unwrapRpc(managedMatches, 'No pudimos cargar tus partidos del torneo.') || [];
  const byScope = new Map();
  const merge = (rows, relation) => rows.forEach((match) => {
    const key = `${match.matchId}:${match.teamEntryId}`;
    byScope.set(key, { ...(byScope.get(key) || {}), ...match, ...relation });
  });
  merge(playerRows, { isRosteredPlayer: true });
  merge(managedRows, { isTeamManager: true });
  return [...byScope.values()].map((match) => ({
    isRosteredPlayer: false,
    isTeamManager: false,
    ...match,
  }));
}

export async function respondTournamentMatchAvailability(input) {
  return unwrapRpc(await supabase.rpc('respond_match_availability', {
    p_match_id: input.matchId,
    p_response: input.response,
    p_comment: input.comment || null,
  }), 'No pudimos guardar tu disponibilidad.');
}

export async function recordManualTournamentMatchAvailability(input) {
  return unwrapRpc(await supabase.rpc('record_manual_match_availability', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_roster_player_id: input.rosterPlayerId,
    p_response: input.response,
    p_reason: input.reason,
    p_comment: input.comment || null,
  }), 'No pudimos registrar la disponibilidad manual.');
}

export async function loadTournamentMatchOperations(input) {
  return unwrapRpc(await supabase.rpc('get_tournament_match_operations_context', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId || null,
  }), 'No pudimos cargar los partidos operativos.');
}

export async function loadTournamentMatchOperation(input) {
  return unwrapRpc(await supabase.rpc('get_tournament_match_operation_context', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
  }), 'No pudimos cargar el acta.');
}

export async function loadTournamentMatchSquad(input) {
  return unwrapRpc(await supabase.rpc('get_match_squad_context', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_team_entry_id: input.teamEntryId,
  }), 'No pudimos cargar la convocatoria.');
}

export async function loadMyManagedTournamentMatchSquad(matchId) {
  return unwrapRpc(await supabase.rpc('get_my_managed_match_squad_context', {
    p_match_id: matchId,
  }), 'No pudimos cargar tu convocatoria.');
}

export async function saveTournamentMatchSquad(input) {
  return unwrapRpc(await supabase.rpc('save_match_squad', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_team_entry_id: input.teamEntryId,
    p_players: input.players,
  }), 'No pudimos guardar la convocatoria.');
}

export async function submitTournamentMatchSquad(input) {
  return unwrapRpc(await supabase.rpc('submit_match_squad', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_team_entry_id: input.teamEntryId,
  }), 'No pudimos presentar la convocatoria.');
}

export async function openTournamentMatchOperation(input) {
  return unwrapRpc(await supabase.rpc('open_tournament_match_operation', {
    p_organization_id: input.organizationId,
    p_match_id: input.matchId,
    p_override_reason: input.overrideReason || null,
  }), 'No pudimos abrir el acta.');
}

export async function saveTournamentMatchOperationDraft(input) {
  return unwrapRpc(await supabase.rpc('save_tournament_match_operation_draft', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
    p_match_status: input.matchStatus,
    p_notes: input.notes || null,
  }), 'No pudimos guardar el acta.');
}

export async function setTournamentMatchOutcome(input) {
  return unwrapRpc(await supabase.rpc('set_tournament_match_outcome', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
    p_outcome: normalizeMatchOutcome(input.outcome),
  }), 'No pudimos guardar la resolución deportiva.');
}

export async function setTournamentMatchScore(input) {
  return unwrapRpc(await supabase.rpc('set_tournament_match_score', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
    p_score: input.score,
  }), 'No pudimos guardar el resultado.');
}

export async function addTournamentMatchEvent(input) {
  return unwrapRpc(await supabase.rpc('add_tournament_match_event', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
    p_event: input.event,
  }), 'No pudimos agregar el evento.');
}

export async function voidTournamentMatchEvent(input) {
  return unwrapRpc(await supabase.rpc('void_tournament_match_event', {
    p_organization_id: input.organizationId,
    p_event_id: input.eventId,
    p_reason: input.reason,
  }), 'No pudimos anular el evento.');
}

export async function submitTournamentMatchOperation(input) {
  return unwrapRpc(await supabase.rpc('submit_tournament_match_operation', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
  }), 'No pudimos presentar el acta.');
}

export async function reviewTournamentMatchOperation(input) {
  return unwrapRpc(await supabase.rpc('review_tournament_match_operation', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
    p_decision: input.decision,
    p_reason: input.reason,
  }), 'No pudimos revisar el acta.');
}

export async function validateTournamentMatchOperation(input) {
  return unwrapRpc(await supabase.rpc('validate_tournament_match_operation', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
  }), 'No pudimos validar el acta.');
}

export async function makeTournamentMatchOfficial(input) {
  return unwrapRpc(await supabase.rpc('make_tournament_match_official', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
  }), 'No pudimos oficializar el acta.');
}

export async function requestTournamentMatchCorrection(input) {
  return unwrapRpc(await supabase.rpc('request_tournament_match_correction', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
    p_reason: input.reason,
  }), 'No pudimos solicitar la corrección.');
}

export async function createTournamentMatchCorrection(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_match_correction', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
  }), 'No pudimos crear la nueva versión del acta.');
}

export async function voidTournamentMatchOperation(input) {
  return unwrapRpc(await supabase.rpc('void_tournament_match_operation', {
    p_organization_id: input.organizationId,
    p_match_operation_id: input.operationId,
    p_reason: input.reason,
  }), 'No pudimos anular el acta.');
}

function projectionScopeParams(input) {
  return {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_phase_id: input.phaseId,
    p_group_id: input.groupId || null,
  };
}

export async function loadTournamentStandings(input) {
  return unwrapRpc(await supabase.rpc(
    'get_tournament_standings_context',
    projectionScopeParams(input),
  ), 'No pudimos cargar la tabla.');
}

export async function loadTournamentStatistics(input) {
  return unwrapRpc(await supabase.rpc(
    'get_tournament_statistics_context',
    projectionScopeParams(input),
  ), 'No pudimos cargar las estadísticas.');
}

export async function rebuildTournamentStandings(input) {
  return unwrapRpc(await supabase.rpc('rebuild_tournament_standings', {
    ...projectionScopeParams(input),
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey || createIdempotencyKey(),
  }), 'No pudimos recalcular la competencia.');
}

export async function publishTournamentStandings(input) {
  return unwrapRpc(await supabase.rpc('publish_tournament_standings_revision', {
    p_revision_id: input.revisionId,
    p_reason: input.reason,
  }), 'No pudimos publicar la tabla.');
}

export async function resolveTournamentQualification(input) {
  return unwrapRpc(await supabase.rpc('resolve_tournament_qualification', {
    p_revision_id: input.revisionId,
    p_reason: input.reason,
  }), 'No pudimos resolver los clasificados.');
}

export async function createTournamentPointsAdjustment(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_points_adjustment', {
    p_organization_id: input.organizationId,
    p_fixture_version_id: input.fixtureVersionId,
    p_phase_id: input.phaseId,
    p_group_id: input.groupId || null,
    p_participant_id: input.participantId,
    p_points: input.points,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey || createIdempotencyKey(),
  }), 'No pudimos registrar el ajuste de puntos.');
}

export async function revokeTournamentPointsAdjustment(input) {
  return unwrapRpc(await supabase.rpc('revoke_tournament_points_adjustment', {
    p_adjustment_id: input.adjustmentId,
    p_reason: input.reason,
  }), 'No pudimos revocar el ajuste de puntos.');
}

export async function createTournamentDisciplinaryOverride(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_disciplinary_override', {
    p_suspension_id: input.suspensionId,
    p_action: input.action,
    p_matches: input.matches ?? null,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey || createIdempotencyKey(),
  }), 'No pudimos registrar el ajuste disciplinario.');
}

export async function markTournamentSuspensionServed(input) {
  return unwrapRpc(await supabase.rpc('mark_tournament_suspension_served', {
    p_suspension_id: input.suspensionId,
    p_match_id: input.matchId,
    p_note: input.note || null,
  }), 'No pudimos registrar la fecha cumplida.');
}

export async function loadPlayerTournamentStatistics(tournamentId) {
  return unwrapRpc(await supabase.rpc('get_player_tournament_statistics', {
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar tus estadísticas.');
}

export async function loadPlayerTournamentSuspensions(tournamentId) {
  return unwrapRpc(await supabase.rpc('get_player_tournament_suspensions', {
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar tus sanciones.');
}

export async function loadMyTournamentMemberships({
  limit = 20,
  offset = 0,
} = {}) {
  return unwrapRpc(await supabase.rpc('get_my_tournament_memberships', {
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar tus torneos.');
}

export async function loadTournamentExperienceRelations({
  pageSize = 50,
  maxItems = 500,
} = {}) {
  const items = [];
  let offset = 0;
  let pagination = null;
  let receivedItems = false;

  do {
    const payload = await loadMyTournamentMemberships({
      limit: pageSize,
      offset,
    });
    const page = Array.isArray(payload?.items) ? payload.items : [];
    receivedItems = page.length > 0;
    items.push(...page);
    pagination = payload?.pagination || null;
    offset += page.length;
  } while (
    pagination?.hasMore
    && offset < maxItems
    && receivedItems
  );

  return {
    items: items.slice(0, maxItems),
    pagination: {
      ...(pagination || {}),
      offset: 0,
      returned: Math.min(items.length, maxItems),
      truncated: Boolean(pagination?.hasMore && items.length >= maxItems),
    },
  };
}

export async function loadTournamentParticipantHub({
  tournamentId,
  categoryId = null,
}) {
  const hub = unwrapRpc(await supabase.rpc('get_tournament_participant_hub', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
  }), 'No pudimos cargar el centro del torneo.');
  const branding = await loadTournamentBrandingContext({
    organizationId: hub.tournament.organizationId,
    tournamentId,
  });
  const tournamentBranding = branding?.tournaments?.[0] || null;
  return {
    ...hub,
    tournament: {
      ...hub.tournament,
      logoPath: tournamentBranding?.logoPath || null,
      organizationLogoPath: branding?.organization?.logoPath || null,
    },
  };
}

export async function setTournamentHubCategory({
  tournamentId,
  categoryId,
}) {
  return unwrapRpc(await supabase.rpc('set_my_tournament_hub_category', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
  }), 'No pudimos cambiar de categoría.');
}

export async function loadPublishedTournamentMatches({
  tournamentId,
  categoryId,
  view = 'all',
  teamEntryId = null,
  limit = 20,
  offset = 0,
}) {
  return unwrapRpc(await supabase.rpc('get_published_tournament_matches', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_view: view,
    p_team_entry_id: teamEntryId,
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar los partidos publicados.');
}

export async function loadTournamentParticipantMatch(matchId) {
  return unwrapRpc(await supabase.rpc('get_tournament_participant_match', {
    p_match_id: matchId,
  }), 'No pudimos cargar el partido.');
}

export async function loadPublishedTournamentTeams({
  tournamentId,
  categoryId,
  limit = 16,
  offset = 0,
}) {
  return unwrapRpc(await supabase.rpc('get_published_tournament_teams', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar los equipos publicados.');
}

export async function loadPublishedTournamentStandings({
  tournamentId,
  categoryId,
  phaseId,
  groupId = null,
}) {
  return unwrapRpc(await supabase.rpc('get_published_tournament_standings', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_phase_id: phaseId,
    p_group_id: groupId,
  }), 'No pudimos cargar la tabla publicada.');
}

export async function loadPublishedTournamentStatistics({
  tournamentId,
  categoryId,
  phaseId,
  groupId = null,
}) {
  return unwrapRpc(await supabase.rpc('get_published_tournament_statistics', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_phase_id: phaseId,
    p_group_id: groupId,
  }), 'No pudimos cargar las estadísticas publicadas.');
}

export async function loadTournamentCommunicationsInbox({
  tournamentId = null,
  filter = 'all',
  limit = 20,
  offset = 0,
} = {}) {
  return unwrapRpc(await supabase.rpc('get_tournament_communications_inbox', {
    p_tournament_id: tournamentId,
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar las novedades.');
}

export async function loadTournamentAnnouncement(announcementId) {
  return unwrapRpc(await supabase.rpc('get_tournament_announcement', {
    p_announcement_id: announcementId,
  }), 'No pudimos abrir el comunicado.');
}

export async function markTournamentAnnouncementRead({
  announcementId,
  confirm = false,
}) {
  return unwrapRpc(await supabase.rpc('mark_tournament_announcement_read', {
    p_announcement_id: announcementId,
    p_confirm: confirm,
  }), 'No pudimos registrar la lectura.');
}

export async function loadTournamentNotificationPreferences(tournamentId) {
  return unwrapRpc(await supabase.rpc('get_my_tournament_notification_preferences', {
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar tus preferencias.');
}

export async function updateTournamentNotificationPreferences({
  tournamentId,
  general,
  matchChanges,
  callups,
  discipline,
  documents,
  summaries,
}) {
  return unwrapRpc(await supabase.rpc('update_my_tournament_notification_preferences', {
    p_tournament_id: tournamentId,
    p_general: general,
    p_match_changes: matchChanges,
    p_callups: callups,
    p_discipline: discipline,
    p_documents: documents,
    p_summaries: summaries,
  }), 'No pudimos actualizar tus preferencias.');
}

// ── CONNECTED-V1: Torneos profile, Torneos inbox, catalog and registration requests ─────────────

export async function loadTorneosProfile() {
  return unwrapRpc(await supabase.rpc('get_my_torneos_profile', {}), 'No pudimos cargar tu perfil de Torneos.');
}

export async function updateTorneosProfile({ displayName, notifyRegistrationRequests }) {
  return unwrapRpc(await supabase.rpc('update_my_torneos_profile', {
    p_display_name: displayName ?? null,
    p_notify_registration_requests: notifyRegistrationRequests,
  }), 'No pudimos guardar tu perfil de Torneos.');
}

export async function loadTorneosNotifications({ unreadOnly = false, limit = 20, offset = 0 } = {}) {
  return unwrapRpc(await supabase.rpc('get_my_torneos_notifications', {
    p_unread_only: unreadOnly,
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar tus avisos.');
}

export async function markTorneosNotificationsRead({ notificationIds = null } = {}) {
  return unwrapRpc(await supabase.rpc('mark_my_torneos_notifications_read', {
    p_notification_ids: notificationIds,
  }), 'No pudimos marcar los avisos como leídos.');
}

export async function loadTorneosInboxSummary() {
  return unwrapRpc(await supabase.rpc('get_my_torneos_inbox_summary', {}), 'No pudimos cargar tus avisos.');
}

export async function loadTournamentCatalogListingSettings({ organizationId, tournamentId }) {
  return unwrapRpc(await supabase.rpc('get_tournament_catalog_listing_settings', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar la convocatoria.');
}

export async function saveTournamentCatalogListing({
  organizationId,
  tournamentId,
  summary,
  locality,
  venueId = null,
  entryFeeCents = null,
  entryFeeIncludes = null,
  paymentNote = null,
  requirements = null,
  rulesSummary = null,
}) {
  return unwrapRpc(await supabase.rpc('save_tournament_catalog_listing', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_summary: summary ?? null,
    p_locality: locality ?? null,
    p_venue_id: venueId,
    p_entry_fee_cents: entryFeeCents,
    p_entry_fee_includes: entryFeeIncludes,
    p_payment_note: paymentNote,
    p_requirements: requirements,
    p_rules_summary: rulesSummary,
  }), 'No pudimos guardar la convocatoria.');
}

export async function setTournamentCatalogListingStatus({ organizationId, tournamentId, listed }) {
  return unwrapRpc(await supabase.rpc('set_tournament_catalog_listing_status', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_listed: listed,
  }), 'No pudimos cambiar la publicación en el catálogo.');
}

export async function setTournamentApplicationsState({ organizationId, tournamentId, state }) {
  return unwrapRpc(await supabase.rpc('set_tournament_applications_state', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_state: state,
  }), 'No pudimos cambiar la recepción de solicitudes.');
}

export async function saveTournamentCategoryCapacity({ organizationId, tournamentId, categoryId, maxTeams = null }) {
  return unwrapRpc(await supabase.rpc('save_tournament_category_capacity', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_max_teams: maxTeams,
  }), 'No pudimos guardar el cupo.');
}

export async function loadTournamentApplicationInbox({
  organizationId,
  tournamentId,
  status = 'submitted',
  limit = 20,
  offset = 0,
}) {
  return unwrapRpc(await supabase.rpc('get_tournament_application_inbox', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar las solicitudes.');
}

export async function searchApplicableCoreTeams({ publicSlug, query, limit = 8 }) {
  return unwrapRpc(await supabase.rpc('search_my_applicable_core_teams', {
    p_public_slug: publicSlug,
    p_query: query,
    p_limit: limit,
  }), 'No pudimos buscar tus equipos.');
}

export async function startTournamentApplication({
  publicSlug,
  categorySlug,
  coreTeamId = null,
  teamName = null,
  message = null,
  acceptConditions,
  idempotencyKey,
}) {
  return unwrapRpc(await supabase.rpc('start_tournament_application', {
    p_public_slug: publicSlug,
    p_category_slug: categorySlug,
    p_core_team_id: coreTeamId,
    p_team_name: teamName,
    p_message: message,
    p_accept_conditions: acceptConditions,
    p_idempotency_key: idempotencyKey,
  }), 'No pudimos crear la solicitud.');
}

export async function loadMyTournamentRegistrations({ limit = 20, offset = 0 } = {}) {
  return unwrapRpc(await supabase.rpc('get_my_tournament_registrations', {
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar tus inscripciones.');
}

export async function loadPublishedTournamentDocuments({
  tournamentId,
  categoryId = null,
}) {
  return unwrapRpc(await supabase.rpc('get_published_tournament_documents', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
  }), 'No pudimos cargar los documentos oficiales.');
}

export async function acknowledgeTournamentDocument({
  versionId,
  confirm = false,
}) {
  return unwrapRpc(await supabase.rpc('acknowledge_tournament_document', {
    p_version_id: versionId,
    p_confirm: confirm,
  }), 'No pudimos registrar la lectura del documento.');
}

export async function loadTournamentCommunicationsAdminContext({
  organizationId,
  tournamentId = null,
}) {
  return unwrapRpc(await supabase.rpc('get_tournament_communications_admin_context', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
  }), 'No pudimos cargar el centro de comunicaciones.');
}

export async function createTournamentAnnouncementDraft({
  organizationId,
  tournamentId,
  categoryId = null,
  type,
  title,
  summary,
  body,
  priority = 'normal',
  acknowledgementMode = 'none',
  scheduledFor = null,
  supersedesId = null,
  correctionReason = null,
  idempotencyKey,
}) {
  return unwrapRpc(await supabase.rpc('create_tournament_announcement_draft', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_announcement_type: type,
    p_title: title,
    p_summary: summary,
    p_body: body,
    p_priority: priority,
    p_acknowledgement_mode: acknowledgementMode,
    p_scheduled_for: scheduledFor,
    p_supersedes_id: supersedesId,
    p_correction_reason: correctionReason,
    p_idempotency_key: idempotencyKey,
  }), 'No pudimos crear el borrador.');
}

export async function setTournamentAnnouncementAudience({
  announcementId,
  type,
  categoryId = null,
  teamEntryId = null,
  matchId = null,
  specificUserId = null,
}) {
  return unwrapRpc(await supabase.rpc('set_tournament_announcement_audience', {
    p_announcement_id: announcementId,
    p_audience_type: type,
    p_category_id: categoryId,
    p_team_entry_id: teamEntryId,
    p_match_id: matchId,
    p_specific_user_id: specificUserId,
  }), 'No pudimos definir la audiencia.');
}

export async function replaceTournamentAnnouncementAudience({
  announcementId,
  type,
  categoryId = null,
  teamEntryId = null,
  matchId = null,
  specificUserId = null,
}) {
  return unwrapRpc(await supabase.rpc('replace_tournament_announcement_audience', {
    p_announcement_id: announcementId,
    p_audience_type: type,
    p_category_id: categoryId,
    p_team_entry_id: teamEntryId,
    p_match_id: matchId,
    p_specific_user_id: specificUserId,
  }), 'No pudimos reemplazar la audiencia.');
}

export async function setTournamentAnnouncementLink({
  announcementId,
  type,
  resourceId = null,
  externalUrl = null,
  label,
  sortOrder = 0,
}) {
  return unwrapRpc(await supabase.rpc('set_tournament_announcement_link', {
    p_announcement_id: announcementId,
    p_link_type: type,
    p_resource_id: resourceId,
    p_external_url: externalUrl,
    p_label: label,
    p_sort_order: sortOrder,
  }), 'No pudimos definir el enlace principal.');
}

export async function updateTournamentAnnouncementDraft({
  announcementId,
  title,
  summary,
  body,
  priority = 'normal',
  acknowledgementMode = 'none',
  scheduledFor = null,
}) {
  return unwrapRpc(await supabase.rpc('update_tournament_announcement_draft', {
    p_announcement_id: announcementId,
    p_title: title,
    p_summary: summary,
    p_body: body,
    p_priority: priority,
    p_acknowledgement_mode: acknowledgementMode,
    p_scheduled_for: scheduledFor,
  }), 'No pudimos actualizar el borrador.');
}

export async function previewTournamentAnnouncementAudience(announcementId) {
  return unwrapRpc(await supabase.rpc('preview_tournament_announcement_audience', {
    p_announcement_id: announcementId,
  }), 'No pudimos previsualizar la audiencia.');
}

export async function publishTournamentAnnouncement({
  announcementId,
  expectedRecipientCount = null,
}) {
  return unwrapRpc(await supabase.rpc('publish_tournament_announcement', {
    p_announcement_id: announcementId,
    p_expected_recipient_count: expectedRecipientCount,
  }), 'No pudimos publicar el comunicado.');
}

export async function createTournamentDocument({
  organizationId,
  tournamentId,
  categoryId = null,
  type,
  title,
  summary,
  body,
  acknowledgementMode = 'none',
  effectiveAt = null,
  idempotencyKey,
}) {
  return unwrapRpc(await supabase.rpc('create_tournament_document', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_document_type: type,
    p_title: title,
    p_summary: summary,
    p_body: body,
    p_acknowledgement_mode: acknowledgementMode,
    p_effective_at: effectiveAt,
    p_idempotency_key: idempotencyKey,
  }), 'No pudimos crear el documento.');
}

export async function publishTournamentDocumentVersion(versionId) {
  return unwrapRpc(await supabase.rpc('publish_tournament_document_version', {
    p_version_id: versionId,
  }), 'No pudimos publicar el documento.');
}

export async function loadTournamentMediaAdminContext({
  organizationId,
  tournamentId = null,
  status = null,
  limit = 30,
  offset = 0,
}) {
  const [contextResult, capabilityResult, tiersResult] = await Promise.all([
    supabase.rpc('get_tournament_media_admin_context', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    }),
    supabase.rpc('get_tournament_media_upload_capability', {
      p_organization_id: organizationId,
    }),
    supabase.rpc('get_tournament_media_asset_processing_tiers', {
      p_organization_id: organizationId,
    }),
  ]);
  const context = unwrapRpc(contextResult, 'No pudimos cargar el Centro Multimedia.');
  const storage = unwrapRpc(capabilityResult, 'No pudimos verificar la carga de fotos.');
  const processingTiers = unwrapRpc(tiersResult, 'No pudimos cargar las fotos.');
  const entitlementTournamentId = tournamentId || context.tournaments?.[0]?.id || null;
  const entitlements = entitlementTournamentId
    ? unwrapRpc(
      await supabase.rpc('get_effective_tournament_entitlements', {
        p_organization_id: organizationId,
        p_tournament_id: entitlementTournamentId,
      }),
      'No pudimos cargar la política multimedia.',
    )
    : null;
  const galleries = (context.galleries || []).map((gallery) => ({
    ...gallery,
    assets: (gallery.assets || []).map((asset) => ({
      ...asset,
      processingTier: processingTiers?.[asset.id] || 'processor_external',
    })),
  }));
  return { ...context, galleries, storage, entitlements };
}

export async function createTournamentMediaGallery({
  organizationId,
  tournamentId,
  categoryId = null,
  roundId = null,
  matchId = null,
  title,
  description = '',
  visibility = 'tournament_participants',
  idempotencyKey,
}) {
  return unwrapRpc(await supabase.rpc('create_tournament_media_gallery', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_round_id: roundId,
    p_match_id: matchId,
    p_title: title,
    p_description: description,
    p_visibility: visibility,
    p_idempotency_key: idempotencyKey,
  }), 'No pudimos crear la galería.');
}

export async function updateTournamentMediaGallery({
  galleryId,
  title,
  description = '',
  visibility,
  submitForReview = false,
}) {
  return unwrapRpc(await supabase.rpc('update_tournament_media_gallery', {
    p_gallery_id: galleryId,
    p_title: title,
    p_description: description,
    p_visibility: visibility,
    p_submit_for_review: submitForReview,
  }), 'No pudimos actualizar la galería.');
}

export async function requestTournamentMediaUploadSession({
  galleryId,
  fileName,
  mime,
  byteSize,
  idempotencyKey,
}) {
  return unwrapRpc(await supabase.rpc('request_tournament_media_upload_session', {
    p_gallery_id: galleryId,
    p_file_name: fileName,
    p_declared_mime: mime,
    p_byte_size: byteSize,
    p_idempotency_key: idempotencyKey,
  }), 'No pudimos preparar la carga.');
}

export async function cancelTournamentMediaUploadSession(sessionId) {
  return unwrapRpc(await supabase.rpc('cancel_tournament_media_upload_session', {
    p_session_id: sessionId,
  }), 'No pudimos cancelar la preparación de la foto.');
}

export async function transitionTournamentMediaAsset({
  assetId,
  action,
  reason = null,
}) {
  return unwrapRpc(await supabase.rpc('transition_tournament_media_asset', {
    p_asset_id: assetId,
    p_action: action,
    p_reason: reason,
  }), 'No pudimos actualizar el estado de la foto.');
}

export async function setTournamentMediaCover({ galleryId, assetId }) {
  return unwrapRpc(await supabase.rpc('set_tournament_media_cover', {
    p_gallery_id: galleryId,
    p_asset_id: assetId,
  }), 'No pudimos elegir la portada.');
}

export async function reorderTournamentMediaItem({
  galleryId,
  assetId,
  targetOrder,
}) {
  return unwrapRpc(await supabase.rpc('reorder_tournament_media_item', {
    p_gallery_id: galleryId,
    p_asset_id: assetId,
    p_target_order: targetOrder,
  }), 'No pudimos reordenar la foto.');
}

export async function publishTournamentMediaGallery(galleryId) {
  return unwrapRpc(await supabase.rpc('publish_tournament_media_gallery', {
    p_gallery_id: galleryId,
  }), 'No pudimos publicar la galería.');
}

export async function changeTournamentMediaGalleryState({
  galleryId,
  action,
  reason,
}) {
  return unwrapRpc(await supabase.rpc('change_tournament_media_gallery_state', {
    p_gallery_id: galleryId,
    p_action: action,
    p_reason: reason,
  }), 'No pudimos actualizar la galería.');
}

export async function loadPublishedTournamentMedia({
  tournamentId,
  categoryId = null,
  matchId = null,
  limit = 20,
  offset = 0,
}) {
  return unwrapRpc(await supabase.rpc('get_published_tournament_media', {
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_match_id: matchId,
    p_limit: limit,
    p_offset: offset,
  }), 'No pudimos cargar las fotos.');
}

export async function reportTournamentMediaAsset({
  assetId,
  reason,
  detail = '',
  requestHide = false,
  idempotencyKey,
}) {
  return unwrapRpc(await supabase.rpc('report_tournament_media_asset', {
    p_asset_id: assetId,
    p_reason: reason,
    p_detail: detail,
    p_request_hide: requestHide,
    p_idempotency_key: idempotencyKey,
  }), 'No pudimos enviar el reporte.');
}

/**
 * Runs one photo through the whole pipeline. The session RPCs are injected so
 * the upload client never reaches back into this module, and so tests can
 * drive the flow without a Supabase client.
 */
export async function uploadTournamentMediaPhotoToGallery(options) {
  return uploadTournamentMediaPhoto({
    ...options,
    requestUploadSession: requestTournamentMediaUploadSession,
    cancelUploadSession: cancelTournamentMediaUploadSession,
  });
}

export async function deleteTournamentMediaAssetPermanently(assetId, options) {
  return deleteTournamentMediaAsset(assetId, options);
}

export async function loadTournamentSocialStudioContext(organizationId) {
  return unwrapRpc(await supabase.rpc('get_tournament_social_studio_context', {
    p_organization_id: organizationId,
  }), 'No pudimos abrir el Estudio Social.');
}

export async function loadTournamentSocialSnapshot({
  organizationId,
  tournamentId,
  categoryId,
  phaseId,
  piece,
  roundId = null,
  groupId = null,
}) {
  return unwrapRpc(await supabase.rpc('get_tournament_social_snapshot', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_category_id: categoryId,
    p_phase_id: phaseId,
    p_piece: piece,
    p_round_id: roundId,
    p_group_id: groupId,
  }), 'No pudimos preparar esta pieza con datos oficiales.');
}

export async function authorizeTournamentSocialExport({
  organizationId,
  tournamentId,
  piece,
  theme,
  includeArma2Branding,
}) {
  return unwrapRpc(await supabase.rpc('authorize_tournament_social_export', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
    p_piece: piece,
    p_theme: theme,
    p_include_arma2_branding: Boolean(includeArma2Branding),
  }), 'No pudimos autorizar la exportación de esta pieza.');
}

export async function setTournamentSocialPermission({
  organizationId,
  userId,
  canExport,
}) {
  return unwrapRpc(await supabase.rpc('set_tournament_social_permission', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_can_export: canExport,
  }), 'No pudimos actualizar el permiso del Estudio Social.');
}

export function resolveTeamShieldUrl(shieldPath) {
  return resolveBrandingAssetUrl({ kind: 'team', path: shieldPath });
}

export function resolveTournamentLogoUrl(logoPath) {
  return resolveBrandingAssetUrl({ kind: 'tournament', path: logoPath });
}

export async function handleTournamentMediaReport({
  reportId,
  status,
  resolution,
}) {
  return unwrapRpc(await supabase.rpc('handle_tournament_media_report', {
    p_report_id: reportId,
    p_status: status,
    p_resolution: resolution,
  }), 'No pudimos resolver el reporte.');
}

export const tournamentWorkspaceService = Object.freeze({
  loadContext: loadTournamentWorkspaceContext,
  loadEntitlements: loadEffectiveTournamentEntitlements,
  loadSeasonEntitlements: loadEffectiveTournamentSeasonEntitlements,
  createCheckout: createTournamentCheckout,
  loadPurchase: loadTournamentPurchase,
  simulateFakePayment: simulateFakeTournamentPayment,
  cancelPurchase: cancelTournamentPurchase,
  loadSeasonMediaUsage: loadTournamentSeasonMediaUsage,
  listSeasonMemberAssignments: listTournamentSeasonMemberAssignments,
  assignSeasonMember: assignTournamentSeasonMember,
  removeSeasonMemberAssignment: removeTournamentSeasonMemberAssignment,
  loadTournamentCreationEligibility,
  createOrganization: createTournamentOrganization,
  checkSlugAvailability: checkTournamentOrganizationSlugAvailability,
  setPreference: setTournamentWorkspacePreference,
  updateOrganization: updateTournamentOrganization,
  listMembers: listTournamentOrganizationMembers,
  loadCompetitionContext: loadTournamentCompetitionContext,
  createSeason: createTournamentSeason,
  updateSeason: updateTournamentSeason,
  createTournament: createTournamentCompetition,
  updateTournament: updateTournamentCompetition,
  saveCategory: saveTournamentCategory,
  changeTournamentStatus: changeTournamentCompetitionStatus,
  startCompetition: startTournamentCompetition,
  finishCompetition: finishTournamentCompetition,
  reopenCompetition: reopenTournamentCompetition,
  withdrawCompetitionParticipant: withdrawTournamentCompetitionParticipant,
  setTournamentContext: setActiveTournamentContext,
  loadTeamsContext: loadTournamentTeamsContext,
  loadTeamRegistration: loadTeamRegistrationContext,
  createTeamEntry: createTournamentTeamEntry,
  updateTeamEntry: updateTournamentTeamEntry,
  createProvisionalPlayer: createTournamentProvisionalPlayer,
  addRosterPlayer: addTournamentRosterPlayer,
  updateRosterPlayer: updateTournamentRosterPlayer,
  removeRosterPlayer: removeTournamentRosterPlayer,
  submitTeamEntry: submitTournamentTeamEntry,
  reviewTeamEntry: reviewTournamentTeamEntry,
  withdrawTeamEntry: withdrawTournamentTeamEntry,
  archiveTeamEntry: archiveTournamentTeamEntry,
  lockRoster: lockTournamentRoster,
  inviteTeamManager: inviteTournamentTeamManager,
  acceptTeamInvitation: acceptTournamentTeamInvitation,
  searchPlayers: searchTournamentPlayers,
  searchArma2Teams: searchTournamentArma2Teams,
  loadFixtureContext: loadTournamentFixtureContext,
  loadScheduleContext: loadTournamentScheduleContext,
  freezeParticipants: freezeTournamentParticipants,
  reopenParticipants: reopenTournamentParticipants,
  saveDrawPots: saveTournamentDrawPots,
  executeGroupDraw: executeTournamentGroupDraw,
  generateFixture: generateTournamentFixture,
  createManualFixture: createManualTournamentFixture,
  updateDraftFixture: updateDraftTournamentFixture,
  validateFixture: validateTournamentFixture,
  publishFixture: publishTournamentFixture,
  appendPlayoffPhase: appendTournamentPlayoffPhase,
  archiveFixture: archiveTournamentFixture,
  supersedeFixture: supersedeTournamentFixture,
  loadOrganizationVenues: loadTournamentOrganizationVenues,
  createVenue: createTournamentVenue,
  updateVenue: updateTournamentVenue,
  createCourt: createTournamentCourt,
  updateCourt: updateTournamentCourt,
  saveScheduleWindows: saveTournamentScheduleWindows,
  validateMatchSchedule: validateTournamentMatchSchedule,
  scheduleMatch: scheduleTournamentMatch,
  rescheduleMatch: rescheduleTournamentMatch,
  changeMatchPlan: changeTournamentMatchPlan,
  autoScheduleMatches: autoScheduleTournamentMatches,
  loadPlayerMatches: loadPlayerTournamentMatches,
  respondMatchAvailability: respondTournamentMatchAvailability,
  recordManualMatchAvailability: recordManualTournamentMatchAvailability,
  loadMatchOperations: loadTournamentMatchOperations,
  loadMatchOperation: loadTournamentMatchOperation,
  loadMatchSquad: loadTournamentMatchSquad,
  loadMyManagedMatchSquad: loadMyManagedTournamentMatchSquad,
  saveMatchSquad: saveTournamentMatchSquad,
  submitMatchSquad: submitTournamentMatchSquad,
  openMatchOperation: openTournamentMatchOperation,
  saveMatchOperationDraft: saveTournamentMatchOperationDraft,
  setMatchOutcome: setTournamentMatchOutcome,
  setMatchScore: setTournamentMatchScore,
  addMatchEvent: addTournamentMatchEvent,
  voidMatchEvent: voidTournamentMatchEvent,
  submitMatchOperation: submitTournamentMatchOperation,
  reviewMatchOperation: reviewTournamentMatchOperation,
  validateMatchOperation: validateTournamentMatchOperation,
  makeMatchOfficial: makeTournamentMatchOfficial,
  requestMatchCorrection: requestTournamentMatchCorrection,
  createMatchCorrection: createTournamentMatchCorrection,
  voidMatchOperation: voidTournamentMatchOperation,
  loadStandings: loadTournamentStandings,
  loadStatistics: loadTournamentStatistics,
  rebuildStandings: rebuildTournamentStandings,
  publishStandings: publishTournamentStandings,
  resolveQualification: resolveTournamentQualification,
  createPointsAdjustment: createTournamentPointsAdjustment,
  revokePointsAdjustment: revokeTournamentPointsAdjustment,
  createDisciplinaryOverride: createTournamentDisciplinaryOverride,
  markSuspensionServed: markTournamentSuspensionServed,
  loadPlayerStatistics: loadPlayerTournamentStatistics,
  loadPlayerSuspensions: loadPlayerTournamentSuspensions,
  loadMyTournaments: loadMyTournamentMemberships,
  loadExperienceRelations: loadTournamentExperienceRelations,
  loadParticipantHub: loadTournamentParticipantHub,
  setHubCategory: setTournamentHubCategory,
  loadPublishedMatches: loadPublishedTournamentMatches,
  loadParticipantMatch: loadTournamentParticipantMatch,
  loadPublishedTeams: loadPublishedTournamentTeams,
  loadPublishedStandings: loadPublishedTournamentStandings,
  loadPublishedStatistics: loadPublishedTournamentStatistics,
  loadCommunicationsInbox: loadTournamentCommunicationsInbox,
  loadAnnouncement: loadTournamentAnnouncement,
  markAnnouncementRead: markTournamentAnnouncementRead,
  loadNotificationPreferences: loadTournamentNotificationPreferences,
  updateNotificationPreferences: updateTournamentNotificationPreferences,
  loadPublishedDocuments: loadPublishedTournamentDocuments,
  acknowledgeDocument: acknowledgeTournamentDocument,
  loadCommunicationsAdminContext: loadTournamentCommunicationsAdminContext,
  createAnnouncementDraft: createTournamentAnnouncementDraft,
  updateAnnouncementDraft: updateTournamentAnnouncementDraft,
  setAnnouncementAudience: setTournamentAnnouncementAudience,
  replaceAnnouncementAudience: replaceTournamentAnnouncementAudience,
  setAnnouncementLink: setTournamentAnnouncementLink,
  previewAnnouncementAudience: previewTournamentAnnouncementAudience,
  publishAnnouncement: publishTournamentAnnouncement,
  createDocument: createTournamentDocument,
  publishDocumentVersion: publishTournamentDocumentVersion,
  loadMediaAdminContext: loadTournamentMediaAdminContext,
  createMediaGallery: createTournamentMediaGallery,
  updateMediaGallery: updateTournamentMediaGallery,
  requestMediaUploadSession: requestTournamentMediaUploadSession,
  cancelMediaUploadSession: cancelTournamentMediaUploadSession,
  transitionMediaAsset: transitionTournamentMediaAsset,
  setMediaCover: setTournamentMediaCover,
  reorderMediaItem: reorderTournamentMediaItem,
  publishMediaGallery: publishTournamentMediaGallery,
  changeMediaGalleryState: changeTournamentMediaGalleryState,
  loadPublishedMedia: loadPublishedTournamentMedia,
  reportMediaAsset: reportTournamentMediaAsset,
  handleMediaReport: handleTournamentMediaReport,
  uploadMediaPhoto: uploadTournamentMediaPhotoToGallery,
  signMediaReadUrls: signTournamentMediaReadUrls,
  deleteMediaAsset: deleteTournamentMediaAssetPermanently,
  loadSocialStudioContext: loadTournamentSocialStudioContext,
  loadSocialSnapshot: loadTournamentSocialSnapshot,
  authorizeSocialExport: authorizeTournamentSocialExport,
  setSocialPermission: setTournamentSocialPermission,
  loadPublicPageSettings: loadTournamentPublicPageSettings,
  setPublicPagePublished: setTournamentPublicPagePublished,
  loadTeamVisualPolicy: loadTournamentTeamVisualPolicy,
  setTeamVisualPolicy: setTournamentTeamVisualPolicy,
  loadTorneosProfile,
  updateTorneosProfile,
  loadTorneosNotifications,
  markTorneosNotificationsRead,
  loadTorneosInboxSummary,
  loadCatalogListingSettings: loadTournamentCatalogListingSettings,
  saveCatalogListing: saveTournamentCatalogListing,
  setCatalogListingStatus: setTournamentCatalogListingStatus,
  setApplicationsState: setTournamentApplicationsState,
  saveCategoryCapacity: saveTournamentCategoryCapacity,
  loadApplicationInbox: loadTournamentApplicationInbox,
  searchApplicableCoreTeams,
  startTournamentApplication,
  loadMyRegistrations: loadMyTournamentRegistrations,
  resolveTeamShieldUrl,
  resolveTournamentLogoUrl,
  createIdempotencyKey,
});
