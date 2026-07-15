import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Sparkles,
  Users,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import PageTitle from './PageTitle';
import VenuePicker from './VenuePicker';
import { useAuth } from './AuthProvider';
import { crearPartido } from '../supabase';
import { buildMatchLocationFields } from '../utils/matchLocation';
import {
  isAllowedMatchTime,
  isBlockedInDebug,
  normalizeTimeHHmm,
  MATCH_TIME_RANGE_MESSAGE,
} from '../lib/matchDateDebug';
import { PRIMARY_CTA_BUTTON_CLASS } from '../styles/buttonClasses';
import { AUTH_REQUIRED_MESSAGE, describeDbAccessError, getUsableSession } from '../services/db/dbErrors';
import { buildImportedPlayerRows, saveImportedPlayers } from '../services/db/importedMatchPlayers';
import { parseWhatsAppMatchText, WHATSAPP_ALLOWED_FORMATS } from '../utils/whatsappMatchParser';

const CUPOS = { F5: 10, F6: 12, F7: 14, F8: 16, F9: 18, F11: 22 };
const INPUT = 'h-[50px] w-full rounded-2xl border border-[rgba(148,134,255,0.3)] bg-[rgba(13,10,30,0.82)] px-4 font-oswald text-[16px] text-white outline-none backdrop-blur-md transition-all placeholder:text-white/30 focus:border-[#8b7cff] focus:bg-[rgba(22,17,48,0.95)] focus:ring-2 focus:ring-[#6a43ff]/20';

const namesToRows = (value) => String(value || '')
  .split(/[,\n]/)
  .map((name) => name.trim())
  .filter(Boolean);

const ImportBackground = () => (
  <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.22),transparent_48%),radial-gradient(circle_at_8%_56%,rgba(73,43,171,0.14),transparent_32%),radial-gradient(circle_at_96%_82%,rgba(236,0,125,0.07),transparent_30%),linear-gradient(180deg,#0c091b_0%,#100b26_48%,#090715_100%)]" />
    <div className="absolute left-1/2 top-[36%] h-[360px] w-[760px] -translate-x-1/2 rounded-[50%] border border-[#7d5aff]/10 shadow-[0_0_100px_rgba(106,67,255,0.1)]" />
    <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(255,255,255,.24)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.24)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,transparent,black_24%,black_74%,transparent)]" />
  </div>
);

const FieldLabel = ({ children, className = '' }) => (
  <span className={`mb-1.5 block font-oswald text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45 ${className}`}>
    {children}
  </span>
);

const DetectedSummary = ({ draft, confirmedCount, doubtfulCount }) => {
  const rows = [
    { icon: <CalendarDays />, label: draft.fecha || 'Fecha pendiente' },
    { icon: <Clock3 />, label: draft.hora ? `${draft.hora} hs` : 'Hora pendiente' },
    { icon: <MapPin />, label: draft.sede || 'Lugar pendiente' },
    { icon: <Users />, label: `${confirmedCount} confirmados · ${doubtfulCount} en duda` },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map((row) => (
        <div key={row.label} className="flex min-h-[46px] items-center gap-2 rounded-xl border border-white/[0.075] bg-black/15 px-2.5 py-2">
          <span className="text-[#aa94ff]">{React.cloneElement(row.icon, { size: 14, strokeWidth: 1.9 })}</span>
          <span className="min-w-0 truncate font-oswald text-[11.5px] font-medium text-white/66">{row.label}</span>
        </div>
      ))}
    </div>
  );
};

