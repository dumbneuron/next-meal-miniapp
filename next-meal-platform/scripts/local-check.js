// 本地只读自检：回归测试使用隔离数据库；线上运行中的 SQLite 只读检查。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const platform = path.resolve(__dirname, '..');
const miniapp = path.resolve(platform, '..', 'next-meal-miniapp');
const base = (process.env.NEXT_MEAL_LOCAL_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const failures = [];

function check(label, condition, detail = '') {
  process.stdout.write(`${condition ? '通过' : '失败'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!condition) failures.push(label);
}

function runTests(label, cwd) {
  const files = fs.readdirSync(path.join(cwd, 'tests')).filter(name => name.endsWith('.test.js')).map(name => path.join('tests', name));
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const passed = /(?:#|ℹ) pass (\d+)/.exec(output)?.[1] || '?';
  const failed = /(?:#|ℹ) fail (\d+)/.exec(output)?.[1] || '?';
  check(label, result.status === 0, `${passed} 通过、${failed} 失败`);
  if (result.status !== 0) process.stdout.write(`${output.slice(-5000)}\n`);
}

async function get(route) {
  const response = await fetch(base + route, { signal: AbortSignal.timeout(5000) });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, body: type.includes('json') ? await response.json() : await response.text() };
}

async function main() {
  process.stdout.write(`本地自检：${base}\n此命令不会修改运行中用户数据，也不创建测试账号。\n\n`);
  runTests('后台自动化', platform);
  runTests('小程序核心自动化', miniapp);
  process.stdout.write('\n本地服务只读检查\n');
  try {
    const health = await get('/health');
    check('服务存活', health.status === 200 && health.body.ok === true);
    const admin = await get('/api/admin/status');
    check('管理员已初始化', admin.status === 200 && admin.body.setupRequired === false);
    const privateApi = await get('/api/admin/methods');
    check('未登录管理接口拦截', privateApi.status === 401);
    const methods = await get('/api/methods');
    check('公开方法目录', methods.status === 200 && Array.isArray(methods.body.methods) && methods.body.methods.length > 0,
      methods.status === 200 ? `${methods.body.methods?.length || 0} 个已发布方法` : `HTTP ${methods.status}`);
    const foods = await get('/api/foods/search?q=' + encodeURIComponent('米饭'));
    check('普通食物检索', foods.status === 200 && Array.isArray(foods.body.foods) && foods.body.foods.length > 0);
    const page = await get('/admin');
    check('管理页面可访问', page.status === 200 && typeof page.body === 'string' && page.body.includes('id="authScreen"'));
  } catch (error) {
    check('本地服务连接', false, error.message);
  }
  const database = path.join(platform, 'data', 'next-meal.sqlite');
  if (fs.existsSync(database)) {
    try {
      const db = new DatabaseSync(database, { readOnly: true });
      try { check('SQLite 只读快速检查', db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok'); }
      finally { db.close(); }
    } catch (error) { check('SQLite 只读快速检查', false, error.message); }
  } else check('本地 SQLite 文件存在', false, database);

  process.stdout.write(`\n${failures.length ? `自检有 ${failures.length} 项失败：${failures.join('、')}` : '代码与本地服务自检通过'}。\n`);
  process.stdout.write('注意：本命令只检查代码与本地服务；模拟器交互请单独运行 next-meal-miniapp 的 test:e2e:local，并查看截图。\n');
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
