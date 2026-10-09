const test = require('node:test');
const assert = require('node:assert/strict');
const { searchFoods } = require('../foodCatalog');
const { startServer } = require('../server');

test('curated common-food search keeps source, units and preparation explicit', () => {
  const rice = searchFoods('米饭')[0];
  assert.equal(rice.fdcId, 169757);
  assert.equal(rice.nutrition.calories, 130);
  assert.equal(rice.nutrition.carbs, 28.17);
  assert.equal(rice.basisAmount, 100);
  assert.equal(rice.basisUnit, 'g');
  assert.match(rice.description, /cooked without salt/);
  assert.match(rice.sourceUrl, /\/169757\/nutrients$/);
  assert.equal(searchFoods('燕麦粥').length, 0); // dry oats must not masquerade as cooked porridge
  assert.equal(searchFoods('').length, 4);
  assert.throws(() => searchFoods('x'.repeat(41)), /过长/);
});

test('public catalog endpoint is read-only and bounded', async () => {
  const { server } = startServer({ database: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/foods/search?q=' + encodeURIComponent('鸡蛋'));
    assert.equal(response.status, 200);
    const foods = (await response.json()).foods;
    assert.equal(foods[0].name, '水煮鸡蛋');
    assert.equal(foods[0].nutrition.protein, 12.58);
    assert.equal((await fetch(base + '/api/foods/search?q=' + 'x'.repeat(41))).status, 400);
    assert.equal((await fetch(base + '/api/foods/search')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
