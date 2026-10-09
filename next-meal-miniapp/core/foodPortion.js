function scaleProduct(product, amountInput) {
  if (!product || !product.nutrition) throw new Error('商品资料不完整');
  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount < 1 || amount > 2000) throw new Error('份量需在 1–2000 克或毫升之间');
  const base = Number(product.nutrition.calories);
  if (!Number.isFinite(base) || base <= 0 || base > 1000) throw new Error('商品热量资料不完整');
  const scale = amount / 100;
  const nutrient = value => value === null || value === undefined || value === '' ? '' : String(Math.round(Number(value) * scale * 10) / 10);
  return { amount, calories: String(Math.round(base * scale)), protein: nutrient(product.nutrition.protein),
    carbs: nutrient(product.nutrition.carbs), fat: nutrient(product.nutrition.fat) };
}
module.exports = { scaleProduct };
