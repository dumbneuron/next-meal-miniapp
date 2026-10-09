const test = require('node:test');
const assert = require('node:assert/strict');
const { FALLBACK_METHODS, validateMethod, configForMethod, buildMethodPlan, testMethod } = require('../core/methods');
const { uniqueMethods } = require('../services/methodCatalog');

test('catalog keeps introductory methods first when admin publishes more methods', () => {
  const demo = { ...FALLBACK_METHODS[0], id: 'weekday-demo', title: '工作日演示' };
  assert.deepEqual(uniqueMethods([FALLBACK_METHODS[2], demo, FALLBACK_METHODS[0], FALLBACK_METHODS[1]]).map(method => method.id),
    ['steady', 'taper', 'cycle', 'weekday-demo']);
});

test('all bundled methods are valid and produce previewable plans', () => {
  for (const method of FALLBACK_METHODS) {
    assert.equal(validateMethod(method).id, method.id);
    assert.equal(testMethod(method).length, 3);
    const plan = buildMethodPlan(method, { calories: 2100, protein: 135, carbs: 250, fat: 72 }, '2026-10-07');
    assert.deepEqual(plan.methodRef, { id: method.id, version: 1, title: method.title });
  }
});
test('new method can reuse an existing rule without a new plan branch', () => {
  const method = { ...FALLBACK_METHODS[1], id: 'new-community-method', version: 2, title: '社区方法演示', config: { stageDays: 14, stepGrams: 10 } };
  const config = configForMethod(method, { carbs: 220 });
  assert.deepEqual(config, { stageDays: 14, stepGrams: 10 });
  assert.equal(buildMethodPlan(method, { calories: 2000, protein: 130, carbs: 220, fat: 65 }, '2026-10-07').methodRef.version, 2);
});
test('method editor rejects arbitrary formulas and extreme cycle averages', () => {
  assert.throws(() => validateMethod({ ...FALLBACK_METHODS[0], mode: 'eval-js', config: { expression: 'process.exit()' } }));
  assert.throws(() => validateMethod({ ...FALLBACK_METHODS[2], config: { pattern: 'four', lowMultiplier: 0.5, highMultiplier: 1.1 } }));
});
