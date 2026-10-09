function round(n, digits) { const f = Math.pow(10, digits || 0); return Math.round((n + Number.EPSILON) * f) / f; }
function macroCalories(m) { return round((Number(m.protein) || 0) * 4 + (Number(m.carbs) || 0) * 4 + (Number(m.fat) || 0) * 9); }
function sumMeals(meals) {
  return (meals || []).reduce((a, m) => {
    a.calories += Number(m.calories) || 0;
    a.protein += Number(m.protein) || 0;
    a.carbs += Number(m.carbs) || 0;
    a.fat += Number(m.fat) || 0;
    return a;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}
module.exports = { round, macroCalories, sumMeals };
