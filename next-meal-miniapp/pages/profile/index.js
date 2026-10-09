const store = require('../../services/store');
const { ACTIVITY, estimate } = require('../../core/estimate');
const activityKeys = Object.keys(ACTIVITY);
Page({
  data: {
    profile: { sex: 'female', age: '', heightCm: '', weightKg: '', activity: 'light', healthClear: false },
    sexIndex: 0, sexLabels: ['女', '男'], activityIndex: 1, activityLabels: activityKeys.map(key => ACTIVITY[key].label),
    hasPlan: false
  },
  onShow() {
    const state = store.ensureState();
    const profile = Object.assign({}, this.data.profile, state.profile || {});
    this.setData({ profile, hasPlan: !!state.activePlan, sexIndex: profile.sex === 'male' ? 1 : 0,
      activityIndex: Math.max(0, activityKeys.indexOf(profile.activity)) });
  },
  input(e) { this.setData({ ['profile.' + e.currentTarget.dataset.field]: e.detail.value }); },
  chooseSex(e) { const i = Number(e.detail.value); this.setData({ sexIndex: i, 'profile.sex': i ? 'male' : 'female' }); },
  chooseActivity(e) { const i = Number(e.detail.value); this.setData({ activityIndex: i, 'profile.activity': activityKeys[i] }); },
  toggleHealth() { this.setData({ 'profile.healthClear': !this.data.profile.healthClear }); },
  save() {
    try { estimate(this.data.profile); }
    catch (error) { wx.showModal({ title: '检查资料', content: error.message, showCancel: false }); return; }
    store.setProfile(this.data.profile);
    if (this.data.hasPlan) {
      wx.showModal({ title: '资料已保存', content: '现有计划保留原目标。要按新资料计算，请进入计划页重新预览并确认。', showCancel: false,
        success: () => wx.navigateBack() });
    } else { wx.showToast({ title: '资料已保存', icon: 'success' }); wx.navigateBack(); }
  },
  toPlan() { wx.switchTab({ url: '/pages/plan/index' }); }
});
