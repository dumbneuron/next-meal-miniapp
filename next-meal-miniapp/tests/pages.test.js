const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('every declared route has assets and WXML events have matching handlers', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const routes = [...app.pages, 'custom-tab-bar/index'];
  for (const route of routes) {
    const base = path.join(root, route);
    for (const ext of ['js', 'json', 'wxml', 'wxss']) assert.equal(fs.existsSync(base + '.' + ext), true, `${route}.${ext}`);
    let definition;
    global.Page = value => { definition = value; };
    global.Component = value => { definition = value.methods; };
    require(base + '.js');
    const wxml = fs.readFileSync(base + '.wxml', 'utf8');
    const events = [...wxml.matchAll(/(?:bind|catch)(?:tap|input|change)="([A-Za-z][A-Za-z0-9_]*)"/g)].map(match => match[1]);
    for (const event of events) assert.equal(typeof definition[event], 'function', `${route} missing ${event}`);
  }
});

test('returning users see reuse before form and My keeps growth and profile entry points', () => {
  const record = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8');
  const today = fs.readFileSync(path.join(root, 'pages/today/index.wxml'), 'utf8');
  const mine = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.ok(record.indexOf('class="quick-card"') < record.indexOf('id="manual-entry"'));
  assert.ok(record.includes('wx:if="{{quick.length || quickSearch}}"'));
  assert.ok(today.indexOf('class="record-action"') < today.indexOf('class="start-card"'));
  assert.ok(mine.includes('bindtap="toGrowth"'));
  assert.ok(mine.indexOf('class="manage-card"') < mine.indexOf('class="growth-card"'));
  assert.ok(mine.includes('bindtap="toProfile"'));
  assert.ok(fs.readFileSync(path.join(root, 'pages/growth/index.wxml'), 'utf8').includes('growth.badges'));
  assert.ok(app.tabBar.list.some(item => item.pagePath === 'pages/settings/index'));
});

test('badge progress uses bounded WXSS classes instead of arithmetic in inline style', () => {
  const mine = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'pages/growth/index.wxml'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'pages/growth/index.wxss'), 'utf8');
  assert.ok(mine.includes('class="badge-fill-{{featuredBadge.progressPercent}}"'));
  assert.ok(detail.includes('class="badge-fill-{{item.progressPercent}}"'));
  assert.equal(/style="[^"]*item\.count/.test(detail), false);
  for (let width = 0; width <= 100; width += 10) {
    assert.ok(style.includes(`.badge-fill-${width}{width:${width}${width ? '%' : ''}}`), `missing badge width ${width}`);
  }
});
