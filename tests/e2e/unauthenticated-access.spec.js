const { test, expect } = require('./fixtures/qa-test');

test.describe('Torneos without a session', () => {
  test('redirects /torneos to login and preserves returnTo', async ({ page }) => {
    await page.goto('/torneos?source=qa#access');

    await expect(page).toHaveURL((url) => (
      url.pathname === '/login'
      && url.searchParams.get('returnTo') === '/torneos?source=qa#access'
    ));
    await expect(page.getByRole('button', { name: 'Continuar con email' })).toBeVisible();
  });

  for (const protectedRoute of [
    '/',
    '/torneos/mis-torneos',
    '/torneos/nueva-organizacion',
    '/torneos/organizacion/qa-placeholder/inicio',
  ]) {
    test(`route guard protects ${protectedRoute}`, async ({ page }) => {
      await page.goto(protectedRoute);
      await expect(page).toHaveURL((url) => (
        url.pathname === '/login'
        && url.searchParams.get('returnTo') === protectedRoute
      ));
    });
  }

  test('supports basic login-shell navigation without horizontal overflow', async ({ page }) => {
    await page.goto('/torneos');
    const emailButton = page.getByRole('button', { name: 'Continuar con email' });
    await emailButton.click();
    await expect(page.getByPlaceholder('tu@email.com')).toBeVisible();
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(emailButton).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      body: {
        clientWidth: document.body.clientWidth,
        scrollWidth: document.body.scrollWidth,
      },
    }));
    expect(dimensions.document.scrollWidth).toBeLessThanOrEqual(
      dimensions.document.clientWidth + 1,
    );
    expect(dimensions.body.scrollWidth).toBeLessThanOrEqual(
      dimensions.body.clientWidth + 1,
    );
  });

  test('captures the unauthenticated state in every configured viewport', async ({
    page,
  }, testInfo) => {
    await page.goto('/torneos');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Ftorneos$/);
    const screenshot = await page.screenshot({
      path: testInfo.outputPath(`torneos-unauthenticated-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await testInfo.attach(`viewport ${testInfo.project.name}`, {
      body: screenshot,
      contentType: 'image/png',
    });
  });
});
