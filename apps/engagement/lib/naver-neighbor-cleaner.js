/**
 * naver-neighbor-cleaner.js
 *
 * Handles:
 * 1. AI-assisted automated screening and acceptance/rejection of received neighbor requests (BuddyInviteReceivedManage.naver)
 * 2. Automated batch cancellation of expired sent neighbor requests (BuddyInviteSentManage.naver)
 */

const DEFAULT_MACRO_PHRASES = [
  '우리 서로이웃해요~',
  '우리 서로이웃해요',
  '서로이웃해요',
  '서이추해요',
  '서이추 환영',
  '서이추 환영해요',
  '서로이웃 신청합니다',
  '우리 서로이웃 해요',
  '서로 이웃 해요'
];

const COMMERCIAL_SPAM_KEYWORDS = [
  '대출', '보험', '분양', '도박', '카지노', '코인', '수익', '재테크', '부동산',
  '협찬', '체험단', '원고료', '마케팅 대행', '홍보대행', '바이럴', '성인', '환전',
  '바카라', '토토', '피부과', '치과', '성형외과', '변호사', '세무사', '점집', '사주'
];

/**
 * Parse Naver buddy date format: "26.09.07." or "2026.09.07"
 */
function parseBuddyDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.trim().match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})\.?$/);
  if (!match) return null;
  let year = parseInt(match[1], 10);
  if (year < 100) year += 2000;
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  return new Date(year, month, day);
}

/**
 * Calculate elapsed days since the request was sent
 */
function getDaysAgo(date, now = new Date()) {
  if (!date) return 0;
  const diffMs = now.getTime() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Heuristic 1st-stage rule-based evaluation of a received buddy request
 */
function evaluateBuddyRequestHeuristic(request) {
  const { nickname = '', message = '', targetBlogId = '' } = request;
  const combined = `${nickname} ${message} ${targetBlogId}`.toLowerCase();

  // Check commercial spam keywords
  for (const kw of COMMERCIAL_SPAM_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      return {
        decision: 'reject',
        reason: `상업/홍보성 키워드 감지 ('${kw}')`,
        rule: 'commercial_spam'
      };
    }
  }

  // Check exact or near-match macro phrases
  const cleanMsg = message.replace(/\s+/g, ' ').trim();
  for (const macro of DEFAULT_MACRO_PHRASES) {
    if (cleanMsg === macro || cleanMsg.startsWith(macro)) {
      return {
        decision: 'reject',
        reason: `네이버 기본 매크로 신청 멘트 ('${macro}')`,
        rule: 'default_macro'
      };
    }
  }

  // If personalized message with no commercial keywords
  if (cleanMsg.length >= 10 && !DEFAULT_MACRO_PHRASES.some((m) => cleanMsg.includes(m))) {
    return {
      decision: 'accept',
      reason: '진정성 있는 개인 맞춤 신청 멘트',
      rule: 'genuine_message'
    };
  }

  return {
    decision: 'needs_ai',
    reason: '규칙 기반 판정 보류, AI 심층 검증 필요',
    rule: 'ambiguous'
  };
}

/**
 * AI-assisted 2nd-stage evaluation using on-device LLM
 */
