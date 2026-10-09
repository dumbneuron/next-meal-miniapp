const test = require('node:test');
const assert = require('node:assert/strict');
const { dateKey, validKey, shiftKey } = require('../core/date');
const { macroCalories, sumMeals } = require('../core/nutrition');
const { windowStats, review } = require('../core/review');
const { recommendations } = require('../core/nextMeal');

test('date keys remain calendar-correct across month boundaries', () => {
  assert.equal(shiftKey('2026-03-01', -1), '2026-02-28');
  assert.equal(validKey('2026-02-30'), false);
  assert.equal(dateKey(new Date('2026-10-07T12:00:00')), '2026-10-07');
});
test('macro arithmetic remains independent of a manually confirmed goal', () => {
  assert.equal(macroCalories({ protein: 100, carbs: 200, fat: 50 }), 1650);
  assert.deepEqual(sumMeals([{ calories: 300, protein: 20, carbs: 30, fat: 10 }, { calories: 200, protein: 12, carbs: 20, fat: 8 }]), { calories: 500, protein: 32, carbs: 50, fat: 18 });
});
test('weight windows use unique real days, not record count or missing-day zeroes', () => {
  const weights = [
    { date: '2026-10-01', kg: 70 }, { date: '2026-10-01', kg: 69 },
    { date: '2026-10-03', kg: 68 }, { date: '2026-09-25', kg: 71 }
  ];
  assert.deepEqual(windowStats(weights, '2026-10-07', 7), { start: '2026-10-01', end: '2026-10-07', count: 2, expected: 7, average: 68.5 });
  const result = review(weights, [], '2026-10-07');
  assert.equal(result.ready, false);
  assert.equal(result.delta, null);
});
test('review waits for four recorded days in each seven-day window', () => {
  const weights = [];
  ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'].forEach(date => weights.push({ date, kg: 70 }));
  ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].forEach(date => weights.push({ date, kg: 69 }));
  const result = review(weights, [{ date: '2026-10-01' }], '2026-10-07');
  assert.equal(result.ready, true);
  assert.equal(result.delta, -1);
  assert.equal(result.loggedDays, 1);
});
test('next meal uses only prior personal meals and deduplicates by name', () => {
  const history = [
    { date: '2026-10-07', type: 'lunch', name: '今天的午饭', calories: 300, protein: 20 },
    { date: '2026-10-01', type: 'lunch', name: '鸡蛋饭', calories: 400, protein: 25 },
    { date: '2026-10-05', type: 'lunch', name: '鸡蛋饭', calories: 450, protein: 30 },
    { date: '2026-10-02', type: 'dinner', name: '米粉', calories: 500, protein: 10 }
  ];
  assert.deepEqual(recommendations(history, '2026-10-07', { calories: 1800, protein: 100 }, { calories: 1000, protein: 40 }, 'lunch').map(x => x.name), ['鸡蛋饭']);
  assert.deepEqual(recommendations([], '2026-10-07', null, {}, 'lunch'), []);
});
