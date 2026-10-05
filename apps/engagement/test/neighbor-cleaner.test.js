import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseBuddyDate,
  getDaysAgo,
  evaluateBuddyRequestHeuristic,
  evaluateBuddyRequestWithAI,
  parseReceivedRequestsHtml,
  parseSentRequestsHtml,
  fetchAllSentBuddyRequests,
  cancelSingleSentBuddyRequest,
  NeighborCleanerManager
} from '../lib/naver-neighbor-cleaner.js';

test('sent cleanup UI restores the primary action after every terminal state', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const sentDashboardBranch = appSource.slice(
    appSource.indexOf("} else if (stats.type === 'sent')"),
    appSource.indexOf('\n  }\n}', appSource.indexOf("} else if (stats.type === 'sent')"))
  );

  assert.match(sentDashboardBranch, /if \(isIdle\) \{/);
  assert.match(sentDashboardBranch, /startBtn\.disabled = false/);
  assert.match(sentDashboardBranch, /오래된 신청 취소/);
});

test('parseBuddyDate parses Korean 2-digit and 4-digit date formats', () => {
  const d1 = parseBuddyDate('26.09.07.');
  assert.ok(d1 instanceof Date);
  assert.equal(d1.getFullYear(), 2026);
  assert.equal(d1.getMonth(), 8); // 0-indexed: September
  assert.equal(d1.getDate(), 7);

  const d2 = parseBuddyDate('2026.12.25');
  assert.ok(d2 instanceof Date);
  assert.equal(d2.getFullYear(), 2026);
  assert.equal(d2.getMonth(), 11); // December
  assert.equal(d2.getDate(), 25);

  assert.equal(parseBuddyDate(null), null);
  assert.equal(parseBuddyDate('invalid-date'), null);
});

test('getDaysAgo calculates elapsed days accurately', () => {
  const now = new Date(2026, 8, 10, 12, 0, 0);
  const sevenDaysAgo = new Date(2026, 8, 3, 12, 0, 0);
  assert.equal(getDaysAgo(sevenDaysAgo, now), 7);

  const sameDay = new Date(2026, 8, 10, 8, 0, 0);
  assert.equal(getDaysAgo(sameDay, now), 0);
});

test('evaluateBuddyRequestHeuristic flags commercial spam keywords and macro phrases', () => {
  // Commercial spam
  const loanReq = {
    targetBlogId: 'loan_master',
    nickname: '최저금리 대출상담',
    message: '친하게 지내요'
  };
  const resLoan = evaluateBuddyRequestHeuristic(loanReq);
  assert.equal(resLoan.decision, 'reject');
  assert.equal(resLoan.rule, 'commercial_spam');

  // Default macro
  const macroReq = {
    targetBlogId: 'some_user',
    nickname: '홍길동',
    message: '우리 서로이웃해요~'
  };
  const resMacro = evaluateBuddyRequestHeuristic(macroReq);
  assert.equal(resMacro.decision, 'reject');
  assert.equal(resMacro.rule, 'default_macro');

  // Genuine personalized message
  const genuineReq = {
    targetBlogId: 'travel_lover',
    nickname: '여행조아',
    message: '올려주신 제주도 숙소 글 너무 유익하게 잘 봤습니다! 서로이웃하고 소통해요~'
  };
  const resGenuine = evaluateBuddyRequestHeuristic(genuineReq);
  assert.equal(resGenuine.decision, 'accept');
  assert.equal(resGenuine.rule, 'genuine_message');

  // Borderline / needs AI
  const borderReq = {
    targetBlogId: 'border_user',
    nickname: '식도락가',
    message: '안녕하세요'
  };
  const resBorder = evaluateBuddyRequestHeuristic(borderReq);
  assert.equal(resBorder.decision, 'needs_ai');
});

