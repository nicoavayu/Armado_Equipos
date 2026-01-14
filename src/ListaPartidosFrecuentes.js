import React, { useState, useEffect, useRef } from 'react';
import { supabase, crearPartido } from './supabase';
import { toast } from 'react-toastify';
import { DIAS_SEMANA } from './constants';
import PageTitle from './components/PageTitle';
import LoadingSpinner from './components/LoadingSpinner';
import { HistorialDePartidosButton } from './components/historial';

function formatearSede(sede) {
  if (sede === 'La Terraza Fútbol 5, 8') return 'La Terraza Fútbol 5 y 8';
  return sede;
}

/* Inline enhanced ConfirmModal
   - focus management and trap
   - escape to close (unless isDeleting)
   - disable buttons while deleting
   - animation with respect to prefers-reduced-motion
*/
function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = 'ELIMINAR', cancelText = 'CANCELAR', isDeleting = false }) {
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

  const overlayStyle = {
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
  };

  const cardStyle = {
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
  };

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
            {isDeleting ? (confirmText || 'ELIMINANDO…') : (confirmText || 'ELIMINAR')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* UseTemplateModal
   Modal to create a match from a frequent match template.
   - Shows template read-only fields (lugar, hora, precio)
   - Requires date input
   - Optional editable time input
   - Calls crearPartido and emits onUse(createdMatch)
*/
function UseTemplateModal({ isOpen, template, onCancel, onUse }) {
  const overlayRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [creating, setCreating] = useState(false);
  const [editTime, setEditTime] = useState(false); // controls whether the time input is shown

  useEffect(() => {
    if (!isOpen) return;
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    // default date to today
    const today = new Date().toISOString().split('T')[0];
    setSelectedDate(today);
    setSelectedTime(template?.hora || '');
    setEditTime(false); // default: do NOT show editable time input
    // lock body scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen, template]);

  useEffect(() => {
    if (!isOpen) return;
    const focusTarget = cancelRef.current || confirmRef.current;
    try { focusTarget && focusTarget.focus(); } catch (_) {}

    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        if (creating) return;
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
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    document.addEventListener('keydown', keyHandler, true);
    return () => document.removeEventListener('keydown', keyHandler, true);
  }, [isOpen, creating, onCancel]);

  if (!isOpen || !template) return null;

  const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, transition: prefersReduced ? 'none' : 'opacity 200ms ease', opacity: visible ? 1 : 0 };
  const cardStyle = { width: '100%', maxWidth: 520, background: '#0f1724', borderRadius: 12, padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.06)', color: '#fff', boxSizing: 'border-box', transform: visible ? 'scale(1)' : 'scale(0.98)', transition: prefersReduced ? 'none' : 'transform 180ms cubic-bezier(.2,.9,.3,1), opacity 180ms ease', opacity: visible ? 1 : 0 };

  const labelStyle = { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 6, fontFamily: 'Oswald, Arial, sans-serif' };
  const valueStyle = { fontSize: 15, color: '#fff', marginBottom: 12 };

  const handleCreate = async () => {
    if (!selectedDate) return toast.error('Seleccioná una fecha');
    setCreating(true);
    try {
      const nombre = template.nombre || `Partido en ${template.sede || template.lugar || 'Lugar'}`;
      const fecha = selectedDate;
      // respect editTime: if user enabled editTime use selectedTime, otherwise use template.hora
      const hora = editTime ? selectedTime : (template.hora || '');
      const sede = template.sede || template.lugar || '';
      const precio = (template.precio !== undefined && template.precio !== null && String(template.precio).trim() !== '') ? Number(String(template.precio).replace(/[^0-9.,-]/g, '').replace(/,/g, '.')) : (template.precio_cancha !== undefined && template.precio_cancha !== null && String(template.precio_cancha).trim() !== '' ? Number(String(template.precio_cancha).replace(/[^0-9.,-]/g, '').replace(/,/g, '.')) : (template.valor_cancha !== undefined && template.valor_cancha !== null && String(template.valor_cancha).trim() !== '' ? Number(String(template.valor_cancha).replace(/[^0-9.,-]/g, '').replace(/,/g, '.')) : undefined));

      const payload = {
        nombre,
        fecha,
        hora,
        sede,
        sedeMaps: '',
        modalidad: 'F5',
        cupo_jugadores: 10,
        falta_jugadores: false,
        tipo_partido: template.tipo_partido || 'Masculino',
        ...(precio !== undefined ? { precio_cancha_por_persona: precio } : {}),
      };

      console.log('CREAR PARTIDO payload', payload);

      const partido = await crearPartido(payload);

      if (!partido) {
        toast.error('No se pudo crear el partido');
        setCreating(false);
        return;
      }

      toast.success('Partido creado ✅');
      onUse && onUse(partido);
    } catch (err) {
      console.error('[USAR PLANTILLA] error creating match', err);
      toast.error('No se pudo crear el partido');
      setCreating(false);
    }
  };

  return (
    <div ref={overlayRef} style={overlayStyle} onClick={() => { if (creating) return; onCancel && onCancel(); }} role="dialog" aria-modal="true">
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: 'Oswald, Arial, sans-serif' }}>Crear partido desde plantilla</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', marginBottom: 12 }}>Plantilla (solo lectura)</div>
        <div>
          <div style={labelStyle}>Lugar</div>
          <div style={valueStyle}>{formatearSede(template.sede || template.lugar || '')}</div>

          <div style={labelStyle}>Hora</div>
          {/* Use inline style without marginBottom to avoid shifting the switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 15, color: '#fff', marginBottom: 0 }}>{template.hora || '—'}</div>
            <label className="pf-switch" style={{ marginLeft: 'auto' }}>
              <input
                type="checkbox"
                className="pf-switch-input"
                checked={editTime}
                onChange={(e) => setEditTime(e.target.checked)}
                disabled={creating}
                aria-label="Cambiar hora"
              />
              <span className="pf-switch-slider" />
              <span className="pf-switch-label">Cambiar hora</span>
            </label>
          </div>

          <div style={labelStyle}>Precio</div>
          <div style={valueStyle}>{(template.precio !== undefined && template.precio !== null && String(template.precio).trim() !== '') || (template.precio_cancha !== undefined && template.precio_cancha !== null && String(template.precio_cancha).trim() !== '') || (template.valor_cancha !== undefined && template.valor_cancha !== null && String(template.valor_cancha).trim() !== '') ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(String(template.precio ?? template.precio_cancha ?? template.valor_cancha).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'))) : 'Sin precio'}</div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Fecha (obligatoria)</label>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 8 }} />

          {/* Show editable time input only when editTime is true */}
          {editTime && (
            <>
              <label style={labelStyle}>Hora (opcional)</label>
              <input type="time" value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }} />
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button ref={cancelRef} style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 700, fontFamily: 'Oswald, Arial, sans-serif' }} onClick={() => { if (creating) return; onCancel && onCancel(); }}>CANCELAR</button>
          <button ref={confirmRef} style={{ padding: '10px 14px', borderRadius: 8, background: 'linear-gradient(45deg,#f4d03f,#f7dc6f)', color: '#000', fontWeight: 700, fontFamily: 'Oswald, Arial, sans-serif' }} onClick={handleCreate} disabled={creating}>{creating ? 'CREANDO…' : 'CREAR PARTIDO'}</button>
        </div>
      </div>
    </div>
  );
}

