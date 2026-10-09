const test = require('node:test');
const assert = require('node:assert/strict');
const { milestoneReview } = require('../core/milestoneReview');

test('five-day summary uses only meals from the first five distinct valid dates', () => {
  const meals = [
    { date: '2026-10-01', name: '米饭', calories: 200 },
    { date: '2026-10-01', name: '鸡蛋', calories: 80 },
    { date: '2026-10-02', name: '米饭', calories: 200, source: 'reused' },
    { date: '2026-10-03', name: '面条', calories: 400 },
    { date: '2026-10-04', name: '米饭', calories: 200 },
    { date: '2026-10-05', name: '香蕉', calories: 100 },
    { date: '2026-10-06', name: '牛肉饭', calories: 500 }
  ];
  const early = milestoneReview({ meals, dayReviews: [] }, '2026-10-04');
  assert.equal(early.firstFive.unlocked, false);
  const result = milestoneReview({ meals, dayReviews: [] }, '2026-10-06');
  assert.equal(result.firstFive.achievedOn, '2026-10-05');
  assert.equal(result.firstFive.mealCount, 6);
  assert.deepEqual(result.firstFive.repeated, { name: '米饭', count: 3 });
  assert.equal(result.firstFive.reusedMeals, 1);
  assert.equal(result.tenComplete.unlocked, false);
});

test('ten-day report counts distinct confirmed meal dates, not empty confirmations', () => {
  const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const meals = dates.slice(0, 10).map((date, i) => ({ date, name: '普通午餐', calories: 450, source: i < 3 ? 'reused' : 'manual' }));
  const dayReviews = [...dates.map(date => ({ date, at: date + 'T12:00:00.000Z' })), { date: dates[0], at: '2026-10-01T18:00:00.000Z' }];
  const result = milestoneReview({ meals, dayReviews }, '2026-10-12');
  assert.equal(result.tenComplete.unlocked, true);
  assert.equal(result.tenComplete.achievedOn, '2026-10-10');
  assert.equal(result.tenComplete.mealCount, 10);
  assert.equal(result.tenComplete.reusedMeals, 3);
});
