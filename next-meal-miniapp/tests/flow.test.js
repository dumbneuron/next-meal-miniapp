const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const state = new Map();
global.wx = {
  getStorageSync: key => state.get(key),
  setStorageSync: (key, value) => state.set(key, structuredClone(value)),
  showModal: options => { if (options.success) options.success({ confirm: true }); },
  showToast: () => {}, pageScrollTo: () => {}, switchTab: () => {}, navigateBack: () => {}
};
function loadPage(relative) {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '..', relative);
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), getTabBar: () => null });
  page.setData = patch => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let target = page.data;
      while (parts.length > 1) target = target[parts.shift()];
      target[parts[0]] = value;
    }
  };
  return page;
}

test('plan creation flows into Today and context changes persist', () => {
  state.clear();
  const plan = loadPage('pages/plan/index.js');
  plan.onShow();
  plan.onReady();
  plan.chooseMode({ currentTarget: { dataset: { mode: 'cycle' } } });
  plan.chooseSex({ detail: { value: '1' } });
  for (const [field, value] of Object.entries({ age: '28', heightCm: '175', weightKg: '94.3' })) {
    plan.profileInput({ currentTarget: { dataset: { field } }, detail: { value } });
  }
  plan.toggleHealth();
  plan.calculate();
  assert.equal(plan.data.form.calories, 2222);
  plan.build();
  assert.equal(plan.data.draftPreview.days.length, 7);
  plan.activate();
  const store = require('../services/store');
  assert.equal(store.ensureState().activePlan.mode, 'cycle');
  assert.deepEqual(store.ensureState().activePlan.methodRef, { id: 'cycle', version: 1, title: '碳循环' });
  const today = loadPage('pages/today/index.js');
  today.onShow();
  today.onReady();
  assert.equal(today.data.hasPlan, true);
  assert.equal(today.data.dayTarget.type, 'low');
  today.chooseContext({ currentTarget: { dataset: { context: 'training' } } });
  assert.equal(today.data.contextLabel, '训练日');
  assert.equal(store.ensureState().events[0].type, 'context_set');
});

test('taper preview exposes all three stage targets even when the first seven days are flat', () => {
  state.clear();
  const plan = loadPage('pages/plan/index.js');
  plan.onShow();
  plan.chooseMode({ currentTarget: { dataset: { mode: 'taper' } } });
  plan.chooseSex({ detail: { value: '1' } });
  for (const [field, value] of Object.entries({ age: '27', heightCm: '175', weightKg: '93' })) {
    plan.profileInput({ currentTarget: { dataset: { field } }, detail: { value } });
  }
  plan.toggleHealth();
  plan.calculate();
  plan.build();
  const stages = plan.data.draftPreview.stages;
  assert.equal(plan.data.draftPreview.days.length, 7);
  assert.deepEqual(stages.map(stage => stage.range), ['1–7 天', '8–14 天', '15–21 天']);
  assert.equal(stages.length, 3);
  assert.equal(stages[0].carbs - stages[1].carbs, 15);
  assert.equal(stages[1].carbs - stages[2].carbs, 15);
  assert.equal(stages[0].calories - stages[1].calories, 60);
  plan.chooseStage({ currentTarget: { dataset: { days: 14 } } });
  plan.build();
  assert.deepEqual(plan.data.draftPreview.stages.map(stage => stage.range), ['1–14 天', '15–28 天', '29–42 天']);
});

test('profile editor saves actual body data and My shows badge progress without changing the current goal', () => {
  state.clear();
  const profile = loadPage('pages/profile/index.js');
  profile.onShow();
  for (const [field, value] of Object.entries({ age: '29', heightCm: '168', weightKg: '72' })) {
    profile.input({ currentTarget: { dataset: { field } }, detail: { value } });
  }
  profile.toggleHealth();
  profile.save();
  const store = require('../services/store');
  assert.equal(store.ensureState().profile.weightKg, '72');
  assert.equal(store.ensureState().goal, null);
  const { dateKey } = require('../core/date');
  const today = dateKey();
  store.addMeal({ date: today, type: 'lunch', name: '午餐', calories: 450, protein: 20, carbs: 50, fat: 15 });
  store.completeDay(today);
  const mine = loadPage('pages/settings/index.js');
  mine.load();
  assert.equal(mine.data.profileInfo.weight, '72');
  assert.equal(mine.data.growth.effectiveDays, 1);
  assert.equal(mine.data.growth.completeDays, 1);
  assert.equal(mine.data.growth.badges[0].count, 1);
  assert.equal(mine.data.hasProfile, true);
  assert.equal(mine.data.weightLabel, '资料体重');
  store.upsertWeight(today, 71.4);
  mine.load();
  assert.equal(mine.data.weightLabel, '最近晨重');
  assert.equal(mine.data.weightDisplay, 71.4);
  assert.equal(mine.data.featuredBadge.id, 'first-five');
  assert.match(mine.data.growthHeadline, /还差 4 天/);
  const growth = loadPage('pages/growth/index.js');
  growth.load();
  assert.equal(growth.data.growth.effectiveDays, 1);
  assert.equal(growth.data.week.completeDays, 1);
});

