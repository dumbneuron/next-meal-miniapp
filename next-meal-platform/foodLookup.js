const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_zh,brands,quantity,nutriments,nutrition_data_per,product_quantity_unit';
const DEFAULT_USER_AGENT = 'NextMealMiniApp/0.1 (WeChat local prototype; barcode lookup)';
function cleanBarcode(value) {
  const code = String(value || '').trim();
  if (!/^\d{8,14}$/.test(code)) throw new Error('请输入 8–14 位商品条码');
  return code;
}
function finite(value, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}
function text(value, limit) { return String(value || '').trim().slice(0, limit); }
function normalizeProduct(payload, barcode) {
  if (!payload || payload.status !== 1 || !payload.product) return { status: 'not_found', barcode };
  const product = payload.product;
  const name = text(product.product_name_zh || product.product_name, 60);
  const brand = text(product.brands, 50);
  const n = product.nutriments || {};
  const calories = finite(n['energy-kcal_100g'], 1000);
  const basisUnit = product.product_quantity_unit === 'ml' || product.nutrition_data_per === '100ml' ? 'ml' : 'g';
  const info = { name, brand, barcode, quantity: text(product.quantity, 30), basisAmount: 100, basisUnit,
    source: 'Open Food Facts', sourceUrl: BASE + '/product/' + barcode,
    nutrition: { calories, protein: finite(n.proteins_100g, 100), carbs: finite(n.carbohydrates_100g, 100), fat: finite(n.fat_100g, 100) } };
  if (!name || calories === null || calories <= 0 || info.nutrition.protein === null || info.nutrition.carbs === null || info.nutrition.fat === null) return { status: 'needs_label', barcode, product: info };
  return { status: 'candidate_ready', barcode, product: info };
}
function createFoodLookup(fetchImpl = fetch) {
  const cache = new Map();
  return async function lookup(rawCode) {
    const barcode = cleanBarcode(rawCode);
    const cached = cache.get(barcode);
    if (cached && cached.until > Date.now()) return cached.value;
    const url = BASE + '/api/v2/product/' + barcode + '.json?fields=' + FIELDS;
    const response = await fetchImpl(url, { headers: { 'User-Agent': process.env.NEXT_MEAL_FOOD_USER_AGENT || DEFAULT_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('食品资料服务暂时不可用');
    const value = normalizeProduct(await response.json(), barcode);
    cache.set(barcode, { value, until: Date.now() + (value.status === 'candidate_ready' ? 60 : 10) * 60 * 1000 });
    return value;
  };
}
module.exports = { cleanBarcode, normalizeProduct, createFoodLookup };