test('evaluateBuddyRequestWithAI queries embeddedLlama when heuristic is ambiguous', async () => {
  const mockLlama = {
    async chatCompletion(_messages) {
      return 'REJECT (광고 의심)';
    }
  };

  const req = {
    targetBlogId: 'ambiguous_user',
    nickname: '체험가',
    message: '안녕하세요'
  };

  const res = await evaluateBuddyRequestWithAI(req, mockLlama);
  assert.equal(res.decision, 'reject');
  assert.equal(res.rule, 'ai_classified_spam');
});

test('parseReceivedRequestsHtml extracts all fields correctly', () => {
  const mockHtml = `
    <table>
      <tbody>
        <tr>
          <td><input type="checkbox" name="targetBlogId" value="blogger1"></td>
          <td>
            <a href="https://blog.naver.com/blogger1" class="blog_link">
              <span class="nickname">맛집탐험가</span>
              <span class="blogid">blogger1</span>
            </a>
          </td>
          <td class="msg">우리 서로이웃해요~</td>
          <td class="date">26.09.07.</td>
          <td class="btns"><button type="button" class="_acceptBuddy">수락</button></td>
        </tr>
        <tr>
          <td><input type="checkbox" name="targetBlogId" value="blogger2"></td>
          <td>
            <a href="https://blog.naver.com/blogger2" class="blog_link">
              <span class="nickname">캠핑매니아</span>
              <span class="blogid">blogger2</span>
            </a>
          </td>
          <td class="msg">소통하며 좋은 이웃으로 지내고 싶어요!</td>
          <td class="date">26.09.06.</td>
          <td class="btns"><button type="button" class="_acceptBuddy">수락</button></td>
        </tr>
      </tbody>
    </table>
  `;

  const items = parseReceivedRequestsHtml(mockHtml);
  assert.equal(items.length, 2);

  assert.equal(items[0].targetBlogId, 'blogger1');
  assert.equal(items[0].nickname, '맛집탐험가');
  assert.equal(items[0].message, '우리 서로이웃해요~');
  assert.equal(items[0].dateStr, '26.09.07.');

  assert.equal(items[1].targetBlogId, 'blogger2');
  assert.equal(items[1].nickname, '캠핑매니아');
  assert.equal(items[1].message, '소통하며 좋은 이웃으로 지내고 싶어요!');
});

test('parseSentRequestsHtml extracts sent items with buddyBlogNo and date', () => {
  const mockHtml = `
    <table>
      <tbody>
        <tr>
          <td><input type="checkbox" name="targetBlogId" value="sent_blog_1"></td>
          <td>
            <a href="https://blog.naver.com/sent_blog_1" class="blog_link">
              <span class="nickname">IT러버</span>
              <span class="blogid">sent_blog_1</span>
            </a>
          </td>
          <td class="msg">안녕하세요! IT 글 잘 봤습니다.</td>
          <td class="date">26.08.20.</td>
          <td class="btns">
            <span class="btn btn5"><button type="button" class="_cancleInvite _param(12345678)">신청취소</button></span>
          </td>
        </tr>
      </tbody>
    </table>
  `;

  const items = parseSentRequestsHtml(mockHtml);
  assert.equal(items.length, 1);
  assert.equal(items[0].targetBlogId, 'sent_blog_1');
  assert.equal(items[0].nickname, 'IT러버');
  assert.equal(items[0].buddyBlogNo, '12345678');
  assert.equal(items[0].dateStr, '26.08.20.');
  assert.ok(items[0].daysAgo >= 10);
});

