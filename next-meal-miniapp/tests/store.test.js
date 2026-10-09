const test = require('node:test');
const assert = require('node:assert/strict');
const data = new Map();
global.wx = { getStorageSync: key => data.get(key), setStorageSync: (key, value) => data.set(key, structuredClone(value)) };
const store = require('../services/store');
const { buildPlan, resolveDay, swapDays } = require('../core/plan');

test('local state persists, updates same-day weight, exports and imports', () => {
  data.clear();
  assert.equal(store.ensureState().version, 2);
  store.setGoal({ calories: 1800, protein: 100, confirmedAt: '2026-10-07T00:00:00.000Z' });
  store.setGoal({ calories: 1750, protein: 100, confirmedAt: '2026-10-08T00:00:00.000Z' });
  store.addMeal({ date: '2026-10-07', name: '午饭', calories: 500 });
  store.upsertWeight('2026-10-07', 70);
  store.upsertWeight('2026-10-07', 69.8);
  assert.equal(store.ensureState().weights.length, 1);
  assert.equal(store.ensureState().weights[0].kg, 69.8);
  const backup = store.exportJson();
  data.clear();
  store.importJson(backup);
  assert.equal(store.ensureState().meals.length, 1);
  assert.equal(store.ensureState().goal.calories, 1750);
  assert.deepEqual(store.ensureState().goalHistory.map(g => g.calories), [1750, 1800]);
  store.deleteMeal(store.ensureState().meals[0].id);
  assert.equal(store.ensureState().meals.length, 0);
});
test('malformed backup rejects without overwriting state', () => {
  const before = store.exportJson();
  assert.throws(() => store.importJson('{"version":3,"meals":[],"weights":[]}'));
  assert.equal(store.exportJson(), before);
});
test('version 1 local state migrates without losing meals and weights', () => {
  data.clear();
  data.set(store.LEGACY_KEY, { version: 1, goal: { calories: 1800 }, meals: [{ id: 'm1', date: '2026-10-07', name: '米饭', calories: 300 }], weights: [{ date: '2026-10-07', kg: 70 }] });
  const state = store.ensureState();
  assert.equal(state.version, 2);
  assert.equal(state.meals.length, 1);
  assert.equal(state.weights.length, 1);
  assert.equal(data.get(store.KEY).version, 2);
});
test('plan activation, day swap and context persist across reads', () => {
  data.clear();
  const plan = buildPlan({ mode: 'cycle', startDate: '2026-10-07', base: { calories: 2000, protein: 130, carbs: 220, fat: 65 }, pattern: 'four', lowCarbs: 150, highCarbs: 300 });
  store.setPlan(plan);
  store.setDayContext('2026-10-07', 'training');
  store.recordEvent('context_set');
  const swapped = swapDays(store.ensureState().activePlan, '2026-10-07', '2026-10-10');
  store.updateActivePlan(swapped);
  assert.equal(resolveDay(store.ensureState().activePlan, '2026-10-07').type, 'high');
  assert.equal(store.ensureState().dayContexts['2026-10-07'], 'training');
  assert.equal(store.ensureState().events[0].type, 'context_set');
  assert.equal(store.ensureState().planHistory.length, 1);
});
test('daily completion is idempotent and is removed if its last meal is deleted', () => {
  data.clear();
  assert.throws(() => store.completeDay('2026-10-07'));
  store.addMeal({ date: '2026-10-07', name: '一餐', calories: 550 });
  store.completeDay('2026-10-07');
  store.completeDay('2026-10-07');
  assert.equal(store.ensureState().dayReviews.length, 1);
  store.deleteMeal(store.ensureState().meals[0].id);
  assert.equal(store.ensureState().dayReviews.length, 0);
});
test('remote snapshot keeps a local mutation made while sync response was in flight', () => {
  data.clear();
  store.addMeal({ date: '2026-10-07', name: '先记录', calories: 500 });
  const first = store.ensureState().pendingMutations[0];
  store.addMeal({ date: '2026-10-07', name: '网络请求中又记录', calories: 600 });
  store.applyRemoteSnapshot({ profile: {}, goal: null, activePlan: null, planHistory: [], meals: [first.payload], weights: [], dayReviews: [], dayContexts: [], badgeAwards: [] }, [first.id]);
  assert.equal(store.ensureState().meals.length, 2);
  assert.equal(store.ensureState().pendingMutations.length, 1);
});
test('a stale local plan adjustment can be removed without discarding meal changes', () => {
  data.clear();
  const plan = buildPlan({ mode: 'steady', startDate: '2026-10-07', base: { calories: 2000, protein: 130, carbs: 220, fat: 65 } });
  store.setPlan(plan);
  store.updateActivePlan(store.ensureState().activePlan);
  store.addMeal({ date: '2026-10-07', name: '晚餐', calories: 600 });
  assert.equal(store.dropPendingPlanUpdates(), 1);
  assert.equal(store.ensureState().pendingMutations.some(m => m.type === 'meal_upsert'), true);
});
