const KEY = 'next_meal_app_v2';
const LEGACY_KEY = 'next_meal_personal_v1';
const { dateKey, validKey } = require('../core/date');
const { isUsablePlan } = require('../core/plan');
function fresh() { return { version: 2, profile: {}, goal: null, goalHistory: [], activePlan: null, planHistory: [], dayContexts: {}, events: [], meals: [], weights: [], dayReviews: [], badgeAwards: [], pendingMutations: [], syncBootstrapped: false }; }
function normalize(input) {
  const s = input && typeof input === 'object' ? input : {};
  return {
    version: 2,
    profile: s.profile && typeof s.profile === 'object' ? s.profile : {},
    goal: s.goal && typeof s.goal === 'object' ? s.goal : null,
    goalHistory: Array.isArray(s.goalHistory) ? s.goalHistory.filter(g => g && typeof g === 'object' && Number.isFinite(+g.calories) && +g.calories > 0) : [],
    activePlan: isUsablePlan(s.activePlan) ? s.activePlan : null,
    planHistory: Array.isArray(s.planHistory) ? s.planHistory.filter(isUsablePlan) : [],
    dayContexts: s.dayContexts && typeof s.dayContexts === 'object' && !Array.isArray(s.dayContexts) ? s.dayContexts : {},
    events: Array.isArray(s.events) ? s.events.filter(e => e && typeof e.type === 'string' && validKey(e.date)).slice(0, 500) : [],
    meals: Array.isArray(s.meals) ? s.meals.filter(m => m && validKey(m.date) && typeof m.name === 'string') : [],
    weights: Array.isArray(s.weights) ? s.weights.filter(w => w && validKey(w.date) && +w.kg > 0) : [],
    dayReviews: Array.isArray(s.dayReviews) ? s.dayReviews.filter(r => r && validKey(r.date) && typeof r.at === 'string') : [],
    badgeAwards: Array.isArray(s.badgeAwards) ? s.badgeAwards.filter(a => a && typeof a.id === 'string') : [],
    pendingMutations: Array.isArray(s.pendingMutations) ? s.pendingMutations.filter(m => m && typeof m.id === 'string' && typeof m.type === 'string') : [],
    syncBootstrapped: s.syncBootstrapped === true
  };
}
function ensureState() {
  const raw = wx.getStorageSync(KEY) || wx.getStorageSync(LEGACY_KEY);
  const state = normalize(raw || fresh());
  if (!wx.getStorageSync(KEY)) wx.setStorageSync(KEY, state);
  return state;
}
function save(state) { const next = normalize(state); wx.setStorageSync(KEY, next); return next; }
function mutationId() { return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12); }
function queue(state, type, payload) { state.pendingMutations.push({ id: mutationId(), type, payload }); }
function notifySync() { try { require('./sync').schedule(); } catch (_) {} }
function setGoal(goal) {
  const s = ensureState();
  s.goal = goal;
  s.goalHistory.unshift(goal);
  queue(s, 'goal_set', goal); const result = save(s); notifySync(); return result;
}
function setProfile(profile) {
  const s = ensureState();
  s.profile = profile;
  queue(s, 'profile_set', profile); const result = save(s); notifySync(); return result;
}
function setPlan(plan) {
  if (!isUsablePlan(plan)) throw new Error('计划内容格式错误');
  const s = ensureState();
  const nextPlan = Object.assign({}, plan, { instanceId: plan.instanceId || mutationId() });
  s.activePlan = nextPlan;
  s.planHistory.unshift(nextPlan);
  queue(s, 'plan_set', nextPlan); const result = save(s); notifySync(); return result;
}
function updateActivePlan(plan) {
  if (!isUsablePlan(plan)) throw new Error('计划内容格式错误');
  const s = ensureState();
  if (!s.activePlan) throw new Error('请先创建计划');
  const nextPlan = Object.assign({}, plan, { instanceId: s.activePlan.instanceId || mutationId() });
  s.activePlan = nextPlan;
  const index = s.planHistory.findIndex(p => p.instanceId === nextPlan.instanceId);
  if (index >= 0) s.planHistory[index] = nextPlan;
  queue(s, 'plan_update', nextPlan); const result = save(s); notifySync(); return result;
}
function setDayContext(date, context) {
  if (!validKey(date) || !['normal', 'training', 'eatingOut', 'busy'].includes(context)) throw new Error('场景格式错误');
  const s = ensureState();
  s.dayContexts[date] = context;
  queue(s, 'context_set', { date, context }); const result = save(s); notifySync(); return result;
}
function recordEvent(type) {
  const allowed = ['plan_confirmed', 'day_swapped', 'context_set', 'meal_reused', 'meal_logged', 'weight_logged'];
  if (!allowed.includes(type)) throw new Error('事件类型错误');
  const s = ensureState();
  const now = new Date();
  s.events.unshift({ type, date: dateKey(now), at: now.toISOString() });
  s.events = s.events.slice(0, 500);
  return save(s);
}
function addMeal(meal) {
  const s = ensureState(); const entry = Object.assign({ id: mutationId() }, meal); s.meals.unshift(entry);
  queue(s, 'meal_upsert', entry); const result = save(s); notifySync(); return result;
}
function updateMeal(id, meal) {
  const s = ensureState();
  const index = s.meals.findIndex(entry => entry.id === id);
  if (index < 0) throw new Error('这条餐食已不存在，请刷新记录');
  const previous = s.meals[index];
  const next = Object.assign({}, meal, { id });
  s.meals[index] = next;
  if (previous.date !== next.date && !s.meals.some(entry => entry.date === previous.date)) {
    s.dayReviews = s.dayReviews.filter(review => review.date !== previous.date);
  }
  queue(s, 'meal_upsert', next);
  const result = save(s); notifySync(); return result;
}
function deleteMeal(id) { const s = ensureState(); const removed = s.meals.find(m => m.id === id); s.meals = s.meals.filter(m => m.id !== id); if (removed && !s.meals.some(m => m.date === removed.date)) s.dayReviews = s.dayReviews.filter(r => r.date !== removed.date); if (removed) queue(s, 'meal_delete', { id }); const result = save(s); if (removed) notifySync(); return result; }
function completeDay(date) {
  if (!validKey(date) || date > dateKey()) throw new Error('回顾日期错误');
  const s = ensureState();
  if (!s.meals.some(meal => meal.date === date)) throw new Error('先记下一餐，再确认今天已完整记录');
  if (!s.dayReviews.some(review => review.date === date)) { s.dayReviews.push({ date, at: new Date().toISOString() }); queue(s, 'day_complete', { date }); }
  const result = save(s); notifySync(); return result;
}
function upsertWeight(date, kg) {
  const s = ensureState(); s.weights = s.weights.filter(w => w.date !== date); s.weights.push({ date, kg: +kg }); s.weights.sort((a, b) => b.date.localeCompare(a.date));
  queue(s, 'weight_upsert', { date, kg: +kg }); const result = save(s); notifySync(); return result;
}
function queueExistingData() {
  const s = ensureState();
  if (s.syncBootstrapped) return s;
  const pending = s.pendingMutations.slice();
  s.pendingMutations = [];
  const hasType = type => pending.some(change => change.type === type);
  if (Object.keys(s.profile).length && !hasType('profile_set')) queue(s, 'profile_set', s.profile);
  if (s.activePlan) {
    s.activePlan = Object.assign({}, s.activePlan, { instanceId: s.activePlan.instanceId || mutationId() });
    if (!hasType('plan_set')) queue(s, 'plan_set', s.activePlan);
  }
  if (s.goal && !hasType('goal_set')) queue(s, 'goal_set', s.goal);
  for (const meal of s.meals.slice().reverse()) queue(s, 'meal_upsert', meal);
  for (const weight of s.weights.slice().reverse()) if (!pending.some(change => change.type === 'weight_upsert' && change.payload && change.payload.date === weight.date)) queue(s, 'weight_upsert', weight);
  for (const review of s.dayReviews) if (!pending.some(change => change.type === 'day_complete' && change.payload && change.payload.date === review.date)) queue(s, 'day_complete', { date: review.date });
  for (const [date, context] of Object.entries(s.dayContexts)) if (!pending.some(change => change.type === 'context_set' && change.payload && change.payload.date === date)) queue(s, 'context_set', { date, context });
  s.pendingMutations.push(...pending);
  s.syncBootstrapped = true;
  return save(s);
}
function applyRemoteSnapshot(snapshot, acknowledged) {
  const current = ensureState();
  const sent = new Set(acknowledged || []);
  const pending = current.pendingMutations.filter(m => !sent.has(m.id));
  const next = normalize(Object.assign({}, current, snapshot, { pendingMutations: pending, events: current.events,
    goalHistory: current.goalHistory.length ? current.goalHistory : snapshot.goal ? [snapshot.goal] : [] }));
  for (const change of pending) {
    const p = change.payload;
    if (change.type === 'profile_set') next.profile = p;
    if (change.type === 'goal_set') next.goal = p;
    if (change.type === 'plan_set' || change.type === 'plan_update') {
      next.activePlan = p;
      const index = next.planHistory.findIndex(plan => plan.instanceId === p.instanceId);
      if (index >= 0) next.planHistory[index] = p; else next.planHistory.unshift(p);
    }
    if (change.type === 'meal_upsert') { next.meals = next.meals.filter(meal => meal.id !== p.id); next.meals.unshift(p); }
    if (change.type === 'meal_delete') next.meals = next.meals.filter(meal => meal.id !== p.id);
    if (change.type === 'weight_upsert') { next.weights = next.weights.filter(weight => weight.date !== p.date); next.weights.unshift(p); }
    if (change.type === 'day_complete' && !next.dayReviews.some(day => day.date === p.date)) next.dayReviews.push({ date: p.date, at: new Date().toISOString() });
    if (change.type === 'context_set') next.dayContexts[p.date] = p.context;
  }
  return save(next);
}
function dropPendingPlanUpdates() {
  const s = ensureState();
  const before = s.pendingMutations.length;
  s.pendingMutations = s.pendingMutations.filter(m => m.type !== 'plan_update');
  save(s);
  return before - s.pendingMutations.length;
}
function exportJson() { return JSON.stringify(ensureState(), null, 2); }
function resetLocal() { return save(fresh()); }
function importJson(json) {
  const parsed = JSON.parse(json);
  if (!parsed || ![1, 2].includes(parsed.version) || !Array.isArray(parsed.meals) || !Array.isArray(parsed.weights)) throw new Error('备份格式不匹配');
  return save(parsed);
}
module.exports = { KEY, LEGACY_KEY, fresh, normalize, ensureState, save, setGoal, setProfile, setPlan, updateActivePlan, setDayContext, recordEvent, addMeal, updateMeal, deleteMeal, completeDay, upsertWeight, queueExistingData, applyRemoteSnapshot, dropPendingPlanUpdates, exportJson, importJson, resetLocal };
