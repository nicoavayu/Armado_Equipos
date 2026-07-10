import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  MapPin,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

import { useAuth } from '../AuthProvider';
import DistanceSlider from './DistanceSlider';
import { supabase } from '../../lib/supabaseClient';
import { PRIMARY_CTA_BUTTON_CLASS } from '../../styles/buttonClasses';
import { hasValidCoordinates, toCoordinateNumber } from '../../utils/matchLocation';
import {
  ALLOWED_FORMATS,
  buildMatchOpportunitySummary,
  cancelMyAvailability,
  createMyAutoMatchProposal,
  findMyAvailabilityMatches,
  getMyActiveAvailability,
  getMyActiveProposals,
  respondToAutoMatchProposal,
  saveMyAvailability,
} from '../../services/db/availability';

const localDateTimeValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const defaultWindow = () => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(20, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 0, 0, 0);
  return { startsAt: localDateTimeValue(start), endsAt: localDateTimeValue(end) };
};

const formatWindow = (availability) => {
  if (!availability) return '';
  const start = new Date(availability.starts_at);
  const end = new Date(availability.ends_at);
  return `${start.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
};

const INPUT = 'h-[50px] w-full rounded-2xl border border-[rgba(148,134,255,0.3)] bg-[rgba(13,10,30,0.88)] px-3 font-oswald text-[14px] text-white outline-none transition-all focus:border-[#8b7cff] focus:bg-[rgba(22,17,48,0.97)] focus:ring-2 focus:ring-[#6a43ff]/20';

const ProposalCard = ({ proposal, loading, onRespond }) => {
  const ready = proposal.status === 'ready';
  const pending = proposal.my_response === 'pending';

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
              <p className="font-oswald text-[9px] font-semibold uppercase tracking-[0.16em] text-[#aa94ff]">Propuesta automática</p>
              <h3 className="font-bebas-real text-[24px] leading-none tracking-[0.035em] text-white">PARTIDO {proposal.format}</h3>
            </div>
          </div>
          <p className="mt-2 font-oswald text-[12px] text-white/52">
            {new Date(proposal.proposed_starts_at).toLocaleString('es-AR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 font-sans text-[9px] font-bold uppercase tracking-[0.08em] ${ready
          ? 'border-[#2dd4bf]/30 bg-[#2dd4bf]/10 text-[#99f6e4]'
          : 'border-[#9b7bff]/25 bg-[#6a43ff]/12 text-[#cfc4ff]'}`}
        >
          {ready ? 'Lista' : 'Confirmando'}
        </span>
      </div>

      {pending ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => onRespond(proposal.id, 'declined')}
            className="min-h-11 rounded-xl border border-white/12 bg-white/[0.035] font-oswald text-[13px] font-semibold text-white/58 transition-all hover:bg-white/[0.07] active:scale-[0.98]"
          >
            No puedo
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
      ) : (
        <div className="mt-3 rounded-xl border border-white/[0.075] bg-black/15 px-3 py-2 font-sans text-[10.5px] leading-relaxed text-white/46">
          {proposal.my_response === 'accepted' ? 'Ya confirmaste tu participación.' : 'Rechazaste esta propuesta.'}
        </div>
      )}

      {ready ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#2dd4bf]/20 bg-[#2dd4bf]/8 px-3 py-2.5 font-oswald text-[11px] font-semibold text-[#b8fff2]">
          <Check size={15} className="shrink-0" />
          Ya están todos. Falta completar la cancha y crear el partido definitivo.
        </div>
      ) : null}
    </article>
  );
};

