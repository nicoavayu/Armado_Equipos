import React, { useState, useRef, useEffect } from 'react';
import { updatePartidoFrecuente, supabase } from '../supabase';
import { toast } from 'react-toastify';
import AutocompleteSede from '../components/AutocompleteSede';
import PageTitle from '../components/PageTitle';
import { parseLocalDateTime, weekdayFromYMD } from '../utils/dateLocal';

export default function EditarPartidoFrecuente({ partido, onGuardado, onVolver }) {
  const [nombre, setNombre] = useState(partido.nombre);
  // Inicializar fecha desde partido.fecha (recortando ISO a YYYY-MM-DD si hace falta)
  const initialFecha = partido && partido.fecha ? String(partido.fecha).split('T')[0] : new Date().toISOString().split('T')[0];
  const [fecha, setFecha] = useState(initialFecha);
  const [hora, setHora] = useState(partido.hora);
  const [sede, setSede] = useState(partido.sede);
  const [_sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(partido.imagen_url);
  const [tipoPartido, setTipoPartido] = useState(partido.tipo_partido || 'Masculino');

  const handleFile = (e) => {
    if (e.target && e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      try { setFotoPreview(URL.createObjectURL(e.target.files[0])); } catch (_) { /* ignore */ }
    }
  };

  // precio cancha state (string to allow empty value)
  const [precioCancha, setPrecioCancha] = useState(
    // Initialize from partido.precio_cancha first, fallback to partido.precio, else empty
    (partido.precio_cancha !== undefined && partido.precio_cancha !== null) ? String(partido.precio_cancha) : (partido.precio !== undefined && partido.precio !== null ? String(partido.precio) : '')
  );

  const getFrequentIdFromPartido = (p) => {
    if (!p) return null;
    // Use ONLY partido.partido_frecuente_id or partido.partido_frecuente?.id
    if (typeof p.partido_frecuente_id === 'string') return p.partido_frecuente_id;
    if (p.partido_frecuente && typeof p.partido_frecuente.id === 'string') return p.partido_frecuente.id;
    return null;
  };

  // hasTemplate state initialized from current partido prop
  const initialHasTemplate = !!getFrequentIdFromPartido(partido);
  // keep initialHasTemplate for informational purposes but remove create-as-frequent UI from this editor
  // (The save-as-frequent action has been moved to the New Match flow)

  const normalizeTimeTo24 = (timeStr) => {
    if (!timeStr) return '00:00';
    const t = String(timeStr).trim();
    // If already like 13:45
    if (/^\d{1,2}:\d{2}$/.test(t)) {
      const [h, m] = t.split(':').map((s) => s.padStart(2, '0'));
      return `${h}:${m}`;
    }
    // Match formats like '03:26 PM' or '3:26 pm'
    const ampmMatch = t.match(/^(\d{1,2}):(\d{2})\s*([APap][Mm])$/);
    if (ampmMatch) {
      let hh = parseInt(ampmMatch[1], 10);
      const mm = ampmMatch[2];
      const ampm = ampmMatch[3].toUpperCase();
      if (ampm === 'PM' && hh !== 12) hh += 12;
      if (ampm === 'AM' && hh === 12) hh = 0;
      return `${String(hh).padStart(2, '0')}:${mm}`;
    }
    // Try to extract digits fallback
    const fallback = t.match(/(\d{1,2}):(\d{2})/);
    if (fallback) {
      return `${String(fallback[1]).padStart(2, '0')}:${fallback[2]}`;
    }
    return '00:00';
  };

  // Inline ConfirmModal copied from ListaPartidosFrecuentes for app-style overlay
  function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = 'CONFIRMAR', cancelText = 'CANCELAR', isDeleting = false }) {
    const overlayRef = useRef(null);
    const cancelRef = useRef(null);
    const confirmRef = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
      if (!isOpen) return;
      setVisible(false);
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }, [isOpen]);

    useEffect(() => {
      if (!isOpen) return;
      const focusTarget = cancelRef.current || confirmRef.current;
      try { focusTarget && focusTarget.focus(); } catch (_) { }

      const keyHandler = (e) => {
        if (e.key === 'Escape') {
          if (isDeleting) return;
          e.preventDefault();
          onCancel && onCancel();
          return;
        }

        if (e.key === 'Tab') {
          const focusable = [cancelRef.current, confirmRef.current].filter(Boolean);
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };

      document.addEventListener('keydown', keyHandler, true);
      return () => document.removeEventListener('keydown', keyHandler, true);
    }, [isOpen, isDeleting, onCancel]);

    if (!isOpen) return null;

    const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return (
      <div
        ref={overlayRef}
        className={`fixed inset-0 bg-black/60 z-[2000] flex items-center justify-center p-4 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => { if (!isDeleting) onCancel && onCancel(); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'confirm-modal-title' : undefined}
        aria-describedby={message ? 'confirm-modal-message' : undefined}
      >
        <div
          className={`w-full max-w-[520px] bg-white/5 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] border border-white/10 text-white box-border transition-transform duration-180 ease-[cubic-bezier(.2,.9,.3,1)] ${visible ? 'scale-100 opacity-100' : 'scale-98 opacity-0'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {title && <div id="confirm-modal-title" className="text-2xl font-bold mb-4 font-bebas tracking-wider text-white uppercase">{title}</div>}
          <div id="confirm-modal-message" className="text-base text-white/70 mb-8 font-oswald">{message}</div>
          <div className="flex gap-4 justify-end">
            <button
              ref={cancelRef}
              className="flex-1 py-3 px-4 bg-white/5 border border-white/10 text-white font-bold rounded-xl transition-all hover:bg-white/10 font-oswald uppercase tracking-widest text-xs"
              onClick={() => { if (isDeleting) return; onCancel && onCancel(); }}
              disabled={isDeleting}
              aria-disabled={isDeleting}
            >
              {cancelText}
            </button>
            <button
              ref={confirmRef}
              className="flex-1 py-3 px-4 bg-primary text-white font-bold rounded-xl transition-all shadow-lg hover:brightness-110 font-oswald uppercase tracking-widest text-xs"
              onClick={() => { if (isDeleting) return; onConfirm && onConfirm(); }}
              disabled={isDeleting}
              aria-disabled={isDeleting}
            >
              {isDeleting ? (confirmText || 'EN PROCESO…') : (confirmText || 'CONFIRMAR')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const guardarCambios = async () => {
    try {
      // Validate precioCancha: no negativos, empty => null, accept decimals
      const raw = (precioCancha === null || precioCancha === undefined || precioCancha === '') ? '' : String(precioCancha).trim();
      let precioVal = null;
      if (raw !== '') {
        // accept comma as decimal separator
        const normalized = raw.replace(',', '.');
        precioVal = parseFloat(normalized);
        if (Number.isNaN(precioVal)) {
          toast.error('Precio inválido');
          return;
        }
        if (precioVal < 0) {
          toast.error('El precio no puede ser negativo');
          return;
        }
      } else {
        precioVal = null; // save NULL when empty
      }

      // Validar que fecha y hora formen una fecha/hora válida usando parseLocalDateTime
      if (!fecha || !hora) {
        toast.error('Fecha/hora inválida');
        return;
      }
      const time24 = normalizeTimeTo24(hora);
      const fechaHoraEditada = parseLocalDateTime(fecha, time24);
      if (!fechaHoraEditada || Number.isNaN(fechaHoraEditada.getTime())) {
        toast.error('Fecha/hora inválida');
        return;
      }

      // Compute revival rule: if fechaHoraEditada > (now - 5 minutes) -> revive
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const shouldRevive = fechaHoraEditada.getTime() > fiveMinutesAgo.getTime();

      // Determine active states from project conventions
      const ACTIVE_STATES = ['equipos_formados', 'activo', 'en_juego', 'en_curso'];
      const currentlyActive = ACTIVE_STATES.includes(partido.estado);

      setLoading(true);

      // Upload image if provided (do this once, then include in updatesFrecuente if uploaded)
      let uploadedImageUrl = null;
      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `partido_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('jugadores-fotos')
          .upload(fileName, file, { upsert: true });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from('jugadores-fotos')
          .getPublicUrl(fileName);

        uploadedImageUrl = data?.publicUrl;
      }

      // Build separate update objects
      const updatesFrecuente = {};
      // Only fields allowed in partidos_frecuentes
      if (nombre !== undefined) updatesFrecuente.nombre = nombre;
      if (sede !== undefined) updatesFrecuente.sede = sede;
      if (tipoPartido !== undefined) updatesFrecuente.tipo_partido = tipoPartido;
      if (precioVal !== undefined) {
        updatesFrecuente.precio_cancha = precioVal; // write to existing column
        updatesFrecuente.precio = precioVal; // also write legacy 'precio' for backward compatibility
      }
      if (uploadedImageUrl) updatesFrecuente.imagen_url = uploadedImageUrl;

      const updatesPartido = {};
      if (fecha !== undefined) updatesPartido.fecha = fecha;
      if (hora !== undefined) updatesPartido.hora = hora;
      // Do not send dia_semana to the partidos table (the partidos table does not have this column).
      // If the UI needs the day of week, compute it client-side from `fecha` using weekdayFromYMD(fecha) when rendering.
      // estado only if reviving
      if (shouldRevive && !currentlyActive) updatesPartido.estado = 'activo';

      // Execute updates in sequence. Determine frequent id using strict fields only
      const frequentIdCandidate = getFrequentIdFromPartido(partido);

      // Defensive validation: ensure frequentIdCandidate is a UUID string (contains '-')
      const hasValidFrequentUuid = typeof frequentIdCandidate === 'string' && frequentIdCandidate.includes('-');

      // Track whether estado update succeeded to show 'Partido reactivado' only if it was applied in partidos
      let partidoUpdateResult = null;

      // Update frequent template if id available and there are fields to update
      if (Object.keys(updatesFrecuente).length > 0) {
        if (hasValidFrequentUuid) {
          const resFrecuente = await updatePartidoFrecuente(frequentIdCandidate, updatesFrecuente);
          // handle functions that return {data, error}
          if (resFrecuente && typeof resFrecuente === 'object' && 'error' in resFrecuente && resFrecuente.error) {
            throw resFrecuente.error;
          }
        } else {
          console.warn('[EditarPartidoFrecuente] plantilla frecuente inválida o inexistente. Omitting updatePartidoFrecuente. partido:', partido);
          toast.warn('Este partido no tiene plantilla asociada');
        }
      }

      // Now update the actual partido row
      const { data: partidoData, error: partidoError } = await supabase
        .from('partidos')
        .update(updatesPartido)
        .eq('id', partido.id)
        .select()
        .single();

      if (partidoError) throw partidoError;
      partidoUpdateResult = partidoData;

      // Both updates succeeded
      toast.success('Cambios guardados');

      // If revived (we included estado in updatesPartido), show extra toast
      if (updatesPartido.estado === 'activo') {
        toast.success('Partido reactivado ✅');
      }

      onGuardado && onGuardado();
    } catch (error) {
      console.error('[EditarPartidoFrecuente] guardarCambios error', error);

      // Build user-friendly message
      let mensajeCorto = '';

      if (error && typeof error === 'object') {
        if (error.message) {
          mensajeCorto = error.message;
        } else if (error.code || error.details || error.hint) {
          const parts = [];
          if (error.code) parts.push(`code: ${error.code}`);
          if (error.message) parts.push(`message: ${error.message}`);
          if (error.details) parts.push(`details: ${error.details}`);
          if (error.hint) parts.push(`hint: ${error.hint}`);
          mensajeCorto = parts.join(' | ');
        } else {
          try {
            mensajeCorto = JSON.stringify(error);
          } catch (e) {
            mensajeCorto = String(error);
          }
        }
      } else {
        mensajeCorto = String(error);
      }

      // Special-case: precio_cancha missing -> show SQL toast and do not show success
      const lower = (mensajeCorto || '').toLowerCase();
      if (lower.includes('precio_cancha') && (lower.includes('does not exist') || lower.includes('no existe') || lower.includes('column'))) {
        const sql = 'ALTER TABLE public.partidos_frecuentes ADD COLUMN precio_cancha numeric;';
        console.error('SQL to add column precio_cancha (recommended type numeric):\n' + sql);
        toast.error('Falta correr el SQL: ' + sql);
      } else {
        // Log helpful SQL for debugging (kept for other errors)
        console.error('SQL to add column precio_cancha (recommended type numeric):\nALTER TABLE partidos_frecuentes ADD COLUMN precio_cancha numeric;\n-- or, if you use the main partidos table: ALTER TABLE partidos ADD COLUMN precio_cancha numeric;');

        toast.error('Error al guardar: ' + (mensajeCorto || 'Error desconocido'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent w-full p-5 flex flex-col items-center justify-start font-oswald box-border pb-24 pt-24">
      <PageTitle title="EDITAR" onBack={onVolver}>EDITAR</PageTitle>
      <div className="w-full max-w-[500px] flex flex-col gap-6 mt-6">
        <PageTitle title="EDITAR" onBack={onVolver}>EDITAR</PageTitle>

        <div className="flex flex-col gap-0 w-[90vw] max-w-[400px]">
          <div className="flex items-center gap-4 w-full bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-md">
            <div
              className="cursor-pointer w-[72px] h-[72px] rounded-xl bg-white/10 border border-white/20 flex items-center justify-center overflow-hidden shrink-0 transition-all duration-300 hover:bg-white/20 hover:border-white/40 shadow-inner"
              onClick={() => document.getElementById('edit-partido-foto-input').click()}
              title={fotoPreview ? 'Cambiar foto' : 'Agregar foto'}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="foto partido" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-3xl font-light">+</span>
              )}
              <input
                id="edit-partido-foto-input"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
            </div>
            <div className="text-white/70 text-base font-oswald font-medium">
              Foto del partido (opcional)
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-white/60 font-medium block font-oswald text-xs uppercase tracking-widest pl-1">
              Nombre del partido
            </label>
            <input
              className="appearance-none bg-white/5 border border-white/20 text-white font-oswald text-lg px-4 py-3 rounded-xl w-full box-border h-[54px] transition-all duration-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 backdrop-blur-md placeholder:text-white/30"
              type="text"
              placeholder="Nombre del partido"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-white/60 font-medium block font-oswald text-xs uppercase tracking-widest pl-1">
              Fecha
            </label>
            <input
              className="appearance-none bg-white/5 border border-white/20 text-white font-oswald text-lg px-4 py-3 rounded-xl w-full box-border h-[54px] transition-all duration-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 backdrop-blur-md"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-white/60 font-medium block font-oswald text-xs uppercase tracking-widest pl-1">
              Hora
            </label>
            <input
              className="appearance-none bg-white/5 border border-white/20 text-white font-oswald text-lg px-4 py-3 rounded-xl w-full box-border h-[54px] transition-all duration-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 backdrop-blur-md"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-white/60 font-medium block font-oswald text-xs uppercase tracking-widest pl-1">
              Sede
            </label>
            <AutocompleteSede
              value={sede}
              onSelect={(info) => {
                setSede(info.description);
                setSedeInfo(info);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-white/60 font-medium block font-oswald text-xs uppercase tracking-widest pl-1">Precio Cancha</label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-white/50 font-bold pointer-events-none font-oswald">$</span>
              <input
                className="appearance-none bg-white/5 border border-white/20 text-white font-oswald text-lg px-4 pl-8 py-3 rounded-xl w-full box-border h-[54px] transition-all duration-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 backdrop-blur-md placeholder:text-white/30"
                type="number"
                step="any"
                placeholder="Ej: 25000"
                value={precioCancha}
                onChange={(e) => setPrecioCancha(e.target.value)}
              />
            </div>
          </div>

          {/* Selector de tipo de partido */}
          <div className="space-y-3">
            <label className="text-white/60 font-medium block font-oswald text-xs uppercase tracking-widest pl-1">
              Tipo de partido
            </label>
            <div className="grid grid-cols-3 gap-3 w-full">
              {['Masculino', 'Femenino', 'Mixto'].map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setTipoPartido(tipo)}
                  className={`py-3 px-2 text-sm font-oswald font-bold rounded-xl cursor-pointer transition-all duration-300 min-h-[48px] flex items-center justify-center border-2 ${tipoPartido === tipo
                    ? 'bg-primary border-transparent text-white shadow-[0_8px_24px_rgba(129,120,229,0.4)]'
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20'
                    }`}
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          className="w-full font-bebas text-[28px] text-white bg-primary border-2 border-white/20 rounded-2xl tracking-widest min-h-[60px] mt-8 cursor-pointer font-bold transition-all duration-300 shadow-xl hover:brightness-110 hover:shadow-[0_12px_40px_rgba(129,120,229,0.5)] active:scale-[0.98] disabled:opacity-40"
          onClick={guardarCambios}
          disabled={loading}
        >
          {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
        </button>
      </div>
    </div>
  );
}