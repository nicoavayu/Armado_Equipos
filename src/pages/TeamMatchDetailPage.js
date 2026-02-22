import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, Flag, Lock, MapPin, Shield } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import PageTransition from '../components/PageTransition';
import Button from '../components/Button';
import LocationAutocomplete from '../features/equipos/components/LocationAutocomplete';
import { getTeamGradientStyle } from '../features/equipos/utils/teamColors';
import {
  canManageTeamMatch,
  cancelTeamMatch,
  getTeamMatchById,
  updateTeamMatchDetails,
} from '../services/db/teamChallenges';
import { notifyBlockingError } from '../utils/notifyBlockingError';

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

const buildMapsSearchUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
};

const TeamCardLocked = ({ team, fallbackName }) => (
  <div
    className="rounded-xl border border-white/15 bg-[#1e293b]/60 p-3 min-h-[92px] min-w-0"
    style={team ? getTeamGradientStyle(team) : undefined}
  >
    <div className="flex items-start justify-between gap-2">
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
      <span className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/75 font-oswald">
        <Lock size={11} /> Fijo
      </span>
    </div>
  </div>
);

const TeamMatchDetailPage = () => {
  const navigate = useNavigate();
  const { matchId } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [match, setMatch] = useState(null);
  const [canManage, setCanManage] = useState(false);

  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [canchaCostInput, setCanchaCostInput] = useState('');

  const syncFormWithMatch = useCallback((nextMatch) => {
    setScheduledAtInput(toDateTimeLocalValue(nextMatch?.scheduled_at));
    setLocationInput(nextMatch?.location || nextMatch?.location_name || '');
    setCanchaCostInput(
      nextMatch?.cancha_cost == null || Number.isNaN(Number(nextMatch?.cancha_cost))
        ? ''
        : String(nextMatch.cancha_cost),
    );
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
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el partido');
    } finally {
      setLoading(false);
    }
  }, [matchId, syncFormWithMatch]);

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

  const handleSave = async (event) => {
    event.preventDefault();
    if (!match?.id) return;

    const parsedCanchaCost = canchaCostInput.trim() === '' ? null : Number(canchaCostInput);
    if (parsedCanchaCost != null && (!Number.isFinite(parsedCanchaCost) || parsedCanchaCost < 0)) {
      notifyBlockingError('El costo de cancha debe ser un numero valido');
      return;
    }

    try {
      setSaving(true);
      const updated = await updateTeamMatchDetails({
        matchId: match.id,
        scheduledAt: scheduledAtInput ? new Date(scheduledAtInput).toISOString() : null,
        location: locationInput.trim() || null,
        canchaCost: parsedCanchaCost,
        mode: match?.mode || null,
      });

      let nextMatch = updated;
      try {
        const hydrated = await getTeamMatchById(updated?.id || match.id);
        if (hydrated?.id) {
          nextMatch = hydrated;
        }
      } catch (hydrateError) {
        // Keep the updated payload if hydration fails.
      }

      setMatch(nextMatch);
      syncFormWithMatch(nextMatch);
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
                  <span className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-[11px] text-white/80 font-oswald uppercase tracking-wide">
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
                  <TeamCardLocked team={match?.team_a} fallbackName="Equipo A" />
                  <div className="text-center text-white/70 text-sm sm:text-base font-oswald font-semibold tracking-[0.12em]">
                    VS
                  </div>
                  <TeamCardLocked team={match?.team_b} fallbackName="Equipo B" />
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
                  <p className="text-xs text-white/60 uppercase tracking-wide font-oswald">Modo</p>
                  <p className="mt-1 text-white/90 font-oswald text-base">
                    {match?.mode || 'Sin definir'}
                  </p>
                </div>

                {!canManage ? (
                  <p className="text-sm text-white/65 font-oswald">
                    Solo owner/admin de cualquiera de los dos equipos puede editar fecha, cancha y costo.
                  </p>
                ) : null}

                {canManage && match?.status !== 'cancelled' && match?.status !== 'played' ? (
                  <form className="space-y-3" onSubmit={handleSave}>
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <Button
                        type="submit"
                        className="h-11 rounded-xl text-[16px] font-oswald font-semibold tracking-[0.01em] !normal-case"
                        loading={saving}
                        loadingText="Guardando..."
                        disabled={saving}
                      >
                        Guardar
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleCancelMatch}
                        className="h-11 rounded-xl text-[16px] font-oswald font-semibold tracking-[0.01em] !normal-case"
                        disabled={saving}
                      >
                        Cancelar partido
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </PageTransition>
  );
};

export default TeamMatchDetailPage;
