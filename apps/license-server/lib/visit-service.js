import crypto from 'node:crypto';

const PAGES = new Set(['home', 'about', 'qna']);
// Clicks counted alongside page views: the installer download and the purchase (KakaoTalk) button.
const ACTIONS = new Set(['download', 'buy']);
// The site owner's own visits (browsers marked from the admin page, and the home network) are kept in
// the visit list but left out of every count.
const MINE = "(visitor IN (SELECT value FROM site_owners) OR ip LIKE '192.168.%' OR ip LIKE '10.%')";
const ONLY_PAGES = `page IN ('home', 'about', 'qna') AND NOT ${MINE}`;
const NOT_MINE = ` AND NOT ${MINE}`;
const SESSION_GAP_MS = 30 * 60 * 1000;
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

/** The full address of the page that sent the visitor (which blog post, which search), or null. */
function referrerUrl(value) {
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol) || url.hostname === 'minohlee.mooo.com') return null;
    return url.href.slice(0, 600);
  } catch {
    return null;
  }
}

/** A short label for where a visitor came from: the Naver blog id and post, the search words, the café. */
export function describeReferrer(value) {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  const host = url.hostname.replace(/^(www|m)\./, '');
  const q = (key) => url.searchParams.get(key) || '';
  if (host === 'blog.naver.com') {
    const [first = '', second = ''] = url.pathname.split('/').filter(Boolean);
    const blogId = q('blogId') || (/\.naver$/i.test(first) ? '' : first);
    const logNo = q('logNo') || (/^\d+$/.test(second) ? second : '');
    if (!blogId) return { label: '네이버 블로그', link: url.href };
    return { label: `네이버 블로그 · ${blogId}${logNo ? ` · 글 ${logNo}` : ''}`, link: `https://blog.naver.com/${blogId}${logNo ? `/${logNo}` : ''}` };
  }
  if (host === 'section.blog.naver.com') return { label: '네이버 블로그 홈', link: url.href };
  if (host.endsWith('search.naver.com')) return { label: `네이버 검색 · ${q('query') || '검색어 없음'}`, link: url.href };
  if (host === 'cafe.naver.com') {
    const cafe = url.pathname.split('/').filter(Boolean)[0] || '';
    return { label: `네이버 카페${cafe ? ` · ${cafe}` : ''}`, link: url.href };
  }
  if (/(^|\.)google\./.test(host)) return { label: `구글${q('q') ? ` 검색 · ${q('q')}` : ''}`, link: url.href };
  if (host.endsWith('youtube.com') || host === 'youtu.be') return { label: '유튜브', link: url.href };
  if (host.endsWith('kmong.com')) return { label: '크몽', link: url.href };
  const path = url.pathname === '/' ? '' : url.pathname;
  return { label: `${host}${path}`.slice(0, 80), link: url.href };
}

/** "모바일 · 네이버 앱", "PC · Chrome" from the browser's user agent. */
export function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const kind = /iPad|Tablet/i.test(ua) ? '태블릿' : (/Mobi|Android|iPhone/i.test(ua) ? '모바일' : 'PC');
  const app = /NAVER\(inapp|NAVER\//i.test(ua) ? '네이버 앱'
    : /KAKAOTALK/i.test(ua) ? '카카오톡'
    : /Instagram/i.test(ua) ? '인스타그램'
    : /SamsungBrowser/i.test(ua) ? '삼성 인터넷'
    : /Whale/i.test(ua) ? '웨일'
    : /Edg\//i.test(ua) ? 'Edge'
    : /Chrome|CriOS/i.test(ua) ? 'Chrome'
    : /Safari/i.test(ua) ? 'Safari'
    : /Firefox/i.test(ua) ? 'Firefox' : '기타';
  return `${kind} · ${app}`;
}

