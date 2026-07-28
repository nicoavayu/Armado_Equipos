import { isQaPasswordLoginEnabled } from '../utils/qaPasswordLogin';

const enabledEnvironment = {
  REACT_APP_DEPLOY_ENV: 'staging',
  REACT_APP_TORNEOS_DATA_ENV: 'staging',
  REACT_APP_QA_PASSWORD_LOGIN_ENABLED: 'true',
};

describe('isQaPasswordLoginEnabled', () => {
  test('enables the QA login only for the exact staging configuration', () => {
    expect(isQaPasswordLoginEnabled({ env: enabledEnvironment })).toBe(true);
  });

  test.each([
    ['disabled flag', { ...enabledEnvironment, REACT_APP_QA_PASSWORD_LOGIN_ENABLED: 'false' }],
    ['production', { ...enabledEnvironment, REACT_APP_DEPLOY_ENV: 'production' }],
    ['generic preview', { ...enabledEnvironment, REACT_APP_DEPLOY_ENV: 'preview' }],
    ['incomplete environment', { REACT_APP_DEPLOY_ENV: 'staging' }],
    ['different casing', { ...enabledEnvironment, REACT_APP_QA_PASSWORD_LOGIN_ENABLED: 'TRUE' }],
  ])('fails closed for %s', (_label, env) => {
    expect(isQaPasswordLoginEnabled({ env })).toBe(false);
  });

  test('is disabled in native builds even with all staging flags', () => {
    expect(isQaPasswordLoginEnabled({
      env: enabledEnvironment,
      isNativePlatform: true,
    })).toBe(false);
  });
});
