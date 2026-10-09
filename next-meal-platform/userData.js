const crypto = require('node:crypto');
const { validKey } = require('../next-meal-miniapp/core/date');
const { isUsablePlan } = require('../next-meal-miniapp/core/plan');

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const nowIso = () => new Date().toISOString();
const DEVICE_ABSOLUTE_MS = 180 * 86400000;
const DEVICE_IDLE_MS = 30 * 86400000;
function requireUser(db, userId) {
  return !!db.prepare('SELECT user_id FROM users WHERE user_id = ? AND deleted_at IS NULL').get(userId);
}
function createPairing(db, existingUserId) {
  const userId = existingUserId || crypto.randomUUID();
  if (existingUserId && !requireUser(db, userId)) throw new Error('用户不存在');
  const code = crypto.randomBytes(7).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!existingUserId) db.prepare('INSERT INTO users(user_id, created_at) VALUES(?, ?)').run(userId, nowIso());
    db.prepare('INSERT INTO pairing_codes(code_hash, user_id, expires_at) VALUES(?, ?, ?)').run(hash(code), userId, expiresAt);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { userId, code, expiresAt };
}
function redeemPairing(db, codeInput) {
  const code = String(codeInput || '').trim().toUpperCase();
  if (!/^[0-9A-F]{14}$/.test(code)) throw new Error('配对码格式错误');
  const row = db.prepare('SELECT * FROM pairing_codes WHERE code_hash = ?').get(hash(code));
  if (!row || row.consumed_at || row.expires_at <= nowIso() || !requireUser(db, row.user_id)) throw new Error('配对码无效或已过期');
  const token = crypto.randomBytes(32).toString('hex');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + DEVICE_ABSOLUTE_MS).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const updated = db.prepare('UPDATE pairing_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL').run(now, hash(code));
    if (updated.changes !== 1) throw new Error('配对码已使用');
    db.prepare('INSERT INTO device_sessions(token_hash, user_id, created_at, device_id, last_seen_at, expires_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(hash(token), row.user_id, now, crypto.randomUUID(), now, expiresAt);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { userId: row.user_id, token, expiresAt };
}
function authenticate(db, token) {
  const value = String(token || '');
  if (!/^[0-9a-f]{64}$/.test(value)) return null;
  const now = nowIso();
  const idleCutoff = new Date(Date.now() - DEVICE_IDLE_MS).toISOString();
  const row = db.prepare(`SELECT s.user_id FROM device_sessions s JOIN users u ON u.user_id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen_at > ? AND u.deleted_at IS NULL`).get(hash(value), now, idleCutoff);
  if (row) db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, hash(value));
  return row ? row.user_id : null;
}
function listDevices(db, userId, currentToken) {
  const now = nowIso(), idleCutoff = new Date(Date.now() - DEVICE_IDLE_MS).toISOString();
  return db.prepare(`SELECT device_id, created_at, last_seen_at, expires_at, token_hash FROM device_sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen_at > ? ORDER BY created_at DESC`)
    .all(userId, now, idleCutoff).map(row => ({ id: row.device_id, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at, current: row.token_hash === hash(currentToken) }));
}
function revokeDevice(db, userId, deviceId) {
  if (typeof deviceId !== 'string' || !/^[a-f0-9-]{36}$/i.test(deviceId)) throw new Error('设备 ID 格式错误');
  const changed = db.prepare('UPDATE device_sessions SET revoked_at = ? WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId, deviceId);
  if (changed.changes !== 1) throw new Error('设备会话不存在或已退出');
  return { revoked: true };
}
function logoutDevice(db, userId, token) {
  db.prepare('UPDATE device_sessions SET revoked_at = ? WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL')
    .run(nowIso(), userId, hash(token));
  return { ok: true };
}
function json(value) { return JSON.stringify(value); }
function readJson(row) { return row ? JSON.parse(row.body_json) : null; }
function getSnapshot(db, userId) {
  if (!requireUser(db, userId)) throw new Error('用户不存在');
  const profile = readJson(db.prepare('SELECT body_json FROM user_profiles WHERE user_id = ?').get(userId)) || {};
  const goal = readJson(db.prepare('SELECT body_json FROM user_goals WHERE user_id = ?').get(userId));
  const plans = db.prepare('SELECT input_snapshot_json FROM plan_enrollments WHERE user_id = ? ORDER BY rowid DESC').all(userId).map(row => JSON.parse(row.input_snapshot_json));
  const active = db.prepare('SELECT input_snapshot_json FROM plan_enrollments WHERE user_id = ? AND ended_on IS NULL ORDER BY rowid DESC LIMIT 1').get(userId);
  const meals = db.prepare('SELECT body_json FROM meal_entries WHERE user_id = ? AND deleted_at IS NULL ORDER BY local_date DESC, updated_at DESC').all(userId).map(row => JSON.parse(row.body_json));
  const weights = db.prepare('SELECT body_json FROM body_measurements WHERE user_id = ? AND deleted_at IS NULL ORDER BY local_date DESC').all(userId).map(row => JSON.parse(row.body_json));
  const dayReviews = db.prepare('SELECT local_date AS date, confirmed_at AS at FROM daily_completions WHERE user_id = ? ORDER BY local_date DESC').all(userId);
  const dayContexts = Object.fromEntries(db.prepare('SELECT local_date, context FROM day_contexts WHERE user_id = ?').all(userId).map(row => [row.local_date, row.context]));
  const badgeAwards = db.prepare('SELECT badge_id AS id, awarded_at AS at, rule_version AS ruleVersion FROM badge_awards WHERE user_id = ? ORDER BY awarded_at').all(userId);
  return { userId, profile, goal, activePlan: active ? JSON.parse(active.input_snapshot_json) : null, planHistory: plans,
    meals, weights, dayReviews, dayContexts, badgeAwards, serverTime: nowIso() };
}
function validObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function applyOne(db, userId, mutation) {
  const data = mutation.payload;
  const now = nowIso();
  switch (mutation.type) {
    case 'profile_set': {
      if (!validObject(data) || json(data).length > 4000) throw new Error('资料格式错误');
      db.prepare(`INSERT INTO user_profiles(user_id, body_json, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET body_json=excluded.body_json, updated_at=excluded.updated_at`).run(userId, json(data), now);
      break;
    }
    case 'goal_set': {
      if (!validObject(data) || !Number.isFinite(+data.calories) || +data.calories < 1000 || +data.calories > 5000) throw new Error('目标格式错误');
      db.prepare(`INSERT INTO user_goals(user_id, body_json, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET body_json=excluded.body_json, updated_at=excluded.updated_at`).run(userId, json(data), now);
      break;
    }
    case 'plan_set': {
      if (!isUsablePlan(data) || !data.instanceId || typeof data.instanceId !== 'string' || data.instanceId.length > 100) throw new Error('计划格式错误');
      const methodId = data.methodRef && data.methodRef.id || data.mode;
      const methodVersion = data.methodRef && +data.methodRef.version || 1;
      if (!db.prepare('SELECT 1 FROM method_versions WHERE method_id = ? AND version = ?').get(methodId, methodVersion)) throw new Error('方法版本不存在');
      db.prepare('UPDATE plan_enrollments SET ended_on = ? WHERE user_id = ? AND ended_on IS NULL').run(now, userId);
      db.prepare(`INSERT INTO plan_enrollments(enrollment_id, user_id, method_id, method_version, engine_version, input_snapshot_json, started_on)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(data.instanceId, userId, methodId, methodVersion,
          data.estimateDetails && data.estimateDetails.formulaVersion || 'manual-v1', json(data), data.startDate);
      break;
    }
    case 'plan_update': {
      if (!isUsablePlan(data) || !data.instanceId) throw new Error('计划格式错误');
      const changed = db.prepare('UPDATE plan_enrollments SET input_snapshot_json = ? WHERE enrollment_id = ? AND user_id = ? AND ended_on IS NULL').run(json(data), data.instanceId, userId);
      if (changed.changes !== 1) { const error = new Error('计划已变化，请处理本机与后台的差异'); error.code = 'PLAN_CONFLICT'; throw error; }
      break;
    }
    case 'meal_upsert': {
      if (!validObject(data) || typeof data.id !== 'string' || data.id.length > 100 || !validKey(data.date) ||
          typeof data.name !== 'string' || !data.name.trim() || data.name.length > 60 || !Number.isFinite(+data.calories) || +data.calories <= 0 || +data.calories > 5000) throw new Error('餐食格式错误');
      const owner = db.prepare('SELECT user_id, local_date, deleted_at FROM meal_entries WHERE entry_id = ?').get(data.id);
      if (owner && owner.user_id !== userId) throw new Error('餐食 ID 已被占用');
      if (owner && owner.deleted_at) throw new Error('已删除餐食不可直接恢复');
      db.prepare(`INSERT INTO meal_entries(entry_id, user_id, local_date, body_json, updated_at) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(entry_id) DO UPDATE SET local_date=excluded.local_date, body_json=excluded.body_json, updated_at=excluded.updated_at`).run(data.id, userId, data.date, json(data), now);
      if (owner && owner.local_date !== data.date) {
        const remaining = db.prepare('SELECT 1 FROM meal_entries WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL LIMIT 1').get(userId, owner.local_date);
        if (!remaining) db.prepare('DELETE FROM daily_completions WHERE user_id = ? AND local_date = ?').run(userId, owner.local_date);
      }
      break;
    }
    case 'meal_delete': {
      if (!data || typeof data.id !== 'string' || data.id.length > 100) throw new Error('餐食删除格式错误');
      const owner = db.prepare('SELECT user_id, local_date FROM meal_entries WHERE entry_id = ?').get(data.id);
      if (owner && owner.user_id !== userId) throw new Error('餐食 ID 已被占用');
      if (owner) {
        db.prepare('UPDATE meal_entries SET deleted_at = ? WHERE entry_id = ? AND user_id = ?').run(now, data.id, userId);
        const remaining = db.prepare('SELECT 1 FROM meal_entries WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL LIMIT 1').get(userId, owner.local_date);
        if (!remaining) db.prepare('DELETE FROM daily_completions WHERE user_id = ? AND local_date = ?').run(userId, owner.local_date);
      } else {
        db.prepare('INSERT INTO meal_entries(entry_id, user_id, local_date, body_json, updated_at, deleted_at) VALUES(?, ?, ?, ?, ?, ?)').run(data.id, userId, '1970-01-01', '{}', now, now);
      }
      break;
    }
    case 'weight_upsert': {
      if (!validObject(data) || !validKey(data.date) || !Number.isFinite(+data.kg) || +data.kg < 25 || +data.kg > 350) throw new Error('体重格式错误');
      const id = userId + ':' + data.date;
      db.prepare(`INSERT INTO body_measurements(measurement_id, user_id, local_date, body_json, updated_at) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(measurement_id) DO UPDATE SET body_json=excluded.body_json, updated_at=excluded.updated_at, deleted_at=NULL`).run(id, userId, data.date, json({ date: data.date, kg: +data.kg }), now);
      break;
    }
    case 'day_complete': {
      if (!data || !validKey(data.date) || !db.prepare('SELECT 1 FROM meal_entries WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL').get(userId, data.date)) throw new Error('完整日需先有餐食记录');
      db.prepare('INSERT OR IGNORE INTO daily_completions(user_id, local_date, confirmed_at) VALUES(?, ?, ?)').run(userId, data.date, now);
      break;
    }
    case 'context_set': {
      if (!data || !validKey(data.date) || !['normal', 'training', 'eatingOut', 'busy'].includes(data.context)) throw new Error('日程场景格式错误');
      db.prepare(`INSERT INTO day_contexts(user_id, local_date, context, updated_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(user_id, local_date) DO UPDATE SET context=excluded.context, updated_at=excluded.updated_at`).run(userId, data.date, data.context, now);
      break;
    }
    default: throw new Error('未知同步动作');
  }
}
function awardBadges(db, userId) {
  const effective = db.prepare('SELECT COUNT(DISTINCT local_date) AS n FROM meal_entries WHERE user_id = ? AND deleted_at IS NULL').get(userId).n;
  const complete = db.prepare(`SELECT COUNT(*) AS n FROM daily_completions d WHERE d.user_id = ? AND EXISTS(
    SELECT 1 FROM meal_entries m WHERE m.user_id = d.user_id AND m.local_date = d.local_date AND m.deleted_at IS NULL)`).get(userId).n;
  const insert = db.prepare('INSERT OR IGNORE INTO badge_awards(user_id, badge_id, awarded_at, rule_version) VALUES(?, ?, ?, 1)');
  if (effective >= 5) insert.run(userId, 'first-five', nowIso());
  else db.prepare("DELETE FROM badge_awards WHERE user_id = ? AND badge_id = 'first-five'").run(userId);
  if (complete >= 10) insert.run(userId, 'ten-complete', nowIso());
  else db.prepare("DELETE FROM badge_awards WHERE user_id = ? AND badge_id = 'ten-complete'").run(userId);
}
function deleteUserData(db, userId) {
  if (!requireUser(db, userId)) throw new Error('用户不存在');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['user_mutations', 'badge_awards', 'daily_completions', 'body_measurements', 'meal_entries', 'plan_enrollments', 'day_contexts', 'user_goals', 'user_profiles', 'device_sessions', 'pairing_codes']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    db.prepare('DELETE FROM users WHERE user_id = ?').run(userId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { deleted: true };
}
function applyMutations(db, userId, mutations) {
  if (!requireUser(db, userId)) throw new Error('用户不存在');
  if (!Array.isArray(mutations) || mutations.length > 100) throw new Error('同步批次过大');
  const acknowledged = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const mutation of mutations) {
      if (!validObject(mutation) || typeof mutation.id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(mutation.id)) throw new Error('同步动作 ID 错误');
      if (!db.prepare('SELECT 1 FROM user_mutations WHERE user_id = ? AND mutation_id = ?').get(userId, mutation.id)) {
        applyOne(db, userId, mutation);
        db.prepare('INSERT INTO user_mutations(user_id, mutation_id, applied_at) VALUES(?, ?, ?)').run(userId, mutation.id, nowIso());
      }
      acknowledged.push(mutation.id);
    }
    awardBadges(db, userId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { acknowledged, snapshot: getSnapshot(db, userId) };
}
module.exports = { createPairing, redeemPairing, authenticate, listDevices, revokeDevice, logoutDevice, getSnapshot, applyMutations, deleteUserData };
