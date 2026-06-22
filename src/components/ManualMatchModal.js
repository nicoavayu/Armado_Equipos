import logger from '../utils/logger';
import { notifyBlockingError } from 'utils/notifyBlockingError';
// src/components/ManualMatchModal.js
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import { CalendarDays, Handshake, Trophy, CircleX, X } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
// import './ManualMatchModal.css'; // REMOVED

const SECTION_LABEL_CLASS = 'font-oswald text-xs font-medium text-white/70 uppercase tracking-widest pl-0.5';
const FIELD_CLASS = 'h-[52px] w-full appearance-none rounded-xl border border-[rgba(148,134,255,0.25)] bg-[rgba(20,16,41,0.85)] px-4 text-white font-oswald text-lg outline-none transition-all duration-300 focus:border-[#8b7cff] focus:ring-2 focus:ring-[#6a43ff]/30';
const SECONDARY_ACTION_BUTTON_CLASS = 'flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/92 font-bebas text-base tracking-[0.01em] transition-all duration-200 inline-flex items-center justify-center hover:bg-white/[0.1] hover:border-[rgba(148,134,255,0.45)] active:scale-[0.985] active:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
const PRIMARY_ACTION_BUTTON_CLASS = 'flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border border-white/20 bg-cta-gradient text-white font-bebas text-base tracking-[0.01em] transition-all duration-200 inline-flex items-center justify-center hover:brightness-105 active:scale-[0.985] shadow-cta disabled:bg-[rgba(106,67,255,0.55)] disabled:border-[rgba(125,90,255,0.5)] disabled:text-white/40 disabled:shadow-none disabled:cursor-not-allowed sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';

const ManualMatchModal = ({ isOpen, onClose, onSaved }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    tipo_partido: 'amistoso',
    resultado: 'ganaste',
    fecha: new Date().toISOString().split('T')[0],
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('partidos_manuales')
        .insert([{
          usuario_id: user.id,
          tipo_partido: formData.tipo_partido,
          resultado: formData.resultado,
          fecha: formData.fecha,
          created_at: new Date().toISOString(),
        }]);

      if (error) throw error;

      logger.info('Partido agregado exitosamente');
      onSaved();
      onClose();

      // Reset form
      setFormData({
        tipo_partido: 'amistoso',
        resultado: 'ganaste',
        fecha: new Date().toISOString().split('T')[0],
      });
    } catch (error) {
      logger.error('Error saving manual match:', error);
      notifyBlockingError('Error al guardar el partido');
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
            Sumar partido manual
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className={SECTION_LABEL_CLASS}>Tipo de partido</label>
            <select
              value={formData.tipo_partido}
              onChange={(e) => setFormData({ ...formData, tipo_partido: e.target.value })}
              required
              className={`${FIELD_CLASS} [color-scheme:dark]`}
            >
              <option value="amistoso" className="bg-[#1b2450] text-white">Amistoso</option>
              <option value="torneo" className="bg-[#1b2450] text-white">Torneo</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className={SECTION_LABEL_CLASS}>Resultado</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-1 sm:gap-1.5">
              {[
                { value: 'ganaste', label: 'Ganaste', icon: Trophy },
                { value: 'empate', label: 'Empate', icon: Handshake },
                { value: 'perdiste', label: 'Perdiste', icon: CircleX },
              ].map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`min-h-[88px] flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl border text-white font-oswald transition-all duration-200 active:scale-[0.985] sm:min-h-[52px] sm:flex-row sm:justify-center ${formData.resultado === option.value
                      ? 'bg-[linear-gradient(135deg,rgba(125,82,255,0.4),rgba(84,48,224,0.3))] border-[#8d6bff] shadow-[0_0_16px_rgba(106,67,255,0.32),inset_0_1px_0_rgba(255,255,255,0.15)]'
                      : 'bg-white/[0.05] border-[rgba(148,134,255,0.28)] hover:bg-white/[0.1]'
                    }`}
                    onClick={() => setFormData({ ...formData, resultado: option.value })}
                  >
                    <span className={formData.resultado === option.value ? 'text-white' : 'text-white/80'}>
                      <Icon size={24} />
                    </span>
                    <span className="text-xs font-semibold text-white sm:text-sm">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className={SECTION_LABEL_CLASS}>Fecha</label>
            <input
              type="date"
              value={formData.fecha}
              onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
              required
              className={`${FIELD_CLASS} [color-scheme:dark]`}
            />
            <div className="text-white/60 text-xs flex items-center gap-1.5 font-oswald">
              <CalendarDays size={16} />
              Fecha del partido manual
            </div>
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
              className={PRIMARY_ACTION_BUTTON_CLASS}
              disabled={loading}
              data-preserve-button-case="true"
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default ManualMatchModal;
