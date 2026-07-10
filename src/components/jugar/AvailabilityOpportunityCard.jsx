import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, MapPin, Sparkles, Users, X } from 'lucide-react';

import { useAuth } from '../AuthProvider';
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

export default function AvailabilityOpportunityCard({ userLocation }) {
  const { user } = useAuth();
  const initialWindow = useMemo(defaultWindow, []);
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [matches, setMatches] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [startsAt, setStartsAt] = useState(initialWindow.startsAt);
  const [endsAt, setEndsAt] = useState(initialWindow.endsAt);
  const [formats, setFormats] = useState(['F5', 'F7']);
  const [distance, setDistance] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  useEffect(() => { load(); }, [load]);

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
        latitude: userLocation?.lat,
        longitude: userLocation?.lng,
      });
      setNotice('Disponibilidad activada. Ya estamos buscando coincidencias.');
      await load();
    } catch (err) {
      setError(err.message || 'No se pudo activar tu disponibilidad.');
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    setLoading(true);
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
        className="fixed bottom-[calc(84px+var(--safe-bottom,0px))] right-4 z-30 flex min-h-12 items-center gap-2 rounded-full border border-[#9b7bff]/40 bg-[linear-gradient(135deg,#6a43ff,#40209c)] px-4 font-oswald text-sm font-bold text-white shadow-[0_12px_35px_rgba(53,25,145,.55)]"
      >
        <CalendarClock size={18} />
        {availability ? (best ? `${best.compatiblePlayers}/${best.playersNeeded} para ${best.format}` : 'Disponibilidad activa') : 'Estoy disponible'}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <section className="max-h-[92dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[28px] border border-[#8b7cff]/25 bg-[#100b26] p-4 pb-[max(24px,var(--safe-bottom,0px))] shadow-2xl sm:rounded-[28px]">
            <header className="mb-4 flex items-center justify-between">
              <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#aa94ff]">Partido automático</p><h2 className="font-bebas text-3xl text-white">QUIERO JUGAR</h2></div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[.05] text-white"><X /></button>
            </header>

            {proposals.map((proposal) => (
              <div key={proposal.id} className="mb-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-white">
                <div className="flex items-center justify-between"><strong>Propuesta {proposal.format}</strong><span className="text-xs uppercase text-emerald-200">{proposal.status === 'ready' ? 'Lista' : 'Buscando confirmaciones'}</span></div>
                <p className="mt-1 text-sm text-white/65">{new Date(proposal.proposed_starts_at).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                {proposal.my_response === 'pending' ? <div className="mt-3 flex gap-2"><button onClick={() => respond(proposal.id, 'declined')} className="min-h-10 flex-1 rounded-xl border border-white/15">No puedo</button><button onClick={() => respond(proposal.id, 'accepted')} className="min-h-10 flex-1 rounded-xl bg-emerald-500 font-bold"><Check size={16} className="mr-1 inline" />Me sumo</button></div> : null}
                {proposal.status === 'ready' ? <p className="mt-2 text-sm font-semibold text-emerald-100">Ya están todos. El creador podrá completar cancha y convertirla en partido.</p> : null}
              </div>
            ))}

            {availability ? (
              <div className="rounded-card border border-[#8b7cff]/25 bg-white/[.045] p-4">
                <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 font-bold text-white"><Sparkles size={17} className="text-[#b39cff]" />Tu búsqueda está activa</div><p className="mt-1 text-sm text-white/55">{formatWindow(availability)}</p></div><span className="rounded-full bg-[#6a43ff]/20 px-2 py-1 text-xs font-bold text-[#c8baff]">{availability.formats.join(' · ')}</span></div>
                <div className="mt-4 space-y-2">
                  {opportunities.map((item) => (
                    <div key={item.format} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="flex items-center justify-between"><strong className="text-white">{item.format}</strong><span className={item.ready ? 'text-emerald-300' : 'text-white/65'}>{item.compatiblePlayers}/{item.playersNeeded}</span></div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#7d5aff]" style={{ width: `${Math.min(100, (item.compatiblePlayers / item.playersNeeded) * 100)}%` }} /></div>
                      <p className="mt-2 text-xs text-white/50">{item.ready ? 'Ya hay suficientes jugadores compatibles.' : `Faltan ${item.missingPlayers}. Arma2 sigue buscando.`}</p>
                      {item.ready && proposals.length === 0 ? <button type="button" disabled={loading} onClick={() => propose(item.format)} className="mt-3 min-h-10 w-full rounded-xl bg-cta-gradient font-bebas text-base text-white">Crear propuesta automática</button> : null}
                    </div>
                  ))}
                </div>
                <button type="button" disabled={loading} onClick={cancel} className="mt-4 min-h-11 w-full rounded-xl border border-rose-400/25 bg-rose-400/10 text-sm font-bold text-rose-100">Dejar de buscar</button>
              </div>
            ) : (
              <div className="space-y-4 rounded-card border border-[#8b7cff]/25 bg-white/[.045] p-4">
                <p className="text-sm leading-relaxed text-white/65">Decinos cuándo podés jugar. Arma2 cruza horario, formato y distancia con otros jugadores.</p>
                <div className="grid grid-cols-2 gap-2"><label className="text-xs uppercase text-white/45">Desde<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-white/15 bg-[#090715] px-2 text-white" /></label><label className="text-xs uppercase text-white/45">Hasta<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-white/15 bg-[#090715] px-2 text-white" /></label></div>
                <div><p className="mb-2 text-xs uppercase text-white/45">Formatos</p><div className="grid grid-cols-6 gap-1.5">{ALLOWED_FORMATS.map((format) => <button type="button" key={format} onClick={() => toggleFormat(format)} className={`min-h-10 rounded-xl border text-sm font-bold ${formats.includes(format) ? 'border-[#9b7bff] bg-[#6a43ff]/35 text-white' : 'border-white/10 bg-white/[.03] text-white/45'}`}>{format}</button>)}</div></div>
                <label className="block text-xs uppercase text-white/45">Distancia máxima: {distance} km<input type="range" min="1" max="30" value={distance} onChange={(e) => setDistance(Number(e.target.value))} className="mt-2 w-full" /></label>
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/55"><MapPin size={17} className="shrink-0 text-[#aa94ff]" />{userLocation ? 'Usaremos tu ubicación actual solo para calcular compatibilidad.' : 'Sin ubicación, buscaremos por horario y formato.'}</div>
                <button type="button" disabled={loading || formats.length === 0} onClick={save} className="min-h-12 w-full rounded-2xl bg-cta-gradient font-bebas text-lg text-white shadow-cta disabled:opacity-50"><Users size={18} className="mr-2 inline" />Activar búsqueda</button>
              </div>
            )}
            {notice ? <p className="mt-3 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p> : null}
            {error ? <p className="mt-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