test('fetchAllSentBuddyRequests follows Naver pagination beyond the first 10-page block', async () => {
  let currentPage = 1;
  const visitedPages = [];
  const page = {
    async goto(url) {
      currentPage = Number(new URL(url).searchParams.get('currentPage')) || 1;
      visitedPages.push(currentPage);
    },
    async waitForTimeout() {},
    async content() {
      return `<table><tr>
        <td><input name="targetBlogId" value="page_${currentPage}"></td>
        <td><span class="nickname">page_${currentPage}</span></td>
        <td class="date">26.08.25.</td>
        <td><button class="_cancleInvite _param(${1000 + currentPage})">신청취소</button></td>
      </tr></table>`;
    },
    async evaluate() {
      if (currentPage <= 10) return { maxPage: 10, nextPage: 11 };
      return { maxPage: 11, nextPage: null };
    }
  };

  const result = await fetchAllSentBuddyRequests(page, 'owner');

  assert.deepEqual(visitedPages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(result.items.length, 11);
  assert.equal(result.totalPages, 11);
  assert.equal(result.scannedPages, 11);
  assert.equal(result.truncated, false);
  assert.equal(result.items[10].sourcePage, 11);
});

test('cancelSingleSentBuddyRequest returns to the source page and verifies removal', async () => {
  const pages = new Map([
    [1, [{ targetBlogId: 'first_page', buddyBlogNo: '111', dateStr: '26.08.20.' }]],
    [2, [{ targetBlogId: 'second_page', buddyBlogNo: '222', dateStr: '26.08.19.' }]]
  ]);
  let currentPage = 2;
  let pendingDialogResolve = null;

  const renderPage = () => `<table>${(pages.get(currentPage) || []).map((item) => `
    <tr>
      <td><input name="targetBlogId" value="${item.targetBlogId}"></td>
      <td><span class="nickname">${item.targetBlogId}</span></td>
      <td class="date">${item.dateStr}</td>
      <td><button class="_cancleInvite _param(${item.buddyBlogNo})">신청취소</button></td>
    </tr>`).join('')}</table>`;

  const page = {
    async goto(url) {
      currentPage = Number(new URL(url).searchParams.get('currentPage')) || 1;
    },
    async waitForTimeout() {},
    async content() { return renderPage(); },
    async evaluate() { return { maxPage: 2, nextPage: null }; },
    async $(selector) {
      const buddyBlogNo = selector.match(/\d+/)?.[0];
      const found = (pages.get(currentPage) || []).find((item) => item.buddyBlogNo === buddyBlogNo);
      if (!found) return null;
      return {
        async click() {
          const dialog = {
            message() { return '취소하시겠습니까?'; },
            async accept() {
              pages.set(currentPage, (pages.get(currentPage) || []).filter((item) => item.buddyBlogNo !== buddyBlogNo));
            }
          };
          pendingDialogResolve?.(dialog);
        }
      };
    },
    waitForEvent(event) {
      assert.equal(event, 'dialog');
      return new Promise((resolve) => { pendingDialogResolve = resolve; });
    }
  };

  const result = await cancelSingleSentBuddyRequest(page, {
    targetBlogId: 'first_page',
    buddyBlogNo: '111',
    sourcePage: 1
  }, {
    blogId: 'owner',
    maxPage: 2,
    dialogTimeoutMs: 50
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourcePage, 1);
  assert.equal(pages.get(1).length, 0);
});

test('sent request cleanup cancels targets across multiple pages and reports every attempt', async () => {
  const pages = new Map([
    [1, [{ targetBlogId: 'page_one', buddyBlogNo: '101', dateStr: '26.08.20.' }]],
    [2, [{ targetBlogId: 'page_two', buddyBlogNo: '202', dateStr: '26.08.19.' }]]
  ]);
  let currentPage = 1;
  let pendingDialogResolve = null;

  const page = {
    async goto(url) { currentPage = Number(new URL(url).searchParams.get('currentPage')) || 1; },
    async waitForTimeout() {},
    async content() {
      return `<table>${(pages.get(currentPage) || []).map((item) => `
        <tr><td><input name="targetBlogId" value="${item.targetBlogId}"></td>
        <td><span class="nickname">${item.targetBlogId}</span></td>
        <td class="date">${item.dateStr}</td>
        <td><button class="_cancleInvite _param(${item.buddyBlogNo})">신청취소</button></td></tr>`).join('')}</table>`;
    },
    async evaluate() { return { maxPage: 2, nextPage: null }; },
    async $(selector) {
      const buddyBlogNo = selector.match(/\d+/)?.[0];
      const found = (pages.get(currentPage) || []).find((item) => item.buddyBlogNo === buddyBlogNo);
      if (!found) return null;
      return {
        async click() {
          pendingDialogResolve?.({
            message() { return '취소하시겠습니까?'; },
            async accept() {
              pages.set(currentPage, (pages.get(currentPage) || []).filter((item) => item.buddyBlogNo !== buddyBlogNo));
            }
          });
        }
      };
    },
    waitForEvent() { return new Promise((resolve) => { pendingDialogResolve = resolve; }); },
    async close() {}
  };

  const manager = new NeighborCleanerManager({
    browserSession: {
      connected: true,
      accountLabel: 'owner',
      context: { async newPage() { return page; } }
    }
  });

  const result = await manager.startCancelSent({
    olderThanDays: 7,
    maxCancelCount: 2,
    minDelaySec: 0,
    maxDelaySec: 0
  });

  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.processed, 2);
  assert.equal(result.stats.canceled, 2);
  assert.equal(result.stats.errors, 0);
  assert.equal(pages.get(1).length + pages.get(2).length, 0);
});

test('NeighborCleanerManager manages state, logs, and pause/resume/stop', () => {
  const manager = new NeighborCleanerManager();
  assert.equal(manager.state, 'idle');

  manager.log('테스트 로그 메시지', 'info');
  const state = manager.getState();
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].message, '테스트 로그 메시지');

  manager.state = 'running';
  manager.pause();
  assert.equal(manager.state, 'paused');
  assert.equal(manager.isPaused, true);

  manager.resume();
  assert.equal(manager.state, 'running');
  assert.equal(manager.isPaused, false);

  manager.stop();
  assert.equal(manager.state, 'stopped');
  assert.equal(manager.shouldStop, true);
});

