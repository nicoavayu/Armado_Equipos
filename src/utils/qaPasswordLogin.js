export function isQaPasswordLoginEnabled({
  env = process.env,
  isNativePlatform = false,
} = {}) {
  if (isNativePlatform) return false;

  return (
    env.REACT_APP_DEPLOY_ENV === 'staging'
    && env.REACT_APP_TORNEOS_DATA_ENV === 'staging'
    && env.REACT_APP_QA_PASSWORD_LOGIN_ENABLED === 'true'
  );
}
