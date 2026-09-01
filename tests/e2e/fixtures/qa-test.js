const fs = require('node:fs');
const { test: base, expect } = require('@playwright/test');
const {
  assertSafeQaValue,
} = require('../../../scripts/qa/production-guard');
const { getRoleState } = require('./roles');

const test = base.extend({
  actorRole: ['outsider', { option: true }],

  storageState: async ({ actorRole }, use) => {
    const actor = getRoleState(actorRole);
    await use(actor.storageState);
  },

  actor: async ({ actorRole }, use) => {
    await use(getRoleState(actorRole));
  },

  productionGuard: [async ({ page }, use, testInfo) => {
    const violations = [];
    const consoleEntries = [];
    const failedRequests = [];

    const inspect = (value, label) => {
      try {
        assertSafeQaValue(value, label);
      } catch (error) {
        violations.push(error.message);
        throw error;
      }
    };

    page.on('request', (request) => {
      inspect(request.url(), `request in ${testInfo.title}`);
    });
    page.on('framenavigated', (frame) => {
      inspect(frame.url(), `navigation in ${testInfo.title}`);
    });
    page.on('console', (message) => {
      const entry = `[${message.type()}] ${message.text()}`;
      consoleEntries.push(entry);
      inspect(entry, `console in ${testInfo.title}`);
    });
    page.on('requestfailed', (request) => {
      failedRequests.push({
        method: request.method(),
        url: request.url(),
        error: request.failure()?.errorText || 'unknown',
      });
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.push({
          method: response.request().method(),
          url: response.url(),
          status: response.status(),
        });
      }
    });

    await use();

    if (!page.isClosed()) {
      inspect(await page.content(), `rendered page in ${testInfo.title}`);
    }

    if (testInfo.status !== testInfo.expectedStatus || violations.length > 0) {
      const evidence = JSON.stringify({
        violations,
        console: consoleEntries,
        failedRequests,
      }, null, 2);
      const evidencePath = testInfo.outputPath('browser-diagnostics.json');
      fs.writeFileSync(evidencePath, evidence);
      await testInfo.attach('browser diagnostics', {
        path: evidencePath,
        contentType: 'application/json',
      });
    }

    expect(violations, 'Production guard violations').toEqual([]);
  }, { auto: true }],
});

function requirePreparedActor(testInfo, actor) {
  testInfo.skip(!actor.ready, actor.reason);
  testInfo.skip(
    process.env.QA_TORNEOS_DEMO_READY !== 'true',
    'QA_TORNEOS_DEMO_READY=true is required; the demo seed has not been executed.',
  );
}

module.exports = {
  expect,
  requirePreparedActor,
  test,
};
