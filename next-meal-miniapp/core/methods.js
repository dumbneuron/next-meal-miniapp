const { round } = require('./nutrition');
const { buildPlan, preview } = require('./plan');

const FALLBACK_METHODS = Object.freeze([
  { id: 'steady', version: 1, title: '稳定执行', subtitle: '每天保持同一节奏，先建立习惯', suitable: '刚开始记录，想要简单稳定的人', mode: 'steady', config: {}, sourceTitle: '下一餐基础方法' },
  { id: 'taper', version: 1, title: '碳水渐降', subtitle: '分阶段预览，调整前先看反馈', suitable: '已经建立记录习惯、想尝试阶段安排的人', mode: 'taper', config: { stageDays: 7, stepGrams: 15 }, sourceTitle: '下一餐基础方法' },
  { id: 'cycle', version: 1, title: '碳循环', subtitle: '高低碳日按训练节奏排程', suitable: '有固定训练安排、愿意关注日型的人', mode: 'cycle', config: { pattern: 'four', lowMultiplier: 0.8, midMultiplier: 1, highMultiplier: 1.6 }, sourceTitle: '下一餐基础方法' }
]);

function validNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function validateMethod(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('方法内容格式错误');
  const id = String(input.id || '').trim();
  const title = String(input.title || '').trim();
  const subtitle = String(input.subtitle || '').trim();
  const suitable = String(input.suitable || '').trim();
  const sourceTitle = String(input.sourceTitle || '').trim();
  const sourceUrl = String(input.sourceUrl || '').trim();
  const mode = input.mode;
  const version = Number(input.version);
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw new Error('方法 ID 格式错误');
  if (!Number.isInteger(version) || version < 1 || version > 9999) throw new Error('方法版本错误');
  if (!title || title.length > 40 || !subtitle || subtitle.length > 100 || !suitable || suitable.length > 120) throw new Error('方法名称或说明缺失');
  if (!sourceTitle || sourceTitle.length > 100 || sourceUrl.length > 500 || (sourceUrl && !/^https:\/\//.test(sourceUrl))) throw new Error('方法来源格式错误');
  if (!['steady', 'taper', 'cycle'].includes(mode)) throw new Error('暂不支持的方法规则类型');
  const config = input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? input.config : {};
  let clean = {};
  if (mode === 'taper') {
    if (![7, 14].includes(config.stageDays) || !validNumber(config.stepGrams, 1, 40)) throw new Error('渐降阶段参数超出范围');
    clean = { stageDays: config.stageDays, stepGrams: config.stepGrams };
  }
  if (mode === 'cycle') {
    if (!['four', 'six'].includes(config.pattern) || !validNumber(config.lowMultiplier, 0.5, 1) || !validNumber(config.highMultiplier, 1, 2)) throw new Error('碳循环参数超出范围');
    const mid = config.pattern === 'six' ? config.midMultiplier : 1;
    if (!validNumber(mid, 0.75, 1.25) || !(config.lowMultiplier < mid && mid < config.highMultiplier)) throw new Error('碳循环低中高日顺序错误');
    const average = config.pattern === 'four'
      ? (config.lowMultiplier * 3 + config.highMultiplier) / 4
      : (config.lowMultiplier * 4 + mid + config.highMultiplier) / 6;
    if (average < 0.9 || average > 1.1) throw new Error('碳循环平均碳水偏离起点过大');
    clean = { pattern: config.pattern, lowMultiplier: config.lowMultiplier, midMultiplier: mid, highMultiplier: config.highMultiplier };
  }
  return { id, version, title, subtitle, suitable, sourceTitle, sourceUrl, mode, config: clean };
}
function configForMethod(methodInput, base) {
  const method = validateMethod(methodInput);
  if (!base || !validNumber(+base.carbs, 0, 800)) throw new Error('请先生成基础目标');
  if (method.mode === 'steady') return {};
  if (method.mode === 'taper') return Object.assign({}, method.config);
  const carbs = +base.carbs;
  const config = method.config;
  return {
    pattern: config.pattern,
    lowCarbs: round(carbs * config.lowMultiplier),
    midCarbs: round(carbs * config.midMultiplier),
    highCarbs: round(carbs * config.highMultiplier)
  };
}
function buildMethodPlan(methodInput, base, startDate) {
  const method = validateMethod(methodInput);
  const config = configForMethod(method, base);
  const plan = buildPlan(Object.assign({ mode: method.mode, startDate, base }, config));
  plan.methodRef = { id: method.id, version: method.version, title: method.title };
  return plan;
}
function testMethod(methodInput) {
  const method = validateMethod(methodInput);
  const scenarios = [
    { calories: 1650, protein: 100, carbs: 185, fat: 57 },
    { calories: 2100, protein: 135, carbs: 250, fat: 72 },
    { calories: 2800, protein: 170, carbs: 350, fat: 80 }
  ];
  return scenarios.map(base => {
    const plan = buildMethodPlan(method, base, '2026-01-01');
    const result = preview(plan, '2026-01-01', 14);
    if (result.days.some(day => day.calories < 1200 || day.calories > 4000)) throw new Error('样例日目标超出自动方法发布范围');
    return { baseCalories: base.calories, minCalories: Math.min(...result.days.map(d => d.calories)), maxCalories: Math.max(...result.days.map(d => d.calories)), averageCalories: round(result.calories / 14) };
  });
}
module.exports = { FALLBACK_METHODS, validateMethod, configForMethod, buildMethodPlan, testMethod };
