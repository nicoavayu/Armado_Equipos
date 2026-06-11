import { notifyBlockingError } from 'utils/notifyBlockingError';
import { friendlyError } from 'utils/friendlyError';
// src/components/InjuryModal.js
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import { CalendarDays, CircleAlert, CircleCheck, Plus, X } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
// import './InjuryModal.css'; // REMOVED

const SECTION_LABEL_CLASS = 'font-oswald text-xs font-medium text-white/70 uppercase tracking-widest pl-0.5';
const FIELD_CLASS = 'h-[52px] w-full appearance-none rounded-xl border border-[rgba(148,134,255,0.25)] bg-[rgba(20,16,41,0.85)] px-4 text-white font-oswald text-lg outline-none transition-all duration-300 focus:border-[#8b7cff] focus:ring-2 focus:ring-[#6a43ff]/30';
const SECONDARY_ACTION_BUTTON_CLASS = 'flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/92 font-bebas text-base tracking-[0.01em] transition-all duration-200 inline-flex items-center justify-center hover:bg-white/[0.1] hover:border-[rgba(148,134,255,0.45)] active:scale-[0.985] active:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
const PRIMARY_ACTION_BUTTON_CLASS = 'min-h-[44px] px-4 py-2.5 rounded-xl border border-white/20 bg-cta-gradient text-white font-bebas text-base tracking-[0.01em] transition-all duration-200 inline-flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.985] shadow-cta disabled:bg-[rgba(106,67,255,0.55)] disabled:border-[rgba(125,90,255,0.5)] disabled:text-white/40 disabled:shadow-none disabled:cursor-not-allowed sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
const INJURY_TYPES = [
  'Esguince',
  'Desgarro muscular',
  'Fractura',
  'Contusión',
  'Tendinitis',
  'Luxación',
  'Distensión muscular',
  'Contractura muscular',
  'Lesión de menisco',
  'Lesión de ligamentos',
  'Rotura del ligamento cruzado anterior',
  'Pubalgia',
  'Fascitis plantar',
  'Periostitis tibial',
  'Otra',
];

