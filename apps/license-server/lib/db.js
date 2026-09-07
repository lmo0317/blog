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

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_licenses_user_id ON licenses(user_id);
      CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
      CREATE INDEX IF NOT EXISTS idx_licenses_order_id ON licenses(order_id);
    `);
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
