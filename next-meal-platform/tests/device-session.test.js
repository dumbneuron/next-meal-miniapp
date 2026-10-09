const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../db');
const { createPairing, redeemPairing, authenticate, listDevices, revokeDevice, logoutDevice } = require('../userData');

test('device sessions expire, can be listed, revoked and logged out', () => {
  const db = openDatabase(':memory:');
  try {
    const pair = createPairing(db);
    const a = redeemPairing(db, pair.code);
    const b = redeemPairing(db, createPairing(db, pair.userId).code);
    assert.equal(authenticate(db, a.token), pair.userId);
    let devices = listDevices(db, pair.userId, a.token);
    assert.equal(devices.length, 2);
    assert.equal(devices.filter(item => item.current).length, 1);
    assert.ok(devices.every(item => !Object.hasOwn(item, 'token_hash')));
    const other = devices.find(item => !item.current);
    revokeDevice(db, pair.userId, other.id);
    assert.equal(authenticate(db, b.token), null);
    assert.equal(listDevices(db, pair.userId, a.token).length, 1);
    const tokenHash = crypto.createHash('sha256').update(a.token).digest('hex');
    db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE token_hash = ?').run('2020-01-01T00:00:00.000Z', tokenHash);
    assert.equal(authenticate(db, a.token), null);
    db.prepare('UPDATE device_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), '2020-01-01T00:00:00.000Z', tokenHash);
    assert.equal(authenticate(db, a.token), null);
    db.prepare('UPDATE device_sessions SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() + 86400000).toISOString(), tokenHash);
    assert.equal(authenticate(db, a.token), pair.userId);
    logoutDevice(db, pair.userId, a.token);
    assert.equal(authenticate(db, a.token), null);
  } finally { db.close(); }
});

test('older SQLite device sessions get finite expiry during migration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'next-meal-device-'));
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  const file = path.join(directory, 'legacy.sqlite');
  try {
    const old = new DatabaseSync(file);
    old.exec('CREATE TABLE device_sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT)');
    old.prepare('INSERT INTO device_sessions(token_hash,user_id,created_at) VALUES(?,?,?)')
      .run('old-token-hash', 'old-user', '2020-01-01T00:00:00.000Z');
    old.close();
    const db = openDatabase(file);
    try {
      const row = db.prepare('SELECT device_id,last_seen_at,expires_at FROM device_sessions WHERE token_hash = ?').get('old-token-hash');
      assert.match(row.device_id, /^[a-f0-9-]{36}$/);
      assert.equal(row.last_seen_at, '2020-01-01T00:00:00.000Z');
      assert.equal(row.expires_at, new Date(Date.parse('2020-01-01T00:00:00.000Z') + 180 * 86400000).toISOString());
    } finally { db.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
