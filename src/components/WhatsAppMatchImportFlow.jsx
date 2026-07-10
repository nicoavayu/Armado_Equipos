import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageCircle, Sparkles, Users } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import PageTitle from './PageTitle';
import { useAuth } from './AuthProvider';
import { crearPartido, supabase } from '../supabase';
import { buildMatchLocationFields } from '../utils/matchLocation';
import { parseWhatsAppMatchText, WHATSAPP_ALLOWED_FORMATS } from '../utils/whatsappMatchParser';

const CUPOS = { F5: 10, F6: 12, F7: 14, F8: 16, F9: 18, F11: 22 };
const INPUT = 'h-12 w-full rounded-2xl border border-white/15 bg-[#0d0a1f]/85 px-3 font-oswald text-white outline-none focus:border-[#8b7cff]';

const namesToRows = (value) => String(value || '').split(/[,\n]/).map((name) => name.trim()).filter(Boolean);

export default function WhatsAppMatchImportFlow({ onCreated, onBack }) {
  const { user, profile } = useAuth();
  const [rawText, setRawText] = useState('');
  const [draft, setDraft] = useState(null);
  const [confirmedText, setConfirmedText] = useState('');
  const [doubtfulText, setDoubtfulText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const warnings = useMemo(() => draft?.warnings || [], [draft]);

  const analyze = () => {
    try {
      const parsed = parseWhatsAppMatchText(rawText);
      setDraft(parsed);
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

    setLoading(true);
    setError('');
    try {
      const partido = await crearPartido({
        match_ref: uuidv4(),
        nombre: draft.nombre.trim(),
        fecha: draft.fecha,
        hora: draft.hora,
        ...buildMatchLocationFields({ locationText: draft.sede, locationInfo: null }),
        modalidad: draft.modalidad,
        cupo_jugadores: CUPOS[draft.modalidad] || 10,
        falta_jugadores: true,
        player_invites_enabled: true,
        tipo_partido: draft.tipoPartido || 'Masculino',
        creado_por: user?.id,
        precio_cancha_por_persona: draft.precioPorPersona || null,
      });

      const creatorName = profile?.nombre || user?.email?.split('@')[0] || 'Organizador';
      const importedNames = namesToRows(confirmedText).filter((name) => name.toLowerCase() !== creatorName.toLowerCase());
      const rows = [
        {
          partido_id: partido.id,
          match_ref: partido.match_ref,
          usuario_id: user.id,
          nombre: creatorName,
          avatar_url: profile?.avatar_url || null,
          score: 5,
          is_goalkeeper: false,
        },
        ...importedNames.map((nombre) => ({
          partido_id: partido.id,
          match_ref: partido.match_ref,
          usuario_id: null,
          uuid: uuidv4(),
          nombre,
          avatar_url: null,
          score: 5,
          is_goalkeeper: false,
        })),
      ];
      const { error: playersError } = await supabase.from('jugadores').insert(rows);
      if (playersError) throw playersError;

      await onCreated(partido, {
        doubtfulPlayers: namesToRows(doubtfulText),
        source: 'whatsapp_text',
      });
    } catch (err) {
      setError(err.message || 'No se pudo crear el partido importado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0b0818] pb-10">
      <PageTitle title="IMPORTAR DESDE WHATSAPP" onBack={onBack}>IMPORTAR DESDE WHATSAPP</PageTitle>
      <main className="mx-auto w-full max-w-[560px] px-4 pt-24 font-oswald">
        {!draft ? (
          <section className="rounded-card border border-[#8b7cff]/25 bg-[linear-gradient(155deg,rgba(43,32,91,.78),rgba(13,10,31,.96))] p-4 shadow-elev-2">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#25D366]/15 text-[#6ee7a0]"><MessageCircle /></span>
              <div><h2 className="text-xl font-bold text-white">Pegá la conversación</h2><p className="text-sm text-white/55">Arma2 la convierte en un borrador editable.</p></div>
            </div>
            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              rows={12}
              placeholder={'Ejemplo:\nJueves 22 en La Terraza, F7. Sale 10 lucas.\nNico: Voy\nSeba: Estoy en duda'}
              className="w-full resize-none rounded-2xl border border-white/15 bg-[#090715] p-3 font-sans text-sm leading-relaxed text-white outline-none placeholder:text-white/25 focus:border-[#8b7cff]"
            />
            {error ? <p className="mt-3 text-sm text-amber-200">{error}</p> : null}
            <button type="button" onClick={analyze} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cta-gradient font-bebas text-lg text-white shadow-cta">
              <Sparkles size={18} /> Analizar mensajes
            </button>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="rounded-card border border-[#8b7cff]/25 bg-[linear-gradient(155deg,rgba(43,32,91,.78),rgba(13,10,31,.96))] p-4 shadow-elev-2">
              <div className="mb-4 flex items-center gap-2 text-[#c8baff]"><CheckCircle2 size={18} /><span className="font-bold uppercase tracking-wide">Borrador detectado</span></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2 text-xs uppercase tracking-wider text-white/50">Nombre<input className={`${INPUT} mt-1`} value={draft.nombre} onChange={(e) => updateDraft('nombre', e.target.value)} /></label>
                <label className="text-xs uppercase tracking-wider text-white/50">Fecha<input type="date" className={`${INPUT} mt-1`} value={draft.fecha} onChange={(e) => updateDraft('fecha', e.target.value)} /></label>
                <label className="text-xs uppercase tracking-wider text-white/50">Hora<input type="time" className={`${INPUT} mt-1`} value={draft.hora} onChange={(e) => updateDraft('hora', e.target.value)} /></label>
                <label className="sm:col-span-2 text-xs uppercase tracking-wider text-white/50">Cancha o lugar<input className={`${INPUT} mt-1`} value={draft.sede} onChange={(e) => updateDraft('sede', e.target.value)} /></label>
                <label className="text-xs uppercase tracking-wider text-white/50">Formato<select className={`${INPUT} mt-1`} value={draft.modalidad} onChange={(e) => updateDraft('modalidad', e.target.value)}>{WHATSAPP_ALLOWED_FORMATS.map((format) => <option key={format}>{format}</option>)}</select></label>
                <label className="text-xs uppercase tracking-wider text-white/50">Precio por persona<input inputMode="numeric" className={`${INPUT} mt-1`} value={draft.precioPorPersona || ''} onChange={(e) => updateDraft('precioPorPersona', Number(e.target.value) || null)} /></label>
                <label className="sm:col-span-2 text-xs uppercase tracking-wider text-white/50">Confirmados<textarea rows={3} className={`${INPUT} mt-1 h-auto py-3`} value={confirmedText} onChange={(e) => setConfirmedText(e.target.value)} /></label>
                <label className="sm:col-span-2 text-xs uppercase tracking-wider text-white/50">En duda<textarea rows={2} className={`${INPUT} mt-1 h-auto py-3`} value={doubtfulText} onChange={(e) => setDoubtfulText(e.target.value)} /></label>
              </div>
            </div>

            {warnings.length ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                <div className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={16} /> Revisá estos datos</div>
                {warnings.map((warning) => <p key={warning}>• {warning}</p>)}
              </div>
            ) : null}
            <div className="rounded-2xl border border-white/10 bg-white/[.035] p-3 text-xs leading-relaxed text-white/55"><Users size={15} className="mr-1 inline" />Los nombres importados se agregan como jugadores manuales. Podés vincular o invitar usuarios desde el partido.</div>
            {error ? <p className="text-sm text-amber-200">{error}</p> : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => setDraft(null)} className="min-h-12 flex-1 rounded-2xl border border-white/15 bg-white/[.04] text-white">Volver a analizar</button>
              <button type="button" disabled={loading} onClick={createImportedMatch} className="min-h-12 flex-[1.4] rounded-2xl bg-cta-gradient font-bebas text-lg text-white shadow-cta disabled:opacity-50">{loading ? 'Creando…' : 'Crear partido'}</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
