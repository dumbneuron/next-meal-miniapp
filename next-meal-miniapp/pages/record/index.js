const store = require('../../services/store');
const { dateKey, validKey } = require('../../core/date');
const { macroCalories, sumMeals, round } = require('../../core/nutrition');
const { resolveDay } = require('../../core/plan');
const { searchQuickMeals, scaleMeal } = require('../../core/quickMeal');
const { scaleProduct } = require('../../core/foodPortion');
const { lookupBarcode } = require('../../services/foodLookup');
const { searchFoods } = require('../../services/foodCatalog');
const sync = require('../../services/sync');
const types = ['breakfast', 'lunch', 'dinner', 'snack'];
const labels = ['早餐', '午餐', '晚餐', '加餐'];
Page({
  data: { form: { date: '', type: 'lunch', name: '', calories: '', protein: '', carbs: '', fat: '' }, typeIndex: 1, typeLabels: labels, selectedTypeLabel: '午餐', showMacros: false, recent: [], quick: [], quickSearch: '', reuseBase: null, portionScale: 1, today: '',
    showBarcode: false, barcodeInput: '', barcodeBusy: false, barcodeError: '', barcodeCandidate: null, barcodeAmount: '100', barcodePreview: null, barcodeSource: null,
    foodQuery: '', foodResults: [], foodBusy: false, foodError: '', foodCandidate: null, foodAmount: '100', foodPreview: null, catalogSource: null,
    lastAddedMealId: '', lastAddedName: '', lastAddedSummary: '', lastAddedAtDate: '', editingMealId: '', entryError: '' },
  onLoad() { this.setData({ 'form.date': dateKey(), today: dateKey() }); this.queryFoods(); },
  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 2 });
    const requestedType = wx.getStorageSync('next_meal_record_type_v1');
    if (types.includes(requestedType)) {
      wx.removeStorageSync('next_meal_record_type_v1');
      const typeIndex = types.indexOf(requestedType);
      this.setData({ typeIndex, selectedTypeLabel: labels[typeIndex], 'form.type': requestedType });
    }
    const draft = wx.getStorageSync('next_meal_draft_v1');
    if (draft && draft.name) {
      wx.removeStorageSync('next_meal_draft_v1');
      const typeIndex = Math.max(0, types.indexOf(draft.type));
      this.setData({ typeIndex, selectedTypeLabel: labels[typeIndex], showMacros: true, reuseBase: draft, portionScale: 1, form: { date: dateKey(), type: types[typeIndex], name: draft.name, calories: String(draft.calories), protein: String(draft.protein), carbs: String(draft.carbs), fat: String(draft.fat) } });
    }
    this.refresh();
    if (!this.syncOff) this.syncOff = sync.subscribe(() => this.refresh());
  },
  onHide() { if (this.syncOff) { this.syncOff(); this.syncOff = null; } },
  onUnload() { this.pageGone = true; this.barcodeRequestId = (this.barcodeRequestId || 0) + 1; this.foodRequestId = (this.foodRequestId || 0) + 1; clearTimeout(this.foodTimer); this.onHide(); },
  refresh() {
    const state = store.ensureState();
    const query = this.data.quickSearch.trim();
    const undoValid = !this.data.lastAddedMealId || this.data.lastAddedAtDate === dateKey() && state.meals.some(meal => meal.id === this.data.lastAddedMealId);
    this.setData({ recent: state.meals.slice(0, 20), quick: searchQuickMeals(state.meals, dateKey(), query, query ? 12 : 4),
      ...(undoValid ? {} : { lastAddedMealId: '', lastAddedName: '', lastAddedSummary: '', lastAddedAtDate: '' }) });
  },
  offerUndo(state) {
    const latest = state && state.meals && state.meals[0];
    if (!latest) return;
    const today = dateKey();
    const eaten = sumMeals(state.meals.filter(meal => meal.date === today));
    const target = state.activePlan ? resolveDay(state.activePlan, today) : state.goal;
    const remaining = target ? round(target.calories - eaten.calories) : null;
    const summary = latest.date !== today ? `已补记 ${latest.date} 的餐食，可在最近记录中修改。` : remaining === null ? `今天已记录 ${eaten.calories} kcal，这一餐下次可以直接复用。` :
      remaining >= 0 ? `今天已记录 ${eaten.calories} kcal，还可安排约 ${remaining} kcal。` :
        `今天已记录 ${eaten.calories} kcal；目标是参考，下一餐正常记录。`;
    this.setData({ lastAddedMealId: latest.id, lastAddedName: latest.name, lastAddedSummary: summary, lastAddedAtDate: today });
  },
  undoLastMeal() {
    const id = this.data.lastAddedMealId;
    if (!id) return;
    store.deleteMeal(id);
    this.setData({ lastAddedMealId: '', lastAddedName: '', lastAddedSummary: '', lastAddedAtDate: '' });
    this.refresh(); wx.showToast({ title: '已撤销记录', icon: 'success' });
  },
  jumpToManual() { wx.pageScrollTo({ selector: '#manual-entry', duration: 220 }); },
  searchQuick(e) { this.setData({ quickSearch: e.detail.value }); this.refresh(); },
  inputFoodQuery(e) {
    this.setData({ foodQuery: e.detail.value, foodCandidate: null, foodPreview: null, foodError: '' });
    this.foodRequestId = (this.foodRequestId || 0) + 1;
    clearTimeout(this.foodTimer);
    this.foodTimer = setTimeout(() => this.queryFoods(), 180);
  },
  queryFoods() {
    const requestId = this.foodRequestId = (this.foodRequestId || 0) + 1;
    this.setData({ foodBusy: true, foodError: '' });
    searchFoods(this.data.foodQuery, (error, foods) => {
      if (this.pageGone || requestId !== this.foodRequestId) return;
      this.setData({ foodBusy: false, foodResults: error ? [] : foods, foodError: error ? error.message : '' });
    });
  },
  selectFood(e) {
    const food = this.data.foodResults[Number(e.currentTarget.dataset.index)];
    if (!food) return;
    try { this.setData({ foodCandidate: food, foodAmount: '100', foodPreview: scaleProduct(food, 100), foodError: '' }); }
    catch (error) { this.setData({ foodError: error.message }); }
  },
  changeFood() { this.setData({ foodCandidate: null, foodPreview: null, foodError: '' }); this.queryFoods(); },
  inputFoodAmount(e) {
    const amount = e.detail.value;
    try { this.setData({ foodAmount: amount, foodPreview: scaleProduct(this.data.foodCandidate, amount), foodError: '' }); }
    catch (error) { this.setData({ foodAmount: amount, foodPreview: null, foodError: error.message }); }
  },
  useFoodCandidate() {
    const food = this.data.foodCandidate;
    if (!food) return;
    try {
      const portion = scaleProduct(food, this.data.foodAmount);
      this.editingOriginal = null;
      this.setData({ editingMealId: '', entryError: '', showMacros: true, reuseBase: null, barcodeSource: null,
        catalogSource: { fdcId: food.fdcId, sourceUrl: food.sourceUrl, portionAmount: portion.amount, portionUnit: 'g' },
        form: Object.assign({}, this.data.form, { name: food.name, calories: portion.calories, protein: portion.protein, carbs: portion.carbs, fat: portion.fat }) });
      wx.pageScrollTo({ selector: '#manual-fields', duration: 250 });
    } catch (error) { this.setData({ foodError: error.message }); }
  },
  saveFoodCandidate() {
    const food = this.data.foodCandidate;
    if (!food) return;
    try {
      const portion = scaleProduct(food, this.data.foodAmount);
      if ([portion.protein, portion.carbs, portion.fat].some(value => value === '')) throw new Error('营养资料不完整，请手动核对后填写');
      const type = this.data.form.type;
      const wasEditing = !!this.data.editingMealId;
      this.editingOriginal = null;
      const state = store.addMeal({ date: dateKey(), type, typeLabel: labels[types.indexOf(type)], name: food.name,
        calories: +portion.calories, protein: +portion.protein, carbs: +portion.carbs, fat: +portion.fat,
        source: 'catalog_user_confirmed', nutritionSource: 'USDA FoodData Central · SR Legacy 2018', fdcId: food.fdcId,
        sourceUrl: food.sourceUrl, portionAmount: portion.amount, portionUnit: 'g' });
      store.recordEvent('meal_logged');
      this.offerUndo(state);
      this.setData(Object.assign({ editingMealId: '', entryError: '', foodCandidate: null, foodPreview: null, catalogSource: null },
        wasEditing ? { form: { date: dateKey(), type, name: '', calories: '', protein: '', carbs: '', fat: '' } } : {}));
      this.refresh(); wx.showToast({ title: '已记入今天', icon: 'success' });
    } catch (error) { this.setData({ foodError: error.message }); }
  },
  toggleBarcode() { this.setData({ showBarcode: !this.data.showBarcode, barcodeError: '' }); },
  inputBarcode(e) { this.barcodeRequestId = (this.barcodeRequestId || 0) + 1; this.setData({ barcodeInput: e.detail.value, barcodeBusy: false, barcodeCandidate: null, barcodePreview: null, barcodeError: '' }); },
  scanBarcode() {
    if (typeof wx.scanCode !== 'function') { wx.showToast({ title: '当前环境可手动输入条码', icon: 'none' }); return; }
    wx.scanCode({ onlyFromCamera: true, scanType: ['barCode'], success: result => {
      if (this.pageGone) return;
      const code = String(result.result || '').trim();
      this.inputBarcode({ detail: { value: code } }); this.queryBarcode();
    }, fail: () => wx.showToast({ title: '可手动输入条码查询', icon: 'none' }) });
  },
  queryBarcode() {
    if (this.data.barcodeBusy) return;
    const requestId = this.barcodeRequestId = (this.barcodeRequestId || 0) + 1;
    this.setData({ barcodeBusy: true, barcodeError: '', barcodeCandidate: null, barcodePreview: null });
    lookupBarcode(this.data.barcodeInput, (error, result) => {
      if (this.pageGone || requestId !== this.barcodeRequestId) return;
      if (error) { this.setData({ barcodeBusy: false, barcodeError: error.message }); return; }
      if (!result || result.status === 'not_found') { this.setData({ barcodeBusy: false, barcodeError: '暂时没有这件商品，可看包装标签手动记入。' }); return; }
      if (result.status === 'needs_label') { this.setData({ barcodeBusy: false, barcodeError: '找到商品，但营养信息不完整。已填入名称，请按包装标签填写热量。', barcodeCandidate: null,
        'form.name': this.data.form.name || result.product && result.product.name || '' }); return; }
      if (result.status !== 'candidate_ready' || !result.product) { this.setData({ barcodeBusy: false, barcodeError: '商品资料格式异常，请手动填写。' }); return; }
      try {
        const preview = scaleProduct(result.product, this.data.barcodeAmount);
        this.setData({ barcodeBusy: false, barcodeCandidate: result.product, barcodePreview: preview });
      } catch (cause) { this.setData({ barcodeBusy: false, barcodeError: cause.message }); }
    });
  },
  inputBarcodeAmount(e) {
    const amount = e.detail.value;
    try { this.setData({ barcodeAmount: amount, barcodePreview: scaleProduct(this.data.barcodeCandidate, amount), barcodeError: '' }); }
    catch (error) { this.setData({ barcodeAmount: amount, barcodePreview: null, barcodeError: error.message }); }
  },
  useBarcodeCandidate() {
    const product = this.data.barcodeCandidate;
    if (!product) return;
    try {
      const portion = scaleProduct(product, this.data.barcodeAmount);
      this.editingOriginal = null;
      this.setData({ editingMealId: '', entryError: '', showBarcode: false, showMacros: true, reuseBase: null, catalogSource: null, barcodeSource: { barcode: product.barcode, sourceUrl: product.sourceUrl,
        portionAmount: portion.amount, portionUnit: product.basisUnit },
        form: Object.assign({}, this.data.form, { name: product.name, calories: portion.calories, protein: portion.protein,
          carbs: portion.carbs, fat: portion.fat }) });
    } catch (error) { this.setData({ barcodeError: error.message }); }
  },
  selectMealType(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (i >= 0 && i < types.length) this.setData({ typeIndex: i, selectedTypeLabel: labels[i], 'form.type': types[i] });
  },
  scrollToEntry() { wx.pageScrollTo({ selector: '#manual-entry', duration: 250 }); },
  quickReuse(e) {
    const source = this.data.quick[+e.currentTarget.dataset.index];
    if (!source) return;
    const now = Date.now();
    if (this.lastQuickTap && this.lastQuickTap.id === source.id && now - this.lastQuickTap.at < 1000) return;
    this.lastQuickTap = { id: source.id, at: now };
    const type = types.includes(source.type) ? source.type : this.data.form.type;
    const state = store.addMeal({ date: dateKey(), type, typeLabel: labels[types.indexOf(type)], name: source.name, calories: +source.calories,
      protein: +source.protein || 0, carbs: +source.carbs || 0, fat: +source.fat || 0, source: 'reused', sourceMealId: source.id });
    store.recordEvent('meal_reused');
    this.offerUndo(state);
    this.setData({ entryError: '' });
    this.refresh(); wx.showToast({ title: '已记入今天', icon: 'success' });
  },
  editReuse(e) {
    const source = this.data.quick[+e.currentTarget.dataset.index];
    if (!source) return;
    const typeIndex = Math.max(0, types.indexOf(source.type));
    this.editingOriginal = null;
    this.setData({ editingMealId: '', entryError: '', typeIndex, selectedTypeLabel: labels[typeIndex], showMacros: true, reuseBase: source, portionScale: 1, barcodeSource: null, catalogSource: null,
      form: { date: dateKey(), type: types[typeIndex], name: source.name, calories: String(source.calories), protein: String(source.protein || 0), carbs: String(source.carbs || 0), fat: String(source.fat || 0) } });
    wx.pageScrollTo({ selector: '#manual-entry', duration: 250 });
  },
  editMeal(e) {
    const source = this.data.recent[Number(e.currentTarget.dataset.index)];
    if (!source) return;
    const typeIndex = Math.max(0, types.indexOf(source.type));
    this.editingOriginal = Object.assign({}, source);
    this.setData({ editingMealId: source.id, entryError: '', typeIndex, selectedTypeLabel: labels[typeIndex], showMacros: true,
      reuseBase: null, portionScale: 1, barcodeSource: null, catalogSource: null, foodCandidate: null, foodPreview: null, showBarcode: false,
      form: { date: source.date, type: types[typeIndex], name: source.name, calories: String(source.calories),
        protein: String(source.protein || 0), carbs: String(source.carbs || 0), fat: String(source.fat || 0) } },
      () => wx.pageScrollTo({ selector: '#meal-form', duration: 250 }));
  },
  cancelEdit() {
    this.editingOriginal = null;
    this.setData({ editingMealId: '', entryError: '', barcodeSource: null, catalogSource: null, reuseBase: null,
      form: { date: dateKey(), type: this.data.form.type, name: '', calories: '', protein: '', carbs: '', fat: '' } });
  },
  choosePortionScale(e) {
    if (!this.data.reuseBase) return;
    const factor = Number(e.currentTarget.dataset.factor);
    try { this.setData({ portionScale: factor, form: Object.assign({}, this.data.form, scaleMeal(this.data.reuseBase, factor)) }); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    const update = { ['form.' + field]: e.detail.value, entryError: '' };
    if (['name', 'calories', 'protein', 'carbs', 'fat'].includes(field)) { update.barcodeSource = null; update.catalogSource = null; }
    this.setData(update);
  },
  chooseDate(e) { this.setData({ 'form.date': e.detail.value, entryError: '' }); },
  chooseType(e) { const i = +e.detail.value; this.setData({ typeIndex: i, selectedTypeLabel: labels[i], 'form.type': types[i] }); },
  toggleMacros() { this.setData({ showMacros: !this.data.showMacros }); },
  save() {
    const f = this.data.form;
    const name = (f.name || '').trim();
    const calories = f.calories === '' ? macroCalories(f) : +f.calories;
    const protein = f.protein === '' ? 0 : +f.protein;
    const carbs = f.carbs === '' ? 0 : +f.carbs;
    const fat = f.fat === '' ? 0 : +f.fat;
    const entryError = !name ? '先填写食物名称' : name.length > 60 ? '食物名称请控制在 60 字以内' :
      !validKey(f.date) || f.date > dateKey() ? '请选择今天或之前的日期' :
      !types.includes(f.type) ? '请重新选择餐别' :
      ![protein, carbs, fat].every(Number.isFinite) || [protein, carbs, fat].some(v => v < 0 || v > 500) ? '营养素请填写 0–500g 的数值' :
      !Number.isFinite(calories) || calories <= 0 ? '填写热量，或展开营养素填写有效数值' :
      calories > 5000 ? '热量请填写 1–5000 kcal' : '';
    if (entryError) { this.setData({ entryError }); return; }
    this.setData({ entryError: '' });
    const core = { date: f.date, type: f.type, typeLabel: labels[types.indexOf(f.type)], name, calories, protein, carbs, fat };
    if (this.data.editingMealId) {
      const original = this.editingOriginal;
      if (!original || original.id !== this.data.editingMealId) { wx.showToast({ title: '编辑状态已变化，请重新选择', icon: 'none' }); return; }
      const changedNutrition = name !== original.name || ['calories', 'protein', 'carbs', 'fat'].some(key => +core[key] !== +(original[key] || 0));
      const next = Object.assign({}, original, core);
      if (changedNutrition) {
        for (const key of ['nutritionSource', 'sourceUrl', 'barcode', 'fdcId', 'portionAmount', 'portionUnit', 'sourceMealId']) delete next[key];
        next.source = 'manual_edit';
      }
      try { store.updateMeal(original.id, next); }
      catch (error) { wx.showToast({ title: error.message, icon: 'none' }); return; }
      this.editingOriginal = null;
      this.setData({ editingMealId: '', form: { date: dateKey(), type: f.type, name: '', calories: '', protein: '', carbs: '', fat: '' },
        reuseBase: null, portionScale: 1, barcodeSource: null, catalogSource: null, foodCandidate: null, foodPreview: null });
      this.refresh(); wx.showToast({ title: '修改已保存', icon: 'success' });
      return;
    }
    const state = store.addMeal(Object.assign(core,
      this.data.barcodeSource ? { source: 'barcode_user_confirmed', nutritionSource: 'Open Food Facts', ...this.data.barcodeSource } :
        this.data.catalogSource ? { source: 'catalog_user_confirmed', nutritionSource: 'USDA FoodData Central · SR Legacy 2018', ...this.data.catalogSource } : {}));
    store.recordEvent('meal_logged');
    this.offerUndo(state);
    this.setData({ form: { date: dateKey(), type: f.type, name: '', calories: '', protein: '', carbs: '', fat: '' }, reuseBase: null, portionScale: 1, barcodeSource: null, catalogSource: null, foodCandidate: null, foodPreview: null });
    this.refresh(); wx.showToast({ title: '已记录', icon: 'success' });
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除这条记录？', content: '删除后，下一餐推荐也会同步更新。', success: r => { if (r.confirm) { store.deleteMeal(id); if (id === this.data.editingMealId) this.cancelEdit(); this.refresh(); } } });
  }
});
