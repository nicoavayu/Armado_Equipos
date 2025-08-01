import React, { useState } from 'react';
import { recordAbsenceNotification } from '../services/absenceService';
import { toast } from 'react-toastify';
import './AbsenceNotification.css';

/**
 * Component for players to notify their absence from a match
 */
const AbsenceNotification = ({ userId, partidoId, onClose, onSuccess }) => {
  const [reason, setReason] = useState('');
  const [foundReplacement, setFoundReplacement] = useState(false);
  const [replacementName, setReplacementName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!reason.trim()) {
      toast.error('Por favor indica el motivo de tu ausencia');
      return;
    }

    if (foundReplacement && !replacementName.trim()) {
      toast.error('Por favor indica el nombre del reemplazo');
      return;
    }

    setSubmitting(true);

    try {
      const fullReason = foundReplacement 
        ? `${reason.trim()} - Reemplazo: ${replacementName.trim()}`
        : reason.trim();

      const result = await recordAbsenceNotification(
        userId,
        partidoId,
        fullReason,
        foundReplacement,
      );

      if (result.success) {
        const timeMessage = result.notifiedInTime 
          ? 'Tu aviso fue registrado a tiempo (4+ horas antes).'
          : 'Tu aviso fue registrado, pero con menos de 4 horas de anticipación.';
        
        const penaltyMessage = result.notifiedInTime || result.foundReplacement
          ? ' No se aplicará penalización a tu rating.'
          : ' Se aplicará una penalización de -0.5 puntos a tu rating.';

        toast.success(`Ausencia registrada. ${timeMessage}${penaltyMessage}`);
        
        if (onSuccess) onSuccess(result);
        if (onClose) onClose();
      }
    } catch (error) {
      console.error('Error recording absence:', error);
      toast.error('Error al registrar la ausencia: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="absence-notification-overlay">
      <div className="absence-notification-modal">
        <div className="absence-notification-header">
          <h2>Notificar Ausencia</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="absence-notification-form">
          <div className="form-group">
            <label htmlFor="reason">Motivo de la ausencia *</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica brevemente por qué no podrás asistir..."
              required
              rows={3}
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={foundReplacement}
                onChange={(e) => setFoundReplacement(e.target.checked)}
              />
              <span>Encontré un reemplazo</span>
            </label>
          </div>

          {foundReplacement && (
            <div className="form-group">
              <label htmlFor="replacementName">Nombre del reemplazo *</label>
              <input
                type="text"
                id="replacementName"
                value={replacementName}
                onChange={(e) => setReplacementName(e.target.value)}
                placeholder="Nombre completo del jugador que me reemplaza"
                required
              />
            </div>
          )}

          <div className="absence-info">
            <p><strong>Importante:</strong></p>
            <ul>
              <li>Si avisas con 4+ horas de anticipación, no habrá penalización</li>
              <li>Si encuentras un reemplazo, no habrá penalización</li>
              <li>Si no cumples estas condiciones, se restará 0.5 puntos de tu rating</li>
            </ul>
          </div>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-button">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="submit-button">
              {submitting ? 'Registrando...' : 'Registrar Ausencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AbsenceNotification;