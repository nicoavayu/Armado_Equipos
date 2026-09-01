const { assertSafeQaEnvironment, assertSafeQaValue } = require('../../scripts/qa/production-guard');

module.exports = async function globalSetup(config) {
  assertSafeQaEnvironment(process.env);
  for (const project of config.projects) {
    assertSafeQaValue(project.use.baseURL, `${project.name} baseURL`);
  }
};
