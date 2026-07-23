// Centralized onboarding copy, steps, paths, checklist and coach-mark
// definitions. Everything user-visible lives here so the flow, tests and future
// version bumps read from a single source of truth.

// Bump this when a new onboarding (or mini-tour) should be (re)offered. The
// persisted `completed_version` gates re-showing: users who already went
// through version N are not auto-shown version N again, but a future N+1 will
// re-offer to them.
export const CURRENT_ONBOARDING_VERSION = 1;

// Feature launch cutoff. Accounts created at/after this instant are treated as
// "new" for the automatic onboarding. Accounts created before it are "existing"
// users: they never get the automatic flow, only the manual replay from Perfil.
// Anchored to the deploy date so no
// pre-existing account is ever mass-classified as new.
export const ONBOARDING_LAUNCH_CUTOFF = '2026-07-16T00:00:00.000Z';

export const ONBOARDING_PATHS = Object.freeze({
  ORGANIZER: 'organizer',
  AUTO_MATCH: 'auto_match',
  // Keep the persisted value `overview` for compatibility with the existing
  // DB constraint. The product-facing path is now "Explorar para jugar".
  EXPLORE: 'overview',
  // Informational, single-screen paths. These are intentionally not written
  // to `chosen_path`, whose existing DB constraint only accepts the three
  // checklist-backed values above.
  CHALLENGES: 'challenges',
  STATS: 'stats',
});

const PERSISTED_ONBOARDING_PATHS = Object.freeze([
  ONBOARDING_PATHS.ORGANIZER,
  ONBOARDING_PATHS.AUTO_MATCH,
  ONBOARDING_PATHS.EXPLORE,
]);

export const ONBOARDING_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
});

export const welcomeContent = Object.freeze({
  title: 'Tu partido empieza acá.',
  description: 'Organizá con tu grupo, encontrá un partido o descubrí jugadores para sumarte.',
  primaryCta: 'Empezar',
  secondaryCta: 'Ahora no',
});

// First recommended step of the general onboarding, shown after the intro and
// BEFORE the goal selector. It only invites the user to complete their profile
// (or continue) — it never forces profile completion to keep using the app.
export const profileStepContent = Object.freeze({
  title: 'Completá tu perfil',
  description: 'Contale a la comunidad un poco más sobre vos y ayudá a que los demás jugadores sepan cómo jugás.',
  secondary: 'Podés indicar tus posiciones, tu nivel autopercibido y un teléfono de contacto.',
  primaryCta: 'Completar mi perfil',
  // Discreet "continue without completing now" option that advances the
  // onboarding to the goal selector.
  secondaryCta: 'Más tarde',
});

// Standalone three-slide tutorial shown the first time a user opens the Perfil
// tab. Persisted independently from the general onboarding (see
// checklist.profileTourSeen) so neither flow can hide the other.
export const profileTourContent = Object.freeze({
  slides: [
    {
      key: 'about',
      title: 'Completá tu perfil',
      description: 'Agregá información sobre vos para que la comunidad pueda conocerte mejor antes de compartir un partido.',
      art: 'profile',
    },
    {
      key: 'contact',
      title: 'Contá cómo jugás',
      description: 'Completá tu teléfono de contacto y elegí hasta dos posiciones en las que podés jugar.',
      // Copy matches the real visibility rule: the phone is only shown to admins
      // (see ProfileEditor's "solo visible para admins" label). It is never public.
      note: 'Tu teléfono permite que los administradores puedan contactarte cuando sea necesario para organizar un partido.',
      art: 'profile_contact',
    },
    {
      key: 'score',
      title: 'Tu puntaje habla de responsabilidad',
      // Slide 3 is the most important: the score is about responsibility, not
      // football skill. Keep it free of internal formulas or exact penalties.
      lead: 'El puntaje no mide qué tan bien jugás al fútbol.',
      description: 'Todos comienzan con 5 puntos. Este valor refleja tu compromiso y responsabilidad con la comunidad.',
      detail: 'Puede disminuir si faltás a partidos sin aviso o si tenés comportamientos irresponsables.',
      levelNote: 'Tu nivel futbolístico se refleja en el nivel autopercibido, no en este puntaje.',
      closing: 'Jugá, cumplí y cuidá a la comunidad.',
      art: 'responsibility',
    },
  ],
  // The final CTA leads back to the editable fields on manual entry. Copy adapts
  // when the profile already has its key data (see resolveProfileTourCta). When
  // opened from the general onboarding, closing resumes the goal selector, so the
  // CTA reads "Continuar" instead of pointing at the (soon-covered) form.
  primaryCta: 'Completar mi perfil',
  primaryCtaComplete: 'Ver mi perfil',
  primaryCtaOnboarding: 'Continuar',
  secondaryCta: 'Ahora no',
});