test('NeighborCleanerManager accepts every received request when both AI filters are off', async () => {
  let acceptClicked = false;
  let aiCalled = false;
  const popup = {
    async waitForURL() {},
    async waitForLoadState() {},
    on() {},
    async $() {
      return { async click() {} };
    },
    async evaluate() {},
    isClosed() { return false; },
    async close() {}
  };
  const page = {
    async goto() {},
    async waitForTimeout() {},
    async content() {
      return '<table><tr><td><input name="targetBlogId" value="spam_user"></td><td><span class="nickname">광고 계정</span></td><td class="msg">대출 상담</td><td class="date">26.09.13.</td></tr></table>';
    },
    async waitForEvent() { return popup; },
    async $(selector) {
      assert.match(selector, /_acceptBuddy/);
      return { async click() { acceptClicked = true; } };
    },
    async close() {}
  };
  const manager = new NeighborCleanerManager({
    browserSession: {
      connected: true,
      accountLabel: 'owner',
      context: { async newPage() { return page; } }
    },
    embeddedLlama: {
      async chatCompletion() {
        aiCalled = true;
        throw new Error('accept-all mode must not call AI');
      }
    },
    neighborGroupStore: {
      getActiveGroupName() { return '소통이웃-1'; }
    }
  });

  const result = await manager.startCleanReceived({
    acceptGenuine: false,
    rejectSpam: false,
    minDelaySec: 0,
    maxDelaySec: 0
  });

  assert.equal(result.stats.accepted, 1);
  assert.equal(result.stats.rejected, 0);
  assert.equal(result.stats.skipped, 0);
  assert.equal(acceptClicked, true);
  assert.equal(aiCalled, false);
  assert.equal(manager.logs.some((entry) => entry.message.includes('조건 없이')), true);
  assert.equal(manager.logs.some((entry) => entry.message.includes('그룹: 소통이웃-1')), true);
});
