import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LicenseDatabase {
  constructor(dbPath = null) {
    if (dbPath === ':memory:') {
      this.db = new DatabaseSync(':memory:');
    } else {
      const resolvedPath = dbPath || path.resolve(__dirname, '..', 'data', 'license.db');
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseSync(resolvedPath);
    }

    this.initSchema();
    this.backfillTrialClaims();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        name TEXT,
        hwid TEXT,
        hwid_updated_at TEXT,
        hwid_changed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        license_key TEXT UNIQUE NOT NULL,
        plan_type TEXT DEFAULT 'monthly',
        status TEXT DEFAULT 'active',
        expires_at TEXT NOT NULL,
        last_heartbeat_at TEXT,
        last_heartbeat_ip TEXT,
        order_id TEXT,
        channel TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        event_type TEXT,
        order_id TEXT,
        amount INTEGER,
        raw_payload TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        days INTEGER NOT NULL,
        order_id TEXT,
        channel TEXT,
        redeemed_by INTEGER,
        redeemed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_orders (
        provider TEXT NOT NULL,
        order_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (provider, order_id)
      );

      CREATE TABLE IF NOT EXISTS server_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- One free trial per PC, whatever email is used (the IP is kept for the record only). Kept apart from users so a
      -- device reset or a deleted account does not hand out another trial.
      CREATE TABLE IF NOT EXISTS trial_claims (
        hwid TEXT PRIMARY KEY,
        user_id INTEGER,
        ip TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_licenses_user_id ON licenses(user_id);
      CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
      CREATE INDEX IF NOT EXISTS idx_licenses_order_id ON licenses(order_id);
    `);
  }

  // Trials handed out before trial_claims existed still count.
  backfillTrialClaims() {
    this.db.exec(`
      INSERT OR IGNORE INTO trial_claims (hwid, user_id, ip, created_at)
      SELECT u.hwid, u.id, NULL, MIN(l.created_at) FROM users u JOIN licenses l ON l.user_id = u.id
      WHERE l.plan_type = 'free_trial' AND u.hwid IS NOT NULL AND u.hwid != '' GROUP BY u.hwid
    `);
  }

  getTrialClaim(hwid) {
    if (!hwid) return null;
    return this.db.prepare('SELECT * FROM trial_claims WHERE hwid = ?').get(hwid) || null;
  }

  addTrialClaim({ hwid, userId, ip = '' }) {
    this.db.prepare('INSERT OR IGNORE INTO trial_claims (hwid, user_id, ip, created_at) VALUES (?, ?, ?, ?)')
      .run(hwid, userId, ip || null, new Date().toISOString());
  }

  createUser({ email, password_hash, password_salt, name = '', hwid = null }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO users (email, password_hash, password_salt, name, hwid, hwid_updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(email, password_hash, password_salt, name, hwid, hwid ? now : null, now);
    return this.getUserById(Number(result.lastInsertRowid));
  }

  getUserByEmail(email) {
    if (!email) return null;
    const stmt = this.db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)');
    return stmt.get(email) || null;
  }

  getUserById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id) || null;
  }

  updateUserHwid(id, hwid) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE users SET hwid = ?, hwid_updated_at = ? WHERE id = ?');
    stmt.run(hwid, now, id);
    return this.getUserById(id);
  }

  changeUserHwid(id, newHwid) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE users SET hwid = ?, hwid_updated_at = ?, hwid_changed_at = ? WHERE id = ?');
    stmt.run(newHwid, now, now, id);
    return this.getUserById(id);
  }

  createLicense({ userId, licenseKey, planType = 'monthly', expiresAt, orderId = null, channel = 'direct' }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO licenses (user_id, license_key, plan_type, status, expires_at, order_id, channel, created_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `);
    const result = stmt.run(userId, licenseKey, planType, expiresAt, orderId, channel, now);
    return this.getLicenseById(Number(result.lastInsertRowid));
  }

  getLicenseById(id) {
    const stmt = this.db.prepare('SELECT * FROM licenses WHERE id = ?');
    return stmt.get(id) || null;
  }

  getLicenseByUserId(userId) {
    const stmt = this.db.prepare('SELECT * FROM licenses WHERE user_id = ? ORDER BY id DESC LIMIT 1');
    return stmt.get(userId) || null;
  }

  getLicenseByKey(key) {
    if (!key) return null;
    const stmt = this.db.prepare('SELECT * FROM licenses WHERE UPPER(license_key) = UPPER(?)');
    return stmt.get(key) || null;
  }

  getLicenseByOrderId(orderId) {
    if (!orderId) return null;
    const stmt = this.db.prepare('SELECT * FROM licenses WHERE order_id = ?');
    return stmt.get(orderId) || null;
  }

  extendLicense(licenseId, additionalDays = 30) {
    const license = this.getLicenseById(licenseId);
    if (!license) return null;

    const currentExpiry = new Date(license.expires_at).getTime();
    const now = Date.now();
    // If already expired, extend from now; if still active, add to current expiry
    const baseTime = currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(baseTime + additionalDays * 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      UPDATE licenses
      SET expires_at = ?, status = 'active'
      WHERE id = ?
    `);
    stmt.run(newExpiry, licenseId);
    return this.getLicenseById(licenseId);
  }

  updateLicenseHeartbeat(licenseId, ip = '') {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE licenses
      SET last_heartbeat_at = ?, last_heartbeat_ip = ?
      WHERE id = ?
    `);
    stmt.run(now, ip, licenseId);
  }

  getOrCreateSetting(key, createValue) {
    const row = this.db.prepare('SELECT value FROM server_settings WHERE key = ?').get(key);
    if (row) return row.value;
    const value = createValue();
    this.db.prepare('INSERT INTO server_settings (key, value) VALUES (?, ?)').run(key, value);
    return value;
  }

  // Returns false when this order was already processed (replayed webhook).
  markOrderProcessed(provider, orderId) {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO processed_orders (provider, order_id, created_at) VALUES (?, ?, ?)
    `).run(provider, orderId, new Date().toISOString());
    return Number(result.changes) > 0;
  }

  createVoucher({ code, days, orderId = null, channel = 'manual' }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO vouchers (code, days, order_id, channel, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(code, days, orderId, channel, now);
    return this.getVoucherByCode(code);
  }

  getVoucherByCode(code) {
    if (!code) return null;
    return this.db.prepare('SELECT * FROM vouchers WHERE UPPER(code) = UPPER(?)').get(code) || null;
  }

  // Atomically claims an unredeemed voucher; returns false if it was already used.
  redeemVoucher(voucherId, userId) {
    const result = this.db.prepare(`
      UPDATE vouchers SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_by IS NULL
    `).run(userId, new Date().toISOString(), voucherId);
    return Number(result.changes) > 0;
  }

  // ---- Seller admin ----
  listVouchers({ status = 'all', limit = 200 } = {}) {
    const where = status === 'unused' ? 'WHERE v.redeemed_by IS NULL' : status === 'used' ? 'WHERE v.redeemed_by IS NOT NULL' : '';
    return this.db.prepare(`
      SELECT v.id, v.code, v.days, v.order_id, v.channel, v.created_at, v.redeemed_at, u.email AS redeemed_email
      FROM vouchers v LEFT JOIN users u ON u.id = v.redeemed_by
      ${where}
      ORDER BY v.id DESC LIMIT ?
    `).all(limit);
  }

  // Only an unused voucher can be deleted (e.g. a refunded order).
  deleteUnusedVoucher(id) {
    const result = this.db.prepare('DELETE FROM vouchers WHERE id = ? AND redeemed_by IS NULL').run(id);
    return Number(result.changes) > 0;
  }

  listUsersWithLicenses({ query = '', limit = 200 } = {}) {
    return this.db.prepare(`
      SELECT u.id, u.email, u.name, u.created_at, u.hwid IS NOT NULL AS has_device, u.hwid_changed_at,
             l.id AS license_id, l.plan_type, l.status, l.expires_at, l.last_heartbeat_at
      FROM users u
      LEFT JOIN licenses l ON l.id = (SELECT id FROM licenses WHERE user_id = u.id ORDER BY id DESC LIMIT 1)
      WHERE u.email LIKE ?
      ORDER BY u.id DESC LIMIT ?
    `).all(`%${query}%`, limit);
  }

  clearUserHwid(id) {
    const result = this.db.prepare('UPDATE users SET hwid = NULL, hwid_updated_at = NULL WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  countSummary() {
    const now = new Date().toISOString();
    const one = (sql, ...args) => Number(this.db.prepare(sql).get(...args)?.n || 0);
    return {
      users: one('SELECT COUNT(*) AS n FROM users'),
      paidActive: one("SELECT COUNT(DISTINCT user_id) AS n FROM licenses WHERE expires_at > ? AND plan_type != 'free_trial' AND status = 'active'", now),
      trialActive: one("SELECT COUNT(DISTINCT user_id) AS n FROM licenses WHERE expires_at > ? AND plan_type = 'free_trial' AND status = 'active'", now),
      unusedVouchers: one('SELECT COUNT(*) AS n FROM vouchers WHERE redeemed_by IS NULL')
    };
  }

  logAudit({ userId = null, action, details = '', ip = '' }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (user_id, action, details, ip, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(userId, action, details, ip, now);
  }

  logWebhook({ provider, eventType, orderId, amount, rawPayload }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO webhook_logs (provider, event_type, order_id, amount, raw_payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(provider, eventType, orderId, amount, typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload), now);
  }

  close() {
    this.db.close();
  }
}