test('recording a meal shows immediate daily feedback and undo clears it', () => {
  state.clear();
  const record = loadPage('pages/record/index.js');
  record.onLoad();
  record.onShow();
  record.input({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '米饭' } });
  record.input({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '230' } });
  record.save();
  assert.match(record.data.lastAddedSummary, /今天已记录 230 kcal/);
  assert.ok(record.data.lastAddedMealId);
  record.undoLastMeal();
  assert.equal(record.data.lastAddedSummary, '');
  assert.equal(require('../services/store').ensureState().meals.length, 0);
  record.onHide();
});

test('meal form explains invalid values inline and does not save them', () => {
  state.clear();
  const record = loadPage('pages/record/index.js');
  record.onLoad();
  record.onShow();
  const store = require('../services/store');
  record.save();
  assert.match(record.data.entryError, /食物名称/);
  record.input({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '测试餐' } });
  assert.equal(record.data.entryError, '');
  record.save();
  assert.match(record.data.entryError, /热量/);
  record.input({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '6000' } });
  record.save();
  assert.match(record.data.entryError, /5000/);
  record.input({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '300' } });
  record.input({ currentTarget: { dataset: { field: 'protein' } }, detail: { value: '-2' } });
  record.save();
  assert.match(record.data.entryError, /营养素/);
  assert.equal(store.ensureState().meals.length, 0);
  record.input({ currentTarget: { dataset: { field: 'protein' } }, detail: { value: '20' } });
  record.save();
  assert.equal(record.data.entryError, '');
  assert.equal(store.ensureState().meals.length, 1);
  record.onHide();
});

test('backfilled meal feedback names the past date rather than claiming it was eaten today', () => {
  state.clear();
  const record = loadPage('pages/record/index.js');
  record.onLoad();
  record.onShow();
  const { shiftKey, dateKey } = require('../core/date');
  const yesterday = shiftKey(dateKey(), -1);
  record.chooseDate({ detail: { value: yesterday } });
  record.input({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '补记晚餐' } });
  record.input({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '500' } });
  record.save();
  assert.match(record.data.lastAddedSummary, new RegExp(yesterday));
  assert.ok(record.data.lastAddedMealId);
  record.onHide();
});

test('Today welcomes a returning user without resetting their prior records', () => {
  state.clear();
  const store = require('../services/store');
  const { shiftKey, dateKey } = require('../core/date');
  const oldDate = shiftKey(dateKey(), -4);
  store.addMeal({ date: oldDate, type: 'lunch', name: '熟悉的午餐', calories: 480 });
  const today = loadPage('pages/today/index.js');
  today.refresh();
  assert.equal(today.data.comeback, true);
  assert.equal(store.ensureState().meals.length, 1);
  store.addMeal({ date: dateKey(), type: 'lunch', name: '今天的午餐', calories: 500 });
  today.refresh();
  assert.equal(today.data.comeback, false);
  assert.equal(store.ensureState().meals.length, 2);
});

test('barcode candidate uses the entered portion and saves source only after user confirmation', () => {
  state.clear();
  global.wx.request = ({ url, success }) => {
    if (url.includes('/api/foods/search')) { success({ statusCode: 200, data: { foods: [] } }); return; }
    assert.match(url, /\/api\/foods\/barcode\/3017620422003$/);
    success({ statusCode: 200, data: { status: 'candidate_ready', product: { name: '包装燕麦', barcode: '3017620422003', sourceUrl: 'https://world.openfoodfacts.org/product/3017620422003',
      basisUnit: 'g', nutrition: { calories: 200, protein: 6, carbs: 30, fat: 5 } } } });
  };
  try {
    const record = loadPage('pages/record/index.js');
    record.onLoad(); record.onShow();
    record.toggleBarcode();
    record.inputBarcode({ detail: { value: '3017620422003' } });
    record.queryBarcode();
    assert.equal(record.data.barcodePreview.calories, '200');
    record.inputBarcodeAmount({ detail: { value: '150' } });
    record.useBarcodeCandidate();
    assert.equal(record.data.form.calories, '300');
    assert.equal(record.data.form.protein, '9');
    record.save();
    const meal = require('../services/store').ensureState().meals[0];
    assert.equal(meal.calories, 300);
    assert.equal(meal.portionAmount, 150);
    assert.equal(meal.nutritionSource, 'Open Food Facts');
    record.queryBarcode();
    record.useBarcodeCandidate();
    record.input({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '280' } });
    record.save();
    const edited = require('../services/store').ensureState().meals[0];
    assert.equal(edited.calories, 280);
    assert.equal(edited.nutritionSource, undefined);
  } finally { delete global.wx.request; }
});

