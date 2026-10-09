const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../server');

async function serve(database) {
  const { server, setupToken } = startServer({ database });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', body, token) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { server, setupToken, base, request, close: () => new Promise(resolve => server.close(resolve)) };
}

test('admin bootstrap, login, logout, password rotation and restart persistence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'next-meal-auth-'));
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  const database = path.join(directory, 'auth.sqlite');
  let app = await serve(database);
  try {
    assert.equal((await app.request('/api/admin/status')).data.setupRequired, true);
    assert.equal((await app.request('/api/admin/methods')).status, 401);
    assert.equal((await app.request('/api/admin/pairings', 'POST', {})).status, 401);
    assert.equal((await app.request('/api/admin/methods', 'GET', undefined, 'old-startup-secret')).status, 401);
    assert.equal((await app.request('/api/admin/setup', 'POST', { setupToken: 'b'.repeat(48), username: 'owner', password: 'long-test-password-123' })).status, 403);
    assert.equal((await app.request('/api/admin/setup', 'POST', { setupToken: app.setupToken, username: 'owner', password: 'short' })).status, 400);
    assert.equal((await app.request('/api/admin/setup', 'POST', { setupToken: app.setupToken, username: 'owner', password: 'long-test-password-123' })).status, 201);
    assert.equal((await app.request('/api/admin/status')).data.setupRequired, false);
    assert.equal((await app.request('/api/admin/setup', 'POST', { setupToken: app.setupToken, username: 'other', password: 'long-test-password-123' })).status, 403);
    assert.equal((await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'wrong-password' })).status, 401);
    const first = await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'long-test-password-123' });
    assert.equal(first.status, 200);
    assert.match(first.data.token, /^[a-f0-9]{64}$/);
    assert.equal((await app.request('/api/admin/me', 'GET', undefined, first.data.token)).data.username, 'owner');
    const second = (await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'long-test-password-123' })).data.token;
    assert.equal((await app.request('/api/admin/logout', 'POST', {}, first.data.token)).status, 200);
    assert.equal((await app.request('/api/admin/me', 'GET', undefined, first.data.token)).status, 401);
    assert.equal((await app.request('/api/admin/methods', 'GET', undefined, second)).status, 200);
    assert.equal((await app.request('/api/admin/password', 'POST', { currentPassword: 'wrong', newPassword: 'even-better-password-123' }, second)).status, 400);
    assert.equal((await app.request('/api/admin/password', 'POST', { currentPassword: 'long-test-password-123', newPassword: 'even-better-password-123' }, second)).status, 200);
    assert.equal((await app.request('/api/admin/me', 'GET', undefined, second)).status, 401);
    assert.equal((await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'long-test-password-123' })).status, 401);
    assert.equal((await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'even-better-password-123' })).status, 200);
    const html = await fetch(app.base + '/admin');
    assert.match(html.headers.get('content-security-policy'), /script-src 'nonce-/);
    assert.match(await html.text(), /id="workspace" hidden/);
    await app.close(); app = null;
    app = await serve(database);
    assert.equal(app.setupToken, null);
    assert.equal((await app.request('/api/admin/status')).data.setupRequired, false);
    assert.equal((await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'even-better-password-123' })).status, 200);
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('repeated wrong passwords temporarily lock the account', async () => {
  const app = await serve(':memory:');
  try {
    await app.request('/api/admin/setup', 'POST', { setupToken: app.setupToken, username: 'owner', password: 'long-test-password-123' });
    for (let n = 0; n < 5; n++) assert.equal((await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'incorrect-password' })).status, 401);
    assert.equal((await app.request('/api/admin/login', 'POST', { username: 'owner', password: 'long-test-password-123' })).status, 401);
  } finally { await app.close(); }
});
