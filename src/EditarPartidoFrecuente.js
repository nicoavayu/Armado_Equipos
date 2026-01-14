import React, { useState, useRef, useEffect } from 'react';
import { updatePartidoFrecuente, supabase } from './supabase';
import { toast } from 'react-toastify';
import AutocompleteSede from './AutocompleteSede';
import PageTitle from './components/PageTitle';
import './EditarPartidoFrecuente.css';
import { parseLocalDateTime, weekdayFromYMD } from './utils/dateLocal';

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
      try { focusTarget && focusTarget.focus(); } catch (_) {}

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

    const overlayStyle = /** @type {any} */ ({
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      transition: prefersReduced ? 'none' : 'opacity 200ms ease',
      opacity: visible ? 1 : 0,
    });

    const cardStyle = /** @type {any} */ ({
      width: '100%',
      maxWidth: 520,
      background: '#0f1724',
      borderRadius: 12,
      padding: 20,
      boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
      border: '1px solid rgba(255,255,255,0.06)',
      color: '#fff',
      boxSizing: 'border-box',
      transform: visible ? 'scale(1)' : 'scale(0.98)',
      transition: prefersReduced ? 'none' : 'transform 180ms cubic-bezier(.2,.9,.3,1), opacity 180ms ease',
      opacity: visible ? 1 : 0,
    });

    const titleStyle = { fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: 'Oswald, Arial, sans-serif', color: '#fff' };
    const messageStyle = { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginBottom: 16 };
    const actionsStyle = { display: 'flex', gap: 8, justifyContent: 'flex-end' };

    const btnBase = { padding: '10px 14px', borderRadius: 8, fontWeight: 700, cursor: isDeleting ? 'default' : 'pointer', border: 'none', fontFamily: 'Oswald, Arial, sans-serif' };
    const cancelBtn = { ...btnBase, background: 'rgba(255,255,255,0.06)', color: '#fff' };
    const confirmBtn = { ...btnBase, background: 'linear-gradient(45deg,#f4d03f,#f7dc6f)', color: '#000' };

    const handleOverlayClick = () => {
      if (isDeleting) return;
      onCancel && onCancel();
    };

    return (
      <div
        ref={overlayRef}
        style={overlayStyle}
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'confirm-modal-title' : undefined}
        aria-describedby={message ? 'confirm-modal-message' : undefined}
      >
        <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
          {title && <div id="confirm-modal-title" style={titleStyle}>{title}</div>}
          <div id="confirm-modal-message" style={messageStyle}>{message}</div>
          <div style={actionsStyle}>
            <button
              ref={cancelRef}
              style={cancelBtn}
              onClick={() => { if (isDeleting) return; onCancel && onCancel(); }}
              disabled={isDeleting}
              aria-disabled={isDeleting}
            >
              {cancelText}
            </button>
            <button
              ref={confirmRef}
              style={confirmBtn}
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
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ 
        padding: '100px 0 42px 0', 
        maxWidth: '100vw',
        minHeight: 'calc(100vh - 60px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <PageTitle title="EDITAR" onBack={onVolver}>EDITAR</PageTitle>
        
        <div className="edit-form-container" style={{ width: '90vw', maxWidth: '400px' }}>
          <div className="photo-section">
            <div
              className="photo-upload"
              onClick={() => document.getElementById('edit-partido-foto-input').click()}
              title={fotoPreview ? 'Cambiar foto' : 'Agregar foto'}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="foto partido" />
              ) : (
                <span className="photo-placeholder">+</span>
              )}
              <input
                id="edit-partido-foto-input"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
            </div>
            <div className="photo-label">
              Foto del partido (opcional)
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">
              Nombre del partido
            </label>
            <input
              className="input-modern"
              type="text"
              placeholder="Nombre del partido"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Fecha
            </label>
            <input
              className="input-modern"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              title="Seleccionar fecha"
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Hora
            </label>
            <input
              className="input-modern"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              title="Seleccionar hora"
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Sede
            </label>
            <div style={{ width: '100%' }}>
              <AutocompleteSede
                value={sede}
                onSelect={(info) => {
                  setSede(info.description);
                  setSedeInfo(info);
                }}
              />
            </div>
          </div>

          {/* PRECIO CANCHA */}
          <div className="form-field">
            <label className="form-label">PRECIO CANCHA</label>
            <div className="precio-field">
              <span className="precio-symbol">$</span>
              <input
                className="input-modern precio-input"
                type="number"
                step="any"
                placeholder="Ej: 25000"
                value={precioCancha}
                onChange={(e) => setPrecioCancha(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Selector de tipo de partido */}
          <div className="form-field">
            <label className="form-label">
              Tipo de partido
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              width: '100%',
            }}>
              {['Masculino', 'Femenino', 'Mixto'].map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setTipoPartido(tipo)}
                  style={{
                    padding: '10px 8px',
                    fontSize: '14px',
                    fontWeight: tipoPartido === tipo ? '700' : '500',
                    fontFamily: "'Oswald', Arial, sans-serif",
                    border: tipoPartido === tipo ? '2px solid #0865b2' : '1.5px solid #0865b2',
                    borderRadius: '6px',
                    background: tipoPartido === tipo ? '#0865b2' : 'rgba(255,255,255,0.9)',
                    color: tipoPartido === tipo ? '#fff' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button 
          className="voting-confirm-btn save-button"
          onClick={guardarCambios}
          disabled={loading}
        >
          {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
        </button>
      </div>
    </div>
  );
}