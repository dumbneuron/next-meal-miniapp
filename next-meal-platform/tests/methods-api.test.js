const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../server');

test('admin can draft, publish, version and retire a method; public catalog changes without app build', async () => {
  const { server, setupToken } = startServer({ database: ':memory:', bootstrapToken: 'a'.repeat(48) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let adminToken = '';
  const request = async (path, method = 'GET', body, authorized = true) => {
    const response = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, authorized ? { Authorization: 'Bearer ' + adminToken } : {}), body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await request('/api/admin/methods', 'GET', null, false)).status, 401);
    assert.equal((await request('/api/methods', 'GET', null, false)).data.methods.length, 3);
    assert.equal((await request('/api/admin/setup', 'POST', { setupToken, username: 'admin', password: 'strong-test-password-123' }, false)).status, 201);
    adminToken = (await request('/api/admin/login', 'POST', { username: 'admin', password: 'strong-test-password-123' }, false)).data.token;
    const method = { id: 'workday-method', version: 1, title: '工作日节奏', subtitle: '新方法通过后台发布', suitable: '有规律工作日的人', sourceTitle: '下一餐原创', sourceUrl: '', mode: 'steady', config: {} };
    assert.equal((await request('/api/admin/methods/drafts', 'POST', method)).data.method.status, 'draft');
    assert.equal((await request('/api/methods', 'GET', null, false)).data.methods.length, 3);
    assert.equal((await request('/api/admin/methods/workday-method/publish', 'POST')).data.method.version, 1);
    assert.equal((await request('/api/methods', 'GET', null, false)).data.methods.length, 4);
    const second = await request('/api/admin/methods/drafts', 'POST', { ...method, subtitle: '第二个不可变版本' });
    assert.equal(second.data.method.version, 2);
    await request('/api/admin/methods/workday-method/publish', 'POST');
    const catalog = (await request('/api/methods', 'GET', null, false)).data.methods;
    assert.equal(catalog.find(item => item.id === 'workday-method').version, 2);
    await request('/api/admin/methods/workday-method/retire', 'POST');
    assert.equal((await request('/api/methods', 'GET', null, false)).data.methods.some(item => item.id === 'workday-method'), false);
    const versions = (await request('/api/admin/methods')).data.methods.filter(item => item.id === 'workday-method');
    assert.deepEqual(versions.map(item => item.status), ['retired', 'retired']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
