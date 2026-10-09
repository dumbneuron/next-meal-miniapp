const test = require('node:test');
const assert = require('node:assert/strict');
const { estimate, proposeMode, proposeCyclePattern } = require('../core/estimate');
const profile = { sex: 'male', age: 28, heightCm: 175, weightKg: 94.3, activity: 'light', healthClear: true };

test('profile produces energy and all macros without manual nutrition entry', () => {
  const result = estimate(profile);
  assert.equal(result.details.bmr, 1902);
  assert.equal(result.details.maintenance, 2615);
  assert.equal(result.details.plannedCalories, 2220);
  assert.deepEqual(result.base, { calories: 2222, protein: 141, carbs: 275, fat: 62 });
});
test('mode defaults are derived from the calculated baseline', () => {
  const base = estimate(profile).base;
  assert.deepEqual(proposeMode('taper', base), { stepGrams: 15, stageDays: 7 });
  assert.deepEqual(proposeMode('cycle', base), { pattern: 'four', lowCarbs: 220, midCarbs: 275, highCarbs: 440 });
  assert.deepEqual(proposeCyclePattern('six', base), { lowCarbs: 234, midCarbs: 275, highCarbs: 440 });
});
test('adult and health confirmation are required for automatic estimate', () => {
  assert.throws(() => estimate(Object.assign({}, profile, { age: 17 })));
  assert.throws(() => estimate(Object.assign({}, profile, { healthClear: false })));
  assert.throws(() => estimate(Object.assign({}, profile, { heightCm: '' })));
});
