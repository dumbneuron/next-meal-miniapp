const { round } = require('./nutrition');
function recommendations(history, today, goal, consumed, mealType) {
  const remaining = goal ? +goal.calories - (consumed ? +consumed.calories : 0) : null;
  const proteinGap = goal && goal.protein != null ? +goal.protein - (consumed ? +consumed.protein : 0) : null;
  const candidates = (history || []).filter(m => m.date < today && m.name && (!mealType || m.type === mealType));
  const byName = {};
  candidates.forEach(m => {
    const key = m.name.trim().toLowerCase();
    if (!byName[key] || m.date > byName[key].date) byName[key] = m;
  });
  return Object.values(byName).map(m => {
    let score = 0;
    if (remaining != null && remaining > 0) score += Math.abs((Number(m.calories) || 0) - remaining * 0.5) / 100;
    if (proteinGap != null && proteinGap > 0) score -= Math.min(Number(m.protein) || 0, proteinGap) / 25;
    return { id: m.id, name: m.name, type: m.type, calories: round(+m.calories || 0), protein: round(+m.protein || 0, 1), carbs: round(+m.carbs || 0, 1), fat: round(+m.fat || 0, 1), score, sourceDate: m.date };
  }).sort((a, b) => a.score - b.score || b.sourceDate.localeCompare(a.sourceDate)).slice(0, 3);
}
module.exports = { recommendations };
