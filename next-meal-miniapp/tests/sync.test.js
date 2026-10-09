const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../../next-meal-platform/server');
const runtime = require('../config/runtime');
const store = require('../services/store');
const sync = require('../services/sync');

test('two simulated devices share data and offline mutations survive a failed sync', async () => {
  const { server, setupToken } = startServer({ database: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(base + '/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupToken, username: 'admin', password: 'strong-test-password-123' }) });
  const adminSession = await (await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'strong-test-password-123' }) })).json();
  runtime.METHOD_API_BASE = base;
  const a = new Map(), b = new Map();
  let active = a, offline = false;
  global.wx = {
    getStorageSync: key => active.get(key),
    setStorageSync: (key, value) => active.set(key, structuredClone(value)),
    removeStorageSync: key => active.delete(key),
    request: ({ url, method, header, data, success, fail }) => {
      if (offline) { queueMicrotask(() => fail(new Error('offline'))); return; }
      fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(header || {}) }, body: data ? JSON.stringify(data) : undefined })
        .then(async response => success({ statusCode: response.status, data: await response.json() })).catch(fail);
    }
  };
  const pair = async userId => {
    const response = await fetch(base + '/api/admin/pairings', { method: 'POST', headers: { Authorization: 'Bearer ' + adminSession.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userId || null }) });
    return response.json();
  };
  try {
    store.addMeal({ date: '2026-10-07', type: 'lunch', name: '本机午餐', calories: 600, protein: 30, carbs: 70, fat: 20 });
    store.upsertWeight('2026-10-07', 70);
    const first = await pair();
    await sync.pairDevice(first.code);
    assert.equal(sync.status().pending, 0);
    assert.equal(store.ensureState().meals.length, 1);
    active = b;
    const second = await pair(first.userId);
    await sync.pairDevice(second.code);
    assert.equal(store.ensureState().meals.length, 1);
    assert.equal(store.ensureState().weights[0].kg, 70);
    offline = true;
    store.addMeal({ date: '2026-10-07', type: 'dinner', name: '离线晚餐', calories: 700, protein: 30, carbs: 80, fat: 25 });
    await assert.rejects(sync.syncNow(), /后台连接中断/);
    assert.equal(store.ensureState().pendingMutations.length, 1);
    offline = false;
    await sync.syncNow();
    assert.equal(store.ensureState().pendingMutations.length, 0);
    active = a;
    await sync.syncNow();
    assert.deepEqual(store.ensureState().meals.map(meal => meal.name).sort(), ['本机午餐', '离线晚餐']);
    const linked = await sync.devices();
    assert.equal(linked.length, 2);
    await sync.revokeDevice(linked.find(device => !device.current).id);
    active = b;
    await assert.rejects(sync.syncNow(), /会话已失效/);
    assert.equal(sync.status().needsPairing, true);
    sync.forgetExpiredSession();
    assert.equal(sync.status().paired, false);
    const wrongUser = await pair();
    await assert.rejects(sync.pairDevice(wrongUser.code), /其他用户/);
    assert.equal(store.ensureState().meals.length, 2);
    const recovered = await pair(first.userId);
    await sync.pairDevice(recovered.code);
    assert.equal(sync.status().paired, true);
    const recoveredToken = b.get(sync.SESSION_KEY).token;
    await sync.disconnect();
    assert.equal(sync.status().paired, false);
    assert.equal(store.ensureState().meals.length, 0);
    const loggedOutResponse = await fetch(base + '/api/user/snapshot', { headers: { Authorization: 'Bearer ' + recoveredToken } });
    assert.equal(loggedOutResponse.status, 401);
    active = a;
    await sync.deleteAccount();
    assert.equal(store.ensureState().meals.length, 0);
    assert.equal(sync.status().paired, false);
    active = b;
    await assert.rejects(sync.syncNow(), /先用后台配对码/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
