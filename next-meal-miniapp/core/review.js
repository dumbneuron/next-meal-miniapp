const { shiftKey, validKey } = require('./date');
const { round } = require('./nutrition');
function windowStats(weights, endKey, days) {
  const start = shiftKey(endKey, -(days - 1));
  const byDate = {};
  (weights || []).forEach(w => {
    if (validKey(w.date) && w.date >= start && w.date <= endKey && +w.kg > 0) byDate[w.date] = +w.kg;
  });
  const values = Object.values(byDate);
  return { start, end: endKey, count: values.length, expected: days, average: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : null };
}
function review(weights, meals, today) {
  const current = windowStats(weights, today, 7);
  const previous = windowStats(weights, shiftKey(today, -7), 7);
  const start = current.start;
  const loggedDays = new Set((meals || []).filter(m => validKey(m.date) && m.date >= start && m.date <= today).map(m => m.date)).size;
  const ready = current.count >= 4 && previous.count >= 4;
  const delta = ready ? round(current.average - previous.average, 2) : null;
  let message = '先持续记录晨重；两周各至少 4 天，才展示均重变化。';
  if (ready) {
    message = Math.abs(delta) < 0.15 ? '近两周均重接近持平，先结合记录完整度观察。' : delta < 0 ? '近 7 天均重低于前 7 天。' : '近 7 天均重高于前 7 天。';
    if (loggedDays < 5) message += ' 本周饮食记录较少，暂不推断原因。';
  }
  return { current, previous, loggedDays, ready, delta, message };
}
module.exports = { windowStats, review };
