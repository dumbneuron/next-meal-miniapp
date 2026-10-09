const { METHOD_API_BASE } = require('../config/runtime');
function searchFoods(query, done) {
  if (!METHOD_API_BASE || typeof wx.request !== 'function') { done(new Error('本地食物库未连接')); return; }
  wx.request({ url: METHOD_API_BASE.replace(/\/$/, '') + '/api/foods/search?q=' + encodeURIComponent(String(query || '').trim()), method: 'GET', timeout: 7000,
    success(response) {
      if (response.statusCode !== 200 || !response.data || !Array.isArray(response.data.foods)) { done(new Error(response.data && response.data.error || '食物查询失败')); return; }
      done(null, response.data.foods);
    }, fail() { done(new Error('食物查询失败，请检查本地后台')); }
  });
}
module.exports = { searchFoods };
