import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import { toast } from 'react-toastify';
import './ManualMatchModal.css';

const ManualMatchModal = ({ isOpen, onClose, onSaved }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    tipo_partido: 'amistoso',
    resultado: 'ganaste',
    fecha: new Date().toISOString().split('T')[0]
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
          created_at: new Date().toISOString()
        }]);

      if (error) throw error;

      toast.success('Partido agregado exitosamente');
      onSaved();
      onClose();
      
      // Reset form
      setFormData({
        tipo_partido: 'amistoso',
        resultado: 'ganaste',
        fecha: new Date().toISOString().split('T')[0]
      });
    } catch (error) {
      console.error('Error saving manual match:', error);
      toast.error('Error al guardar el partido');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div 
        className="manual-match-modal"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Sumar Partido Manual</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="manual-match-form">
          <div className="form-group">
            <label>Tipo de Partido</label>
            <select
              value={formData.tipo_partido}
              onChange={(e) => setFormData({ ...formData, tipo_partido: e.target.value })}
              required
            >
              <option value="amistoso">Amistoso</option>
              <option value="torneo">Torneo</option>
            </select>
          </div>

          <div className="form-group">
            <label>Resultado</label>
            <div className="result-buttons">
              {[
                { value: 'ganaste', label: 'Ganaste', emoji: '🏆' },
                { value: 'empate', label: 'Empate', emoji: '🤝' },
                { value: 'perdiste', label: 'Perdiste', emoji: '😔' }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`result-btn ${formData.resultado === option.value ? 'active' : ''}`}
                  onClick={() => setFormData({ ...formData, resultado: option.value })}
                >
                  <span className="result-emoji">{option.emoji}</span>
                  <span className="result-label">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Fecha</label>
            <input
              type="date"
              value={formData.fecha}
              onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
              required
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="save-btn" disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar Partido'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default ManualMatchModal;