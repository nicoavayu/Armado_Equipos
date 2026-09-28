// The shell's environment notice. It only ever claims isolation for the environments that are isolated
// (local QA, staging); in Production — or when the data environment is not declared — it shows nothing,
// never a reassurance that could be false.
const ENVIRONMENT_NOTICES = Object.freeze({
  local: { title: 'Entorno local', detail: 'Datos de prueba, sin conexión a producción' },
  staging: { title: 'Entorno de pruebas', detail: 'Datos de staging, sin conexión a producción' },
});

export function resolveTorneosEnvironmentNotice(env = process.env) {
  const dataEnvironment = String(env.REACT_APP_TORNEOS_DATA_ENV || '').trim().toLowerCase();
  return ENVIRONMENT_NOTICES[dataEnvironment] || null;
}
