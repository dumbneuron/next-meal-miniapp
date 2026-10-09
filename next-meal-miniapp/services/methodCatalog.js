const { METHOD_API_BASE } = require('../config/runtime');
const { FALLBACK_METHODS, validateMethod } = require('../core/methods');
const KEY = 'next_meal_method_catalog_v1';

function uniqueMethods(input) {
  if (!Array.isArray(input)) throw new Error('方法列表格式错误');
  const seen = new Set();
  const result = input.map(validateMethod);
  for (const method of result) {
    if (seen.has(method.id)) throw new Error('方法 ID 重复');
    seen.add(method.id);
  }
  if (!result.length) throw new Error('方法列表为空');
  const baseOrder = { steady: 0, taper: 1, cycle: 2 };
  return result.sort((a, b) => (baseOrder[a.id] === undefined ? 100 : baseOrder[a.id]) - (baseOrder[b.id] === undefined ? 100 : baseOrder[b.id]) || a.title.localeCompare(b.title, 'zh'));
}
function cachedMethods() {
  try {
    const cache = wx.getStorageSync(KEY);
    return cache && cache.methods ? uniqueMethods(cache.methods) : FALLBACK_METHODS.slice();
  } catch (_) { return FALLBACK_METHODS.slice(); }
}
function loadMethods(done) {
  const fallback = cachedMethods();
  if (!METHOD_API_BASE || typeof wx.request !== 'function') { done(fallback, 'local'); return; }
  wx.request({ url: METHOD_API_BASE.replace(/\/$/, '') + '/api/methods', method: 'GET',
    success(response) {
      try {
        if (response.statusCode !== 200) throw new Error('方法服务暂不可用');
        const methods = uniqueMethods(response.data && response.data.methods);
        wx.setStorageSync(KEY, { methods, fetchedAt: Date.now() });
        done(methods, 'remote');
      } catch (_) { done(fallback, 'cache'); }
    }, fail() { done(fallback, 'cache'); }
  });
}
module.exports = { KEY, uniqueMethods, cachedMethods, loadMethods };
