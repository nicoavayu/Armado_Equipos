import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  Clock3,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';

import { useAuth } from '../AuthProvider';
import DistanceSlider from './DistanceSlider';
import PageTitle from '../PageTitle';
import { supabase } from '../../lib/supabaseClient';
import { PRIMARY_CTA_BUTTON_CLASS } from '../../styles/buttonClasses';
import { hasValidCoordinates, toCoordinateNumber } from '../../utils/matchLocation';
import {
  ALLOWED_FORMATS,
  buildMatchOpportunitySummary,
  cancelMyAvailability,
  findMyAvailabilityMatches,
  getMyActiveAvailability,
  getMyActiveProposals,
  respondToAutoMatchProposal,
  saveMyAvailability,
  syncMyAutoMatchGestations,
} from '../../services/db/availability';

const DAY_OPTIONS = [
  { value: 1, short: 'LU', label: 'Lun' },
  { value: 2, short: 'MA', label: 'Mar' },
  { value: 3, short: 'MI', label: 'Mié' },
  { value: 4, short: 'JU', label: 'Jue' },
  { value: 5, short: 'VI', label: 'Vie' },
  { value: 6, short: 'SA', label: 'Sáb' },
  { value: 7, short: 'DO', label: 'Dom' },
];

const START_HOURS = Array.from({ length: 17 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`);
const END_HOURS = Array.from({ length: 17 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
const REFRESH_MS = 30000;

const TIME_SELECT = 'h-[52px] w-full appearance-none rounded-xl border border-[#8b7cff]/35 bg-[#161130] [&>option]:bg-[#161130] [&>option]:text-white px-2 text-center font-bebas-real text-[26px] text-white outline-none [color-scheme:dark] focus:border-[#8b7cff]';

const toMinutes = (value) => {
  const [hours, minutes] = String(value || '0:0').split(':').map(Number);
  return hours * 60 + (minutes || 0);
};

const displayTime = (value) => {
  const hhmm = String(value || '').slice(0, 5);
  return hhmm === '24:00' ? '00:00' : hhmm;
};

const formatWindow = (availability) => {
  if (!availability) return '';
  const days = (availability.days_of_week || [])
    .map((day) => DAY_OPTIONS.find((option) => option.value === day)?.label)
    .filter(Boolean)
    .join(' · ');
  return `${days} · ${displayTime(availability.time_start)}–${displayTime(availability.time_end)}`;
};

const formatProposalDate = (value) => new Date(value).toLocaleString('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const ProposalCard = ({ proposal, loading, onRespond }) => {
  const ready = proposal.status === 'ready';
  const pending = proposal.my_response === 'pending';
  const accepted = Number(proposal.accepted_count || 0);
  const total = Number(proposal.max_players || 0);
  const memberCount = Number(proposal.member_count || 0);
  const missing = Math.max(0, total - accepted);
  const progress = total > 0 ? Math.min(100, (accepted / total) * 100) : 0;

  return (
    <article className="relative mb-3 overflow-hidden rounded-[20px] border border-[rgba(148,134,255,0.24)] bg-[radial-gradient(260px_100px_at_8%_-20%,rgba(139,92,255,0.22),transparent_72%),linear-gradient(150deg,rgba(39,30,85,0.84),rgba(13,10,31,0.96))] p-3.5 shadow-[0_14px_38px_rgba(5,2,20,0.3),inset_0_1px_0_rgba(255,255,255,0.055)]">
      <span className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#9b7bff]/25 bg-[#6a43ff]/15 text-[#c8baff]">
              <Sparkles size={15} />
            </span>
            <div>
              <p className="font-oswald text-[9px] font-semibold uppercase tracking-[0.16em] text-[#aa94ff]">Partido en gestación</p>
              <h3 className="font-bebas-real text-[24px] leading-none tracking-[0.035em] text-white">PARTIDO {proposal.format}</h3>
            </div>
          </div>
          <p className="mt-2 font-oswald text-[12px] text-white/52">{formatProposalDate(proposal.proposed_starts_at)}</p>
          <p className="mt-1 flex items-center gap-1.5 font-sans text-[10px] text-white/38">
            <MapPin size={12} className="text-[#aa94ff]" /> Zona compatible con el radio de todos
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 font-sans text-[9px] font-bold uppercase tracking-[0.08em] ${ready
          ? 'border-[#2dd4bf]/30 bg-[#2dd4bf]/10 text-[#99f6e4]'
          : 'border-[#9b7bff]/25 bg-[#6a43ff]/12 text-[#cfc4ff]'}`}
        >
          {ready ? 'Cupo completo' : 'Gestándose'}
        </span>
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.075] bg-black/15 p-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/36">Confirmados</p>
            <strong className="font-bebas-real text-[28px] leading-none text-white">{accepted}/{total}</strong>
          </div>
          <div className="text-right font-sans text-[10px] text-white/40">
            <p>{memberCount} convocados</p>
            <p>{ready ? 'Ya están todos' : `Faltan ${missing}`}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#6a43ff,#a78bfa,#2dd4bf)] shadow-[0_0_12px_rgba(139,92,255,0.45)] transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {pending ? (
        <div className="mt-3">
          <p className="mb-2 font-oswald text-[11px] text-white/58">¿Te sumás a esta oportunidad?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => onRespond(proposal.id, 'declined')}
              className="min-h-11 rounded-xl border border-white/12 bg-white/[0.035] font-oswald text-[13px] font-semibold text-white/58 transition-all hover:bg-white/[0.07] active:scale-[0.98]"
            >
              Esta vez no
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => onRespond(proposal.id, 'accepted')}
              className="min-h-11 rounded-xl border border-white/15 bg-cta-gradient font-oswald text-[13px] font-bold text-white shadow-[0_7px_22px_rgba(106,67,255,0.3)] transition-all active:scale-[0.98]"
            >
              <Check size={15} className="mr-1 inline" /> Me sumo
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-white/[0.075] bg-black/15 px-3 py-2 font-sans text-[10.5px] leading-relaxed text-white/46">
          {proposal.my_response === 'accepted'
            ? 'Ya confirmaste. Arma2 te avisará cuando cambie el estado.'
            : 'No participás de esta combinación. Tu búsqueda general sigue activa.'}
        </div>
      )}

      {ready ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#2dd4bf]/20 bg-[#2dd4bf]/8 px-3 py-2.5 font-oswald text-[11px] font-semibold text-[#b8fff2]">
          <Check size={15} className="shrink-0" />
          Ya están todos. El próximo paso será elegir quién organiza, cancha y precio.
        </div>
      ) : null}
    </article>
  );
};