const InjuryModal = ({ isOpen, onClose, onSaved }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    tipo_lesion: '',
    fecha_inicio: new Date().toISOString().split('T')[0],
    fecha_fin: '',
  });
  const [loading, setLoading] = useState(false);
  const [activeLesion, setActiveLesion] = useState(null);

  // Cargar lesión activa al abrir el modal
  React.useEffect(() => {
    if (isOpen && user) {
      loadActiveLesion();
    }
  }, [isOpen, user]);

  const loadActiveLesion = async () => {
    try {
      const { data, error } = await supabase
        .from('lesiones')
        .select('*')
        .eq('usuario_id', user.id)
        .is('fecha_fin', null)
        .order('fecha_inicio', { ascending: false })
        .limit(1);

      if (error) throw error;
      setActiveLesion(data?.[0] || null);
    } catch (error) {
      console.error('Error loading active lesion:', error);
    }
  };

  const markAsRecovered = async () => {
    if (!activeLesion) return;

    setLoading(true);
    try {
      const fechaFin = new Date().toISOString().split('T')[0];

      console.log('Updating lesion:', activeLesion.id, 'with fecha_fin:', fechaFin);
      const { error } = await supabase
        .from('lesiones')
        .update({ fecha_fin: fechaFin })
        .eq('id', activeLesion.id);

      if (error) {
        console.error('Error updating lesion:', error);
        throw error;
      }

      // Actualizar el campo lesion_activa en usuarios
      console.log('Updating user lesion_activa for user:', user.id);
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ lesion_activa: false })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error updating user lesion_activa:', updateError);
        // Si falla la actualización del usuario, continuar igual
        console.warn('Failed to update lesion_activa field, but lesion was marked as recovered');
      }

      console.info('Lesión marcada como recuperada');
      onSaved();
      onClose();
      setActiveLesion(null);
    } catch (error) {
      console.error('Error marking as recovered:', error);
      notifyBlockingError(friendlyError(error, 'No se pudo registrar la recuperación. Intentá de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('lesiones')
        .insert([{
          usuario_id: user.id,
          tipo_lesion: formData.tipo_lesion,
          fecha_inicio: formData.fecha_inicio,
          fecha_fin: formData.fecha_fin || null,
          created_at: new Date().toISOString(),
        }]);

      if (error) throw error;

      // Actualizar el campo lesion_activa en la tabla usuarios
      const lesionActiva = !formData.fecha_fin; // Si no hay fecha_fin, está activa
      console.log('Updating user lesion_activa to:', lesionActiva, 'for user:', user.id);
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ lesion_activa: lesionActiva })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error updating user lesion_activa:', updateError);
        // Si falla la actualización del usuario, continuar igual
        console.warn('Failed to update lesion_activa field, but injury was registered');
      }

      console.info('Lesión registrada exitosamente');
      onSaved();
      onClose();

      // Reset form
      setFormData({
        tipo_lesion: '',
        fecha_inicio: new Date().toISOString().split('T')[0],
        fecha_fin: '',
      });
    } catch (error) {
      console.error('Error saving injury:', error);
      notifyBlockingError('Error al registrar la lesión');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      data-modal-root="true"
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 sm:p-3"
      onClick={onClose}
    >
      <motion.div
        className="relative bg-[radial-gradient(420px_200px_at_18%_-20%,rgba(139,92,255,0.18),transparent_70%),linear-gradient(168deg,rgba(38,30,80,0.99),rgba(15,12,32,0.99))] rounded-card p-6 w-full max-w-[540px] border border-[rgba(148,134,255,0.28)] max-h-[90vh] overflow-y-auto custom-scrollbar shadow-[0_24px_64px_rgba(5,3,16,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] after:content-[''] after:absolute after:top-0 after:inset-x-0 after:h-px after:rounded-t-card after:bg-[linear-gradient(90deg,transparent_6%,rgba(139,92,255,0.55)_42%,rgba(236,0,125,0.35)_68%,transparent_94%)]"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-oswald text-[22px] leading-none font-bold tracking-[0.01em] text-white m-0 flex items-center gap-2.5">
            <span className="inline-block w-1 h-[18px] rounded-full bg-[linear-gradient(180deg,#ec007d,#8b5cff)] shadow-[0_0_10px_rgba(236,0,125,0.45)]" />
            {activeLesion ? 'Gestionar lesión' : 'Registrar lesión'}
          </h3>
          <button
            className="bg-white/[0.05] border border-white/10 text-white/80 cursor-pointer p-1.5 rounded-full transition-all hover:border-[rgba(148,134,255,0.4)] hover:bg-white/[0.1] hover:text-white active:scale-95"
            onClick={onClose}
            type="button"
            aria-label="Cerrar modal"
          >
            <X size={24} />
          </button>
        </div>

        {activeLesion && (
          <div className="bg-[rgba(20,16,41,0.75)] rounded-2xl p-4 mb-5 border border-[rgba(248,113,113,0.3)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="mb-3">
              <h4 className="text-white m-0 mb-3 text-base font-semibold flex items-center gap-2 font-oswald">
                <CircleAlert size={20} className="text-[#ff8a8a]" />
                Lesión activa
              </h4>
              <p className="text-white/90 my-1 text-sm font-oswald"><strong>Tipo:</strong> {activeLesion.tipo_lesion}</p>
              <p className="text-white/90 my-1 text-sm font-oswald"><strong>Desde:</strong> {new Date(activeLesion.fecha_inicio).toLocaleDateString('es-ES')}</p>
            </div>
            <button
              type="button"
              className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full`}
              onClick={markAsRecovered}
              disabled={loading}
              data-preserve-button-case="true"
            >
              {loading ? 'Marcando...' : (
                <>
                  <CircleCheck size={18} />
                  Marcar como recuperado
                </>
              )}
            </button>
            <div className="flex items-center gap-3 text-center text-white/70 text-sm my-4 font-oswald">
              <div className="h-px bg-[rgba(148,134,255,0.28)] flex-1"></div>
              <span className="inline-flex items-center gap-1.5 text-white/75">
                <Plus size={16} />
                O registrar nueva lesión
              </span>
              <div className="h-px bg-[rgba(148,134,255,0.28)] flex-1"></div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className={SECTION_LABEL_CLASS}>Tipo de lesión</label>
            <select
              value={formData.tipo_lesion}
              onChange={(e) => setFormData({ ...formData, tipo_lesion: e.target.value })}
              required
              className={`${FIELD_CLASS} [color-scheme:dark]`}
            >
              <option value="" className="bg-[#1b2450] text-white">Seleccionar tipo de lesión</option>
              {INJURY_TYPES.map((tipo) => (
                <option key={tipo} value={tipo} className="bg-[#1b2450] text-white">{tipo}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className={SECTION_LABEL_CLASS}>Fecha de inicio</label>
            <input
              type="date"
              value={formData.fecha_inicio}
              onChange={(e) => setFormData({ ...formData, fecha_inicio: e.target.value })}
              required
              className={`${FIELD_CLASS} [color-scheme:dark]`}
            />
            <div className="text-white/60 text-xs flex items-center gap-1.5 font-oswald">
              <CalendarDays size={16} />
              Fecha de inicio de la lesión
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className={SECTION_LABEL_CLASS}>Fecha de fin (opcional)</label>
            <input
              type="date"
              value={formData.fecha_fin}
              onChange={(e) => setFormData({ ...formData, fecha_fin: e.target.value })}
              min={formData.fecha_inicio}
              className={`${FIELD_CLASS} [color-scheme:dark]`}
            />
            <small className="font-oswald text-xs text-white/70 mt-1">
              Dejar vacío si la lesión sigue activa
            </small>
          </div>

          <div className="flex gap-3 mt-2">
            <button
              type="button"
              className={SECONDARY_ACTION_BUTTON_CLASS}
              onClick={onClose}
              data-preserve-button-case="true"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`${PRIMARY_ACTION_BUTTON_CLASS} flex-1`}
              disabled={loading}
              data-preserve-button-case="true"
            >
              {loading ? 'Registrando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default InjuryModal;
