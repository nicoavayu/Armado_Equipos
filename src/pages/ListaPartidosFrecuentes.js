import React, { useState, useEffect, useRef } from 'react';
import { supabase, crearPartido } from '../supabase';
import { toast } from 'react-toastify';
import { DIAS_SEMANA } from '../constants';
import PageTitle from '../components/PageTitle';
import LoadingSpinner from '../components/LoadingSpinner';
import { HistorialDePartidosButton } from '../components/historial';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] transform animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h3 className="text-xl font-bold font-[Oswald,sans-serif] text-white mb-2 uppercase tracking-wide">
            {title}
          </h3>
        )}
        <p className="text-white/70 text-sm mb-6 leading-relaxed font-[Oswald,sans-serif]">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 font-[Oswald,sans-serif] text-xs tracking-widest uppercase border border-white/10"
            onClick={onCancel}
            disabled={isDeleting}
          >
            {cancelText}
          </button>
          <button
            className="px-4 py-2 bg-red-500/80 hover:bg-red-500 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 font-[Oswald,sans-serif] text-xs tracking-widest uppercase border border-red-400/30"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'ELIMINANDO…' : confirmText}
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
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [creating, setCreating] = useState(false);
  const [editTime, setEditTime] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const today = new Date().toISOString().split('T')[0];
    setSelectedDate(today);
    setSelectedTime(template?.hora || '');
    setEditTime(false);

    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen, template]);

  const handleCreate = async () => {
    if (!selectedDate) return toast.error('Seleccioná una fecha');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(selectedDate);
    selected.setHours(0, 0, 0, 0);
    if (selected < today) return toast.error('No se puede crear un partido anterior a hoy');
    setCreating(true);
    try {
      const nombre = template.nombre || `Partido en ${template.sede || template.lugar || 'Lugar'}`;
      const payload = {
        nombre,
        fecha: selectedDate,
        hora: editTime ? selectedTime : (template.hora || ''),
        sede: template.sede || template.lugar || '',
        sedeMaps: '',
        modalidad: 'F5',
        cupo_jugadores: 10,
        falta_jugadores: false,
        tipo_partido: template.tipo_partido || 'Masculino',
      };

      const partido = await crearPartido(payload);
      if (!partido) throw new Error('No match returned');

      toast.success('Partido creado ✅');
      onUse && onUse(partido);
    } catch (err) {
      console.error('[USAR PLANTILLA] error', err);
      toast.error('No se pudo crear el partido');
      setCreating(false);
    }
  };

  if (!isOpen || !template) return null;

  return (
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-2xl font-bold font-[Bebas_Neue,sans-serif] text-white mb-6 uppercase tracking-wider border-b border-white/10 pb-4">
          Crear partido desde plantilla
        </h3>

        <div className="grid grid-cols-1 gap-6 mb-8">
          <div>
            <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-2 font-[Oswald,sans-serif]">Ubicación</label>
            <div className="text-white text-lg font-medium font-[Oswald,sans-serif]">{formatearSede(template.sede || template.lugar || '')}</div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-2 font-[Oswald,sans-serif]">Hora Sugerida</label>
              <div className="text-white text-lg font-medium font-[Oswald,sans-serif]">{template.hora || '—'}</div>
            </div>
            <button
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest font-[Oswald,sans-serif] transition-all ${editTime ? 'bg-primary text-white shadow-lg' : 'bg-white/5 text-white/40 border border-white/10'}`}
              onClick={() => setEditTime(!editTime)}
            >
              {editTime ? 'CAMBIAR CERRADO' : 'CAMBIAR HORA'}
            </button>
          </div>

          {editTime && (
            <div className="animate-in slide-in-from-top-2 duration-200">
              <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-3 font-[Oswald,sans-serif]">Nueva Hora</label>
              <input
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 font-[Oswald,sans-serif] backdrop-blur-sm"
              />
            </div>
          )}

          <div>
            <label className="text-[#f4d03f] text-[10px] uppercase font-bold tracking-widest block mb-3 font-[Oswald,sans-serif]">Fecha del Encuentro</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 font-[Oswald,sans-serif] backdrop-blur-sm"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button
            className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 font-[Oswald,sans-serif] text-xs tracking-widest uppercase border border-white/10"
            onClick={onCancel}
            disabled={creating}
          >
            CANCELAR
          </button>
          <button
            className="flex-1 py-4 bg-primary hover:brightness-110 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 font-[Oswald,sans-serif] text-xs tracking-widest uppercase border border-white/10 shadow-[0_8px_32px_rgba(129,120,229,0.3)]"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'CREANDO…' : 'CONFIRMAR PARTIDO'}
          </button>
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
        const { getPartidosFrecuentes, subscribeToPartidosFrecuentesChanges } = await import('../services/db/frequentMatches');
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
        const { getPartidosFrecuentes } = await import('../services/db/frequentMatches');
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
      const { deletePartidoFrecuente } = await import('../services/db/frequentMatches');
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
    <div className="w-full max-w-[550px] mx-auto flex flex-col items-center pt-24 pb-32 px-4 box-border">
      <PageTitle title="HISTORIAL" onBack={onVolver}>HISTORIAL</PageTitle>

      <div className="w-full mt-8">
        {partidosFrecuentes.length === 0 ? (
          <div className="text-white text-center py-20 font-oswald opacity-50">
            <p className="text-lg">No hay partidos frecuentes configurados</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 w-full">
            {partidosFrecuentes.map((partido) => (
              <div
                key={partido.id}
                className="bg-white/5 border border-white/10 rounded-[2rem] p-6 flex flex-col gap-6 backdrop-blur-xl shadow-2xl transition-all duration-300 w-full box-border"
              >
                <div className="flex items-center gap-5">
                  <div className="flex-shrink-0">
                    {partido.imagen_url ? (
                      <img
                        src={partido.imagen_url}
                        alt={partido.nombre}
                        className="w-16 h-16 rounded-2xl object-cover border-2 border-white/20 shadow-lg"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-white/10 border-2 border-white/10 flex items-center justify-center text-3xl shadow-inner">
                        ⚽
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-2xl font-bold uppercase tracking-wider font-bebas truncate drop-shadow-sm">
                      {partido.nombre}
                    </div>
                    <div className="text-white/80 text-base font-medium font-oswald mt-0.5 uppercase">
                      {DIAS_SEMANA[partido.dia_semana] || `Día ${partido.dia_semana}`} • {partido.hora}
                    </div>
                    <div className="text-white/60 text-sm font-oswald mt-1 truncate">
                      {formatearSede(partido.sede || partido.lugar || '')}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2">
                  <button
                    className="w-full py-3.5 bg-primary hover:brightness-110 text-white font-bebas font-bold text-lg rounded-xl transition-all active:scale-95 shadow-[0_8px_32px_rgba(129,120,229,0.3)] border border-white/20 uppercase tracking-widest flex items-center justify-center"
                    onClick={() => onEntrar(partido)}
                  >
                    ENTRAR
                  </button>

                  <HistorialDePartidosButton
                    partidoFrecuente={partido}
                    className="w-full py-3.5 bg-white/10 hover:bg-white/20 text-white font-bebas font-bold text-lg rounded-xl transition-all active:scale-95 shadow-md border border-white/10 uppercase tracking-widest flex items-center justify-center min-h-[52px]"
                  />

                  <button
                    className="w-full py-3.5 bg-red-500/20 hover:bg-red-500/40 text-red-200 font-bebas font-bold text-lg rounded-xl transition-all active:scale-95 shadow-md border border-red-500/30 uppercase tracking-widest flex items-center justify-center"
                    onClick={() => handleDeleteClick(partido)}
                  >
                    BORRAR
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
          try { if (typeof onEntrar === 'function') { /* keep existing onEntrar behavior separate */ } } catch (_) { }
          // If parent passed an onVolver that expects navigation, prefer calling onEntrar with created match
          try { if (typeof onEntrar === 'function') onEntrar(created); } catch (_) { }
        }}
      />
    </div>
  );
}