export const goalSelectorContent = Object.freeze({
  title: '¿Qué querés hacer primero?',
  options: [
    {
      key: ONBOARDING_PATHS.ORGANIZER,
      label: 'Organizar un partido',
      description: 'Creás, invitás y Arma2 equilibra los equipos.',
      icon: 'CalendarPlus',
    },
    {
      key: ONBOARDING_PATHS.AUTO_MATCH,
      label: 'Partido Automático',
      description: 'Decís cuándo podés y Arma2 busca una oportunidad.',
      icon: 'Radar',
    },
    {
      key: ONBOARDING_PATHS.EXPLORE,
      label: 'Explorar para jugar',
      description: 'Mirá partidos disponibles y jugadores que quieren sumarse.',
      icon: 'LayoutGrid',
    },
    {
      key: ONBOARDING_PATHS.CHALLENGES,
      label: 'Desafíos',
      description: 'Armá tu equipo y encontrá rivales para jugar.',
      icon: 'Shield',
    },
    {
      key: ONBOARDING_PATHS.STATS,
      label: 'Estadísticas',
      description: 'Llevá el registro de tus partidos jugados, ganados, empatados y lesiones durante el año.',
      icon: 'BarChart3',
    },
  ],
});

// Each path is a short list of steps + a closing card. `art` names an
// illustration rendered by OnboardingStepArt. `cta.route` is a REAL existing
// route; the CTA only navigates — it never creates data or toggles preferences.
export const pathContent = Object.freeze({
  [ONBOARDING_PATHS.ORGANIZER]: {
    key: ONBOARDING_PATHS.ORGANIZER,
    label: 'Organizar un partido',
    steps: [
      {
        key: 'create',
        title: 'Creá el partido',
        description: 'Elegí el formato, la fecha, el horario y la cancha.',
        art: 'create',
      },
      {
        key: 'invite',
        title: 'Invitá por WhatsApp',
        description: 'Compartí el enlace. Tus amigos pueden sumarse aunque todavía no tengan Arma2.',
        art: 'whatsapp',
      },
      {
        key: 'evaluate',
        title: 'El grupo evalúa',
        description: 'Cada jugador evalúa a quienes conoce. Sin decisiones unilaterales.',
        art: 'evaluate',
      },
      {
        key: 'teams',
        title: 'Arma2 equilibra',
        description: 'Con los votos del grupo, Arma2 arma equipos parejos.',
        art: 'teams',
      },
      {
        key: 'record',
        title: 'Revisá tu historial',
        description: 'Consultá los partidos que jugaste y volvé a encontrarlos cuando quieras.',
        art: 'history',
      },
    ],
    closing: {
      title: 'Ya sabés todo lo necesario.',
      description: 'Ahora armá el primero.',
      cta: { label: 'Crear mi primer partido', route: '/nuevo-partido' },
    },
  },
  [ONBOARDING_PATHS.AUTO_MATCH]: {
    key: ONBOARDING_PATHS.AUTO_MATCH,
    label: 'Partido Automático',
    steps: [
      {
        key: 'availability',
        title: 'Decinos cuándo podés jugar',
        description: 'Marcá tus días y horarios disponibles.',
        art: 'availability',
      },
      {
        key: 'preferences',
        title: 'Elegí cómo querés jugar',
        description: 'Seleccioná formatos y la distancia que estás dispuesto a recorrer.',
        art: 'preferences',
      },
      {
        key: 'matching',
        title: 'Arma2 encuentra jugadores',
        description: 'Buscamos personas compatibles según disponibilidad, formato y ubicación.',
        art: 'matching',
      },
      {
        key: 'confirm',
        title: 'Confirmá la oportunidad',
        description: 'Cuando haya una propuesta, confirmá a tiempo para reservar tu lugar.',
        art: 'confirm',
      },
    ],
    closing: {
      title: 'Vos decís cuándo.',
      description: 'Arma2 encuentra con quién.',
      cta: { label: 'Activar mi búsqueda', route: '/quiero-jugar?auto=1' },
    },
  },
  [ONBOARDING_PATHS.EXPLORE]: {
    key: ONBOARDING_PATHS.EXPLORE,
    label: 'Explorar para jugar',
    steps: [
      {
        key: 'matches',
        title: 'Encontrá dónde jugar',
        description: 'Explorá partidos con lugares disponibles y revisá sus datos antes de sumarte.',
        art: 'explore_matches',
      },
      {
        key: 'players',
        title: 'Descubrí jugadores',
        description: 'Encontrá jugadores disponibles que también están buscando su próximo partido.',
        art: 'explore_players',
      },
    ],
    closing: {
      title: 'Tu próximo partido puede estar acá.',
      description: 'Entrá a Jugar y explorá las oportunidades disponibles.',
      cta: { label: 'Ir a Jugar', route: '/quiero-jugar' },
    },
  },
  [ONBOARDING_PATHS.CHALLENGES]: {
    key: ONBOARDING_PATHS.CHALLENGES,
    label: 'Desafíos',
    singleScreen: true,
    steps: [
      {
        key: 'challenges',
        title: 'Armá tu equipo. Encontrá rival.',
        description: 'Creá tu equipo y usá la cartelera de Desafíos para encontrar o publicar propuestas y conectar con otros equipos que quieren jugar.',
        art: 'challenges',
      },
    ],
    closing: {
      cta: { label: 'Ir a Desafíos', route: '/desafios' },
    },
  },
  [ONBOARDING_PATHS.STATS]: {
    key: ONBOARDING_PATHS.STATS,
    label: 'Estadísticas',
    singleScreen: true,
    steps: [
      {
        key: 'stats',
        title: 'Tu año en números',
        description: 'Consultá tus partidos jugados, ganados, empatados y las lesiones registradas durante el año.',
        art: 'stats',
      },
    ],
    closing: {
      cta: { label: 'Ver mis estadísticas', route: '/stats' },
    },
  },
});

