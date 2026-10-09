function quickMeals(history, today, count = 3) {
  const seen = new Set();
  return (history || []).filter(meal => {
    if (!meal || !meal.name || !meal.date || meal.date >= today || !Number.isFinite(+meal.calories) || +meal.calories <= 0) return false;
    const key = meal.name.trim().toLowerCase() + '|' + (meal.type || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, count);
}
function searchQuickMeals(history, today, query = '', count = 4) {
  const normalized = String(query || '').trim().toLowerCase();
  const list = quickMeals(history, today, 100);
  return (normalized ? list.filter(meal => meal.name.toLowerCase().includes(normalized)) : list).slice(0, count);
}
function scaleMeal(meal, factor) {
  if (![0.5, 1, 1.5, 2].includes(factor)) throw new Error('份量倍数不受支持');
  const scaled = {};
  for (const key of ['calories', 'protein', 'carbs', 'fat']) {
    const value = Number(meal[key] || 0);
    if (!Number.isFinite(value) || value < 0) throw new Error('餐食营养数值不正确');
    scaled[key] = String(Math.round(value * factor * (key === 'calories' ? 1 : 10)) / (key === 'calories' ? 1 : 10));
  }
  return scaled;
}
module.exports = { quickMeals, searchQuickMeals, scaleMeal };