/** utm_source / utm_campaign as sent by our own links ("naverblog", "launch-2610"), or null. */
const utmValue = (value) => {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z0-9._-]{1,40}$/.test(text) ? text : null;
};

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
    // Campaign columns arrived after the table; add them to databases made before.
    const columns = new Set(this.db.prepare('PRAGMA table_info(site_visits)').all().map((c) => c.name));
    if (!columns.has('utm_source')) this.db.exec('ALTER TABLE site_visits ADD COLUMN utm_source TEXT');
    if (!columns.has('utm_campaign')) this.db.exec('ALTER TABLE site_visits ADD COLUMN utm_campaign TEXT');
    for (const column of ['utm_content', 'ip', 'referrer_url', 'device']) {
      if (!columns.has(column)) this.db.exec(`ALTER TABLE site_visits ADD COLUMN ${column} TEXT`);
    }
    // Browsers the owner marked as "나" (the admin page marks the browser it is opened in).
    this.db.exec('CREATE TABLE IF NOT EXISTS site_owners (value TEXT PRIMARY KEY, created_at TEXT NOT NULL)');
  }

  /** Marks (or unmarks) a browser's visitor id as the site owner's, so its visits stop counting. */
  setOwner(visitor, mine = true) {
    const id = String(visitor || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return { ok: false, error: 'INVALID_VISITOR' };
    if (mine) this.db.prepare('INSERT OR IGNORE INTO site_owners (value, created_at) VALUES (?, ?)').run(id, new Date(this.now()).toISOString());
    else this.db.prepare('DELETE FROM site_owners WHERE value = ?').run(id);
    return { ok: true };
  }

  record({ visitor, page, referrer, source, campaign, content, ip = '', userAgent = '' } = {}) {
    const name = String(page || '');
    if (!PAGES.has(name) && !ACTIONS.has(name)) return { ok: false, error: 'INVALID_PAGE' };
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
    this.db.prepare(`INSERT INTO site_visits (visitor, page, day, referrer, referrer_url, utm_source, utm_campaign, utm_content, ip, device, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, kstDay(now), referrerHost(referrer) || null, referrerUrl(referrer), utmValue(source), utmValue(campaign), utmValue(content),
        String(ip).replace(/^::ffff:/, '').slice(0, 64) || null, deviceLabel(userAgent), new Date(now).toISOString());
    return { ok: true };
  }

  /** Totals, today, the last 14 days, per page, the top referring sites, campaigns and download / purchase clicks. */
  stats() {
    const now = this.now();
    const today = kstDay(now);
    const yesterday = kstDay(now - DAY_MS);
    const weekStart = kstDay(now - 6 * DAY_MS);
    const first = kstDay(now - 13 * DAY_MS);
    const one = (sql, ...args) => this.db.prepare(sql).get(...args);
    // Visitor and view numbers count page views only; download / purchase clicks are reported separately.
    const people = (where = '', ...args) => Number(one(`SELECT COUNT(DISTINCT visitor) AS n FROM site_visits WHERE ${ONLY_PAGES}${where}`, ...args).n);
    const views = (where = '', ...args) => Number(one(`SELECT COUNT(*) AS n FROM site_visits WHERE ${ONLY_PAGES}${where}`, ...args).n);
    const clickers = (action, where = '', ...args) => Number(one(`SELECT COUNT(DISTINCT visitor) AS n FROM site_visits WHERE page = ?${NOT_MINE}${where}`, action, ...args).n);

    const perDay = new Map(this.db.prepare(
      `SELECT day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM site_visits WHERE ${ONLY_PAGES} AND day >= ? GROUP BY day`
    ).all(first).map((r) => [r.day, { visitors: Number(r.visitors), views: Number(r.views) }]));
    const days = Array.from({ length: 14 }, (_, i) => {
      const day = kstDay(now - (13 - i) * DAY_MS);
      return { day, ...(perDay.get(day) || { visitors: 0, views: 0 }) };
    });

    const pages = this.db.prepare(
      `SELECT page, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM site_visits WHERE ${ONLY_PAGES} GROUP BY page ORDER BY views DESC`
    ).all().map((r) => ({ page: r.page, visitors: Number(r.visitors), views: Number(r.views) }));
    const referrers = this.db.prepare(
      `SELECT referrer, COUNT(DISTINCT visitor) AS visitors FROM site_visits WHERE ${ONLY_PAGES} AND referrer IS NOT NULL GROUP BY referrer ORDER BY visitors DESC LIMIT 8`
    ).all().map((r) => ({ host: r.referrer, visitors: Number(r.visitors) }));
    // Per campaign link: how many people came, and how many of them downloaded or pressed buy.
    const campaigns = this.db.prepare(`
      SELECT utm_source AS source, COALESCE(utm_campaign, '') AS campaign,
        COUNT(DISTINCT CASE WHEN page IN ('home', 'about', 'qna') THEN visitor END) AS visitors,
        COUNT(DISTINCT CASE WHEN page = 'download' THEN visitor END) AS downloads,
        COUNT(DISTINCT CASE WHEN page = 'buy' THEN visitor END) AS buys
      FROM site_visits WHERE utm_source IS NOT NULL${NOT_MINE} GROUP BY utm_source, utm_campaign ORDER BY visitors DESC, downloads DESC LIMIT 10
    `).all().map((r) => ({ source: r.source, campaign: r.campaign, visitors: Number(r.visitors), downloads: Number(r.downloads), buys: Number(r.buys) }));
    const actions = Object.fromEntries([...ACTIONS].map((action) => [action, {
      today: clickers(action, ' AND day = ?', today),
      week: clickers(action, ' AND day >= ?', weekStart),
      total: clickers(action)
    }]));

    return {
      ok: true,
      visits: {
        total: { visitors: people(), views: views() },
        today: { visitors: people(' AND day = ?', today), views: views(' AND day = ?', today) },
        yesterday: { visitors: people(' AND day = ?', yesterday), views: views(' AND day = ?', yesterday) },
        week: { visitors: people(' AND day >= ?', weekStart), views: views(' AND day >= ?', weekStart) },
        days,
        pages,
        referrers,
        campaigns,
        actions,
        since: one('SELECT MIN(day) AS d FROM site_visits').d || null,
        mine: Number(one(`SELECT COUNT(*) AS n FROM site_visits WHERE page IN ('home', 'about', 'qna') AND ${MINE}`).n)
      }
    };
  }

  /**
   * The newest visits, one row per visit: the same browser's page views and clicks less than 30 minutes
   * apart are one visit. Each row has the time, IP, device, where they came from (the first outside page
   * that sent them, with the Naver blog id and post), the campaign link, the pages in order, and whether
   * it is the owner's own visit.
   */
  sessions({ limit = 100, includeMine = true } = {}) {
    const rows = this.db.prepare(`
      SELECT visitor, page, referrer_url, utm_source, utm_campaign, utm_content, ip, device, created_at,
        CASE WHEN ${MINE} THEN 1 ELSE 0 END AS mine
      FROM site_visits ORDER BY created_at ASC, id ASC
    `).all();
    const open = new Map();
    const done = [];
    for (const r of rows) {
      const at = Date.parse(r.created_at);
      let visit = open.get(r.visitor);
      if (!visit || at - visit.lastAt > SESSION_GAP_MS) {
        visit = { visitor: r.visitor, mine: false, startedAt: r.created_at, lastAt: at, ip: r.ip || '', device: r.device || '',
          from: null, campaign: null, pages: [], download: false, buy: false };
        open.set(r.visitor, visit);
        done.push(visit);
      }
      visit.lastAt = at;
      if (r.mine) visit.mine = true;
      if (r.ip && !visit.ip) visit.ip = r.ip;
      if (r.device && !visit.device) visit.device = r.device;
      if (!visit.from && r.referrer_url) visit.from = { url: r.referrer_url, ...describeReferrer(r.referrer_url) };
      if (!visit.campaign && r.utm_source) visit.campaign = [r.utm_source, r.utm_campaign, r.utm_content].filter(Boolean).join(' · ');
      if (r.page === 'download') visit.download = true;
      else if (r.page === 'buy') visit.buy = true;
      else if (visit.pages[visit.pages.length - 1] !== r.page) visit.pages.push(r.page);
    }
    const list = done.filter((v) => includeMine || !v.mine).reverse().slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
    return {
      ok: true,
      sessions: list.map(({ lastAt, ...v }) => ({ ...v, endedAt: new Date(lastAt).toISOString() })),
      total: done.length,
      mine: done.filter((v) => v.mine).length
    };
  }
}
