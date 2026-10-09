const store = require('../../services/store');
const { dateKey, shiftKey } = require('../../core/date');
const { sumMeals, round } = require('../../core/nutrition');
const { resolveDay, preview, MODES } = require('../../core/plan');
const { recommendations } = require('../../core/nextMeal');
const { progress: badgeProgress } = require('../../core/badges');
const { loadMethods, cachedMethods } = require('../../services/methodCatalog');
const sync = require('../../services/sync');
const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const contextLabels = { normal: '普通日', training: '训练日', eatingOut: '外食日', busy: '忙碌日' };
Page({
  data: {
    today: '', weekday: '', greeting: '你好，今天也从容一点。', comeback: false, hasPlan: false, planName: '', dayTarget: null, tomorrow: null,
    weekDays: [], eaten: {}, remaining: 0, remainingAbs: 0, overTarget: false, remainingLabel: '还可安排', progress: 0, proteinProgress: 0, carbsProgress: 0, fatProgress: 0,
    meals: [], mealSlots: [], ideas: [], mealType: 'lunch', context: 'normal', contextLabel: '普通日', contextMessage: '',
    hasAnyGoal: false, startMethods: cachedMethods(), journey: { effectiveDays: 0, completeDays: 0, todayComplete: false, badges: [] }
  },
  onShow() {
    this.updateTab(); this.refresh(); this.refreshMethods();
    if (!this.syncOff) this.syncOff = sync.subscribe(() => this.refresh());
  },
  onReady() {
    this.viewReady = true;
    if (this.pendingMethods) {
      const methods = this.pendingMethods;
      this.pendingMethods = null;
      setTimeout(() => this.setData({ startMethods: methods }), 80);
    }
  },
  onHide() { if (this.syncOff) { this.syncOff(); this.syncOff = null; } },
  updateTab() { const tab = this.getTabBar && this.getTabBar(); if (tab && tab.data.selected !== 0) tab.setData({ selected: 0 }); },
  refreshMethods() {
    if (this.data.hasPlan) return;
    loadMethods(methods => {
      if (this.viewReady) setTimeout(() => this.setData({ startMethods: methods }), 0);
      else this.pendingMethods = methods;
    });
  },
  refresh() {
    const today = dateKey(), state = store.ensureState(), plan = state.activePlan;
    const meals = state.meals.filter(m => m.date === today);
    const comeback = !meals.length && state.meals.some(m => m.date <= shiftKey(today, -3)) &&
      !state.meals.some(m => m.date > shiftKey(today, -3) && m.date < today);
    const eaten = sumMeals(meals);
    const dayTarget = plan ? resolveDay(plan, today) : state.goal;
    const hasPlan = !!plan;
    const remaining = dayTarget ? round(dayTarget.calories - eaten.calories) : 0;
    const progress = dayTarget ? Math.min(100, Math.max(0, round(eaten.calories / dayTarget.calories * 100))) : 0;
    const context = state.dayContexts[today] || 'normal';
    const contextMessage = context === 'training' ? '训练计划有变化？在计划页交换日型，餐食记录保持原样。' : context === 'eatingOut' ? '外食先做选择，回来再按实际份量修改记录。' : context === 'busy' ? '忙的时候先记个大概，也比断掉记录更容易接回来。' : '先确认今天的节奏，再决定下一餐。';
    const mealSlots = [
      { type: 'breakfast', label: '早餐', number: '01', meals: meals.filter(m => m.type === 'breakfast') },
      { type: 'lunch', label: '午餐', number: '02', meals: meals.filter(m => m.type === 'lunch') },
      { type: 'dinner', label: '晚餐', number: '03', meals: meals.filter(m => m.type === 'dinner') },
      { type: 'snack', label: '加餐', number: '04', meals: meals.filter(m => m.type === 'snack') }
    ].map(slot => ({ ...slot, calories: sumMeals(slot.meals).calories, names: slot.meals.map(m => m.name).join('、') }));
    const week = plan ? preview(plan, today, 7).days.map(day => ({ date: day.date, weekday: weekNames[new Date(day.date + 'T12:00:00').getDay()].slice(1), number: day.date.slice(8), type: day.type, shortType: day.type === 'high' ? '高' : day.type === 'low' ? '低' : day.type === 'mid' ? '中' : '·' })) : [];
    const hour = new Date().getHours();
    const greeting = hour < 11 ? '早上好，今天从这里开始。' : hour < 17 ? '下午好，下一餐有方向。' : '晚上好，今天也值得好好收尾。';
    this.setData({ today, weekday: weekNames[new Date(today + 'T12:00:00').getDay()], greeting, comeback, hasPlan, planName: plan ? MODES[plan.mode] : '', dayTarget, tomorrow: plan ? resolveDay(plan, shiftKey(today, 1)) : null,
      weekDays: week, eaten, remaining, remainingAbs: Math.abs(remaining), overTarget: remaining < 0, remainingLabel: remaining < 0 ? '超过目标' : '还可安排', progress,
      proteinProgress: dayTarget && dayTarget.protein ? Math.min(100, round(eaten.protein / dayTarget.protein * 100)) : 0,
      carbsProgress: dayTarget && dayTarget.carbs ? Math.min(100, round(eaten.carbs / dayTarget.carbs * 100)) : 0,
      fatProgress: dayTarget && dayTarget.fat ? Math.min(100, round(eaten.fat / dayTarget.fat * 100)) : 0,
      meals, mealSlots, ideas: recommendations(state.meals, today, dayTarget, eaten, this.data.mealType), context, contextLabel: contextLabels[context], contextMessage, hasAnyGoal: !!state.goal,
      journey: badgeProgress(state, today) });
  },
  chooseType(e) { this.setData({ mealType: e.currentTarget.dataset.type }); this.refresh(); },
  chooseContext(e) { store.setDayContext(dateKey(), e.currentTarget.dataset.context); store.recordEvent('context_set'); this.refresh(); },
  reuseMeal(e) {
    const idea = this.data.ideas[+e.currentTarget.dataset.index];
    if (!idea) return;
    wx.setStorageSync('next_meal_draft_v1', idea);
    store.recordEvent('meal_reused');
    wx.switchTab({ url: '/pages/record/index' });
  },
  quickReuse(e) {
    const idea = this.data.ideas[+e.currentTarget.dataset.index];
    if (!idea) return;
    const tapKey = this.data.mealType + ':' + (idea.id || idea.name);
    const now = Date.now();
    if (this.lastQuickTap && this.lastQuickTap.key === tapKey && now - this.lastQuickTap.at < 1000) return;
    this.lastQuickTap = { key: tapKey, at: now };
    store.addMeal({ date: dateKey(), type: this.data.mealType, typeLabel: { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }[this.data.mealType], name: idea.name,
      calories: +idea.calories, protein: +idea.protein || 0, carbs: +idea.carbs || 0, fat: +idea.fat || 0, source: 'reused', sourceMealId: idea.id });
    store.recordEvent('meal_reused');
    this.refresh();
    wx.showToast({ title: '已记入今天', icon: 'success' });
  },
  completeToday() {
    try { store.completeDay(dateKey()); this.refresh(); wx.showToast({ title: '今天的记录已确认', icon: 'success' }); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  toPlan() { wx.switchTab({ url: '/pages/plan/index' }); },
  selectStartMethod(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.startMethods.some(method => method.id === id)) return;
    wx.setStorageSync('next_meal_selected_method_v1', id);
    this.toPlan();
  },
  toSettings() { wx.switchTab({ url: '/pages/settings/index' }); },
  toMealSlot(e) { wx.setStorageSync('next_meal_record_type_v1', e.currentTarget.dataset.type); this.toRecord(); },
  toRecord() { wx.switchTab({ url: '/pages/record/index' }); }
});
