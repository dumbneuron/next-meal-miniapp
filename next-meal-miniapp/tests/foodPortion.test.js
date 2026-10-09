const test = require('node:test');
const assert = require('node:assert/strict');
const { scaleProduct } = require('../core/foodPortion');

test('barcode portion scales all nutrients and rejects impossible amounts', () => {
  const product = { nutrition: { calories: 200, protein: 6, carbs: 30, fat: 5 } };
  assert.deepEqual(scaleProduct(product, 150), { amount: 150, calories: '300', protein: '9', carbs: '45', fat: '7.5' });
  assert.throws(() => scaleProduct(product, 0), /份量/);
  assert.throws(() => scaleProduct(product, 0.5), /份量/);
  assert.throws(() => scaleProduct(product, 2500), /份量/);
  assert.throws(() => scaleProduct({ nutrition: { calories: null } }, 100), /热量/);
});
