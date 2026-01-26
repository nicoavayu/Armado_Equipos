import React, { useState } from 'react';
import { recordAbsenceNotification } from '../services/absenceService';
import { toast } from 'react-toastify';

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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-5 max-[768px]:p-[10px]">
      <div className="bg-white rounded-xl w-full max-w-[500px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.3)] max-[768px]:max-h-[95vh]">
        <div className="flex justify-between items-center px-6 py-5 border-b border-[#eee] max-[768px]:px-5 max-[768px]:py-4">
          <h2 className="m-0 text-[#333] text-[1.5rem]">Notificar Ausencia</h2>
          <button
            className="bg-none border-none text-2xl cursor-pointer text-[#666] p-0 w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors hover:bg-[#f5f5f5]"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 max-[768px]:p-5">
          <div className="mb-5">
            <label htmlFor="reason" className="block mb-2 font-semibold text-[#333]">Motivo de la ausencia *</label>
            <textarea
              id="reason"
              className="w-full p-3 border-2 border-[#ddd] rounded-lg text-base transition-colors box-border focus:outline-none focus:border-[#007bff] resize-y min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica brevemente por qué no podrás asistir..."
              required
              rows={3}
            />
          </div>

          <div className="mb-5">
            <label className="flex items-center cursor-pointer mb-0">
              <input
                type="checkbox"
                className="w-auto mr-2 mb-0"
                checked={foundReplacement}
                onChange={(e) => setFoundReplacement(e.target.checked)}
              />
              <span>Encontré un reemplazo</span>
            </label>
          </div>

          {foundReplacement && (
            <div className="mb-5">
              <label htmlFor="replacementName" className="block mb-2 font-semibold text-[#333]">Nombre del reemplazo *</label>
              <input
                type="text"
                id="replacementName"
                className="w-full p-3 border-2 border-[#ddd] rounded-lg text-base transition-colors box-border focus:outline-none focus:border-[#007bff]"
                value={replacementName}
                onChange={(e) => setReplacementName(e.target.value)}
                placeholder="Nombre completo del jugador que me reemplaza"
                required
              />
            </div>
          )}

          <div className="bg-[#f8f9fa] border border-[#dee2e6] rounded-lg p-4 mb-6">
            <p className="m-0 mb-2 font-semibold text-[#495057]"><strong>Importante:</strong></p>
            <ul className="m-0 pl-5">
              <li className="mb-1 text-[#6c757d] text-sm">Si avisas con 4+ horas de anticipación, no habrá penalización</li>
              <li className="mb-1 text-[#6c757d] text-sm">Si encuentras un reemplazo, no habrá penalización</li>
              <li className="mb-1 text-[#6c757d] text-sm">Si no cumples estas condiciones, se restará 0.5 puntos de tu rating</li>
            </ul>
          </div>

          <div className="flex gap-3 justify-end max-[768px]:flex-col">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border-none rounded-lg text-base font-semibold cursor-pointer transition-all bg-[#6c757d] text-white hover:bg-[#5a6268] max-[768px]:w-full"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 border-none rounded-lg text-base font-semibold cursor-pointer transition-all bg-[#007bff] text-white hover:bg-[#0056b3] disabled:bg-[#6c757d] disabled:cursor-not-allowed max-[768px]:w-full"
            >
              {submitting ? 'Registrando...' : 'Registrar Ausencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AbsenceNotification;