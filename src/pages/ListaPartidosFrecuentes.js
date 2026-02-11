import React, { useState, useEffect } from 'react';
import { crearPartido, supabase } from '../supabase';
import { toast } from 'react-toastify';
import PageTitle from '../components/PageTitle';
import LoadingSpinner from '../components/LoadingSpinner';
import HistoryTemplateCard from '../components/historial/HistoryTemplateCard';
import TemplateStatsModal from '../components/historial/TemplateStatsModal';
import { normalizeTimeHHmm, isBlockedInDebug, getDebugInfo } from '../lib/matchDateDebug';
import { v4 as uuidv4 } from 'uuid';

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
  const [cupo, setCupo] = useState(10);
  const [sede, setSede] = useState('');
  const [players, setPlayers] = useState([]);
  const [newPlayerName, setNewPlayerName] = useState('');

  const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

  useEffect(() => {
    if (!isOpen) return;
    const today = new Date().toISOString().split('T')[0];
    setSelectedDate(today);
    setSelectedTime(template?.hora || '');
    setEditTime(false);
    setCupo(Number(template?.cupo_jugadores || template?.cupo || 10) || 10);
    setSede(template?.sede || template?.lugar || '');
    setPlayers(Array.isArray(template?.jugadores_frecuentes) ? template.jugadores_frecuentes.filter((p) => p && p.nombre) : []);
    setNewPlayerName('');

    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen, template]);

  const handleCreate = async () => {
    if (!selectedDate) return toast.error('Seleccioná una fecha');
    const timeToUse = editTime ? selectedTime : (template.hora || '');
    
    // Validate time format
    if (!normalizeTimeHHmm(timeToUse)) {
      return toast.error('Se requiere una hora válida');
    }
    
    // DEBUG: Log validation info
    const debugInfo = getDebugInfo(selectedDate, timeToUse);
    console.log('[DEBUG] Template match validation:', debugInfo);
    
    if (isBlockedInDebug(selectedDate, timeToUse)) {
      return toast.error('No podés crear un partido en el pasado.');
    }
    setCreating(true);
    try {
      const nombre = template.nombre || `Partido en ${template.sede || template.lugar || 'Lugar'}`;
      const match_ref = uuidv4();
      const payload = {
        match_ref,
        nombre,
        fecha: selectedDate,
        hora: editTime ? selectedTime : (template.hora || ''),
        sede: sede || '',
        sedeMaps: '',
        modalidad: template.modalidad || 'F5',
        cupo_jugadores: Number(cupo) || 10,
        falta_jugadores: false,
        tipo_partido: template.tipo_partido || 'Masculino',
        // New linkage (safe if column exists)
        template_id: template.id,
        // Legacy linkage kept for backward compatibility
        from_frequent_match_id: template.id,
        frequent_match_name: template.nombre,
      };

      let partido = null;
      try {
        partido = await crearPartido(payload);
      } catch (e) {
        // Backward-compatible fallback if DB doesn't have template_id yet.
        if (/template_id/i.test(e?.message || '')) {
          const legacyPayload = { ...payload };
          delete legacyPayload.template_id;
          partido = await crearPartido(legacyPayload);
        } else {
          throw e;
        }
      }
      if (!partido) throw new Error('No match returned');

      // Optional: prefill roster from template suggestions (best-effort)
      try {
        const partidoId = Number(partido.id);
        if (Number.isFinite(partidoId) && Array.isArray(players) && players.length > 0) {
          const rows = players
            .map((p) => {
              const usuario_id = isUuid(p?.usuario_id) ? p.usuario_id : null;
              // Do NOT force uuid unless valid; let DB generate it (avoids runtime issues).
              return {
                partido_id: partidoId,
                nombre: String(p?.nombre || '').trim(),
                score: typeof p?.score === 'number' ? p.score : 5,
                is_goalkeeper: Boolean(p?.is_goalkeeper),
                ...(usuario_id ? { usuario_id } : {}),
              };
            })
            .filter((r) => r.nombre);

          if (rows.length > 0) {
            await supabase.from('jugadores').insert(rows);
          }
        }
      } catch (e) {
        console.warn('[USAR PLANTILLA] roster prefill failed (non-blocking)', e);
      }

      toast.success('Partido creado');
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
            <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-2 font-[Oswald,sans-serif]">Nombre</label>
            <div className="text-white text-lg font-medium font-[Oswald,sans-serif] truncate">{template.nombre || 'Partido frecuente'}</div>
          </div>

          <div>
            <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-2 font-[Oswald,sans-serif]">Ubicación</label>
            <input
              value={sede}
              onChange={(e) => setSede(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 font-[Oswald,sans-serif] backdrop-blur-sm"
              placeholder="Sede"
            />
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

          <div>
            <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-2 font-[Oswald,sans-serif]">Precio (por persona)</label>
            <div className="text-white text-lg font-medium font-[Oswald,sans-serif]">{template.precio_cancha ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(template.precio_cancha) : 'Sin precio'}</div>
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

          <div>
            <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-3 font-[Oswald,sans-serif]">Cupo</label>
            <input
              type="number"
              min={2}
              max={30}
              value={cupo}
              onChange={(e) => setCupo(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 font-[Oswald,sans-serif] backdrop-blur-sm"
            />
          </div>

          <div className="border-t border-white/10 pt-4">
            <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-3 font-[Oswald,sans-serif]">Jugadores sugeridos (editable)</label>
            {players.length === 0 ? (
              <div className="text-white/50 text-sm font-[Oswald,sans-serif]">Sin sugerencias cargadas en la plantilla.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {players.map((p, idx) => (
                  <button
                    key={`${p?.nombre || 'p'}:${idx}`}
                    type="button"
                    className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/80 text-xs font-[Oswald,sans-serif] hover:bg-white/10 active:scale-95"
                    onClick={() => setPlayers((prev) => prev.filter((_, i) => i !== idx))}
                    title="Quitar"
                  >
                    {String(p?.nombre || '').trim()}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <input
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                className="flex-1 bg-white/10 border border-white/20 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 font-[Oswald,sans-serif] backdrop-blur-sm"
                placeholder="Agregar jugador"
              />
              <button
                type="button"
                className="px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold transition-all active:scale-95 disabled:opacity-50 font-[Oswald,sans-serif] text-xs tracking-widest uppercase border border-white/10"
                onClick={() => {
                  const n = String(newPlayerName || '').trim();
                  if (!n) return;
                  setPlayers((prev) => [...prev, { nombre: n }]);
                  setNewPlayerName('');
                }}
              >
                AGREGAR
              </button>
            </div>
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
  const [isCreatingFromTemplate, _setIsCreatingFromTemplate] = useState(false);

  // Modal state for template stats
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [templateForStats, setTemplateForStats] = useState(null);

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

  const deleteTemplate = async (templateId) => {
    if (!templateId) {
      console.warn('[ELIMINAR HISTORIAL] templateId ausente');
      return;
    }
    try {
      const { deletePartidoFrecuente } = await import('../services/db/frequentMatches');
      await deletePartidoFrecuente(templateId);
    } catch (err) {
      console.warn('[ELIMINAR HISTORIAL] deleteTemplate fallback/TODO', err);
      throw err;
    }
  };

  const handleViewDetails = (partido) => {
    if (!partido?.id) return;
    setTemplateToUse(partido);
    setShowUseModal(true);
  };

  const handleHistoryView = (partido) => {
    if (!partido?.id) return;
    setTemplateForStats(partido);
    setShowStatsModal(true);
  };

  const handleEditTemplate = (partido) => {
    if (typeof onEditar === 'function') return onEditar(partido);
    console.log('[HISTORIAL] Editar plantilla', partido?.id);
  };

  const confirmarEliminacion = async () => {
    if (!partidoToDelete) return;
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      console.log('[ELIMINAR HISTORIAL] requesting delete', { id: partidoToDelete?.id });
      await deleteTemplate(partidoToDelete.id);

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
          <div className="flex flex-col gap-3 w-full">
            {partidosFrecuentes.map((partido) => (
              <HistoryTemplateCard
                key={partido.id}
                template={partido}
                onViewDetails={handleViewDetails}
                onHistory={handleHistoryView}
                onDelete={handleDeleteClick}
                onEdit={handleEditTemplate}
              />
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
          try {
            if (typeof onEntrar === 'function') {
              /* keep existing onEntrar behavior separate */
            }
          } catch (_e) {
            // Intentionally ignored.
          }
          // If parent passed an onVolver that expects navigation, prefer calling onEntrar with created match
          try {
            if (typeof onEntrar === 'function') onEntrar(created);
          } catch (_e) {
            // Intentionally ignored.
          }
        }}
      />

      <TemplateStatsModal
        isOpen={showStatsModal}
        template={templateForStats}
        onClose={() => { setShowStatsModal(false); setTemplateForStats(null); }}
      />
    </div>
  );
}
