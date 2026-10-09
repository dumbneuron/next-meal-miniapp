const { shiftKey, validKey } = require('./date');

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

function weeklyReview(state, today) {
  if (!validKey(today)) throw new Error('日期格式错误');
  const first = shiftKey(today, -6);
  const meals = (state.meals || []).filter(meal => validKey(meal.date) && meal.date >= first && meal.date <= today);
  const dateSet = new Set(meals.map(meal => meal.date));
  const completeSet = new Set((state.dayReviews || []).filter(day => dateSet.has(day.date)).map(day => day.date));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftKey(first, index);
    return { date, label: weekdays[new Date(date + 'T12:00:00').getDay()], recorded: dateSet.has(date), complete: completeSet.has(date) };
  });
  const counts = new Map();
  meals.forEach(meal => {
    const name = String(meal.name || '').trim();
    if (name) {
      const key = name.toLowerCase();
      const entry = counts.get(key) || { name, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  });
  const repeated = [...counts.values()].filter(entry => entry.count >= 2).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))[0] || null;
  const reusedMeals = meals.filter(meal => meal.source === 'reused').length;
  const effectiveDays = dateSet.size;
  const message = effectiveDays === 0 ? '从记录一餐开始，回顾会随着真实记录出现。' :
    repeated ? `“${repeated.name}”记录了 ${repeated.count} 次，下次可以直接复用。` :
      reusedMeals ? '已经在用熟悉的餐食快速记录，继续按实际份量调整。' : '已经留下真实记录；常吃餐积累后，下一次会更快。';
  return { days, effectiveDays, completeDays: completeSet.size, mealCount: meals.length, reusedMeals, repeated, message };
}

module.exports = { weeklyReview };