test('late barcode response does not overwrite a newer barcode query', () => {
  state.clear();
  const pending = [];
  global.wx.request = ({ url, success }) => { if (url.includes('/api/foods/search')) { success({ statusCode: 200, data: { foods: [] } }); return; } pending.push(success); };
  try {
    const record = loadPage('pages/record/index.js');
    record.onLoad(); record.onShow();
    record.inputBarcode({ detail: { value: '3017620422003' } });
    record.queryBarcode();
    record.inputBarcode({ detail: { value: '12345678' } });
    record.queryBarcode();
    const candidate = barcode => ({ statusCode: 200, data: { status: 'candidate_ready', product: { name: barcode, barcode, basisUnit: 'g',
      nutrition: { calories: 200, protein: 6, carbs: 30, fat: 5 } } } });
    pending[0](candidate('3017620422003'));
    assert.equal(record.data.barcodeCandidate, null);
    pending[1](candidate('12345678'));
    assert.equal(record.data.barcodeCandidate.name, '12345678');
  } finally { delete global.wx.request; }
});

test('ordinary food search scales a user-confirmed portion and clears source after edits', () => {
  state.clear();
  const rice = { fdcId: 169757, name: '熟白米饭', description: 'Rice, cooked without salt', sourceUrl: 'https://fdc.nal.usda.gov/food-details/169757/nutrients',
    basisUnit: 'g', nutrition: { calories: 130, protein: 2.69, carbs: 28.17, fat: 0.28 } };
  global.wx.request = ({ url, success }) => {
    assert.match(url, /\/api\/foods\/search/);
    success({ statusCode: 200, data: { foods: [rice] } });
  };
  try {
    const record = loadPage('pages/record/index.js');
    record.onLoad(); record.onShow();
    assert.equal(record.data.foodResults[0].name, '熟白米饭');
    record.selectFood({ currentTarget: { dataset: { index: 0 } } });
    record.selectMealType({ currentTarget: { dataset: { index: 0 } } });
    record.inputFoodAmount({ detail: { value: '200' } });
    record.saveFoodCandidate();
    const direct = require('../services/store').ensureState().meals[0];
    assert.equal(direct.calories, 260);
    assert.equal(direct.type, 'breakfast');
    assert.equal(direct.portionAmount, 200);
    assert.equal(record.data.lastAddedMealId, direct.id);
    record.undoLastMeal();
    assert.equal(require('../services/store').ensureState().meals.length, 0);
    record.selectFood({ currentTarget: { dataset: { index: 0 } } });
    record.inputFoodAmount({ detail: { value: '150' } });
    record.useFoodCandidate();
    assert.equal(record.data.form.calories, '195');
    assert.equal(record.data.form.carbs, '42.3');
    record.save();
    const meal = require('../services/store').ensureState().meals[0];
    assert.equal(meal.fdcId, 169757);
    assert.equal(meal.portionAmount, 150);
    assert.equal(meal.nutritionSource, 'USDA FoodData Central · SR Legacy 2018');
    record.selectFood({ currentTarget: { dataset: { index: 0 } } });
    record.useFoodCandidate();
    record.input({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '200' } });
    record.save();
    assert.equal(require('../services/store').ensureState().meals[0].nutritionSource, undefined);
    record.onUnload();
  } finally { delete global.wx.request; }
});

test('editing a saved meal keeps its ID, corrects totals, and clears stale source after nutrition changes', () => {
  state.clear();
  const store = require('../services/store');
  const { dateKey } = require('../core/date');
  const yesterday = dateKey(new Date(Date.now() - 86400000));
  const original = store.addMeal({ date: yesterday, type: 'lunch', typeLabel: '午餐', name: '熟白米饭',
    calories: 130, protein: 2.69, carbs: 28.17, fat: 0.28, source: 'catalog_user_confirmed',
    nutritionSource: 'USDA FoodData Central · SR Legacy 2018', fdcId: 169757 }).meals[0];
  store.completeDay(yesterday);
  const record = loadPage('pages/record/index.js');
  record.onLoad(); record.onShow();
  record.editMeal({ currentTarget: { dataset: { index: 0 } } });
  record.chooseDate({ detail: { value: dateKey() } });
  record.selectMealType({ currentTarget: { dataset: { index: 0 } } });
  record.save();
  let latest = store.ensureState();
  assert.equal(latest.meals.length, 1);
  assert.equal(latest.meals[0].id, original.id);
  assert.equal(latest.meals[0].type, 'breakfast');
  assert.equal(latest.meals[0].nutritionSource, 'USDA FoodData Central · SR Legacy 2018');
  assert.equal(latest.dayReviews.some(review => review.date === yesterday), false);
  record.editMeal({ currentTarget: { dataset: { index: 0 } } });
  record.input({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '200' } });
  record.save();
  latest = store.ensureState();
  assert.equal(latest.meals.length, 1);
  assert.equal(latest.meals[0].calories, 200);
  assert.equal(latest.meals[0].nutritionSource, undefined);
  assert.equal(latest.meals[0].fdcId, undefined);
  assert.equal(latest.pendingMutations.filter(mutation => mutation.type === 'meal_upsert').length, 3);
  record.onUnload();
});
