import { test, expect } from '@playwright/test';

test('health check endpoint returns ok', async ({ request }) => {
  const response = await request.get('http://localhost:5011/');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
});
