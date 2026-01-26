// src/components/InjuryModal.js
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import { toast } from 'react-toastify';
// import './InjuryModal.css'; // REMOVED

const InjuryModal = ({ isOpen, onClose, onSaved }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    tipo_lesion: '',
    fecha_inicio: new Date().toISOString().split('T')[0],
    fecha_fin: ''
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

      toast.success('Lesión marcada como recuperada');
      onSaved();
      onClose();
      setActiveLesion(null);
    } catch (error) {
      console.error('Error marking as recovered:', error);
      toast.error(`Error al marcar como recuperado: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const tiposLesion = [
    'Esguince',
    'Desgarro',
    'Fractura',
    'Contusión',
    'Tendinitis',
    'Luxación',
    'Distensión muscular',
    'Lesión de menisco',
    'Lesión de ligamentos',
    'Otra'
  ];

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
          created_at: new Date().toISOString()
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

      toast.success('Lesión registrada exitosamente');
      onSaved();
      onClose();

      // Reset form
      setFormData({
        tipo_lesion: '',
        fecha_inicio: new Date().toISOString().split('T')[0],
        fecha_fin: ''
      });
    } catch (error) {
      console.error('Error saving injury:', error);
      toast.error('Error al registrar la lesión');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] p-5 md:items-start md:pt-20 md:px-2.5" onClick={onClose}>
      <motion.div
        className="bg-gradient-to-br from-[#ff6b6b] to-[#ee5a24] rounded-2xl p-6 w-full max-w-[400px] border border-white/20 backdrop-blur-md md:p-5 md:m-0 md:max-h-[90vh] md:overflow-y-auto"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-oswald text-xl font-semibold text-white m-0 uppercase">{activeLesion ? 'Gestionar Lesión' : 'Registrar Lesión'}</h3>
          <button className="bg-transparent border-none text-white/80 text-2xl cursor-pointer p-1 rounded transition-all hover:bg-white/10 hover:text-white" onClick={onClose}>×</button>
        </div>

        {activeLesion && (
          <div className="bg-white/10 rounded-xl p-4 mb-5 border border-white/20">
            <div className="mb-3">
              <h4 className="text-white m-0 mb-3 text-base font-semibold">🏥 Lesión Activa</h4>
              <p className="text-white/90 my-1 text-sm"><strong>Tipo:</strong> {activeLesion.tipo_lesion}</p>
              <p className="text-white/90 my-1 text-sm"><strong>Desde:</strong> {new Date(activeLesion.fecha_inicio).toLocaleDateString('es-ES')}</p>
            </div>
            <button
              type="button"
              className="bg-gradient-to-br from-[#4CAF50] to-[#45a049] text-white border-none rounded-lg p-3 px-4 font-semibold cursor-pointer transition-all mt-3 w-full hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={markAsRecovered}
              disabled={loading}
            >
              {loading ? 'Marcando...' : '✅ Marcar como Recuperado'}
            </button>
            <div className="flex items-center gap-3 text-center text-white/70 text-sm my-4">
              <div className="h-px bg-white/20 flex-1"></div>
              <span>O registrar nueva lesión</span>
              <div className="h-px bg-white/20 flex-1"></div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="font-oswald text-sm font-semibold text-white uppercase">Tipo de Lesión</label>
            <select
              value={formData.tipo_lesion}
              onChange={(e) => setFormData({ ...formData, tipo_lesion: e.target.value })}
              required
              className="p-3 px-4 border-2 border-white/20 rounded-lg bg-white/10 text-white font-oswald text-base backdrop-blur-md outline-none focus:border-white/50 focus:bg-white/15"
            >
              <option value="" className="bg-[#333] text-white">Seleccionar tipo de lesión</option>
              {tiposLesion.map((tipo) => (
                <option key={tipo} value={tipo} className="bg-[#333] text-white">{tipo}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-oswald text-sm font-semibold text-white uppercase">Fecha de Inicio</label>
            <input
              type="date"
              value={formData.fecha_inicio}
              onChange={(e) => setFormData({ ...formData, fecha_inicio: e.target.value })}
              required
              className="p-3 px-4 border-2 border-white/20 rounded-lg bg-white/10 text-white font-oswald text-base backdrop-blur-md outline-none focus:border-white/50 focus:bg-white/15"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-oswald text-sm font-semibold text-white uppercase">Fecha de Fin (opcional)</label>
            <input
              type="date"
              value={formData.fecha_fin}
              onChange={(e) => setFormData({ ...formData, fecha_fin: e.target.value })}
              min={formData.fecha_inicio}
              className="p-3 px-4 border-2 border-white/20 rounded-lg bg-white/10 text-white font-oswald text-base backdrop-blur-md outline-none focus:border-white/50 focus:bg-white/15"
            />
            <small className="font-oswald text-xs text-white/70 mt-1">
              Dejar vacío si la lesión sigue activa
            </small>
          </div>

          <div className="flex gap-3 mt-2">
            <button type="button" className="flex-1 p-3 border-2 border-white/20 rounded-lg bg-white/10 text-white/80 font-oswald text-sm font-semibold uppercase cursor-pointer transition-all hover:bg-white/15 hover:text-white" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 p-3 border-none rounded-lg bg-[#4CAF50] text-white font-oswald text-sm font-semibold uppercase cursor-pointer transition-all hover:bg-[#45a049] hover:-translate-y-px hover:shadow-lg disabled:bg-white/20 disabled:text-white/50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? 'Guardando...' : 'Registrar Lesión'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default InjuryModal;