const { round, macroCalories } = require('./nutrition');

const ACTIVITY = {
  sedentary: { label: '久坐为主', multiplier: 1.2, proteinPerKg: 1.4 },
  light: { label: '每周轻活动', multiplier: 1.375, proteinPerKg: 1.5 },
  moderate: { label: '每周规律训练', multiplier: 1.55, proteinPerKg: 1.6 },
  active: { label: '高频训练', multiplier: 1.725, proteinPerKg: 1.8 }
};
const FORMULA_VERSION = 'msj-activity15-macro-v1';

function validNumber(value, min, max) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(+value) && +value >= min && +value <= max;
}
function estimate(profile) {
  if (!profile || !['male', 'female'].includes(profile.sex)) throw new Error('请选择计算用性别');
  if (!validNumber(profile.age, 18, 65) || !Number.isInteger(+profile.age)) throw new Error('请填写 18–65 岁年龄');
  if (!validNumber(profile.heightCm, 130, 230)) throw new Error('请填写身高（厘米）');
  if (!validNumber(profile.weightKg, 30, 250)) throw new Error('请填写体重（千克）');
  if (!ACTIVITY[profile.activity]) throw new Error('请选择日常活动量');
  if (profile.healthClear !== true) throw new Error('请先确认适用情况');
  const weight = +profile.weightKg, height = +profile.heightCm, age = +profile.age;
  const bmr = round(10 * weight + 6.25 * height - 5 * age + (profile.sex === 'male' ? 5 : -161));
  const activity = ACTIVITY[profile.activity];
  const maintenance = round(bmr * activity.multiplier);
  const plannedCalories = round(maintenance * 0.85 / 10) * 10;
  if (plannedCalories < 1200 || plannedCalories > 4000) throw new Error('该资料超出当前自动估算范围，请使用专业评估');
  const protein = Math.min(200, round(weight * activity.proteinPerKg));
  const fat = round(plannedCalories * 0.25 / 9);
  const carbs = round((plannedCalories - protein * 4 - fat * 9) / 4);
  if (carbs < 0) throw new Error('自动分配结果异常，请使用专业评估');
  const base = { calories: macroCalories({ protein, carbs, fat }), protein, carbs, fat };
  return { base, details: { bmr, maintenance, plannedCalories, multiplier: activity.multiplier, proteinPerKg: activity.proteinPerKg, formulaVersion: FORMULA_VERSION } };
}
function proposeMode(mode, base) {
  if (!base || !validNumber(base.carbs, 0, 800)) throw new Error('请先生成基础目标');
  const carbs = +base.carbs;
  if (mode === 'taper') return { stepGrams: 15, stageDays: 7 };
  if (mode === 'cycle') return { pattern: 'four', lowCarbs: round(carbs * 0.8), midCarbs: carbs, highCarbs: round(carbs * 1.6) };
  return {};
}
function proposeCyclePattern(pattern, base) {
  if (!base || !validNumber(base.carbs, 0, 800)) throw new Error('请先生成基础目标');
  const carbs = +base.carbs;
  return pattern === 'six'
    ? { lowCarbs: round(carbs * 0.85), midCarbs: carbs, highCarbs: round(carbs * 1.6) }
    : { lowCarbs: round(carbs * 0.8), midCarbs: carbs, highCarbs: round(carbs * 1.6) };
}
module.exports = { ACTIVITY, FORMULA_VERSION, estimate, proposeMode, proposeCyclePattern };
