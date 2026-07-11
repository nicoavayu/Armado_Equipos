import React, { useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { CalendarDays, CircleDollarSign, Clock3, MapPin, X } from 'lucide-react';

import VenuePicker from '../VenuePicker';
import { buildMatchLocationFields } from '../../utils/matchLocation';
import { finalizeAutoMatchProposal } from '../../services/db/availability';
import { PRIMARY_CTA_BUTTON_CLASS } from '../../styles/buttonClasses';

const INPUT_CLASS = 'h-[50px] w-full rounded-2xl border border-[rgba(148,134,255,0.34)] bg-[rgba(13,10,30,0.78)] px-4 font-oswald text-[17px] text-white outline-none transition-all placeholder:text-white/32 focus:border-[#8b7cff] focus:ring-2 focus:ring-[#6a43ff]/25';
const LABEL_CLASS = 'mb-2 flex items-center gap-1.5 font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40';

const pad2 = (value) => String(value).padStart(2, '0');
const toYmd = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const toHhmm = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

// El organizador puede ajustar la hora por la cancha conseguida, pero dentro
// de +/- 2 h de la ocurrencia gestada (misma regla que valida el backend) y
// sin cruzar de día, para que la fecha confirmada siga siendo la acordada.
export const buildOrganizeTimeOptions = (proposedStartsAt) => {
  const base = new Date(proposedStartsAt);
  if (Number.isNaN(base.getTime())) return [];
  const baseYmd = toYmd(base);
  const options = [];
  for (let offset = -120; offset <= 120; offset += 15) {
    const candidate = new Date(base.getTime() + offset * 60000);
    if (toYmd(candidate) !== baseYmd) continue;
    options.push(toHhmm(candidate));
  }
  return options;
};

const formatProposalDay = (value) => new Date(value).toLocaleDateString('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

export default function AutoMatchOrganizeSheet({ proposal, onClose, onFinalized }) {
  const base = useMemo(() => new Date(proposal.proposed_starts_at), [proposal.proposed_starts_at]);
  const timeOptions = useMemo(
    () => buildOrganizeTimeOptions(proposal.proposed_starts_at),
    [proposal.proposed_starts_at],
  );

  const [nombre, setNombre] = useState(`Partido ${proposal.format}`);
  const [hora, setHora] = useState(toHhmm(base));
  const [sede, setSede] = useState('');
  const [sedeInfo, setSedeInfo] = useState(null);
  const [precio, setPrecio] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submitRef = useRef(false);

  const submit = async () => {
    if (submitRef.current || loading) return;
    if (!nombre.trim()) {
      setError('Poné un nombre para el partido.');
      return;
    }
    if (!sede.trim()) {
      setError('Elegí la cancha o el lugar donde se juega.');
      return;
    }

    submitRef.current = true;
    setLoading(true);
    setError('');
    try {
      const location = buildMatchLocationFields({ locationText: sede, locationInfo: sedeInfo });
      const result = await finalizeAutoMatchProposal(proposal.id, {
        nombre,
        fecha: toYmd(base),
        hora,
        precio: precio === '' ? null : Number(String(precio).replace(',', '.')),
        sede: location.sede,
        sedePlaceId: location.sede_place_id,
        sedeDireccion: location.sede_direccion_normalizada,
        sedeLatitud: location.sede_latitud,
        sedeLongitud: location.sede_longitud,
      });
      const partidoId = result?.partido_id || result?.[0]?.partido_id || null;
      if (!partidoId) {
        setError('El partido se creó pero no pudimos abrirlo. Actualizá la pantalla.');
        return;
      }
      onFinalized(partidoId);
    } catch (err) {
      const message = err?.message || '';
      if (/not_the_organizer/.test(message)) {
        setError('Otra persona quedó como organizadora de este partido.');
      } else if (/proposal_not_ready|proposal_not_open|proposal_not_found/.test(message)) {
        setError('Esta propuesta ya no está esperando organización.');
      } else if (/time_out_of_range|invalid_time/.test(message)) {
        setError('La hora tiene que quedar cerca del horario acordado con los jugadores.');
      } else if (/invalid_price/.test(message)) {
        setError('El precio no es válido.');
      } else {
        setError(message || 'No pudimos crear el partido. Intentá de nuevo.');
      }
    } finally {
      submitRef.current = false;
      setLoading(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Completar datos del partido"
      className="fixed inset-0 z-[1300] overflow-y-auto bg-[linear-gradient(180deg,#141031_0%,#100b26_46%,#090715_100%)] text-white"
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.22),transparent_48%)]" />

      <main className="relative z-10 mx-auto w-full max-w-[560px] px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+22px)] font-oswald">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-oswald text-[10px] font-semibold uppercase tracking-[0.22em] text-[#a98cff]">Sos quien organiza</p>
            <h2 className="mt-1 font-bebas-real text-[clamp(30px,9vw,40px)] leading-[0.92] tracking-[0.035em] text-white">DATOS DEL PARTIDO</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="rounded-card border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(155deg,rgba(37,29,80,0.74),rgba(13,10,31,0.94))] p-4 shadow-[0_18px_46px_rgba(4,2,16,0.32),inset_0_1px_0_rgba(255,255,255,0.055)]">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.075] bg-black/15 px-3.5 py-3">
            <div className="flex items-center gap-2 font-oswald text-[12px] text-white/70">
              <CalendarDays size={15} className="text-[#9d82ff]" />
              <span className="capitalize">{formatProposalDay(proposal.proposed_starts_at)}</span>
            </div>
            <span className="rounded-full border border-[#9b7bff]/25 bg-[#6a43ff]/12 px-2.5 py-1 font-sans text-[10px] font-bold text-[#c8baff]">
              {proposal.format} · {proposal.max_players} jugadores
            </span>
          </div>

          <div className="mb-4">
            <p className={LABEL_CLASS}>Nombre del partido</p>
            <input
              type="text"
              value={nombre}
              maxLength={60}
              onChange={(event) => setNombre(event.target.value)}
              className={INPUT_CLASS}
              placeholder={`Partido ${proposal.format}`}
            />
          </div>

          <div className="mb-4">
            <p className={LABEL_CLASS}><Clock3 size={13} className="text-[#9d82ff]" /> Hora (ajustable según la cancha)</p>
            <select
              aria-label="Hora del partido"
              value={hora}
              onChange={(event) => setHora(event.target.value)}
              className={`${INPUT_CLASS} appearance-none [&>option]:bg-[#161130] [color-scheme:dark]`}
            >
              {timeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>

          <div className="mb-4">
            <p className={LABEL_CLASS}><MapPin size={13} className="text-[#9d82ff]" /> Cancha / lugar</p>
            <VenuePicker
              value={sede}
              info={sedeInfo}
              onChange={(nextValue) => {
                setSede(nextValue);
                setSedeInfo((currentInfo) => {
                  if (!nextValue.trim()) return null;
                  const currentDescription = String(currentInfo?.description || '').trim();
                  return currentDescription && currentDescription === nextValue.trim() ? currentInfo : null;
                });
              }}
              onSelect={(info) => {
                setSedeInfo(info);
                if (info?.description) setSede(info.description);
              }}
              onClear={() => {
                setSede('');
                setSedeInfo(null);
              }}
            />
          </div>

          <div className="mb-1">
            <p className={LABEL_CLASS}><CircleDollarSign size={13} className="text-[#9d82ff]" /> Precio por persona (opcional)</p>
            <input
              type="text"
              inputMode="decimal"
              value={precio}
              onChange={(event) => setPrecio(event.target.value.replace(/[^0-9.,]/g, ''))}
              className={INPUT_CLASS}
              placeholder="Ej: 8000"
            />
          </div>

          <p className="mt-3 font-sans text-[10.5px] leading-relaxed text-white/40">
            Al confirmar se crea el partido real de Arma2 con los {proposal.max_players} confirmados adentro y vos como admin. Nadie tiene que volver a aceptar.
          </p>

          {error ? (
            <p className="mt-3 rounded-xl border border-amber-400/24 bg-amber-400/10 px-3 py-2.5 font-oswald text-[11.5px] text-amber-100">{error}</p>
          ) : null}

          <button
            type="button"
            disabled={loading}
            onClick={submit}
            className={`${PRIMARY_CTA_BUTTON_CLASS} mt-4 !min-h-[50px]`}
          >
            {loading ? 'Creando partido…' : 'Crear partido'}
          </button>
        </div>
      </main>
    </div>,
    document.body,
  );
}
