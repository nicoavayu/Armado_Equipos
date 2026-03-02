import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { crearPartido, supabase } from '../supabase';
import PageTitle from '../components/PageTitle';
import PageLoadingState from '../components/PageLoadingState';
import HistoryTemplateCard from '../components/historial/HistoryTemplateCard';
import ConfirmModal from '../components/ConfirmModal';
import EmptyStateCard from '../components/EmptyStateCard';
import InlineNotice from '../components/ui/InlineNotice';
import { normalizeTimeHHmm, isBlockedInDebug, getDebugInfo } from '../lib/matchDateDebug';
import { CalendarDays } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import useInlineNotice from '../hooks/useInlineNotice';
import { notifyBlockingError } from 'utils/notifyBlockingError';

function formatearSede(sede) {
  if (sede === 'La Terraza Fútbol 5, 8') return 'La Terraza Fútbol 5 y 8';
  return sede;
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
  const { notice, showInlineNotice, clearInlineNotice } = useInlineNotice();

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
    if (!selectedDate) {
      showInlineNotice({
        key: 'use_template_missing_date',
        type: 'warning',
        message: 'Seleccioná una fecha.',
      });
      return;
    }
    const timeToUse = editTime ? selectedTime : (template.hora || '');
    
    // Validate time format
    if (!normalizeTimeHHmm(timeToUse)) {
      showInlineNotice({
        key: 'use_template_invalid_time',
        type: 'warning',
        message: 'Se requiere una hora válida.',
      });
      return;
    }
    
    // DEBUG: Log validation info
    const debugInfo = getDebugInfo(selectedDate, timeToUse);
    console.log('[DEBUG] Template match validation:', debugInfo);
    
    if (isBlockedInDebug(selectedDate, timeToUse)) {
      showInlineNotice({
        key: 'use_template_past_date',
        type: 'warning',
        message: 'No podés crear un partido en el pasado.',
      });
      return;
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

      console.info('Partido creado');
      onUse && onUse(partido);
    } catch (err) {
      console.error('[USAR PLANTILLA] error', err);
      notifyBlockingError('No se pudo crear el partido');
      setCreating(false);
    }
  };

  if (!isOpen || !template) return null;

  return (
    <div data-modal-root="true" className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-[rgba(8,18,44,0.96)] backdrop-blur-2xl border border-[rgba(88,107,170,0.52)] rounded-none p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-2xl font-semibold font-[Oswald,sans-serif] text-white mb-6 tracking-[0.01em] border-b border-white/10 pb-4">
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
              className="w-full bg-[rgba(53,58,102,0.88)] border border-[rgba(133,149,208,0.5)] rounded-none p-3 text-white focus:outline-none focus:ring-2 focus:ring-[#6f7dff]/30 focus:border-[#7f8dff] font-[Oswald,sans-serif] backdrop-blur-sm"
              placeholder="Sede"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-white/50 text-[10px] uppercase font-bold tracking-widest block mb-2 font-[Oswald,sans-serif]">Hora Sugerida</label>
              <div className="text-white text-lg font-medium font-[Oswald,sans-serif]">{template.hora || '—'}</div>
            </div>
            <button
              className={`px-3 py-1.5 rounded-none text-[10px] font-bold uppercase tracking-widest font-[Oswald,sans-serif] transition-all border ${editTime ? 'bg-[linear-gradient(90deg,#4f8ef7_0%,#6f4dff_100%)] border-[rgba(136,120,255,0.75)] text-white shadow-[0_8px_24px_rgba(70,88,200,0.35)]' : 'bg-[rgba(20,31,70,0.82)] text-white/60 border-[rgba(98,117,184,0.58)] hover:bg-[rgba(30,45,94,0.95)] hover:text-white/90'}`}
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
                className="w-full bg-[rgba(53,58,102,0.88)] border border-[rgba(133,149,208,0.5)] rounded-none p-3 text-white focus:outline-none focus:ring-2 focus:ring-[#6f7dff]/30 focus:border-[#7f8dff] font-[Oswald,sans-serif] backdrop-blur-sm"
              />
            </div>
          )}

          <div>
            <label className="text-[#f4d03f] text-[10px] uppercase font-bold tracking-widest block mb-3 font-[Oswald,sans-serif]">Fecha del Encuentro</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full bg-[rgba(53,58,102,0.88)] border border-[rgba(133,149,208,0.5)] rounded-none p-3 text-white focus:outline-none focus:ring-2 focus:ring-[#6f7dff]/30 focus:border-[#7f8dff] font-[Oswald,sans-serif] backdrop-blur-sm"
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
              className="w-full bg-[rgba(53,58,102,0.88)] border border-[rgba(133,149,208,0.5)] rounded-none p-3 text-white focus:outline-none focus:ring-2 focus:ring-[#6f7dff]/30 focus:border-[#7f8dff] font-[Oswald,sans-serif] backdrop-blur-sm"
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
                    className="px-3 py-2 rounded-none bg-[rgba(20,31,70,0.82)] border border-[rgba(98,117,184,0.58)] text-white/80 text-xs font-[Oswald,sans-serif] hover:bg-[rgba(30,45,94,0.95)] active:opacity-95"
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
                className="flex-1 bg-[rgba(53,58,102,0.88)] border border-[rgba(133,149,208,0.5)] rounded-none p-3 text-white focus:outline-none focus:ring-2 focus:ring-[#6f7dff]/30 focus:border-[#7f8dff] font-[Oswald,sans-serif] backdrop-blur-sm"
                placeholder="Agregar jugador"
              />
              <button
                type="button"
                className="px-4 rounded-none bg-[rgba(20,31,70,0.82)] hover:bg-[rgba(30,45,94,0.95)] text-white font-semibold transition-all active:opacity-95 disabled:opacity-50 font-[Oswald,sans-serif] text-[16px] tracking-[0.01em] border border-[rgba(98,117,184,0.58)]"
                onClick={() => {
                  const n = String(newPlayerName || '').trim();
                  if (!n) return;
                  setPlayers((prev) => [...prev, { nombre: n }]);
                  setNewPlayerName('');
                }}
              >
                Agregar
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <div className="w-full min-h-[52px]">
            <InlineNotice
              type={notice?.type}
              message={notice?.message}
              autoHideMs={notice?.type === 'warning' ? null : 3000}
              onClose={clearInlineNotice}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-1">
          <button
            className="flex-1 py-3 bg-[rgba(20,31,70,0.82)] hover:bg-[rgba(30,45,94,0.95)] text-white/90 font-semibold rounded-none transition-all active:opacity-95 disabled:opacity-50 font-[Oswald,sans-serif] text-[16px] tracking-[0.01em] border border-[rgba(98,117,184,0.58)]"
            onClick={onCancel}
            disabled={creating}
          >
            Cancelar
          </button>
          <button
            className="flex-1 py-4 bg-[linear-gradient(90deg,#4f8ef7_0%,#6f4dff_100%)] hover:brightness-110 text-white font-semibold rounded-none transition-all active:opacity-95 disabled:opacity-50 font-[Oswald,sans-serif] text-[18px] tracking-[0.01em] border border-[rgba(136,120,255,0.75)] shadow-[0_8px_32px_rgba(70,88,200,0.35)]"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'Creando…' : 'Confirmar partido'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ListaPartidosFrecuentes({ onEditar, onEntrar, onVolver }) {
  const navigate = useNavigate();
  const [partidosFrecuentes, setPartidosFrecuentes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [partidoToDelete, setPartidoToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modal state for using a template
  const [showUseModal, setShowUseModal] = useState(false);
  const [templateToUse, setTemplateToUse] = useState(null);
  const [isCreatingFromTemplate, _setIsCreatingFromTemplate] = useState(false);

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
        notifyBlockingError('Error al cargar plantillas frecuentes: ' + (error?.message || error));
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
    if (typeof onEntrar === 'function') {
      onEntrar(partido);
      return;
    }
    // Backward fallback only if parent didn't pass onEntrar.
    setTemplateToUse(partido);
    setShowUseModal(true);
  };

  const handleHistoryView = (partido) => {
    if (!partido?.id) return;
    navigate(`/frecuentes/${partido.id}/historial`, { state: { template: partido } });
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
      console.info('Plantilla eliminada correctamente');
    } catch (err) {
      console.error('[ELIMINAR HISTORIAL] unexpected error', err);
      notifyBlockingError('Error al eliminar la plantilla: ' + (err?.message || String(err)));
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
        <PageLoadingState
          title="CARGANDO FRECUENTES"
          description="Estamos preparando tus plantillas guardadas."
          skeletonCards={2}
          className="px-4"
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[550px] mx-auto flex flex-col items-center pt-[96px] pb-32 px-4 box-border">
      <PageTitle title="FRECUENTES" onBack={onVolver}>FRECUENTES</PageTitle>

      <div className="w-full mt-0">
        {partidosFrecuentes.length === 0 ? (
          <EmptyStateCard
            icon={CalendarDays}
            title="SIN PARTIDOS FRECUENTES"
            titleClassName="font-oswald font-semibold text-[24px] leading-none tracking-[0.01em] text-white sm:text-[22px]"
            description="Todavía no tenés plantillas guardadas. Creá tu próximo partido y después guardalo como frecuente."
            actionLabel="Nuevo partido"
            onAction={() => navigate('/nuevo-partido')}
            className="my-12"
          />
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
        message={partidoToDelete ? `¿Eliminar la plantilla «${partidoToDelete.nombre}»? Esta acción no se puede deshacer.` : '¿Eliminar esta plantilla? Esta acción no se puede deshacer.'}
        onConfirm={confirmarEliminacion}
        onCancel={cancelarEliminacion}
        confirmText={isDeleting ? 'ELIMINANDO…' : 'ELIMINAR'}
        cancelText="CANCELAR"
        isDeleting={isDeleting}
        danger
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
    </div>
  );
}