async function evaluateBuddyRequestWithAI(request, embeddedLlama) {
  // First run heuristic rule check
  const heuristic = evaluateBuddyRequestHeuristic(request);
  if (heuristic.decision !== 'needs_ai') {
    return heuristic;
  }

  // If embeddedLlama is not available or not ready, fallback to accept
  if (!embeddedLlama || typeof embeddedLlama.chatCompletion !== 'function') {
    return {
      decision: 'accept',
      reason: '일반 블로그 신청 (AI 엔진 미활성 자동 수락)',
      rule: 'fallback_accept'
    };
  }

  try {
    const prompt = `다음은 네이버 블로그에 들어온 서로이웃 신청 정보입니다.
신청자 닉네임: ${request.nickname || '미상'}
신청자 아이디: ${request.targetBlogId || '미상'}
신청 메시지: "${request.message || ''}"

이 신청자가 '진성 소통 블로거'인지 아니면 '상업/홍보/스팸/매크로 블로거'인지 판단해주세요.
출력 형식은 반드시 아래 중 하나만 단어로 출력하세요:
ACCEPT (진성 블로거로 판단되어 서로이웃 수락 권장)
REJECT (광고/매크로/스팸으로 판단되어 거절 권장)`;

    const response = await embeddedLlama.chatCompletion([
      { role: 'system', content: '당신은 네이버 블로그 서로이웃 선별 전문 AI입니다. 스팸과 매크로를 정확히 구분합니다.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.1, maxTokens: 20 });

    const text = (response || '').trim().toUpperCase();
    if (text.includes('REJECT')) {
      return {
        decision: 'reject',
        reason: 'AI 심층 검증: 상업/스팸 의심 블로거 판정',
        rule: 'ai_classified_spam'
      };
    }
    return {
      decision: 'accept',
      reason: 'AI 심층 검증: 정상 활동 블로거 판정',
      rule: 'ai_classified_genuine'
    };
  } catch (error) {
    return {
      decision: 'accept',
      reason: `AI 검증 오류 발생으로 기본 수락 (${error.message})`,
      rule: 'ai_error_fallback'
    };
  }
}

/**
 * Parse received buddy requests from raw HTML string
 */
function parseReceivedRequestsHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const rows = [];
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const checkMatch = tr.match(/name=["']targetBlogId["'][^>]*value=["']([^"']+)["']/i);
    if (!checkMatch) continue;
    const targetBlogId = checkMatch[1];

    const nickMatch = tr.match(/class=["']nickname["'][^>]*>([\s\S]*?)<\/span>/i);
    const nickname = nickMatch ? nickMatch[1].replace(/<[^>]+>/g, '').trim() : targetBlogId;

    const msgMatch = tr.match(/class=["']msg["'][^>]*>([\s\S]*?)<\/td>/i);
    const message = msgMatch ? msgMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';

    const dateMatch = tr.match(/class=["']date["'][^>]*>([\s\S]*?)<\/td>/i);
    const dateStr = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const dateObj = parseBuddyDate(dateStr);
    const daysAgo = getDaysAgo(dateObj);

    rows.push({
      targetBlogId,
      nickname,
      message,
      dateStr,
      daysAgo,
      blogUrl: `https://blog.naver.com/${targetBlogId}`
    });
  }

  return rows;
}

/**
 * Parse sent buddy requests from raw HTML string
 */
function parseSentRequestsHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const rows = [];
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const checkMatch = tr.match(/name=["']targetBlogId["'][^>]*value=["']([^"']+)["']/i);
    if (!checkMatch) continue;
    const targetBlogId = checkMatch[1];

    const nickMatch = tr.match(/class=["']nickname["'][^>]*>([\s\S]*?)<\/span>/i);
    const nickname = nickMatch ? nickMatch[1].replace(/<[^>]+>/g, '').trim() : targetBlogId;

    const msgMatch = tr.match(/class=["']msg["'][^>]*>([\s\S]*?)<\/td>/i);
    const message = msgMatch ? msgMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';

    const dateMatch = tr.match(/class=["']date["'][^>]*>([\s\S]*?)<\/td>/i);
    const dateStr = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const cancelMatch = tr.match(/_cancleInvite[^"']*_param\((\d+)\)/i);
    const buddyBlogNo = cancelMatch ? cancelMatch[1] : '';

    const dateObj = parseBuddyDate(dateStr);
    const daysAgo = getDaysAgo(dateObj);

    rows.push({
      targetBlogId,
      nickname,
      message,
      dateStr,
      daysAgo,
      buddyBlogNo,
      blogUrl: `https://blog.naver.com/${targetBlogId}`
    });
  }

  return rows;
}

/**
 * Fetch received buddy requests via Playwright page
 */
async function fetchReceivedBuddyRequests(page, blogId) {
  const targetUrl = `https://admin.blog.naver.com/BuddyInviteReceivedManage.naver?blogId=${blogId}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);

  const html = await page.content();
  return parseReceivedRequestsHtml(html);
}

/**
 * Accept a received buddy request on the page
 */
async function acceptReceivedBuddyRequest(page, targetBlogId, options = {}) {
  const { activeGroup = '' } = options;
  const popupPromise = page.waitForEvent('popup', { timeout: 12000 }).catch(() => null);

  const acceptBtn = await page.$(`button._acceptBuddy._param\\(${targetBlogId}\\)`);
  if (!acceptBtn) {
    throw new Error(`@${targetBlogId}의 수락 버튼을 찾을 수 없습니다.`);
  }

  await acceptBtn.click();
  const popup = await popupPromise;
  if (!popup) {
    throw new Error(`@${targetBlogId} 수락 팝업 창이 열리지 않았습니다.`);
  }

  try {
    await popup.waitForURL('**/BuddyAccept.naver*', { timeout: 10000 });
    await popup.waitForLoadState('domcontentloaded');

    popup.on('dialog', async (d) => {
      await d.accept().catch(() => {});
    });

    // If a specific group is requested, select it
    if (activeGroup) {
      await popup.evaluate((groupName) => {
        const sel = document.getElementById('groupIdSelector');
        if (sel) {
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].text.includes(groupName)) {
              sel.selectedIndex = i;
              break;
            }
          }
        }
      }, activeGroup).catch(() => {});
    }

    const submitBtn = await popup.$('input[type="image"], input[alt="확인"], #footer input');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await popup.evaluate(() => document.forms['buddyFrm']?.submit());
    }
    await page.waitForTimeout(1500);
  } finally {
    if (!popup.isClosed()) {
      await popup.close().catch(() => {});
    }
  }

  return { ok: true, action: 'accepted', targetBlogId };
}

/**
 * Reject a received buddy request on the page
 */
async function rejectReceivedBuddyRequest(page, targetBlogId) {
  const popupPromise = page.waitForEvent('popup', { timeout: 12000 }).catch(() => null);

  const denyBtn = await page.$(`button._denyBothBuddy._param\\(${targetBlogId}\\)`);
  if (!denyBtn) {
    throw new Error(`@${targetBlogId}의 거절 버튼을 찾을 수 없습니다.`);
  }

  await denyBtn.click();
  const popup = await popupPromise;
  if (!popup) {
    throw new Error(`@${targetBlogId} 거절 팝업 창이 열리지 않았습니다.`);
  }

  try {
    await popup.waitForURL('**/BothBuddyDenyForm.naver*', { timeout: 10000 });
    await popup.waitForLoadState('domcontentloaded');

    popup.on('dialog', async (d) => {
      await d.accept().catch(() => {});
    });

    const submitBtn = await popup.$('input[type="image"], input[alt="확인"], #footer input');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await popup.evaluate(() => document.forms['bothBuddyDenyFrom']?.submit());
    }
    await page.waitForTimeout(1500);
  } finally {
    if (!popup.isClosed()) {
      await popup.close().catch(() => {});
    }
  }

  return { ok: true, action: 'rejected', targetBlogId };
}

/**
 * Fetch sent buddy requests via Playwright page
 */
async function fetchSentBuddyRequests(page, blogId, currentPage = 1) {
  const targetUrl = `https://admin.blog.naver.com/BuddyInviteSentManage.naver?blogId=${blogId}&currentPage=${currentPage}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);

  const html = await page.content();
  const items = parseSentRequestsHtml(html).map((item) => ({
    ...item,
    sourcePage: currentPage
  }));

  // Naver displays pagination in blocks (1~10, then 11~20). Keep both the
  // largest visible page and the next-block target so callers can walk every
  // block instead of mistaking the first block for the full list.
  const pagination = await page.evaluate((requestedPage) => {
    const pageNums = Array.from(document.querySelectorAll('.paginate a, .paginate strong'))
      .map((el) => parseInt(el.innerText.trim(), 10))
      .filter((n) => !isNaN(n));
    const nextLink = Array.from(document.querySelectorAll('.paginate a')).find((el) => {
      const label = `${el.innerText || ''} ${el.getAttribute('title') || ''}`.trim();
      return /(^|\s)next(\s|$)/i.test(el.className || '') || label.includes('다음');
    });
    const nextMatch = nextLink?.getAttribute('href')?.match(/goPage\((\d+)\)/i);
    return {
      maxPage: pageNums.length ? Math.max(...pageNums) : requestedPage,
      nextPage: nextMatch ? Number(nextMatch[1]) : null
    };
  }, currentPage);

  return {
    items,
    currentPage,
    maxPage: Math.max(currentPage, Number(pagination?.maxPage) || currentPage),
    nextPage: Number(pagination?.nextPage) || null
  };
}

async function fetchAllSentBuddyRequests(page, blogId, options = {}) {
  const {
    include = () => true,
    maxItems = Number.POSITIVE_INFINITY,
    maxPages = 200
  } = options;
  const items = [];
  let pageNo = 1;
  let maxDiscoveredPage = 1;

  while (pageNo <= maxDiscoveredPage && pageNo <= maxPages) {
    const pageData = await fetchSentBuddyRequests(page, blogId, pageNo);
    maxDiscoveredPage = Math.max(
      maxDiscoveredPage,
      pageData.maxPage || pageNo,
      pageData.nextPage || 0
    );

    for (const item of pageData.items) {
      if (include(item) && items.length < maxItems) items.push(item);
    }

    if (items.length >= maxItems) break;
    pageNo++;
  }

  return {
    items,
    totalPages: maxDiscoveredPage,
    scannedPages: Math.min(pageNo, maxDiscoveredPage, maxPages),
    truncated: pageNo >= maxPages && maxDiscoveredPage > maxPages
  };
}

async function locateSentBuddyRequest(page, blogId, item, maxPageHint = 1) {
  const sourcePage = Math.max(1, Number(item.sourcePage) || 1);
  const maxPage = Math.max(sourcePage, Number(maxPageHint) || 1);
  const candidates = [sourcePage];

  // Earlier cancellations can pull an item toward a previous page. Search those
  // pages first, then later pages as a defensive fallback for live list changes.
  for (let pageNo = sourcePage - 1; pageNo >= 1; pageNo--) candidates.push(pageNo);
  for (let pageNo = sourcePage + 1; pageNo <= maxPage; pageNo++) candidates.push(pageNo);

  for (const pageNo of candidates) {
    const pageData = await fetchSentBuddyRequests(page, blogId, pageNo);
    const matched = pageData.items.find((candidate) => (
      candidate.buddyBlogNo === item.buddyBlogNo
      || (candidate.targetBlogId === item.targetBlogId && !item.buddyBlogNo)
    ));
    if (matched) return { item: matched, pageNo, maxPage: pageData.maxPage };
  }

  return null;
}

/**
 * Cancel a single sent buddy request
 */
async function cancelSingleSentBuddyRequest(page, item, options = {}) {
  const { blogId = '', maxPage = item.sourcePage || 1, dialogTimeoutMs = 5000 } = options;
  let activeItem = item;
  let activePage = Math.max(1, Number(item.sourcePage) || 1);

  if (blogId) {
    const located = await locateSentBuddyRequest(page, blogId, item, maxPage);
    if (!located) {
      throw new Error(`@${item.targetBlogId}의 대기 중인 신청을 현재 보낸 신청 목록에서 찾을 수 없습니다.`);
    }
    activeItem = located.item;
    activePage = located.pageNo;
  }

  const { buddyBlogNo, targetBlogId } = activeItem;
  if (!buddyBlogNo) {
    throw new Error(`@${targetBlogId}의 취소 식별 번호(buddyBlogNo)가 없습니다.`);
  }

  const cancelBtn = await page.$(`button._cancleInvite._param\\(${buddyBlogNo}\\)`);
  if (!cancelBtn) {
    throw new Error(`@${targetBlogId}의 신청취소 버튼을 ${activePage}페이지에서 찾을 수 없습니다.`);
  }

  const dialogPromise = page.waitForEvent('dialog', { timeout: dialogTimeoutMs })
    .then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    })
    .catch(() => null);

  await Promise.all([cancelBtn.click(), dialogPromise]);
  await page.waitForTimeout(500);

  if (blogId) {
    const verifiedPage = await fetchSentBuddyRequests(page, blogId, activePage);
    const stillPending = verifiedPage.items.some((candidate) => candidate.buddyBlogNo === buddyBlogNo);
    if (stillPending) {
      throw new Error(`@${targetBlogId}의 신청이 취소 후에도 목록에 남아 있습니다.`);
    }
  }

  return { ok: true, action: 'canceled', targetBlogId, buddyBlogNo, sourcePage: activePage };
}

/**
 * Manager orchestrating both received request screening and sent request cleanup
 */
class NeighborCleanerManager {
  constructor(options = {}) {
    this.browserSession = options.browserSession || null;
    this.embeddedLlama = options.embeddedLlama || null;
    this.neighborGroupStore = options.neighborGroupStore || null;
    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'error'
    this.isPaused = false;
    this.shouldStop = false;
    this.logs = [];
    this.stats = {
      type: 'none', // 'received' | 'sent'
      total: 0,
      processed: 0,
      accepted: 0,
      rejected: 0,
      canceled: 0,
      skipped: 0,
      errors: 0
    };
  }

  log(message, type = 'info') {
    const entry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
      type,
      message
    };
    this.logs.unshift(entry);
    if (this.logs.length > 300) this.logs.pop();
    console.log(`[NeighborCleaner] [${entry.time}] ${message}`);
  }

  getState() {
    return {
      state: this.state,
      stats: { ...this.stats },
      logs: this.logs.slice(0, 50)
    };
  }

  pause() {
    if (this.state === 'running') {
      this.isPaused = true;
      this.state = 'paused';
      this.log('⏸️ 이웃 관리 작업이 일시정지되었습니다.', 'warn');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.isPaused = false;
      this.state = 'running';
      this.log('▶️ 이웃 관리 작업을 다시 재개합니다.', 'info');
    }
  }

  stop() {
    this.shouldStop = true;
    this.isPaused = false;
    this.state = 'stopped';
    this.log('⏹️ 사용자에 의해 이웃 관리 작업이 중단되었습니다.', 'warn');
  }

  async waitWithCheck(ms) {
    const step = 500;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this.shouldStop) return false;
      while (this.isPaused) {
        if (this.shouldStop) return false;
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, Math.min(step, ms - elapsed)));
      elapsed += step;
    }
    return !this.shouldStop;
  }

  /**
   * Process received requests: filter and automatically accept/reject
   */
  async startCleanReceived(options = {}) {
    if (this.state === 'running') {
      throw new Error('이미 이웃 관리 작업이 실행 중입니다.');
    }
    if (!this.browserSession || !this.browserSession.connected) {
      throw new Error('네이버 계정이 연결되어 있지 않습니다.');
    }

    const {
      dryRun = false,
      acceptGenuine = true,
      rejectSpam = true,
      minDelaySec = 3,
      maxDelaySec = 5
    } = options;
    const acceptAll = !acceptGenuine && !rejectSpam;

    this.state = 'running';
    this.isPaused = false;
    this.shouldStop = false;
    this.stats = {
      type: 'received',
      total: 0,
      processed: 0,
      accepted: 0,
      rejected: 0,
      canceled: 0,
      skipped: 0,
      errors: 0
    };

    this.log(
      acceptAll
        ? `🚀 AI 조건 없이 받은 서로이웃 신청 전체 수락을 시작합니다.${dryRun ? ' (미리보기)' : ''}`
        : `🚀 받은 서로이웃 신청 AI 선별 ${dryRun ? '미리보기(Dry-Run)' : '자동 처리'}를 시작합니다.`,
      'info'
    );

    const page = await this.browserSession.context.newPage();
    try {
      const blogId = await this.browserSession.resolveMyBlogId(page);
      this.log('🔍 네이버 관리자 페이지에서 받은 신청 목록을 조회합니다...', 'info');
      const requests = await fetchReceivedBuddyRequests(page, blogId);
      this.stats.total = requests.length;

      if (!requests.length) {
        this.log('✨ 대기 중인 받은 서로이웃 신청이 없습니다.', 'success');
        this.state = 'completed';
        return { ok: true, stats: this.stats };
      }

      this.log(`📋 총 ${requests.length}건의 받은 신청을 검토합니다.`, 'info');

      // Get active neighbor group for acceptances
      let activeGroup = '';
      if (this.neighborGroupStore) {
        activeGroup = this.neighborGroupStore.getActiveGroupName?.() || '';
      }

      for (let i = 0; i < requests.length; i++) {
        if (this.shouldStop) break;
        while (this.isPaused) {
          if (this.shouldStop) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (this.shouldStop) break;

        const req = requests[i];
        this.log(`[${i + 1}/${requests.length}] @${req.targetBlogId} (${req.nickname}) 신청 검토 중...`, 'info');

        // No filters means explicit accept-all mode; otherwise use heuristics and AI.
        const evaluation = acceptAll
          ? { decision: 'accept', reason: 'AI 조건 없음 - 전체 수락', rule: 'accept_all' }
          : await evaluateBuddyRequestWithAI(req, this.embeddedLlama);
        this.log(`🤖 판정: [${evaluation.decision.toUpperCase()}] ${evaluation.reason}`, evaluation.decision === 'accept' ? 'success' : 'warn');

        this.stats.processed++;

        if (dryRun) {
          if (evaluation.decision === 'accept') this.stats.accepted++;
          else this.stats.rejected++;
          continue;
        }

        // Real Execution
        try {
          if (evaluation.decision === 'accept') {
            if (acceptGenuine || acceptAll) {
              await acceptReceivedBuddyRequest(page, req.targetBlogId, { activeGroup });
              this.stats.accepted++;
              this.log(`✅ @${req.targetBlogId} 서로이웃 신청을 수락했습니다. (그룹: ${activeGroup || '기본'})`, 'success');
            } else {
              this.stats.skipped++;
              this.log(`⏩ @${req.targetBlogId} 수락 옵션이 꺼져 있어 건너뜁니다.`, 'info');
            }
          } else {
            if (rejectSpam) {
              await rejectReceivedBuddyRequest(page, req.targetBlogId);
              this.stats.rejected++;
              this.log(`🛡️ @${req.targetBlogId} 광고/매크로 신청을 거절했습니다.`, 'warn');
            } else {
              this.stats.skipped++;
              this.log(`⏩ @${req.targetBlogId} 거절 옵션이 꺼져 있어 건너뜁니다.`, 'info');
            }
          }
        } catch (err) {
          this.stats.errors++;
          this.log(`❌ @${req.targetBlogId} 처리 실패: ${err.message}`, 'error');
        }

        // Jitter delay between actions
        if (i < requests.length - 1 && !dryRun) {
          const delay = Math.floor(Math.random() * (maxDelaySec - minDelaySec + 1) + minDelaySec);
          if (delay > 0) {
            this.log(`⏳ 다음 신청 검토까지 ${delay}초간 대기합니다...`, 'delay');
            const cont = await this.waitWithCheck(delay * 1000);
            if (!cont) break;
          }
        }
      }

      this.log(`🎉 받은 신청 선별 완료: 총 ${this.stats.processed}건 처리 (수락 ${this.stats.accepted}건, 거절 ${this.stats.rejected}건)`, 'success');
      this.state = this.shouldStop ? 'stopped' : 'completed';
      return { ok: true, stats: this.stats };
    } catch (error) {
      this.state = 'error';
      this.log(`❌ 받은 신청 처리 중 치명적 오류: ${error.message}`, 'error');
      throw error;
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Process sent requests: cancel requests older than olderThanDays
   */
  async startCancelSent(options = {}) {
    if (this.state === 'running') {
      throw new Error('이미 이웃 관리 작업이 실행 중입니다.');
    }
    if (!this.browserSession || !this.browserSession.connected) {
      throw new Error('네이버 계정이 연결되어 있지 않습니다.');
    }

    const {
      olderThanDays = 7,
      maxCancelCount = 50,
      minDelaySec = 2,
      maxDelaySec = 3,
      dryRun = false
    } = options;

    this.state = 'running';
    this.isPaused = false;
    this.shouldStop = false;
    this.stats = {
      type: 'sent',
      total: 0,
      processed: 0,
      accepted: 0,
      rejected: 0,
      canceled: 0,
      skipped: 0,
      errors: 0
    };

    this.log(`🚀 보낸 서로이웃 신청 회수 (${olderThanDays}일 이상 경과) 작업을 시작합니다.`, 'info');

    const page = await this.browserSession.context.newPage();
    try {
      const blogId = await this.browserSession.resolveMyBlogId(page);
      this.log('🔍 보낸 신청 목록을 조회하고 경과일을 분석합니다...', 'info');
      
      const collected = await fetchAllSentBuddyRequests(page, blogId, {
        include: (item) => item.daysAgo >= olderThanDays,
        maxItems: maxCancelCount
      });
      const allExpired = collected.items;

      this.stats.total = allExpired.length;
      if (!allExpired.length) {
        this.log(`✨ ${olderThanDays}일 이상 경과한 미수락 보낸 신청이 없습니다.`, 'success');
        this.state = 'completed';
        return { ok: true, stats: this.stats };
      }

      this.log(`📋 ${olderThanDays}일 이상 경과한 회수 대상 신청 ${allExpired.length}건을 발견했습니다.`, 'info');

      if (dryRun) {
        this.stats.canceled = allExpired.length;
        this.state = 'completed';
        this.log(`[Dry-Run] 회수 대상 ${allExpired.length}건 확인 완료`, 'success');
        return { ok: true, stats: this.stats, expiredItems: allExpired };
      }

      // Start from later pages so earlier-page deletions do not shift pending
      // targets away from the page on which they were collected.
      allExpired.sort((a, b) => (b.sourcePage || 1) - (a.sourcePage || 1));

      // Execute cancellations
      for (let i = 0; i < allExpired.length; i++) {
        if (this.shouldStop) break;
        while (this.isPaused) {
          if (this.shouldStop) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (this.shouldStop) break;

        const item = allExpired[i];
        this.log(`[${i + 1}/${allExpired.length}] @${item.targetBlogId} (${item.nickname}, ${item.daysAgo}일 경과) 취소 중...`, 'info');

        try {
          await cancelSingleSentBuddyRequest(page, item, {
            blogId,
            maxPage: collected.totalPages
          });
          this.stats.canceled++;
          this.log(`🗑️ @${item.targetBlogId} 보낸 신청을 성공적으로 취소하여 슬롯을 복구했습니다.`, 'success');
        } catch (err) {
          this.stats.errors++;
          this.log(`❌ @${item.targetBlogId} 취소 실패: ${err.message}`, 'error');
        } finally {
          this.stats.processed++;
        }

        // Delay between cancellations
        if (i < allExpired.length - 1) {
          const delay = Math.floor(Math.random() * (maxDelaySec - minDelaySec + 1) + minDelaySec);
          if (delay > 0) {
            const cont = await this.waitWithCheck(delay * 1000);
            if (!cont) break;
          }
        }
      }

      const failedSummary = this.stats.errors ? `, ${this.stats.errors}건 실패` : '';
      this.log(`🎉 보낸 신청 회수 완료: 총 ${this.stats.canceled}건 취소 완료${failedSummary} (이웃 추가 슬롯 복구)`, this.stats.errors ? 'warn' : 'success');
      this.state = this.shouldStop ? 'stopped' : 'completed';
      return { ok: true, stats: this.stats };
    } catch (error) {
      this.state = 'error';
      this.log(`❌ 보낸 신청 회수 중 오류: ${error.message}`, 'error');
      throw error;
    } finally {
      await page.close().catch(() => {});
    }
  }
}

export {
  parseBuddyDate,
  getDaysAgo,
  evaluateBuddyRequestHeuristic,
  evaluateBuddyRequestWithAI,
  parseReceivedRequestsHtml,
  parseSentRequestsHtml,
  fetchReceivedBuddyRequests,
  acceptReceivedBuddyRequest,
  rejectReceivedBuddyRequest,
  fetchSentBuddyRequests,
  fetchAllSentBuddyRequests,
  cancelSingleSentBuddyRequest,
  NeighborCleanerManager
};
