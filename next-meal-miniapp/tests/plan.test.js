const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, resolveDay, preview, swapDays, isUsablePlan } = require('../core/plan');
const base = { calories: 2000, protein: 130, carbs: 220, fat: 65 };

test('steady mode repeats the manually confirmed goal', () => {
  const plan = buildPlan({ mode: 'steady', startDate: '2026-10-07', base });
  assert.equal(resolveDay(plan, '2026-10-14').calories, 2000);
  assert.equal(preview(plan, '2026-10-07', 7).difference, 0);
});
test('taper stages change only manually chosen carbohydrate step', () => {
  const plan = buildPlan({ mode: 'taper', startDate: '2026-10-07', base, stageDays: 7, stepGrams: 20 });
  assert.deepEqual(['2026-10-07', '2026-10-14', '2026-10-21'].map(d => resolveDay(plan, d).carbs), [220, 200, 180]);
  assert.deepEqual(['2026-10-07', '2026-10-14', '2026-10-21'].map(d => resolveDay(plan, d).calories), [2000, 1920, 1840]);
  assert.throws(() => buildPlan({ mode: 'taper', startDate: '2026-10-07', base, stageDays: 7, stepGrams: 150 }));
});
test('cycle pattern resolves dates and swaps day types without changing 4-day total', () => {
  const plan = buildPlan({ mode: 'cycle', startDate: '2026-10-07', base, pattern: 'four', lowCarbs: 150, highCarbs: 300 });
  assert.deepEqual(preview(plan, '2026-10-07', 4).days.map(d => d.type), ['low', 'low', 'low', 'high']);
  const total = preview(plan, '2026-10-07', 4).calories;
  const swapped = swapDays(plan, '2026-10-07', '2026-10-10');
  assert.deepEqual(preview(swapped, '2026-10-07', 4).days.map(d => d.type), ['high', 'low', 'low', 'low']);
  assert.equal(preview(swapped, '2026-10-07', 4).calories, total);
  assert.equal(plan.overrides['2026-10-07'], undefined);
});
test('six-day cycle and numeric boundaries are validated', () => {
  const plan = buildPlan({ mode: 'cycle', startDate: '2026-10-07', base, pattern: 'six', lowCarbs: 140, midCarbs: 220, highCarbs: 300 });
  assert.deepEqual(preview(plan, '2026-10-07', 6).days.map(d => d.type), ['low', 'low', 'mid', 'low', 'low', 'high']);
  assert.throws(() => buildPlan({ mode: 'cycle', startDate: '2026-10-07', base, pattern: 'six', lowCarbs: 240, midCarbs: 220, highCarbs: 300 }));
});
test('stored plans reject corrupted configuration or illegal overrides', () => {
  const plan = buildPlan({ mode: 'cycle', startDate: '2026-10-07', base, pattern: 'four', lowCarbs: 150, highCarbs: 300 });
  assert.equal(isUsablePlan(plan), true);
  assert.equal(isUsablePlan(Object.assign({}, plan, { config: { pattern: 'unknown' } })), false);
  assert.equal(isUsablePlan(Object.assign({}, plan, { overrides: { '2026-10-08': 'stage2' } })), false);
});
