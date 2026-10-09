const store = require('../../services/store');
const { dateKey } = require('../../core/date');
const { progress } = require('../../core/badges');
const { weeklyReview } = require('../../core/weeklyReview');
const { milestoneReview } = require('../../core/milestoneReview');
const sync = require('../../services/sync');

Page({
  data: { growth: { effectiveDays: 0, completeDays: 0, badges: [] }, week: { days: [], effectiveDays: 0, completeDays: 0, message: '' }, milestones: { firstFive: { unlocked: false }, tenComplete: { unlocked: false } }, unlockedCount: 0 },
  onShow() { this.load(); if (!this.syncOff) this.syncOff = sync.subscribe(() => this.load()); },
  onHide() { if (this.syncOff) { this.syncOff(); this.syncOff = null; } },
  onUnload() { this.onHide(); },
  load() {
    const state = store.ensureState();
    const today = dateKey();
    const growth = progress(state, today);
    this.setData({ growth, week: weeklyReview(state, today), milestones: milestoneReview(state, today), unlockedCount: growth.badges.filter(item => item.unlocked).length });
  },
  toRecord() { wx.switchTab({ url: '/pages/record/index' }); },
  toTrend() { wx.switchTab({ url: '/pages/trend/index' }); }
});
