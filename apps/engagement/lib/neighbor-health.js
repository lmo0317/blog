// 이웃 건강도: tells active, genuine bloggers apart from dormant or ad accounts, so the app only
// spends requests and comments on people who will engage back, and can prune dead neighbors.
//
// Two sources of activity:
// - My neighbor list (BuddyListManage.naver) already shows each neighbor's 최근 글 date, so my own
//   neighbors are graded from the list alone.
// - Anyone else (request targets, received requests, commenters) is graded from their public RSS.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchLatestPostsFromRss } from './blog-targets.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const HEALTH_DEFAULTS = Object.freeze({ activeDays: 14, dormantDays: 60 });
export const PRUNE_DAILY_LIMIT = 30;
const AD_PATTERN = /(체험단|협찬|원고료|제공받아|광고|대출|보험|부업|재테크|수익\s*인증|카지노|토토|구매대행|무료\s*나눔\s*이벤트|쿠팡\s*파트너스)/;

export const GRADE_LABELS = Object.freeze({
  active: '🟢 활성',
  slow: '🟡 활동 뜸',
  dormant: '🔴 휴면',
  spam: '🔴 광고성',
  unknown: '⚪ 판단 불가'
});

/** "26.10.09." / "2026.10.09" → Date (local midnight); time-only values such as "13:20" mean today. */
export function parseNaverDate(value, now = new Date()) {
  const text = String(value || '').trim();
  const full = text.match(/^(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/);
  if (full) {
    let year = Number(full[1]);
    if (year < 100) year += 2000;
    return new Date(year, Number(full[2]) - 1, Number(full[3]));
  }
  if (/^\d{1,2}:\d{2}$/.test(text) || /(분|시간)\s*전$/.test(text)) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return null;
}

export function daysSince(date, now = new Date()) {
  if (!date) return Infinity;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

export function gradeByLastPost(lastPostDate, { now = new Date(), activeDays = HEALTH_DEFAULTS.activeDays, dormantDays = HEALTH_DEFAULTS.dormantDays } = {}) {
  if (!lastPostDate) return 'dormant';
  const days = daysSince(lastPostDate, now);
  if (days <= activeDays) return 'active';
  if (days < dormantDays) return 'slow';
  return 'dormant';
}

/** Grades a blog from its recent RSS posts: activity by the newest post, plus ad/bot signals. */
export function assessPosts(posts, options = {}) {
  const now = options.now || new Date();
  if (!posts?.length) return { grade: 'unknown', reason: '공개된 최근 글이 없습니다.', postCount: 0 };
  const dated = posts.map((post) => ({ ...post, date: post.postdate ? new Date(post.postdate) : null })).filter((post) => post.date && !Number.isNaN(post.date.getTime()));
  const newest = dated.reduce((latest, post) => (!latest || post.date > latest ? post.date : latest), null);
  const recent = dated.filter((post) => daysSince(post.date, now) <= 30);
  const adCount = posts.filter((post) => AD_PATTERN.test(`${post.title || ''} ${post.description || ''}`)).length;
  const perDay = new Map();
  for (const post of dated) {
    const key = post.date.toISOString().slice(0, 10);
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }
  const maxPerDay = Math.max(0, ...perDay.values());
  const adRatio = adCount / posts.length;
  const base = { postCount: posts.length, recentCount: recent.length, adRatio: Number(adRatio.toFixed(2)), maxPerDay, lastPostAt: newest ? newest.toISOString() : '' };

  if (posts.length >= 4 && adRatio >= 0.5) return { ...base, grade: 'spam', reason: `최근 글의 ${Math.round(adRatio * 100)}%가 광고·협찬성 글입니다.` };
  if (maxPerDay >= 10) return { ...base, grade: 'spam', reason: `하루에 글 ${maxPerDay}개를 올린 자동 포스팅 의심 블로그입니다.` };
  const grade = gradeByLastPost(newest, { ...options, now });
  const days = daysSince(newest, now);
  const reason = grade === 'active' ? `최근 ${days}일 전 새 글 · 30일 동안 ${recent.length}개`
    : grade === 'slow' ? `마지막 글이 ${days}일 전입니다.`
      : `마지막 글이 ${Number.isFinite(days) ? `${days}일 전` : '확인되지 않음'}입니다.`;
  return { ...base, grade, reason };
}

/** Caches RSS-based assessments for a few days so the same blog is not fetched again and again. */
export class BlogActivityCache {
  constructor(filePath = '', { ttlDays = 3, fetchLatest = (blogId) => fetchLatestPostsFromRss(blogId, { limit: 30 }) } = {}) {
    this.filePath = filePath;
    this.ttlMs = ttlDays * DAY_MS;
    this.fetchLatest = fetchLatest;
    this.entries = {};
    if (filePath && existsSync(filePath)) {
      try { this.entries = JSON.parse(readFileSync(filePath, 'utf8')).entries || {}; } catch { this.entries = {}; }
    }
  }

  save() {
    if (!this.filePath) return;
    try {
      const cutoff = Date.now() - this.ttlMs;
      for (const [key, entry] of Object.entries(this.entries)) if (new Date(entry.checkedAt).getTime() < cutoff) delete this.entries[key];
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify({ entries: this.entries }), 'utf8');
    } catch {}
  }

  async assess(blogId, options = {}) {
    const key = String(blogId || '').toLowerCase();
    if (!key) return { grade: 'unknown', reason: '블로그 ID가 없습니다.' };
    const cached = this.entries[key];
    if (cached && Date.now() - new Date(cached.checkedAt).getTime() < this.ttlMs) return cached;
    const posts = await this.fetchLatest(blogId).catch(() => []);
    const result = { ...assessPosts(posts, options), blogId, checkedAt: new Date().toISOString() };
    this.entries[key] = result;
    this.save();
    return result;
  }
}

// ---------------------------------------------------------------------------
// My neighbor list (admin.blog.naver.com/BuddyListManage.naver)
// ---------------------------------------------------------------------------
const stripTags = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Rows: checkbox(buddyBlogNo) · group · 서로이웃/이웃 · nickname|blog link · 새글소식 · 최근 글 · 이웃추가일 */
export function parseBuddyListHtml(html) {
  const rows = [];
  for (const tr of String(html || '').match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const no = tr.match(/name=["']buddyBlogNo["'][^>]*value=["'](\d+)["']/i)?.[1] || tr.match(/value=["'](\d+)["'][^>]*name=["']buddyBlogNo["']/i)?.[1];
    if (!no) continue;
    const cells = tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    const typeCell = tr.match(/<td class=["']type["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || '';
    const relation = /class=["']both["']/.test(typeCell) ? 'mutual' : /rss/i.test(typeCell) ? 'rss' : 'oneway';
    const href = tr.match(/<td class=["']buddy["'][\s\S]*?href=["']([^"']+)["']/i)?.[1] || '';
    let blogId = '';
    try { blogId = new URL(href).searchParams.get('blogId') || new URL(href).pathname.split('/').filter(Boolean)[0] || ''; } catch {}
    const nickname = stripTags(tr.match(/class=["']nickname["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || blogId;
    const tail = cells.slice(-2).map(stripTags);
    rows.push({
      buddyBlogNo: no,
      group: stripTags(tr.match(/<td class=["']groupwrap["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || ''),
      relation,
      blogId,
      nickname,
      lastPostText: tail[0] || '',
      addedText: tail[1] || ''
    });
  }
  return rows;
}

export const RELATION_LABELS = Object.freeze({ all: '전체', mutual: '서로이웃', oneway: '일방 이웃' });
export const ACTIVE_DAY_OPTIONS = Object.freeze([7, 14, 30, 60, 90]);

/** Cleans the user's 비활성 이웃 기준: no new post for more than `activeDays` days. */
export function normalizeCriteria(input = {}) {
  const activeDays = Math.max(1, Math.min(Math.round(Number(input.activeDays) || 60), 365));
  const relation = input.relation === 'mutual' ? 'mutual' : 'all';
  const graceDays = Math.max(0, Math.min(Math.round(Number(input.graceDays ?? 14) || 0), 365));
  return { criteria: { activeDays, relation, graceDays, commentersActive: input.commentersActive !== false } };
}

export function describeCriteria(criteria) {
  return [
    `${criteria.activeDays}일 넘게 새 글 없음`,
    criteria.relation === 'mutual' ? '서로이웃 아닌 이웃 포함' : ''
  ].filter(Boolean).join(' · ');
}

/**
 * Sorts my neighbors into 활성 (posted within the period, or talked with me), 비활성 and
 * 지켜보는 중 (added too recently to judge). Each neighbor carries the reason for its group.
 */
export function classifyNeighbors(rows, criteria, { now = new Date(), protectedIds = new Set() } = {}) {
  const active = [];
  const inactive = [];
  let watching = 0;
  let commenters = 0;
  for (const row of rows) {
    if (row.relation === 'rss') continue;
    const lastPost = parseNaverDate(row.lastPostText, now);
    const lastPostDays = daysSince(lastPost, now);
    const addedDays = daysSince(parseNaverDate(row.addedText, now), now);
    const item = {
      ...row,
      lastPostDays: Number.isFinite(lastPostDays) ? lastPostDays : null,
      addedDays: Number.isFinite(addedDays) ? addedDays : null
    };
    const relationOk = criteria.relation !== 'mutual' || row.relation === 'mutual';
    const postedRecently = lastPostDays <= criteria.activeDays;
    if (criteria.commentersActive && protectedIds.has(String(row.blogId).toLowerCase())) {
      commenters += 1;
      active.push({ ...item, reason: '내 글에 댓글' });
    } else if (relationOk && postedRecently) {
      active.push({ ...item, reason: lastPostDays === 0 ? '오늘 새 글' : `${lastPostDays}일 전 새 글` });
    } else if (criteria.graceDays && addedDays < criteria.graceDays) {
      watching += 1;
    } else {
      const reasons = [];
      if (!postedRecently) reasons.push(lastPost ? `${lastPostDays}일 동안 새 글 없음` : '최근 글 없음');
      if (!relationOk) reasons.push('서로이웃 아님');
      inactive.push({ ...item, reason: reasons.join(' · ') });
    }
  }
  // Most recent writers first; longest silence first.
  active.sort((a, b) => (a.lastPostDays ?? 99999) - (b.lastPostDays ?? 99999));
  inactive.sort((a, b) => (b.lastPostDays ?? 99999) - (a.lastPostDays ?? 99999));
  return { active, inactive, watching, commenters };
}

export async function fetchBuddyListPage(page, blogId, pageNo = 1) {
  await page.goto(`https://admin.blog.naver.com/BuddyListManage.naver?blogId=${encodeURIComponent(blogId)}&currentPage=${pageNo}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(900);
  if (/nidlogin/.test(page.url())) throw new Error('네이버 로그인이 필요합니다.');
  const rows = parseBuddyListHtml(await page.content()).map((row) => ({ ...row, sourcePage: pageNo }));
  const maxPage = await page.evaluate(() => {
    const numbers = [...document.querySelectorAll('.paginate a, .paginate strong')]
      .map((el) => Number((el.getAttribute('href') || '').match(/goPage\((\d+)\)/)?.[1] || el.textContent.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return numbers.length ? Math.max(...numbers) : 1;
  }).catch(() => pageNo);
  return { rows, maxPage };
}

/** Highest page number the list's pager links to (it shows about ten pages at a time). */
export function parseMaxPage(html, fallback = 1) {
  const numbers = [...String(html).matchAll(/(?:goPage\(|currentPage=)(\d+)/g)].map((m) => Number(m[1]));
  return numbers.length ? Math.max(fallback, ...numbers) : fallback;
}

const buddyListUrl = (blogId, pageNo) => `https://admin.blog.naver.com/BuddyListManage.naver?blogId=${encodeURIComponent(blogId)}&currentPage=${pageNo}`;

/** Fetches one list page as HTML over the logged-in session, without rendering it in a tab. */
async function requestBuddyListPage(context, blogId, pageNo) {
  const response = await context.request.get(buddyListUrl(blogId, pageNo), {
    timeout: 15000,
    headers: { Referer: 'https://admin.blog.naver.com/' }
  });
  if (/nidlogin/.test(response.url())) throw new Error('네이버 로그인이 필요합니다.');
  if (!response.ok()) throw new Error(`이웃 목록 ${pageNo}페이지를 읽지 못했습니다. (${response.status()})`);
  const charset = (response.headers()['content-type'] || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8';
  const html = new TextDecoder(charset).decode(await response.body());
  return { rows: parseBuddyListHtml(html).map((row) => ({ ...row, sourcePage: pageNo })), maxPage: parseMaxPage(html, pageNo) };
}

/** Page-by-page in a tab; the fallback when direct requests do not return the list. */
async function fetchAllBuddiesInTab(page, blogId, { maxPages, onPage, shouldStop }) {
  const rows = [];
  let pageNo = 1;
  let lastPage = 1;
  while (pageNo <= lastPage && pageNo <= maxPages && !shouldStop()) {
    const data = await fetchBuddyListPage(page, blogId, pageNo);
    if (!data.rows.length) break;
    rows.push(...data.rows);
    lastPage = Math.max(lastPage, data.maxPage);
    onPage(pageNo, lastPage, rows.length);
    pageNo += 1;
    await page.waitForTimeout(600 + Math.floor(Math.random() * 700));
  }
  return rows;
}

/**
 * Reads my whole neighbor list. Pages are fetched as plain HTML a few at a time, which takes seconds
 * instead of the minute a rendered tab needs for 1,000 neighbors.
 */
export async function fetchAllBuddies(page, blogId, { maxPages = 120, concurrency = 3, pauseMs = () => 150 + Math.floor(Math.random() * 250), onPage = () => {}, shouldStop = () => false } = {}) {
  const context = typeof page.context === 'function' ? page.context() : null;
  let first = null;
  if (context?.request) {
    try {
      first = await requestBuddyListPage(context, blogId, 1);
    } catch (error) {
      if (/로그인/.test(error.message)) throw error;
      first = null;
    }
  }
  if (!first?.rows.length) return fetchAllBuddiesInTab(page, blogId, { maxPages, onPage, shouldStop });

  const byPage = new Map([[1, first.rows]]);
  let lastPage = Math.min(maxPages, first.maxPage);
  let next = 2;
  let ended = false;
  let count = first.rows.length;
  onPage(1, lastPage, count);
  const worker = async () => {
    while (!ended && !shouldStop() && next <= lastPage) {
      const pageNo = next++;
      await new Promise((resolve) => setTimeout(resolve, pauseMs()));
      const data = await requestBuddyListPage(context, blogId, pageNo);
      if (!data.rows.length) { ended = true; break; }
      byPage.set(pageNo, data.rows);
      count += data.rows.length;
      // The pager only links ahead about ten pages, so the end moves as later pages arrive.
      lastPage = Math.min(maxPages, Math.max(lastPage, data.maxPage));
      onPage(byPage.size, lastPage, count);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return [...byPage.keys()].sort((a, b) => a - b).flatMap((no) => byPage.get(no));
}

/**
 * Deletes the given neighbors from one list page through Naver's own 삭제 → "이웃과 서로이웃을 모두
 * 삭제합니다" → 확인 flow, then reloads the page to confirm they are gone.
 */
export async function deleteBuddiesOnPage(page, blogId, pageNo, buddyBlogNos) {
  await fetchBuddyListPage(page, blogId, pageNo);
  const present = [];
  for (const no of buddyBlogNos) {
    const box = page.locator(`input[name="buddyBlogNo"][value="${no}"]`).first();
    if (!await box.count()) continue;
    await box.check({ force: true });
    present.push(no);
  }
  if (!present.length) return { deleted: [], missing: buddyBlogNos };

  const dialogs = [];
  const onDialog = async (dialog) => { dialogs.push(dialog.message()); await dialog.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    await page.locator('button.btn_del').first().click();
    await page.waitForTimeout(700);
    const deleteAll = page.locator('#delete_all');
    if (await deleteAll.count()) await deleteAll.check({ force: true }).catch(() => {});
    const confirm = page.locator('input[onclick*="oEventForm.submit(\'del\')"]').first();
    if (!await confirm.count()) throw new Error('이웃 삭제 확인 버튼을 찾지 못했습니다.');
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
      confirm.click()
    ]);
    await page.waitForTimeout(1500);
  } finally {
    page.off('dialog', onDialog);
  }

  // Verify: the deleted rows are no longer on that page (or the one before it, after a shift).
  const after = new Set();
  for (const candidatePage of [pageNo, Math.max(1, pageNo - 1)]) {
    const { rows } = await fetchBuddyListPage(page, blogId, candidatePage);
    rows.forEach((row) => after.add(row.buddyBlogNo));
  }
  const deleted = present.filter((no) => !after.has(no));
  const notDeleted = present.filter((no) => after.has(no));
  return { deleted, missing: buddyBlogNos.filter((no) => !present.includes(no)), notDeleted, dialogs };
}

// ---------------------------------------------------------------------------
// Manager: query my neighbors by the user's conditions, then delete only the ones they pick
// ---------------------------------------------------------------------------
const LIST_CACHE_MS = 30 * 60 * 1000;

export class NeighborHealthManager {
  constructor({ browserSession, statePath = '', getProtectedIds = async () => new Set() }) {
    this.browserSession = browserSession;
    this.statePath = statePath;
    this.getProtectedIds = getProtectedIds;
    this.state = 'idle';
    this.shouldStop = false;
    this.logs = [];
    this.progress = { phase: '', done: 0, total: 0 };
    this.list = null; // { fetchedAt, rows } — my neighbor list, read on demand
    this.result = null; // { queryId, criteria, description, inactive, activeCount, inactiveCount, watchingCount, total }
    this.queryCount = 0;
    this.pruneLog = {}; // { 'YYYY-MM-DD': count }
    this.load();
  }

  load() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try { this.pruneLog = JSON.parse(readFileSync(this.statePath, 'utf8')).pruneLog || {}; } catch {}
  }

  save() {
    if (!this.statePath) return;
    try {
      mkdirSync(path.dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify({ pruneLog: this.pruneLog }), 'utf8');
    } catch {}
  }

  log(message, type = 'info') {
    this.logs.unshift({ time: new Date().toLocaleTimeString('ko-KR', { hour12: false }), type, message });
    if (this.logs.length > 200) this.logs.length = 200;
    console.log(`[NeighborHealth] ${message}`);
  }

  todayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }

  prunedToday() {
    return Number(this.pruneLog[this.todayKey()]) || 0;
  }

  listAgeMinutes() {
    return this.list ? Math.floor((Date.now() - this.list.fetchedAt) / 60000) : null;
  }

  getStatus() {
    return {
      state: this.state,
      progress: this.progress,
      logs: this.logs.slice(0, 60),
      listAgeMinutes: this.listAgeMinutes(),
      listSize: this.list?.rows.length ?? null,
      result: this.result,
      prunedToday: this.prunedToday(),
      dailyLimit: PRUNE_DAILY_LIMIT
    };
  }

  stop() {
    if (this.state === 'running') {
      this.shouldStop = true;
      this.log('⏹️ 작업을 멈춥니다.', 'warn');
    }
  }

  async readList(page) {
    const blogId = await this.browserSession.resolveMyBlogId(page);
    this.log('📖 내 이웃 목록을 읽고 있습니다...', 'info');
    const startedAt = Date.now();
    const rows = await fetchAllBuddies(page, blogId, {
      shouldStop: () => this.shouldStop,
      onPage: (done, total, count) => { this.progress = { phase: 'read', done, total, count }; }
    });
    this.list = { fetchedAt: Date.now(), rows };
    this.log(`📖 이웃 ${rows.length}명의 목록을 읽었습니다. (${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}초)`, 'info');
    return rows;
  }

  /**
   * Sorts my neighbors into active and inactive by `input`. Re-reads my neighbor list only when it is
   * older than 30 minutes or `refresh` is set, so changing the 기준 and sorting again is instant.
   */
  async query(input = {}, { refresh = false } = {}) {
    if (this.state === 'running') throw new Error('이웃 조회·정리 작업이 이미 진행 중입니다.');
    const { criteria } = normalizeCriteria(input);
    const connected = Boolean(this.browserSession?.connected);
    if (!connected && (!this.list || refresh)) throw new Error('네이버 계정이 연결되어 있지 않아 이웃 목록을 읽을 수 없습니다.');
    // Without a session an older list is still better than nothing.
    const needsRead = connected && (refresh || !this.list || Date.now() - this.list.fetchedAt > LIST_CACHE_MS);

    this.state = 'running';
    this.shouldStop = false;
    this.progress = { phase: needsRead ? 'read' : 'filter', done: 0, total: 0 };
    let page = null;
    try {
      if (needsRead) {
        page = await this.browserSession.context.newPage();
        await this.readList(page);
      }
      const protectedIds = criteria.commentersActive ? await this.getProtectedIds().catch(() => new Set()) : new Set();
      const { active, inactive, watching, commenters } = classifyNeighbors(this.list.rows, criteria, { protectedIds });
      this.queryCount += 1;
      this.result = {
        queryId: this.queryCount,
        criteria,
        description: describeCriteria(criteria),
        inactive: inactive.slice(0, 1500),
        activeCount: active.length,
        inactiveCount: inactive.length,
        watchingCount: watching,
        commenterCount: commenters,
        total: this.list.rows.length,
        queriedAt: new Date().toISOString()
      };
      this.log(`🔎 비활성 이웃 ${inactive.length}명을 찾았습니다. (${this.result.description}) 활성 이웃 ${active.length}명${watching ? `, 새로 추가한 ${watching}명` : ''}은 그대로 둡니다.`, 'success');
      this.state = this.shouldStop ? 'stopped' : 'completed';
      return this.getStatus();
    } catch (err) {
      this.state = 'error';
      this.log(`❌ 이웃 조회 실패: ${err.message}`, 'error');
      throw err;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /** Deletes the picked inactive neighbors from the latest result, at most the daily remainder. */
  async prune(buddyBlogNos = [], { queryId = null, maxCount = PRUNE_DAILY_LIMIT } = {}) {
    if (this.state === 'running') throw new Error('이웃 조회·정리 작업이 이미 진행 중입니다.');
    if (!this.browserSession?.connected) throw new Error('네이버 계정이 연결되어 있지 않습니다.');
    if (!this.result) throw new Error('먼저 조건을 넣고 조회해주세요.');
    if (queryId !== null && Number(queryId) !== this.result.queryId) throw new Error('조회 결과가 바뀌었습니다. 다시 조회한 뒤 정리해주세요.');
    const remaining = Math.max(0, Math.min(PRUNE_DAILY_LIMIT, maxCount) - this.prunedToday());
    if (!remaining) throw new Error(`오늘 정리 한도(${PRUNE_DAILY_LIMIT}명)를 모두 사용했습니다. 내일 다시 진행해주세요.`);
    const wanted = new Set(buddyBlogNos.map(String));
    const targets = this.result.inactive.filter((n) => wanted.has(String(n.buddyBlogNo))).slice(0, remaining);
    if (!targets.length) throw new Error('정리할 비활성 이웃을 선택해주세요.');

    this.state = 'running';
    this.shouldStop = false;
    this.progress = { phase: 'prune', done: 0, total: targets.length };
    this.log(`🧹 비활성 이웃 ${targets.length}명을 정리합니다. (오늘 남은 한도 ${remaining}명)`, 'info');
    const page = await this.browserSession.context.newPage();
    const deletedNos = new Set();
    try {
      const blogId = await this.browserSession.resolveMyBlogId(page);
      // Last page first: deleting on a later page never shifts the rows of earlier pages.
      const byPage = new Map();
      for (const target of targets) byPage.set(target.sourcePage, [...(byPage.get(target.sourcePage) || []), target]);
      for (const pageNo of [...byPage.keys()].sort((a, b) => b - a)) {
        if (this.shouldStop) break;
        const group = byPage.get(pageNo);
        const result = await deleteBuddiesOnPage(page, blogId, pageNo, group.map((n) => n.buddyBlogNo));
        // Neighbors added since the list was read push rows to later pages; look one page further once.
        if (result.missing.length) {
          const retry = await deleteBuddiesOnPage(page, blogId, pageNo + 1, result.missing);
          result.deleted.push(...retry.deleted);
        }
        result.deleted.forEach((no) => deletedNos.add(no));
        for (const n of group) {
          if (result.deleted.includes(n.buddyBlogNo)) this.log(`🧹 @${n.blogId} (${n.nickname}) 정리 · ${n.reason}`, 'success');
          else this.log(`⚠️ @${n.blogId} 정리를 확인하지 못했습니다.`, 'warn');
        }
        this.progress = { phase: 'prune', done: deletedNos.size, total: targets.length };
        this.pruneLog[this.todayKey()] = this.prunedToday() + result.deleted.length;
        this.save();
        await page.waitForTimeout(2500 + Math.floor(Math.random() * 2500));
      }
      // Deleting changes pages, so the cached list is no longer trustworthy.
      this.list = null;
      this.result = { ...this.result, inactive: this.result.inactive.filter((n) => !deletedNos.has(n.buddyBlogNo)) };
      this.result.inactiveCount = Math.max(0, this.result.inactiveCount - deletedNos.size);
      this.result.total = Math.max(0, this.result.total - deletedNos.size);
      this.log(`✅ 비활성 이웃 ${deletedNos.size}명을 정리했습니다.`, 'success');
      this.state = this.shouldStop ? 'stopped' : 'completed';
      return { ...this.getStatus(), deleted: deletedNos.size };
    } catch (error) {
      this.state = 'error';
      this.log(`❌ 이웃 정리 중 오류: ${error.message}`, 'error');
      throw error;
    } finally {
      await page.close().catch(() => {});
    }
  }
}
