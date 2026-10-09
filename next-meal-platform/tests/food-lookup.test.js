const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../server');
const { normalizeProduct, cleanBarcode } = require('../foodLookup');

test('barcode input and source data are normalized without inventing nutrients', () => {
  assert.equal(cleanBarcode(' 3017620422003 '), '3017620422003');
  assert.throws(() => cleanBarcode('https://other.example/foo'), /条码/);
  const ready = normalizeProduct({ status: 1, product: { product_name_zh: '测试食品', brands: '测试品牌', product_quantity_unit: 'g',
    nutriments: { 'energy-kcal_100g': 230, proteins_100g: 7, carbohydrates_100g: 27, fat_100g: 10 } } }, '3017620422003');
  assert.equal(ready.status, 'candidate_ready');
  assert.equal(ready.product.nutrition.calories, 230);
  assert.equal(ready.product.source, 'Open Food Facts');
  assert.equal(ready.product.sourceUrl, 'https://world.openfoodfacts.org/product/3017620422003');
  const missing = normalizeProduct({ status: 1, product: { product_name: '资料不全', nutriments: { proteins_100g: 2 } } }, '12345678');
  assert.equal(missing.status, 'needs_label');
  assert.equal(missing.product.nutrition.calories, null);
  assert.equal(normalizeProduct({ status: 0 }, '12345678').status, 'not_found');
});

test('local barcode endpoint returns a reviewed-by-user candidate and caches external result', async () => {
  let calls = 0;
  const foodFetch = async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\.json\?/);
    assert.ok(options.headers['User-Agent'].includes('NextMeal'));
    return { ok: true, json: async () => ({ status: 1, product: { product_name: '测试包装食品',
      nutriments: { 'energy-kcal_100g': 250, proteins_100g: 6, carbohydrates_100g: 30, fat_100g: 9 } } }) };
  };
  const { server } = startServer({ database: ':memory:', token: 'test', foodFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const first = await fetch(base + '/api/foods/barcode/3017620422003');
    assert.equal(first.status, 200);
    assert.equal((await first.json()).product.nutrition.calories, 250);
    assert.equal((await (await fetch(base + '/api/foods/barcode/3017620422003')).json()).status, 'candidate_ready');
    assert.equal(calls, 1);
    assert.equal((await fetch(base + '/api/foods/barcode/not-a-code')).status, 400);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
