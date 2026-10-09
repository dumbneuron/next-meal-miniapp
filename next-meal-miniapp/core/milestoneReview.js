const { validKey } = require('./date');

function topMeal(meals) {
  const counts = new Map();
  meals.forEach(meal => {
    const name = String(meal.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const found = counts.get(key) || { name, count: 0 };
    found.count += 1;
    counts.set(key, found);
  });
  return [...counts.values()].filter(item => item.count >= 2)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))[0] || null;
}

function milestoneReview(state, throughDate) {
  const limit = validKey(throughDate) ? throughDate : '9999-12-31';
  const meals = (state.meals || []).filter(meal => validKey(meal.date) && meal.date <= limit);
  const mealDates = [...new Set(meals.map(meal => meal.date))].sort();
  const completeDates = [...new Set((state.dayReviews || []).filter(day =>
    validKey(day.date) && day.date <= limit && mealDates.includes(day.date)).map(day => day.date))].sort();
  const firstFive = mealDates.length >= 5 ? (() => {
    const dates = mealDates.slice(0, 5);
    const selected = meals.filter(meal => dates.includes(meal.date));
    return { unlocked: true, achievedOn: dates[4], mealCount: selected.length, repeated: topMeal(selected),
      reusedMeals: selected.filter(meal => meal.source === 'reused').length };
  })() : { unlocked: false };
  const tenComplete = completeDates.length >= 10 ? (() => {
    const dates = completeDates.slice(0, 10);
    const selected = meals.filter(meal => dates.includes(meal.date));
    return { unlocked: true, achievedOn: dates[9], mealCount: selected.length, repeated: topMeal(selected),
      reusedMeals: selected.filter(meal => meal.source === 'reused').length };
  })() : { unlocked: false };
  return { firstFive, tenComplete };
}

module.exports = { milestoneReview };
