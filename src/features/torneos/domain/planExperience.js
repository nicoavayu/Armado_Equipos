import {
  hasEffectiveTournamentEntitlement,
  TOURNAMENT_ENTITLEMENTS,
  TOURNAMENT_PLANS,
  TOURNAMENT_PLAN_SOURCES,
} from './entitlements';

export const PLAN_BENEFITS = Object.freeze([
  {
    capability: TOURNAMENT_ENTITLEMENTS.ADVANCED_STATISTICS,
    group: 'Competencia',
    label: 'Estadísticas avanzadas',
    description: 'Análisis y proyecciones avanzadas cuando esa funcionalidad exista.',
    implemented: false,
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.HIGHER_LIMITS,
    group: 'Multimedia',
    label: 'Multimedia ampliada',
    description: 'Una cuota general de galería más amplia, configurada por el servidor.',
    implemented: true,
    featureFlag: 'mediaEnabled',
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.ADVANCED_BRANDING,
    group: 'Identidad',
    label: 'Personalización avanzada',
    description: 'Marca propia más fuerte con la firma “Powered by Arma2”.',
    implemented: false,
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.SPONSORS,
    group: 'Identidad',
    label: 'Sponsors',
    description: 'Capacidad Premium registrada para una futura gestión de sponsors.',
    implemented: false,
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.PREMIUM_SOCIAL_STUDIO,
    group: 'Contenido',
    label: 'Social Studio Premium',
    description: 'Capacidad Premium registrada sin crear herramientas ficticias.',
    implemented: false,
  },
  {
    capability: TOURNAMENT_ENTITLEMENTS.PROFESSIONAL_EXPORTS,
    group: 'Administración',
    label: 'Exportaciones profesionales',
    description: 'Capacidad Premium registrada para exportaciones futuras.',
    implemented: false,
  },
]);

export function getTournamentPlanLifecycle(entitlements) {
  if (!entitlements?.isTrusted) {
    return {
      label: 'No verificado',
      tone: 'danger',
      description: 'No pudimos validar el plan de esta edición.',
    };
  }
  if (entitlements.plan === TOURNAMENT_PLANS.PREMIUM) {
    return {
      label: 'Premium para esta edición',
      tone: 'positive',
      description: 'Pago único · acceso permanente para este torneo.',
    };
  }
  if (entitlements.assignmentSource === TOURNAMENT_PLAN_SOURCES.FIRST_FREE) {
    return {
      label: 'Tu primer torneo, gratis',
      tone: 'neutral',
      description: 'Todo lo necesario para organizar tu campeonato.',
    };
  }
  return {
    label: 'Premium requerido para una nueva edición',
    tone: 'warning',
    description: 'Esta edición todavía no tiene una licencia Premium asignada.',
  };
}

export function resolvePlanBenefit(benefit, entitlements, featureFlags = {}) {
  const entitled = hasEffectiveTournamentEntitlement(entitlements, benefit.capability);
  if (benefit.implemented === false) {
    return {
      ...benefit,
      available: false,
      entitled,
      status: entitled ? 'entitled_future' : 'premium_only',
      statusLabel: entitled
        ? 'Incluido en Premium · funcionalidad futura'
        : 'Disponible con Premium · funcionalidad futura',
    };
  }
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
  return {
    ...benefit,
    available: entitled,
    entitled,
    status: entitled ? 'included' : 'premium_only',
    statusLabel: entitled ? 'Incluido' : 'Disponible con Premium',
  };
}

export function formatPlanPrice(pricing, field) {
  const value = pricing?.[field];
  if (!Number.isInteger(value) || pricing?.currency !== 'ARS') return 'No verificado';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: pricing.currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function describePlanLimit(value, singular, plural) {
  if (!Number.isInteger(value)) return 'No verificado';
  return `${value.toLocaleString('es-AR')} ${value === 1 ? singular : plural}`;
}