export default function WhatsAppMatchImportFlow({ onCreated, onBack }) {
  const { user, profile } = useAuth();
  const [rawText, setRawText] = useState('');
  const [draft, setDraft] = useState(null);
  const [sedeInfo, setSedeInfo] = useState(null);
  const [confirmedText, setConfirmedText] = useState('');
  const [doubtfulText, setDoubtfulText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Partial result after the match exists: { failedNames, creatorFailed,
  // verified }. Rendered as its own screen with retry / continue options.
  const [importIssue, setImportIssue] = useState(null);
  // Synchronous double-tap guard (state updates are async) + the created
  // match, so a retry never creates a second partido.
  const creatingRef = useRef(false);
  const createdMatchRef = useRef(null);

  const warnings = useMemo(() => draft?.warnings || [], [draft]);
  const confirmedNames = useMemo(() => namesToRows(confirmedText), [confirmedText]);
  const doubtfulNames = useMemo(() => namesToRows(doubtfulText), [doubtfulText]);

  const analyze = () => {
    try {
      const parsed = parseWhatsAppMatchText(rawText);
      setDraft(parsed);
      setSedeInfo(null);
      setConfirmedText(parsed.confirmedPlayers.join(', '));
      setDoubtfulText(parsed.doubtfulPlayers.join(', '));
      setError('');
    } catch (err) {
      setError(err.message || 'No pudimos interpretar esos mensajes.');
    }
  };

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const createImportedMatch = async () => {
    if (!draft?.nombre?.trim() || !draft?.fecha || !draft?.hora || !draft?.sede?.trim()) {
      setError('Completá nombre, fecha, horario y lugar antes de crear el partido.');
      return;
    }

    // Same rules as the manual wizard: sane hours and no past matches.
    const hora = normalizeTimeHHmm(draft.hora);
    if (!hora) {
      setError('El horario no es válido. Usá el formato HH:MM.');
      return;
    }
    if (!isAllowedMatchTime(hora)) {
      setError(MATCH_TIME_RANGE_MESSAGE);
      return;
    }
    if (isBlockedInDebug(draft.fecha, hora)) {
      setError('La fecha y hora elegidas ya pasaron. Elegí un día y horario posteriores.');
      return;
    }

    if (creatingRef.current) return;
    creatingRef.current = true;
    setLoading(true);
    setError('');
    try {
      // partidos INSERT is RLS-gated to authenticated sessions; make sure the
      // session is usable (refreshing if expired) before touching the backend.
      const session = await getUsableSession();
      if (!session) {
        setError(AUTH_REQUIRED_MESSAGE);
        return;
      }

      // A retry after a partial failure reuses the already created match.
      const isRetry = Boolean(createdMatchRef.current);
      let partido = createdMatchRef.current;
      if (!partido) {
        partido = await crearPartido({
          match_ref: uuidv4(),
          nombre: draft.nombre.trim(),
          fecha: draft.fecha,
          hora,
          ...buildMatchLocationFields({ locationText: draft.sede, locationInfo: sedeInfo }),
          modalidad: draft.modalidad,
          cupo_jugadores: CUPOS[draft.modalidad] || 10,
          falta_jugadores: true,
          player_invites_enabled: true,
          tipo_partido: draft.tipoPartido || 'Masculino',
          creado_por: user?.id,
          precio_cancha_por_persona: draft.precioPorPersona || null,
        });
        createdMatchRef.current = partido;
      }

      const creatorName = profile?.nombre || user?.email?.split('@')[0] || 'Organizador';
      const rows = buildImportedPlayerRows({
        partido,
        userId: user.id,
        creatorName,
        creatorAvatarUrl: profile?.avatar_url || null,
        confirmedNames,
      });
      const result = await saveImportedPlayers({ partidoId: partido.id, rows, retry: isRetry });

      if (result.failedRows.length === 0) {
        await onCreated(partido, {
          doubtfulPlayers: doubtfulNames,
          source: 'whatsapp_text',
        });
        return;
      }

      // The match exists but part of the confirmed roster didn't land:
      // never navigate as if everything imported fine.
      setImportIssue({
        failedNames: result.failedRows.filter((row) => !row.usuario_id).map((row) => row.nombre),
        creatorFailed: result.failedRows.some((row) => row.usuario_id),
        verified: result.verified,
      });
    } catch (err) {
      const friendly = describeDbAccessError(err, {
        operation: 'createImportedMatch',
        target: 'partidos/jugadores',
        userId: user?.id,
      });
      setError(friendly?.message || 'No se pudo crear el partido importado.');
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  };

  const goToMatchAnyway = async () => {
    if (!createdMatchRef.current) return;
    await onCreated(createdMatchRef.current, {
      doubtfulPlayers: doubtfulNames,
      source: 'whatsapp_text',
    });
  };

  return (
    // -mt cancels MainLayout's safe-top padding: this view owns the full offset
    // (fixed header + content padding), so the safe area is never counted twice.
    <div className="relative mt-[calc(var(--safe-top,0px)*-1)] min-h-[100dvh] overflow-hidden pb-10 text-white">
      <ImportBackground />
      <PageTitle respectSafeArea title="IMPORTAR DESDE WHATSAPP" onBack={onBack}>IMPORTAR DESDE WHATSAPP</PageTitle>

      <main className="relative z-10 mx-auto w-full max-w-[560px] px-4 pb-[max(28px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+80px)] font-oswald">
        {importIssue ? (
          <section className="space-y-3">
            <div className="mb-4">
              <div className="flex items-center gap-2 font-oswald text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/90">
                <AlertTriangle size={15} /> Importación incompleta
              </div>
              <h2 className="mt-1 font-bebas-real text-[clamp(34px,9.5vw,42px)] leading-[0.95] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
                EL PARTIDO SE CREÓ
              </h2>
              <p className="mt-1.5 font-oswald text-[13px] leading-relaxed text-white/62">
                {importIssue.verified
                  ? `Pero no pudimos agregar a ${importIssue.failedNames.length + (importIssue.creatorFailed ? 1 : 0)} jugador${importIssue.failedNames.length + (importIssue.creatorFailed ? 1 : 0) === 1 ? '' : 'es'}. Podés reintentar o sumarlos manualmente desde el panel.`
                  : 'Pero no pudimos confirmar si los jugadores se guardaron (¿problemas de conexión?). Reintentá antes de continuar.'}
              </p>
            </div>

            {importIssue.creatorFailed ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 font-sans text-[12px] leading-relaxed text-amber-100">
                Tu propio jugador (organizador) tampoco se pudo agregar.
              </div>
            ) : null}

            {importIssue.failedNames.length ? (
              <div className="rounded-2xl border border-white/[0.075] bg-black/15 p-3.5">
                <p className="mb-2 font-oswald text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  No se pudieron agregar
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {importIssue.failedNames.map((name) => (
                    <span key={name} className="rounded-full border border-amber-400/25 bg-amber-400/[0.08] px-2.5 py-1 font-oswald text-[12px] text-amber-50">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-100">
                {error}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={createImportedMatch}
                className={`${PRIMARY_CTA_BUTTON_CLASS} !min-h-[50px]`}
              >
                {loading ? 'Reintentando…' : 'Reintentar jugadores faltantes'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={goToMatchAnyway}
                className="min-h-[50px] rounded-2xl border border-[rgba(148,134,255,0.22)] bg-white/[0.04] px-3 font-oswald text-[13px] font-semibold text-white/68 transition-all hover:bg-white/[0.075] active:scale-[0.98]"
              >
                Ir al partido y sumarlos manualmente
              </button>
            </div>
          </section>
        ) : !draft ? (
          <section>
            <div className="mb-6 text-center">
              {/* Preserve the removed eyebrow's 10px/1.5 line box so the main
                  prompt stays at the exact same vertical position. */}
              <div aria-hidden="true" className="wa-import-eyebrow-spacer h-[15px]" />
              <h2 className="mt-1 font-bebas-real text-[clamp(34px,9.5vw,42px)] leading-[0.95] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
                PEGÁ LA CONVERSACIÓN
              </h2>
              <p className="mx-auto mt-2 max-w-[410px] font-oswald text-[12.5px] leading-relaxed text-white/52">
                Arma2 detecta la información principal y prepara un borrador. Nada se crea sin tu revisión.
              </p>
            </div>

            <div className="rounded-2xl border border-[rgba(148,134,255,0.26)] bg-[#090715]/88 p-1 shadow-[0_16px_44px_rgba(5,2,22,0.34),inset_0_1px_0_rgba(255,255,255,0.035)]">
              <textarea
                value={rawText}
                onChange={(event) => setRawText(event.target.value)}
                rows={11}
                placeholder={'Ejemplo:\nJueves 22 en La Terraza, F7. Sale 10 lucas.\nNico: Voy\nSeba: Estoy en duda'}
                className="w-full resize-none rounded-[14px] border-0 bg-transparent p-3 font-sans text-[13px] leading-relaxed text-white outline-none placeholder:text-white/23"
                aria-label="Mensajes de WhatsApp"
              />
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.075] bg-white/[0.035] px-3 py-2.5 font-sans text-[10.5px] leading-relaxed text-white/42">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-[#aa94ff]" />
              Funciona mejor cuando los mensajes incluyen día, horario, lugar, formato y quiénes juegan.
            </div>

            {error ? (
              <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-100">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={analyze}
              disabled={!rawText.trim()}
              className={`${PRIMARY_CTA_BUTTON_CLASS} mt-4 !min-h-[50px]`}
            >
              <Sparkles size={18} className="mr-2" />
              Analizar mensajes
            </button>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="mb-4">
              <div className="flex items-center gap-2 font-oswald text-[10px] font-semibold uppercase tracking-[0.18em] text-[#aa94ff]">
                <CheckCircle2 size={15} /> Borrador detectado
              </div>
              <h2 className="mt-1 font-bebas-real text-[clamp(34px,9.5vw,42px)] leading-[0.95] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
                REVISÁ EL PARTIDO
              </h2>
              <p className="mt-1.5 font-oswald text-[12px] leading-relaxed text-white/48">Corregí cualquier dato antes de crear.</p>
            </div>

            <DetectedSummary
              draft={draft}
              confirmedCount={confirmedNames.length}
              doubtfulCount={doubtfulNames.length}
            />

            <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <FieldLabel>Nombre</FieldLabel>
                <input className={INPUT} value={draft.nombre} onChange={(event) => updateDraft('nombre', event.target.value)} />
              </label>
              <label>
                <FieldLabel>Fecha</FieldLabel>
                <input type="date" className={INPUT} value={draft.fecha} onChange={(event) => updateDraft('fecha', event.target.value)} />
              </label>
              <label>
                <FieldLabel>Hora</FieldLabel>
                <input type="time" className={INPUT} value={draft.hora} onChange={(event) => updateDraft('hora', event.target.value)} />
              </label>

              <div className="relative z-20 overflow-visible sm:col-span-2">
                <FieldLabel>Cancha o lugar</FieldLabel>
                <VenuePicker
                  value={draft.sede}
                  info={sedeInfo}
                  onChange={(nextValue) => {
                    updateDraft('sede', nextValue);
                    setSedeInfo((currentInfo) => {
                      if (!nextValue.trim()) return null;
                      const currentDescription = String(currentInfo?.description || '').trim();
                      return currentDescription && currentDescription === nextValue.trim()
                        ? currentInfo
                        : null;
                    });
                  }}
                  onSelect={(info) => {
                    updateDraft('sede', info.description);
                    setSedeInfo(info);
                  }}
                  onClear={() => {
                    updateDraft('sede', '');
                    setSedeInfo(null);
                  }}
                />
              </div>

              <div className="sm:col-span-2">
                <FieldLabel>Formato</FieldLabel>
                <div className="grid grid-cols-6 gap-1.5">
                  {WHATSAPP_ALLOWED_FORMATS.map((format) => {
                    const active = draft.modalidad === format;
                    return (
                      <button
                        type="button"
                        key={format}
                        onClick={() => updateDraft('modalidad', format)}
                        className={`min-h-11 rounded-xl border font-oswald text-[13px] font-bold transition-all active:scale-[0.98] ${active
                          ? 'border-[#9b7bff] bg-[linear-gradient(145deg,rgba(112,48,255,0.62),rgba(57,24,132,0.8))] text-white shadow-[0_8px_22px_rgba(75,38,180,0.3)]'
                          : 'border-white/10 bg-white/[0.035] text-white/45 hover:border-[#9b7bff]/35 hover:text-white/70'}`}
                      >
                        {format}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="sm:col-span-2">
                <FieldLabel>Precio por persona</FieldLabel>
                <input
                  inputMode="numeric"
                  className={INPUT}
                  value={draft.precioPorPersona || ''}
                  placeholder="Opcional"
                  onChange={(event) => updateDraft('precioPorPersona', Number(event.target.value) || null)}
                />
              </label>
              <label className="sm:col-span-2">
                <FieldLabel>Confirmados</FieldLabel>
                <textarea rows={3} className={`${INPUT} h-auto min-h-[92px] py-3`} value={confirmedText} onChange={(event) => setConfirmedText(event.target.value)} />
              </label>
              <label className="sm:col-span-2">
                <FieldLabel>En duda</FieldLabel>
                <textarea rows={2} className={`${INPUT} h-auto min-h-[72px] py-3`} value={doubtfulText} onChange={(event) => setDoubtfulText(event.target.value)} />
              </label>
            </div>

            {warnings.length ? (
              <div className="rounded-2xl border border-amber-400/25 bg-[linear-gradient(145deg,rgba(120,77,12,0.22),rgba(38,26,9,0.5))] p-3.5 text-sm text-amber-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="mb-1.5 flex items-center gap-2 font-oswald text-[12px] font-bold uppercase tracking-[0.08em]">
                  <AlertTriangle size={16} /> Revisá estos datos
                </div>
                <div className="space-y-1 font-sans text-[11.5px] leading-relaxed text-amber-50/75">
                  {warnings.map((warning) => <p key={warning}>• {warning}</p>)}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/[0.075] bg-white/[0.035] p-3 font-sans text-[10.5px] leading-relaxed text-white/44">
              <Users size={15} className="mr-1.5 inline text-[#aa94ff]" />
              Los nombres se agregan como jugadores manuales. Después podés vincularlos o invitarlos desde el partido.
            </div>

            {error ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-100">
                {error}
              </div>
            ) : null}

            <div className="grid grid-cols-[0.85fr_1.15fr] gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError('');
                }}
                className="min-h-[50px] rounded-2xl border border-[rgba(148,134,255,0.22)] bg-white/[0.04] px-3 font-oswald text-[13px] font-semibold text-white/68 transition-all hover:bg-white/[0.075] active:scale-[0.98]"
              >
                Volver a analizar
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={createImportedMatch}
                className={`${PRIMARY_CTA_BUTTON_CLASS} !min-h-[50px]`}
              >
                {loading ? 'Creando…' : 'Crear partido'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
