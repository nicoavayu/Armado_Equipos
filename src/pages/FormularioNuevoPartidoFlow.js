import logger from '../utils/logger';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  MapPin,
  Megaphone,
  Pencil,
  Repeat2,
  Trophy,
  Type as TypeIcon,
  UserPlus,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { friendlyError } from '../utils/friendlyError';
import { useAuth } from '../components/AuthProvider';
import VenuePicker from '../components/VenuePicker';
import { crearPartido, supabase } from '../supabase';
import { insertPartidoFrecuenteFromPartido } from '../services/db/frequentMatches';
import { formatLocalDateShort } from '../utils/dateLocal';
import { addDaysToYmd, todayYmdLocal } from '../utils/frequentTemplateDate';
import { useScrollResetOnChange } from '../hooks/useScrollReset';
import {
  normalizeTimeHHmm,
  isBlockedInDebug,
  isAllowedMatchTime,
  MATCH_TIME_RANGE_MESSAGE,
} from '../lib/matchDateDebug';
import { buildMatchLocationFields } from '../utils/matchLocation';
import { notifyBlockingError } from '../utils/notifyBlockingError';
import InlineNotice from '../components/ui/InlineNotice';
import useInlineNotice from '../hooks/useInlineNotice';
import { PRIMARY_CTA_BUTTON_CLASS } from '../styles/buttonClasses';

export const NEW_MATCH_STEPS = {
  NAME: 1,
  TYPE: 2,
  WHEN: 3,
  WHERE: 4,
  CAPACITY: 5,
  CONFIRM: 6,
};

export const MODALIDAD_CUPOS = {
  F5: 10,
  F6: 12,
  F7: 14,
  F8: 16,
  F9: 18,
  F11: 22,
};

const TOTAL_STEPS = Object.keys(NEW_MATCH_STEPS).length;
const TRANSITION_DURATION_MS = 260;
const MATCH_NAME_REQUIRED_MESSAGE = 'Poné un nombre para el partido.';
const FORM_ERROR_CLASS = 'w-full rounded-xl border border-[#fbbf24]/70 bg-[#f59e0b]/15 px-3 py-2 text-sm text-[#fff7ed]';
const PRIMARY_ACTION_BUTTON_CLASS = `${PRIMARY_CTA_BUTTON_CLASS} !min-h-[48px] !rounded-2xl !font-bebas !text-[17px] !tracking-[0.035em]`;
const INPUT_CLASS = 'h-[50px] w-full rounded-2xl border border-[rgba(148,134,255,0.34)] bg-[rgba(13,10,30,0.78)] px-4 font-oswald text-[17px] text-white outline-none backdrop-blur-md transition-all placeholder:text-white/32 focus:border-[#8b7cff] focus:bg-[rgba(22,17,48,0.94)] focus:ring-2 focus:ring-[#6a43ff]/25';
const CARD_CLASS = 'rounded-card border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(160deg,rgba(42,32,89,0.72),rgba(13,10,30,0.92))] shadow-[0_18px_50px_rgba(4,2,16,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md';
const TIME_HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const TIME_MINUTES = ['00', '15', '30', '45'];
const TIME_PERIODS = ['AM', 'PM'];

const isQuarterHourTime = (timeValue) => {
  const normalized = normalizeTimeHHmm(timeValue);
  if (!normalized) return false;
  const minutes = Number(normalized.split(':')[1]);
  return [0, 15, 30, 45].includes(minutes);
};

const formatPrice = (value) => {
  const normalized = String(value ?? '').replace(/[^0-9.,-]/g, '').replace(/,/g, '.');
  const numberValue = normalized === '' ? NaN : Number(normalized);
  if (!Number.isFinite(numberValue)) return 'Sin precio';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(numberValue);
};

const parseYmdLocal = (ymd) => {
  const normalized = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatWizardDateDisplay = ({ fecha, today, tomorrow }) => {
  const parsed = parseYmdLocal(fecha);
  if (!parsed) return 'ELEGÍ UN DÍA';

  const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'long' })
    .format(parsed)
    .toLocaleUpperCase('es-AR');

  if (fecha === today || fecha === tomorrow) return weekday;

  const day = new Intl.DateTimeFormat('es-AR', { day: 'numeric' }).format(parsed);
  const month = new Intl.DateTimeFormat('es-AR', { month: 'short' })
    .format(parsed)
    .replace('.', '')
    .toLocaleUpperCase('es-AR');
  return `${weekday} ${day} ${month}`;
};

export const toTwelveHourParts = (timeValue) => {
  const normalized = normalizeTimeHHmm(timeValue);
  if (!normalized) return { hour: '', minute: '', period: '' };
  const [rawHour, minute] = normalized.split(':');
  const hour24 = Number(rawHour);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour = String(hour24 % 12 || 12);
  return { hour, minute, period };
};

export const toTwentyFourHourTime = ({ hour, minute, period }) => {
  if (!TIME_HOURS.includes(String(hour)) || !TIME_MINUTES.includes(minute) || !TIME_PERIODS.includes(period)) {
    return '';
  }
  const hour12 = Number(hour);
  const hour24 = period === 'AM'
    ? hour12 % 12
    : (hour12 % 12) + 12;
  return `${String(hour24).padStart(2, '0')}:${minute}`;
};

