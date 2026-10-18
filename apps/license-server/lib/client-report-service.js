import { verifyJwt } from './crypto-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS_PER_REPORT = 500;
const MAX_REPORTS_PER_HOUR = 60;
const KEEP_DAYS = 60;

const clip = (value, max) => {
  const text = JSON.stringify(value ?? {});
  return text.length <= max ? text : JSON.stringify({ truncated: true, head: text.slice(0, max - 40) });
};
const parse = (text) => { try { return JSON.parse(text); } catch { return {}; } };

// What each customer's program reports: the latest status (version, PC, AI, Naver blog, today's counts)
// and an event stream (screen actions, errors, automation log lines). Feeds the admin customer view.
export class ClientReportService {
  constructor(licenseDb, licenseService, { now = () => Date.now() } = {}) {
    this.db = licenseDb.db;
    this.service = licenseService;
    this.now = now;
    this.hits = new Map();
    this.prunedAt = 0;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS client_status (
        user_id INTEGER PRIMARY KEY,
        hwid TEXT,
        app_version TEXT,
        blog_id TEXT,
        status_json TEXT NOT NULL,
        ip TEXT,
        first_report_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS client_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        level TEXT,
        name TEXT,
        data_json TEXT,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_events_user_at ON client_events(user_id, at);
    `);
  }

  receive({ token, hwid = null, status = {}, events = [], ip = '' }) {
    const jwt = verifyJwt(token, this.service.jwtSecret);
    if (!jwt.valid) return { ok: false, error: 'INVALID_TOKEN' };
    const user = this.service.db.getUserById(jwt.payload.userId);
    if (!user) return { ok: false, error: 'USER_NOT_FOUND' };
    if (hwid && user.hwid && user.hwid !== hwid) return { ok: false, error: 'UNAUTHORIZED_DEVICE' };
    const now = this.now();
    const hit = this.hits.get(user.id);
    if (hit && now - hit.since < 60 * 60 * 1000 && hit.count >= MAX_REPORTS_PER_HOUR) return { ok: false, error: 'TOO_MANY_REPORTS' };
    this.hits.set(user.id, hit && now - hit.since < 60 * 60 * 1000 ? { since: hit.since, count: hit.count + 1 } : { since: now, count: 1 });

    const nowIso = new Date(now).toISOString();
    const safeStatus = status && typeof status === 'object' ? status : {};
    const existing = this.db.prepare('SELECT first_report_at FROM client_status WHERE user_id = ?').get(user.id);
    this.db.prepare(`
      INSERT INTO client_status (user_id, hwid, app_version, blog_id, status_json, ip, first_report_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET hwid = excluded.hwid, app_version = excluded.app_version,
        blog_id = COALESCE(NULLIF(excluded.blog_id, ''), client_status.blog_id), status_json = excluded.status_json,
        ip = excluded.ip, updated_at = excluded.updated_at
    `).run(user.id, hwid || null, String(safeStatus.appVersion || '').slice(0, 20), String(safeStatus.naver?.blogId || '').slice(0, 40),
      clip(safeStatus, 20000), String(ip).slice(0, 64), existing?.first_report_at || nowIso, nowIso);

    const insert = this.db.prepare('INSERT INTO client_events (user_id, at, type, level, name, data_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let stored = 0;
    for (const event of (Array.isArray(events) ? events : []).slice(0, MAX_EVENTS_PER_REPORT)) {
      if (!event || typeof event !== 'object') continue;
      const type = String(event.type || 'event').slice(0, 30);
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      const at = Number.isFinite(Date.parse(event.at)) ? new Date(event.at).toISOString() : nowIso;
      const level = type === 'log' ? String(data.level || 'info').slice(0, 10) : (/error|crash/.test(type) ? 'error' : 'info');
      const name = type === 'log' ? String(data.source || '').slice(0, 30) : String(data.path || data.kind || '').slice(0, 80);
      insert.run(user.id, at, type, level, name, clip(data, 4000), nowIso);
      stored++;
    }
    this.prune(now);
    return { ok: true, stored };
  }

  prune(now) {
    if (now - this.prunedAt < 60 * 60 * 1000) return;
    this.prunedAt = now;
    this.db.prepare('DELETE FROM client_events WHERE at < ?').run(new Date(now - KEEP_DAYS * DAY_MS).toISOString());
  }

  isOwner(userId) {
    return Boolean(this.db.prepare('SELECT 1 FROM owner_accounts WHERE user_id = ?').get(userId));
  }

  ownerIds() {
    return new Set(this.db.prepare('SELECT user_id FROM owner_accounts').all().map((r) => r.user_id));
  }

  setOwner(userId, mine = true) {
    if (!this.service.db.getUserById(Number(userId))) return { ok: false, error: 'NOT_FOUND', message: '고객을 찾을 수 없습니다.' };
    if (mine) this.db.prepare('INSERT OR IGNORE INTO owner_accounts (user_id, created_at) VALUES (?, ?)').run(Number(userId), new Date(this.now()).toISOString());
    else this.db.prepare('DELETE FROM owner_accounts WHERE user_id = ?').run(Number(userId));
    return { ok: true };
  }

  // One row per customer for the list: version, blog, last report and how busy / broken the last day was.
  overview() {
    const since = new Date(this.now() - DAY_MS).toISOString();
    const statuses = this.db.prepare('SELECT user_id, app_version, blog_id, status_json, first_report_at, updated_at FROM client_status').all();
    const counts = this.db.prepare(`
      SELECT user_id, COUNT(*) AS events,
             SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS errors,
             SUM(CASE WHEN type = 'api' AND name NOT LIKE '/api/%/summary' THEN 1 ELSE 0 END) AS actions
      FROM client_events WHERE at >= ? GROUP BY user_id
    `).all(since);
    const lastAction = this.db.prepare(`
      SELECT e.user_id, e.at, e.name FROM client_events e
      JOIN (SELECT user_id, MAX(id) AS id FROM client_events WHERE type IN ('api', 'api_error') AND name NOT LIKE '%/summary' AND json_extract(data_json, '$.method') != 'GET' GROUP BY user_id) m ON m.id = e.id
    `).all();
    const owners = this.ownerIds();
    const map = new Map();
    for (const s of statuses) {
      const status = parse(s.status_json);
      map.set(s.user_id, {
        appVersion: s.app_version || '',
        blogId: s.blog_id || '',
        naverConnected: Boolean(status.naver?.connected),
        aiEngine: status.ai?.engine || '',
        acceleration: status.ai?.acceleration || '',
        today: status.today || null,
        firstReportAt: s.first_report_at,
        lastReportAt: s.updated_at
      });
    }
    for (const c of counts) Object.assign(map.get(c.user_id) || map.set(c.user_id, {}).get(c.user_id), { events24h: c.events, errors24h: c.errors, actions24h: c.actions });
    for (const a of lastAction) Object.assign(map.get(a.user_id) || map.set(a.user_id, {}).get(a.user_id), { lastAction: a.name, lastActionAt: a.at });
    return { map, owners };
  }

  detail(userId, { limit = 300, type = '', before = '' } = {}) {
    const id = Number(userId);
    const row = this.db.prepare('SELECT * FROM client_status WHERE user_id = ?').get(id);
    const where = ['user_id = ?'];
    const args = [id];
    if (type === 'error') where.push("level = 'error'");
    else if (type === 'action') where.push("type IN ('api', 'api_error') AND json_extract(data_json, '$.method') != 'GET'");
    else if (type) { where.push('type = ?'); args.push(String(type)); }
    if (before) { where.push('at < ?'); args.push(String(before)); }
    const events = this.db.prepare(`SELECT id, at, type, level, name, data_json FROM client_events WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(...args, Math.min(Math.max(Number(limit) || 300, 1), 1000))
      .map((e) => ({ id: e.id, at: e.at, type: e.type, level: e.level, name: e.name, data: parse(e.data_json) }));
    const since14 = new Date(this.now() - 14 * DAY_MS).toISOString();
    const daily = this.db.prepare(`
      SELECT substr(datetime(at, '+9 hours'), 1, 10) AS day, COUNT(*) AS events,
             SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS errors,
             SUM(CASE WHEN type IN ('api', 'api_error') AND json_extract(data_json, '$.method') != 'GET' THEN 1 ELSE 0 END) AS actions,
             SUM(CASE WHEN type = 'log' AND level = 'success' THEN 1 ELSE 0 END) AS successes,
             SUM(CASE WHEN type = 'app_start' THEN 1 ELSE 0 END) AS starts
      FROM client_events WHERE user_id = ? AND at >= ? GROUP BY day ORDER BY day
    `).all(id, since14);
    const since7 = new Date(this.now() - 7 * DAY_MS).toISOString();
    const topActions = this.db.prepare(`
      SELECT name, COUNT(*) AS n, SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS errors, MAX(at) AS lastAt
      FROM client_events WHERE user_id = ? AND at >= ? AND type IN ('api', 'api_error')
        AND json_extract(data_json, '$.method') != 'GET'
      GROUP BY name ORDER BY n DESC LIMIT 20
    `).all(id, since7);
    const topErrors = this.db.prepare(`
      SELECT COALESCE(json_extract(data_json, '$.error'), json_extract(data_json, '$.message'), name) AS message, COUNT(*) AS n, MAX(at) AS lastAt
      FROM client_events WHERE user_id = ? AND at >= ? AND level IN ('error', 'warn')
      GROUP BY message ORDER BY n DESC LIMIT 15
    `).all(id, since7);
    return {
      status: row ? { ...parse(row.status_json), firstReportAt: row.first_report_at, lastReportAt: row.updated_at, ip: row.ip } : null,
      events,
      daily,
      topActions,
      topErrors,
      owner: this.isOwner(id)
    };
  }
}
