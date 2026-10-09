const { METHOD_API_BASE } = require('../config/runtime');
function lookupBarcode(rawCode, done) {
  const barcode = String(rawCode || '').trim();
  if (!/^\d{8,14}$/.test(barcode)) { done(new Error('请输入 8–14 位商品条码')); return; }
  if (!METHOD_API_BASE || typeof wx.request !== 'function') { done(new Error('本地食品查询服务未启动')); return; }
  wx.request({ url: METHOD_API_BASE.replace(/\/$/, '') + '/api/foods/barcode/' + barcode, method: 'GET', timeout: 10000,
    success(response) {
      if (response.statusCode !== 200) { done(new Error(response.data && response.data.error || '食品查询失败')); return; }
      done(null, response.data);
    }, fail() { done(new Error('食品查询失败，请检查本地后台')); }
  });
}
module.exports = { lookupBarcode };
