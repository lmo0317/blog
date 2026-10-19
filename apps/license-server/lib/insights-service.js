const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const kstDay = (ms) => new Date(ms + 9 * HOUR_MS).toISOString().slice(0, 10);
const NOTE_KINDS = new Set(['note', 'mail', 'reply', 'call', 'credit']);
// Home network, the server itself and test addresses say nothing about who a visitor is.
const LOCAL_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|$)/;
const cleanIp = (ip) => String(ip || '').replace(/^::ffff:/, '').trim();
const verNum = (v) => String(v || '0').split('.').map((x) => Number(x) || 0).reduce((a, x) => a * 1000 + x, 0);
const LEVEL_ORDER = { danger: 0, warn: 1, info: 2 };

// What the seller should look at: the home page's to-do list, the visitor → paying customer funnel and its
// daily trend, the news feed, and the links between promo-site visitors, questions and customer accounts
// (by the IP they came from). Also keeps the seller's notes on each customer.
export class InsightsService {
  constructor(licenseDb, { service, reports, visits, now = () => Date.now() } = {}) {
    this.db = licenseDb.db;
    this.service = service;
    this.reports = reports;
    this.visits = visits;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_notes_user ON admin_notes(user_id);
    `);
  }

  // ---- Notes on a customer: what was said, sent or given ----
  notes(userId) {
    return this.db.prepare('SELECT id, kind, body, created_at FROM admin_notes WHERE user_id = ? ORDER BY id DESC').all(Number(userId))
      .map((r) => ({ id: r.id, kind: r.kind, body: r.body, at: r.created_at }));
  }

  addNote(userId, { kind = 'note', body = '' } = {}) {
    if (!this.service.db.getUserById(Number(userId))) return { ok: false, error: 'NOT_FOUND', message: '고객을 찾을 수 없습니다.' };
    const text = String(body || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
    if (!text) return { ok: false, error: 'EMPTY', message: '메모 내용을 입력해주세요.' };
    const type = NOTE_KINDS.has(kind) ? kind : 'note';
    const result = this.db.prepare('INSERT INTO admin_notes (user_id, kind, body, created_at) VALUES (?, ?, ?, ?)')
      .run(Number(userId), type, text, new Date(this.now()).toISOString());
    return { ok: true, note: { id: Number(result.lastInsertRowid), kind: type, body: text, at: new Date(this.now()).toISOString() } };
  }

  deleteNote(id) {
    const result = this.db.prepare('DELETE FROM admin_notes WHERE id = ?').run(Number(id));
    return Number(result.changes) ? { ok: true } : { ok: false, error: 'NOT_FOUND', message: '없는 메모입니다.' };
  }

  // ---- Who is who: the IPs each account was seen from ----
  ipIndex() {
    const byIp = new Map();
    const byUser = new Map();
    const add = (userId, ip) => {
      const value = cleanIp(ip);
      if (!userId || LOCAL_IP.test(value)) return;
      if (!byIp.has(value)) byIp.set(value, new Set());
      byIp.get(value).add(userId);
      if (!byUser.has(userId)) byUser.set(userId, new Set());
      byUser.get(userId).add(value);
    };
    for (const r of this.db.prepare("SELECT user_id, ip FROM audit_logs WHERE user_id IS NOT NULL AND ip IS NOT NULL AND ip != ''").all()) add(r.user_id, r.ip);
    for (const r of this.db.prepare('SELECT user_id, last_heartbeat_ip AS ip FROM licenses WHERE last_heartbeat_ip IS NOT NULL').all()) add(r.user_id, r.ip);
    for (const r of this.db.prepare('SELECT user_id, ip FROM client_status WHERE ip IS NOT NULL').all()) add(r.user_id, r.ip);
    for (const r of this.db.prepare('SELECT user_id, ip FROM trial_claims WHERE ip IS NOT NULL AND user_id IS NOT NULL').all()) add(r.user_id, r.ip);
    return { byIp, byUser };
  }

  customersByIp(ips, index, users) {
    const ids = new Set();
    for (const ip of ips) for (const id of index.byIp.get(cleanIp(ip)) || []) ids.add(id);
    return [...ids].map((id) => users.get(id)).filter(Boolean).map((u) => ({ id: u.id, email: u.email, owner: u.owner }));
  }

  usersById() {
    const owners = this.reports.ownerIds();
    return new Map(this.service.adminListUsers().users.map((u) => [u.id, { ...u, owner: owners.has(u.id) }]));
  }

  // ---- Promo-site visitors as people, with the account they made (if any) ----
  people() {
    const index = this.ipIndex();
    const users = this.usersById();
    const stage = (p) => {
      if (p.customer) return 'customer';
      if (p.buy) return 'buy';
      if (p.download) return 'download';
      if (p.visits >= 2 || p.seconds >= 90 || p.seen.includes('pricing') || p.video) return 'hot';
      return 'look';
    };
    const people = this.visits.people().map((p) => {
      const matches = this.customersByIp(p.ips, index, users).filter((c) => !c.owner);
      const out = { ...p, customer: matches[0] || null, sessions: p.sessions.slice(-8).reverse() };
      delete out.ips;
      out.ip = p.ips[p.ips.length - 1] || '';
      out.stage = stage(out);
      return out;
    });
    const counts = { all: people.length, customer: 0, buy: 0, download: 0, hot: 0, look: 0 };
    for (const p of people) counts[p.stage] += 1;
    return { ok: true, people: people.slice(0, 400), counts };
  }

  // ---- Extra context for one customer: notes, how they found us, questions from their IP ----
  customerExtras(userId) {
    const id = Number(userId);
    const index = this.ipIndex();
    const ips = index.byUser.get(id) || new Set();
    const origin = ips.size ? this.visits.people({ includeMine: false }).filter((p) => p.ips.some((ip) => ips.has(cleanIp(ip)))).map((p) => ({
      visitor: p.visitor, firstAt: p.firstAt, lastAt: p.lastAt, visits: p.visits, pages: p.pages, download: p.download, buy: p.buy, video: p.video,
      seconds: p.seconds, depth: p.depth, seen: p.seen, from: p.from, campaign: p.campaign, device: p.device, sessions: p.sessions.slice(-8).reverse()
    })) : [];
    const questions = ips.size ? this.db.prepare('SELECT id, nickname, title, body, is_private, answer, answered_at, ip, created_at FROM questions ORDER BY id DESC LIMIT 300').all()
      .filter((q) => ips.has(cleanIp(q.ip)))
      .map((q) => ({ id: q.id, nickname: q.nickname, title: q.title, body: q.body, isPrivate: Boolean(q.is_private), answer: q.answer, answeredAt: q.answered_at, createdAt: q.created_at })) : [];
    return { notes: this.notes(id), origin, questions, ips: [...ips] };
  }

  /** Questions for the admin list, each with the customer account asked from the same IP (if any). */
  withAskers(questions) {
    const index = this.ipIndex();
    const users = this.usersById();
    const rows = new Map(this.db.prepare('SELECT id, ip FROM questions').all().map((r) => [r.id, r.ip]));
    return questions.map((q) => ({ ...q, customer: this.customersByIp([rows.get(q.id)], index, users)[0] || null }));
  }

  // ---- Home page ----
  home({ since = '', latest = '' } = {}) {
    const now = this.now();
    const users = this.usersById();
    const { map } = this.reports.overview();
    const customers = [...users.values()].filter((u) => !u.owner).map((u) => ({ ...u, client: map.get(u.id) || null }));
    const people = this.people().people;
    const ever = new Set(this.db.prepare("SELECT DISTINCT user_id FROM licenses WHERE plan_type != 'free_trial'").all().map((r) => r.user_id));
    const lastExpiry = new Map(this.db.prepare('SELECT user_id, MAX(expires_at) AS e FROM licenses GROUP BY user_id').all().map((r) => [r.user_id, r.e]));
    const ago = (iso) => (iso ? now - Date.parse(iso) : Infinity);
    const todo = [];
    const push = (item) => todo.push(item);
    const who = (u) => ({ view: 'customer', id: u.id });

    for (const u of customers) {
      const c = u.client || {};
      const hoursSinceSignup = ago(u.createdAt) / HOUR_MS;
      const reportedRecently = ago(c.lastReportAt) < 2 * DAY_MS;
      const licensed = u.planType && u.daysLeft > 0;
      if ((c.errors24h || 0) > 0) {
        push({ key: `err-${u.id}-${kstDay(now)}`, level: 'danger', icon: '🚨', title: `오류 ${c.errors24h}건`, detail: `${u.email} · 최근 하루 동안 프로그램에서 오류가 났습니다`, target: who(u), at: c.lastReportAt });
      }
      if (!c.lastReportAt && hoursSinceSignup > 1) {
        const old = u.lastSeenAt && ago(u.lastSeenAt) < 3 * DAY_MS;
        push({ key: `silent-${u.id}`, level: old ? 'info' : 'warn', icon: old ? '📦' : '🔌',
          title: old ? '구버전이라 사용 기록이 안 옴' : '가입했는데 프로그램을 안 켬',
          detail: `${u.email} · ${old ? '업데이트하면 기록이 옵니다' : '설치·실행에서 막혔을 수 있습니다. 안내 메일을 보내 보세요'}`, target: who(u), at: u.createdAt });
      }
      if (c.lastReportAt && reportedRecently && c.naverConnected === false) {
        push({ key: `naver-${u.id}`, level: 'warn', icon: '🔗', title: '네이버 연결 안 함', detail: `${u.email} · 연결해야 자동 작업이 돌아갑니다`, target: who(u), at: c.lastReportAt });
      }
      if (c.lastReportAt && reportedRecently && c.modelMissing) {
        push({ key: `model-${u.id}`, level: 'warn', icon: '🤖', title: 'AI 모델을 안 받음', detail: `${u.email} · 댓글을 쓰려면 모델 다운로드가 필요합니다`, target: who(u), at: c.lastReportAt });
      }
      if (latest && c.appVersion && reportedRecently && verNum(c.appVersion) < verNum(latest)) {
        push({ key: `ver-${u.id}-${latest}`, level: 'info', icon: '⬆️', title: `구버전 ${c.appVersion}`, detail: `${u.email} · 최신은 ${latest}`, target: who(u), at: c.lastReportAt });
      }
      if (u.planType === 'free_trial' && u.daysLeft > 0 && u.daysLeft <= 1) {
        push({ key: `trial-end-${u.id}`, level: 'warn', icon: '⏰', title: '체험이 곧 끝남', detail: `${u.email} · 유료 안내를 보낼 때입니다`, target: who(u), at: u.expiresAt });
      }
      const expiredAgo = ago(lastExpiry.get(u.id));
      if (!licensed && expiredAgo > 0 && expiredAgo < 7 * DAY_MS) {
        push({ key: `expired-${u.id}`, level: 'warn', icon: '🔁', title: ever.has(u.id) ? '이용권 끝나고 연장 안 함' : '체험 끝나고 결제 안 함', detail: `${u.email} · 다시 붙잡을 기회입니다`, target: who(u), at: lastExpiry.get(u.id) });
      }
      if (licensed && c.lastUsedAt && ago(c.lastUsedAt) > 3 * DAY_MS) {
        push({ key: `idle-${u.id}-${kstDay(Date.parse(c.lastUsedAt))}`, level: 'warn', icon: '💤', title: `${Math.floor(ago(c.lastUsedAt) / DAY_MS)}일째 안 씀`, detail: `${u.email} · 이용권은 남아 있습니다`, target: who(u), at: c.lastUsedAt });
      } else if (licensed && (c.activeDaysPrev7 || 0) >= 3 && (c.activeDays7 || 0) <= 1) {
        push({ key: `drop-${u.id}-${kstDay(now)}`, level: 'warn', icon: '📉', title: '사용이 확 줄었음', detail: `${u.email} · 지난주 ${c.activeDaysPrev7}일 → 이번 주 ${c.activeDays7 || 0}일`, target: who(u), at: c.lastUsedAt });
      }
    }
    // Visitors worth chasing
    const recent = people.filter((p) => ago(p.lastAt) < 7 * DAY_MS);
    const bought = recent.filter((p) => p.stage === 'buy');
    if (bought.length) push({ key: `buy-${bought.map((p) => p.visitor).join(',').slice(0, 200)}`, level: 'warn', icon: '💬', title: `카톡 구매 버튼 누른 사람 ${bought.length}명`, detail: '카카오톡 오픈채팅에 문의가 와 있는지 확인하세요', target: { view: 'visitors', filter: 'buy' } });
    const downloaded = recent.filter((p) => p.stage === 'download');
    if (downloaded.length) push({ key: `dl-${downloaded.map((p) => p.visitor).join(',').slice(0, 200)}`, level: 'info', icon: '⬇️', title: `설치 파일 받고 가입 안 한 사람 ${downloaded.length}명`, detail: '설치나 가입에서 막혔을 수 있습니다. 어디서 왔는지 보세요', target: { view: 'visitors', filter: 'download' } });
    todo.sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || (Date.parse(b.at || 0) - Date.parse(a.at || 0)));

    // Funnel: new visitors → downloaded → signed up → really used → paid, over a window
    const funnel = (days) => {
      const from = days ? now - days * DAY_MS : 0;
      const seen = people.filter((p) => Date.parse(p.firstAt) >= from);
      const signups = customers.filter((u) => Date.parse(u.createdAt) >= from);
      return {
        days,
        visitors: seen.length,
        downloads: seen.filter((p) => p.download || p.customer).length,
        signups: signups.length,
        activated: signups.filter((u) => u.client?.firstUsedAt).length,
        paid: signups.filter((u) => ever.has(u.id)).length
      };
    };

    // 30-day trend
    const visitDays = this.visits.daily(30);
    const clientDays = this.reports.daily(31);
    const signupDays = new Map();
    for (const u of customers) {
      const day = kstDay(Date.parse(u.createdAt));
      signupDays.set(day, (signupDays.get(day) || 0) + 1);
    }
    const daily = visitDays.map((d) => ({ ...d, signups: signupDays.get(d.day) || 0, active: clientDays.get(d.day)?.active || 0, errors: clientDays.get(d.day)?.errors || 0 }));
    const today = daily[daily.length - 1];

    const summary = this.service.db.countSummary();
    const kpi = {
      activeNow: customers.filter((u) => ago(u.client?.lastReportAt) < 30 * 60 * 1000).length,
      usedToday: today.active,
      customers: customers.length,
      trialActive: summary.trialActive,
      paidActive: summary.paidActive,
      visitorsToday: today.visitors,
      downloadsToday: today.downloads,
      signupsToday: today.signups,
      week: daily.slice(-7).reduce((a, d) => ({ visitors: a.visitors + d.visitors, downloads: a.downloads + d.downloads, signups: a.signups + d.signups }), { visitors: 0, downloads: 0, signups: 0 }),
      unansweredQuestions: summary.unansweredQuestions,
      waitingInquiries: Number(this.db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'waiting'").get().n),
      unusedVouchers: summary.unusedVouchers
    };

    // News feed
    const news = [];
    const email = (id) => users.get(id)?.email || `#${id}`;
    const isCustomer = (id) => users.has(id) && !users.get(id).owner;
    for (const u of customers) news.push({ at: u.createdAt, icon: '🆕', kind: 'signup', text: `${u.email} 가입`, target: who(u) });
    const AUDIT = { PURCHASE_APPLIED: '💳 결제 반영', ACTIVATE_KEY: '🎟️ 이용권 키 등록', ADMIN_EXTEND: '➕ 기간 연장', RESET_DEVICE: '🖥️ PC 변경', ADMIN_RESET_DEVICE: '🖥️ PC 초기화', LOGIN_REJECTED_HWID: '⛔ 다른 PC 로그인 막힘' };
    for (const a of this.db.prepare(`SELECT user_id, action, details, created_at FROM audit_logs WHERE action IN (${Object.keys(AUDIT).map(() => '?').join(',')}) ORDER BY id DESC LIMIT 60`).all(...Object.keys(AUDIT))) {
      if (!isCustomer(a.user_id)) continue;
      const [icon, ...label] = AUDIT[a.action].split(' ');
      news.push({ at: a.created_at, icon, kind: 'account', text: `${email(a.user_id)} ${label.join(' ')}${a.action === 'ADMIN_EXTEND' && a.details ? ` (${a.details.replace('d', '일')})` : ''}`, target: { view: 'customer', id: a.user_id } });
    }
    for (const p of people) {
      for (const s of p.sessions) {
        if (!s.download && !s.buy) continue;
        const from = s.from?.label || '직접 접속';
        news.push({ at: s.startedAt, icon: s.buy ? '💬' : '⬇️', kind: 'visitor', text: `방문자가 ${s.buy ? '카톡 구매 버튼을 누름' : '설치 파일을 받음'} · ${from}${p.customer ? ` → ${p.customer.email}` : ''}`, target: { view: 'visitors', visitor: p.visitor } });
      }
    }
    for (const e of this.reports.recentNotable(40)) {
      if (!isCustomer(e.userId)) continue;
      if (e.type === 'app_start') news.push({ at: e.at, icon: '▶️', kind: 'app', text: `${email(e.userId)} 프로그램 켬${e.data?.version ? ` · ${e.data.version}` : ''}`, target: { view: 'customer', id: e.userId } });
      else news.push({ at: e.at, icon: '🚨', kind: 'error', text: `${email(e.userId)} 오류: ${String(e.data?.error || e.data?.message || e.name || '').split('\n')[0].slice(0, 120)}`, target: { view: 'customer', id: e.userId } });
    }
    news.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    // Since the seller last looked
    let fresh = null;
    if (since && Number.isFinite(Date.parse(since))) {
      const sinceIso = new Date(Date.parse(since)).toISOString();
      fresh = {
        since: sinceIso,
        signups: customers.filter((u) => u.createdAt > sinceIso).length,
        questions: Number(this.db.prepare('SELECT COUNT(*) AS n FROM questions WHERE created_at > ?').get(sinceIso).n),
        errors: this.reports.errorsSince(sinceIso),
        ...this.visits.countSince(sinceIso)
      };
    }

    return {
      ok: true,
      at: new Date(now).toISOString(),
      kpi,
      todo,
      funnel: { week: funnel(7), month: funnel(30), all: funnel(0) },
      daily,
      versions: this.reports.versions(),
      news: news.slice(0, 60),
      fresh
    };
  }
}
