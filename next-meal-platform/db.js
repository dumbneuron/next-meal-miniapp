const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { FALLBACK_METHODS, validateMethod, testMethod } = require('../next-meal-miniapp/core/methods');

function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS method_versions (
      method_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      body_json TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT, retired_at TEXT,
      PRIMARY KEY (method_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_method_status ON method_versions(status, method_id, version);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, method_id TEXT,
      version INTEGER, at TEXT NOT NULL, details_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_accounts (
      username TEXT PRIMARY KEY, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES admin_accounts(username),
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(username);
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(user_id), body_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_goals (
      user_id TEXT PRIMARY KEY REFERENCES users(user_id), body_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS day_contexts (
      user_id TEXT NOT NULL REFERENCES users(user_id), local_date TEXT NOT NULL,
      context TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, local_date)
    );
    CREATE TABLE IF NOT EXISTS plan_enrollments (
      enrollment_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
      method_id TEXT NOT NULL, method_version INTEGER NOT NULL, engine_version TEXT NOT NULL,
      input_snapshot_json TEXT NOT NULL, started_on TEXT NOT NULL, ended_on TEXT,
      FOREIGN KEY (method_id, method_version) REFERENCES method_versions(method_id, version)
    );
    CREATE TABLE IF NOT EXISTS meal_entries (
      entry_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
      local_date TEXT NOT NULL, body_json TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meal_entries(user_id, local_date);
    CREATE TABLE IF NOT EXISTS body_measurements (
      measurement_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
      local_date TEXT NOT NULL, body_json TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS daily_completions (
      user_id TEXT NOT NULL REFERENCES users(user_id), local_date TEXT NOT NULL,
      confirmed_at TEXT NOT NULL, PRIMARY KEY (user_id, local_date)
    );
    CREATE TABLE IF NOT EXISTS badge_awards (
      user_id TEXT NOT NULL REFERENCES users(user_id), badge_id TEXT NOT NULL,
      awarded_at TEXT NOT NULL, rule_version INTEGER NOT NULL,
      PRIMARY KEY (user_id, badge_id)
    );
    CREATE TABLE IF NOT EXISTS pairing_codes (
      code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
      expires_at TEXT NOT NULL, consumed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS device_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
      created_at TEXT NOT NULL, revoked_at TEXT, device_id TEXT, last_seen_at TEXT, expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions(user_id);
    CREATE TABLE IF NOT EXISTS user_mutations (
      user_id TEXT NOT NULL REFERENCES users(user_id), mutation_id TEXT NOT NULL,
      applied_at TEXT NOT NULL, PRIMARY KEY (user_id, mutation_id)
    );
  `);
  const deviceColumns = new Set(db.prepare('PRAGMA table_info(device_sessions)').all().map(row => row.name));
  for (const column of ['device_id', 'last_seen_at', 'expires_at']) {
    if (!deviceColumns.has(column)) db.exec(`ALTER TABLE device_sessions ADD COLUMN ${column} TEXT`);
  }
  const oldSessions = db.prepare('SELECT token_hash, created_at, device_id, last_seen_at, expires_at FROM device_sessions WHERE device_id IS NULL OR last_seen_at IS NULL OR expires_at IS NULL').all();
  for (const row of oldSessions) {
    const created = Date.parse(row.created_at);
    db.prepare('UPDATE device_sessions SET device_id = ?, last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(
      row.device_id || crypto.randomUUID(), row.last_seen_at || row.created_at,
      row.expires_at || new Date((Number.isFinite(created) ? created : 0) + 180 * 86400000).toISOString(), row.token_hash);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_device_sessions_id ON device_sessions(device_id)');
  if (db.prepare('SELECT COUNT(*) AS n FROM method_versions').get().n === 0) {
    const insert = db.prepare('INSERT INTO method_versions(method_id, version, status, body_json, created_at, published_at) VALUES(?, ?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    for (const method of FALLBACK_METHODS) insert.run(method.id, method.version, 'published', JSON.stringify(method), now, now);
  }
  return db;
}
function parseRow(row) {
  return row && Object.assign(JSON.parse(row.body_json), { status: row.status, createdAt: row.created_at, publishedAt: row.published_at, retiredAt: row.retired_at });
}
function audit(db, action, methodId, version, details) {
  db.prepare('INSERT INTO admin_audit(action, method_id, version, at, details_json) VALUES(?, ?, ?, ?, ?)')
    .run(action, methodId || null, version || null, new Date().toISOString(), JSON.stringify(details || {}));
}
function listPublished(db) {
  const rows = db.prepare(`SELECT v.* FROM method_versions v WHERE v.status = 'published' AND v.version = (
    SELECT MAX(x.version) FROM method_versions x WHERE x.method_id = v.method_id AND x.status = 'published'
  ) ORDER BY v.method_id`).all();
  return rows.map(parseRow);
}
function listAll(db) {
  return db.prepare('SELECT * FROM method_versions ORDER BY method_id, version DESC').all().map(parseRow);
}
function latestVersion(db, id) {
  return db.prepare('SELECT MAX(version) AS version FROM method_versions WHERE method_id = ?').get(id).version || 0;
}
function saveDraft(db, raw) {
  const id = String(raw && raw.id || '').trim();
  const existing = db.prepare("SELECT * FROM method_versions WHERE method_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1").get(id);
  const version = existing ? existing.version : latestVersion(db, id) + 1;
  const method = validateMethod(Object.assign({}, raw, { version }));
  testMethod(method);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE method_versions SET body_json = ? WHERE method_id = ? AND version = ?').run(JSON.stringify(method), id, version);
    audit(db, 'update_draft', id, version, {});
  } else {
    db.prepare('INSERT INTO method_versions(method_id, version, status, body_json, created_at) VALUES(?, ?, ?, ?, ?)').run(id, version, 'draft', JSON.stringify(method), now);
    audit(db, 'create_draft', id, version, {});
  }
  return Object.assign(method, { status: 'draft' });
}
function publishDraft(db, id) {
  const row = db.prepare("SELECT * FROM method_versions WHERE method_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1").get(id);
  if (!row) throw new Error('找不到待发布草稿');
  const method = validateMethod(JSON.parse(row.body_json));
  testMethod(method);
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE method_versions SET status = 'retired', retired_at = ? WHERE method_id = ? AND status = 'published'").run(now, id);
    db.prepare("UPDATE method_versions SET status = 'published', published_at = ? WHERE method_id = ? AND version = ? AND status = 'draft'").run(now, id, row.version);
    audit(db, 'publish', id, row.version, {});
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return Object.assign(method, { status: 'published', publishedAt: now });
}
function retireMethod(db, id) {
  const row = db.prepare("SELECT * FROM method_versions WHERE method_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1").get(id);
  if (!row) throw new Error('找不到正在发布的方法');
  if (db.prepare("SELECT COUNT(*) AS n FROM method_versions WHERE status = 'published'").get().n <= 1) throw new Error('至少保留一个已发布方法');
  const now = new Date().toISOString();
  db.prepare("UPDATE method_versions SET status = 'retired', retired_at = ? WHERE method_id = ? AND version = ?").run(now, id, row.version);
  audit(db, 'retire', id, row.version, {});
  return Object.assign(parseRow(row), { status: 'retired', retiredAt: now });
}
module.exports = { openDatabase, listPublished, listAll, saveDraft, publishDraft, retireMethod };