const formatTwelveHourTime = (timeValue) => {
  const parts = toTwelveHourParts(timeValue);
  if (!parts.hour) return 'Sin hora';
  return `${parts.hour}:${parts.minute} ${parts.period}`;
};

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const WizardBackground = () => (
  <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.24),transparent_48%),radial-gradient(circle_at_8%_54%,rgba(73,43,171,0.16),transparent_32%),radial-gradient(circle_at_96%_82%,rgba(236,0,125,0.09),transparent_30%),linear-gradient(180deg,#0c091b_0%,#100b26_48%,#090715_100%)]" />
    <div className="absolute left-1/2 top-[29%] h-[330px] w-[720px] -translate-x-1/2 rounded-[50%] border border-[#7d5aff]/10 shadow-[0_0_90px_rgba(106,67,255,0.11)]" />
    <div className="absolute left-1/2 top-[35%] h-[230px] w-[560px] -translate-x-1/2 rounded-[50%] border border-white/[0.035]" />
    <div className="absolute inset-0 opacity-[0.055] [background-image:linear-gradient(rgba(255,255,255,.25)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.25)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,transparent,black_26%,black_72%,transparent)]" />
  </div>
);

const WizardHeader = ({ step, onBack, isEditing }) => (
  <header
    className="relative z-40 border-b border-[rgba(148,134,255,0.14)] bg-[#0d0a1f]/92 px-[max(16px,var(--safe-left,0px))] py-2.5 backdrop-blur-xl"
    data-testid="wizard-header"
  >
    <div className="mx-auto w-full max-w-[560px]">
      <div className="relative flex min-h-[40px] items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] text-white transition-all hover:bg-white/10 active:scale-95"
          aria-label={isEditing
            ? 'Volver a revisión'
            : step === NEW_MATCH_STEPS.NAME
              ? 'Cerrar nuevo partido'
              : 'Volver al paso anterior'}
        >
          <ArrowLeft size={20} strokeWidth={2.2} />
        </button>
        <h1 className="absolute inset-x-12 m-0 text-center font-oswald text-[15px] font-semibold uppercase tracking-[0.14em] text-white/90">
          Nuevo partido
        </h1>
        <span className="relative z-10 h-10 w-10" aria-hidden="true" />
      </div>
    </div>
  </header>
);

