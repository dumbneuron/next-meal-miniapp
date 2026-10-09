const test = require('node:test');
const assert = require('node:assert/strict');
const { progress } = require('../core/badges');

test('five effective and ten complete days are cumulative, not calorie dependent', () => {
  const meals = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, name: '记录', calories: i % 2 ? 3000 : 300 }));
  const state = { meals, dayReviews: meals.map(meal => ({ date: meal.date, at: '2026-10-10T12:00:00Z' })) };
  const result = progress(state, '2026-10-10');
  assert.equal(result.effectiveDays, 10);
  assert.equal(result.completeDays, 10);
  assert.equal(result.badges[0].unlocked, true);
  assert.equal(result.badges[1].unlocked, true);
  assert.equal(result.badges[0].progressPercent, 100);
  assert.equal(result.badges[1].progressPercent, 100);
  assert.equal(result.todayComplete, true);
});
test('duplicate meals and empty self-review do not inflate day counts', () => {
  const result = progress({ meals: [{ date: '2026-10-07' }, { date: '2026-10-07' }], dayReviews: [{ date: '2026-10-07' }, { date: '2026-10-08' }] }, '2026-10-08');
  assert.equal(result.effectiveDays, 1);
  assert.equal(result.completeDays, 1);
  assert.equal(result.todayComplete, false);
  assert.equal(result.badges[0].progressPercent, 20);
  assert.equal(result.badges[1].progressPercent, 10);
});
