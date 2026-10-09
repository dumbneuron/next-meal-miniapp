const { dateKey, shiftKey, validKey } = require('./date');
const { round } = require('./nutrition');

const MODES = { steady: '稳定执行', taper: '碳水渐降', cycle: '碳循环' };
const CYCLE_PATTERNS = {
  four: ['low', 'low', 'low', 'high'],
  six: ['low', 'low', 'mid', 'low', 'low', 'high']
};
const DAY_NAMES = { steady: '稳定日', stage1: '起步期', stage2: '渐降期', stage3: '巩固期', low: '低碳日', mid: '中碳日', high: '高碳日' };

function dayOffset(startDate, targetDate) {
  if (!validKey(startDate) || !validKey(targetDate)) throw new Error('日期格式错误');
  const utc = key => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
  return Math.round((utc(targetDate) - utc(startDate)) / 86400000);
}
function numberIn(value, min, max) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(+value) && +value >= min && +value <= max;
}
function validateBase(base) {
  if (!base || !numberIn(base.calories, 1000, 5000) || !numberIn(base.protein, 0, 400) || !numberIn(base.carbs, 0, 800) || !numberIn(base.fat, 0, 300)) throw new Error('请先填写完整的每日目标');
  return { calories: round(+base.calories), protein: round(+base.protein, 1), carbs: round(+base.carbs, 1), fat: round(+base.fat, 1) };
}
function buildPlan(input) {
  const mode = input && input.mode;
  if (!MODES[mode]) throw new Error('请选择计划模式');
  const startDate = input.startDate || dateKey();
  if (!validKey(startDate)) throw new Error('开始日期格式错误');
  const base = validateBase(input.base);
  const config = {};
  if (mode === 'taper') {
    if (!numberIn(input.stepGrams, 1, 100) || ![7, 14].includes(+input.stageDays)) throw new Error('请填写渐降克数并选择阶段天数');
    if (base.carbs - 2 * +input.stepGrams < 0) throw new Error('第三阶段碳水小于零');
    config.stepGrams = round(+input.stepGrams, 1);
    config.stageDays = +input.stageDays;
  }
  if (mode === 'cycle') {
    if (!CYCLE_PATTERNS[input.pattern]) throw new Error('请选择碳循环节奏');
    if (!numberIn(input.lowCarbs, 0, 800) || !numberIn(input.highCarbs, 0, 800)) throw new Error('请填写高低碳日克数');
    if (+input.lowCarbs >= +input.highCarbs) throw new Error('高碳日须高于低碳日');
    if (input.pattern === 'six' && !numberIn(input.midCarbs, 0, 800)) throw new Error('请填写中碳日克数');
    if (input.pattern === 'six' && !(+input.lowCarbs < +input.midCarbs && +input.midCarbs < +input.highCarbs)) throw new Error('碳水须满足低 < 中 < 高');
    config.pattern = input.pattern;
    config.lowCarbs = round(+input.lowCarbs, 1);
    config.midCarbs = input.pattern === 'six' ? round(+input.midCarbs, 1) : null;
    config.highCarbs = round(+input.highCarbs, 1);
  }
  const plan = { version: 1, mode, startDate, base, config, overrides: {}, confirmedAt: new Date().toISOString() };
  // Validate the first full pattern and all taper stages before it is saved.
  const horizon = mode === 'taper' ? config.stageDays * 3 : mode === 'cycle' ? CYCLE_PATTERNS[config.pattern].length : 1;
  for (let i = 0; i < horizon; i++) {
    const target = resolveDay(plan, shiftKey(startDate, i));
    if (target.calories < 1000 || target.calories > 5000) throw new Error('某阶段热量超出当前表单范围，请修改碳水数值');
  }
  return plan;
}
function scheduledType(plan, date) {
  const offset = dayOffset(plan.startDate, date);
  if (offset < 0) return 'steady';
  if (plan.mode === 'steady') return 'steady';
  if (plan.mode === 'taper') return 'stage' + Math.min(3, Math.floor(offset / plan.config.stageDays) + 1);
  const pattern = CYCLE_PATTERNS[plan.config.pattern];
  return pattern[offset % pattern.length];
}
function resolveDay(plan, date) {
  if (!plan) return null;
  const type = (plan.overrides && plan.overrides[date]) || scheduledType(plan, date);
  const base = plan.base;
  let carbs = base.carbs;
  if (plan.mode === 'taper' && type.startsWith('stage')) carbs = round(base.carbs - (Number(type.slice(-1)) - 1) * plan.config.stepGrams, 1);
  if (plan.mode === 'cycle' && ['low', 'mid', 'high'].includes(type)) carbs = plan.config[type + 'Carbs'];
  return { date, type, typeName: DAY_NAMES[type], calories: round(base.calories + (carbs - base.carbs) * 4), protein: base.protein, carbs, fat: base.fat, isOverride: !!(plan.overrides && plan.overrides[date]) };
}
function preview(plan, fromDate, count) {
  if (!plan) return { days: [], calories: 0, baselineCalories: 0, difference: 0 };
  const length = Math.max(1, Math.min(+count || 7, 28));
  const days = Array.from({ length }, (_, i) => resolveDay(plan, shiftKey(fromDate, i)));
  const calories = days.reduce((sum, day) => sum + day.calories, 0);
  return { days, calories, baselineCalories: plan.base.calories * length, difference: calories - plan.base.calories * length };
}
function swapDays(plan, dateA, dateB) {
  if (!plan || plan.mode !== 'cycle' || !validKey(dateA) || !validKey(dateB) || dayOffset(plan.startDate, dateA) < 0 || dayOffset(plan.startDate, dateB) < 0) throw new Error('只支持交换已开始的碳循环日期');
  const typeA = resolveDay(plan, dateA).type, typeB = resolveDay(plan, dateB).type;
  const next = Object.assign({}, plan, { overrides: Object.assign({}, plan.overrides) });
  next.overrides[dateA] = typeB;
  next.overrides[dateB] = typeA;
  return next;
}
function isUsablePlan(plan) {
  if (!plan || typeof plan !== 'object' || !MODES[plan.mode] || !validKey(plan.startDate)) return false;
  try {
    buildPlan(Object.assign({ mode: plan.mode, startDate: plan.startDate, base: plan.base }, plan.config));
    const overrides = plan.overrides || {};
    if (typeof overrides !== 'object' || Array.isArray(overrides)) return false;
    const allowed = plan.mode === 'cycle' ? CYCLE_PATTERNS[plan.config.pattern] : [];
    return Object.keys(overrides).every(date => validKey(date) && dayOffset(plan.startDate, date) >= 0 && allowed.includes(overrides[date]));
  } catch (_) { return false; }
}
module.exports = { MODES, CYCLE_PATTERNS, DAY_NAMES, dayOffset, validateBase, buildPlan, scheduledType, resolveDay, preview, swapDays, isUsablePlan };
