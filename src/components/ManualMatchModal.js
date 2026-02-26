import { notifyBlockingError } from 'utils/notifyBlockingError';
// src/components/ManualMatchModal.js
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import { CalendarDays, Handshake, Trophy, CircleX, X } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
// import './ManualMatchModal.css'; // REMOVED

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

      console.info('Partido agregado exitosamente');
      onSaved();
      onClose();

      // Reset form
      setFormData({
        tipo_partido: 'amistoso',
        resultado: 'ganaste',
        fecha: new Date().toISOString().split('T')[0],
      });
    } catch (error) {
      console.error('Error saving manual match:', error);
      notifyBlockingError('Error al guardar el partido');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div data-modal-root="true" className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] p-4 sm:p-3" onClick={onClose}>
      <motion.div
        className="bg-[#1F2252] rounded-3xl p-6 w-full max-w-[540px] border border-white/15 backdrop-blur-md max-h-[90vh] overflow-y-auto"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-oswald text-xl font-semibold text-white m-0">Sumar partido manual</h3>
          <button className="bg-transparent border-none text-white/80 cursor-pointer p-1 rounded transition-all hover:bg-white/10 hover:text-white" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="font-oswald text-sm font-semibold text-white uppercase">Tipo de Partido</label>
            <select
              value={formData.tipo_partido}
              onChange={(e) => setFormData({ ...formData, tipo_partido: e.target.value })}
              required
              className="p-3 px-4 border-2 border-white/20 rounded-lg bg-white/10 text-white font-oswald text-base backdrop-blur-md outline-none focus:border-white/50 focus:bg-white/15"
            >
              <option value="amistoso" className="bg-[#333] text-white">Amistoso</option>
              <option value="torneo" className="bg-[#333] text-white">Torneo</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-oswald text-sm font-semibold text-white uppercase">Resultado</label>
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
                  className={`flex flex-col items-center gap-1 p-3 px-2 bg-white/10 border-2 border-white/20 rounded-lg cursor-pointer transition-all font-oswald hover:bg-white/15 hover:-translate-y-0.5 sm:flex-row sm:justify-center sm:p-2.5 sm:px-4 ${formData.resultado === option.value ? 'bg-white/20 border-white/50 -translate-y-0.5 shadow-lg' : ''}`}
                  onClick={() => setFormData({ ...formData, resultado: option.value })}
                >
                  <span className="text-white/85">
                    <Icon size={24} />
                  </span>
                  <span className="text-xs font-semibold text-white uppercase sm:text-sm">{option.label}</span>
                </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-oswald text-sm font-semibold text-white uppercase">Fecha</label>
            <input
              type="date"
              value={formData.fecha}
              onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
              required
              className="p-3 px-4 border-2 border-white/20 rounded-lg bg-white/10 text-white font-oswald text-base backdrop-blur-md outline-none focus:border-white/50 focus:bg-white/15"
            />
            <div className="text-white/55 text-xs flex items-center gap-1.5">
              <CalendarDays size={16} />
              Fecha del partido manual
            </div>
          </div>

          <div className="flex gap-3 mt-2">
            <button type="button" className="flex-1 p-3 border-2 border-white/20 rounded-lg bg-white/10 text-white/80 font-oswald text-sm font-semibold uppercase cursor-pointer transition-all hover:bg-white/15 hover:text-white" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 p-3 border-none rounded-lg bg-primary text-white font-oswald text-sm font-semibold uppercase cursor-pointer transition-all hover:brightness-110 hover:-translate-y-px hover:shadow-lg disabled:bg-white/20 disabled:text-white/50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? 'Guardando...' : 'Guardar Partido'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default ManualMatchModal;
