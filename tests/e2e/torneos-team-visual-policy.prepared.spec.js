// QA LOCAL de Multimedia 1C.3A: el recorrido de las tres políticas con las
// identidades QA existentes. Usa las sesiones preparadas del procedimiento
// habitual; no crea usuarios ni muestra tokens.
const {
  test,
  expect,
  requirePreparedActor,
} = require('./fixtures/qa-test');

const organizationId = process.env.QA_TORNEOS_ORGANIZATION_ID || 'pending-demo-organization';
const tournamentId = process.env.QA_TORNEOS_TOURNAMENT_ID || 'pending-demo-tournament';
const ownTeamEntryId = process.env.QA_TORNEOS_OWN_TEAM_ENTRY_ID || 'pending-own-team';
const otherTeamEntryId = process.env.QA_TORNEOS_OTHER_TEAM_ENTRY_ID || 'pending-other-team';

const settingsUrl = `/torneos/organizacion/${organizationId}/torneos/${tournamentId}/configuracion`;
const teamUrl = (entryId) => `/torneos/organizacion/${organizationId}/equipos/${entryId}/inscripcion`;

// La sesión se restaura de forma asíncrona: si se entra directo a una ruta de
// organización, el guard puede evaluarse antes de que el workspace conteste.
// Se abre primero el landing y recién después la ruta profunda.
async function open(page, url) {
  await page.goto('/torneos');
  await page.waitForLoadState('networkidle');
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function selectPolicy(page, label) {
  const option = page.getByRole('radio', { name: new RegExp(label) });
  await expect(option).toBeEnabled();
  if (!(await option.isChecked())) {
    // El control es controlado por el servidor: recién queda marcado cuando la
    // RPC contesta, así que no hay un `check()` sincrónico que valga.
    await option.click();
  }
  await expect(option).toBeChecked();
}

test.describe('prepared: gestión de imágenes por los equipos', () => {
  test.describe('el organizador configura la política', () => {
    test.use({ actorRole: 'owner' });

    test('la configuración del torneo ofrece las tres opciones y arranca cerrada', async (
      { page, actor }, testInfo,
    ) => {
      requirePreparedActor(testInfo, actor);
      await open(page, settingsUrl);

      const panel = page.getByRole('region', { name: 'Gestión de imágenes por los equipos' })
        .or(page.locator('section', { hasText: 'Gestión de imágenes por los equipos' }).first());
      await expect(
        page.getByRole('heading', { name: 'Gestión de imágenes por los equipos' }),
      ).toBeVisible();
      await expect(page.getByText(
        'Elegí quién puede mantener actualizados el escudo y las fotos de cada equipo.',
      )).toBeVisible();
      await expect(page.getByText(
        /Cada usuario sólo puede gestionar imágenes de su propio equipo\./,
      )).toBeVisible();

      await expect(page.getByRole('radio', { name: /Sólo la organización/ })).toBeChecked();
      await expect(page.getByRole('radio', { name: /Delegados y capitanes/ })).toBeVisible();
      await expect(page.getByRole('radio', { name: /Todo el plantel/ })).toBeVisible();
      await panel.screenshot({ path: testInfo.outputPath('policy-organization-only.png') })
        .catch(() => {});
      await testInfo.attach('configuración inicial', {
        body: await page.screenshot({ fullPage: false }), contentType: 'image/png',
      });
    });

    test('la organización gestiona el escudo con la política cerrada', async (
      { page, actor }, testInfo,
    ) => {
      requirePreparedActor(testInfo, actor);
      await open(page, settingsUrl);
      await selectPolicy(page, 'Sólo la organización');

      await open(page, teamUrl(ownTeamEntryId));
      await expect(page.getByText('Escudo del equipo')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^(Subir|Cambiar)$/ }).first(),
      ).toBeVisible();
    });

    test('habilita delegados y después todo el plantel', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      await open(page, settingsUrl);
      await selectPolicy(page, 'Delegados y capitanes');
      await page.reload();
      await expect(page.getByRole('radio', { name: /Delegados y capitanes/ })).toBeChecked();

      await selectPolicy(page, 'Todo el plantel');
      await page.reload();
      await expect(page.getByRole('radio', { name: /Todo el plantel/ })).toBeChecked();
      await testInfo.attach('política en Todo el plantel', {
        body: await page.screenshot({ fullPage: false }), contentType: 'image/png',
      });
    });
  });

  test.describe('el delegado gestiona sólo su equipo', () => {
    test.use({ actorRole: 'delegate' });

    test('ve los controles de su equipo y no alcanza otro', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      await open(page, teamUrl(ownTeamEntryId));
      await expect(page.getByText('Escudo del equipo')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^(Subir|Cambiar)$/ }).first(),
      ).toBeVisible();
      // Permiso visual, no administrativo.
      await expect(page.getByLabel('Nombre').first()).toBeDisabled();
      await testInfo.attach('delegado en su equipo', {
        body: await page.screenshot({ fullPage: false }), contentType: 'image/png',
      });

      await open(page, teamUrl(otherTeamEntryId));
      await expect(page).toHaveURL(/\/torneos(\?|$|\/)/);
    });
  });

  test.describe('el jugador del plantel', () => {
    test.use({ actorRole: 'player' });

    test('con la política en Todo el plantel gestiona las fotos de su equipo', async (
      { page, actor }, testInfo,
    ) => {
      requirePreparedActor(testInfo, actor);
      await open(page, `/torneos/organizacion/${organizationId}/equipos/${ownTeamEntryId}/plantel`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Subir foto|Cambiar/ }).first(),
      ).toBeVisible();
      await testInfo.attach('jugador en Plantel', {
        body: await page.screenshot({ fullPage: false }), contentType: 'image/png',
      });
    });
  });

  test.describe('el outsider', () => {
    test.use({ actorRole: 'outsider' });

    test('no alcanza el equipo en ninguna política', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      await open(page, teamUrl(ownTeamEntryId));
      await expect(page).toHaveURL(/\/torneos(\?|$|\/)/);
      await expect(page.getByText('Escudo del equipo')).toHaveCount(0);
    });
  });

  test.describe('volver a cerrar la autogestión', () => {
    test.use({ actorRole: 'owner' });

    test('deshabilitar deja las imágenes en su lugar', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      await open(page, settingsUrl);
      await selectPolicy(page, 'Sólo la organización');
      await page.reload();
      await expect(page.getByRole('radio', { name: /Sólo la organización/ })).toBeChecked();

      await open(page, teamUrl(ownTeamEntryId));
      // El escudo sigue ahí y la organización lo sigue gestionando.
      await expect(page.getByText('Escudo del equipo')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^(Subir|Cambiar)$/ }).first(),
      ).toBeVisible();
    });
  });

  test.describe('el delegado después de deshabilitar', () => {
    test.use({ actorRole: 'delegate' });

    test('sigue viendo el escudo pero pierde los CTA', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      await open(page, teamUrl(ownTeamEntryId));
      await expect(page.getByText('Escudo del equipo')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Subir' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Cambiar' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Quitar' })).toHaveCount(0);
      await testInfo.attach('delegado sin permiso', {
        body: await page.screenshot({ fullPage: false }), contentType: 'image/png',
      });
    });
  });
});
