const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { openDatabase, listPublished, listAll, saveDraft, publishDraft, retireMethod } = require('./db');
const { createPairing, redeemPairing, authenticate, listDevices, revokeDevice, logoutDevice, getSnapshot, applyMutations, deleteUserData } = require('./userData');
const { createFoodLookup } = require('./foodLookup');
const { searchFoods } = require('./foodCatalog');
const adminAuth = require('./adminAuth');

function startServer(options = {}) {
  const db = openDatabase(options.database || path.join(__dirname, 'data', 'next-meal.sqlite'));
  let setupToken = adminAuth.accountExists(db) ? null : options.bootstrapToken || crypto.randomBytes(24).toString('hex');
  const attemptSetup = adminAuth.makeLimiter(10);
  const attemptLogin = adminAuth.makeLimiter(20);
  const attemptPasswordChange = adminAuth.makeLimiter(10);
  const attemptPairing = adminAuth.makeLimiter(30, 10 * 60 * 1000);
  const adminHtml = fs.readFileSync(path.join(__dirname, 'admin.html'));
  const lookupFood = createFoodLookup(options.foodFetch || fetch);
  async function readBody(req) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 262144) throw new Error('请求内容过大'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { throw new Error('JSON 格式错误'); }
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (code, value) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(JSON.stringify(value));
    };
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/admin') {
      const nonce = crypto.randomBytes(16).toString('base64');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
      return res.end(adminHtml.toString().replaceAll('__CSP_NONCE__', nonce));
    }
    if (req.method === 'GET' && url.pathname === '/api/methods') return json(200, { methods: listPublished(db).map(({ status, createdAt, publishedAt, retiredAt, ...method }) => method) });
    if (req.method === 'GET' && url.pathname === '/api/foods/search') {
      try { return json(200, { foods: searchFoods(url.searchParams.get('q') || '') }); }
      catch (error) { return json(400, { error: error.message }); }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/foods/barcode/')) {
      try { return json(200, await lookupFood(url.pathname.slice('/api/foods/barcode/'.length))); }
      catch (error) { return json(/条码/.test(error.message) ? 400 : 502, { error: /条码/.test(error.message) ? error.message : '食品资料查询失败，请稍后重试' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/pair/redeem') {
      if (!attemptPairing(req.socket.remoteAddress || 'local')) return json(429, { error: '配对尝试过多，请稍后再试' });
      try { return json(200, redeemPairing(db, (await readBody(req)).code)); }
      catch (error) { return json(400, { error: error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/status') return json(200, { setupRequired: !adminAuth.accountExists(db) });
    if (req.method === 'POST' && url.pathname === '/api/admin/setup') {
      if (!attemptSetup(req.socket.remoteAddress || 'local')) return json(429, { error: '操作过于频繁，请稍后再试' });
      if (!setupToken || adminAuth.accountExists(db)) return json(403, { error: '管理员已初始化' });
      try {
        const body = await readBody(req);
        if (!body || !adminAuth.equalHex(body.setupToken, setupToken)) return json(403, { error: '初始化凭据错误' });
        const account = await adminAuth.createAccount(db, body.username, body.password);
        setupToken = null;
        return json(201, account);
      } catch (error) { return json(400, { error: error.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      if (!attemptLogin(req.socket.remoteAddress || 'local')) return json(429, { error: '登录过于频繁，请稍后再试' });
      try {
        const body = await readBody(req);
        const session = await adminAuth.login(db, body && body.username, body && body.password);
        return session ? json(200, session) : json(401, { error: '账号或密码错误，或暂时锁定' });
      } catch (_) { return json(401, { error: '账号或密码错误，或暂时锁定' }); }
    }
    if (url.pathname.startsWith('/api/user/')) {
      const userToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const userId = authenticate(db, userToken);
      if (!userId) return json(401, { error: '设备尚未配对或会话已失效', code: 'SESSION_EXPIRED' });
      try {
        if (req.method === 'GET' && url.pathname === '/api/user/snapshot') return json(200, { snapshot: getSnapshot(db, userId) });
        if (req.method === 'GET' && url.pathname === '/api/user/export') return json(200, { export: getSnapshot(db, userId) });
        if (req.method === 'GET' && url.pathname === '/api/user/devices') return json(200, { devices: listDevices(db, userId, userToken) });
        if (req.method === 'POST' && url.pathname === '/api/user/devices/revoke') return json(200, revokeDevice(db, userId, (await readBody(req)).deviceId));
        if (req.method === 'POST' && url.pathname === '/api/user/logout') return json(200, logoutDevice(db, userId, userToken));
        if (req.method === 'POST' && url.pathname === '/api/user/sync') return json(200, applyMutations(db, userId, (await readBody(req)).mutations));
        if (req.method === 'POST' && url.pathname === '/api/user/delete') {
          if ((await readBody(req)).confirm !== 'DELETE') throw new Error('请确认删除操作');
          return json(200, deleteUserData(db, userId));
        }
        return json(404, { error: '路径不存在' });
      } catch (error) { return json(error.code === 'PLAN_CONFLICT' ? 409 : 400, { error: error.message, code: error.code || 'USER_DATA_ERROR' }); }
    }
    if (!url.pathname.startsWith('/api/admin/')) return json(404, { error: '路径不存在' });
    const adminToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const adminUser = adminAuth.authenticate(db, adminToken);
    if (!adminUser) return json(401, { error: '请先登录管理员账号' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/admin/me') return json(200, { username: adminUser });
      if (req.method === 'POST' && url.pathname === '/api/admin/logout') { adminAuth.logout(db, adminToken); return json(200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/admin/password') {
        if (!attemptPasswordChange(adminUser)) return json(429, { error: '操作过于频繁，请稍后再试' });
        const body = await readBody(req);
        await adminAuth.changePassword(db, adminUser, body && body.currentPassword, body && body.newPassword);
        return json(200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/methods') return json(200, { methods: listAll(db) });
      if (req.method === 'POST' && url.pathname === '/api/admin/pairings') {
        const body = await readBody(req);
        return json(200, createPairing(db, body.userId ? String(body.userId) : null));
      }
      const match = /^\/api\/admin\/methods\/([a-z][a-z0-9-]{1,39})\/(publish|retire)$/.exec(url.pathname);
      if (req.method === 'POST' && match) {
        const method = match[2] === 'publish' ? publishDraft(db, match[1]) : retireMethod(db, match[1]);
        return json(200, { method });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/methods/drafts') {
        return json(200, { method: saveDraft(db, await readBody(req)) });
      }
      return json(404, { error: '路径不存在' });
    } catch (error) { return json(400, { error: error.message }); }
  });
  server.on('close', () => db.close());
  return { server, setupToken };
}
if (require.main === module) {
  const host = '127.0.0.1';
  const port = Number(process.env.PORT) || 8787;
  const { server, setupToken } = startServer();
  server.listen(port, host, () => {
    process.stdout.write(`本地方法后台：http://${host}:${port}/admin\n${setupToken ? '首次管理员初始化码：' + setupToken + '\n' : '管理员账号已配置，请使用账号和密码登录。\n'}`);
  });
}
module.exports = { startServer };
