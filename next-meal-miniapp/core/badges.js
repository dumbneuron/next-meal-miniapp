const { validKey } = require('./date');

const BADGES = Object.freeze([
  { id: 'first-five', title: '起步者', description: '累计 5 个有效记录日', kind: 'effective', target: 5 },
  { id: 'ten-complete', title: '节奏建立者', description: '累计 10 个完整记录日', kind: 'complete', target: 10 }
]);
function progress(state, throughDate) {
  const limit = throughDate && validKey(throughDate) ? throughDate : '9999-12-31';
  const mealDates = new Set((state.meals || []).filter(meal => validKey(meal.date) && meal.date <= limit).map(meal => meal.date));
  const completeDates = new Set((state.dayReviews || []).filter(day => validKey(day.date) && day.date <= limit && mealDates.has(day.date)).map(day => day.date));
  const effectiveDays = mealDates.size;
  const completeDays = completeDates.size;
  return { effectiveDays, completeDays, todayComplete: throughDate ? completeDates.has(throughDate) : false,
    badges: BADGES.map(badge => {
      const count = badge.kind === 'effective' ? effectiveDays : completeDays;
      return { id: badge.id, title: badge.title, description: badge.description, target: badge.target,
        count, progressPercent: Math.min(100, Math.round(count / badge.target * 100)), unlocked: count >= badge.target };
    }) };
}
module.exports = { BADGES, progress };
