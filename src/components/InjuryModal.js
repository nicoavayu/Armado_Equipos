import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import { toast } from 'react-toastify';
import './InjuryModal.css';

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
    <div className="modal-overlay" onClick={onClose}>
      <motion.div 
        className="injury-modal"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{activeLesion ? 'Gestionar Lesión' : 'Registrar Lesión'}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {activeLesion && (
          <div className="active-injury-section">
            <div className="active-injury-info">
              <h4>🏥 Lesión Activa</h4>
              <p><strong>Tipo:</strong> {activeLesion.tipo_lesion}</p>
              <p><strong>Desde:</strong> {new Date(activeLesion.fecha_inicio).toLocaleDateString('es-ES')}</p>
            </div>
            <button 
              type="button" 
              className="recover-btn"
              onClick={markAsRecovered}
              disabled={loading}
            >
              {loading ? 'Marcando...' : '✅ Marcar como Recuperado'}
            </button>
            <div className="divider">O registrar nueva lesión</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="injury-form">
          <div className="form-group">
            <label>Tipo de Lesión</label>
            <select
              value={formData.tipo_lesion}
              onChange={(e) => setFormData({ ...formData, tipo_lesion: e.target.value })}
              required
            >
              <option value="">Seleccionar tipo de lesión</option>
              {tiposLesion.map((tipo) => (
                <option key={tipo} value={tipo}>{tipo}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Fecha de Inicio</label>
            <input
              type="date"
              value={formData.fecha_inicio}
              onChange={(e) => setFormData({ ...formData, fecha_inicio: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>Fecha de Fin (opcional)</label>
            <input
              type="date"
              value={formData.fecha_fin}
              onChange={(e) => setFormData({ ...formData, fecha_fin: e.target.value })}
              min={formData.fecha_inicio}
            />
            <small className="form-help">
              Dejar vacío si la lesión sigue activa
            </small>
          </div>

          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="save-btn" disabled={loading}>
              {loading ? 'Guardando...' : 'Registrar Lesión'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default InjuryModal;