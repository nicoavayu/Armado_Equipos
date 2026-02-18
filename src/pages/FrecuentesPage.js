import React, { useRef, useState } from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import EditarPartidoFrecuente from './EditarPartidoFrecuente';
import ListaPartidosFrecuentes from './ListaPartidosFrecuentes';
import { crearPartidoDesdeFrec } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import ConfirmModal from '../components/ConfirmModal';
import { findDuplicateTemplateMatch, findUserScheduleConflicts } from '../services/db/matchScheduling';
import { notifyBlockingError } from 'utils/notifyBlockingError';

const inferCupoFromModalidad = (modalidad = '') => {
  const m = String(modalidad || '').toUpperCase().trim();
  if (m === 'F5') return 10;
  if (m === 'F6') return 12;
  if (m === 'F7') return 14;
  if (m === 'F8') return 16;
  if (m === 'F9') return 18;
  if (m === 'F11') return 22;
  return 10;
};

const nextYmdForWeekday = (weekday) => {
  const target = Number(weekday);
  if (!Number.isFinite(target) || target < 0 || target > 6) {
    return new Date().toISOString().split('T')[0];
  }
  const now = new Date();
  const current = now.getDay();
  let delta = target - current;
  if (delta < 0) delta += 7;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta, 12, 0, 0, 0);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeYmd = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const FrecuentesPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  const { user } = useAuth();
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);
  const [step, setStep] = useState('list');
  const [warningModal, setWarningModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'ENTENDIDO',
    cancelText: 'CANCELAR',
    singleButton: true,
  });
  const pendingContinueRef = useRef(null);

  const closeWarningModal = () => {
    setWarningModal((prev) => ({ ...prev, isOpen: false }));
    pendingContinueRef.current = null;
  };

  const openSingleWarning = (title, message) => {
    pendingContinueRef.current = null;
    setWarningModal({
      isOpen: true,
      title,
      message,
      confirmText: 'ENTENDIDO',
      cancelText: 'CERRAR',
      singleButton: true,
    });
  };

  const openConflictWarning = (title, message, onContinue) => {
    pendingContinueRef.current = onContinue;
    setWarningModal({
      isOpen: true,
      title,
      message,
      confirmText: 'Continuar igual',
      cancelText: 'Cancelar',
      singleButton: false,
    });
  };

  const doCreateFromTemplate = async (partidoFrecuente) => {
    const fechaObjetivo = normalizeYmd(partidoFrecuente?.fecha) || nextYmdForWeekday(partidoFrecuente?.dia_semana);
    const cupo = Number(partidoFrecuente?.cupo_jugadores || partidoFrecuente?.cupo || 0) || inferCupoFromModalidad(partidoFrecuente?.modalidad);
    const partido = await crearPartidoDesdeFrec(
      partidoFrecuente,
      fechaObjetivo,
      partidoFrecuente?.modalidad || 'F5',
      cupo,
    );
    navigateWithAnimation(`/admin/${partido.id}`);
  };

  const handleCreateFromTemplate = async (partidoFrecuente, skipScheduleCheck = false) => {
    const fechaObjetivo = normalizeYmd(partidoFrecuente?.fecha) || nextYmdForWeekday(partidoFrecuente?.dia_semana);

    const duplicate = await findDuplicateTemplateMatch({
      templateId: partidoFrecuente?.id,
      fecha: fechaObjetivo,
      hora: partidoFrecuente?.hora,
      sede: partidoFrecuente?.sede,
    });

    if (duplicate) {
      openSingleWarning(
        'PARTIDO DUPLICADO',
        'Ya existe un partido creado con las mismas características.',
      );
      return;
    }

    if (!skipScheduleCheck && user?.id) {
      const conflicts = await findUserScheduleConflicts({
        userId: user.id,
        targetMatch: {
          fecha: fechaObjetivo,
          hora: partidoFrecuente?.hora,
          sede: partidoFrecuente?.sede,
          nombre: partidoFrecuente?.nombre,
        },
      });
      if (conflicts.length > 0) {
        const c = conflicts[0];
        openConflictWarning(
          'Conflicto de horario',
          `Ya tenés un partido en ese horario (${c.nombre || 'Partido'} · ${c.fecha} ${c.hora}).`,
          async () => {
            closeWarningModal();
            await handleCreateFromTemplate(partidoFrecuente, true);
          },
        );
        return;
      }
    }

    await doCreateFromTemplate(partidoFrecuente);
  };

  if (step === 'edit' && partidoFrecuenteEditando) {
    return (
      <PageTransition>
        <div className="pb-24 w-full flex flex-col items-center">
          <EditarPartidoFrecuente
            partido={partidoFrecuenteEditando}
            onGuardado={() => {
              setPartidoFrecuenteEditando(null);
              setStep('list');
            }}
            onVolver={() => {
              setPartidoFrecuenteEditando(null);
              setStep('list');
            }}
          />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="pb-24 w-full flex flex-col items-center">
        <ListaPartidosFrecuentes
          onEntrar={async (partidoFrecuente) => {
            try {
              await handleCreateFromTemplate(partidoFrecuente);
            } catch (error) {
              if (error?.code === 'DUPLICATE_TEMPLATE_MATCH') {
                openSingleWarning(
                  'PARTIDO DUPLICADO',
                  'Ya existe un partido creado con las mismas características.',
                );
                return;
              }
              notifyBlockingError(error?.message || 'Error al crear el partido');
            }
          }}
          onEditar={(partido) => {
            setPartidoFrecuenteEditando(partido);
            setStep('edit');
          }}
          onVolver={() => navigateWithAnimation('/', 'back')}
        />
      </div>
      <ConfirmModal
        isOpen={warningModal.isOpen}
        title={warningModal.title}
        message={warningModal.message}
        confirmText={warningModal.confirmText}
        cancelText={warningModal.cancelText}
        singleButton={warningModal.singleButton}
        onCancel={closeWarningModal}
        onConfirm={async () => {
          const action = pendingContinueRef.current;
          if (action) {
            await action();
            return;
          }
          closeWarningModal();
        }}
      />
    </PageTransition>
  );
};

export default FrecuentesPage;
