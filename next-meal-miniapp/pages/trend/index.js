const store = require('../../services/store');
const { dateKey, validKey } = require('../../core/date');
const { review } = require('../../core/review');
const { MODES } = require('../../core/plan');
const { weeklyReview } = require('../../core/weeklyReview');
const sync = require('../../services/sync');
Page({
  data: { date: '', kg: '', today: '', result: null, week: null, weights: [], chartBars: [], hasGoal: false, planName: '', deltaText: '等待更多记录' },
  onLoad() { this.setData({ date: dateKey(), today: dateKey() }); },
  onShow() { if (this.getTabBar()) this.getTabBar().setData({ selected: 3 }); this.refresh(); if (!this.syncOff) this.syncOff = sync.subscribe(() => this.refresh()); },
  onHide() { if (this.syncOff) { this.syncOff(); this.syncOff = null; } },
  refresh() {
    const s = store.ensureState(), result = review(s.weights, s.meals, dateKey());
    const points = s.weights.slice(0, 14).reverse();
    const values = points.map(w => +w.kg), min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 0;
    const chartBars = points.map(w => ({ date: w.date, dayNumber: w.date.slice(8), kg: w.kg, height: 28 + (max === min ? 35 : Math.round((+w.kg - min) / (max - min) * 65)) }));
    const deltaText = !result.ready ? '等待更多记录' : result.delta < 0 ? '均重下降 ' + Math.abs(result.delta) + ' kg' : result.delta > 0 ? '均重上升 ' + result.delta + ' kg' : '均重接近持平';
    this.setData({ result, week: weeklyReview(s, dateKey()), weights: s.weights.slice(0, 20), chartBars, hasGoal: !!s.goal, planName: s.activePlan ? MODES[s.activePlan.mode] : '', deltaText });
  },
  chooseDate(e) { this.setData({ date: e.detail.value }); },
  inputKg(e) { this.setData({ kg: e.detail.value }); },
  saveWeight() {
    const kg = +this.data.kg;
    if (!validKey(this.data.date) || this.data.date > dateKey() || !Number.isFinite(kg) || kg < 25 || kg > 350) { wx.showToast({ title: '检查日期和体重数值', icon: 'none' }); return; }
    store.upsertWeight(this.data.date, kg);
    store.recordEvent('weight_logged');
    this.setData({ kg: '' }); this.refresh(); wx.showToast({ title: '晨重已保存', icon: 'success' });
  }
});
