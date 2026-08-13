const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const { test, expect, requirePreparedActor } = require('./fixtures/qa-test');

const databaseUrl = process.env.QA_SCENARIO_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
if (!/^postgres(?:ql)?:\/\/[^@/]+@(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl)) {
  throw new Error('Scenario crawler database must be loopback.');
}

async function readInventory() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select organization.id organization_id,organization.slug organization_slug,
              tournament.id tournament_id,tournament.slug tournament_slug,
              tournament.name tournament_name,tournament.status tournament_status
       from public.tournament_organizations organization
       left join public.tournaments tournament on tournament.organization_id=organization.id
       where organization.slug in (
         'qa-metropolitana','qa-escenarios-deterministas',
         'qa-organizacion-archivada','qa-volumen-local-20'
       )
       order by organization.slug,tournament.name`,
    );
    const organizations = {};
    for (const row of rows) {
      organizations[row.organization_slug] ||= {
        id: row.organization_id,
        tournaments: [],
      };
      if (row.tournament_id) organizations[row.organization_slug].tournaments.push({
        id: row.tournament_id,
        slug: row.tournament_slug,
        name: row.tournament_name,
        status: row.tournament_status,
      });
    }
    return organizations;
  } finally {
    await client.end();
  }
}

function route(id, url, access = 'allow', setup = null) {
  return { id, url, access, setup };
}

function roleRoutes(role, inventory) {
  const baseline = inventory['qa-metropolitana'];
  const edge = inventory['qa-escenarios-deterministas'];
  const volume = inventory['qa-volumen-local-20'];
  const active = baseline.tournaments.find((item) => item.name === 'Torneo Apertura QA 2026');
  const temporal = edge.tournaments.find((item) => item.slug === 'copa-qa-temporal-ocho');
  const odd = edge.tournaments.find((item) => item.slug === 'copa-qa-cinco-equipos');
  const volumeTournament = volume.tournaments[0];
  const common = [
    route('TQ-SPACE-DEEP-LINK', '/torneos'),
    route('TQ-ORG-MULTI-MEMBERSHIP', '/torneos/mis-torneos'),
  ];
  const organizationRoutes = [
    route('TQ-ORG-COMPLETE', `/torneos/organizacion/${baseline.id}/inicio`),
    route('TQ-SEASON-MULTI-COMP', `/torneos/organizacion/${baseline.id}/torneos`),
    route('TQ-COMP-8-TEAMS', `/torneos/organizacion/${baseline.id}/equipos`),
    route('TQ-FIXTURE-COMPLETE', `/torneos/organizacion/${baseline.id}/fixture`),
    route('TQ-STANDINGS-TIED', `/torneos/organizacion/${baseline.id}/competencia/tabla`),
    route('TQ-STATS-TOP-SCORER', `/torneos/organizacion/${baseline.id}/competencia/estadisticas`),
    route('TQ-DISC-ACTIVE', `/torneos/organizacion/${baseline.id}/competencia/disciplina`),
    route('TQ-COMMS-PUBLISHED', `/torneos/organizacion/${baseline.id}/comunicaciones`),
    route('TQ-MEDIA-EMPTY-DRAFT', `/torneos/organizacion/${baseline.id}/multimedia`),
  ];
  const edgeRoutes = [
    route(
      'TQ-COMP-ODD-5',
      `/torneos/organizacion/${edge.id}/fixture/jornadas`,
      'allow',
      { organizationId: edge.id, tournamentId: odd.id },
    ),
    route(
      'TQ-TIME-NOW-PLUS-5',
      `/torneos/organizacion/${edge.id}/partidos`,
      'allow',
      { organizationId: edge.id, tournamentId: temporal.id },
    ),
    route(
      'TQ-VOLUME-20-240-190',
      `/torneos/organizacion/${volume.id}/fixture/jornadas`,
      'allow',
      { organizationId: volume.id, tournamentId: volumeTournament.id },
    ),
  ];
  if (role === 'owner') return [
    ...common,
    ...organizationRoutes,
    ...edgeRoutes,
    route('TQ-ROLE-OWNER', `/torneos/organizacion/${baseline.id}/configuracion`),
    route('TQ-ROLE-OWNER-PLAN', `/torneos/organizacion/${baseline.id}/configuracion/plan`),
    route('TQ-ROLE-OWNER-MEMBERS', `/torneos/organizacion/${baseline.id}/miembros`),
  ];
  if (role === 'admin') return [
    ...common,
    ...organizationRoutes,
    route('TQ-ROLE-ADMIN', `/torneos/organizacion/${baseline.id}/configuracion`),
    route('TQ-ROLE-ADMIN-PLAN', `/torneos/organizacion/${baseline.id}/configuracion/plan`),
    route('TQ-ROLE-ADMIN-MEMBERS', `/torneos/organizacion/${baseline.id}/miembros`),
  ];
  if (role === 'collaborator') return [
    ...common,
    ...organizationRoutes,
    route('TQ-ROLE-COLLABORATOR-CONFIG', `/torneos/organizacion/${baseline.id}/configuracion`),
    route('TQ-ROLE-COLLABORATOR-PLAN', `/torneos/organizacion/${baseline.id}/configuracion/plan`),
    route('TQ-ROLE-COLLABORATOR-MEMBERS', `/torneos/organizacion/${baseline.id}/miembros`),
    route('TQ-ROLE-COLLABORATOR-HUB', `/torneos/torneo/${active.id}`),
  ];
  if (role === 'delegate' || role === 'player') return [
    ...common,
    route(`TQ-ROLE-${role.toUpperCase()}`, `/torneos/torneo/${active.id}`),
    route('TQ-MATCH-WITH-EVENTS', `/torneos/torneo/${active.id}/partidos`),
    route('TQ-STANDINGS-TIED', `/torneos/torneo/${active.id}/tabla`),
    route('TQ-STATS-ASSISTS', `/torneos/torneo/${active.id}/estadisticas`),
    route('TQ-DISC-RED', `/torneos/torneo/${active.id}/disciplina`),
    route('TQ-COMMS-READ-UNREAD', `/torneos/torneo/${active.id}/novedades`),
    route(`TQ-ROLE-${role.toUpperCase()}-DENIED-CONFIG`, `/torneos/organizacion/${baseline.id}/configuracion`, 'deny'),
  ];
  return [
    ...common,
    route('TQ-ROLE-OUTSIDER-DIRECT-URL', `/torneos/organizacion/${baseline.id}/configuracion`, 'deny'),
    route('TQ-ROLE-OUTSIDER-TOURNAMENT', `/torneos/torneo/${active.id}`, 'deny'),
  ];
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const text = (body?.innerText || '').trim();
    const dialogOverflows = [...document.querySelectorAll('[role="dialog"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > window.innerWidth + 1
          || rect.top < -1 || rect.bottom > window.innerHeight + 1;
      })
      .map((element) => element.getAttribute('aria-label') || element.textContent?.slice(0, 80));
    const fixedOverflows = [...document.querySelectorAll('button,a,[role="button"]')]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (!['fixed', 'sticky'].includes(style.position)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .map((element) => (element.textContent || element.getAttribute('aria-label') || '').slice(0, 80));
    return {
      href: location.href,
      title: document.title,
      textLength: text.length,
      whitePage: text.length < 12,
      errorBoundary: /algo salió mal|unexpected error|error boundary/i.test(text),
      loadingGate: Boolean(document.querySelector('[data-torneos-loading="true"]'))
        || /Validando tu espacio|Confirmamos tu sesión|Resolviendo tu experiencia|Cargando centro del torneo/i.test(text),
      failureScreen: /no pudimos (?:abrir|cargar|validar)|volvé a intentar|reintentar/i.test(text),
      horizontalOverflow: Math.max(root.scrollWidth, body?.scrollWidth || 0) > window.innerWidth + 1,
      dimensions: {
        viewport: window.innerWidth,
        rootClient: root.clientWidth,
        rootScroll: root.scrollWidth,
        bodyScroll: body?.scrollWidth || 0,
      },
      dialogOverflows,
      fixedOverflows,
      criticalMainMissing: !document.querySelector('main,#torneos-main,[role="main"]'),
      bodyText: text.slice(0, 500),
    };
  });
}

for (const role of ['owner', 'admin', 'delegate', 'player', 'collaborator', 'outsider']) {
  test.describe(`local deterministic crawler: ${role}`, () => {
    test.use({ actorRole: role });
    test(`crawls routes for ${role} and records objective anomalies`, async ({ page, actor }, testInfo) => {
      test.setTimeout(120_000);
      requirePreparedActor(testInfo, actor);
      const inventory = await readInventory();
      const routes = roleRoutes(role, inventory);
      const accessByScenario = new Map(routes.map((item) => [item.id, item.access]));
      const findings = [];
      const warnings = [];
      const visits = [];
      let currentScenario = 'bootstrap';
      const pageErrors = [];
      const consoleErrors = [];
      const consoleWarnings = [];
      const failedRequests = [];
      const httpErrors = [];
      const navigationCounts = new Map();

      page.on('pageerror', (error) => pageErrors.push({ scenarioId: currentScenario, message: error.message }));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push({ scenarioId: currentScenario, message: message.text() });
        if (message.type() === 'warning') consoleWarnings.push({ scenarioId: currentScenario, message: message.text() });
      });
      page.on('requestfailed', (request) => failedRequests.push({
        scenarioId: currentScenario, url: request.url(), error: request.failure()?.errorText,
      }));
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        const key = `${currentScenario}:${frame.url()}`;
        navigationCounts.set(key, (navigationCounts.get(key) || 0) + 1);
      });
      page.on('response', (response) => {
        if (response.status() >= 400) httpErrors.push({
          scenarioId: currentScenario, url: response.url(), status: response.status(),
        });
      });

      for (const item of routes) {
        currentScenario = item.id;
        const startedAt = Date.now();
        try {
          if (item.setup) {
            await page.goto(`/torneos/organizacion/${item.setup.organizationId}/torneos`, {
              waitUntil: 'domcontentloaded',
            });
            const tournamentSelector = page.getByLabel('Torneo activo').first();
            await tournamentSelector.waitFor({ state: 'visible', timeout: 8_000 });
            await tournamentSelector.selectOption(item.setup.tournamentId);
            await expect(tournamentSelector).toHaveValue(item.setup.tournamentId, { timeout: 8_000 });
            await expect(tournamentSelector).toBeEnabled({ timeout: 8_000 });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expect(page.getByLabel('Torneo activo').first()).toHaveValue(
              item.setup.tournamentId,
              { timeout: 8_000 },
            );
          }
          const response = await page.goto(item.url, { waitUntil: 'domcontentloaded' });
          await page.evaluate(() => {
            window.__torneosCrawlerIdleSince = 0;
          });
          await page.waitForFunction(() => {
            const text = document.body?.innerText || '';
            const hasLoadingPanel = Boolean(document.querySelector('[data-torneos-loading="true"]'));
            const hasLegacyLoadingGate = /Validando tu espacio|Confirmamos tu sesión|Resolviendo tu experiencia|Cargando centro del torneo/i.test(text);
            if (/no pudimos (?:abrir|cargar|validar)|volvé a intentar|reintentar/i.test(text)) {
              return true;
            }
            if (hasLoadingPanel || hasLegacyLoadingGate) {
              window.__torneosCrawlerIdleSince = 0;
              return false;
            }
            if (!window.__torneosCrawlerIdleSince) {
              window.__torneosCrawlerIdleSince = performance.now();
              return false;
            }
            return performance.now() - window.__torneosCrawlerIdleSince >= 400;
          }, null, { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(100);
          const observed = await inspectPage(page);
          const elapsedMs = Date.now() - startedAt;
          visits.push({ ...item, ...observed, elapsedMs, httpStatus: response?.status() || null });
          if (observed.href.includes('/login')) findings.push({
            scenarioId: item.id, kind: 'unexpected_login_redirect', url: observed.href,
          });
          const requestedPath = new URL(item.url, 'http://qa.local').pathname;
          const observedPath = new URL(observed.href).pathname;
          if (item.access === 'allow' && requestedPath !== observedPath) findings.push({
            scenarioId: item.id, kind: 'unexpected_route_redirect',
            requestedPath, observedPath,
          });
          if (item.access === 'allow' && observed.loadingGate) findings.push({
            scenarioId: item.id, kind: 'unresolved_loading_gate', url: observed.href,
          });
          if (item.access === 'allow' && observed.failureScreen) findings.push({
            scenarioId: item.id, kind: 'route_failure_screen', url: observed.href,
            bodyText: observed.bodyText,
          });
          const stillOnDeniedRoute = item.access === 'deny'
            && observedPath === requestedPath;
          if (stillOnDeniedRoute && observed.loadingGate) findings.push({
            scenarioId: item.id, kind: 'access_verdict_inconclusive', url: observed.href,
          });
          if (stillOnDeniedRoute && !observed.loadingGate && !/sin acceso|no (?:tenés|tienes) acceso|no autorizado|forbidden|validar el acceso|no pudimos abrir|modo lectura|rol no permite/i.test(observed.bodyText)) {
            findings.push({ scenarioId: item.id, kind: 'unauthorized_route_access', url: observed.href });
          }
          for (const [kind, active] of [
            ['white_page', observed.whitePage],
            ['error_boundary', observed.errorBoundary],
            ['horizontal_overflow', observed.horizontalOverflow],
            ['critical_main_missing', observed.criticalMainMissing],
          ]) {
            if (active) findings.push({ scenarioId: item.id, kind, url: observed.href, dimensions: observed.dimensions });
          }
          if (observed.dialogOverflows.length) findings.push({
            scenarioId: item.id, kind: 'dialog_overflow', elements: observed.dialogOverflows,
          });
          if (observed.fixedOverflows.length) findings.push({
            scenarioId: item.id, kind: 'fixed_control_overflow', elements: observed.fixedOverflows,
          });
          if (elapsedMs > 5_000) warnings.push({
            scenarioId: item.id, kind: 'slow_route', elapsedMs, url: observed.href,
          });
        } catch (error) {
          findings.push({ scenarioId: item.id, kind: 'navigation_crash', message: error.message });
        }
      }

      for (const [key, count] of navigationCounts) {
        if (count > 3) findings.push({ scenarioId: key.split(':')[0], kind: 'redirect_loop', count, key });
      }
      findings.push(...pageErrors.map((entry) => ({ ...entry, kind: 'page_error' })));
      warnings.push(...consoleWarnings.map((entry) => ({ ...entry, kind: 'console_warning' })));
      for (const entry of httpErrors) {
        const external = !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(entry.url);
        const expectedDenial = accessByScenario.get(entry.scenarioId) === 'deny'
          && [401, 403].includes(entry.status);
        (external || expectedDenial ? warnings : findings).push({
          ...entry,
          kind: external ? 'external_http_error' : expectedDenial ? 'expected_denial_http' : 'http_error',
        });
      }
      for (const entry of failedRequests) {
        const external = !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(entry.url);
        const navigationAbort = entry.error === 'net::ERR_ABORTED';
        (external || navigationAbort ? warnings : findings).push({
          ...entry,
          kind: external ? 'external_request_failure' : navigationAbort ? 'navigation_aborted_request' : 'request_failure',
        });
      }
      for (const entry of consoleErrors) {
        const externalHttpInScenario = httpErrors.some((httpError) => (
          httpError.scenarioId === entry.scenarioId
          && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(httpError.url)
        ));
        const expectedDenial = accessByScenario.get(entry.scenarioId) === 'deny'
          && /(?:401|403|unauthorized|forbidden)/i.test(entry.message);
        (externalHttpInScenario || expectedDenial ? warnings : findings).push({
          ...entry,
          kind: externalHttpInScenario
            ? 'external_console_error'
            : expectedDenial ? 'expected_denial_console' : 'console_error',
        });
      }

      const evidence = {
        role, project: testInfo.project.name, seed: '20260812',
        baseURL: testInfo.project.use.baseURL, visits, findings, warnings,
      };
      const evidencePath = testInfo.outputPath(`crawler-${role}.json`);
      fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      await testInfo.attach(`crawler ${role}`, { path: evidencePath, contentType: 'application/json' });
      expect(findings, `${role} crawler findings`).toEqual([]);
    });
  });
}

test.describe('space switching history', () => {
  test.use({ actorRole: 'owner' });
  test('covers refresh, deep link and Back/Forward without losing route', async ({ page, actor }, testInfo) => {
    requirePreparedActor(testInfo, actor);
    const inventory = await readInventory();
    const organizationId = inventory['qa-metropolitana'].id;
    const deepLink = `/torneos/organizacion/${organizationId}/equipos`;
    await page.goto('/');
    await page.goto(deepLink);
    await expect(page).toHaveURL(new RegExp(`${organizationId}/equipos$`));
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${organizationId}/equipos$`));
    await page.goto('/torneos/mis-torneos');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${organizationId}/equipos$`));
    await page.goForward();
    await expect(page).toHaveURL(/\/torneos\/mis-torneos$/);
  });
});
