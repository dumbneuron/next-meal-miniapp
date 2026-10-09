const store = require('../../services/store');
const sync = require('../../services/sync');
const { MODES } = require('../../core/plan');
const { ACTIVITY } = require('../../core/estimate');
const { progress: badgeProgress } = require('../../core/badges');
const { dateKey } = require('../../core/date');
function localMinute(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '未知';
  const two = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
const formatDevices = devices => devices.map(item => ({ ...item, createdLabel: localMinute(item.createdAt), lastSeenLabel: localMinute(item.lastSeenAt) }));
Page({
  data: { planName: '还没有计划', hasPlan: false, hasProfile: false, weightLabel: '资料体重', weightDisplay: '—', mealCount: 0, weightCount: 0, planCount: 0, history: [], showHistory: false, backupText: '', pairCode: '', syncing: false, showDataTools: false, showDevices: false, devices: [],
    profileInfo: { sex: '未填写', age: '—', height: '—', weight: '—', activity: '未填写' },
    growth: { effectiveDays: 0, completeDays: 0, badges: [] }, featuredBadge: null, growthHeadline: '记下第一餐，开始积累自己的节奏。',
    syncStatus: { paired: false, userId: '', pending: 0, lastSyncedAt: '', lastError: '', conflict: false, needsPairing: false } },
  onShow() { const tab = this.getTabBar && this.getTabBar(); if (tab && tab.data.selected !== 4) tab.setData({ selected: 4 }); this.load(); if (!this.syncOff) this.syncOff = sync.subscribe(() => this.load()); },
  onHide() { if (this.syncOff) { this.syncOff(); this.syncOff = null; } },
  onUnload() { this.onHide(); },
  load() {
    const s = store.ensureState();
    const profile = s.profile || {};
    const growth = badgeProgress(s, dateKey());
    const featuredBadge = growth.badges.find(item => !item.unlocked) || growth.badges[growth.badges.length - 1] || null;
    const growthHeadline = !growth.effectiveDays ? '记下第一餐，开始积累自己的节奏。' :
      featuredBadge && !featuredBadge.unlocked ? `已记录 ${growth.effectiveDays} 天，距「${featuredBadge.title}」还差 ${featuredBadge.target - featuredBadge.count} 天。` :
        `已记录 ${growth.effectiveDays} 天，两枚成长勋章都已点亮。`;
    const latestWeight = s.weights.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    this.setData({ planName: s.activePlan ? (s.activePlan.methodRef && s.activePlan.methodRef.title || MODES[s.activePlan.mode]) : '还没有计划', hasPlan: !!s.activePlan, hasProfile: !!(profile.weightKg && profile.heightCm && profile.age), weightLabel: latestWeight ? '最近晨重' : '资料体重', weightDisplay: latestWeight ? latestWeight.kg : profile.weightKg || '—', mealCount: s.meals.length, weightCount: s.weights.length, planCount: s.planHistory.length, syncStatus: sync.status(),
      profileInfo: { sex: profile.sex === 'male' ? '男' : profile.sex === 'female' ? '女' : '未填写', age: profile.age || '—', height: profile.heightCm || '—', weight: profile.weightKg || '—', activity: ACTIVITY[profile.activity] ? ACTIVITY[profile.activity].label : '未填写' },
      growth, featuredBadge, growthHeadline,
      history: s.planHistory.slice(0, 5).map(p => ({ name: p.methodRef && p.methodRef.title || MODES[p.mode], confirmedAt: p.confirmedAt, date: (p.confirmedAt || '').slice(0, 10) })) });
  },
  toPlan() { wx.switchTab({ url: '/pages/plan/index' }); },
  toProfile() { wx.navigateTo({ url: '/pages/profile/index' }); },
  toGrowth() { wx.navigateTo({ url: '/pages/growth/index' }); },
  toTrend() { wx.switchTab({ url: '/pages/trend/index' }); },
  toggleHistory() { this.setData({ showHistory: !this.data.showHistory }); },
  toggleDataTools() { this.setData({ showDataTools: !this.data.showDataTools }); },
  async toggleDevices() {
    if (this.data.showDevices) { this.setData({ showDevices: false }); return; }
    try {
      const devices = await sync.devices();
      this.setData({ showDevices: true, devices: formatDevices(devices) });
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  revokeDevice(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.devices.find(item => item.id === id);
    if (!target || target.current) return;
    wx.showModal({ title: '让这台设备退出？', content: '这台设备上的记录将停止同步，需重新配对才能恢复。', success: async result => {
      if (!result.confirm) return;
      try { const devices = await sync.revokeDevice(id); this.setData({ devices: formatDevices(devices) }); wx.showToast({ title: '设备已退出', icon: 'success' }); }
      catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    } });
  },
  disconnectDevice() {
    wx.showModal({ title: '断开并清空这台设备？', content: '会先同步待上传记录，再退出这台设备并清空本机数据；后台和其他设备的记录保留。请先复制 JSON 备份。', success: async result => {
      if (!result.confirm) return;
      this.setData({ syncing: true });
      try { await sync.disconnect(); this.setData({ showDevices: false, devices: [] }); this.load(); wx.showToast({ title: '本机已退出', icon: 'success' }); }
      catch (error) { wx.showModal({ title: '退出状态', content: error.message, showCancel: false }); }
      finally { this.setData({ syncing: false }); }
    } });
  },
  forgetExpiredSession() {
    wx.showModal({ title: '重新连接这台设备？', content: '本机记录会保留。请在后台为同一个用户 ID 生成新配对码，避免把记录同步到其他账号。', success: result => {
      if (!result.confirm) return;
      try { sync.forgetExpiredSession(); this.load(); }
      catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    } });
  },
  pairInput(e) { this.setData({ pairCode: e.detail.value }); },
  pairDevice() {
    if (!this.data.pairCode.trim()) { wx.showToast({ title: '请输入后台生成的配对码', icon: 'none' }); return; }
    wx.showModal({ title: '连接这台设备？', content: '本机已有的记录会与该用户的数据合并。请先确认配对码属于你的账号。', success: async result => {
      if (!result.confirm) return;
      this.setData({ syncing: true });
      try { await sync.pairDevice(this.data.pairCode); this.setData({ pairCode: '' }); wx.showToast({ title: '设备已连接', icon: 'success' }); }
      catch (error) { wx.showModal({ title: '连接状态', content: error.message, showCancel: false }); }
      finally { this.setData({ syncing: false }); this.load(); }
    } });
  },
  async syncNow() {
    this.setData({ syncing: true });
    try { await sync.syncNow(); wx.showToast({ title: '数据已同步', icon: 'success' }); }
    catch (error) { wx.showModal({ title: '同步状态', content: error.message, showCancel: false }); }
    finally { this.setData({ syncing: false }); this.load(); }
  },
  resolvePlanConflict() {
    wx.showModal({ title: '采用后台当前计划？', content: '这会放弃这台设备尚未同步的换日调整，餐食和体重记录继续保留。若要保留本机计划，请先复制 JSON 备份。', success: async result => {
      if (!result.confirm) return;
      try { await sync.resolvePlanConflict(); this.load(); wx.showToast({ title: '已采用后台计划', icon: 'success' }); }
      catch (error) { wx.showModal({ title: '处理状态', content: error.message, showCancel: false }); }
    } });
  },
  async exportBackup() {
    if (sync.status().paired) { try { await sync.syncNow(); } catch (_) { wx.showToast({ title: '仅复制当前本机数据', icon: 'none' }); } }
    wx.setClipboardData({ data: store.exportJson(), success: () => wx.showToast({ title: '备份已复制', icon: 'success' }) });
  },
  deleteAllData() {
    const paired = sync.status().paired;
    wx.showModal({ title: '确认删除全部记录？', content: paired ? '将删除本地后台中的资料、计划、餐食、体重与勋章，并清空这台设备。此操作没有撤销入口。' : '将清空这台设备上的资料、计划、餐食和体重。请先复制备份。', success: async result => {
      if (!result.confirm) return;
      try { if (paired) await sync.deleteAccount(); else store.resetLocal(); this.load(); wx.showToast({ title: '数据已删除', icon: 'success' }); }
      catch (error) { wx.showModal({ title: '删除状态', content: error.message, showCancel: false }); }
    } });
  },
  importInput(e) { this.setData({ backupText: e.detail.value }); },
  importBackup() {
    if (sync.status().paired) { wx.showToast({ title: '已连接设备暂不导入本机备份', icon: 'none' }); return; }
    try { const parsed = JSON.parse(this.data.backupText); if (![1, 2].includes(parsed.version) || !Array.isArray(parsed.meals) || !Array.isArray(parsed.weights)) throw new Error(); }
    catch (_) { wx.showToast({ title: '备份内容格式不匹配', icon: 'none' }); return; }
    wx.showModal({ title: '覆盖本机数据？', content: '导入会覆盖目前的计划、餐食和晨重。请先复制备份。', success: r => {
      if (!r.confirm) return;
      try { store.importJson(this.data.backupText); this.setData({ backupText: '' }); this.load(); wx.showToast({ title: '导入成功', icon: 'success' }); }
      catch (_) { wx.showToast({ title: '导入失败', icon: 'none' }); }
    } });
  }
});
