const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const SESSION_MS = 8 * 60 * 60 * 1000;
const dummySalt = crypto.randomBytes(16).toString('hex');
const dummyHash = crypto.randomBytes(32);

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function equalHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length || !/^[a-f0-9]+$/i.test(left)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
async function derive(password, salt) { return scrypt(password, salt, 32, SCRYPT_OPTIONS); }
function validateCredentials(username, password) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(username)) throw new Error('账号需为 3–32 位英文字母、数字、下划线或短横线，首位为字母');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || Buffer.byteLength(password) > 256) throw new Error('密码需为 12–128 个字符');
}
function accountExists(db) { return db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get() !== undefined; }
async function createAccount(db, username, password) {
  validateCredentials(username, password);
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = (await derive(password, salt)).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (accountExists(db)) throw new Error('管理员已初始化');
    db.prepare('INSERT INTO admin_accounts(username, password_salt, password_hash, created_at) VALUES(?, ?, ?, ?)')
      .run(username, salt, hashed, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { username };
}
async function login(db, username, password) {
  const validInput = typeof username === 'string' && username.length <= 32 && typeof password === 'string' && password.length <= 128 && Buffer.byteLength(password) <= 256;
  const row = validInput ? db.prepare('SELECT * FROM admin_accounts WHERE username = ?').get(username) : null;
  const candidate = await derive(validInput ? password : '', row ? row.password_salt : dummySalt);
  const matched = crypto.timingSafeEqual(candidate, row ? Buffer.from(row.password_hash, 'hex') : dummyHash);
  const current = row ? db.prepare('SELECT password_hash, failed_attempts, locked_until FROM admin_accounts WHERE username = ?').get(username) : null;
  const now = Date.now();
  if (!row || !current || current.password_hash !== row.password_hash || !matched || current.locked_until && Date.parse(current.locked_until) > now) {
    if (current) {
      const failures = current.failed_attempts + 1;
      db.prepare('UPDATE admin_accounts SET failed_attempts = ?, locked_until = ? WHERE username = ?')
        .run(failures, failures >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : current.locked_until, username);
    }
    return null;
  }
  db.prepare('UPDATE admin_accounts SET failed_attempts = 0, locked_until = NULL WHERE username = ?').run(username);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(now + SESSION_MS).toISOString();
  db.prepare('INSERT INTO admin_sessions(token_hash, username, created_at, expires_at) VALUES(?, ?, ?, ?)')
    .run(hashToken(token), username, new Date(now).toISOString(), expiresAt);
  return { token, username, expiresAt };
}
function authenticate(db, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const row = db.prepare('SELECT username FROM admin_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?')
    .get(hashToken(token), new Date().toISOString());
  return row ? row.username : null;
}
function logout(db, token) {
  if (typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token))
    db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), hashToken(token));
}
async function changePassword(db, username, oldPassword, newPassword) {
  validateCredentials(username, newPassword);
  const row = db.prepare('SELECT password_salt, password_hash FROM admin_accounts WHERE username = ?').get(username);
  if (!row || typeof oldPassword !== 'string' || oldPassword.length > 128 || !equalHex((await derive(oldPassword, row.password_salt)).toString('hex'), row.password_hash))
    throw new Error('当前密码错误');
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = (await derive(newPassword, salt)).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT password_hash FROM admin_accounts WHERE username = ?').get(username);
    if (!current || current.password_hash !== row.password_hash) throw new Error('密码已变更，请重新登录');
    db.prepare('UPDATE admin_accounts SET password_salt = ?, password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE username = ?')
      .run(salt, hashed, username);
    db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE username = ? AND revoked_at IS NULL').run(new Date().toISOString(), username);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function makeLimiter(maxAttempts = 20, windowMs = 15 * 60 * 1000) {
  const buckets = new Map();
  return key => {
    const now = Date.now();
    const current = buckets.get(key);
    const bucket = current && current.until > now ? current : { count: 0, until: now + windowMs };
    bucket.count++;
    buckets.set(key, bucket);
    if (buckets.size > 1000) for (const [id, value] of buckets) if (value.until <= now) buckets.delete(id);
    return bucket.count <= maxAttempts;
  };
}
module.exports = { accountExists, createAccount, login, authenticate, logout, changePassword, makeLimiter, equalHex };