export default function AvailabilityOpportunityCard() {
  const { user } = useAuth();
  const initialWindow = useMemo(defaultWindow, []);
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [matches, setMatches] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [location, setLocation] = useState(null);
  const [startsAt, setStartsAt] = useState(initialWindow.startsAt);
  const [endsAt, setEndsAt] = useState(initialWindow.endsAt);
  const [formats, setFormats] = useState(['F5', 'F7']);
  const [distance, setDistance] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const active = await getMyActiveAvailability(user.id);
      setAvailability(active);
      if (active) {
        setStartsAt(localDateTimeValue(active.starts_at));
        setEndsAt(localDateTimeValue(active.ends_at));
        setFormats(active.formats || ['F5']);
        setDistance(active.max_distance_km || 8);
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
    load();
    loadLocation();
  }, [load, loadLocation]);

  const opportunities = useMemo(
    () => buildMatchOpportunitySummary(matches, availability?.formats || formats),
    [availability?.formats, formats, matches],
  );
  const best = opportunities[0] || null;

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
        startsAt,
        endsAt,
        formats,
        maxDistanceKm: distance,
        latitude: location?.lat,
        longitude: location?.lng,
      });
      setNotice('Disponibilidad activada. Arma2 ya está buscando coincidencias.');
      await load();
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

  const propose = async (format) => {
    setLoading(true);
    setError('');
    try {
      await createMyAutoMatchProposal(format);
      setNotice(`Propuesta ${format} creada. Los jugadores compatibles deberán aceptar.`);
      await load();
    } catch (err) {
      const message = err?.message || '';
      setError(message.includes('active_proposal_exists')
        ? 'Ya participás de una propuesta activa para ese horario.'
        : message.includes('not_enough_candidates')
          ? 'Todavía no hay suficientes jugadores compatibles.'
          : 'No se pudo crear la propuesta.');
    } finally {
      setLoading(false);
    }
  };

  const respond = async (proposalId, response) => {
    setLoading(true);
    setError('');
    try {
      await respondToAutoMatchProposal(proposalId, response);
      setNotice(response === 'accepted' ? 'Te sumaste a la propuesta.' : 'Rechazaste la propuesta.');
      await load();
    } catch (err) {
      setError(err.message || 'No pudimos guardar tu respuesta.');
    } finally {
      setLoading(false);
    }
  };

  if (!user?.id) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(84px+var(--safe-bottom,0px))] right-4 z-30 flex min-h-[48px] max-w-[calc(100vw-32px)] items-center gap-2.5 overflow-hidden rounded-full border border-[#9b7bff]/35 bg-[radial-gradient(130px_60px_at_12%_-30%,rgba(255,255,255,0.18),transparent_72%),linear-gradient(135deg,rgba(106,67,255,0.97),rgba(58,27,143,0.98))] px-3.5 pr-4 text-left text-white shadow-[0_16px_42px_rgba(41,18,112,0.58),inset_0_1px_0_rgba(255,255,255,0.2)] transition-all active:scale-[0.97]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10">
          {availability ? <Search size={16} /> : <CalendarClock size={16} />}
        </span>
        <span className="min-w-0">
          <span className="block font-oswald text-[9px] font-semibold uppercase tracking-[0.13em] text-white/58">
            Partido automático
          </span>
          <span className="block truncate font-oswald text-[12.5px] font-bold leading-tight text-white">
            {availability
              ? (best ? `${best.compatiblePlayers}/${best.playersNeeded} para ${best.format}` : 'Disponibilidad activa')
              : 'Estoy disponible'}
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-white/55" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#05030d]/78 p-0 backdrop-blur-md sm:items-center sm:p-4">
          <section className="relative max-h-[92dvh] w-full max-w-[560px] overflow-hidden rounded-t-[28px] border border-[rgba(148,134,255,0.24)] bg-[linear-gradient(180deg,rgba(25,18,57,0.99),rgba(11,8,27,0.99))] shadow-[0_-24px_80px_rgba(2,1,10,0.6),inset_0_1px_0_rgba(255,255,255,0.07)] sm:rounded-[28px]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_180px_at_18%_-12%,rgba(118,78,255,0.22),transparent_72%)]" />
            <div className="relative max-h-[92dvh] overflow-y-auto p-4 pb-[max(26px,var(--safe-bottom,0px))] sm:p-5">
              <header className="mb-5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#9b7bff]/30 bg-[#6a43ff]/16 text-[#c8baff] shadow-[0_10px_28px_rgba(74,38,181,0.28)]">
                    <Sparkles size={20} strokeWidth={1.8} />
                  </span>
                  <div>
                    <p className="font-oswald text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a98cff]">Partido automático</p>
                    <h2 className="font-bebas-real text-[34px] leading-none tracking-[0.035em] text-white">QUIERO JUGAR</h2>
                    <p className="mt-1 font-oswald text-[11.5px] text-white/45">Arma2 cruza horario, formato y distancia.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/70 transition-all hover:bg-white/10 active:scale-95"
                  aria-label="Cerrar disponibilidad"
                >
                  <X size={19} />
                </button>
              </header>

              {proposals.map((proposal) => (
                <ProposalCard key={proposal.id} proposal={proposal} loading={loading} onRespond={respond} />
              ))}

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
                              <strong className={`font-oswald text-[15px] ${item.ready ? 'text-[#99f6e4]' : 'text-white/78'}`}>{item.compatiblePlayers}/{item.playersNeeded}</strong>
                              <p className="font-sans text-[9.5px] text-white/34">jugadores</p>
                            </div>
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full bg-[linear-gradient(90deg,#6a43ff,#a78bfa)] shadow-[0_0_12px_rgba(139,92,255,0.45)]" style={{ width: `${progress}%` }} />
                          </div>
                          <p className="mt-2 font-oswald text-[10.5px] text-white/44">
                            {item.ready ? 'Ya hay suficientes jugadores compatibles.' : `Faltan ${item.missingPlayers}. Arma2 sigue buscando.`}
                          </p>
                          {item.ready && proposals.length === 0 ? (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => propose(item.format)}
                              className={`${PRIMARY_CTA_BUTTON_CLASS} mt-3 !min-h-[44px] !rounded-xl !font-bebas-real !text-[16px] !tracking-[0.035em]`}
                            >
                              Crear propuesta automática
                            </button>
                          ) : null}
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
                    Decinos cuándo podés jugar. La búsqueda queda activa hasta que la desactives o termine la franja elegida.
                  </p>

                  <div className="grid grid-cols-2 gap-2.5">
                    <label>
                      <span className="mb-1.5 block font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Desde</span>
                      <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={INPUT} />
                    </label>
                    <label>
                      <span className="mb-1.5 block font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Hasta</span>
                      <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className={INPUT} />
                    </label>
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
                    {location
                      ? 'Usamos la ubicación guardada en tu perfil solo para calcular compatibilidad.'
                      : 'Sin ubicación guardada, la búsqueda se hará por horario y formato.'}
                  </div>

                  <button
                    type="button"
                    disabled={loading || formats.length === 0}
                    onClick={save}
                    className={`${PRIMARY_CTA_BUTTON_CLASS} mt-4 !min-h-[50px] !rounded-2xl !font-bebas-real !text-[18px] !tracking-[0.04em]`}
                  >
                    <Users size={18} className="mr-2" /> Activar búsqueda
                  </button>
                </div>
              )}

              {notice ? (
                <p className="mt-3 rounded-xl border border-[#2dd4bf]/20 bg-[#2dd4bf]/8 px-3 py-2.5 font-oswald text-[11.5px] text-[#b8fff2]">
                  {notice}
                </p>
              ) : null}
              {error ? (
                <p className="mt-3 rounded-xl border border-amber-400/24 bg-amber-400/10 px-3 py-2.5 font-oswald text-[11.5px] text-amber-100">
                  {error}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
