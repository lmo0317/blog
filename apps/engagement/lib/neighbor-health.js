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

/** Grades my neighbors and picks prune candidates, keeping anyone who talks with me. */
export function gradeNeighbors(rows, {
  now = new Date(),
  activeDays = HEALTH_DEFAULTS.activeDays,
  dormantDays = HEALTH_DEFAULTS.dormantDays,
  includeOneway = false,
  onewayMinDays = 30,
  protectedIds = new Set(),
  newNeighborGraceDays = 14
} = {}) {
  return rows.map((row) => {
    const lastPost = parseNaverDate(row.lastPostText, now);
    const added = parseNaverDate(row.addedText, now);
    const grade = gradeByLastPost(lastPost, { now, activeDays, dormantDays });
    const addedDays = daysSince(added, now);
    const isProtected = protectedIds.has(String(row.blogId).toLowerCase());
    let pruneReason = '';
    if (row.relation !== 'rss' && !isProtected && addedDays >= newNeighborGraceDays) {
      if (grade === 'dormant') pruneReason = lastPost ? `${daysSince(lastPost, now)}일 동안 새 글 없음` : '최근 글 없음';
      else if (includeOneway && row.relation === 'oneway' && addedDays >= onewayMinDays) pruneReason = `서로이웃 아님 (${addedDays}일 경과)`;
    }
    return {
      ...row,
      grade,
      lastPostDays: Number.isFinite(daysSince(lastPost, now)) ? daysSince(lastPost, now) : null,
      addedDays: Number.isFinite(addedDays) ? addedDays : null,
      protected: isProtected,
      pruneCandidate: Boolean(pruneReason),
      pruneReason
    };
  });
}

