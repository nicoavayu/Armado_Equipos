// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Call to Vote Flow', () => {
  test('success: redirect to voting view with codigo param', async ({ page }) => {
    await page.route('**/rest/v1/notifications_ext*', async (route) => {
      const url = route.request().url();
      expect(url).toContain('match_id_text=eq.');
      expect(url).not.toContain('data->>');
      
      await route.fulfill({
        status: 200,
        body: JSON.stringify([{ id: 1, match_id_text: '86' }]),
      });
    });

    await page.route('**/rest/v1/partidos*', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify([{ id: 86, codigo: 'ABC123' }]),
      });
    });

    await page.goto('/admin/86');
    await page.click('text=LLAMAR A VOTAR');
    await page.waitForURL('**/codigo=ABC123');
    
    expect(page.url()).toContain('codigo=ABC123');
  });

  test('error: show toast and stay on current route', async ({ page }) => {
    await page.route('**/rest/v1/notifications_ext*', async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ message: 'Error' }) });
    });

    await page.goto('/admin/86');
    const currentUrl = page.url();
    
    await page.click('text=LLAMAR A VOTAR');
    await page.waitForTimeout(1000);
    
    expect(page.url()).toBe(currentUrl);
    await expect(page.locator('text=No se pudo iniciar la votación')).toBeVisible();
  });

  test('no problematic JSONB operators', async ({ page }) => {
    const requests = [];
    page.on('request', (req) => {
      if (req.url().includes('/notifications')) requests.push(req.url());
    });

    await page.route('**/rest/v1/notifications_ext*', async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('/admin/86');
    await page.click('text=LLAMAR A VOTAR');
    await page.waitForTimeout(500);

    for (const url of requests) {
      expect(url).not.toContain('data->>');
      expect(url).not.toContain('data=cs.');
    }
  });
});
