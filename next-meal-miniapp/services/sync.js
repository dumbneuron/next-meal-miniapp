const store = require('./store');
const runtime = require('../config/runtime');

const SESSION_KEY = 'next_meal_device_session_v1';
const META_KEY = 'next_meal_sync_meta_v1';
let inFlight = null;
let timer = null;
const listeners = [];
function subscribe(listener) {
  listeners.push(listener);
  return () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); };
}
function emit() { for (const listener of listeners.slice()) { try { listener(); } catch (_) {} } }

function session() {
  try {
    const saved = wx.getStorageSync(SESSION_KEY);
    return saved && typeof saved.token === 'string' && typeof saved.userId === 'string' ? saved : null;
  } catch (_) { return null; }
}
function meta() { try { return wx.getStorageSync(META_KEY) || {}; } catch (_) { return {}; } }
function setMeta(patch) { wx.setStorageSync(META_KEY, Object.assign({}, meta(), patch)); }
function request(path, method, data, token) {
  if (!runtime.METHOD_API_BASE || typeof wx.request !== 'function') return Promise.reject(new Error('本机方法后台尚未连接'));
  return new Promise((resolve, reject) => wx.request({
    url: runtime.METHOD_API_BASE.replace(/\/$/, '') + path, method,
    header: token ? { Authorization: 'Bearer ' + token } : {}, data,
    success(response) {
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
      else { const error = new Error(response.data && response.data.error || '同步服务返回错误'); error.code = response.data && response.data.code; reject(error); }
    }, fail() { reject(new Error('本机后台连接中断，记录已保存在本机')); }
  }));
}
async function pairDevice(code) {
  if (session()) throw new Error('这台设备已经配对');
  const result = await request('/api/pair/redeem', 'POST', { code: String(code || '').trim().toUpperCase() });
  if (meta().lastUserId && meta().lastUserId !== result.userId) {
    await request('/api/user/logout', 'POST', {}, result.token).catch(() => {});
    throw new Error('配对码属于其他用户，已保留这台设备上的原记录');
  }
  wx.setStorageSync(SESSION_KEY, { userId: result.userId, token: result.token, expiresAt: result.expiresAt || '' });
  store.queueExistingData();
  await syncNow();
  return result.userId;
}
async function doSync() {
  const current = session();
  if (!current) throw new Error('先用后台配对码连接设备');
  store.queueExistingData();
  for (let attempt = 0; attempt < 100; attempt++) {
    const pending = store.ensureState().pendingMutations.slice(0, 100);
    const response = pending.length
      ? await request('/api/user/sync', 'POST', { mutations: pending }, current.token)
      : await request('/api/user/snapshot', 'GET', null, current.token);
    store.applyRemoteSnapshot(response.snapshot, response.acknowledged || []);
    if (store.ensureState().pendingMutations.length === 0) {
      setMeta({ lastSyncedAt: new Date().toISOString(), lastError: '', conflict: false, needsPairing: false, lastUserId: '' });
      emit();
      return response.snapshot;
    }
  }
  throw new Error('待同步记录较多，请再次同步');
}
function syncNow() {
  if (inFlight) return inFlight;
  inFlight = doSync().catch(error => { setMeta({ lastError: error.message, conflict: error.code === 'PLAN_CONFLICT', needsPairing: error.code === 'SESSION_EXPIRED' }); throw error; }).finally(() => { inFlight = null; });
  return inFlight;
}
function schedule() {
  if (!session() || typeof wx.request !== 'function') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow().catch(() => {}); }, 700);
}
function status() {
  const active = session();
  const state = store.ensureState();
  return { paired: !!active, userId: active ? active.userId : '', pending: state.pendingMutations.length,
    expiresAt: active ? active.expiresAt || '' : '', lastSyncedAt: meta().lastSyncedAt || '', lastError: meta().lastError || '', conflict: meta().conflict === true,
    needsPairing: meta().needsPairing === true, lastUserId: meta().lastUserId || '' };
}
async function devices() {
  const current = session();
  if (!current) throw new Error('设备尚未配对');
  return (await request('/api/user/devices', 'GET', null, current.token)).devices;
}
async function revokeDevice(deviceId) {
  const current = session();
  if (!current) throw new Error('设备尚未配对');
  await request('/api/user/devices/revoke', 'POST', { deviceId }, current.token);
  return devices();
}
async function disconnect() {
  const current = session();
  if (!current) throw new Error('设备尚未配对');
  await syncNow();
  await request('/api/user/logout', 'POST', {}, current.token);
  wx.removeStorageSync(SESSION_KEY);
  wx.removeStorageSync(META_KEY);
  store.resetLocal();
  emit();
}
function forgetExpiredSession() {
  const current = session();
  if (!current || !meta().needsPairing) throw new Error('当前设备仍可连接');
  wx.removeStorageSync(SESSION_KEY);
  setMeta({ lastUserId: current.userId, lastError: '', conflict: false, needsPairing: false });
  emit();
}
async function resolvePlanConflict() {
  if (!status().conflict) throw new Error('当前没有待处理的计划冲突');
  const removed = store.dropPendingPlanUpdates();
  if (!removed) throw new Error('没有可处理的本机计划调整');
  setMeta({ conflict: false, lastError: '' });
  await syncNow();
  return removed;
}
async function deleteAccount() {
  const current = session();
  if (!current) throw new Error('设备尚未配对');
  if (timer) { clearTimeout(timer); timer = null; }
  if (inFlight) await inFlight.catch(() => {});
  await request('/api/user/delete', 'POST', { confirm: 'DELETE' }, current.token);
  wx.removeStorageSync(SESSION_KEY);
  wx.removeStorageSync(META_KEY);
  store.resetLocal();
}
module.exports = { SESSION_KEY, pairDevice, syncNow, schedule, status, devices, revokeDevice, disconnect, forgetExpiredSession, deleteAccount, subscribe, resolvePlanConflict };
