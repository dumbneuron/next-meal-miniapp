function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function validKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return false;
  const d = new Date(key + 'T12:00:00');
  return !Number.isNaN(d.getTime()) && dateKey(d) === key;
}
function shiftKey(key, days) {
  if (!validKey(key)) throw new Error('日期格式错误');
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return dateKey(d);
}
module.exports = { dateKey, validKey, shiftKey };