export default function ListaPartidosFrecuentes({ onEditar, onEntrar, onVolver }) {
  const [partidosFrecuentes, setPartidosFrecuentes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [partidoToDelete, setPartidoToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modal state for using a template
  const [showUseModal, setShowUseModal] = useState(false);
  const [templateToUse, setTemplateToUse] = useState(null);
  const [isCreatingFromTemplate, setIsCreatingFromTemplate] = useState(false);

  useEffect(() => {
    let channel = null;

    const cargarPartidosFrecuentes = async () => {
      try {
        console.log('[ListaPartidosFrecuentes] Loading frequent templates from partidos_frecuentes');
        setLoading(true);
        const { getPartidosFrecuentes, subscribeToPartidosFrecuentesChanges } = await import('./services/db/frequentMatches');
        const partidos = await getPartidosFrecuentes();
        console.log('[ListaPartidosFrecuentes] Frequent templates loaded:', partidos.length);
        setPartidosFrecuentes(partidos || []);

        channel = subscribeToPartidosFrecuentesChanges(async (payload) => {
          console.log('[ListaPartidosFrecuentes] Realtime change detected on partidos_frecuentes, refreshing list', payload.event);
          try {
            const refreshed = await getPartidosFrecuentes();
            setPartidosFrecuentes(refreshed || []);
          } catch (err) {
            console.error('[ListaPartidosFrecuentes] Error refreshing after realtime event:', err);
          }
        });

      } catch (error) {
        toast.error('Error al cargar plantillas frecuentes: ' + (error?.message || error));
      } finally {
        setLoading(false);
      }
    };

    cargarPartidosFrecuentes();

    // Refresh list when a new template is created elsewhere (EditarPartidoFrecuente dispatches this)
    const handleTemplateCreated = async (e) => {
      console.log('[ListaPartidosFrecuentes] Received partido-frecuente-creado event', e?.detail);
      try {
        const { getPartidosFrecuentes } = await import('./services/db/frequentMatches');
        const partidos = await getPartidosFrecuentes();
        setPartidosFrecuentes(partidos || []);
      } catch (err) {
        console.error('[ListaPartidosFrecuentes] Error refreshing after template creation event:', err);
      }
    };
    window.addEventListener('partido-frecuente-creado', handleTemplateCreated);

    return () => {
      try {
        if (channel && channel.unsubscribe) {
          channel.unsubscribe();
          console.log('[ListaPartidosFrecuentes] Unsubscribed from realtime channel');
        }
        window.removeEventListener('partido-frecuente-creado', handleTemplateCreated);
      } catch (err) {
        console.warn('Error cleaning up realtime subscription', err);
      }
    };
  }, []);

  const handleDeleteClick = (partido) => {
    setPartidoToDelete(partido);
    setShowConfirmModal(true);
    console.log('[ELIMINAR HISTORIAL] click', { id: partido?.id, item: partido });
  };

  const confirmarEliminacion = async () => {
    if (!partidoToDelete) return;
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      console.log('[ELIMINAR HISTORIAL] requesting delete', { id: partidoToDelete?.id });
      const { deletePartidoFrecuente } = await import('./services/db/frequentMatches');
      await deletePartidoFrecuente(partidoToDelete.id);

      setPartidosFrecuentes((prev) => prev.filter((p) => p.id !== partidoToDelete.id));
      toast.success('Plantilla eliminada correctamente');
    } catch (err) {
      console.error('[ELIMINAR HISTORIAL] unexpected error', err);
      toast.error('Error al eliminar la plantilla: ' + (err?.message || String(err)));
    } finally {
      setIsDeleting(false);
      setShowConfirmModal(false);
      setPartidoToDelete(null);
    }
  };

  const cancelarEliminacion = () => {
    if (isDeleting) return;
    setShowConfirmModal(false);
    setPartidoToDelete(null);
  };

  if (loading) {
    return (
      <div
        className="voting-bg content-with-tabbar"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <div className="voting-bg content-with-tabbar" style={{ paddingBottom: '100px' }}>
      <div
        style={{
          padding: '100px 0 0 0',
          maxWidth: '100vw',
          minHeight: 'calc(100vh - 60px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <PageTitle onBack={onVolver}>HISTORIAL</PageTitle>
        <div style={{ width: '90vw', marginTop: '70px' }}>
          {partidosFrecuentes.length === 0 ? (
            <div style={{ color: '#fff', textAlign: 'center', padding: '20px 0', fontFamily: 'Oswald, Arial, sans-serif' }}>
              <p>No hay partidos frecuentes configurados</p>
            </div>
          ) : (
            <div style={{ width: '100%' }}>
              {partidosFrecuentes.map((partido, index) => (
                <div
                  key={partido.id}
                  style={{
                    background: 'rgb(4 48 106 / 22%)',
                    border: '2px solid rgba(255,255,255,0.2)',
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: index === partidosFrecuentes.length - 1 ? '40px' : '10px',
                    boxSizing: 'border-box',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                    {partido.imagen_url ? (
                      <img
                        src={partido.imagen_url}
                        alt={partido.nombre}
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '8px',
                          objectFit: 'cover',
                          border: '2px solid rgba(255,255,255,0.3)',
                        }}
                        onError={(e) => { try { e.target.style.display = 'none'; } catch (_) {} }}
                      />
                    ) : (
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.1)',
                        border: '2px solid rgba(255,255,255,0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                      }}>
                        ⚽
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold', marginBottom: '4px', fontFamily: 'Bebas Neue, Arial, sans-serif' }}>
                        {partido.nombre}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '15px', marginBottom: '2px', fontFamily: 'Oswald, Arial, sans-serif' }}>
                        {DIAS_SEMANA[partido.dia_semana]?.toUpperCase() || `Día ${partido.dia_semana}`} • {partido.hora}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', fontFamily: 'Oswald, Arial, sans-serif', wordBreak: 'break-word' }}>
                        {formatearSede(partido.sede)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="frequent-action-btn edit-btn" onClick={() => onEntrar(partido)}>ENTRAR</button>
                    <button className="frequent-action-btn edit-btn" onClick={() => onEditar(partido)}>EDITAR</button>
                    <button className="frequent-action-btn use-btn pf-use-btn" onClick={() => { setTemplateToUse(partido); setShowUseModal(true); }}>USAR</button>
                    <HistorialDePartidosButton partidoFrecuente={partido} />
                    <button className="frequent-action-btn delete-btn" onClick={() => handleDeleteClick(partido)}>ELIMINAR</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirmModal}
        title="CONFIRMAR ELIMINACIÓN"
        message={partidoToDelete ? `¿Eliminar el partido «${partidoToDelete.nombre}»? Esta acción no se puede deshacer.` : '¿Eliminar este partido? Esta acción no se puede deshacer.'}
        onConfirm={confirmarEliminacion}
        onCancel={cancelarEliminacion}
        confirmText={isDeleting ? 'ELIMINANDO…' : 'ELIMINAR'}
        cancelText="CANCELAR"
        isDeleting={isDeleting}
      />

      <UseTemplateModal
        isOpen={showUseModal}
        template={templateToUse}
        onCancel={() => { if (isCreatingFromTemplate) return; setShowUseModal(false); setTemplateToUse(null); }}
        onUse={(created) => {
          // close modal and notify parent that a match was created
          setShowUseModal(false);
          setTemplateToUse(null);
          try { if (typeof onEntrar === 'function') { /* keep existing onEntrar behavior separate */ } } catch (_) {}
          // If parent passed an onVolver that expects navigation, prefer calling onEntrar with created match
          try { if (typeof onEntrar === 'function') onEntrar(created); } catch (_) {}
        }}
      />
    </div>
  );
}
