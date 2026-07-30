const {
  test,
  expect,
  requirePreparedActor,
} = require('./fixtures/qa-test');

const organizationId = process.env.QA_TORNEOS_ORGANIZATION_ID || 'pending-demo-organization';

test.describe('prepared: authenticated Torneos shell', () => {
  test.describe('owner navigation', () => {
    test.use({ actorRole: 'owner' });

    test('navigates the desktop organization shell', async ({ page, actor }, testInfo) => {
      requirePreparedActor(testInfo, actor);
      testInfo.skip(
        testInfo.project.use.isMobile,
        'Desktop shell assertion runs only in desktop/tablet projects.',
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

  for (const role of ['admin', 'delegate', 'player', 'outsider', 'collaborator']) {
    test.describe(`${role} route guard`, () => {
      test.use({ actorRole: role });

      test(`applies the real ${role} access contract`, async ({ page, actor }, testInfo) => {
        requirePreparedActor(testInfo, actor);
        await page.goto(`/torneos/organizacion/${organizationId}/configuracion`);

        if (role === 'admin') {
          await expect(page.locator('#torneos-main')).toBeVisible();
        } else {
          await expect(page).toHaveURL(/\/torneos(?:\/)?$/);
        }
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