const WizardStepper = ({ step }) => (
  <div
    className="relative z-20 mx-auto w-full max-w-[560px] px-[max(22px,var(--safe-left,0px))] pb-1 pt-3"
    data-testid="wizard-stepper"
    aria-label={`Paso ${step} de ${TOTAL_STEPS}`}
  >
    <div className="flex items-center px-1">
      {Array.from({ length: TOTAL_STEPS }, (_, index) => {
        const stepNumber = index + 1;
        const isComplete = stepNumber < step;
        const isCurrent = stepNumber === step;
        return (
          <React.Fragment key={stepNumber}>
            {index > 0 ? (
              <span
                className={`h-px flex-1 transition-colors duration-200 ${stepNumber <= step ? 'bg-[#7d5aff]' : 'bg-white/15'}`}
                aria-hidden="true"
              />
            ) : null}
            <span
              className={`relative h-2 w-2 flex-none rounded-full border transition-all duration-200 ${
                isCurrent
                  ? 'scale-125 border-[#b9a5ff] bg-[#7d5aff] shadow-[0_0_14px_rgba(125,90,255,0.88)]'
                  : isComplete
                    ? 'border-[#7d5aff] bg-[#7d5aff]'
                    : 'border-white/25 bg-[#0d0a1f]'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            />
          </React.Fragment>
        );
      })}
    </div>
  </div>
);

const StepHeading = ({ children, kicker }) => (
  <div className="new-match-step-heading mb-4 text-center sm:mb-5" data-build="heading">
    {kicker ? (
      <div className="mb-1.5 font-oswald text-[10px] font-semibold uppercase tracking-[0.22em] text-[#a98cff]">
        {kicker}
      </div>
    ) : null}
    <h2 className="m-0 whitespace-pre-line font-bebas-real text-[clamp(34px,10.5vw,50px)] leading-[0.9] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
      {children}
    </h2>
  </div>
);

const OptionCard = ({ active, icon, label, sublabel, onClick, ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    aria-label={ariaLabel || label}
    className={`relative flex min-h-[72px] flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border px-2 py-2.5 text-center transition-all duration-200 active:scale-[0.98] ${
      active
        ? 'border-[#8b5cff] bg-[linear-gradient(145deg,rgba(112,48,255,0.68),rgba(57,24,132,0.82))] text-white shadow-[0_0_0_1px_rgba(173,134,255,0.25),0_10px_30px_rgba(92,42,221,0.42),inset_0_1px_0_rgba(255,255,255,0.18)]'
        : 'border-[rgba(148,134,255,0.2)] bg-[rgba(14,11,32,0.72)] text-white/72 hover:border-[rgba(148,134,255,0.42)] hover:bg-white/[0.06]'
    }`}
  >
    {active ? <span className="absolute inset-x-3 top-0 h-px bg-white/45" aria-hidden="true" /> : null}
    {icon ? React.cloneElement(icon, { size: 19, strokeWidth: 1.8 }) : null}
    <span className="font-bebas-real text-[20px] leading-none tracking-[0.045em]">{label}</span>
    {sublabel ? <span className="font-oswald text-[11px] leading-tight text-white/58">{sublabel}</span> : null}
  </button>
);

const ToggleCard = ({ id, checked, icon, title, description, onChange }) => (
  <label
    htmlFor={id}
    className={`flex min-h-[62px] cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition-all ${
      checked
        ? 'border-[#8b5cff]/75 bg-[#6a43ff]/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
        : 'border-[rgba(148,134,255,0.18)] bg-white/[0.035]'
    }`}
  >
    <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${
      checked ? 'bg-[#6a43ff]/35 text-[#c8baff]' : 'bg-white/[0.05] text-white/45'
    }`}>
      {React.cloneElement(icon, { size: 18, strokeWidth: 1.9 })}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block font-oswald text-[14px] font-semibold leading-tight text-white">{title}</span>
      <span className="mt-0.5 block font-oswald text-[11px] leading-tight text-white/48">{description}</span>
    </span>
    <span className={`relative h-6 w-11 flex-none rounded-full border transition-colors ${
      checked ? 'border-[#9b7bff] bg-[#6a43ff]' : 'border-white/15 bg-white/10'
    }`}>
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[21px]' : 'translate-x-[2px]'
      }`} />
    </span>
  </label>
);

const ReviewRow = ({ icon, label, value, onEdit, editLabel }) => (
  <button
    type="button"
    onClick={onEdit}
    className="group flex w-full items-center gap-3 border-b border-white/[0.075] px-4 py-3.5 text-left last:border-b-0 hover:bg-white/[0.035]"
    aria-label={editLabel}
  >
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[#8b7cff]/20 bg-[#6a43ff]/10 text-[#ae94ff]">
      {React.cloneElement(icon, { size: 18, strokeWidth: 1.9 })}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block font-oswald text-[10px] font-semibold uppercase tracking-[0.12em] text-white/42">{label}</span>
      <span className="mt-0.5 block truncate font-oswald text-[15px] font-medium text-white/92">{value}</span>
    </span>
    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/48 transition-colors group-hover:border-[#8b7cff]/35 group-hover:text-[#ae94ff]">
      <Pencil size={14} strokeWidth={2} />
    </span>
  </button>
);

export default function FormularioNuevoPartidoFlow({ onConfirmar, onVolver }) {
  const { user, profile } = useAuth();
  const dateInputRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const submitInFlightRef = useRef(false);
  const { notice, showInlineNotice, clearInlineNotice } = useInlineNotice();

  const [step, setStep] = useState(NEW_MATCH_STEPS.NAME);
  const [direction, setDirection] = useState(0);
  const [previousStep, setPreviousStep] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [nombrePartido, setNombrePartido] = useState('');
  const [modalidad, setModalidad] = useState('F5');
  const [tipoPartido, setTipoPartido] = useState('Masculino');
  const [fecha, setFecha] = useState('');
  const [dateMode, setDateMode] = useState('');
  const [hora, setHora] = useState('');
  const [timeParts, setTimeParts] = useState({ hour: '', minute: '', period: '' });
  const [sede, setSede] = useState('');
  const [sedeInfo, setSedeInfo] = useState(null);
  const [valorCancha, setValorCancha] = useState('');
  const [willPlay, setWillPlay] = useState(true);
  const [openCall, setOpenCall] = useState(false);
  const [playerInvitesEnabled, setPlayerInvitesEnabled] = useState(false);
  const [saveAsFrequent, setSaveAsFrequent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useScrollResetOnChange(step);

  const finishTransition = useCallback(() => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    setPreviousStep(null);
    setIsTransitioning(false);
  }, []);

  useEffect(() => () => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
  }, []);

  const trimmedNombrePartido = nombrePartido.trim();
  const isMatchNameValid = Boolean(trimmedNombrePartido);
  const suggestedCupo = MODALIDAD_CUPOS[modalidad] ?? MODALIDAD_CUPOS.F5;
  const today = todayYmdLocal();
  const tomorrow = addDaysToYmd(today, 1);

  const parsedCanchaPrice = useMemo(() => {
    const precioRaw = String(valorCancha ?? '').trim();
    const precioClean = precioRaw.replace(/[^0-9.,-]/g, '').replace(/,/g, '.');
    const precioNum = precioClean === '' ? NaN : Number(precioClean);
    return Number.isFinite(precioNum) ? precioNum : null;
  }, [valorCancha]);

  const goToStep = (targetStep, nextDirection) => {
    if (isTransitioning) return;
    const normalizedTarget = Math.min(
      Math.max(targetStep, NEW_MATCH_STEPS.NAME),
      NEW_MATCH_STEPS.CONFIRM,
    );
    if (normalizedTarget === step) return;

    setDirection(nextDirection);
    setError('');
    clearInlineNotice();

    if (prefersReducedMotion()) {
      setStep(normalizedTarget);
      setPreviousStep(null);
      setIsTransitioning(false);
      return;
    }

    setPreviousStep(step);
    setStep(normalizedTarget);
    setIsTransitioning(true);
    transitionTimerRef.current = window.setTimeout(finishTransition, TRANSITION_DURATION_MS + 60);
  };

  const editField = (targetStep) => {
    setEditMode(true);
    goToStep(targetStep, -1);
  };

  const returnToReview = () => {
    setEditMode(false);
    goToStep(NEW_MATCH_STEPS.CONFIRM, 1);
  };

  const handleBack = () => {
    if (editMode) {
      returnToReview();
      return;
    }
    if (step === NEW_MATCH_STEPS.NAME) {
      onVolver();
      return;
    }
    goToStep(step - 1, -1);
  };

  const validateWhenStep = () => {
    if (!fecha || !hora) return false;
    if (!normalizeTimeHHmm(hora)) {
      showInlineNotice({
        key: 'new_match_invalid_time',
        type: 'warning',
        message: 'Se requiere una hora válida.',
      });
      return false;
    }
    if (!isQuarterHourTime(hora)) {
      showInlineNotice({
        key: 'new_match_invalid_time_step',
        type: 'warning',
        message: 'Elegí un horario en intervalos de 15 minutos.',
      });
      return false;
    }
    if (!isAllowedMatchTime(hora)) {
      showInlineNotice({
        key: 'new_match_time_out_of_range',
        type: 'warning',
        message: MATCH_TIME_RANGE_MESSAGE,
      });
      return false;
    }
    if (isBlockedInDebug(fecha, hora)) {
      notifyBlockingError(
        'La fecha y hora elegidas ya pasaron. Elegí un día y horario posteriores al momento actual para crear el partido.',
        {
          title: 'Fecha y hora inválidas',
          confirmText: 'Aceptar',
          key: 'new_match_past_datetime_modal',
          screen: 'new_match_flow',
          action: 'validate_datetime',
        },
      );
      return false;
    }
    return true;
  };

  const canAdvance = (() => {
    if (step === NEW_MATCH_STEPS.NAME) return isMatchNameValid;
    if (step === NEW_MATCH_STEPS.WHEN) return Boolean(fecha && hora);
    if (step === NEW_MATCH_STEPS.WHERE) return Boolean(sede.trim());
    return true;
  })();

  const handleNext = () => {
    if (step === NEW_MATCH_STEPS.NAME && !isMatchNameValid) {
      setError(MATCH_NAME_REQUIRED_MESSAGE);
      return;
    }
    if (step === NEW_MATCH_STEPS.WHEN && !validateWhenStep()) return;
    if (step === NEW_MATCH_STEPS.WHERE && !sede.trim()) return;

    if (editMode) {
      returnToReview();
      return;
    }
    goToStep(step + 1, 1);
  };

  const handleDatePreset = (mode) => {
    setDateMode(mode);
    if (mode === 'today') setFecha(today);
    if (mode === 'tomorrow') setFecha(tomorrow);
    if (mode === 'custom') {
      window.requestAnimationFrame?.(() => {
        if (typeof dateInputRef.current?.showPicker === 'function') {
          dateInputRef.current.showPicker();
        } else {
          dateInputRef.current?.focus();
        }
      });
    }
  };

  const handleTimePartChange = (part, value) => {
    const nextParts = { ...timeParts, [part]: value };
    setTimeParts(nextParts);
    setHora(toTwentyFourHourTime(nextParts));
  };

  const handleSubmit = async () => {
    if (submitInFlightRef.current || loading) return;
    if (!isMatchNameValid) {
      setError(MATCH_NAME_REQUIRED_MESSAGE);
      showInlineNotice({
        key: 'new_match_missing_name',
        type: 'warning',
        message: MATCH_NAME_REQUIRED_MESSAGE,
      });
      goToStep(NEW_MATCH_STEPS.NAME, -1);
      return;
    }

    submitInFlightRef.current = true;
    setLoading(true);
    setError('');
    const shouldSaveFrequent = saveAsFrequent === true;

    try {
      const precioVal = Number.isFinite(parsedCanchaPrice) && parsedCanchaPrice > 0
        ? parsedCanchaPrice
        : null;
      const match_ref = uuidv4();
      const payload = {
        match_ref,
        nombre: trimmedNombrePartido,
        fecha,
        hora: hora.trim(),
        ...buildMatchLocationFields({
          locationText: sede,
          locationInfo: sedeInfo,
        }),
        modalidad,
        cupo_jugadores: Number(suggestedCupo),
        falta_jugadores: openCall,
        player_invites_enabled: playerInvitesEnabled,
        tipo_partido: tipoPartido,
        creado_por: user?.id,
        precio_cancha_por_persona: precioVal,
      };

      const partido = await crearPartido(payload);
      if (!partido) {
        setError('No se pudo crear el partido');
        return;
      }

      if (willPlay === true && user?.id && partido?.id) {
        try {
          const { data: existingPlayer, error: existingError } = await supabase
            .from('jugadores')
            .select('id')
            .eq('partido_id', partido.id)
            .eq('usuario_id', user.id)
            .maybeSingle();

          const alreadyExists = !existingError && Boolean(existingPlayer);
          if (!alreadyExists) {
            const { data: usuarioData } = await supabase
              .from('usuarios')
              .select('nombre, avatar_url')
              .eq('id', user.id)
              .maybeSingle();

            const nombre = profile?.nombre || usuarioData?.nombre || user?.email?.split('@')[0] || 'Creador';
            const avatarUrl = profile?.avatar_url || usuarioData?.avatar_url || null;
            const jugadorRow = {
              partido_id: partido.id,
              match_ref: partido.match_ref,
              usuario_id: user.id,
              nombre,
              avatar_url: avatarUrl,
              is_goalkeeper: false,
              score: 5,
            };

            const { error: insertError } = await supabase
              .from('jugadores')
              .insert([jugadorRow]);

            if (insertError) {
              logger.error('[CREAR_PARTIDO] Error insert jugador creador:', insertError);
              notifyBlockingError(friendlyError(insertError, 'No te pudimos agregar como jugador. Intentá de nuevo.'));
            }
          }
        } catch (err) {
          logger.error('[CREAR_PARTIDO] Error checking/adding creator:', err);
        }
      }

      if (shouldSaveFrequent) {
        try {
          await insertPartidoFrecuenteFromPartido(partido?.match_ref ?? partido?.id);
          showInlineNotice({
            key: 'new_match_template_saved',
            type: 'success',
            message: 'Plantilla guardada.',
          });
        } catch (err) {
          logger.error('[Guardar frecuente] error inserting frequent template:', err);
          showInlineNotice({
            key: 'new_match_template_save_failed',
            type: 'warning',
            message: 'Partido creado, pero no se pudo guardar como frecuente.',
          });
        }
      }

      await onConfirmar(partido);
    } catch (err) {
      setError(err.message || 'Error al procesar la solicitud');
    } finally {
      submitInFlightRef.current = false;
      setLoading(false);
      setSaveAsFrequent(false);
    }
  };

  const selectedDateLabel = !fecha
    ? 'Sin fecha'
    : fecha === today
      ? `Hoy, ${formatTwelveHourTime(hora)}`
      : fecha === tomorrow
        ? `Mañana, ${formatTwelveHourTime(hora)}`
        : `${formatLocalDateShort(fecha)}, ${formatTwelveHourTime(hora)}`;
  const selectedDateDisplay = formatWizardDateDisplay({ fecha, today, tomorrow });

  const renderStep = (stepNumber, { active = true } = {}) => {
    if (stepNumber === NEW_MATCH_STEPS.NAME) {
      return (
        <section
          className="new-match-name-step"
          data-testid="wizard-step-1"
          aria-labelledby="new-match-name-title"
        >
          <StepHeading>PONÉ NOMBRE{'\n'}AL PARTIDO</StepHeading>
          <div className="mx-auto max-w-[460px]" data-build="content">
            <label htmlFor="new-match-name" className="sr-only">Nombre del partido</label>
            <div className="relative">
              <TypeIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9d82ff]" size={20} />
              <input
                id="new-match-name"
                className={`${INPUT_CLASS} pl-12`}
                type="text"
                placeholder="Ej: Fútbol viernes"
                value={nombrePartido}
                onChange={(event) => {
                  setNombrePartido(event.target.value);
                  if (event.target.value.trim()) setError('');
                }}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={active && direction === 0}
              />
            </div>
            {error ? <div role="alert" className={`${FORM_ERROR_CLASS} mt-3`}>{error}</div> : null}
          </div>
        </section>
      );
    }

    if (stepNumber === NEW_MATCH_STEPS.TYPE) {
      return (
        <section data-testid="wizard-step-2">
          <StepHeading>ELEGÍ EL TIPO{'\n'}DE PARTIDO</StepHeading>
          <div className="mx-auto max-w-[480px]" data-build="content">
            <div data-testid="match-format-block">
              <div className="mb-1.5 font-oswald text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">
                Formato
              </div>
              <div className="grid grid-cols-3 gap-2.5" aria-label="Formato del partido">
                {Object.keys(MODALIDAD_CUPOS).map((format) => (
                  <OptionCard
                    key={format}
                    active={modalidad === format}
                    icon={<Trophy />}
                    label={format}
                    onClick={() => setModalidad(format)}
                    ariaLabel={`Formato ${format}`}
                  />
                ))}
              </div>
            </div>
            <div
              className="mt-3 border-t border-[#a98cff]/20 pt-3"
              data-build="secondary"
              data-testid="match-type-block"
            >
              <div className="mb-1.5 font-oswald text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">
                Tipo de partido
              </div>
              <div className="grid grid-cols-3 gap-2" aria-label="Tipo de partido">
                {['Masculino', 'Femenino', 'Mixto'].map((type) => (
                  <OptionCard
                    key={type}
                    active={tipoPartido === type}
                    icon={type === 'Mixto' ? <UsersRound /> : <UserRound />}
                    label={type}
                    onClick={() => setTipoPartido(type)}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 text-center font-oswald text-[13px] text-white/58" aria-live="polite" data-build="secondary">
              Cupo máximo: <span className="font-semibold text-white">{suggestedCupo} jugadores</span>
            </div>
          </div>
        </section>
      );
    }

    if (stepNumber === NEW_MATCH_STEPS.WHEN) {
      return (
        <section data-testid="wizard-step-3">
          <StepHeading>¿CUÁNDO{'\n'}SE JUEGA?</StepHeading>
          <div className="mx-auto max-w-[480px]" data-build="content">
            <div className="grid grid-cols-3 gap-2" aria-label="Fecha del partido">
              <OptionCard
                active={dateMode === 'today' || (!dateMode && fecha === today)}
                label="Hoy"
                onClick={() => handleDatePreset('today')}
              />
              <OptionCard
                active={dateMode === 'tomorrow' || (!dateMode && fecha === tomorrow)}
                label="Mañana"
                onClick={() => handleDatePreset('tomorrow')}
              />
              <OptionCard
                active={dateMode === 'custom'}
                label="Elegir fecha"
                onClick={() => handleDatePreset('custom')}
              />
            </div>

            <div
              className={`${CARD_CLASS} relative mt-3 overflow-hidden px-4 py-3 text-center`}
              data-build="secondary"
              aria-live="polite"
            >
              <div className="font-oswald text-[9px] font-semibold uppercase tracking-[0.2em] text-white/42">
                Fecha elegida
              </div>
              <div
                className="mt-0.5 font-bebas-real text-[clamp(29px,8vw,40px)] leading-none tracking-[0.045em] text-white"
                data-testid="selected-date-display"
              >
                {selectedDateDisplay}
              </div>
              {dateMode === 'custom' ? (
                <input
                  ref={dateInputRef}
                  id="new-match-date"
                  aria-label="Fecha personalizada"
                  className="mx-auto mt-2 block h-8 max-w-[190px] rounded-lg border border-[#8b7cff]/35 bg-[#161130] px-2 text-center font-oswald text-[13px] text-white outline-none [color-scheme:dark] focus:border-[#8b7cff]"
                  type="date"
                  min={today}
                  value={fecha}
                  onChange={(event) => setFecha(event.target.value)}
                />
              ) : null}
            </div>

            <div className={`${CARD_CLASS} mt-3 px-3 py-3`} data-build="secondary">
              <div className="mb-2 flex items-center justify-center gap-1.5 font-oswald text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">
                <Clock3 size={14} className="text-[#9d82ff]" />
                Hora del partido
              </div>
              <div className="grid grid-cols-[1fr_0.9fr_0.9fr] items-center gap-2">
                <label className="sr-only" htmlFor="new-match-hour">Hora</label>
                <select
                  id="new-match-hour"
                  aria-label="Hora"
                  className="h-[52px] appearance-none rounded-xl border border-[#8b7cff]/35 bg-[#161130] [&>option]:bg-[#161130] [&>option]:text-white px-2 text-center font-bebas-real text-[28px] text-white outline-none [color-scheme:dark] focus:border-[#8b7cff]"
                  value={timeParts.hour}
                  onChange={(event) => handleTimePartChange('hour', event.target.value)}
                >
                  <option value="">--</option>
                  {TIME_HOURS.map((hourOption) => (
                    <option key={hourOption} value={hourOption}>{hourOption}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="new-match-minute">Minutos</label>
                <select
                  id="new-match-minute"
                  aria-label="Minutos"
                  className="h-[52px] appearance-none rounded-xl border border-[#8b7cff]/35 bg-[#161130] [&>option]:bg-[#161130] [&>option]:text-white px-2 text-center font-bebas-real text-[28px] text-white outline-none [color-scheme:dark] focus:border-[#8b7cff]"
                  value={timeParts.minute}
                  onChange={(event) => handleTimePartChange('minute', event.target.value)}
                >
                  <option value="">--</option>
                  {TIME_MINUTES.map((minuteOption) => (
                    <option key={minuteOption} value={minuteOption}>{minuteOption}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="new-match-period">AM o PM</label>
                <select
                  id="new-match-period"
                  aria-label="AM o PM"
                  className="h-[52px] appearance-none rounded-xl border border-[#8b7cff]/35 bg-[#161130] [&>option]:bg-[#161130] [&>option]:text-white px-2 text-center font-bebas-real text-[24px] text-[#c8baff] outline-none [color-scheme:dark] focus:border-[#8b7cff]"
                  value={timeParts.period}
                  onChange={(event) => handleTimePartChange('period', event.target.value)}
                >
                  <option value="">--</option>
                  {TIME_PERIODS.map((periodOption) => (
                    <option key={periodOption} value={periodOption}>{periodOption}</option>
                  ))}
                </select>
              </div>
              <div className="sr-only" aria-live="polite">
                {hora ? `Hora del partido: ${formatTwelveHourTime(hora)}` : 'Hora del partido sin elegir'}
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (stepNumber === NEW_MATCH_STEPS.WHERE) {
      return (
        <section data-testid="wizard-step-4">
          <StepHeading>¿DÓNDE{'\n'}SE JUEGA?</StepHeading>
          <div className="mx-auto max-w-[480px] overflow-visible" data-build="content">
            <div className={`${CARD_CLASS} relative z-20 overflow-visible p-3.5`} data-testid="venue-card">
              <div className="mb-2 flex items-center gap-2 font-oswald text-[11px] font-semibold uppercase tracking-[0.14em] text-white/48">
                <MapPin size={16} className="text-[#9d82ff]" />
                Cancha, sede o dirección
              </div>
              <VenuePicker
                value={sede}
                info={sedeInfo}
                onChange={(nextValue) => {
                  setSede(nextValue);
                  setSedeInfo((currentInfo) => {
                    if (!nextValue.trim()) return null;
                    const currentDescription = String(currentInfo?.description || '').trim();
                    return currentDescription && currentDescription === nextValue.trim()
                      ? currentInfo
                      : null;
                  });
                }}
                onSelect={(info) => {
                  setSede(info.description);
                  setSedeInfo(info);
                }}
                onClear={() => {
                  setSede('');
                  setSedeInfo(null);
                }}
              />
            </div>

            <div className={`${CARD_CLASS} relative z-10 mt-5 p-3.5`} data-build="secondary" data-testid="price-card">
              <label htmlFor="new-match-price" className="mb-2 flex items-center gap-2 font-oswald text-[11px] font-semibold uppercase tracking-[0.14em] text-white/48">
                <CircleDollarSign size={16} className="text-[#9d82ff]" />
                Valor por persona <span className="normal-case tracking-normal text-white/30">(opcional)</span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-oswald text-[20px] text-white/45">$</span>
                <input
                  id="new-match-price"
                  className={`${INPUT_CLASS} pl-9`}
                  type="number"
                  inputMode="decimal"
                  placeholder="Ej: 3000"
                  value={valorCancha}
                  onChange={(event) => setValorCancha(event.target.value)}
                  min="0"
                />
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (stepNumber === NEW_MATCH_STEPS.CAPACITY) {
      return (
        <section data-testid="wizard-step-5">
          <StepHeading>¿CUÁNTOS{'\n'}JUEGAN?</StepHeading>
          <div className="mx-auto max-w-[480px]" data-build="content">
            <div className={`${CARD_CLASS} relative overflow-hidden px-5 py-3.5 text-center`}>
              <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-[#a98cff]/75 to-transparent" />
              <div className="font-bebas-real text-[60px] leading-[0.85] tracking-[0.02em] text-[#9a72ff] drop-shadow-[0_0_24px_rgba(122,82,255,0.42)]">
                {suggestedCupo}
              </div>
              <div className="font-oswald text-[14px] italic text-white/78">jugadores</div>
              <div className="mt-1.5 inline-flex items-center rounded-full border border-[#8b7cff]/20 bg-[#6a43ff]/10 px-3 py-0.5 font-oswald text-[11px] text-[#c8baff]">
                Cupo automático para {modalidad}
              </div>
            </div>

            <div className="mt-3" data-build="secondary">
              <div className="mb-1.5 font-oswald text-[10px] font-semibold uppercase tracking-[0.14em] text-white/48">
                ¿Vos jugás este partido?
              </div>
              <div className="grid grid-cols-2 gap-2">
                <OptionCard
                  active={willPlay}
                  label="Sí, juego"
                  sublabel="Me suma al plantel"
                  onClick={() => setWillPlay(true)}
                />
                <OptionCard
                  active={!willPlay}
                  label="Solo admin"
                  sublabel="No me suma"
                  onClick={() => setWillPlay(false)}
                />
              </div>
            </div>

            <div className="mt-3 grid gap-2" data-build="secondary">
              <ToggleCard
                id="open-call"
                checked={openCall}
                icon={<Megaphone />}
                title="Abrir convocatoria"
                description="Cualquiera puede pedir sumarse"
                onChange={setOpenCall}
              />
              <ToggleCard
                id="player-invites-enabled"
                checked={playerInvitesEnabled}
                icon={<UserPlus />}
                title="Permitir que jugadores inviten"
                description="Los jugadores confirmados pueden invitar usuarios registrados"
                onChange={setPlayerInvitesEnabled}
              />
            </div>
          </div>
        </section>
      );
    }

    return (
      <section data-testid="wizard-step-6">
        <StepHeading kicker="Último paso">REVISÁ{'\n'}EL PARTIDO</StepHeading>
        <div className="mx-auto max-w-[500px]" data-build="content">
          <div className={`${CARD_CLASS} overflow-hidden`}>
            <ReviewRow
              icon={<TypeIcon />}
              label="Nombre"
              value={trimmedNombrePartido}
              onEdit={() => editField(NEW_MATCH_STEPS.NAME)}
              editLabel="Editar nombre"
            />
            <ReviewRow
              icon={<Trophy />}
              label="Formato y tipo"
              value={`${modalidad} · ${tipoPartido}`}
              onEdit={() => editField(NEW_MATCH_STEPS.TYPE)}
              editLabel="Editar formato y tipo"
            />
            <ReviewRow
              icon={<CalendarDays />}
              label="Fecha y hora"
              value={selectedDateLabel}
              onEdit={() => editField(NEW_MATCH_STEPS.WHEN)}
              editLabel="Editar fecha y hora"
            />
            <ReviewRow
              icon={<MapPin />}
              label="Lugar"
              value={sede}
              onEdit={() => editField(NEW_MATCH_STEPS.WHERE)}
              editLabel="Editar lugar"
            />
            <ReviewRow
              icon={<UsersRound />}
              label="Cupo"
              value={`${suggestedCupo} jugadores`}
              onEdit={() => editField(NEW_MATCH_STEPS.CAPACITY)}
              editLabel="Editar cupo"
            />
            <ReviewRow
              icon={<UserRound />}
              label="Tu participación"
              value={willPlay ? 'Sí, como jugador' : 'Solo administro'}
              onEdit={() => editField(NEW_MATCH_STEPS.CAPACITY)}
              editLabel="Editar participación"
            />
            <ReviewRow
              icon={<Megaphone />}
              label="Abrir convocatoria"
              value={openCall ? 'Activada' : 'Desactivada'}
              onEdit={() => editField(NEW_MATCH_STEPS.CAPACITY)}
              editLabel="Editar convocatoria"
            />
            <ReviewRow
              icon={<UserPlus />}
              label="Permitir que jugadores inviten"
              value={playerInvitesEnabled ? 'Activada' : 'Desactivada'}
              onEdit={() => editField(NEW_MATCH_STEPS.CAPACITY)}
              editLabel="Editar invitaciones de jugadores"
            />
            <ReviewRow
              icon={<CircleDollarSign />}
              label="Valor por persona"
              value={formatPrice(valorCancha)}
              onEdit={() => editField(NEW_MATCH_STEPS.WHERE)}
              editLabel="Editar valor por persona"
            />
          </div>

          <label className={`${CARD_CLASS} mt-4 flex cursor-pointer items-center gap-3 p-4`} htmlFor="save-frequent">
            <span className={`relative h-7 w-[52px] flex-none rounded-full border transition-colors ${
              saveAsFrequent
                ? 'border-[#9b7bff] bg-[#6a43ff] shadow-[0_0_18px_rgba(106,67,255,0.35)]'
                : 'border-white/15 bg-white/10'
            }`}>
              <input
                id="save-frequent"
                type="checkbox"
                className="peer sr-only"
                checked={saveAsFrequent}
                disabled={loading}
                onChange={(event) => setSaveAsFrequent(event.target.checked)}
              />
              <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                saveAsFrequent ? 'translate-x-[27px]' : 'translate-x-[3px]'
              }`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-oswald text-[15px] font-semibold text-white">
                <Repeat2 size={17} className="text-[#a98cff]" />
                Guardar como partido frecuente
              </span>
              <span className="mt-0.5 block font-oswald text-[12px] leading-snug text-white/48">
                Guarda lugar, hora y precio para reutilizarlo.
              </span>
            </span>
            {saveAsFrequent ? <Check size={19} className="flex-none text-[#bba8ff]" /> : null}
          </label>
        </div>
      </section>
    );
  };

  const directionName = direction > 0 ? 'forward' : direction < 0 ? 'backward' : 'none';
  const incomingTransitionClass = isTransitioning
    ? direction > 0
      ? 'wizard-step-enter-forward'
      : 'wizard-step-enter-backward'
    : '';
  const outgoingTransitionClass = direction > 0
    ? 'wizard-step-exit-forward'
    : 'wizard-step-exit-backward';

  return (
    <div className="relative flex h-[calc(100dvh-var(--safe-top,0px))] w-full flex-col overflow-hidden text-white">
      <style>{`
        @keyframes wizard-step-enter-forward {
          from {
            opacity: 0;
            transform: translate3d(24px, 0, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        @keyframes wizard-step-enter-backward {
          from {
            opacity: 0;
            transform: translate3d(-24px, 0, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        @keyframes wizard-step-exit-forward {
          from {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
          to {
            opacity: 0;
            transform: translate3d(-24px, 0, 0);
          }
        }

        @keyframes wizard-step-exit-backward {
          from {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
          to {
            opacity: 0;
            transform: translate3d(24px, 0, 0);
          }
        }

        @keyframes wizard-step-build {
          from {
            opacity: 0;
            transform: translate3d(0, 7px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        .wizard-step-enter-forward,
        .wizard-step-enter-backward,
        .wizard-step-exit-forward,
        .wizard-step-exit-backward {
          animation-duration: ${TRANSITION_DURATION_MS}ms;
          animation-fill-mode: both;
          animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform, opacity;
        }

        .wizard-step-enter-forward {
          animation-name: wizard-step-enter-forward;
          pointer-events: none;
        }

        .wizard-step-enter-backward {
          animation-name: wizard-step-enter-backward;
          pointer-events: none;
        }

        .wizard-step-exit-forward {
          animation-name: wizard-step-exit-forward;
          pointer-events: none;
        }

        .wizard-step-exit-backward {
          animation-name: wizard-step-exit-backward;
          pointer-events: none;
        }

        .wizard-step-enter-forward [data-build],
        .wizard-step-enter-backward [data-build] {
          animation: wizard-step-build 190ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .wizard-step-enter-forward [data-build="content"],
        .wizard-step-enter-backward [data-build="content"] {
          animation-delay: 40ms;
        }

        .wizard-step-enter-forward [data-build="secondary"],
        .wizard-step-enter-backward [data-build="secondary"] {
          animation-delay: 70ms;
        }

        @media (max-height: 700px) {
          .new-match-step-scroll {
            padding-top: 8px;
            padding-bottom: 10px;
          }

          .new-match-step-heading {
            margin-top: 4px;
          }
        }

        /* Step 1 ("Poné nombre al partido") vertically centres its heading + input
           at EVERY height — including when the Android soft keyboard shrinks the
           viewport below the tall-screen breakpoint, which previously dropped the
           centring and left the title cramped against the top. The min-height:760px
           rule below overrides the bottom bias on iPhone-class / taller screens, so
           their layout is unchanged. (safe center keeps the top reachable if the
           keyboard ever makes the content overflow.) */
        .new-match-name-step {
          display: flex;
          min-height: 100%;
          flex-direction: column;
          justify-content: center;
          justify-content: safe center;
          padding-bottom: min(14vh, 120px);
        }

        @media (min-height: 760px) {
          .new-match-step-heading {
            margin-top: clamp(12px, 1.8dvh, 18px);
          }

          .new-match-name-step {
            display: flex;
            min-height: 100%;
            flex-direction: column;
            justify-content: center;
            padding-bottom: min(22vh, 180px);
          }

          .new-match-name-step .new-match-step-heading {
            margin-top: 0;
          }

          .new-match-action-rail {
            margin-bottom: min(5dvh, 42px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.055);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .wizard-step-enter-forward,
          .wizard-step-enter-backward,
          .wizard-step-exit-forward,
          .wizard-step-exit-backward,
          .wizard-step-enter-forward [data-build],
          .wizard-step-enter-backward [data-build] {
            animation-duration: 1ms !important;
            animation-delay: 0ms !important;
            transform: none !important;
          }
        }
      `}</style>
      <WizardBackground />
      <WizardHeader step={step} onBack={handleBack} isEditing={editMode} />

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[620px] flex-1 flex-col">
        <WizardStepper step={step} />
        <main
          data-testid="wizard-step-panel"
          data-transition-direction={directionName}
          data-transitioning={isTransitioning ? 'true' : 'false'}
          className="relative min-h-0 w-full flex-1 overflow-hidden"
        >
          {previousStep !== null ? (
            <div
              key={`outgoing-${previousStep}`}
              data-testid="wizard-step-outgoing"
              aria-hidden="true"
              className={`${outgoingTransitionClass} new-match-step-scroll absolute inset-0 overflow-y-auto overscroll-contain px-[max(18px,var(--safe-left,0px))] pb-3 pt-3`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) finishTransition();
              }}
            >
              {renderStep(previousStep, { active: false })}
            </div>
          ) : null}
          <div
            key={`incoming-${step}`}
            className={`${incomingTransitionClass} new-match-step-scroll absolute inset-0 overflow-y-auto overscroll-contain px-[max(18px,var(--safe-left,0px))] pb-3 pt-3`}
          >
            {renderStep(step, { active: !isTransitioning })}
          </div>
        </main>

        <div className="new-match-action-rail relative z-30 flex-none border-t border-white/[0.075] bg-[#090715]/94 px-[max(18px,var(--safe-left,0px))] pb-[max(10px,var(--safe-bottom,0px))] pt-2.5 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-[500px]">
            <button
              type="button"
              className={PRIMARY_ACTION_BUTTON_CLASS}
              disabled={loading || isTransitioning || (step !== NEW_MATCH_STEPS.CONFIRM && !canAdvance)}
              onClick={step === NEW_MATCH_STEPS.CONFIRM ? handleSubmit : handleNext}
            >
              {step === NEW_MATCH_STEPS.CONFIRM
                ? loading ? 'Creando…' : 'Crear partido'
                : editMode ? 'Guardar cambios' : 'Siguiente'}
            </button>
            {error && step === NEW_MATCH_STEPS.CONFIRM ? (
              <div role="alert" className={`${FORM_ERROR_CLASS} mt-3`}>{error}</div>
            ) : notice?.message ? (
              <div className="mt-3">
                <InlineNotice
                  type={notice.type}
                  message={notice.message}
                  autoHideMs={notice.type === 'warning' ? null : 3000}
                  onClose={clearInlineNotice}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
