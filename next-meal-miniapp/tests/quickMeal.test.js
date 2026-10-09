const test = require('node:test');
const assert = require('node:assert/strict');
const { quickMeals, searchQuickMeals, scaleMeal } = require('../core/quickMeal');

test('recent meals are deduplicated and current-day entries are not suggested', () => {
  const history = [
    { id: 'today', date: '2026-10-07', type: 'lunch', name: '米饭', calories: 500 },
    { id: 'a', date: '2026-10-06', type: 'lunch', name: '米饭', calories: 480 },
    { id: 'b', date: '2026-10-05', type: 'lunch', name: '米饭', calories: 430 },
    { id: 'c', date: '2026-10-04', type: 'dinner', name: '米饭', calories: 450 }
  ];
  assert.deepEqual(quickMeals(history, '2026-10-07').map(meal => meal.id), ['a', 'c']);
});

test('quick search finds prior meals without reusing current-day entries', () => {
  const history = [
    { id: 'today', date: '2026-10-07', type: 'lunch', name: '牛肉饭', calories: 500 },
    { id: 'a', date: '2026-10-06', type: 'lunch', name: '鸡肉饭', calories: 480 },
    { id: 'b', date: '2026-10-05', type: 'dinner', name: '牛肉饭', calories: 430 },
    { id: 'c', date: '2026-10-04', type: 'dinner', name: '牛肉饭', calories: 420 }
  ];
  assert.deepEqual(searchQuickMeals(history, '2026-10-07', ' 牛肉 ', 12).map(meal => meal.id), ['b']);
  assert.deepEqual(searchQuickMeals(history, '2026-10-07').map(meal => meal.id), ['a', 'b']);
});

test('portion shortcuts scale energy and macros from original entry', () => {
  assert.deepEqual(scaleMeal({ calories: 501, protein: 25.3, carbs: 40, fat: 12.1 }, 0.5), { calories: '251', protein: '12.7', carbs: '20', fat: '6.1' });
  assert.deepEqual(scaleMeal({ calories: 501, protein: 25.3, carbs: 40, fat: 12.1 }, 1.5), { calories: '752', protein: '38', carbs: '60', fat: '18.2' });
  assert.throws(() => scaleMeal({ calories: 100 }, 3));
});
