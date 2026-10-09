const store = require('../../services/store');
const { dateKey, shiftKey } = require('../../core/date');
const { MODES, buildPlan, preview, resolveDay, swapDays } = require('../../core/plan');
const { ACTIVITY, estimate, proposeCyclePattern } = require('../../core/estimate');
const { configForMethod } = require('../../core/methods');
const { loadMethods, cachedMethods } = require('../../services/methodCatalog');
const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const icons = { steady: '◒', taper: '↘', cycle: '↗' };
function decorateMethods(methods) { return methods.map(method => Object.assign({}, method, { icon: icons[method.mode] || '✳' })); }
function decorate(result) {
  return Object.assign({}, result, { days: result.days.map(day => Object.assign({}, day, { weekday: weekNames[new Date(day.date + 'T12:00:00').getDay()], shortDate: day.date.slice(5), dayNumber: day.date.slice(8), tone: day.type === 'high' ? 'high' : day.type === 'low' ? 'low' : 'normal' })) });
}
function taperStages(plan) {
  if (plan.mode !== 'taper') return [];
  return ['起步期', '渐降期', '巩固期'].map((label, index) => {
    const offset = index * plan.config.stageDays;
    const day = resolveDay(plan, shiftKey(plan.startDate, offset));
    return { label, range: `${offset + 1}–${offset + plan.config.stageDays} 天`, calories: day.calories, carbs: day.carbs };
  });
}
Page({
  data: {
    modes: decorateMethods(cachedMethods()), selectedMethodId: 'steady', catalogSource: 'local',
    mode: 'steady', modeName: '稳定执行', activeModeName: '', today: '', activePlan: null, activePreview: null,
    profile: { sex: 'female', age: '', heightCm: '', weightKg: '', activity: 'light', healthClear: false },
    sexIndex: 0, activityIndex: 1, sexLabels: ['女', '男'], activityLabels: Object.values(ACTIVITY).map(a => a.label),
    estimateReady: false, estimateDetails: null, profileError: '', showAdvanced: false, adjusted: false,
    form: { calories: '', protein: '', carbs: '', fat: '', stepGrams: '', stageDays: 7, pattern: 'four', lowCarbs: '', midCarbs: '', highCarbs: '' },
    draft: null, draftPreview: null, swapFrom: ''
  },
  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 1 });
    const requestedId = wx.getStorageSync('next_meal_selected_method_v1');
    if (requestedId) wx.removeStorageSync('next_meal_selected_method_v1');
    this.load();
    loadMethods((methods, source) => {
      if (this.viewReady) setTimeout(() => this.applyCatalog(methods, source, requestedId), 0);
      else this.pendingCatalog = { methods, source, requestedId };
    });
  },
  onReady() {
    this.viewReady = true;
    if (this.pendingCatalog) {
      const pending = this.pendingCatalog;
      this.pendingCatalog = null;
      setTimeout(() => this.applyCatalog(pending.methods, pending.source, pending.requestedId), 80);
    }
  },
  applyCatalog(methods, source, requestedId) {
    const active = store.ensureState().activePlan;
    const activeId = active && active.methodRef ? active.methodRef.id : '';
    const selected = methods.find(method => method.id === requestedId) || methods.find(method => method.id === activeId) || methods.find(method => method.id === this.data.selectedMethodId) || methods[0];
    this.setData({ modes: decorateMethods(methods), catalogSource: source, selectedMethodId: selected.id, mode: selected.mode, modeName: selected.title });
  },
  load() {
    const s = store.ensureState(), today = dateKey();
    const base = s.goal || {};
    const active = s.activePlan;
    const current = active ? active.base : base;
    const config = active ? active.config : {};
    const mode = active ? active.mode : this.data.mode;
    const selected = this.data.modes.find(method => method.id === (active && active.methodRef ? active.methodRef.id : this.data.selectedMethodId)) || this.data.modes.find(method => method.mode === mode) || this.data.modes[0];
    const profile = Object.assign({ sex: 'female', age: '', heightCm: '', weightKg: '', activity: 'light', healthClear: false }, s.profile || {});
    this.setData({
      today, activePlan: active, activePreview: active ? decorate(preview(active, today, 7)) : null,
      mode, modeName: selected.title, selectedMethodId: selected.id, activeModeName: active ? (active.methodRef && active.methodRef.title || MODES[active.mode]) : '',
      profile, sexIndex: profile.sex === 'male' ? 1 : 0, activityIndex: Object.keys(ACTIVITY).indexOf(profile.activity),
      estimateReady: !!(active && active.estimateDetails), estimateDetails: active ? active.estimateDetails || null : null, profileError: '',
      form: {
        calories: current.calories == null ? '' : String(current.calories), protein: current.protein == null ? '' : String(current.protein),
        carbs: current.carbs == null ? '' : String(current.carbs), fat: current.fat == null ? '' : String(current.fat),
        stepGrams: config.stepGrams == null ? '' : String(config.stepGrams), stageDays: config.stageDays || 7,
        pattern: config.pattern || 'four', lowCarbs: config.lowCarbs == null ? '' : String(config.lowCarbs),
        midCarbs: config.midCarbs == null ? '' : String(config.midCarbs), highCarbs: config.highCarbs == null ? '' : String(config.highCarbs)
      }
    });
  },
  chooseMode(e) {
    const key = e.currentTarget.dataset.method || e.currentTarget.dataset.mode;
    const selected = this.data.modes.find(method => method.id === key) || this.data.modes.find(method => method.mode === key);
    if (!selected) return;
    const extras = this.data.estimateReady ? configForMethod(selected, this.data.form) : {};
    this.setData({ selectedMethodId: selected.id, mode: selected.mode, modeName: selected.title, form: Object.assign({}, this.data.form, extras), draft: null, draftPreview: null });
  },
  chooseStage(e) { this.setData({ 'form.stageDays': +e.currentTarget.dataset.days, draft: null, draftPreview: null }); },
  choosePattern(e) {
    const pattern = e.currentTarget.dataset.pattern;
    const extras = this.data.estimateReady ? proposeCyclePattern(pattern, this.data.form) : {};
    this.setData({ form: Object.assign({}, this.data.form, { pattern }, extras), draft: null, draftPreview: null, adjusted: true });
  },
  input(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value, draft: null, draftPreview: null, adjusted: true }); },
  profileInput(e) { this.setData({ ['profile.' + e.currentTarget.dataset.field]: e.detail.value, estimateReady: false, profileError: '', draft: null, draftPreview: null }); },
  chooseSex(e) { const i = +e.detail.value; this.setData({ sexIndex: i, 'profile.sex': i ? 'male' : 'female', estimateReady: false, profileError: '', draft: null, draftPreview: null }); },
  chooseActivity(e) { const i = +e.detail.value; this.setData({ activityIndex: i, 'profile.activity': Object.keys(ACTIVITY)[i], estimateReady: false, profileError: '', draft: null, draftPreview: null }); },
  toggleHealth() { this.setData({ 'profile.healthClear': !this.data.profile.healthClear, estimateReady: false, profileError: '', draft: null, draftPreview: null }); },
  toggleAdvanced() { this.setData({ showAdvanced: !this.data.showAdvanced }); },
  calculate() {
    try {
      const result = estimate(this.data.profile);
      const selected = this.data.modes.find(method => method.id === this.data.selectedMethodId) || this.data.modes[0];
      const extras = configForMethod(selected, result.base);
      const form = Object.assign({}, this.data.form, result.base, extras);
      this.setData({ form, estimateDetails: result.details, estimateReady: true, profileError: '', adjusted: false, draft: null, draftPreview: null });
      wx.showToast({ title: '已生成参考目标', icon: 'success' });
    } catch (error) { this.setData({ profileError: error.message, estimateReady: false }); }
  },
  build() {
    if (!this.data.estimateReady) { wx.showModal({ title: '先生成目标', content: '填写身体资料后，点击自动生成参考目标。', showCancel: false }); return; }
    const f = this.data.form;
    try {
      const draft = buildPlan({ mode: this.data.mode, startDate: dateKey(), base: { calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat },
        stepGrams: f.stepGrams, stageDays: f.stageDays, pattern: f.pattern, lowCarbs: f.lowCarbs, midCarbs: f.midCarbs, highCarbs: f.highCarbs });
      draft.estimateDetails = this.data.estimateDetails;
      draft.source = this.data.adjusted ? 'estimate_then_edited' : 'automatic_estimate';
      const selected = this.data.modes.find(method => method.id === this.data.selectedMethodId);
      if (selected) draft.methodRef = { id: selected.id, version: selected.version, title: selected.title };
      this.setData({ draft, draftPreview: Object.assign(decorate(preview(draft, dateKey(), 7)), { stages: taperStages(draft) }) });
      wx.pageScrollTo({ selector: '#preview', duration: 300 });
    } catch (error) { wx.showModal({ title: '检查计划', content: error.message, showCancel: false }); }
  },
  activate() {
    const draft = this.data.draft;
    if (!draft) return;
    wx.showModal({ title: '启用这份计划？', content: '每日数字已在预览中展示。启用后从今天开始；旧计划保留在本机历史中。', success: r => {
      if (r.confirm) { store.setProfile(this.data.profile); store.setPlan(draft); store.setGoal(Object.assign({}, draft.base, { confirmedAt: draft.confirmedAt })); store.recordEvent('plan_confirmed'); this.setData({ draft: null, draftPreview: null, swapFrom: '' }); this.load(); wx.showToast({ title: '计划已启用', icon: 'success' }); }
    } });
  },
  pickSwap(e) {
    const active = this.data.activePlan;
    if (!active || active.mode !== 'cycle') return;
    const date = e.currentTarget.dataset.date;
    if (!this.data.swapFrom) { this.setData({ swapFrom: date }); return; }
    if (this.data.swapFrom === date) { this.setData({ swapFrom: '' }); return; }
    const from = this.data.swapFrom;
    wx.showModal({ title: '交换两个日型？', content: from.slice(5) + ' 与 ' + date.slice(5) + ' 的高低碳安排将对调，餐食记录保持原样。', success: r => {
      this.setData({ swapFrom: '' });
      if (!r.confirm) return;
      try { store.updateActivePlan(swapDays(active, from, date)); store.recordEvent('day_swapped'); this.load(); }
      catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    } });
  },
  toRecord() { wx.switchTab({ url: '/pages/record/index' }); }
});
