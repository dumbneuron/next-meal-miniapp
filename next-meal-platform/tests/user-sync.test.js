const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../server');
const { buildPlan } = require('../../next-meal-miniapp/core/plan');

test('pairing is one-time, user data is isolated, mutations are idempotent and badges follow records', async () => {
  const { server, setupToken } = startServer({ database: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', body, token) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  try {
    await request('/api/admin/setup', 'POST', { setupToken, username: 'admin', password: 'strong-test-password-123' });
    const adminToken = (await request('/api/admin/login', 'POST', { username: 'admin', password: 'strong-test-password-123' })).data.token;
    const first = (await request('/api/admin/pairings', 'POST', {}, adminToken)).data;
    const second = (await request('/api/admin/pairings', 'POST', {}, adminToken)).data;
    const a = (await request('/api/pair/redeem', 'POST', { code: first.code })).data;
    const b = (await request('/api/pair/redeem', 'POST', { code: second.code })).data;
    assert.equal((await request('/api/pair/redeem', 'POST', { code: first.code })).status, 400);
    assert.equal((await request('/api/user/snapshot')).status, 401);
    const mutations = [
      { id: 'profile_a_01', type: 'profile_set', payload: { age: 28, weightKg: 80 } },
      { id: 'weight_a_01', type: 'weight_upsert', payload: { date: '2026-10-01', kg: 80 } }
    ];
    for (let i = 1; i <= 10; i++) {
      const date = `2026-10-${String(i).padStart(2, '0')}`;
      mutations.push({ id: `meal_a_${String(i).padStart(2, '0')}`, type: 'meal_upsert', payload: { id: `meal-${i}`, date, name: '正常餐食', calories: i % 2 ? 3000 : 500 } });
      mutations.push({ id: `day_a_${String(i).padStart(2, '0')}`, type: 'day_complete', payload: { date } });
    }
    const synced = await request('/api/user/sync', 'POST', { mutations }, a.token);
    assert.equal(synced.status, 200);
    assert.equal(synced.data.snapshot.meals.length, 10);
    assert.equal(synced.data.snapshot.badgeAwards.length, 2);
    assert.equal((await request('/api/user/sync', 'POST', { mutations }, a.token)).data.snapshot.meals.length, 10);
    const other = (await request('/api/user/snapshot', 'GET', null, b.token)).data.snapshot;
    assert.equal(other.meals.length, 0);
    assert.deepEqual(other.profile, {});
    const anotherCode = (await request('/api/admin/pairings', 'POST', { userId: a.userId }, adminToken)).data;
    const secondDevice = (await request('/api/pair/redeem', 'POST', { code: anotherCode.code })).data;
    assert.equal(secondDevice.userId, a.userId);
    assert.equal((await request('/api/user/snapshot', 'GET', null, secondDevice.token)).data.snapshot.meals.length, 10);
    const linkedDevices = (await request('/api/user/devices', 'GET', null, a.token)).data.devices;
    assert.equal(linkedDevices.length, 2);
    assert.equal(linkedDevices.filter(device => device.current).length, 1);
    assert.equal((await request('/api/user/devices/revoke', 'POST', { deviceId: linkedDevices.find(device => !device.current).id }, b.token)).status, 400);
    const deleted = await request('/api/user/sync', 'POST', { mutations: [{ id: 'delete_meal_01', type: 'meal_delete', payload: { id: 'meal-1' } }] }, secondDevice.token);
    assert.equal(deleted.data.snapshot.meals.length, 9);
    assert.equal(deleted.data.snapshot.dayReviews.length, 9);
    assert.equal(deleted.data.snapshot.badgeAwards.some(award => award.id === 'ten-complete'), false);
    const moved = await request('/api/user/sync', 'POST', { mutations: [{ id: 'move_meal_02', type: 'meal_upsert',
      payload: { id: 'meal-2', date: '2026-10-01', name: '移动到前一天', calories: 500 } }] }, secondDevice.token);
    assert.equal(moved.status, 200);
    assert.equal(moved.data.snapshot.meals.length, 9);
    assert.equal(moved.data.snapshot.dayReviews.length, 8);
    assert.equal(moved.data.snapshot.meals.find(meal => meal.id === 'meal-2').date, '2026-10-01');
    assert.equal((await request('/api/user/export', 'GET', null, a.token)).data.export.meals.length, 9);
    assert.equal((await request('/api/user/devices/revoke', 'POST', { deviceId: linkedDevices.find(device => !device.current).id }, a.token)).status, 200);
    assert.equal((await request('/api/user/snapshot', 'GET', null, secondDevice.token)).status, 401);
    assert.equal((await request('/api/user/delete', 'POST', { confirm: 'DELETE' }, a.token)).data.deleted, true);
    assert.equal((await request('/api/user/snapshot', 'GET', null, secondDevice.token)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('stale plan adjustment receives an explicit conflict instead of overwriting a newer plan', async () => {
  const { server, setupToken } = startServer({ database: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, token) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    await request('/api/admin/setup', { setupToken, username: 'admin', password: 'strong-test-password-123' });
    const adminToken = (await request('/api/admin/login', { username: 'admin', password: 'strong-test-password-123' })).data.token;
    const code = (await request('/api/admin/pairings', {}, adminToken)).data.code;
    const session = (await request('/api/pair/redeem', { code })).data;
    const basePlan = { calories: 2000, protein: 130, carbs: 220, fat: 65 };
    const oldPlan = Object.assign(buildPlan({ mode: 'steady', startDate: '2026-10-07', base: basePlan }), { instanceId: 'plan-old-001' });
    const newPlan = Object.assign(buildPlan({ mode: 'steady', startDate: '2026-10-07', base: basePlan }), { instanceId: 'plan-new-001' });
    assert.equal((await request('/api/user/sync', { mutations: [{ id: 'plan_set_old_01', type: 'plan_set', payload: oldPlan }] }, session.token)).status, 200);
    assert.equal((await request('/api/user/sync', { mutations: [{ id: 'plan_set_new_01', type: 'plan_set', payload: newPlan }] }, session.token)).status, 200);
    const stale = await request('/api/user/sync', { mutations: [{ id: 'plan_update_old_01', type: 'plan_update', payload: oldPlan }] }, session.token);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'PLAN_CONFLICT');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
