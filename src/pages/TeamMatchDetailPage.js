import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, Flag, MapPin, Shield, Users } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import PageTransition from '../components/PageTransition';
import Button from '../components/Button';
import Modal from '../components/Modal';
import ProfileCardModal from '../components/ProfileCardModal';
import LocationAutocomplete from '../features/equipos/components/LocationAutocomplete';
import { TEAM_FORMAT_OPTIONS, TEAM_MODE_OPTIONS } from '../features/equipos/config';
import { getTeamGradientStyle } from '../features/equipos/utils/teamColors';
import {
  canManageTeamMatch,
  cancelTeamMatch,
  getTeamMatchById,
  listTeamMatchMembers,
  updateTeamMatchDetails,
} from '../services/db/teamChallenges';
import { notifyBlockingError } from '../utils/notifyBlockingError';

const AVATAR_VISIBLE_LIMIT = 6;

const toDateTimeLocalValue = (isoDate) => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const formatDateTime = (value) => {
  if (!value) return 'A coordinar';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'A coordinar';
  return parsed.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatMoneyAr = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const statusLabelByValue = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  played: 'Jugado',
  cancelled: 'Cancelado',
};

const getOriginBadgeClass = (originType) => {
  if (String(originType || '').toLowerCase() === 'challenge') {
    return 'border-[#6B7280] bg-[#374151]/70 text-[#E5E7EB]';
  }
  return 'border-[#3B82F6] bg-[#1E3A5F]/75 text-[#DBEAFE]';
};

const buildMapsSearchUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
};

const getPlayerName = (member) => String(member?.jugador?.nombre || 'Jugador').trim();

const getPlayerAvatar = (member) => (
  member?.photo_url
  || member?.jugador?.avatar_url
  || null
);

const getPlayerProfile = (member) => {
  const userId = member?.user_id || member?.jugador?.usuario_id || null;
  const fallbackId = member?.jugador?.id || member?.jugador_id || null;

  return {
    id: userId || fallbackId,
    usuario_id: userId,
    user_id: userId,
    nombre: getPlayerName(member),
    avatar_url: getPlayerAvatar(member),
    ranking: member?.jugador?.score ?? null,
  };
};

const getInitials = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'J';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
};

