// Local WeChat DevTools E2E. Run only against an isolated project copy whose
// storage keys start with e2e_next_meal_ and whose backend points at 8788.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { shiftKey } = require('../core/date');
const { startServer } = require('../../next-meal-platform/server');

const endpoint = process.env.E2E_WS || 'ws://127.0.0.1:9422';
const artifacts = process.env.E2E_ARTIFACTS || path.join(__dirname, 'e2e-artifacts');
const backend = process.env.E2E_BACKEND || 'http://127.0.0.1:8788';
fs.mkdirSync(artifacts, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (step, details) => console.log(JSON.stringify({ step, ...details }));

async function tap(page, selector) {
  const element = await page.$(selector);
  assert.ok(element, `Missing element: ${selector}`);
  await element.tap();
}

async function input(page, selector, value) {
  const element = await page.$(selector);
  assert.ok(element, `Missing input: ${selector}`);
  await element.input(value);
}

async function screenshot(mini, name) {
  await mini.screenshot({ path: path.join(artifacts, name + '.png') });
}

async function waitPath(mini, expected) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const page = await mini.currentPage();
    if (page && page.path === expected) return page;
    await delay(250);
  }
  const current = await mini.currentPage();
  assert.equal(current && current.path, expected);
}

async function waitData(page, predicate, label) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const data = await page.data();
    if (predicate(data)) return data;
    await delay(250);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function api(route, method = 'GET', body, token) {
  const response = await fetch(backend + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

(async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-meal-e2e-'));
  const databaseFile = path.join(fixtureDir, 'backend.sqlite');
  let backendServer;
  async function launchBackend() {
    backendServer = startServer({ database: databaseFile, bootstrapToken: 'e'.repeat(48) }).server;
    await new Promise(resolve => backendServer.listen(8788, '127.0.0.1', resolve));
  }
  async function stopBackend() {
    if (backendServer && backendServer.listening) await new Promise(resolve => backendServer.close(resolve));
  }
  let mini;
  try {
    await launchBackend();
    mini = await automator.connect({ wsEndpoint: endpoint });
    const liveBefore = JSON.stringify(await mini.callWxMethod('getStorageSync', 'next_meal_app_v2'));
    // DevTools native.confirmModal returns without acting in this Electron build.
    // Keep button taps real, but make the system confirmation deterministic.
    await mini.mockWxMethod('showModal', { confirm: true, cancel: false });
    for (const key of ['e2e_next_meal_app_v2', 'e2e_next_meal_personal_v1', 'e2e_next_meal_device_session_v1', 'e2e_next_meal_sync_meta_v1']) {
      await mini.callWxMethod('removeStorageSync', key);
    }
    let page = await mini.reLaunch('/pages/today/index');
    await delay(300);
    assert.equal((await page.data()).hasPlan, false, 'isolated storage is not fresh');
    assert.ok(await page.$('.record-action'));
    await screenshot(mini, '01-cold-start');
    log('cold-start', { path: page.path, hasPlan: false });

    await tap(page, '.start-card button');
    page = await waitPath(mini, 'pages/plan/index');
    await tap(page, '.calculate-button');
    let data = await waitData(page, state => !!state.profileError, 'inline profile error');
    assert.equal(data.estimateReady, false);
    assert.ok(await page.$('.profile-error'));
    await mini.callWxMethod('pageScrollTo', { selector: '.profile-error', duration: 0 });
    await delay(180);
    await screenshot(mini, '02-profile-error');
    log('invalid-profile-feedback', { message: data.profileError });
    await input(page, '.profile-input input[data-field="age"]', '30');
    await waitData(page, state => state.profileError === '', 'profile error cleared on input');
    await input(page, '.profile-input input[data-field="heightCm"]', '170');
    await input(page, '.profile-input input[data-field="weightKg"]', '80');
    await tap(page, '.health-row');
    await tap(page, '.calculate-button');
    await delay(200);
    data = await page.data();
    assert.equal(data.estimateReady, true);
    assert.ok(Number(data.form.calories) > 1000);
    log('auto-estimate', { calories: data.form.calories, protein: data.form.protein, carbs: data.form.carbs, fat: data.form.fat });

    for (const mode of ['steady', 'taper', 'cycle']) {
      const cards = await page.$$('.mode-card');
      const index = (await page.data()).modes.findIndex(item => item.mode === mode);
      assert.ok(index >= 0, `mode ${mode} absent`);
      await cards[index].tap();
      await waitData(page, state => state.mode === mode, `selected mode ${mode}`);
      await tap(page, '.plan-action');
      data = await waitData(page, state => state.draftPreview && state.draftPreview.days.length === 7, `preview ${mode}`);
      assert.equal(data.draftPreview.days.length, 7);
      if (mode === 'taper') assert.equal(data.draftPreview.stages.length, 3);
      await screenshot(mini, `02-preview-${mode}`);
      log('plan-preview', { mode, calories: data.draftPreview.calories, days: data.draftPreview.days.length, stages: data.draftPreview.stages.length });
      await tap(page, '.activate');
      data = await waitData(page, state => state.activePlan && state.activePlan.mode === mode, `active plan ${mode}`);
      assert.equal(data.activePlan.mode, mode);
      log('plan-activated', { mode, title: data.activeModeName });
    }

    page = await mini.switchTab('/pages/today/index');
    await delay(200);
    assert.equal((await page.data()).hasPlan, true);
    await tap(page, '.record-action');
    page = await waitPath(mini, 'pages/record/index');
    await tap(page, '.save-button');
    data = await waitData(page, state => !!state.entryError, 'inline meal error');
    assert.match(data.entryError, /食物名称/);
    assert.equal(data.recent.length, 0);
    await mini.callWxMethod('pageScrollTo', { selector: '.entry-error', duration: 0 });
    await delay(180);
    await screenshot(mini, '03-meal-error');
    log('invalid-meal-feedback', { message: data.entryError, meals: data.recent.length });
    await input(page, '.food-search input', '米饭');
    await delay(600);
    data = await page.data();
    assert.ok(data.foodResults.length > 0, 'food search returned no candidates');
    await tap(page, '.food-hit');
    await waitData(page, state => !!state.foodCandidate, 'food selected');
    await input(page, '.food-portion input', '150');
    data = await waitData(page, state => state.foodAmount === '150', '150g portion');
    assert.equal(data.foodAmount, '150');
    assert.ok(Number(data.foodPreview.calories) > 0);
    await screenshot(mini, '03-food-portion');
    await tap(page, '.food-selected .barcode-use');
    data = await waitData(page, state => state.recent.length === 1, 'meal saved');
    assert.equal(data.recent.length, 1);
    assert.equal(data.entryError, '');
    assert.equal(data.recent[0].portionAmount, 150);
    log('food-saved', { name: data.recent[0].name, calories: data.recent[0].calories, portionAmount: data.recent[0].portionAmount });

    page = await mini.switchTab('/pages/today/index');
    data = await page.data();
    assert.equal(data.meals.length, 1);
    assert.ok(data.eaten.calories > 0);
    await screenshot(mini, '04-today-after-meal');
    log('today-summary', { meals: data.meals.length, eaten: data.eaten.calories });

    page = await mini.switchTab('/pages/record/index');
    const before = (await page.data()).recent[0].calories;
    await tap(page, '.recent-tools text');
    await input(page, '.field-input[data-field="calories"]', String(before + 10));
    const mealTypes = await page.$$('.meal-choice');
    assert.equal(mealTypes.length, 4);
    await mealTypes[0].tap();
    await waitData(page, state => state.form.type === 'breakfast', 'meal type changed');
    await tap(page, '.save-button');
    data = await waitData(page, state => state.recent.length === 1 && state.recent[0].calories === before + 10 && state.recent[0].type === 'breakfast', 'meal edited');
    assert.equal(data.recent.length, 1);
    assert.equal(data.recent[0].calories, before + 10);
    log('meal-edited', { before, after: data.recent[0].calories, type: data.recent[0].type });

    page = await mini.switchTab('/pages/today/index');
    data = await page.data();
    assert.equal(data.mealSlots.find(slot => slot.type === 'breakfast').meals.length, 1);
    assert.equal(data.mealSlots.find(slot => slot.type === 'lunch').meals.length, 0);
    page = await mini.switchTab('/pages/trend/index');
    data = await page.data();
    assert.equal(data.week.days.find(day => day.date === data.today).recorded, true);
    log('today-and-trend-linked', { breakfast: 1, trendTodayRecorded: true });
    page = await mini.switchTab('/pages/record/index');

    // A previous-day fixture makes the quick-reuse control visible; the actual
    // reuse and undo actions below are still performed through page elements.
    const isolated = await mini.callWxMethod('getStorageSync', 'e2e_next_meal_app_v2');
    isolated.meals.push({ ...isolated.meals[0], id: 'e2e-yesterday-meal', date: shiftKey(isolated.meals[0].date, -1) });
    await mini.callWxMethod('setStorageSync', 'e2e_next_meal_app_v2', isolated);
    page = await mini.reLaunch('/pages/record/index');
    await waitData(page, state => state.quick.length === 1, 'historical quick meal');
    await tap(page, '.quick-jump');
    await delay(300);
    await screenshot(mini, '03-returning-user-manual-entry');
    log('manual-entry-shortcut', { path: page.path, quickMeals: (await page.data()).quick.length });
    const quickControl = await page.$('.quick-primary');
    assert.ok(quickControl);
    await Promise.all([quickControl.tap(), quickControl.tap()]);
    data = await waitData(page, state => state.recent.length === 3, 'quick reuse');
    await delay(500);
    data = await page.data();
    assert.equal(data.recent.length, 3);
    const undoControls = await page.$$('.undo-strip text');
    assert.equal(undoControls.length, 2);
    await undoControls[1].tap();
    data = await waitData(page, state => state.recent.length === 2, 'undo');
    assert.equal(data.recent.length, 2);
    log('reuse-double-tap-and-undo', { remaining: data.recent.length });

    page = await mini.switchTab('/pages/settings/index');
    assert.ok((await page.data()).hasProfile);
    await tap(page, '.growth-card');
    page = await waitPath(mini, 'pages/growth/index');
    await screenshot(mini, '05-growth');
    log('growth-opened', { path: page.path });

    const badgeFixture = await mini.callWxMethod('getStorageSync', 'e2e_next_meal_app_v2');
    const baseMeal = badgeFixture.meals.find(meal => meal.date === badgeFixture.meals[0].date);
    for (let offset = 2; offset <= 9; offset++) {
      badgeFixture.meals.push({ ...baseMeal, id: `e2e-badge-${offset}`, date: shiftKey(baseMeal.date, -offset) });
    }
    badgeFixture.dayReviews = Array.from({ length: 10 }, (_, offset) => ({ date: shiftKey(baseMeal.date, -offset), at: new Date().toISOString() }));
    await mini.callWxMethod('setStorageSync', 'e2e_next_meal_app_v2', badgeFixture);
    page = await mini.reLaunch('/pages/growth/index');
    data = await waitData(page, state => state.growth.effectiveDays === 10, 'ten recorded days');
    assert.equal(data.growth.completeDays, 10);
    assert.equal(data.unlockedCount, 2);
    assert.equal(data.milestones.firstFive.unlocked, true);
    assert.equal(data.milestones.tenComplete.unlocked, true);
    await screenshot(mini, '06-two-medals');
    log('medals-unlocked', { effectiveDays: data.growth.effectiveDays, completeDays: data.growth.completeDays, unlockedCount: data.unlockedCount });

    badgeFixture.meals = badgeFixture.meals.filter(meal => meal.id !== 'e2e-badge-9');
    badgeFixture.dayReviews = badgeFixture.dayReviews.filter(review => badgeFixture.meals.some(meal => meal.date === review.date));
    await mini.callWxMethod('setStorageSync', 'e2e_next_meal_app_v2', badgeFixture);
    page = await mini.reLaunch('/pages/growth/index');
    data = await waitData(page, state => state.growth.effectiveDays === 9, 'badge recalculation');
    assert.equal(data.growth.completeDays, 9);
    assert.equal(data.unlockedCount, 1);
    assert.equal(data.milestones.tenComplete.unlocked, false);
    log('medal-recalculated-after-delete', { effectiveDays: data.growth.effectiveDays, completeDays: data.growth.completeDays, unlockedCount: data.unlockedCount });

    const adminName = 'e2e-admin';
    const adminPassword = 'isolated-e2e-password-2026';
    if ((await api('/api/admin/status')).data.setupRequired) {
      const setup = await api('/api/admin/setup', 'POST', { setupToken: process.env.E2E_BOOTSTRAP || 'e'.repeat(48), username: adminName, password: adminPassword });
      assert.equal(setup.status, 201);
    }
    const login = await api('/api/admin/login', 'POST', { username: adminName, password: adminPassword });
    assert.equal(login.status, 200);
    const token = login.data.token;
    const methodId = 'e2e-method-' + Date.now().toString(36);
    const method = { id: methodId, version: 1, title: '本地测试新节奏', subtitle: '后台发布后刷新显示', suitable: '本地测试账号', sourceTitle: '下一餐测试方法', sourceUrl: '', mode: 'steady', config: {} };
    assert.equal((await api('/api/admin/methods/drafts', 'POST', method, token)).data.method.status, 'draft');
    assert.equal((await api('/api/methods')).data.methods.some(item => item.id === methodId), false);
    assert.equal((await api(`/api/admin/methods/${methodId}/publish`, 'POST', {}, token)).data.method.status, 'published');
    page = await mini.reLaunch('/pages/plan/index');
    data = await waitData(page, state => state.modes.some(item => item.id === methodId), 'published method in miniapp');
    assert.equal(data.activePlan.methodRef.id, 'cycle');
    await screenshot(mini, '07-published-method');
    log('method-published-in-miniapp', { methodId, catalogSize: data.modes.length, activePlan: data.activePlan.methodRef.id });
    assert.equal((await api(`/api/admin/methods/${methodId}/retire`, 'POST', {}, token)).data.method.status, 'retired');
    page = await mini.reLaunch('/pages/plan/index');
    data = await waitData(page, state => !state.modes.some(item => item.id === methodId), 'retired method removed');
    assert.equal(data.activePlan.methodRef.id, 'cycle');
    log('method-retired-in-miniapp', { methodId, catalogSize: data.modes.length, activePlan: data.activePlan.methodRef.id });

    const pairing = await api('/api/admin/pairings', 'POST', {}, token);
    assert.equal(pairing.status, 200);
    page = await mini.switchTab('/pages/settings/index');
    await tap(page, '.tool-row');
    await waitData(page, state => state.showDataTools, 'data tools opened');
    await input(page, '.pair-input', pairing.data.code);
    await tap(page, '.sync-panel .button-secondary');
    data = await waitData(page, state => state.syncStatus.paired && state.syncStatus.pending === 0, 'device paired and synced');
    const deviceSession = await mini.callWxMethod('getStorageSync', 'e2e_next_meal_device_session_v1');
    assert.equal(data.syncStatus.userId, pairing.data.userId);
    assert.ok(deviceSession.token);
    const beforeOffline = await api('/api/user/snapshot', 'GET', undefined, deviceSession.token);
    assert.equal(beforeOffline.status, 200);
    assert.equal(beforeOffline.data.snapshot.meals.length, 9);
    log('device-paired', { userId: data.syncStatus.userId, remoteMeals: beforeOffline.data.snapshot.meals.length });

    await stopBackend();
    page = await mini.reLaunch('/pages/record/index');
    await input(page, 'input[data-field="name"]', '离线测试苹果');
    await input(page, 'input[data-field="calories"]', '95');
    await tap(page, '.save-button');
    data = await waitData(page, state => state.recent.some(item => item.name === '离线测试苹果'), 'offline meal saved locally');
    const offlineState = await mini.callWxMethod('getStorageSync', 'e2e_next_meal_app_v2');
    assert.ok(offlineState.pendingMutations.length > 0);
    log('offline-meal-saved', { localMeals: offlineState.meals.length, pending: offlineState.pendingMutations.length });

    await launchBackend();
    page = await mini.switchTab('/pages/settings/index');
    await tap(page, '.tool-row');
    await waitData(page, state => state.showDataTools, 'sync tools opened');
    await tap(page, '.sync-panel .button-secondary');
    data = await waitData(page, state => state.syncStatus.paired && state.syncStatus.pending === 0, 'offline meal synced');
    const afterOffline = await api('/api/user/snapshot', 'GET', undefined, deviceSession.token);
    assert.equal(afterOffline.status, 200);
    assert.equal(afterOffline.data.snapshot.meals.filter(item => item.name === '离线测试苹果').length, 1);
    page = await mini.reLaunch('/pages/today/index');
    data = await waitData(page, state => state.meals.some(item => item.name === '离线测试苹果'), 'offline meal after reopen');
    assert.equal(data.meals.filter(item => item.name === '离线测试苹果').length, 1);
    log('offline-reconnect-reopen', { remoteMeals: afterOffline.data.snapshot.meals.length, todayMeals: data.meals.length });

    assert.equal((await api('/api/user/logout', 'POST', {}, deviceSession.token)).status, 200);
    page = await mini.switchTab('/pages/settings/index');
    await tap(page, '.tool-row');
    await waitData(page, state => state.showDataTools, 'expired-session tools');
    await tap(page, '.sync-panel .button-secondary');
    data = await waitData(page, state => state.syncStatus.needsPairing, 'expired-session notice');
    assert.match(data.syncStatus.lastError, /配对|失效/);
    await screenshot(mini, '08-session-expired');
    log('session-expired', { needsPairing: data.syncStatus.needsPairing, pending: data.syncStatus.pending });
    await tap(page, '.sync-panel .button-secondary');
    data = await waitData(page, state => !state.syncStatus.paired && state.syncStatus.lastUserId === pairing.data.userId, 'prepared to re-pair');
    const recoveryPairing = await api('/api/admin/pairings', 'POST', { userId: pairing.data.userId }, token);
    assert.equal(recoveryPairing.status, 200);
    await input(page, '.pair-input', recoveryPairing.data.code);
    await tap(page, '.sync-panel .button-secondary');
    data = await waitData(page, state => state.syncStatus.paired && state.syncStatus.pending === 0, 're-paired');
    const recoveredSession = await mini.callWxMethod('getStorageSync', 'e2e_next_meal_device_session_v1');
    const recovered = await api('/api/user/snapshot', 'GET', undefined, recoveredSession.token);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.snapshot.meals.length, 10);
    log('session-recovered', { userId: data.syncStatus.userId, remoteMeals: recovered.data.snapshot.meals.length });

    // The custom tab bar floats above the page; inspect the final scroll position
    // of every main route so footer actions are not hidden under the dock.
    for (const [route, name] of [
      ['/pages/today/index', '10-today-bottom'],
      ['/pages/plan/index', '11-plan-bottom'],
      ['/pages/record/index', '12-record-bottom'],
      ['/pages/trend/index', '13-trend-bottom'],
      ['/pages/settings/index', '14-mine-bottom']
    ]) {
      page = await mini.switchTab(route);
      await delay(180);
      await mini.pageScrollTo(99999);
      await delay(180);
      await screenshot(mini, name);
      log('bottom-captured', { route, scrollTop: await page.scrollTop() });
    }

    const liveAfter = JSON.stringify(await mini.callWxMethod('getStorageSync', 'next_meal_app_v2'));
    assert.equal(liveAfter, liveBefore, 'live miniapp storage was changed');
    log('live-storage-preserved', { equal: true });
    console.log('E2E PASS');
  } finally {
    if (mini) {
      await mini.restoreWxMethod('showModal').catch(() => {});
      mini.disconnect();
    }
    await stopBackend();
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(fixtureDir).startsWith(tempRoot)) throw new Error('E2E cleanup path escaped temp folder');
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