export function summarizeNeighbors(graded) {
  const count = (fn) => graded.filter(fn).length;
  return {
    total: graded.length,
    active: count((n) => n.grade === 'active'),
    slow: count((n) => n.grade === 'slow'),
    dormant: count((n) => n.grade === 'dormant'),
    mutual: count((n) => n.relation === 'mutual'),
    oneway: count((n) => n.relation === 'oneway'),
    protected: count((n) => n.protected),
    candidates: count((n) => n.pruneCandidate)
  };
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

export async function fetchAllBuddies(page, blogId, { maxPages = 120, onPage = () => {}, shouldStop = () => false } = {}) {
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
// Manager: scan (read-only) and prune (only the IDs the user confirmed, capped per day)
// ---------------------------------------------------------------------------
export class NeighborHealthManager {
  constructor({ browserSession, statePath = '', getProtectedIds = async () => new Set() }) {
    this.browserSession = browserSession;
    this.statePath = statePath;
    this.getProtectedIds = getProtectedIds;
    this.state = 'idle';
    this.shouldStop = false;
    this.logs = [];
    this.progress = { phase: '', done: 0, total: 0 };
    this.scan = null; // { scannedAt, options, summary, neighbors }
    this.pruneLog = {}; // { 'YYYY-MM-DD': count }
    this.load();
  }

  load() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8'));
      this.scan = saved.scan || null;
      this.pruneLog = saved.pruneLog || {};
    } catch {}
  }

  save() {
    if (!this.statePath) return;
    try {
      mkdirSync(path.dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify({ scan: this.scan, pruneLog: this.pruneLog }), 'utf8');
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

  getStatus({ includeNeighbors = false } = {}) {
    const neighbors = this.scan?.neighbors || [];
    return {
      state: this.state,
      progress: this.progress,
      logs: this.logs.slice(0, 60),
      scannedAt: this.scan?.scannedAt || null,
      options: this.scan?.options || null,
      summary: this.scan?.summary || null,
      prunedToday: this.prunedToday(),
      dailyLimit: PRUNE_DAILY_LIMIT,
      candidates: neighbors.filter((n) => n.pruneCandidate).slice(0, 500),
      neighbors: includeNeighbors ? neighbors : undefined
    };
  }

  stop() {
    if (this.state === 'running') {
      this.shouldStop = true;
      this.log('⏹️ 이웃 건강도 작업을 멈춥니다.', 'warn');
    }
  }

  async runScan(options = {}) {
    if (this.state === 'running') throw new Error('이웃 건강도 작업이 이미 진행 중입니다.');
    if (!this.browserSession?.connected) throw new Error('네이버 계정이 연결되어 있지 않습니다.');
    this.state = 'running';
    this.shouldStop = false;
    this.progress = { phase: 'scan', done: 0, total: 0 };
    const cleanOptions = {
      activeDays: Math.min(Math.max(Number(options.activeDays) || HEALTH_DEFAULTS.activeDays, 3), 60),
      dormantDays: Math.min(Math.max(Number(options.dormantDays) || HEALTH_DEFAULTS.dormantDays, 30), 365),
      includeOneway: options.includeOneway === true
    };
    this.log(`🔍 내 이웃 목록을 읽고 활동 상태를 분석합니다. (활성 ${cleanOptions.activeDays}일 · 휴면 ${cleanOptions.dormantDays}일 기준)`, 'info');
    const page = await this.browserSession.context.newPage();
    try {
      const blogId = await this.browserSession.resolveMyBlogId(page);
      const rows = await fetchAllBuddies(page, blogId, {
        shouldStop: () => this.shouldStop,
        onPage: (done, total, count) => { this.progress = { phase: 'scan', done, total, count }; }
      });
      const protectedIds = await this.getProtectedIds().catch(() => new Set());
      const neighbors = gradeNeighbors(rows, { ...cleanOptions, protectedIds });
      const summary = summarizeNeighbors(neighbors);
      this.scan = { scannedAt: new Date().toISOString(), options: cleanOptions, summary, neighbors };
      this.save();
      this.log(`✅ 이웃 ${summary.total}명 분석 완료 · 활성 ${summary.active} · 뜸 ${summary.slow} · 휴면 ${summary.dormant} · 정리 후보 ${summary.candidates}명 (소통 이웃 ${summary.protected}명 보호)`, 'success');
      this.state = this.shouldStop ? 'stopped' : 'completed';
      return this.getStatus();
    } catch (error) {
      this.state = 'error';
      this.log(`❌ 이웃 분석 실패: ${error.message}`, 'error');
      throw error;
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Deletes only scanned prune candidates among `buddyBlogNos`, at most the daily remainder. */
  async prune(buddyBlogNos = [], { maxCount = PRUNE_DAILY_LIMIT } = {}) {
    if (this.state === 'running') throw new Error('이웃 건강도 작업이 이미 진행 중입니다.');
    if (!this.browserSession?.connected) throw new Error('네이버 계정이 연결되어 있지 않습니다.');
    if (!this.scan?.neighbors?.length) throw new Error('먼저 이웃 상태 분석을 실행해주세요.');
    const remaining = Math.max(0, Math.min(PRUNE_DAILY_LIMIT, maxCount) - this.prunedToday());
    if (!remaining) throw new Error(`오늘 정리 한도(${PRUNE_DAILY_LIMIT}명)를 모두 사용했습니다. 내일 다시 진행해주세요.`);
    const wanted = new Set(buddyBlogNos.map(String));
    const targets = this.scan.neighbors.filter((n) => n.pruneCandidate && !n.protected && wanted.has(String(n.buddyBlogNo))).slice(0, remaining);
    if (!targets.length) throw new Error('정리할 이웃을 선택해주세요.');

    this.state = 'running';
    this.shouldStop = false;
    this.progress = { phase: 'prune', done: 0, total: targets.length };
    this.log(`🧹 이웃 ${targets.length}명을 정리합니다. (오늘 남은 한도 ${remaining}명)`, 'info');
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
        // Neighbors added since the scan push rows to later pages; look one page further once.
        if (result.missing.length) {
          const retry = await deleteBuddiesOnPage(page, blogId, pageNo + 1, result.missing);
          result.deleted.push(...retry.deleted);
        }
        result.deleted.forEach((no) => deletedNos.add(no));
        for (const n of group) {
          if (result.deleted.includes(n.buddyBlogNo)) this.log(`🧹 @${n.blogId} (${n.nickname}) 정리 · ${n.pruneReason}`, 'success');
          else this.log(`⚠️ @${n.blogId} 정리를 확인하지 못했습니다.`, 'warn');
        }
        this.progress = { phase: 'prune', done: deletedNos.size, total: targets.length };
        this.pruneLog[this.todayKey()] = this.prunedToday() + result.deleted.length;
        this.save();
        await page.waitForTimeout(2500 + Math.floor(Math.random() * 2500));
      }
      this.scan.neighbors = this.scan.neighbors.filter((n) => !deletedNos.has(n.buddyBlogNo));
      this.scan.summary = summarizeNeighbors(this.scan.neighbors);
      this.save();
      this.log(`✅ 이웃 ${deletedNos.size}명을 정리했습니다.`, 'success');
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
