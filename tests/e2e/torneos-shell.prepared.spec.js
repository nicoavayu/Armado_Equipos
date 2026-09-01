const {
  test,
  expect,
  requirePreparedActor,
} = require('./fixtures/qa-test');

const organizationId = process.env.QA_TORNEOS_ORGANIZATION_ID || 'pending-demo-organization';
const organizationBase = `/torneos/organizacion/${organizationId}`;

async function expectEditableSettings(page, { canArchive }) {
  await expect(page).toHaveURL(new RegExp(`${organizationBase}/configuracion$`));
  await expect(page.locator('#torneos-main')).toBeVisible();
  await expect(page.getByLabel('Nombre')).toBeEnabled();
  await expect(page.getByLabel('Identificador')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeVisible();
  const archiveHeading = page.getByRole('heading', { name: 'Archivar organización' });
  if (canArchive) await expect(archiveHeading).toBeVisible();
  else await expect(archiveHeading).toHaveCount(0);
}

test.describe('prepared: authenticated Torneos shell', () => {
  test.describe('owner navigation', () => {
    test.use({ actorRole: 'owner' });

    test('navigates the desktop organization shell', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      testInfo.skip(
        testInfo.project.use.viewport.width < 1100,
        'The full organization rail is only visible at desktop width.',
      );

      await page.goto(`/torneos/organizacion/${organizationId}/inicio`);
      const navigation = page.getByRole('navigation', {
        name: 'Navegación de la organización',
      });
      await expect(navigation).toBeVisible();
      await navigation.getByRole('link', { name: 'Torneos' }).click();
      await expect(page).toHaveURL(
        new RegExp(`/torneos/organizacion/${organizationId}/torneos$`),
      );

      await navigation.getByRole('link', { name: 'Configuración' }).click();
      await expectEditableSettings(page, { canArchive: true });
    });

    test('opens and closes a real application modal', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      const triggerName = String(process.env.QA_TORNEOS_MODAL_TRIGGER_NAME || '').trim();
      testInfo.skip(
        !triggerName,
        'QA_TORNEOS_MODAL_TRIGGER_NAME must identify a real seeded modal trigger.',
      );

      await page.goto(`/torneos/organizacion/${organizationId}/competencia/estadisticas`);
      await page.getByRole('button', { name: new RegExp(triggerName, 'i') }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    });
  });

  for (const role of ['owner', 'admin']) {
    test.describe(`${role} route guard`, () => {
      test.use({ actorRole: role });

      test(`allows ${role} to open, edit and refresh settings`, async ({ page, actor }, testInfo) => {
        requirePreparedActor(testInfo, actor);
        await page.goto(`${organizationBase}/configuracion`);
        await expectEditableSettings(page, { canArchive: role === 'owner' });
        await page.reload();
        await expectEditableSettings(page, { canArchive: role === 'owner' });
      });
    });
  }

  test.describe('collaborator read-only settings', () => {
    test.use({ actorRole: 'collaborator' });

    test('opens settings by direct URL and stays read-only after refresh', async ({
      page,
      actor,
    }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      const mutationRequests = [];
      const workspaceRequestPromise = page.waitForRequest((request) => (
        /\/rest\/v1\/rpc\/get_tournament_workspace_context(?:\?|$)/.test(request.url())
      ));
      page.on('request', (request) => {
        if (/\/rpc\/update_tournament_organization(?:\?|$)/.test(request.url())) {
          mutationRequests.push(request.url());
        }
      });

      await page.goto(`${organizationBase}/configuracion`);
      const workspaceRequest = await workspaceRequestPromise;
      await expect(page).toHaveURL(new RegExp(`${organizationBase}/configuracion$`));
      await expect(page.getByText(/Modo lectura/)).toBeVisible();
      await expect(page.getByLabel('Nombre')).toBeDisabled();
      await expect(page.getByLabel('Identificador')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Archivar organización' })).toHaveCount(0);

      const workspaceHeaders = await workspaceRequest.allHeaders();
      const workspaceRpcUrl = new URL(workspaceRequest.url());
      const forbiddenResponse = await page.request.post(
        `${workspaceRpcUrl.origin}/rest/v1/rpc/update_tournament_organization`,
        {
          headers: {
            apikey: workspaceHeaders.apikey,
            authorization: workspaceHeaders.authorization,
            'content-type': 'application/json',
          },
          data: {
            p_organization_id: organizationId,
            p_name: null,
            p_slug: null,
            p_status: null,
          },
        },
      );
      expect(forbiddenResponse.status()).toBe(403);
      expect(await forbiddenResponse.text()).toContain('TORNEOS_ORGANIZATION_FORBIDDEN');

      await page.getByRole('link', { name: 'Plan' }).click();
      await expect(page).toHaveURL(new RegExp(`${organizationBase}/configuracion/plan$`));
      await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Pasar a PRO|Gestionar plan/ })).toBeDisabled();

      await page.getByRole('link', { name: 'Miembros' }).click();
      await expect(page).toHaveURL(new RegExp(`${organizationBase}/miembros$`));
      await expect(page.getByRole('heading', { name: 'Miembros' })).toBeVisible();
      await expect(page.getByText(/sin realizar cambios administrativos/i).first()).toBeVisible();
      await expect(page.getByText('Owner', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Admin', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Collaborator', { exact: true })).toHaveCount(0);

      await page.goto(`${organizationBase}/configuracion`);
      await page.reload();
      await expect(page.getByText(/Modo lectura/)).toBeVisible();
      expect(mutationRequests).toEqual([]);
    });

    test('reaches settings through visible organization navigation', async ({
      page,
      actor,
    }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      testInfo.skip(
        testInfo.project.use.viewport.width < 1100,
        'The normal-navigation assertion uses the visible desktop organization rail.',
      );

      await page.goto(`${organizationBase}/inicio`);
      const navigation = page.getByRole('navigation', {
        name: 'Navegación de la organización',
      });
      await navigation.getByRole('link', { name: 'Configuración' }).click();
      await expect(page).toHaveURL(new RegExp(`${organizationBase}/configuracion$`));
      await expect(page.getByText(/Modo lectura/)).toBeVisible();
    });
  });

  for (const role of ['delegate', 'player', 'outsider']) {
    test.describe(`${role} route guard`, () => {
      test.use({ actorRole: role });

      test(`denies organization settings to ${role} by direct URL and refresh`, async ({
        page,
        actor,
      }, testInfo) => {
        requirePreparedActor(testInfo, actor);
        await page.goto(`${organizationBase}/configuracion`);
        await expect(page).toHaveURL(/\/torneos(?:\/)?$/);
        await page.goto(`${organizationBase}/configuracion`);
        await page.reload();
        await expect(page).toHaveURL(/\/torneos(?:\/)?$/);
      });
    });
  }

  test.describe('mobile organization navigation', () => {
    test.use({ actorRole: 'owner' });

    test('uses the mobile navigation at the three mobile widths', async ({
      page,
      actor,
    }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      testInfo.skip(
        !testInfo.project.use.isMobile,
        'Mobile navigation assertion runs only in mobile projects.',
      );

      await page.goto(`/torneos/organizacion/${organizationId}/inicio`);
      const navigation = page.getByRole('navigation', {
        name: 'Navegación móvil de la organización',
      });
      await expect(navigation).toBeVisible();
      await navigation.getByRole('link', { name: 'Equipos' }).click();
      await expect(page).toHaveURL(
        new RegExp(`/torneos/organizacion/${organizationId}/equipos$`),
      );
    });
  });
});
