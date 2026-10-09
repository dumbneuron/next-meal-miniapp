const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyReview } = require('../core/weeklyReview');

test('seven-day review counts genuine days and reusable meals, not calorie success', () => {
  const state = { meals: [
    { date: '2026-09-30', name: '旧餐', calories: 300 },
    { date: '2026-10-03', name: '鸡肉饭', calories: 600 },
    { date: '2026-10-05', name: '鸡肉饭', calories: 700, source: 'reused' },
    { date: '2026-10-05', name: '苹果', calories: 90 },
    { date: '2026-10-07', name: '汤', calories: 200 }
  ], dayReviews: [{ date: '2026-10-03' }, { date: '2026-10-04' }, { date: '2026-10-05' }] };
  const result = weeklyReview(state, '2026-10-07');
  assert.equal(result.effectiveDays, 3);
  assert.equal(result.completeDays, 2);
  assert.equal(result.mealCount, 4);
  assert.equal(result.reusedMeals, 1);
  assert.deepEqual(result.repeated, { name: '鸡肉饭', count: 2 });
  assert.equal(result.days.length, 7);
  assert.equal(result.days[0].date, '2026-10-01');
  assert.equal(result.days[6].recorded, true);
});

test('empty review gives an action without inventing a trend', () => {
  const result = weeklyReview({ meals: [], dayReviews: [] }, '2026-10-07');
  assert.equal(result.effectiveDays, 0);
  assert.equal(result.repeated, null);
  assert.match(result.message, /记录一餐/);
});