const TeamCardLocked = ({
  team,
  fallbackName,
  members,
  onOpenProfile,
  onOpenRoster,
}) => {
  const visibleMembers = (members || []).slice(0, AVATAR_VISIBLE_LIMIT);
  const overflowCount = Math.max(0, (members || []).length - visibleMembers.length);

  return (
    <div
      className="rounded-xl border border-white/15 bg-[#1e293b]/60 p-3 min-h-[116px] min-w-0"
      style={team ? getTeamGradientStyle(team) : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="h-10 w-10 rounded-lg overflow-hidden border border-white/25 bg-black/20 flex items-center justify-center shrink-0">
          {team?.crest_url ? (
            <img src={team.crest_url} alt={team?.name || fallbackName} className="h-full w-full object-cover" />
          ) : (
            <Shield size={18} className="text-white/70" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-white font-oswald text-[15px] font-semibold truncate">{team?.name || fallbackName}</div>
          <div className="text-[11px] text-white/65 font-oswald">F{team?.format || '-'}</div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 min-h-[32px]">
        {visibleMembers.length > 0 ? visibleMembers.map((member) => {
          const name = getPlayerName(member);
          const avatar = getPlayerAvatar(member);
          return (
            <button
              key={`${member?.id || member?.jugador_id || name}`}
              type="button"
              onClick={() => onOpenProfile(getPlayerProfile(member))}
              className="h-8 w-8 rounded-full border border-white/30 bg-slate-900/70 overflow-hidden flex items-center justify-center text-[10px] font-semibold text-white/90 shrink-0"
              title={name}
              aria-label={`Ver perfil de ${name}`}
            >
              {avatar ? (
                <img src={avatar} alt={name} className="h-full w-full object-cover" />
              ) : (
                <span>{getInitials(name)}</span>
              )}
            </button>
          );
        }) : (
          <span className="text-[11px] text-white/55 font-oswald">Sin jugadores</span>
        )}

        {overflowCount > 0 ? (
          <button
            type="button"
            onClick={onOpenRoster}
            className="h-8 min-w-[32px] px-2 rounded-full border border-white/30 bg-slate-900/70 text-[11px] text-white/85 font-oswald shrink-0"
            aria-label={`Ver ${overflowCount} jugadores mas`}
            title="Ver plantilla completa"
          >
            +{overflowCount}
          </button>
        ) : null}
      </div>
    </div>
  );
};

const TeamMatchDetailPage = () => {
  const navigate = useNavigate();
  const { matchId } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [match, setMatch] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [teamMembersByTeamId, setTeamMembersByTeamId] = useState({});
  const [rosterTeamId, setRosterTeamId] = useState(null);
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState(null);

  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [canchaCostInput, setCanchaCostInput] = useState('');
  const [modeInput, setModeInput] = useState('');
  const [formatInput, setFormatInput] = useState('');

  const syncFormWithMatch = useCallback((nextMatch) => {
    setScheduledAtInput(toDateTimeLocalValue(nextMatch?.scheduled_at));
    setLocationInput(nextMatch?.location || nextMatch?.location_name || '');
    setCanchaCostInput(
      nextMatch?.cancha_cost == null || Number.isNaN(Number(nextMatch?.cancha_cost))
        ? ''
        : String(nextMatch.cancha_cost),
    );
    setModeInput(nextMatch?.mode || '');
    setFormatInput(nextMatch?.format ? String(nextMatch.format) : '');
  }, []);

  const loadMembersForMatch = useCallback(async (matchRow) => {
    const teamIds = [matchRow?.team_a_id, matchRow?.team_b_id]
      .filter(Boolean)
      .map((value) => String(value));
    if (teamIds.length === 0) {
      setTeamMembersByTeamId({});
      return;
    }

    const membersByTeamId = await listTeamMatchMembers({
      matchId: matchRow?.id || null,
      teamIds,
    });

    setTeamMembersByTeamId(membersByTeamId || {});
  }, []);

  const loadData = useCallback(async () => {
    if (!matchId) return;

    try {
      setLoading(true);
      const [matchRow, canManageValue] = await Promise.all([
        getTeamMatchById(matchId),
        canManageTeamMatch(matchId),
      ]);
      setMatch(matchRow);
      setCanManage(Boolean(canManageValue));
      syncFormWithMatch(matchRow);
      await loadMembersForMatch(matchRow);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el partido');
    } finally {
      setLoading(false);
    }
  }, [loadMembersForMatch, matchId, syncFormWithMatch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const matchLocation = useMemo(
    () => (match?.location || match?.location_name || ''),
    [match?.location, match?.location_name],
  );

  const canchaCoordinar = useMemo(() => (
    !matchLocation || match?.cancha_cost == null
  ), [match?.cancha_cost, matchLocation]);

  const mapsLocationUrl = useMemo(
    () => buildMapsSearchUrl(matchLocation),
    [matchLocation],
  );

  const rosterTeam = useMemo(() => {
    if (!rosterTeamId || !match) return null;
    if (match?.team_a_id === rosterTeamId) return match?.team_a || null;
    if (match?.team_b_id === rosterTeamId) return match?.team_b || null;
    return null;
  }, [match, rosterTeamId]);

  const rosterMembers = useMemo(
    () => (rosterTeamId ? (teamMembersByTeamId[rosterTeamId] || []) : []),
    [rosterTeamId, teamMembersByTeamId],
  );

  const handleSave = async (event) => {
    event.preventDefault();
    if (!match?.id) return;

    const parsedCanchaCost = canchaCostInput.trim() === '' ? null : Number(canchaCostInput);
    if (parsedCanchaCost != null && (!Number.isFinite(parsedCanchaCost) || parsedCanchaCost < 0)) {
      notifyBlockingError('El costo de cancha debe ser un numero valido');
      return;
    }

    const parsedFormat = Number(formatInput);
    if (!Number.isFinite(parsedFormat) || !TEAM_FORMAT_OPTIONS.includes(parsedFormat)) {
      notifyBlockingError('Selecciona un formato valido (F5, F6, F7, F8, F9 o F11)');
      return;
    }

    try {
      setSaving(true);
      const updated = await updateTeamMatchDetails({
        matchId: match.id,
        scheduledAt: scheduledAtInput ? new Date(scheduledAtInput).toISOString() : null,
        location: locationInput.trim() || null,
        canchaCost: parsedCanchaCost,
        mode: modeInput.trim() || null,
        format: parsedFormat,
      });

      let nextMatch = updated;
      try {
        const hydrated = await getTeamMatchById(updated?.id || match.id);
        if (hydrated?.id) {
          nextMatch = hydrated;
        }
      } catch {
        // Keep updated payload when hydration fails.
      }

      setMatch(nextMatch);
      syncFormWithMatch(nextMatch);
      await loadMembersForMatch(nextMatch);

      navigate('/', {
        state: {
          openProximosPartidos: true,
        },
      });
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo actualizar el partido');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelMatch = async () => {
    if (!match?.id) return;
    const confirmed = window.confirm('Cancelar este partido?');
    if (!confirmed) return;

    try {
      setSaving(true);
      const cancelled = await cancelTeamMatch(match.id);
      const nextMatch = cancelled?.id ? { ...match, ...cancelled } : cancelled;
      setMatch(nextMatch);
      syncFormWithMatch(nextMatch);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cancelar el partido');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageTransition>
      <PageTitle title="Detalle partido" onBack={() => navigate(-1)}>
        Detalle partido
      </PageTitle>

      <div className="w-full flex justify-center px-4 pt-[108px] pb-8">
        <div className="w-full max-w-[560px] space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              Cargando partido...
            </div>
          ) : null}

          {!loading && !match ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              No encontramos este partido o no tenes acceso.
            </div>
          ) : null}

          {!loading && match ? (
            <>
              <div className="rounded-2xl border border-white/15 bg-[#1e293b]/65 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-oswald uppercase tracking-wide ${getOriginBadgeClass(match?.origin_type)}`}>
                    <Flag size={12} /> {match?.origin_type === 'challenge' ? 'Desafio' : 'Amistoso'}
                  </span>
                  <span className="inline-flex items-center rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-[11px] text-white/80 font-oswald uppercase tracking-wide">
                    {statusLabelByValue[match?.status] || match?.status || 'Pendiente'}
                  </span>
                  <span className="inline-flex items-center rounded-lg border border-[#9ED3FF]/40 bg-[#128BE9]/20 px-2 py-1 text-[11px] text-[#D4EBFF] font-oswald uppercase tracking-wide">
                    F{match?.format || '-'}
                  </span>
                </div>

                <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-2 sm:items-center">
                  <TeamCardLocked
                    team={match?.team_a}
                    fallbackName="Equipo A"
                    members={teamMembersByTeamId[match?.team_a_id] || []}
                    onOpenProfile={setSelectedPlayerProfile}
                    onOpenRoster={() => setRosterTeamId(match?.team_a_id)}
                  />
                  <div className="text-center text-white/70 text-sm sm:text-base font-oswald font-semibold tracking-[0.12em]">
                    VS
                  </div>
                  <TeamCardLocked
                    team={match?.team_b}
                    fallbackName="Equipo B"
                    members={teamMembersByTeamId[match?.team_b_id] || []}
                    onOpenProfile={setSelectedPlayerProfile}
                    onOpenRoster={() => setRosterTeamId(match?.team_b_id)}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/15 bg-[#0f172acc] p-4 space-y-3">
                <div className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <p className="text-xs text-white/60 uppercase tracking-wide font-oswald">Fecha y hora</p>
                  <p className="mt-1 text-white font-oswald text-base inline-flex items-center gap-2">
                    <CalendarClock size={16} /> {formatDateTime(match?.scheduled_at)}
                  </p>
                </div>

                <div className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <p className="text-xs text-white/60 uppercase tracking-wide font-oswald">Cancha</p>
                  <p className="mt-1 text-white font-oswald text-base inline-flex items-center gap-2">
                    <MapPin size={16} />
                    {canchaCoordinar
                      ? 'Cancha: a coordinar'
                      : `${matchLocation}${match?.cancha_cost != null ? ` · ${formatMoneyAr(match.cancha_cost)}` : ''}`}
                  </p>
                  {!canchaCoordinar && mapsLocationUrl ? (
                    <a
                      href={mapsLocationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex text-xs text-[#9ED3FF] underline underline-offset-2 font-oswald hover:text-white transition-colors"
                    >
                      Ver en mapa
                    </a>
                  ) : null}
                </div>

                <div className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <p className="text-xs text-white/60 uppercase tracking-wide font-oswald">Formato</p>
                  <p className="mt-1 text-white/90 font-oswald text-base">
                    F{match?.format || '-'}
                  </p>
                </div>

                <div className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <p className="text-xs text-white/60 uppercase tracking-wide font-oswald">Modo</p>
                  <p className="mt-1 text-white/90 font-oswald text-base">
                    {match?.mode || 'Sin definir'}
                  </p>
                </div>

                {!canManage ? (
                  <p className="text-sm text-white/65 font-oswald">
                    Cualquier miembro de los equipos puede editar fecha/cancha/modo/formato.
                    Solo owner/admin puede cancelar el partido.
                  </p>
                ) : null}

                {match?.status !== 'cancelled' && match?.status !== 'played' ? (
                  <form className="space-y-3" onSubmit={handleSave}>
                    <label className="block">
                      <span className="text-xs text-white/80 uppercase tracking-wide">Formato</span>
                      <select
                        value={formatInput}
                        onChange={(event) => setFormatInput(event.target.value)}
                        className="mt-1 w-full rounded-xl bg-slate-800/70 border border-white/15 px-3 py-2 text-white/85"
                      >
                        {TEAM_FORMAT_OPTIONS.map((value) => (
                          <option key={value} value={String(value)}>
                            F{value}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-xs text-white/80 uppercase tracking-wide">Fecha y hora</span>
                      <input
                        type="datetime-local"
                        value={scheduledAtInput}
                        onChange={(event) => setScheduledAtInput(event.target.value)}
                        className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs text-white/80 uppercase tracking-wide">Ubicacion</span>
                      <LocationAutocomplete
                        value={locationInput}
                        onChange={setLocationInput}
                        placeholder="Cancha o direccion"
                        inputClassName="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs text-white/80 uppercase tracking-wide">Costo cancha</span>
                      <input
                        type="number"
                        min={0}
                        step="100"
                        value={canchaCostInput}
                        onChange={(event) => setCanchaCostInput(event.target.value)}
                        placeholder="Ej: 12000"
                        className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs text-white/80 uppercase tracking-wide">Modo</span>
                      <select
                        value={modeInput}
                        onChange={(event) => setModeInput(event.target.value)}
                        className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
                      >
                        <option value="">Sin definir</option>
                        {TEAM_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className={`grid gap-2 pt-1 ${canManage ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                      <Button
                        type="submit"
                        className="h-11 rounded-xl text-[16px] font-oswald font-semibold tracking-[0.01em] !normal-case"
                        loading={saving}
                        loadingText="Guardando..."
                        disabled={saving}
                      >
                        Guardar
                      </Button>

                      {canManage ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleCancelMatch}
                          className="h-11 rounded-xl text-[16px] font-oswald font-semibold tracking-[0.01em] !normal-case"
                          disabled={saving}
                        >
                          Cancelar partido
                        </Button>
                      ) : null}
                    </div>
                  </form>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <Modal
        isOpen={Boolean(rosterTeamId)}
        onClose={() => setRosterTeamId(null)}
        title={`Plantilla ${rosterTeam?.name || ''}`.trim() || 'Plantilla'}
        className="w-full max-w-[420px]"
        classNameContent="p-4"
      >
        {rosterMembers.length === 0 ? (
          <p className="text-sm text-white/65 font-oswald">Este equipo no tiene jugadores cargados.</p>
        ) : (
          <div className="space-y-2 max-h-[56vh] overflow-y-auto pr-1">
            {rosterMembers.map((member) => {
              const name = getPlayerName(member);
              const avatar = getPlayerAvatar(member);
              const profile = getPlayerProfile(member);

              return (
                <button
                  key={`roster-${member?.id || member?.jugador_id || name}`}
                  type="button"
                  onClick={() => {
                    setRosterTeamId(null);
                    setSelectedPlayerProfile(profile);
                  }}
                  className="w-full flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                >
                  <div className="h-9 w-9 rounded-full border border-white/25 bg-slate-900/70 overflow-hidden flex items-center justify-center text-[11px] font-semibold text-white/90 shrink-0">
                    {avatar ? (
                      <img src={avatar} alt={name} className="h-full w-full object-cover" />
                    ) : (
                      <span>{getInitials(name)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-oswald truncate">{name}</p>
                    {member?.is_captain ? (
                      <p className="text-[11px] text-white/65 font-oswald">Capitan</p>
                    ) : null}
                  </div>
                  <Users size={15} className="text-white/40" />
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      <ProfileCardModal
        isOpen={Boolean(selectedPlayerProfile)}
        onClose={() => setSelectedPlayerProfile(null)}
        profile={selectedPlayerProfile}
      />
    </PageTransition>
  );
};

export default TeamMatchDetailPage;