// Contextual coach marks, keyed by screen. Targets use stable data-tour-id
// attributes on real controls (never text/position selectors). A screen with a
// missing target is skipped safely, never looped.
export const coachMarkContent = Object.freeze({
  'new-match': {
    version: 1,
    steps: [
      {
        id: 'manual',
        target: '[data-tour-id="new-match-manual"]',
        title: 'Creá tu partido',
        body: 'Cargá formato, fecha, hora y cancha paso a paso. Después lo compartís por WhatsApp.',
      },
      {
        id: 'whatsapp',
        target: '[data-tour-id="new-match-whatsapp"]',
        title: '¿Ya tenés la lista?',
        body: 'Importá tu grupo de WhatsApp y armá el partido en segundos.',
      },
    ],
  },
  'auto-match': {
    version: 1,
    steps: [
      {
        id: 'availability',
        target: '[data-tour-id="auto-match-availability"]',
        title: 'Tu disponibilidad',
        body: 'Marcá días y horarios. Arma2 busca oportunidades que encajen.',
      },
      {
        id: 'activate',
        target: '[data-tour-id="auto-match-activate"]',
        title: 'Activá la búsqueda',
        body: 'Cuando la actives, te avisamos apenas haya una propuesta compatible.',
      },
    ],
  },
});

export function getPathContent(pathKey) {
  return pathContent[pathKey] || null;
}

export function isValidOnboardingPath(pathKey) {
  return Object.values(ONBOARDING_PATHS).includes(pathKey);
}

export function isPersistedOnboardingPath(pathKey) {
  return PERSISTED_ONBOARDING_PATHS.includes(pathKey);
}
