import crypto from 'node:crypto';

const PAGES = new Set(['home', 'about', 'qna']);
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** YYYY-MM-DD in Korea time. */
const kstDay = (ms) => new Date(ms + 9 * HOUR_MS).toISOString().slice(0, 10);

/** The site that sent the visitor ("naver.com", "kmong.com"), or '' for direct visits and our own pages. */
function referrerHost(value) {
  try {
    const host = new URL(String(value)).hostname.replace(/^(www|m)\./, '');
    return host === 'minohlee.mooo.com' ? '' : host.slice(0, 80);
  } catch {
    return '';
  }
}

// Visitor counts for the promo site (/neighbormate-app/). Each page sends one beacon per view with a
// random id the browser keeps, so a person counts once however many pages or days they come back.
export class VisitService {
  constructor(licenseDb, { maxPerHour = 120, now = () => Date.now() } = {}) {
    this.db = licenseDb.db;
    this.maxPerHour = maxPerHour;
    this.now = now;
    this.hits = new Map();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS site_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor TEXT NOT NULL,
        page TEXT NOT NULL,
        day TEXT NOT NULL,
        referrer TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_site_visits_day ON site_visits(day);
      CREATE INDEX IF NOT EXISTS idx_site_visits_visitor ON site_visits(visitor);
    `);
  }

  record({ visitor, page, referrer, ip = '', userAgent = '' } = {}) {
    const name = String(page || '');
    if (!PAGES.has(name)) return { ok: false, error: 'INVALID_PAGE' };
    if (/bot|crawl|spider|slurp|preview|headless/i.test(String(userAgent))) return { ok: true, skipped: true };

    // One IP cannot pad the numbers.
    const now = this.now();
    const hit = this.hits.get(ip);
    const count = hit && now - hit.since < HOUR_MS ? hit.count + 1 : 1;
    this.hits.set(ip, { count, since: count === 1 ? now : hit.since });
    if (count > this.maxPerHour) return { ok: true, skipped: true };
    if (this.hits.size > 5000) this.hits.clear();

    // Browsers that block storage send no id: fall back to IP + browser for that day.
    const id = /^[A-Za-z0-9-]{8,64}$/.test(String(visitor || ''))
      ? String(visitor)
      : `ip-${crypto.createHash('sha256').update(`${ip}|${userAgent}|${kstDay(now)}`).digest('hex').slice(0, 24)}`;
    this.db.prepare('INSERT INTO site_visits (visitor, page, day, referrer, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, kstDay(now), referrerHost(referrer) || null, new Date(now).toISOString());
    return { ok: true };
  }

  /** Totals, today, the last 14 days, per page and the top referring sites. */
  stats() {
    const now = this.now();
    const today = kstDay(now);
    const yesterday = kstDay(now - DAY_MS);
    const weekStart = kstDay(now - 6 * DAY_MS);
    const first = kstDay(now - 13 * DAY_MS);
    const one = (sql, ...args) => this.db.prepare(sql).get(...args);
    const people = (where = '', ...args) => Number(one(`SELECT COUNT(DISTINCT visitor) AS n FROM site_visits ${where}`, ...args).n);
    const views = (where = '', ...args) => Number(one(`SELECT COUNT(*) AS n FROM site_visits ${where}`, ...args).n);

    const perDay = new Map(this.db.prepare(
      'SELECT day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM site_visits WHERE day >= ? GROUP BY day'
    ).all(first).map((r) => [r.day, { visitors: Number(r.visitors), views: Number(r.views) }]));
    const days = Array.from({ length: 14 }, (_, i) => {
      const day = kstDay(now - (13 - i) * DAY_MS);
      return { day, ...(perDay.get(day) || { visitors: 0, views: 0 }) };
    });

    const pages = this.db.prepare(
      'SELECT page, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM site_visits GROUP BY page ORDER BY views DESC'
    ).all().map((r) => ({ page: r.page, visitors: Number(r.visitors), views: Number(r.views) }));
    const referrers = this.db.prepare(
      'SELECT referrer, COUNT(DISTINCT visitor) AS visitors FROM site_visits WHERE referrer IS NOT NULL GROUP BY referrer ORDER BY visitors DESC LIMIT 8'
    ).all().map((r) => ({ host: r.referrer, visitors: Number(r.visitors) }));

    return {
      ok: true,
      visits: {
        total: { visitors: people(), views: views() },
        today: { visitors: people('WHERE day = ?', today), views: views('WHERE day = ?', today) },
        yesterday: { visitors: people('WHERE day = ?', yesterday), views: views('WHERE day = ?', yesterday) },
        week: { visitors: people('WHERE day >= ?', weekStart), views: views('WHERE day >= ?', weekStart) },
        days,
        pages,
        referrers,
        since: one('SELECT MIN(day) AS d FROM site_visits').d || null
      }
    };
  }
}
