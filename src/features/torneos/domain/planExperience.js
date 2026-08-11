import {
  hasEffectiveTournamentEntitlement,
  TOURNAMENT_ENTITLEMENTS,
  TOURNAMENT_PLANS,
  TOURNAMENT_SUBSCRIPTION_STATUSES,
} from './entitlements';

export const PLAN_BENEFITS = Object.freeze([
  {
    capability: TOURNAMENT_ENTITLEMENTS.MEDIA_UPLOAD,
    group: 'Multimedia',
    label: 'Carga de fotos',
    description: 'Carga protegida, sujeta a permisos y salvaguardas operativas.',
    featureFlag: 'mediaUploadEnabled',
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.MEDIA_HISTORY,
    group: 'Multimedia',
    label: 'Historial fotográfico',
    description: 'Acceso al archivo histórico cuando corresponde a la audiencia.',
    featureFlag: 'mediaEnabled',
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.MEDIA_EXTENDED_RETENTION,
    group: 'Multimedia',
    label: 'Retención extendida',
    description: 'Conservación fuera de la ventana móvil del plan efectivo.',
    featureFlag: 'mediaEnabled',
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.SOCIAL_STUDIO_BASIC,
    group: 'Estudio Social',
    label: 'Estudio Social básico',
    description: 'Creación de piezas con datos oficiales, según permisos del rol.',
    featureFlag: 'socialContentGenerator',
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.SOCIAL_STUDIO_FULL,
    group: 'Estudio Social',
    label: 'Estudio Social completo',
    description: 'Herramientas ampliadas, siempre sujetas a permisos específicos.',
    featureFlag: 'socialContentGenerator',
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.ADVANCED_STATS,
    group: 'Competencia',
    label: 'Estadísticas avanzadas',
    description: 'Proyecciones avanzadas para audiencias aplicables.',
    featureFlag: 'officialStats',
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.HIGHER_LIMITS,
    group: 'Organización',
    label: 'Límites superiores',
    description: 'Límites ampliados sólo donde exista un valor comercial configurado.',
  },
]);

const LIFECYCLE = Object.freeze({
  [`${TOURNAMENT_PLANS.PRO}:${TOURNAMENT_SUBSCRIPTION_STATUSES.ACTIVE}`]: {
    label: 'Activo',
    tone: 'positive',
    description: 'Los beneficios PRO están activos para esta organización.',
  },
  [`${TOURNAMENT_PLANS.PRO}:${TOURNAMENT_SUBSCRIPTION_STATUSES.GRACE_PERIOD}`]: {
    label: 'Período de gracia',
    tone: 'warning',
    description: 'La organización conserva temporalmente sus beneficios PRO.',
  },
  [`${TOURNAMENT_PLANS.PRO}:${TOURNAMENT_SUBSCRIPTION_STATUSES.CANCELLED}`]: {
    label: 'Cancelado',
    tone: 'warning',
    description: 'PRO sigue disponible durante el período vigente definido por el servidor.',
  },
  [`${TOURNAMENT_PLANS.FREE}:${TOURNAMENT_SUBSCRIPTION_STATUSES.PAST_DUE}`]: {
    label: 'Acceso PRO pausado',
    tone: 'danger',
    description: 'Past due resuelve FREE según el contrato canónico actual.',
  },
  [`${TOURNAMENT_PLANS.FREE}:${TOURNAMENT_SUBSCRIPTION_STATUSES.EXPIRED}`]: {
    label: 'PRO vencido',
    tone: 'neutral',
    description: 'La suscripción venció y la organización resuelve FREE.',
  },
  [`${TOURNAMENT_PLANS.FREE}:${TOURNAMENT_SUBSCRIPTION_STATUSES.NONE}`]: {
    label: 'Sin suscripción PRO',
    tone: 'neutral',
    description: 'La organización usa el plan FREE.',
  },
});

export function getTournamentPlanLifecycle(entitlements) {
  if (!entitlements?.isTrusted) {
    return {
      label: 'No verificado',
      tone: 'danger',
      description: 'No pudimos validar el plan. La experiencia falla cerrada.',
    };
  }
  return LIFECYCLE[`${entitlements.plan}:${entitlements.subscriptionStatus}`] || {
    label: entitlements.plan === TOURNAMENT_PLANS.PRO ? 'PRO vigente' : 'FREE',
    tone: entitlements.plan === TOURNAMENT_PLANS.PRO ? 'positive' : 'neutral',
    description: entitlements.plan === TOURNAMENT_PLANS.PRO
      ? 'El resolver canónico mantiene los beneficios PRO.'
      : 'El resolver canónico no concede acceso PRO.',
  };
}

export function resolvePlanBenefit(benefit, entitlements, featureFlags = {}) {
  const entitled = hasEffectiveTournamentEntitlement(
    entitlements,
    benefit.capability,
  );
  const featureAvailable = !benefit.featureFlag
    || featureFlags[benefit.featureFlag] === true;

  if (!featureAvailable) {
    return {
      ...benefit,
      available: false,
      entitled,
      status: 'feature_unavailable',
      statusLabel: 'No disponible en este entorno',
    };
  }
  if (!entitled) {
    return {
      ...benefit,
      available: false,
      entitled: false,
      status: 'locked',
      statusLabel: 'No incluido en el plan actual',
    };
  }
  return {
    ...benefit,
    available: true,
    entitled: true,
    status: 'included',
    statusLabel: benefit.featureFlag
      ? 'Incluido · sujeto a permisos'
      : 'Incluido',
  };
}

export function formatPlanDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function describeMediaLimit(value, singular, plural) {
  if (!Number.isInteger(value)) return 'A definir';
  return `${value} ${value === 1 ? singular : plural}`;
}