export default function AvailabilityOpportunityCard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [matches, setMatches] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [profileLocation, setLocation] = useState(null);
  const [days, setDays] = useState([]);
  const [timeStart, setTimeStart] = useState('20:00');
  const [timeEnd, setTimeEnd] = useState('23:00');
  const [formats, setFormats] = useState(['F5', 'F7']);
  const [distance, setDistance] = useState(8);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (new URLSearchParams(location.search).get('auto')) setOpen(true);
  }, [location.search]);

  const close = useCallback(() => {
    setOpen(false);
    if (new URLSearchParams(location.search).get('auto')) {
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const loadLocation = useCallback(async () => {
    if (!user?.id) return;
    const { data, error: profileError } = await supabase
      .from('usuarios')
      .select('latitud, longitud')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) return;
    if (hasValidCoordinates(data?.latitud, data?.longitud)) {
      setLocation({
        lat: toCoordinateNumber(data.latitud),
        lng: toCoordinateNumber(data.longitud),
      });
    }
  }, [user?.id]);

  const load = useCallback(async ({ sync = false } = {}) => {
    if (!user?.id) return;
    try {
      const active = await getMyActiveAvailability(user.id);
      setAvailability(active);
      if (active) {
        setDays(active.days_of_week || []);
        setTimeStart(String(active.time_start).slice(0, 5));
        setTimeEnd(String(active.time_end).slice(0, 5));
        setFormats(active.formats || ['F5']);
        setDistance(active.max_distance_km || 8);
        if (sync) await syncMyAutoMatchGestations();
        const [nextMatches, nextProposals] = await Promise.all([
          findMyAvailabilityMatches(),
          getMyActiveProposals(user.id),
        ]);
        setMatches(nextMatches);
        setProposals(nextProposals);
      } else {
        setMatches([]);
        setProposals(await getMyActiveProposals(user.id));
      }
    } catch (err) {
      setError(err.message || 'No pudimos cargar tu disponibilidad.');
    }
  }, [user?.id]);

  useEffect(() => {
    load({ sync: true });
    loadLocation();
  }, [load, loadLocation]);

  useEffect(() => {
    if (!open || !availability) return undefined;
    const timer = window.setInterval(() => load({ sync: true }), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [availability, load, open]);

  const opportunities = useMemo(
    () => buildMatchOpportunitySummary(matches, availability?.formats || formats),
    [availability?.formats, formats, matches],
  );

  const toggleDay = (day) => {
    setDays((current) => current.includes(day)
      ? current.filter((item) => item !== day)
      : [...current, day].sort((a, b) => a - b));
  };

  const changeTimeStart = (value) => {
    setTimeStart(value);
    if (toMinutes(timeEnd) - toMinutes(value) < 60) {
      const bumped = Math.min(24 * 60, toMinutes(value) + 180);
      setTimeEnd(`${String(Math.floor(bumped / 60)).padStart(2, '0')}:00`);
    }
  };

  const toggleFormat = (format) => {
    setFormats((current) => current.includes(format)
      ? current.filter((item) => item !== format)
      : [...current, format]);
  };

  const save = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await saveMyAvailability({
        days,
        timeStart,
        timeEnd,
        formats,
        maxDistanceKm: distance,
        latitude: profileLocation?.lat,
        longitude: profileLocation?.lng,
      });
      setNotice('Búsqueda activada. Si ya hay una combinación viable, Arma2 creará la gestación y avisará a todos.');
      await load({ sync: true });
    } catch (err) {
      setError(err.message || 'No se pudo activar tu disponibilidad.');
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    setLoading(true);
    setError('');
    try {
      await cancelMyAvailability();
      setAvailability(null);
      setMatches([]);
      setNotice('Disponibilidad desactivada.');
    } catch (err) {
      setError(err.message || 'No se pudo desactivar.');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await load({ sync: true });
      setNotice('Estado actualizado.');
    } finally {
      setRefreshing(false);
    }
  };

  const respond = async (proposalId, response) => {
    setLoading(true);
    setError('');
    try {
      await respondToAutoMatchProposal(proposalId, response);
      setNotice(response === 'accepted'
        ? 'Te sumaste. Arma2 te avisará cuando se complete.'
        : 'Esta combinación se cancelará y Arma2 buscará otra sin perder tu disponibilidad.');
      await load({ sync: false });
    } catch (err) {
      const message = err?.message || '';
      if (/proposal_not_open|proposal_not_found|proposal_member_not_found/.test(message)) {
        setError('Esta propuesta ya no está disponible.');
        await load({ sync: false });
      } else {
        setError(message || 'No pudimos guardar tu respuesta.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user?.id || !open) return null;

  const endOptions = END_HOURS.filter((option) => toMinutes(option) - toMinutes(timeStart) >= 60);

  return ReactDOM.createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Partido automático"
      className="fixed inset-0 z-[1200] overflow-y-auto bg-[linear-gradient(180deg,#141031_0%,#100b26_46%,#090715_100%)] text-white"
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.22),transparent_48%),radial-gradient(circle_at_8%_56%,rgba(73,43,171,0.14),transparent_32%)]" />
      <PageTitle respectSafeArea onBack={close}>PARTIDO AUTOMÁTICO</PageTitle>

      <main className="relative z-10 mx-auto w-full max-w-[560px] px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+92px)] font-oswald">
        <div className="mb-5 text-center">
          <p className="font-oswald text-[10px] font-semibold uppercase tracking-[0.22em] text-[#a98cff]">Arma2 busca y coordina</p>
          <h2 className="mt-1 font-bebas-real text-[clamp(36px,10vw,46px)] leading-[0.92] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">QUIERO JUGAR</h2>
          <p className="mx-auto mt-2 max-w-[400px] font-oswald text-[12.5px] leading-relaxed text-white/52">
            Cuando aparece un grupo viable, todos reciben la misma propuesta y pueden seguir cómo se completa.
          </p>
        </div>

        {proposals.length > 0 ? (
          <section aria-label="Partidos en gestación">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="font-oswald text-[10px] font-semibold uppercase tracking-[0.16em] text-white/44">Tus partidos en gestación</p>
              <button
                type="button"
                disabled={refreshing}
                onClick={refresh}
                className="flex min-h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.035] px-3 font-oswald text-[10px] font-semibold text-white/56"
              >
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>
            {proposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} loading={loading} onRespond={respond} />
            ))}
          </section>
        ) : null}

        {availability ? (
          <div className="rounded-card border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(155deg,rgba(37,29,80,0.74),rgba(13,10,31,0.94))] p-4 shadow-[0_18px_46px_rgba(4,2,16,0.32),inset_0_1px_0_rgba(255,255,255,0.055)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-oswald text-[13px] font-bold text-white">
                  <Search size={16} className="text-[#b39cff]" /> Tu búsqueda está activa
                </div>
                <p className="mt-1 font-oswald text-[11.5px] text-white/48">{formatWindow(availability)}</p>
              </div>
              <span className="rounded-full border border-[#9b7bff]/25 bg-[#6a43ff]/12 px-2.5 py-1 font-sans text-[9px] font-bold text-[#c8baff]">
                {availability.formats.join(' · ')}
              </span>
            </div>

            <div className="mt-4 space-y-2.5">
              {opportunities.map((item) => {
                const progress = Math.min(100, (item.compatiblePlayers / item.playersNeeded) * 100);
                return (
                  <div key={item.format} className="rounded-2xl border border-white/[0.075] bg-black/15 p-3.5">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/36">Formato</p>
                        <strong className="font-bebas-real text-[25px] leading-none text-white">{item.format}</strong>
                      </div>
                      <div className="text-right">
                        <strong className={`font-oswald text-[15px] ${item.gestating ? 'text-[#99f6e4]' : 'text-white/78'}`}>{item.compatiblePlayers}/{item.playersNeeded}</strong>
                        <p className="font-sans text-[9.5px] text-white/34">compatibles ahora</p>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,#6a43ff,#a78bfa)] shadow-[0_0_12px_rgba(139,92,255,0.45)]" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="mt-2 font-oswald text-[10.5px] text-white/44">
                      {item.gestating
                        ? 'Ya hay masa crítica. Arma2 está agrupando y pidiendo confirmaciones.'
                        : `La gestación empieza al llegar a ${item.gestationThreshold}. Hoy hay ${item.compatiblePlayers}.`}
                    </p>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={cancel}
              className="mt-4 min-h-11 w-full rounded-xl border border-rose-400/20 bg-rose-400/[0.07] font-oswald text-[12px] font-semibold text-rose-100/80 transition-all hover:bg-rose-400/10 active:scale-[0.985]"
            >
              Dejar de buscar
            </button>
          </div>
        ) : (
          <div className="rounded-card border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(155deg,rgba(37,29,80,0.74),rgba(13,10,31,0.94))] p-4 shadow-[0_18px_46px_rgba(4,2,16,0.32),inset_0_1px_0_rgba(255,255,255,0.055)]">
            <p className="mb-4 font-oswald text-[12.5px] leading-relaxed text-white/56">
              Elegí cuándo podés jugar. La búsqueda queda activa hasta que la desactives y Arma2 se ocupa de agrupar a los compatibles.
            </p>

            <div>
              <p className="mb-2 font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Días de la semana</p>
              <div className="grid grid-cols-7 gap-1">
                {DAY_OPTIONS.map((day) => {
                  const active = days.includes(day.value);
                  return (
                    <button
                      type="button"
                      key={day.value}
                      onClick={() => toggleDay(day.value)}
                      aria-pressed={active}
                      className={`min-h-11 rounded-xl border font-oswald text-[11.5px] font-bold transition-all active:scale-[0.95] ${active
                        ? 'border-[#9b7bff] bg-[linear-gradient(145deg,rgba(112,48,255,0.62),rgba(57,24,132,0.8))] text-white shadow-[0_8px_22px_rgba(75,38,180,0.28)]'
                        : 'border-white/10 bg-white/[0.035] text-white/42 hover:border-[#9b7bff]/32 hover:text-white/68'}`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/[0.075] bg-black/15 px-3.5 py-3">
              <div className="mb-2 flex items-center gap-1.5 font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">
                <Clock3 size={13} className="text-[#9d82ff]" /> Rango horario
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <label>
                  <span className="sr-only">Desde</span>
                  <select aria-label="Desde" value={timeStart} onChange={(event) => changeTimeStart(event.target.value)} className={TIME_SELECT}>
                    {START_HOURS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <span className="font-oswald text-[12px] font-semibold text-white/40">a</span>
                <label>
                  <span className="sr-only">Hasta</span>
                  <select aria-label="Hasta" value={timeEnd} onChange={(event) => setTimeEnd(event.target.value)} className={TIME_SELECT}>
                    {endOptions.map((option) => <option key={option} value={option}>{displayTime(option)}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Formatos aceptados</p>
              <div className="grid grid-cols-6 gap-1.5">
                {ALLOWED_FORMATS.map((format) => {
                  const active = formats.includes(format);
                  return (
                    <button
                      type="button"
                      key={format}
                      onClick={() => toggleFormat(format)}
                      className={`min-h-11 rounded-xl border font-oswald text-[12.5px] font-bold transition-all active:scale-[0.97] ${active
                        ? 'border-[#9b7bff] bg-[linear-gradient(145deg,rgba(112,48,255,0.62),rgba(57,24,132,0.8))] text-white shadow-[0_8px_22px_rgba(75,38,180,0.28)]'
                        : 'border-white/10 bg-white/[0.035] text-white/42 hover:border-[#9b7bff]/32 hover:text-white/68'}`}
                    >
                      {format}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/[0.075] bg-black/15 px-3.5 py-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Distancia máxima</span>
                <span className="rounded-full border border-[#9b7bff]/25 bg-[#6a43ff]/12 px-2.5 py-1 font-sans text-[10px] font-bold text-[#c8baff]">{distance} km</span>
              </div>
              <DistanceSlider
                min={1}
                max={30}
                step={1}
                value={distance}
                onChange={setDistance}
                ariaLabel="Distancia máxima para partido automático"
                valueText={`${distance} km`}
              />
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.075] bg-white/[0.03] px-3 py-2.5 font-sans text-[10.5px] leading-relaxed text-white/42">
              <MapPin size={15} className="mt-0.5 shrink-0 text-[#aa94ff]" />
              {profileLocation
                ? 'Tu ubicación exacta solo se usa para calcular compatibilidad. No se comparte con los demás.'
                : 'Sin ubicación guardada, la búsqueda se hará por días, horario y formato.'}
            </div>

            <button
              type="button"
              disabled={loading || formats.length === 0 || days.length === 0}
              onClick={save}
              className={`${PRIMARY_CTA_BUTTON_CLASS} mt-4 !min-h-[50px]`}
            >
              <Users size={18} className="mr-2" /> Activar búsqueda
            </button>
          </div>
        )}

        {notice ? (
          <p className="mt-3 rounded-xl border border-[#2dd4bf]/20 bg-[#2dd4bf]/8 px-3 py-2.5 font-oswald text-[11.5px] text-[#b8fff2]">{notice}</p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-xl border border-amber-400/24 bg-amber-400/10 px-3 py-2.5 font-oswald text-[11.5px] text-amber-100">{error}</p>
        ) : null}
      </main>
    </div>,
    document.body,
  );
}
