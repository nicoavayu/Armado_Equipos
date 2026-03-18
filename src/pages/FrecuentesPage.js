import React, { useRef, useState } from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import { useScrollResetOnChange } from '../hooks/useScrollReset';
import PageTransition from '../components/PageTransition';
import EditarPartidoFrecuente from './EditarPartidoFrecuente';
import ListaPartidosFrecuentes from './ListaPartidosFrecuentes';
import { crearPartidoDesdeFrec, updatePartidoFrecuente } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import ConfirmModal from '../components/ConfirmModal';
import { findDuplicateTemplateMatch, findUserScheduleConflicts } from '../services/db/matchScheduling';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import {
  nextYmdForWeekday,
  normalizeYmd,
  parseYmdAsLocal,
  resolveNextTemplateDate,
} from '../utils/frequentTemplateDate';

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

const formatYmdForHuman = (ymd) => {
  const date = parseYmdAsLocal(ymd);
  if (!date) return ymd || '';
  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'numeric',
  });
};

const formatWeekdayForHuman = (ymd) => {
  const date = parseYmdAsLocal(ymd);
  if (!date) return 'día';
  return date
    .toLocaleDateString('es-AR', { weekday: 'long' })
    .replace('.', '')
    .toLowerCase();
};

const buildNextCreationPrompt = (partidoFrecuente) => {
  const nombre = String(partidoFrecuente?.nombre || 'Partido').trim() || 'Partido';
  const hora = String(partidoFrecuente?.hora || '').trim();
  const { referenceDate, targetDate } = resolveNextTemplateDate(partidoFrecuente);
  const weekdayLabel = formatWeekdayForHuman(targetDate);
  const dateLabel = formatYmdForHuman(targetDate);
  const referenceLabel = referenceDate ? formatYmdForHuman(referenceDate) : '';

  const scheduleMessage = hora
    ? `¿Querés crear «${nombre}» para el próximo ${weekdayLabel} ${dateLabel} a las ${hora}?`
    : `¿Querés crear «${nombre}» para el próximo ${weekdayLabel} ${dateLabel}?`;

  const referenceMessage = referenceLabel
    ? ` Tomamos como referencia la fecha anterior (${referenceLabel}).`
    : ' Tomamos como referencia la configuración semanal de esta plantilla.';

  return {
    template: partidoFrecuente,
    targetDate,
    message: `${scheduleMessage}${referenceMessage}`,
  };
};

const FrecuentesPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  const { user } = useAuth();
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);
  const [step, setStep] = useState('list');
  const [nextDateModal, setNextDateModal] = useState({
    isOpen: false,
    template: null,
    targetDate: '',
    message: '',
  });
  const [warningModal, setWarningModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'ENTENDIDO',
    cancelText: 'CANCELAR',
    singleButton: true,
  });
  const pendingContinueRef = useRef(null);

  useScrollResetOnChange(step);

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

    // Keep the template date moving forward so next creation suggests the following week.
    if (partidoFrecuente?.id && fechaObjetivo) {
      try {
        await updatePartidoFrecuente(partidoFrecuente.id, { fecha: fechaObjetivo });
      } catch (updateTemplateError) {
        console.warn('[FRECUENTES] No se pudo actualizar la fecha de referencia en la plantilla:', updateTemplateError);
      }
    }

    navigateWithAnimation(`/admin/${partido.id}`);
  };

  const handleCreateFromTemplate = async (partidoFrecuente, skipScheduleCheck = false, forcedDate = '') => {
    const fechaObjetivo = normalizeYmd(forcedDate) || normalizeYmd(partidoFrecuente?.fecha) || nextYmdForWeekday(partidoFrecuente?.dia_semana);

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
            await handleCreateFromTemplate(partidoFrecuente, true, fechaObjetivo);
          },
        );
        return;
      }
    }

    await doCreateFromTemplate({ ...partidoFrecuente, fecha: fechaObjetivo });
  };

  if (step === 'edit' && partidoFrecuenteEditando) {
    return (
      <PageTransition>
        <div className="w-full flex flex-col items-center">
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
          onEntrar={(partidoFrecuente) => {
            const prompt = buildNextCreationPrompt(partidoFrecuente);
            setNextDateModal({
              isOpen: true,
              template: prompt.template,
              targetDate: prompt.targetDate,
              message: prompt.message,
            });
          }}
          onEditar={(partido) => {
            setPartidoFrecuenteEditando(partido);
            setStep('edit');
          }}
          onVolver={() => navigateWithAnimation('/', 'back')}
        />
      </div>
      <ConfirmModal
        isOpen={nextDateModal.isOpen}
        title="CREAR PARTIDO"
        message={nextDateModal.message}
        confirmText="CREAR PARTIDO"
        cancelText="CANCELAR"
        onCancel={() => {
          setNextDateModal({
            isOpen: false,
            template: null,
            targetDate: '',
            message: '',
          });
        }}
        onConfirm={async () => {
          const template = nextDateModal.template;
          const targetDate = nextDateModal.targetDate;
          setNextDateModal({
            isOpen: false,
            template: null,
            targetDate: '',
            message: '',
          });

          if (!template) return;

          try {
            await handleCreateFromTemplate(template, false, targetDate);
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
      />
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
