const $ = (selector) => document.querySelector(selector);
// Label of the Claude/Gemini subscription in use, shown in the header instead of the local model's name.
let cloudEngineLabel = '';
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  connected: false,
  items: [],
  selected: new Set(),
  deals: [],
  images: [],
  selectedImages: new Set(),
  imagePlans: [],
  managedComments: []
};

let commentAutoTimer = null;
const commentReplyProgress = { phase: 'idle', total: 0, completed: 0, failed: 0, current: '' };
let engagementNeighborQuotaTimer = null;

function updateCommentReplyProgress(next = {}) {
  Object.assign(commentReplyProgress, next);
  const { phase, total, completed, failed, current } = commentReplyProgress;
  const handled = completed + failed;
  const remaining = Math.max(total - handled, 0);
  const percent = total ? Math.min(Math.round((handled / total) * 100), 100) : 0;
  const status = $('#commentReplyProgressStatus');
  const currentEl = $('#commentReplyProgressCurrent');
  if ($('#commentReplyProgressCount')) $('#commentReplyProgressCount').textContent = `${handled} / ${total}건`;
  if ($('#commentReplyProgressCompleted')) $('#commentReplyProgressCompleted').textContent = String(completed);
  if ($('#commentReplyProgressFailed')) $('#commentReplyProgressFailed').textContent = String(failed);
  if ($('#commentReplyProgressRemaining')) $('#commentReplyProgressRemaining').textContent = String(remaining);
  if ($('#commentReplyProgressBar')) $('#commentReplyProgressBar').style.width = `${percent}%`;
  if (currentEl) currentEl.textContent = current || (phase === 'done' ? '처리가 완료되었습니다.' : '처리할 댓글을 선택해주세요.');
  if (status) {
    const labels = { running: '처리 중', done: '처리 완료', error: '오류', idle: '대기 중' };
    status.className = `status ${phase === 'running' ? 'loading' : phase === 'done' ? 'online' : phase === 'error' ? 'error' : ''}`;
    status.innerHTML = `<i></i> ${labels[phase] || labels.idle}`;
  }
}

function getNextKoreaMidnight(nowMs = Date.now()) {
  const koreaOffsetMs = 9 * 60 * 60 * 1000;
  const koreaNow = new Date(nowMs + koreaOffsetMs);
  return Date.UTC(
    koreaNow.getUTCFullYear(),
    koreaNow.getUTCMonth(),
    koreaNow.getUTCDate() + 1
  ) - koreaOffsetMs;
}

function renderEngagementNeighborQuota(summary = {}) {
  const limitInput = $('#engDailyNeighborLimit');
  const limit = Math.min(Math.max(Number(limitInput?.value) || 100, 1), 100);
  const used = Math.max(Number(summary.todayNeighbors) || 0, 0);
  const remaining = Math.max(limit - used, 0);
  const resetAt = getNextKoreaMidnight();
  const remainingMs = Math.max(resetAt - Date.now(), 0);
  const remainingHours = Math.floor(remainingMs / 3600000);
  const remainingMinutes = Math.floor((remainingMs % 3600000) / 60000);
  const resetLabel = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(resetAt));

  if ($('#engNeighborUsed')) $('#engNeighborUsed').textContent = String(used);
  if ($('#engNeighborRemaining')) $('#engNeighborRemaining').textContent = String(remaining);
  if ($('#engNeighborResetAt')) $('#engNeighborResetAt').textContent = `리셋: ${resetLabel} (약 ${remainingHours}시간 ${remainingMinutes}분 후)`;
}

async function refreshEngagementNeighborQuota() {
  try {
    renderEngagementNeighborQuota(await api('api/engagement/neighbor-quota'));
  } catch {
    if ($('#engNeighborResetAt')) $('#engNeighborResetAt').textContent = '신청 내역을 불러오지 못했습니다.';
  }
}

function initEngagementNeighborQuota() {
  if (engagementNeighborQuotaTimer) clearInterval(engagementNeighborQuotaTimer);
  refreshEngagementNeighborQuota();
  engagementNeighborQuotaTimer = setInterval(refreshEngagementNeighborQuota, 60 * 1000);
  $('#engDailyNeighborLimit')?.addEventListener('input', refreshEngagementNeighborQuota);
}

async function initNeighborGroupSetting() {
  try {
    const summary = await api('api/neighbors/summary').catch(() => null);
    if (summary?.activeNeighborGroup && $('#engActiveNeighborGroup')) {
      $('#engActiveNeighborGroup').value = summary.activeNeighborGroup;
    }
  } catch {}

  $('#saveEngGroupBtn')?.addEventListener('click', async () => {
    const name = ($('#engActiveNeighborGroup')?.value || '').trim();
    if (!name) {
      toast('그룹 이름을 입력해주세요.', 'warn');
      return;
    }
    try {
      const res = await api('api/neighbors/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName: name })
      });
      if (res?.activeNeighborGroup) {
        if ($('#engActiveNeighborGroup')) $('#engActiveNeighborGroup').value = res.activeNeighborGroup;
        toast(`적용 이웃 그룹이 '${res.activeNeighborGroup}'(으)로 저장되었습니다.`);
      }
    } catch (e) {
      toast(`그룹 설정 저장 실패: ${e.message}`, 'error');
    }
  });
}

function setConnected(connected, label = '') {
  state.connected = Boolean(connected);
  const statusBadge = $('#accountStatus');
  const accountLabel = $('#accountLabel');
  const loginFormContainer = $('#loginFormContainer');
  const connectedCard = $('#connectedCard');
  
  const settingsStatusBadge = $('#settingsAccountStatus');
  const settingsAccountLabel = $('#settingsAccountLabel');
  const settingsLoginFormContainer = $('#settingsLoginFormContainer');
  const settingsConnectedCard = $('#settingsConnectedCard');

  const engLoginBanner = $('#engLoginBanner');
  const publishLoginBanner = $('#publishLoginBanner');
  const publishAccountStatus = $('#publishAccountStatus');

  const topAccountBadge = $('#topAccountBadge');
  const topAccountStatusText = $('#topAccountStatusText');
  if (topAccountBadge) {
    topAccountBadge.className = `header-account-badge ${connected ? 'online' : 'offline'}`;
  }
  if (topAccountStatusText) {
    topAccountStatusText.textContent = connected ? (label ? `${label}` : '연결됨') : '네이버 로그인 필요';
  }

  if (statusBadge) {
    statusBadge.className = `status ${connected ? 'online' : ''}`;
    statusBadge.innerHTML = `<i></i> ${connected ? '연결됨' : '연결 안 됨'}`;
  }
  if (settingsStatusBadge) {
    settingsStatusBadge.className = `status ${connected ? 'online' : ''}`;
    settingsStatusBadge.innerHTML = `<i></i> ${connected ? '연결됨' : '연결 안 됨'}`;
  }
  if (publishAccountStatus) {
    publishAccountStatus.className = `status ${connected ? 'online' : ''}`;
    publishAccountStatus.innerHTML = `<i></i> ${connected ? '네이버 연결됨' : '네이버 연결 안 됨'}`;
  }

  if (accountLabel && label) accountLabel.textContent = label;
  if (settingsAccountLabel && label) settingsAccountLabel.textContent = label;

  if (loginFormContainer) loginFormContainer.classList.toggle('hidden', connected);
  if (connectedCard) connectedCard.classList.toggle('hidden', !connected);
  if (settingsLoginFormContainer) settingsLoginFormContainer.classList.toggle('hidden', connected);
  if (settingsConnectedCard) settingsConnectedCard.classList.toggle('hidden', !connected);

  if (engLoginBanner) engLoginBanner.classList.toggle('hidden', connected);
  if (publishLoginBanner) publishLoginBanner.classList.toggle('hidden', connected);
}

const loginForm = $('#loginForm');
const searchPanel = $('#searchPanel');
const results = $('#results');
const selectionBar = $('#selectionBar');
const confirmReview = $('#confirmReview');
const openButton = $('#openButton');
const manualLoginButton = $('#manualLoginButton');
const workspaceTabs = [...document.querySelectorAll('.workspace-tabs > [role="tab"]')].filter((tab) => !tab.classList.contains('hidden'));
const fetchDealsButton = $('#fetchDealsButton');
const dealsResults = $('#dealsResults');
const draftForm = $('#draftForm');
const draftButton = $('#draftButton');
const publishForm = $('#publishForm');
const publishConfirm = $('#publishConfirm');
const publishButton = $('#publishButton');
const imageSearchButton = $('#imageSearchButton');
const imageResults = $('#imageResults');

function organizeCommentCategory() {
  const feedWorkspace = $('#feedWorkspace');
  const feedMount = $('#neighborFeedCommentMount');
  const ownPostPanel = $('#subtabCommentInbox');
  const ownPostMount = $('#ownPostReplyMount');

  if (feedWorkspace && feedMount) {
    feedWorkspace.classList.remove('workspace-panel', 'hidden');
    feedWorkspace.removeAttribute('role');
    feedWorkspace.removeAttribute('aria-labelledby');
    feedWorkspace.removeAttribute('data-tab-panel');
    feedMount.append(feedWorkspace);
  }
  if (ownPostPanel && ownPostMount) {
    ownPostPanel.classList.remove('cleaner-subtab-panel');
    ownPostPanel.classList.remove('hidden');
    ownPostMount.append(ownPostPanel);
  }

  $$('.category-mode-tab').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.commentMode;
      $$('.category-mode-tab').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      feedMount?.classList.toggle('hidden', mode !== 'neighbor-feed');
      ownPostMount?.classList.toggle('hidden', mode !== 'own-post-reply');
      if (mode === 'neighbor-feed') {
        if (typeof refreshFeedSummary === 'function') refreshFeedSummary();
      }
    });
  });
}

organizeCommentCategory();

function setActiveTab(tabName, moveFocus = false) {
  workspaceTabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && moveFocus) tab.focus();
  });
  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== tabName);
  });
  if (tabName === 'comments') {
    const feedModeActive = $('.category-mode-tab[data-comment-mode="neighbor-feed"]')?.classList.contains('active');
    if (feedModeActive) {
      if (typeof refreshFeedSummary === 'function') refreshFeedSummary();
    }
  }
}

workspaceTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + workspaceTabs.length) % workspaceTabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % workspaceTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = workspaceTabs.length - 1;
    setActiveTab(workspaceTabs[nextIndex].dataset.tab, true);
  });
});

// This desktop app exposes engagement only; settings remains available as its
// independent configuration surface.
setActiveTab('engagement');

function renderManagedComments() {
  const body = $('#commentManagementBody');
  const processButton = $('#processMyCommentsBtn');
  if (!body) return;
  if (!state.managedComments.length) {
    body.innerHTML = `<tr>
      <td colspan="5" class="comment-empty-cell">
        <div class="comment-empty-state">
          <div class="empty-text">
            <strong>새로 처리할 댓글이 없습니다</strong>
            <small>목록 조회를 눌러 최근 댓글을 확인하세요.</small>
          </div>
        </div>
      </td>
    </tr>`;
    if (processButton) processButton.disabled = true;
    return;
  }
  body.innerHTML = state.managedComments.map((item, index) => {
    const authorInitial = escapeHtml((item.authorName || item.authorId || '?').slice(0, 1));
    return `<tr>
      <td style="text-align: center;"><input type="checkbox" class="managed-comment-check" data-index="${index}" checked></td>
      <td><a href="${escapeHtml(item.postUrl)}" target="_blank" rel="noopener noreferrer" class="post-link" title="${escapeHtml(item.postTitle || '게시글 바로가기')}">${escapeHtml(item.postTitle || '제목 없음')} ↗</a></td>
      <td>
        <div class="author-badge">
          <span class="author-avatar">${authorInitial}</span>
          <div class="author-meta">
            <strong class="author-name">${escapeHtml(item.authorName || item.authorId || '알 수 없음')}</strong>
            <small class="author-id">${escapeHtml(item.authorId || '')}</small>
          </div>
        </div>
      </td>
      <td><div class="comment-bubble-inbox">${escapeHtml(item.text || '')}</div></td>
      <td style="text-align: right;"><span class="date-badge">${escapeHtml(item.dateText || '-')}</span></td>
    </tr>`;
  }).join('');
  if (processButton) processButton.disabled = false;
}

async function loadCommentManagementHistory() {
  const container = $('#commentManagementHistory');
  if (!container) return;
  const data = await api('api/comment-management/history').catch(() => ({ records: [] }));
  const records = (data.records || []).slice(0, 50);
  container.innerHTML = records.length ? records.map((item) => {
    const authorInitial = escapeHtml((item.authorName || item.authorId || '?').slice(0, 1));
    const isCompleted = item.status === 'completed';
    const neighborText = friendlyUiMessage(item.neighborMessage || item.neighborStatus || '', '');
    const isNeighborOk = neighborText.includes('완료') || neighborText.includes('확인') || neighborText.includes('성공');
    const timeFormatted = item.repliedAt ? new Date(item.repliedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="managed-history-card">
      <div class="mhc-header">
        <div class="mhc-author-group">
          <span class="mhc-avatar">${authorInitial}</span>
          <div class="mhc-author-info">
            <strong class="mhc-name">${escapeHtml(item.authorName || item.authorId || '댓글 작성자')}</strong>
            <span class="mhc-time">${escapeHtml(timeFormatted)}</span>
          </div>
        </div>
        <span class="mhc-status-pill ${isCompleted ? 'pill-success' : 'pill-danger'}">
          ${isCompleted ? '완료' : '실패'}
        </span>
      </div>
      <div class="mhc-body">
        <div class="mhc-quote received">
          <span class="quote-label">받은 댓글</span>
          <div class="quote-text">${escapeHtml(item.text || '')}</div>
        </div>
        <div class="mhc-quote reply">
          <span class="quote-label">작성된 AI 대댓글</span>
          <div class="quote-text">${escapeHtml(friendlyUiMessage(item.replyText || item.error || '-'))}</div>
        </div>
      </div>
      ${neighborText ? `<div class="mhc-footer">
        <span class="neighbor-badge ${isNeighborOk ? 'neighbor-ok' : ''}">
          서로이웃: ${escapeHtml(neighborText)}
        </span>
      </div>` : ''}
    </div>`;
  }).join('') : `<div class="comment-empty-state">
    <div class="empty-text">
      <strong>처리 기록이 없습니다</strong>
      <small>AI 대댓글과 서로이웃 신청 결과가 여기에 표시됩니다.</small>
    </div>
  </div>`;
}

async function scanManagedComments({ processAll = false } = {}) {
  if (!state.connected) throw new Error('먼저 네이버 계정을 연결해주세요.');
  const button = $('#scanMyCommentsBtn');
  const status = $('#commentManagementStatus');
  if (button) button.disabled = true;
  $('#commentManagementSummaryStrip')?.classList.remove('hidden');
  if (status) { status.className = 'status loading'; status.innerHTML = '<i></i> 목록 조회 중'; }
  if ($('#commentManagementSummary')) $('#commentManagementSummary').textContent = '내 글의 댓글 목록을 조회하고 있습니다. 잠시만 기다려주세요.';
  try {
    const limit = Math.min(Math.max(Number($('#commentPostLimit')?.value) || 10, 1), 30);
    const data = await api(`api/comment-management/scan?postLimit=${limit}`);
    state.managedComments = data.comments || [];
    renderManagedComments();
    updateCommentReplyProgress({ phase: 'idle', total: 0, completed: 0, failed: 0, current: state.managedComments.length ? '처리할 댓글을 선택해주세요.' : '새 댓글이 없습니다.' });
    if ($('#commentManagementSummary')) $('#commentManagementSummary').textContent = `조회 완료 · 최근 글 ${data.scannedPosts || 0}개에서 새 댓글 ${state.managedComments.length}개를 찾았습니다.`;
    if (status) { status.className = `status ${state.managedComments.length ? 'online' : ''}`; status.innerHTML = `<i></i> ${state.managedComments.length}개 대기`; }
    if (processAll && state.managedComments.length) await processManagedComments(state.managedComments);
    return data;
  } catch (error) {
    if (status) { status.className = 'status error'; status.innerHTML = '<i></i> 조회 실패'; }
    if ($('#commentManagementSummary')) $('#commentManagementSummary').textContent = `조회 실패 · ${error.message}`;
    throw error;
  } finally { if (button) button.disabled = false; }
}

async function processManagedComments(items = null) {
  const selected = items || [...document.querySelectorAll('.managed-comment-check:checked')].map((box) => state.managedComments[Number(box.dataset.index)]).filter(Boolean);
  if (!selected.length) return toast('처리할 댓글을 선택해주세요.', true);

  const button = $('#processMyCommentsBtn');
  const summary = $('#commentManagementSummary');
  const requestNeighbor = $('#commentRequestNeighbor')?.checked !== false;

  if (button) button.disabled = true;
  $('#commentManagementSummaryStrip')?.classList.remove('hidden');

  let completedCount = 0;
  let failedCount = 0;
  updateCommentReplyProgress({ phase: 'running', total: selected.length, completed: 0, failed: 0, current: '대댓글 처리를 준비하고 있습니다.' });

  try {
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const authorLabel = item.authorName || item.authorId || '작성자';
      const progressText = `AI 대댓글 작성 중 (${i + 1}/${selected.length})`;

      if (button) button.textContent = progressText;
      if (summary) {
        summary.innerHTML = `<span style="color: #03c75a; font-weight: 700;">[${i + 1}/${selected.length}]</span> <strong>${escapeHtml(authorLabel)}</strong> 님의 댓글에 AI 대댓글을 작성 중입니다.${requestNeighbor ? ' 작성 후 서로이웃 신청도 확인합니다.' : ''}`;
      }
      updateCommentReplyProgress({ current: `${authorLabel} 님의 대댓글을 작성 중입니다.` });

      try {
        const data = await api('api/comment-management/process', {
          method: 'POST',
          body: JSON.stringify({
            comments: [item],
            requestNeighbor,
            returnVisit: $('#commentReturnVisit')?.checked === true,
            secretComment: $('#commentReturnVisitSecret')?.checked === true
          })
        });

        const resItem = (data.results || [])[0];
        if (resItem?.status === 'completed') {
          completedCount++;
        } else {
          failedCount++;
        }
        updateCommentReplyProgress({ completed: completedCount, failed: failedCount, current: `${authorLabel} 님 처리 결과를 반영했습니다.` });

        // Immediately update state and table so this comment disappears from inbox
        state.managedComments = state.managedComments.filter((c) => c.commentId !== item.commentId);
        renderManagedComments();

        // Immediately refresh history feed so the new card appears in real time!
        await loadCommentManagementHistory();
      } catch (err) {
        failedCount++;
        updateCommentReplyProgress({ completed: completedCount, failed: failedCount, current: `${authorLabel} 님 처리에 실패했습니다.` });
        toast(`'${authorLabel}' 댓글 처리 실패: ${err.message}`, true);
      }
    }

    if (summary) {
      summary.textContent = `처리가 완료되었습니다. (성공: ${completedCount}건${failedCount > 0 ? `, 실패: ${failedCount}건` : ''})`;
    }
    updateCommentReplyProgress({ phase: 'done', completed: completedCount, failed: failedCount, current: `처리가 완료되었습니다. 성공 ${completedCount}건, 실패 ${failedCount}건` });
    toast(`${completedCount}개 댓글 처리를 완료했습니다.${failedCount > 0 ? ` (${failedCount}개 실패)` : ''}`);
  } finally {
    if (button) {
      button.textContent = '선택한 댓글에 AI 대댓글 달기';
      button.disabled = !state.managedComments.length;
    }
  }
}

function initCommentManagement() {
  $('#scanMyCommentsBtn')?.addEventListener('click', () => scanManagedComments().catch((error) => toast(error.message, true)));
  $('#processMyCommentsBtn')?.addEventListener('click', () => processManagedComments().catch((error) => toast(error.message, true)));
  $('#refreshCommentHistoryBtn')?.addEventListener('click', loadCommentManagementHistory);
  $('#selectAllMyComments')?.addEventListener('change', (event) => $$('.managed-comment-check').forEach((box) => { box.checked = event.target.checked; }));
  $('#toggleCommentAutoBtn')?.addEventListener('click', async (event) => {
    if (commentAutoTimer) {
      clearInterval(commentAutoTimer); commentAutoTimer = null;
      event.currentTarget.textContent = '5분마다 새 댓글 확인 시작';
      return toast('자동 댓글 확인을 멈췄습니다.');
    }
    event.currentTarget.textContent = '자동 댓글 확인 중지';
    const run = () => scanManagedComments({ processAll: true }).catch((error) => toast(error.message, true));
    await run();
    commentAutoTimer = setInterval(run, 5 * 60 * 1000);
  });

  // Post limit quick chips
  $$('.post-limit-chips .chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.post-limit-chips .chip-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const input = $('#commentPostLimit');
      if (input) {
        input.value = btn.dataset.limit;
        input.dispatchEvent(new Event('input'));
      }
    });
  });
  $('#commentPostLimit')?.addEventListener('input', (e) => {
    const val = e.target.value;
    $$('.post-limit-chips .chip-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.limit === val);
    });
  });

  loadCommentManagementHistory();
}

async function api(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text.slice(0, 150) };
    }
    if (response.status === 402 && body.licenseRequired) {
      openLicenseModal();
    }
    if (!response.ok) {
      throw new Error(body.error || body.message || `서버 오류 (${response.status} ${response.statusText})`);
    }
    return body;
  } catch (err) {
    if (err.name === 'TypeError' && String(err.message).toLowerCase().includes('fetch')) {
      throw new Error('서버(Node.js)와 연결할 수 없습니다. 터미널에서 npm start로 서버가 켜져 있는지 확인해주세요.');
    }
    throw err;
  }
}

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.className = 'toast', 4200);
}

fetchDealsButton?.addEventListener('click', async () => {
  fetchDealsButton.disabled = true;
  fetchDealsButton.textContent = '알구몬 긁어오는 중…';
  try {
    const data = await api('api/blog/deals?refresh=true&limit=5');
    state.deals = data.deals || [];
    renderDeals();
    draftButton.disabled = state.deals.length === 0;
    toast(`알구몬 랭킹 최저가 ${state.deals.length}개를 성공적으로 가져왔습니다.`);
  } catch (error) {
    toast(`알구몬 핫딜 수집 실패: ${error.message}`, true);
  } finally {
    fetchDealsButton.disabled = false;
    fetchDealsButton.textContent = '알구몬 최저가 5개 긁어오기 (새로고침)';
  }
});

function renderDeals() {
  $('#dealsEmpty').classList.toggle('hidden', state.deals.length > 0);
  dealsResults.classList.toggle('hidden', state.deals.length === 0);
  dealsResults.innerHTML = state.deals.map((deal) => `
    <div class="deal-item-card">
      <div class="deal-badge-row">
        <span class="deal-rank-badge">${deal.rank}위</span>
        <span class="deal-shop-badge">${escapeHtml(deal.shop)}</span>
        <span class="deal-source-badge">${escapeHtml(deal.source)}</span>
      </div>
      <div class="deal-item-body">
        ${deal.image ? `<img src="${escapeHtml(deal.image)}" alt="${escapeHtml(deal.title)}" class="deal-thumb" loading="lazy">` : ''}
        <div class="deal-item-info">
          <strong class="deal-title">${escapeHtml(deal.title)}</strong>
          <div class="deal-price-row">
            <span class="deal-price">${escapeHtml(deal.price)}</span>
            <span class="deal-shipping">${escapeHtml(deal.shipping)}</span>
          </div>
          ${deal.url ? `<a href="${escapeHtml(deal.url)}" target="_blank" rel="noopener noreferrer" class="deal-link">${deal.linkType === 'product' ? '상품 보기' : '원문 보기'} ↗</a>` : '<span class="deal-link unavailable">상품 링크 확인 필요</span>'}
        </div>
      </div>
    </div>`).join('');
}

draftForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.deals.length) {
    return toast('먼저 알구몬 핫딜을 긁어와주세요.', true);
  }
  const button = $('#draftButton');
  button.disabled = true;
  button.textContent = '112 LLM 핫딜 글 작성 중…';
  $('#llmStatus').className = 'status';
  try {
    const model = $('#dealsModelSelect')?.value || '';
    const data = await api('api/blog/deals/draft', {
      method: 'POST',
      body: JSON.stringify({
        deals: state.deals,
        tone: $('#postTone').value,
        length: $('#postLength').value,
        notes: $('#postNotes').value,
        model
      })
    });
    $('#postTitle').value = data.title;
    $('#postContent').value = data.content;
    $('#postTags').value = (data.tags || []).join(', ');
    $('#imageQuery').value = data.imageQueries?.[0] || '핫딜 쇼핑';
    state.imagePlans = data.imagePlans || [];
    
    // Set deal images
    state.images = data.dealImages || [];
    state.selectedImages = new Set(state.images.map((_, i) => i));
    renderImages();

    $('#draftModel').textContent = data.engineLabel || data.model || '112 로컬 LLM';
    renderPostSource({ sourceUrl: 'https://www.algumon.com/n/deal/rank', source: '알구몬 실시간 핫딜 랭킹' });
    publishForm.classList.remove('hidden');
    $('#llmStatus').className = 'status online';
    publishForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updatePublishState();
    toast(`[${data.engineLabel || data.model || 'AI'}] 핫딜 블로그 글 작성을 완료했습니다. 검토 후 발행하세요!`);
  } catch (error) {
    $('#llmStatus').className = 'status';
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = '로컬 LLM으로 핫딜 글 다시 작성';
  }
});

// ---------------------------------------------------------------------------
// AI Auto Posting Sub Mode Switcher & Article Rewrite Controller
// ---------------------------------------------------------------------------

$('#modeArticleBtn')?.addEventListener('click', () => {
  const artBtn = $('#modeArticleBtn');
  const dlBtn = $('#modeDealsBtn');
  if (artBtn) artBtn.className = 'button primary small mode-tab-btn';
  if (dlBtn) dlBtn.className = 'button secondary small mode-tab-btn';
  $('#articleModeContainer')?.classList.remove('hidden');
  $('#dealsModeContainer')?.classList.add('hidden');
});

$('#modeDealsBtn')?.addEventListener('click', () => {
  const artBtn = $('#modeArticleBtn');
  const dlBtn = $('#modeDealsBtn');
  if (dlBtn) dlBtn.className = 'button primary small mode-tab-btn';
  if (artBtn) artBtn.className = 'button secondary small mode-tab-btn';
  $('#dealsModeContainer')?.classList.remove('hidden');
  $('#articleModeContainer')?.classList.add('hidden');
});

$('#extractArticleBtn')?.addEventListener('click', async () => {
  const input = $('#articleSourceInput')?.value?.trim();
  if (!input) return toast('기사 URL 또는 본문 텍스트를 먼저 입력해주세요.', true);
  const btn = $('#extractArticleBtn');
  btn.disabled = true;
  btn.textContent = '추출 중...';
  try {
    const data = await api('api/blog/article/extract', {
      method: 'POST',
      body: JSON.stringify({ urlOrText: input })
    });
    if (data.title && data.content) {
      toast(`'${data.title.slice(0, 30)}...' 기사(${data.content.length}자)를 성공적으로 분석/추출했습니다!`);
    }
  } catch (err) {
    toast(`기사 추출 실패: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 본문/제목 미리 가져오기';
  }
});

$('#articleDraftForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const sourceInput = $('#articleSourceInput')?.value?.trim();
  if (!sourceInput) return toast('뉴스 기사 URL 또는 본문 텍스트를 입력해주세요.', true);

  const btn = $('#articleDraftBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> <strong>AI가 기사를 분석하고 맞춤 고화질 그림을 생성 중...</strong>';
  $('#llmStatus').className = 'status';

  try {
    const tone = $('#articleTone')?.value || 'friendly';
    const length = $('#articleLength')?.value || 'medium';
    const notes = $('#articleNotes')?.value?.trim() || '';
    const model = $('#articleModelSelect')?.value || '';
    const imageStyle = $('#articleImageStyle')?.value || 'photorealistic';

    const data = await api('api/blog/article/draft', {
      method: 'POST',
      body: JSON.stringify({
        urlOrText: sourceInput,
        tone,
        length,
        notes,
        model,
        imageStyle
      })
    });

    $('#postTitle').value = data.title;
    $('#postContent').value = data.content;
    $('#postTags').value = (data.tags || []).join(', ');
    $('#imageQuery').value = data.imageQueries?.[0] || data.title.slice(0, 20);
    state.imagePlans = data.imagePlans || [];

    // Set auto-matched images
    state.images = data.autoImages || [];
    state.selectedImages = new Set(state.images.map((_, i) => i));
    renderImages();

    $('#draftModel').textContent = data.engineLabel || data.model || '112 로컬 LLM';
    if (data.sourceUrl) {
      renderPostSource({ sourceUrl: data.sourceUrl, source: '참조 뉴스/포스팅 원문' });
    } else {
      renderPostSource(null);
    }

    publishForm.classList.remove('hidden');
    $('#llmStatus').className = 'status online';
    publishForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (publishConfirm) publishConfirm.checked = true;
    updatePublishState();
    toast(`✨ [${data.engineLabel || data.model}] 기사 재해석 및 고화질 맞춤 그림 생성이 완료되었습니다!`);
  } catch (error) {
    $('#llmStatus').className = 'status';
    toast(`AI 글 작성 실패: ${error.message}`, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">✨</span> <strong>AI 기사 분석 &amp; 맞춤 그림 자동 생성 (1클릭 완료)</strong>';
  }
});

function renderPostSource(sourceInfo) {
  const sourceCard = $('#postSource');
  if (!sourceInfo?.sourceUrl) {
    sourceCard.classList.add('hidden');
    sourceCard.textContent = '';
    return;
  }
  sourceCard.innerHTML = `참고 핫딜 출처: <a href="${escapeHtml(sourceInfo.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceInfo.source || '알구몬 랭킹')} ↗</a>`;
  sourceCard.classList.remove('hidden');
}

imageSearchButton?.addEventListener('click', () => {
  loadImages().catch((error) => toast(error.message, true));
});

async function loadImages() {
  const query = $('#imageQuery')?.value?.trim() || '';
  if (query.length < 2) throw new Error('이미지 검색어를 2자 이상 입력해주세요.');
  if (imageSearchButton) {
    imageSearchButton.disabled = true;
    imageSearchButton.textContent = '찾는 중…';
  }
  try {
    const sourceUrl = state.selectedTrend?.sourceUrl || '';
    const data = await api(`api/blog/images?query=${encodeURIComponent(query)}&sourceUrl=${encodeURIComponent(sourceUrl)}`);
    state.images = data.items || [];
    state.selectedImages.clear();
    renderImages();
    if (!state.images.length) toast('재사용 가능한 관련 이미지를 찾지 못했습니다.', true);
  } finally {
    if (imageSearchButton) {
      imageSearchButton.disabled = false;
      imageSearchButton.textContent = '이미지 다시 찾기';
    }
  }
}

async function loadAutoImages() {
  if (!state.imagePlans.length) return loadImages();
  if (imageSearchButton) {
    imageSearchButton.disabled = true;
    imageSearchButton.textContent = '문단별 선별 중…';
  }
  try {
    const sourceUrl = state.selectedTrend?.sourceUrl || '';
    const topic = $('#postTitle')?.value || '핫딜';
    const data = await api('api/blog/images/auto', {
      method: 'POST',
      body: JSON.stringify({ topic, plans: state.imagePlans, sourceUrl })
    });
    state.images = data.items || [];
    state.selectedImages = new Set(state.images.map((_image, index) => index));
    renderImages();
    if (!state.images.length) toast('문맥과 정확히 맞는 재사용 이미지를 찾지 못했습니다. 검색어를 바꿔 직접 찾아보세요.', true);
  } finally {
    if (imageSearchButton) {
      imageSearchButton.disabled = false;
      imageSearchButton.textContent = '이미지 다시 찾기';
    }
  }
}

function renderImages() {
  $('#imageEmpty')?.classList.toggle('hidden', state.images.length > 0);
  if ($('#imageEmpty')) {
    $('#imageEmpty').textContent = state.images.length
      ? ''
      : '배치된 시각 이미지가 없습니다. 상단에서 AI 글을 작성하거나 이미지를 추가해보세요.';
  }
  imageResults?.classList.toggle('hidden', state.images.length === 0);
  if (imageResults) {
    imageResults.innerHTML = state.images.map((image, index) => {
      const isAi = image.isAiGenerated || image.license?.includes('Gemma');
      return `
      <label class="image-card${state.selectedImages.has(index) ? ' selected' : ''}${isAi ? ' ai-card' : ''}" data-image-index="${index}" style="${isAi ? 'border: 2px solid #3182ce; background: #f0f7ff;' : ''}">
        <input type="checkbox" value="${escapeHtml(image.id)}" aria-label="${escapeHtml(image.title)} 선택"${state.selectedImages.has(index) ? ' checked' : ''}>
        <img src="${escapeHtml(image.previewUrl)}" alt="${escapeHtml(image.description || image.title)}" loading="lazy" style="object-fit:cover; border-radius:6px;">
        <span>
          ${isAi ? `<div style="color:#2b6cb0; font-size:11px; font-weight:800; margin-bottom:2px;">⚡ 로컬 AI 생성 그림</div>` : ''}
          <strong>${escapeHtml(image.title)}</strong>
          <small>${escapeHtml([image.author, image.license].filter(Boolean).join(' · '))}</small>
          ${image.afterHeading ? `<em>“${escapeHtml(image.afterHeading)}” 뒤에 삽입</em>` : ''}
          ${image.caption ? `<p>${escapeHtml(image.caption)}</p>` : ''}
        </span>
      </label>`;
    }).join('');
    imageResults.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => {
      if (input.checked && state.selectedImages.size >= 5) {
        input.checked = false;
        return toast('이미지는 최대 5장까지 선택할 수 있습니다.', true);
      }
      const index = Number(input.closest('.image-card').dataset.imageIndex);
      input.checked ? state.selectedImages.add(index) : state.selectedImages.delete(index);
      input.closest('.image-card').classList.toggle('selected', input.checked);
    }));
  }
}

publishConfirm?.addEventListener('change', updatePublishState);
$('#postTitle')?.addEventListener('input', updatePublishState);
$('#postContent')?.addEventListener('input', updatePublishState);

function updatePublishState() {
  if (!publishButton) return;
  const title = ($('#postTitle')?.value || '').trim();
  const content = ($('#postContent')?.value || '').trim();
  const ready = state.connected
    && title.length >= 2
    && content.length >= 20;
  publishButton.disabled = !ready;
  $('#publishHelp')?.classList.toggle('hidden', state.connected);
}

publishForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.connected) return updatePublishState();
  publishButton.disabled = true;
  publishButton.textContent = '네이버에 발행 중…';
  $('#publishedLink')?.classList.add('hidden');
  try {
    const data = await api('api/blog/publish', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#postTitle')?.value || '',
        content: $('#postContent')?.value || '',
        tags: ($('#postTags')?.value || '').split(',').map((tag) => tag.trim()).filter(Boolean),
        images: [...state.selectedImages].sort((a, b) => a - b).map((index, order) => {
          const image = state.images[index];
          return image ? { ...image, afterHeading: image.afterHeading || state.imagePlans[order]?.afterHeading || '' } : null;
        }).filter(Boolean),
        confirmed: true,
        confirmationText: '발행'
      })
    });
    if (data.status === 'published') {
      if (publishConfirm) publishConfirm.checked = false;
      if (data.url && $('#publishedLink')) {
        $('#publishedLink').href = data.url;
        $('#publishedLink').classList.remove('hidden');
      }
      toast('네이버 블로그에 글을 발행했습니다.');
    } else {
      toast(data.message || '열린 네이버 창에서 발행 상태를 확인해주세요.', true);
    }
  } catch (error) {
    if (error.message.includes('로그인 세션이 만료')) setConnected(false);
    toast(error.message, true);
  } finally {
    publishButton.textContent = '블로그에 게시 발행';
    updatePublishState();
  }
});

async function handleIdPwLogin(form, idInputId, pwInputId) {
  const btn = form?.querySelector('button[type="submit"]');
  const id = $(idInputId)?.value?.trim() || '';
  const password = $(pwInputId)?.value || '';
  if (!id || !password) return toast('아이디와 비밀번호를 입력해주세요.', true);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '네이버 로그인 중…';
  }
  toast('네이버 계정으로 로그인 중입니다. 잠시만 기다려주세요…');
  try {
    const data = await api('api/naver/login', {
      method: 'POST',
      body: JSON.stringify({ id, password })
    });
    if ($(pwInputId)) $(pwInputId).value = '';
    if (!data.connected) {
      toast(data.message || '네이버 로그인을 완료하지 못했습니다.', true);
      return;
    }
    setConnected(true, data.accountLabel);
    toast('네이버 계정이 성공적으로 연결되어 세션이 영구 저장되었습니다!');
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '네이버 로그인하고 연결';
    }
  }
}

$('#accountForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  handleIdPwLogin(e.currentTarget, '#userId', '#userPassword');
});

$('#publishLoginForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  handleIdPwLogin(e.currentTarget, '#pubUserId', '#pubUserPassword');
});

$('#cookieForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '연결 중…';
  }
  try {
    const nidAut = $('#cookieAut')?.value?.trim() || '';
    const nidSes = $('#cookieSes')?.value?.trim() || '';
    if (!nidAut || !nidSes) return toast('NID_AUT와 NID_SES 값을 모두 입력해주세요.', true);
    const res = await api('api/naver/inject-cookies', {
      method: 'POST',
      body: JSON.stringify({ nidAut, nidSes })
    });
    if (res.success || res.connected) {
      setConnected(true, '쿠키 연결됨');
      toast('네이버 쿠키가 성공적으로 등록되었습니다!');
    } else {
      toast(res.message || '쿠키 등록에 실패했습니다.', true);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '쿠키로 즉시 연결하기';
    }
  }
});

async function refreshDailySummary() {
  try {
    const summary = await api('api/neighbors/summary');
    if ($('#dailyLimitBadge')) {
      $('#dailyLimitBadge').innerHTML = `📊 오늘 누적 신청: <strong>${summary.todayCount || 0}</strong>건`;
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// 서로이웃 자동화 (Nomalab Style Automation) 컨트롤러
// ---------------------------------------------------------------------------

let sseSource = null;

function initAutoNeighborEvents() {
  if (sseSource) return;
  sseSource = new EventSource('api/neighbors/auto/events');

  sseSource.addEventListener('status', (e) => {
    try {
      const status = JSON.parse(e.data);
      updateAutoDashboard(status);
    } catch {}
  });

  sseSource.addEventListener('log', (e) => {
    try {
      const log = JSON.parse(e.data);
      appendTerminalLog(log);
    } catch {}
  });

  sseSource.onerror = () => {
    // Reconnect will happen automatically
  };
}

function updateAutoDashboard(status) {
  const { state: autoState, config, stats, logs } = status || {};
  const isRunning = autoState === 'running';
  const isPaused = autoState === 'paused';
  const isWorking = isRunning || isPaused;

  const liveDashboard = $('#liveDashboard');
  const startBtn = $('#startAutoBtn');
  const pauseBtn = $('#pauseAutoBtn');
  const resumeBtn = $('#resumeAutoBtn');
  const stopBtn = $('#stopAutoBtn');

  if (liveDashboard && (isWorking || autoState === 'completed' || autoState === 'limit_reached' || autoState === 'stopped')) {
    liveDashboard.classList.remove('hidden');
  }

  // Button state toggle
  startBtn?.classList.toggle('hidden', isWorking);
  pauseBtn?.classList.toggle('hidden', !isRunning);
  resumeBtn?.classList.toggle('hidden', !isPaused);
  stopBtn?.classList.toggle('hidden', !isWorking);

  // Status text
  const statusText = $('#dashboardStatusText');
  if (statusText) {
    if (isRunning) statusText.textContent = `🚀 자동 신청 진행 중... (키워드: ${config?.keyword || ''})`;
    else if (isPaused) statusText.textContent = '⏸️ 작업이 일시정지되었습니다.';
    else if (autoState === 'completed') statusText.textContent = '🏁 목표 달성! 서로이웃 신청이 완료되었습니다.';
    else if (autoState === 'limit_reached') statusText.textContent = '⚠️ 네이버 일일 한도(100명) 도달로 중단되었습니다.';
    else if (autoState === 'stopped') statusText.textContent = '⏹️ 사용자에 의해 작업이 중단되었습니다.';
    else if (autoState === 'error') statusText.textContent = '❌ 작업 중 오류가 발생했습니다.';
  }

  // Delay countdown
  const delayBadge = $('#delayBadge');
  const delaySeconds = $('#delaySeconds');
  if (delayBadge && delaySeconds) {
    if (stats?.delayCountdown > 0 && isRunning) {
      delayBadge.classList.remove('hidden');
      delaySeconds.textContent = stats.delayCountdown;
    } else {
      delayBadge.classList.add('hidden');
    }
  }

  // Stats cards
  const target = stats?.targetCount || config?.targetCount || 0;
  const success = stats?.successCount || 0;
  const skipped = stats?.skippedCount || 0;
  const failed = stats?.failedCount || 0;

  if ($('#statTarget')) $('#statTarget').textContent = target;
  if ($('#statSuccess')) $('#statSuccess').textContent = success;
  if ($('#statSkipped')) $('#statSkipped').textContent = skipped;
  if ($('#statFailed')) $('#statFailed').textContent = failed;

  // Progress Bar
  const pct = target > 0 ? Math.min(Math.round((success / target) * 100), 100) : 0;
  if ($('#progressBarFill')) $('#progressBarFill').style.width = `${pct}%`;
  if ($('#progressPercent')) $('#progressPercent').textContent = `${pct}%`;
  if ($('#progressCounts')) $('#progressCounts').textContent = `${success} / ${target}명 완료`;

  refreshDailySummary();
}

function appendTerminalLog(log) {
  const terminal = $('#terminalLogs');
  if (!terminal) return;

  const line = document.createElement('div');
  line.className = `terminal-line ${log.type || 'info'}`;
  line.textContent = `[${log.time || new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${log.message}`;
  terminal.appendChild(line);

  // Auto scroll to bottom
  terminal.scrollTop = terminal.scrollHeight;
}

// Preset and quick buttons
document.querySelectorAll('.auto-chips button').forEach((btn) => {
  btn.addEventListener('click', () => {
    if ($('#autoKeyword')) $('#autoKeyword').value = btn.textContent.trim();
  });
});

document.querySelectorAll('.quick-counts button').forEach((btn) => {
  btn.addEventListener('click', () => {
    if ($('#targetCount')) $('#targetCount').value = btn.dataset.val;
  });
});

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if ($('#autoMessage')) $('#autoMessage').value = btn.dataset.tpl;
  });
});

function copyTerminalLogs(containerSelector) {
  const container = $(containerSelector);
  if (!container) return;
  const lines = [...container.querySelectorAll('.terminal-line')].map((el) => el.innerText.trim()).filter(Boolean);
  if (!lines.length) return toast('복사할 로그 내용이 없습니다.', true);
  const text = lines.join('\n');
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      toast('📋 전체 로그가 클립보드에 복사되었습니다!');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('📋 전체 로그가 클립보드에 복사되었습니다!');
  } catch {
    toast('로그 복사에 실패했습니다.', true);
  } finally {
    document.body.removeChild(ta);
  }
}

$('#copyLogsBtn')?.addEventListener('click', () => {
  copyTerminalLogs('#terminalLogs');
});

$('#clearLogsBtn')?.addEventListener('click', () => {
  const terminal = $('#terminalLogs');
  if (terminal) terminal.innerHTML = '<div class="terminal-line info">[로그 초기화됨]</div>';
});

// Automation action triggers
$('#startAutoBtn')?.addEventListener('click', async () => {
  const keyword = $('#autoKeyword')?.value?.trim();
  if (!keyword) return toast('타겟 검색 키워드를 입력해주세요.', true);

  const targetCount = Number($('#targetCount')?.value) || 50;
  const minDelay = Number($('#minDelay')?.value) || 45;
  const maxDelay = Number($('#maxDelay')?.value) || 90;
  const message = $('#autoMessage')?.value?.trim() || '';
  const activeWithinDays = Number($('#activeFilter')?.value) || 0;

  try {
    initAutoNeighborEvents();
    $('#liveDashboard')?.classList.remove('hidden');
    const res = await api('api/neighbors/auto/start', {
      method: 'POST',
      body: JSON.stringify({ keyword, targetCount, minDelay, maxDelay, message, activeWithinDays })
    });
    updateAutoDashboard(res);
    toast(`'${keyword}' 서로이웃 자동화 작업을 시작했습니다.`);
  } catch (err) {
    toast(err.message, true);
  }
});

$('#pauseAutoBtn')?.addEventListener('click', async () => {
  try {
    const res = await api('api/neighbors/auto/pause', { method: 'POST' });
    updateAutoDashboard(res);
    toast('작업을 일시정지했습니다.');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#resumeAutoBtn')?.addEventListener('click', async () => {
  try {
    const res = await api('api/neighbors/auto/resume', { method: 'POST' });
    updateAutoDashboard(res);
    toast('작업을 재개했습니다.');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#stopAutoBtn')?.addEventListener('click', async () => {
  if (!confirm('정말 진행 중인 서로이웃 자동화 작업을 중단하시겠습니까?')) return;
  try {
    const res = await api('api/neighbors/auto/stop', { method: 'POST' });
    updateAutoDashboard(res);
    toast('작업이 중단되었습니다.');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------------------------------------------------------------------------
// 신청 이력 (History) 모달 및 CSV 내보내기
// ---------------------------------------------------------------------------

const historyModal = $('#historyModal');

async function loadHistory(query = '') {
  const tbody = $('#historyTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px;">이력을 불러오는 중...</td></tr>';

  try {
    const data = await api(`api/neighbors/history?limit=100&keyword=${encodeURIComponent(query)}`);
    const records = data.items || [];
    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#a0aec0;">신청 이력이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = records.map((r) => {
      let statusBadge = '<span class="pill pill-green">성공</span>';
      if (r.status === 'already_mutual' || r.status === 'already_added') statusBadge = '<span class="pill">기존이웃</span>';
      else if (r.status === 'unavailable' || r.status === 'mutual_unavailable') statusBadge = '<span class="pill" style="background:#fed7d7; color:#c53030;">신청불가</span>';
      else if (r.status === 'failed') statusBadge = '<span class="pill" style="background:#feebc8; color:#c05621;">실패</span>';
      else if (r.status === 'limit_reached') statusBadge = '<span class="pill" style="background:#fed7d7; color:#9b2c2c;">한도도달</span>';

      return `
        <tr>
          <td>${escapeHtml(r.timestamp?.slice(5, 16)?.replace('T', ' ') || '')}</td>
          <td><a href="https://blog.naver.com/${escapeHtml(r.blogId)}" target="_blank" style="color:#03c75a; font-weight:600; text-decoration:none;">@${escapeHtml(r.blogId)}</a></td>
          <td><strong>${escapeHtml(r.bloggerName || '-')}</strong></td>
          <td><span style="color:#718096;">${escapeHtml(r.keyword || '-')}</span></td>
          <td>${statusBadge}</td>
          <td style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.message || '')}">${escapeHtml(r.message || '-')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#e53e3e;">이력 로드 실패: ${escapeHtml(err.message)}</td></tr>`;
  }
}

$('#historyModalBtn')?.addEventListener('click', () => {
  historyModal?.classList.remove('hidden');
  loadHistory();
});

$('#closeHistoryModal')?.addEventListener('click', () => {
  historyModal?.classList.add('hidden');
});

historyModal?.addEventListener('click', (e) => {
  if (e.target === historyModal) historyModal.classList.add('hidden');
});

$('#historySearchBtn')?.addEventListener('click', () => {
  loadHistory($('#historySearchInput')?.value?.trim() || '');
});

$('#historySearchInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadHistory($('#historySearchInput')?.value?.trim() || '');
  }
});

$('#exportCsvBtn')?.addEventListener('click', () => {
  window.open('api/neighbors/history/export', '_blank');
});

$('#clearHistoryBtn')?.addEventListener('click', async () => {
  if (!confirm('정말 모든 서로이웃 신청 이력을 초기화하시겠습니까? (중복 신청 방지 기록도 함께 삭제됩니다)')) return;
  try {
    await api('api/neighbors/history/clear', { method: 'POST' });
    toast('신청 이력이 성공적으로 초기화되었습니다.');
    loadHistory();
    refreshDailySummary();
  } catch (err) {
    toast(err.message, true);
  }
});

// Engagement History Modal Controller
const engHistoryModal = $('#engHistoryModal');

async function loadEngagementHistory(query = '') {
  const list = $('#engHistoryTableBody');
  if (!list) return;
  list.innerHTML = '<div class="eng-history-empty">소통 이력을 불러오는 중...</div>';

  try {
    const data = await api(`api/engagement/history?limit=100&keyword=${encodeURIComponent(query)}`);
    const records = data.items || [];
    if (records.length === 0) {
      list.innerHTML = '<div class="eng-history-empty"><strong>아직 소통 이력이 없습니다</strong><span>소통을 완료하면 처리한 글과 댓글이 여기에 표시됩니다.</span></div>';
      return;
    }

    list.innerHTML = records.map((r) => {
      const reactions = [];
      if (r.liked) reactions.push('<span class="eng-history-tag success">공감</span>');
      if (r.commented) reactions.push('<span class="eng-history-tag info">댓글</span>');
      const reactionHtml = reactions.length > 0 ? reactions.join('') : '<span class="eng-history-tag">반응 확인 필요</span>';

      let neighborHtml = '';
      if (r.neighborRequested) {
        if (r.neighborStatus === 'requested' || r.neighborStatus === 'added') {
          neighborHtml = '<span class="eng-history-tag info">서로이웃 신청</span>';
        } else if (r.neighborStatus === 'already_mutual' || r.neighborStatus === 'already_added') {
          neighborHtml = '<span class="eng-history-tag">기존 이웃</span>';
        } else {
          neighborHtml = `<span class="eng-history-tag warning">${escapeHtml(friendlyUiMessage(r.neighborStatus, '확인 필요'))}</span>`;
        }
      }

      const postTitleLink = r.postUrl 
        ? `<a href="${escapeHtml(r.postUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.title || '')}">${escapeHtml(r.title || '제목 없는 글')} <span aria-hidden="true">↗</span></a>`
        : escapeHtml(r.title || '제목 없는 글');

      const review = r.trainingReview || null;
      const reviewLabel = review?.decision === 'accepted' ? '승인됨'
        : review?.decision === 'edited' ? '수정 승인'
          : review?.decision === 'rejected' ? '거절됨'
            : review?.decision === 'skip' ? 'SKIP 승인' : '검수 전';
      const reviewClass = ['accepted', 'edited'].includes(review?.decision) ? 'success'
        : review?.decision === 'rejected' ? 'danger'
          : review?.decision === 'skip' ? 'warning' : '';
      const reviewHtml = r.commented && r.commentText ? `
        <div class="training-review-cell" data-record-id="${escapeHtml(r.id)}">
          <label class="eng-history-comment-label">작성한 AI 댓글</label>
          <textarea class="training-comment-editor" rows="2" maxlength="120" aria-label="학습용 최종 댓글">${escapeHtml(review?.finalComment || r.commentText)}</textarea>
          <div class="eng-history-review-row">
            <span class="training-review-state ${reviewClass}">${reviewLabel}</span>
            <div class="training-review-actions">
              <button type="button" class="training-review-btn accept" data-training-decision="accepted">그대로 사용</button>
              <button type="button" class="training-review-btn edit" data-training-decision="edited">수정 저장</button>
              <button type="button" class="training-review-btn reject" data-training-decision="rejected">학습 제외</button>
            </div>
          </div>
        </div>` : '<div class="eng-history-no-comment">작성한 댓글 없음</div>';

      return `
        <article class="eng-history-card">
          <div class="eng-history-card-head">
            <div class="eng-history-post">
              <div class="eng-history-title">${postTitleLink}</div>
              <div class="eng-history-meta">
                <a href="https://blog.naver.com/${escapeHtml(r.blogId)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(r.blogId)}</a>
                <span>${escapeHtml(r.timestamp?.slice(5, 16)?.replace('T', ' ') || '')}</span>
                ${r.keyword ? `<span>${escapeHtml(r.keyword)}</span>` : ''}
              </div>
            </div>
            <span class="eng-history-status ${r.status === 'success' ? 'success' : ''}">${escapeHtml(r.status === 'success' ? '완료' : friendlyUiMessage(r.status, '확인 필요'))}</span>
          </div>
          <div class="eng-history-tags">${reactionHtml}${neighborHtml}</div>
          ${reviewHtml}
        </article>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="eng-history-empty danger">이력을 불러오지 못했습니다. ${escapeHtml(friendlyUiMessage(err.message))}</div>`;
  }
  await refreshTrainingReviewSummary();
}

async function refreshTrainingReviewSummary() {
  const target = $('#trainingReviewSummary');
  if (!target) return;
  try {
    const summary = await api('api/engagement/training-summary');
    target.innerHTML = `
      <span class="training-stat"><strong>${Number(summary.reviewed || 0)}</strong> 검수</span>
      <span class="training-stat success"><strong>${Number(summary.trainingReady || 0)}</strong> 학습 준비</span>
      <span class="training-stat danger"><strong>${Number(summary.byDecision?.rejected || 0)}</strong> 거절</span>
      <span class="training-review-hint">본문 근거가 저장된 신규 댓글만 SFT/DPO 내보내기에 포함됩니다.</span>`;
  } catch {
    target.innerHTML = '<span class="training-review-hint">학습 검수 현황을 불러오지 못했습니다.</span>';
  }
}

$('#engHistoryTableBody')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-training-decision]');
  if (!button) return;
  const cell = button.closest('.training-review-cell');
  const recordId = cell?.dataset.recordId;
  const decision = button.dataset.trainingDecision;
  const finalComment = cell?.querySelector('.training-comment-editor')?.value?.trim() || '';
  if (!recordId) return;
  if (decision === 'edited' && (finalComment.length < 15 || finalComment.length > 120)) {
    toast('수정 댓글은 15~120자로 입력해주세요.', true);
    return;
  }
  button.disabled = true;
  try {
    await api('api/engagement/training-review', {
      method: 'POST',
      body: JSON.stringify({ recordId, decision, finalComment, reasonCodes: decision === 'rejected' ? ['human_rejected'] : [] })
    });
    toast(decision === 'rejected' ? '학습 제외 대상으로 저장했습니다.' : '학습 검수를 저장했습니다.');
    await loadEngagementHistory($('#engHistorySearchInput')?.value?.trim() || '');
  } catch (err) {
    button.disabled = false;
    toast(err.message, true);
  }
});

$('#engHistoryModalBtn')?.addEventListener('click', () => {
  engHistoryModal?.classList.remove('hidden');
  loadEngagementHistory();
});

$('#closeEngHistoryModal')?.addEventListener('click', () => {
  engHistoryModal?.classList.add('hidden');
});

engHistoryModal?.addEventListener('click', (e) => {
  if (e.target === engHistoryModal) engHistoryModal.classList.add('hidden');
});

$('#engHistorySearchBtn')?.addEventListener('click', () => {
  loadEngagementHistory($('#engHistorySearchInput')?.value?.trim() || '');
});

$('#engHistorySearchInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadEngagementHistory($('#engHistorySearchInput')?.value?.trim() || '');
  }
});

$('#exportEngCsvBtn')?.addEventListener('click', () => {
  window.open('api/engagement/history/csv', '_blank');
});

$('#exportTrainingSftBtn')?.addEventListener('click', () => {
  window.open('api/engagement/training-export?format=sft', '_blank');
});

$('#exportTrainingDpoBtn')?.addEventListener('click', () => {
  window.open('api/engagement/training-export?format=dpo', '_blank');
});

$('#clearEngHistoryBtn')?.addEventListener('click', async () => {
  if (!confirm('정말 모든 공감/댓글 소통 이력을 초기화하시겠습니까? (중복 소통 방지 기록도 함께 삭제됩니다)')) return;
  try {
    await api('api/engagement/history', { method: 'DELETE' });
    toast('공감/댓글 소통 이력이 성공적으로 초기화되었습니다.');
    loadEngagementHistory();
  } catch (err) {
    toast(err.message, true);
  }
});

// Logout

$('#logoutButton')?.addEventListener('click', async () => {
  await api('api/naver/logout', { method: 'POST' }).catch(() => {});
  setConnected(false);
  toast('연결이 해제되었습니다.');
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function friendlyUiMessage(value, fallback = '처리하지 못했습니다.') {
  const message = String(value || '').trim();
  if (!message) return fallback;
  if (/locator\.|waitFor|Timeout\s*\d*ms|Call log|waiting for|selector/i.test(message)) {
    return '네이버 응답이 없어 처리하지 못했습니다.';
  }
  return message;
}

let currentHardwareSpecs = null;
let currentModelsList = [];
let activeModelId = null;
let runtimeStatusTimer = null;

function updateLocalAiSummaryUI(activeModel, activeEndpoint, runtime = null) {
  const globalStatus = $('#globalEngineStatusText');
  const summaryModel = $('#summaryModelName');
  const summaryEndpoint = $('#summaryEndpointUrl');
  const currentBadge = $('#currentEngineBadge');
  const summaryEngine = $('#summaryEngineType');

  const setup = runtime?.setup;
  const isReady = runtime?.status === 'running';
  const acceleration = runtime?.acceleration === 'GPU' ? 'GPU' : 'CPU';
  if (summaryEngine) summaryEngine.textContent = acceleration === 'GPU' ? '로컬 GPU' : '로컬 CPU';
  const setupBox = $('#localAiSetupProgress');
  // With a Claude/Gemini subscription in use the local model is unloaded on purpose, not still loading.
  if (cloudEngineLabel && activeModel && !isReady) {
    setupBox?.classList.add('hidden');
    if (summaryModel) summaryModel.textContent = `${activeModel.name} · 쉬는 중 (구독 AI 사용 중)`;
    if (currentBadge) { currentBadge.className = 'pill pill-green'; currentBadge.textContent = activeModel.name; }
    if ($('#statusbarEngineText')) $('#statusbarEngineText').textContent = `${cloudEngineLabel} 사용 중`;
    if ($('#llmStatus')) $('#llmStatus').innerHTML = `<i></i> ${escapeHtml(cloudEngineLabel)}`;
    if (globalStatus) { globalStatus.textContent = cloudEngineLabel; globalStatus.style.color = '#234e52'; }
    return;
  }
  if ($('#statusbarEngineText')) $('#statusbarEngineText').textContent = isReady ? '로컬 AI 실행 중' : '로컬 AI 대기 중';
  if (setupBox && setup && activeModel && !isReady) {
    setupBox.classList.remove('hidden');
    $('#localAiSetupText').textContent = setup.message || '로컬 AI를 준비하고 있습니다.';
    $('#localAiSetupPercent').textContent = `${setup.progress || 0}%`;
    $('#localAiSetupBar').style.width = `${Math.max(4, setup.progress || 0)}%`;
  } else if (setupBox) {
    setupBox.classList.add('hidden');
  }

  if (activeModel) {
    if (summaryModel) summaryModel.textContent = isReady ? `${activeModel.name}${activeModel.sizeFormatted ? ` (${activeModel.sizeFormatted})` : ''}` : `${activeModel.name} · AI 준비 중`;
    if (summaryEndpoint) summaryEndpoint.textContent = isReady ? (activeEndpoint?.baseUrl || 'http://127.0.0.1:8089') : 'AI 엔진 준비 중';
    if (globalStatus && cloudEngineLabel) {
      globalStatus.textContent = cloudEngineLabel;
      globalStatus.style.color = '#234e52';
    } else if (globalStatus) {
      globalStatus.textContent = isReady ? activeModel.name : (setup?.message || '로컬 AI 준비 중');
      globalStatus.style.color = isReady ? '#234e52' : '#2563eb';
    }
    if (currentBadge) {
      currentBadge.className = 'pill pill-green';
      currentBadge.textContent = activeModel.name;
    }
    if ($('#llmStatus')) {
      $('#llmStatus').className = isReady ? 'status online' : 'status';
      $('#llmStatus').innerHTML = isReady ? `<i></i> ${acceleration === 'GPU' ? '로컬 GPU' : '로컬 CPU'} (${escapeHtml(activeModel.name)})` : '<i></i> AI 준비 중';
    }
  } else {
    if (summaryModel) summaryModel.textContent = '미설치 (Gemma 모델 다운로드 필요)';
    if (summaryEndpoint) summaryEndpoint.textContent = '-';
    if (globalStatus) {
      globalStatus.textContent = 'AI 모델 설치 필요';
      globalStatus.style.color = '#c53030';
    }
    if (currentBadge) {
      currentBadge.className = 'pill pill-gray';
      currentBadge.textContent = '미설치';
    }
    if ($('#llmStatus')) {
      $('#llmStatus').className = 'status offline';
      $('#llmStatus').innerHTML = '<i></i> 모델 설치 필요';
    }
  }
}

async function refreshRuntimeStatus() {
  const runtime = await api('api/models/runtime').catch(() => null);
  if (!runtime) return;
  // A remote llama-server (the 112 dev server) stands in for the installed local model.
  const activeModel = currentModelsList.find((model) => model.id === activeModelId)
    || (runtime.remote ? { id: runtime.modelId || 'remote', name: `${runtime.modelId || '원격 LLM'} (원격 서버)` } : null);
  updateLocalAiSummaryUI(activeModel, runtime.status === 'running' ? { baseUrl: 'http://127.0.0.1:8089' } : null, runtime);
  const preparing = Boolean(activeModel) && (['starting', 'stopped'].includes(runtime.status) || ['checking_runtime', 'installing_runtime', 'downloading_runtime', 'extracting_runtime', 'runtime_installed', 'loading_model'].includes(runtime.setup?.phase));
  if (!preparing && runtimeStatusTimer) {
    clearInterval(runtimeStatusTimer);
    runtimeStatusTimer = null;
  }
}

function startRuntimeStatusPolling() {
  if (runtimeStatusTimer) return;
  refreshRuntimeStatus();
  runtimeStatusTimer = setInterval(refreshRuntimeStatus, 900);
}

function initSettingsController() {
  // Global Header Status Clicks
  $('#globalEngineStatusBox')?.addEventListener('click', () => {
    setActiveTab('settings', true);
  });
  $('#topAccountBadge')?.addEventListener('click', () => {
    setActiveTab('settings', true);
  });

  // 1. Settings Naver Login & Logout
  $('#settingsAccountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleIdPwLogin($('#settingsAccountForm'), '#settingsUserId', '#settingsUserPassword');
  });

  $('#settingsLogoutButton')?.addEventListener('click', async () => {
    await api('api/naver/logout', { method: 'POST' }).catch(() => {});
    setConnected(false);
    toast('네이버 계정 연결이 해제되었습니다.');
  });
}

async function initAiHardwareAndModels() {
  try {
    initModelEvents();
    startRuntimeStatusPolling();
    const settings = await api('api/settings').catch(() => null);

    const specs = await api('api/hardware/specs');
    currentHardwareSpecs = specs;
    
    // Update GPU badges & text
    const gpuNameText = specs.gpu?.primaryGpu ? `${specs.gpu.primaryGpu.name} (${specs.gpu.vramFormatted})` : '시스템 GPU';
    const memoryLabel = specs.gpu?.isIntegrated
      ? `공유 GPU 메모리 최대 ${specs.gpu?.sharedMemoryFormatted || '-'} (전용 ${specs.gpu?.vramFormatted || '-'})`
      : `전용 VRAM ${specs.gpu?.vramFormatted || '-'}`;
    if ($('#gpuSpecBadge')) $('#gpuSpecBadge').textContent = gpuNameText;
    if ($('#localGpuSummaryText')) $('#localGpuSummaryText').textContent = `${gpuNameText} · ${memoryLabel}`;

    const summaryHtml = `내 컴퓨터 사양(<strong>${escapeHtml(specs.gpu?.primaryGpu?.name || 'GPU')}</strong> / <strong>${escapeHtml(memoryLabel)}</strong>)에 맞는 <strong>[${escapeHtml(specs.recommendedModel?.modelInfo?.name || '로컬 AI')}]</strong> 모델을 추천합니다. 공유 메모리는 전용 VRAM과 구분해 CPU 안정 모드로 실행합니다.`;

    if ($('#hardwareRecommendText')) $('#hardwareRecommendText').innerHTML = summaryHtml;

    const modelsRes = await api('api/models/list').catch(() => null);
    if (modelsRes) {
      currentModelsList = modelsRes.models || [];
      activeModelId = modelsRes.activeModel?.id || null;
      
      renderModelCards(modelsRes.models, activeModelId, specs.recommendedModel?.id, '#settingsAiModelCardsGrid');
      
      const listRuntime = settings?.runtime || modelsRes.runtime;
      // A remote llama-server (web build) has no installed model file but is the active model.
      const listActive = modelsRes.activeModel || (listRuntime?.remote ? { id: listRuntime.modelId || 'remote', name: `${listRuntime.modelId || '원격 LLM'} (원격 서버)` } : null);
      updateLocalAiSummaryUI(listActive, settings?.activeEndpoint, listRuntime);

      // Synchronize global select dropdowns
      $$('.ai-model-global-select').forEach((sel) => {
        if (!sel) return;
        sel.replaceChildren();
        const option = document.createElement('option');
        option.value = activeModelId || '';
        option.textContent = modelsRes.activeModel?.name || '활성 로컬 모델 없음';
        sel.append(option);
      });
    }
  } catch (err) {
    console.error('Failed to init hardware specs:', err);
  }
}

let modelEventSource = null;

function initModelEvents() {
  if (modelEventSource) return;
  try {
    modelEventSource = new EventSource('api/models/events');
    
    modelEventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data || '{}');
      updateDownloadProgressUI(data);
    });

    modelEventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data || '{}');
      toast(`✨ [${data.meta?.name || data.modelId}] 다운로드 완료! AI 엔진을 자동으로 준비합니다.`);
      initAiHardwareAndModels();
    });

    modelEventSource.addEventListener('runtime_ready', (e) => {
      const data = JSON.parse(e.data || '{}');
      toast(`✅ 로컬 AI가 준비되었습니다. 이제 AI 댓글을 바로 작성할 수 있습니다.`);
      initAiHardwareAndModels();
    });

    modelEventSource.addEventListener('runtime_error', (e) => {
      const data = JSON.parse(e.data || '{}');
      toast(`AI 실행 엔진 준비 실패: ${data.error || '다시 시도해주세요.'}`, true);
      initAiHardwareAndModels();
    });

    modelEventSource.addEventListener('error', (e) => {
      const data = JSON.parse(e.data || '{}');
      if (data.error) toast(`다운로드 실패: ${data.error}`, true);
      initAiHardwareAndModels();
    });
  } catch (err) {
    console.error('Failed to connect model events SSE:', err);
  }
}

function updateDownloadProgressUI(data) {
  const { modelId, percent, downloadedFormatted, totalFormatted, speedMbps, remainingSec } = data;
  $$(`.ai-model-card[data-model="${modelId}"]`).forEach((card) => {
    let progressBox = card.querySelector('.model-download-progress');
    if (!progressBox) {
      progressBox = document.createElement('div');
      progressBox.className = 'model-download-progress';
      progressBox.style.cssText = 'margin-top:10px; padding:10px 12px; background:#ebf8ff; border:1px solid #bee3f8; border-radius:8px;';
      card.querySelector('.model-card-footer')?.before(progressBox);
    }
    
    const timeText = remainingSec > 60 ? `약 ${Math.floor(remainingSec / 60)}분 ${remainingSec % 60}초 남음` : `${remainingSec}초 남음`;
    progressBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; color:#2b6cb0; margin-bottom:5px;">
        <span>📥 다운로드 진행 중: <strong>${percent}%</strong> (${downloadedFormatted} / ${totalFormatted})</span>
        <span style="color:#2b6cb0; font-weight:700;">⚡ ${speedMbps}</span>
      </div>
      <div style="width:100%; height:8px; background:#bee3f8; border-radius:4px; overflow:hidden;">
        <div style="width:${percent}%; height:100%; background:#3182ce; transition:width 0.3s ease;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:11px; color:#4a5568; margin-top:5px;">
        <span>내 PC GPU VRAM에 로컬 모델 파일 설치 중</span>
        <span>⏳ ${timeText}</span>
      </div>
    `;

    const btn = card.querySelector('.model-select-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = `다운로드 중 (${percent}%)`;
    }
  });
}

function renderModelCards(models, activeId, recommendedId, containerSelector = '#aiModelCardsGrid') {
  const container = $(containerSelector);
  if (!container || !models || !models.length) return;

  container.innerHTML = models.map((m) => {
    const isRecommended = m.id === recommendedId;
    const isInstalled = Boolean(m.isInstalled);
    const isActive = Boolean(isInstalled && m.id === activeId);
    
    let btnHtml = '';
    let statusPill = '';

    if (isActive) {
      btnHtml = '<button type="button" class="button small model-select-btn" disabled style="background:#2b6cb0; color:#fff; font-weight:700;">사용 중</button>';
      statusPill = '<span class="pill pill-green" style="font-size:11px;">활성</span>';
    } else if (isInstalled) {
      btnHtml = `<button type="button" class="button small model-select-btn" data-action="select" data-id="${escapeHtml(m.id)}">이 모델 사용</button>`;
      statusPill = '<span class="pill" style="font-size:11px; background:#edf2f7; color:#4a5568;">설치됨</span>';
    } else {
      btnHtml = `<button type="button" class="button small ghost model-select-btn" data-action="download" data-id="${escapeHtml(m.id)}">다운로드 (${escapeHtml(m.sizeFormatted)})</button>`;
      statusPill = `<span class="pill" style="font-size:11px; background:#fffaf0; color:#dd6b20; border:1px solid #feebc8;">미설치</span>`;
    }

    const tierPills = {
      'gemma-4-e2b-it-qat-q4-0': '<span class="model-tier-pill">경량</span>',
      'gemma-4-e4b-it-qat-q4-0': '<span class="model-tier-pill pill-gold">균형</span>',
      'gemma-4-12b-it-qat-q4-0': '<span class="model-tier-pill pill-purple">고성능</span>'
    };

    return `
      <div class="ai-model-card ${isRecommended ? 'recommended' : ''} ${isActive ? 'active-model' : ''}" data-model="${escapeHtml(m.id)}">
        <div class="model-card-header">
          <div>
            <strong>${escapeHtml(m.name)}</strong>
            <span class="model-badge-sub">${escapeHtml(m.sizeFormatted)} GGUF · ${escapeHtml(m.description?.slice(0, 30) || '')}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            ${statusPill}
            ${tierPills[m.id] || '<span class="model-tier-pill">AI 모델</span>'}
          </div>
        </div>
        <p class="model-card-desc">${escapeHtml(m.description || '')}</p>
        <div class="model-card-footer">
          <span class="model-vram-hint">최소 VRAM ${(m.minVramMb / 1024).toFixed(1)}GB</span>
          ${btnHtml}
        </div>
      </div>
    `;
  }).join('');

  // Bind click handlers
  container.querySelectorAll('.model-select-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const modelId = e.currentTarget.dataset.id;
      const action = e.currentTarget.dataset.action;
      if (!modelId) return;

      if (action === 'select') {
        try {
          await api('api/models/select', { method: 'POST', body: JSON.stringify({ modelId }) });
          toast(`활성 AI 모델이 '${modelId}'(으)로 전환되었습니다.`);
          initAiHardwareAndModels();
        } catch (err) {
          toast(err.message, true);
        }
      } else if (action === 'download') {
        try {
          btn.disabled = true;
          btn.textContent = '다운로드 요청 중...';
          await api('api/models/download', { method: 'POST', body: JSON.stringify({ modelId }) });
          toast(`'${modelId}' 모델 다운로드를 시작했습니다. 실시간 진행률을 확인하세요.`);
          initModelEvents();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '다운로드';
          toast(err.message, true);
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Engagement (Heart & AI Custom Comment) Automation Controller
// ---------------------------------------------------------------------------
let engagementEventSource = null;
function initEngagementAutomation() {
  // 0. Go to login button
  $('#engGoLoginBtn')?.addEventListener('click', () => {
    setActiveTab('settings', true);
  });

  // 1. Keyword Chips
  const syncEngKeywordChips = () => {
    const selected = new Set(($('#engKeyword')?.value || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean));
    $$('.eng-chips button').forEach((button) => {
      const active = selected.has(button.textContent.trim());
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  $('#engTrendChips')?.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    const input = $('#engKeyword');
    if (!btn || !input) return;
    const keyword = btn.dataset.keyword || btn.textContent.trim();
    const keywords = [...new Set(input.value.split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean))];
    input.value = (keywords.includes(keyword) ? keywords.filter((value) => value !== keyword) : [...keywords, keyword]).join(', ');
    syncEngKeywordChips();
  });
  const loadEngagementTrends = async (force = false) => {
    const container = $('#engTrendChips');
    const status = $('#engTrendStatus');
    const refreshButton = $('#refreshEngTrendsBtn');
    if (!container) return;
    try {
      if (refreshButton) refreshButton.disabled = true;
      if (status) status.textContent = '대한민국 실시간 트렌드 갱신 중...';
      const data = await api(`api/blog/trends${force ? '?refresh=true' : ''}`);
      const trends = (data.items || []).map((item) => ({ keyword: item.keyword || item.topic, topic: item.topic, traffic: item.traffic })).filter((item) => item.keyword).slice(0, 12);
      if (!trends.length) throw new Error('추천 가능한 실시간 트렌드가 없습니다.');
      container.innerHTML = trends.map((item) => `<button type="button" data-keyword="${escapeHtml(item.keyword)}" title="${escapeHtml(item.topic)} · 검색량 ${escapeHtml(item.traffic || '-')} ">${escapeHtml(item.keyword)}</button>`).join('');
      if (status) status.textContent = `실시간 트렌드 ${trends.length}개 · ${new Date(data.refreshedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 갱신`;
      syncEngKeywordChips();
    } catch (error) {
      container.innerHTML = '<button type="button" data-keyword="맛집">맛집</button><button type="button" data-keyword="육아">육아</button><button type="button" data-keyword="여행">여행</button>';
      if (status) status.textContent = `실시간 트렌드 조회 실패 · 기본 키워드 표시`;
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  };
  $('#refreshEngTrendsBtn')?.addEventListener('click', () => loadEngagementTrends(true));
  loadEngagementTrends();
  $('#engKeyword')?.addEventListener('input', syncEngKeywordChips);
  syncEngKeywordChips();
  initEngagementNeighborQuota();
  initNeighborGroupSetting();

  // 2. Quick Counts
  $$('.eng-quick-counts button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#engTargetCount');
      if (input) input.value = btn.dataset.val;
    });
  });

  // 3. Copy & Clear logs button
  $('#copyEngLogsBtn')?.addEventListener('click', () => {
    copyTerminalLogs('#engTerminalLogs');
  });

  $('#clearEngLogsBtn')?.addEventListener('click', () => {
    const container = $('#engTerminalLogs');
    if (container) container.innerHTML = '<div class="terminal-line info">[로그 초기화됨]</div>';
  });

  // 4. Start Engagement
  $('#startEngBtn')?.addEventListener('click', async (e) => {
    e?.preventDefault();

    if (!state.connected) {
      toast('⚠️ 네이버 계정이 연결되어 있지 않습니다. 먼저 계정을 연결해주세요.', true);
      setActiveTab('settings', true);
      return;
    }

    const targetSource = $('#engTargetSource')?.value || 'keyword';
    const keyword = $('#engKeyword')?.value?.trim();
    const seedBlogs = $('#engSeedBlogs')?.value?.trim() || '';
    const targetIds = $('#engTargetIds')?.value?.trim() || '';
    if (targetSource === 'keyword' && !keyword) return toast('소통 타겟 키워드를 입력해주세요.', true);
    if (targetSource === 'seed_commenters' && !seedBlogs) return toast('댓글 이웃을 가져올 인기 블로그 ID나 주소를 입력해주세요.', true);
    if (targetSource === 'id_list' && !countBlogIds(targetIds)) return toast('소통할 블로그 ID를 한 줄에 하나씩 입력해주세요.', true);
    const commentStyle = readCommentStyle('eng');
    if ($('#engDoComment')?.checked && commentStyle.commentMode === 'phrases' && !commentStyle.commentPhrases.trim()) {
      return toast('[내 문구만]을 고르셨다면 댓글 문구를 한 줄에 하나씩 입력해주세요.', true);
    }

    const targetCount = Number($('#engTargetCount')?.value) || 100;
    const doLike = $('#engDoLike')?.checked ?? true;
    const doComment = $('#engDoComment')?.checked ?? true;
    const doNeighbor = $('#engDoNeighbor')?.checked ?? true;
    const neighborMessage = $('#engNeighborMessage')?.value?.trim() || '안녕하세요! 포스팅 잘 보고 갑니다. 좋은 이웃으로 소통하고 지내요 😊';
    const tone = $('#engTone')?.value || 'friendly';
    const minDelay = Number($('#engMinDelay')?.value) || 120;
    const maxDelay = Number($('#engMaxDelay')?.value) || 180;
    const dailyNeighborLimit = Number($('#engDailyNeighborLimit')?.value) || 100;
    const sessionPosts = Number($('#engSessionPosts')?.value) || 10;
    const breakMinMinutes = Number($('#engBreakMinMinutes')?.value) || 10;
    const breakMaxMinutes = Number($('#engBreakMaxMinutes')?.value) || 20;

    if (!doLike && !doComment && !doNeighbor) {
      return toast('공감(❤️), AI 댓글(💬), 서로이웃(👥) 중 최소 1개 이상을 선택해주세요.', true);
    }

    const startBtn = $('#startEngBtn');
    try {
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<strong>준비 중...</strong>';
      }
      const dashboard = $('#engDashboard');
      if (dashboard) dashboard.classList.remove('hidden');

      await api('api/engagement/start', {
        method: 'POST',
        body: JSON.stringify({
          keyword, targetCount, doLike, doComment, doNeighbor, neighborMessage, tone,
          targetSource, seedBlogs, targetIds, ...commentStyle,
          neighborMessageMode: $('#engAiNeighborMessage')?.checked === false ? 'fixed' : 'ai',
          neighborActiveOnly: $('#engNeighborActiveOnly')?.checked !== false,
          minDelay, maxDelay, dailyNeighborLimit, sessionPosts,
          sessionBreakMinSeconds: breakMinMinutes * 60,
          sessionBreakMaxSeconds: breakMaxMinutes * 60
        })
      });
      const keywordCount = (keyword || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean).length;
      toast(`${keywordCount}개 키워드를 순차 실행합니다. 전체 목표 ${Math.min(targetCount, 500)}건 · 서로이웃 ${Math.min(dailyNeighborLimit, 100)}명 도달 시 자동 종료`);
      initEngagementEvents();
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<strong>소통 시작</strong>';
      }
    }
  });

  // 4-1. Toggle card checked state & Neighbor message group toggle
  ['#engDoLike', '#engDoComment', '#engDoNeighbor'].forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    const updateCard = () => {
      el.closest('.action-toggle-card')?.classList.toggle('checked', el.checked);
    };
    el.addEventListener('change', updateCard);
    updateCard();
  });

  $('#engDoNeighbor')?.addEventListener('change', (e) => {
    $('#engNeighborMsgGroup')?.classList.toggle('hidden', !e.target.checked);
  });

  // 5. Pause, Resume, Stop buttons
  $('#pauseEngBtn')?.addEventListener('click', async () => {
    try {
      await api('api/engagement/pause', { method: 'POST' });
      toast('작업을 일시정지했습니다.');
    } catch (err) { toast(err.message, true); }
  });

  $('#resumeEngBtn')?.addEventListener('click', async () => {
    try {
      await api('api/engagement/resume', { method: 'POST' });
      toast('작업을 재개했습니다.');
    } catch (err) { toast(err.message, true); }
  });

  $('#stopEngBtn')?.addEventListener('click', async () => {
    if (!confirm('정말 진행 중인 공감/댓글 자동화 작업을 중단하시겠습니까?')) return;
    try {
      await api('api/engagement/stop', { method: 'POST' });
      toast('작업 중단을 요청했습니다.');
    } catch (err) { toast(err.message, true); }
  });

  initEngagementEvents();
}

function initEngagementEvents() {
  if (engagementEventSource) {
    engagementEventSource.close();
    engagementEventSource = null;
  }

  engagementEventSource = new EventSource('api/engagement/events');

  engagementEventSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateEngagementDashboard(data);
    } catch {}
  });

  engagementEventSource.addEventListener('log', (e) => {
    try {
      const log = JSON.parse(e.data);
      appendEngagementLog(log);
      if (/서로이웃 성공|일일 한도/.test(log.message || '')) {
        setTimeout(refreshEngagementNeighborQuota, 1000);
      }
    } catch {}
  });

  engagementEventSource.onerror = () => {
    setTimeout(() => {
      if (engagementEventSource?.readyState === EventSource.CLOSED) {
        initEngagementEvents();
      }
    }, 3000);
  };
}

let syncedEngagementJobKey = '';
let renderedEngagementLogKey = '';

function updateEngagementDashboard(data) {
  if (!data) return;
  const { state, stats = {}, config = {} } = data;
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const isIdle = state === 'idle' || state === 'stopped' || state === 'completed' || state === 'error';

  // The form and the log show the latest job (running or finished) when the page opens; a fresh page or
  // another device would otherwise show the defaults and an empty log, as if the job had vanished.
  // Synced once per job, so later edits to the form are kept.
  const jobKey = `${config.keyword || ''}|${stats.startTime || ''}`;
  if (state !== 'idle' && Array.isArray(data.logs) && data.logs.length && jobKey !== renderedEngagementLogKey) {
    renderedEngagementLogKey = jobKey;
    const container = $('#engTerminalLogs');
    if (container) {
      container.innerHTML = '';
      [...data.logs].reverse().forEach(appendEngagementLog);
    }
  }
  if (state !== 'idle' && config.keyword && jobKey !== syncedEngagementJobKey) {
    syncedEngagementJobKey = jobKey;
    const keywordInput = config.targetSource && config.targetSource !== 'keyword' ? null : $('#engKeyword');
    if (config.targetSource) setOptionChipValue('engTargetSourceChips', config.targetSource);
    if (keywordInput) {
      keywordInput.value = config.keyword;
      keywordInput.dispatchEvent(new Event('input'));
    }
    if ($('#engTargetCount') && config.targetCount) $('#engTargetCount').value = config.targetCount;
    if ($('#engTone') && config.tone) $('#engTone').value = config.tone;
    [['#engDoLike', config.doLike], ['#engDoComment', config.doComment], ['#engDoNeighbor', config.doNeighbor]].forEach(([selector, value]) => {
      const el = $(selector);
      if (!el || typeof value !== 'boolean') return;
      el.checked = value;
      el.dispatchEvent(new Event('change'));
    });
  }

  const statusDot = $('#engStatusDot');
  if (statusDot) {
    statusDot.className = `desktop-status-dot ${isRunning ? 'running' : isPaused ? 'paused' : state === 'completed' ? 'completed' : state === 'error' ? 'error' : ''}`;
  }

  // Buttons visibility
  const startBtn = $('#startEngBtn');
  const pauseBtn = $('#pauseEngBtn');
  const resumeBtn = $('#resumeEngBtn');
  const stopBtn = $('#stopEngBtn');

  if (startBtn) startBtn.classList.toggle('hidden', !isIdle);
  if (pauseBtn) pauseBtn.classList.toggle('hidden', !isRunning);
  if (resumeBtn) resumeBtn.classList.toggle('hidden', !isPaused);
  if (stopBtn) stopBtn.classList.toggle('hidden', isIdle);

  // Status text
  const statusEl = $('#engDashboardStatusText');
  if (statusEl) {
    if (isRunning) statusEl.textContent = stats.phase === 'searching' ? `'${stats.currentKeyword || ''}' 후보 검색 중...` : `'${stats.currentKeyword || ''}' 주제 소통 진행 중...`;
    else if (isPaused) statusEl.textContent = '작업 일시정지됨';
    else if (state === 'completed') {
      const done = `${stats.processedCount || 0} / ${stats.targetCount || config.targetCount || 0}개`;
      statusEl.textContent = stats.targetReached
        ? `목표 ${stats.targetCount || config.targetCount || 0}개 포스팅 소통 완료`
        : stats.neighborLimitReached
          ? `서로이웃 하루 한도 도달로 종료 · ${done} 처리`
          : `후보 부족 · ${done} 포스팅 처리 완료`;
    }
    else if (state === 'stopped') statusEl.textContent = '사용자에 의해 중단됨';
    else if (state === 'error') statusEl.textContent = '오류로 인해 중단됨';
    else statusEl.textContent = '대기 중 · 설정을 완료하고 시작 버튼을 누르세요';
  }

  // Progress Bar
  const total = stats.targetCount || config.targetCount || 20;
  const current = stats.processedCount || 0;
  const percent = Math.min(Math.round((current / (total || 1)) * 100), 100);
  
  const fill = $('#engProgressBarFill');
  const percentText = $('#engProgressPercent');
  const countsText = $('#engProgressCounts');

  if (fill) fill.style.width = `${percent}%`;
  if (percentText) percentText.textContent = `${percent}%`;
  if (countsText) countsText.textContent = `${current} / ${total}개 포스팅 처리 (공감: ${stats.likeSuccessCount || 0}, 댓글: ${stats.commentSuccessCount || 0}, 서로이웃: ${stats.neighborSuccessCount || 0})`;

  const topicProgress = $('#engTopicProgress');
  if (topicProgress) {
    const keywords = config.keywords || (config.keyword ? config.keyword.split(/[,，]/).map((value) => value.trim()).filter(Boolean) : []);
    const perTarget = config.targetPerKeyword || total;
    const counts = stats.keywordProcessedCounts || {};
    topicProgress.innerHTML = keywords.map((keyword) => { const count = counts[keyword] || 0; const done = count >= perTarget; const active = isRunning || isPaused; const currentTopic = active && !done && stats.currentKeyword === keyword; const stateLabel = done ? '완료' : currentTopic ? (stats.phase === 'searching' ? '후보 검색 중' : '진행 중') : active ? '대기' : count > 0 ? '중단됨' : '진행 안 함'; return `<div class="eng-topic-row ${done ? 'done' : currentTopic ? 'current' : 'pending'}"><span>${done ? '✅' : currentTopic ? '▶' : '○'} <strong>${escapeHtml(keyword)}</strong></span><span>${count} / ${perTarget} · ${stateLabel}</span></div>`; }).join('');
  }

  // Stat Cards
  if ($('#engStatTarget')) $('#engStatTarget').textContent = total;
  if ($('#engStatLikes')) $('#engStatLikes').textContent = stats.likeSuccessCount || 0;
  if ($('#engStatComments')) $('#engStatComments').textContent = stats.commentSuccessCount || 0;
  if ($('#engStatNeighbors')) $('#engStatNeighbors').textContent = stats.neighborSuccessCount || 0;
  if ($('#engStatFailed')) $('#engStatFailed').textContent = (stats.failedCount || 0) + (stats.skippedCount || 0);

  // Delay Countdown Badge
  const delayBadge = $('#engDelayBadge');
  const delaySec = $('#engDelaySeconds');
  if (delayBadge && delaySec) {
    if (stats.delayCountdown > 0) {
      delayBadge.classList.remove('hidden');
      delaySec.textContent = stats.delayCountdown;
    } else {
      delayBadge.classList.add('hidden');
    }
  }
}

function appendEngagementLog(entry) {
  const container = $('#engTerminalLogs');
  if (!container || !entry) return;

  const line = document.createElement('div');
  line.className = `terminal-line ${escapeHtml(entry.type || entry.level || 'info')}`;
  line.innerHTML = `<span class="terminal-time">[${escapeHtml(entry.time || '')}]</span> <span class="terminal-msg">${escapeHtml(entry.message || '')}</span>`;
  container.appendChild(line);

  // Auto scroll to bottom
  container.scrollTop = container.scrollHeight;

  // Keep max 150 lines
  while (container.children.length > 150) {
    container.removeChild(container.firstChild);
  }
}

// ---------------------------------------------------------------------------
// Neighbor Feed Real-Time Engagement Controller
// ---------------------------------------------------------------------------
let feedStatusTimer = null;
let isFeedPreviewLoading = false;
let cachedFeedPosts = [];
let activeFeedFilter = 'all'; // 'all' | 'pending' | 'engaged' | 'skipped'
let feedSearchQuery = '';
let activeFeedCurrentPost = null;
let activeFeedState = 'idle';
const selectedFeedPostLogNos = new Set();
const engagingSingleLogNos = new Set();

function updateFeedSelectionToolbar() {
  const pendingPosts = cachedFeedPosts.filter((p) => !p.engaged && !p.skipped);
  const selectedCount = pendingPosts.filter((p) => selectedFeedPostLogNos.has(p.logNo)).length;

  const selectAllCb = $('#feedSelectAllCheckbox');
  if (selectAllCb) {
    selectAllCb.checked = pendingPosts.length > 0 && selectedCount === pendingPosts.length;
    selectAllCb.indeterminate = selectedCount > 0 && selectedCount < pendingPosts.length;
    selectAllCb.disabled = pendingPosts.length === 0;
  }

  const statusEl = $('#feedSelectionStatus');
  const engageBtn = $('#feedEngageSelectedBtn');
  if (selectedCount > 0) {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:#03c75a; font-weight:700;">${selectedCount}개 글 선택됨</span>`;
    }
    if (engageBtn) {
      engageBtn.disabled = false;
      engageBtn.textContent = `선택한 ${selectedCount}개 글 소통 시작`;
    }
  } else {
    if (statusEl) {
      statusEl.innerHTML = `<span>먼저 소통할 글을 선택해주세요.</span>`;
    }
    if (engageBtn) {
      engageBtn.disabled = true;
      engageBtn.textContent = '✓ 글을 선택하세요';
    }
  }

  if (activeFeedState === 'idle' || activeFeedState === 'stopped') {
    const targetInput = $('#feedTargetCount');
    if (targetInput) targetInput.value = String(selectedCount);
    if ($('#feedStatTarget')) $('#feedStatTarget').textContent = String(selectedCount);
    if ($('#feedStatRemaining')) $('#feedStatRemaining').textContent = String(selectedCount);
  }
}

function renderFeedPosts() {
  const container = $('#feedPostsContainer');
  if (!container) return;

  if (!cachedFeedPosts || cachedFeedPosts.length === 0) {
    container.innerHTML = `
      <div class="feed-empty-state">
        <strong>조회된 이웃 새글이 없습니다</strong>
        <p>잠시 후 목록 조회를 다시 눌러 확인하세요.</p>
      </div>
    `;
    updateFeedSelectionToolbar();
    return;
  }

  // Calculate categorized counts
  const totalCount = cachedFeedPosts.length;
  const pendingCount = cachedFeedPosts.filter((p) => !p.engaged && !p.skipped).length;
  const engagedCount = cachedFeedPosts.filter((p) => p.engaged).length;
  const skippedCount = cachedFeedPosts.filter((p) => p.skipped).length;

  if ($('#feedFoundCountBadge')) $('#feedFoundCountBadge').textContent = `${totalCount}개 발견`;
  if ($('#countFilterAll')) $('#countFilterAll').textContent = String(totalCount);
  if ($('#countFilterPending')) $('#countFilterPending').textContent = String(pendingCount);
  if ($('#countFilterEngaged')) $('#countFilterEngaged').textContent = String(engagedCount);
  if ($('#countFilterSkipped')) $('#countFilterSkipped').textContent = String(skippedCount);

  // Filter posts by active tab and search query
  const filtered = cachedFeedPosts.filter((post) => {
    // 1. Tab filter
    if (activeFeedFilter === 'pending') {
      if (post.engaged || post.skipped) return false;
    } else if (activeFeedFilter === 'engaged') {
      if (!post.engaged) return false;
    } else if (activeFeedFilter === 'skipped') {
      if (!post.skipped) return false;
    }

    // 2. Search query filter
    if (feedSearchQuery) {
      const q = feedSearchQuery.toLowerCase();
      const matchAuthor = (post.author || post.blogId || '').toLowerCase().includes(q);
      const matchTitle = (post.title || '').toLowerCase().includes(q);
      const matchComment = (post.engagementRecord?.commentText || '').toLowerCase().includes(q);
      if (!matchAuthor && !matchTitle && !matchComment) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    const filterLabel = activeFeedFilter === 'pending'
      ? '소통 대기'
      : activeFeedFilter === 'engaged'
      ? '내가 소통한 글'
      : activeFeedFilter === 'skipped'
      ? '제외/기작성 글'
      : '검색 조건에 맞는';

    container.innerHTML = `
      <div class="empty-state" style="text-align:center; padding: 36px 20px; color: var(--text-muted, #888);">
        <p style="font-weight:600; color:#334155; margin-bottom:4px;">해당 조건의 글이 없습니다</p>
        <span style="font-size:12px; color:#64748b;">현재 [${filterLabel}] 상태에 해당하는 이웃 새글이 없습니다.</span>
      </div>
    `;
    updateFeedSelectionToolbar();
    return;
  }

  const cardsHtml = filtered.map((post) => {
    const isCurrentActive = Boolean(
      activeFeedCurrentPost &&
      (activeFeedCurrentPost.logNo === post.logNo || (activeFeedCurrentPost.url && post.url && activeFeedCurrentPost.url.includes(post.logNo)))
    );

    const isEngaged = Boolean(post.engaged);
    const isSkipped = Boolean(post.skipped || post.engagementRecord?.status === 'skipped');
    const isPending = !isEngaged && !isSkipped;
    const isSelected = isPending && selectedFeedPostLogNos.has(post.logNo);
    const cardClass = isCurrentActive
      ? 'is-processing'
      : isEngaged
      ? 'is-engaged'
      : isSkipped
      ? 'is-skipped'
      : 'is-pending';

    const isNew = Boolean(
      post.publishedTime && (
        post.publishedTime.includes('방금') ||
        post.publishedTime.includes('분') ||
        post.publishedTime.includes('시간') ||
        post.publishedTime.includes('오늘')
      )
    );

    let statusBadgesHtml = '';
    if (isCurrentActive) {
      statusBadgesHtml = '<span class="feed-status-badge processing">소통 중</span>';
    } else if (isEngaged) {
      statusBadgesHtml = '<span class="feed-status-badge done">소통 완료</span>';
      if (post.engagementRecord?.liked) {
        statusBadgesHtml += ' <span class="feed-mini-action-badge">공감</span>';
      }
      if (post.engagementRecord?.commented) {
        statusBadgesHtml += ' <span class="feed-mini-action-badge">댓글</span>';
      }
    } else if (isSkipped) {
      const msg = post.engagementRecord?.statusMessage || '기작성 댓글 감지';
      statusBadgesHtml = `<span class="feed-status-badge skipped">${escapeHtml(msg)}</span>`;
    } else {
      statusBadgesHtml = '<span class="feed-status-badge pending">소통 대기</span>';
    }

    const hasThumb = Boolean(post.thumbnail);
    const thumbHtml = hasThumb
      ? `<img src="${escapeHtml(post.thumbnail)}" alt="썸네일" class="feed-card-thumb" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'feed-card-thumb-placeholder\\'>📝</div>';">`
      : '<div class="feed-card-thumb-placeholder"></div>';

    let myCommentHtml = '';
    if (isEngaged && post.engagementRecord?.commentText) {
      const recordDate = post.engagementRecord.timestamp
        ? new Date(post.engagementRecord.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '';
      myCommentHtml = `
        <div class="feed-my-comment-box">
          <div class="feed-comment-bubble-header">
            <span>내가 남긴 AI 맞춤 댓글</span>
            ${recordDate ? `<span class="feed-comment-time">${escapeHtml(recordDate)}</span>` : ''}
          </div>
          <div class="feed-comment-bubble-text">"${escapeHtml(post.engagementRecord.commentText)}"</div>
        </div>
      `;
    }

    let liveStepHtml = '';
    if (isCurrentActive && activeFeedCurrentPost?.stepLabel) {
      liveStepHtml = `
        <div class="feed-live-step-strip">
          <span>${escapeHtml(activeFeedCurrentPost.stepLabel)}</span>
          ${activeFeedCurrentPost.countdown > 0 ? `<span style="margin-left:auto; color:#d97706; font-weight:700;">(${activeFeedCurrentPost.countdown}초)</span>` : ''}
        </div>
      `;
    }

    return `
      <article class="feed-post-card ${cardClass}${isSelected ? ' is-selected' : ''}" data-logno="${post.logNo}" ${isPending ? `data-selectable="true" role="checkbox" aria-checked="${isSelected}" tabindex="0"` : ''}>
        <div class="feed-card-header">
          <div class="feed-card-author-row">
            ${isPending ? `
              <label class="feed-card-check-wrap" style="display:inline-flex; align-items:center; margin:0; cursor:pointer;" onclick="event.stopPropagation();" title="선택하여 일괄 소통">
                <input type="checkbox" class="feed-post-check" data-logno="${escapeHtml(post.logNo)}" ${isSelected ? 'checked' : ''}>
              </label>
            ` : ''}
            <span class="feed-author-badge">
              <span class="feed-author-avatar">${escapeHtml((post.author || post.blogId || '?').slice(0, 1))}</span>
              <strong class="feed-author-name">${escapeHtml(post.author || post.blogId)}</strong>
              <span class="feed-blog-id">@${escapeHtml(post.blogId)}</span>
            </span>
            ${post.publishedTime ? `
              <span class="feed-time-badge">
                ${isNew ? '<span class="feed-new-pill">NEW</span>' : ''}
                🕒 ${escapeHtml(post.publishedTime)}
              </span>
            ` : ''}
          </div>
          <div class="feed-status-badges" style="display:inline-flex; align-items:center; gap:6px;">
            ${statusBadgesHtml}
          </div>
        </div>

        <div class="feed-card-main">
          ${thumbHtml}
          <div class="feed-card-content">
            <a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer" class="feed-post-title" title="${escapeHtml(post.title)}">
              ${escapeHtml(post.title || '제목 없음')}
              <span class="feed-link-icon">↗</span>
            </a>
            ${post.snippet ? `
              <p class="feed-post-snippet">${escapeHtml(post.snippet)}</p>
            ` : ''}
          </div>
        </div>

        ${myCommentHtml}
        ${liveStepHtml}
      </article>
    `;
  }).join('');

  const loadMoreHtml = (cachedFeedPosts.length >= 15 && cachedFeedPosts.length < 100)
    ? `
      <div class="feed-load-more-wrap" style="text-align:center; padding:12px 0 4px 0;">
        <button type="button" class="button secondary small" id="feedLoadMoreBtn" style="border-radius:9999px; padding:7px 18px; font-size:12px; font-weight:600; cursor:pointer;">
          ➕ 피드 더 불러오기 (+20개)
        </button>
      </div>
    `
    : '';

  container.innerHTML = cardsHtml + loadMoreHtml;

  $('#feedLoadMoreBtn')?.addEventListener('click', () => {
    loadFeedPreview(true);
  });

  updateFeedSelectionToolbar();
}

function updateFeedDashboard(statusData) {
  if (!statusData) return;
  const { state: feedState, stats = {}, logs = [], currentPost = null } = statusData;
  activeFeedState = feedState || 'idle';
  activeFeedCurrentPost = currentPost;

  const isRunning = feedState === 'running';
  const isPaused = feedState === 'paused';
  const isCompleted = feedState === 'completed';
  const isError = feedState === 'error';
  const isIdle = feedState === 'idle' || feedState === 'stopped' || isCompleted || isError;

  // Status Badge
  const statusBadge = $('#feedAutoStatus');
  if (statusBadge) {
    statusBadge.className = `status ${isRunning ? 'active' : isPaused ? 'warning' : isCompleted ? 'success' : isError ? 'error' : 'ready'}`;
    if (isRunning) {
      statusBadge.innerHTML = `<i></i> 진행 중 (${stats.successCount || 0}/${stats.target || 10})`;
    } else if (isPaused) {
      statusBadge.innerHTML = '<i></i> 일시정지됨';
    } else if (isCompleted) {
      statusBadge.innerHTML = '<i></i> 소통 완료';
    } else if (isError) {
      statusBadge.innerHTML = '<i></i> 오류 발생';
    } else {
      statusBadge.innerHTML = '<i></i> 대기 중';
    }
  }

  // Buttons visibility
  const startBtn = $('#startFeedBtn');
  const pauseBtn = $('#pauseFeedBtn');
  const resumeBtn = $('#resumeFeedBtn');
  const stopBtn = $('#stopFeedBtn');

  if (startBtn) {
    startBtn.classList.toggle('hidden', !isIdle);
    if (isIdle) {
      startBtn.disabled = false;
      startBtn.innerHTML = '<span>🚀</span> <strong>이웃 새글 자동 소통 시작</strong>';
    }
  }
  if (pauseBtn) pauseBtn.classList.toggle('hidden', !isRunning);
  if (resumeBtn) resumeBtn.classList.toggle('hidden', !isPaused);
  if (stopBtn) stopBtn.classList.toggle('hidden', isIdle);

  // Session Stats Grid (4 Cards)
  const selectedCount = cachedFeedPosts.filter((p) => selectedFeedPostLogNos.has(p.logNo) && !p.engaged && !p.skipped).length;
  const isAwaitingSelection = feedState === 'idle' || feedState === 'stopped';
  const targetCount = isAwaitingSelection
    ? selectedCount
    : Math.max(0, Number(stats.target ?? $('#feedTargetCount')?.value ?? 0));
  const successCount = stats.successCount || 0;
  const remainingCount = Math.max(0, targetCount - successCount);
  const skippedCount = stats.skippedCount || 0;

  if ($('#feedStatTarget')) $('#feedStatTarget').textContent = String(targetCount);
  if ($('#feedStatSuccess')) $('#feedStatSuccess').textContent = String(successCount);
  if ($('#feedStatRemaining')) $('#feedStatRemaining').textContent = String(remainingCount);
  if ($('#feedStatSkipped')) $('#feedStatSkipped').textContent = String(skippedCount);

  // Today Cumulative Stats
  if (statusData.todayTotal !== undefined && $('#feedStatTotal')) {
    $('#feedStatTotal').textContent = String(statusData.todayTotal);
  }
  if (statusData.todayLikes !== undefined && $('#feedStatLikes')) {
    $('#feedStatLikes').textContent = String(statusData.todayLikes);
  }
  if (statusData.todayComments !== undefined && $('#feedStatComments')) {
    $('#feedStatComments').textContent = String(statusData.todayComments);
  }

  // Live Progress & In-Progress Highlight Banner
  const progressWidget = $('#feedLiveProgressWidget');
  if (progressWidget) {
    progressWidget.style.display = 'block';

    const percent = Math.min(100, Math.round((successCount / Math.max(1, targetCount)) * 100));
    const progressBar = $('#feedProgressBar');
    const progressPercent = $('#feedProgressPercent');
    const progressText = $('#feedProgressText');

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}% (${successCount}/${targetCount})`;
    if (progressText) {
      if (currentPost && currentPost.step === 'waiting') {
        progressText.textContent = `🛡️ 안전 대기 중 (${currentPost.countdown || 0}초 후 다음 글로 이동)`;
      } else {
        progressText.textContent = isRunning
          ? '실시간 소통 진행 중...'
          : isPaused
          ? '소통 일시정지됨'
          : isCompleted
          ? '회차 목표 달성 완료!'
          : '선택한 글을 기다리는 중';
      }
    }
  }

  // Active Post Highlight Card
  const activeCard = $('#feedActiveCard');
  if (activeCard) {
    if (currentPost && (isRunning || isPaused)) {
      activeCard.style.display = 'block';
      const isWaiting = currentPost.step === 'waiting';

      const badgeEl = activeCard.querySelector('.feed-active-badge');
      if (badgeEl) {
        if (isWaiting) {
          badgeEl.className = 'feed-active-badge waiting-mode';
          badgeEl.textContent = '🛡️ 계정 보호 안전 대기 중';
        } else {
          badgeEl.className = 'feed-active-badge';
          badgeEl.textContent = '현재 소통 중';
        }
      }

      if ($('#feedActiveAuthor')) $('#feedActiveAuthor').textContent = `👤 @${currentPost.author || currentPost.blogId}`;
      if ($('#feedActiveTitle')) $('#feedActiveTitle').textContent = currentPost.title || '새글 분석 중...';
      if ($('#feedActiveStepLabel')) $('#feedActiveStepLabel').textContent = currentPost.stepLabel || (isWaiting ? '계정 보호를 위해 잠시 대기 중...' : '분석 중...');

      const countdownEl = $('#feedActiveCountdown');
      if (countdownEl) {
        if (currentPost.countdown > 0) {
          countdownEl.style.display = 'inline-block';
          countdownEl.textContent = `${currentPost.countdown}초 후 다음 글`;
        } else {
          countdownEl.style.display = 'none';
        }
      }
    } else {
      activeCard.style.display = 'none';
    }
  }

  // Terminal Logs
  if (Array.isArray(logs) && logs.length > 0) {
    const container = $('#feedTerminalLogs');
    if (container) {
      const chronological = [...logs].reverse();
      container.innerHTML = chronological.map((log) => {
        const time = escapeHtml(log.time || '');
        const type = escapeHtml(log.type || log.level || 'info');
        const msg = escapeHtml(log.message || '');
        return `<div class="terminal-line ${type}">[${time}] ${msg}</div>`;
      }).join('');
      container.scrollTop = container.scrollHeight;
    }
  }

  // Dynamically update cached posts from statusData.recentRecords or currentPost
  if (cachedFeedPosts && cachedFeedPosts.length > 0) {
    let hasChanges = false;
    const records = Array.isArray(statusData.recentRecords) ? statusData.recentRecords : [];

    // 1. Sync recent records from historyStore
    for (const rec of records) {
      const cached = cachedFeedPosts.find((p) => p.logNo === rec.logNo);
      if (cached) {
        const isEngaged = Boolean(rec.liked || rec.commented || rec.status === 'success');
        const isSkipped = Boolean(rec.status === 'skipped');
        if (cached.engaged !== isEngaged || cached.skipped !== isSkipped || !cached.engagementRecord) {
          cached.engaged = isEngaged;
          cached.skipped = isSkipped;
          cached.engagementRecord = rec;
          hasChanges = true;
        }
      }
    }

    // 2. Immediate reflect from current completed/waiting post
    if (currentPost && (currentPost.step === 'done' || currentPost.step === 'waiting' || currentPost.step === 'skipped')) {
      const cached = cachedFeedPosts.find((p) => p.logNo === currentPost.logNo);
      if (cached && (currentPost.liked || currentPost.commented)) {
        if (!cached.engaged) {
          cached.engaged = true;
          cached.skipped = false;
          cached.engagementRecord = {
            liked: currentPost.liked,
            commented: currentPost.commented,
            commentText: currentPost.commentText || '',
            timestamp: new Date().toISOString(),
            status: 'success'
          };
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      renderFeedPosts();
    }
  }
}

async function refreshFeedSummary() {
  try {
    const summary = await api('api/feed/summary');
    if ($('#feedStatTotal') && summary.todayTotal !== undefined) {
      $('#feedStatTotal').textContent = String(summary.todayTotal);
    }
    if ($('#feedStatLikes') && summary.todayLikes !== undefined) {
      $('#feedStatLikes').textContent = String(summary.todayLikes);
    }
    if ($('#feedStatComments') && summary.todayComments !== undefined) {
      $('#feedStatComments').textContent = String(summary.todayComments);
    }
    if (summary.autoState === 'running' || summary.autoState === 'paused') {
      startFeedPolling();
    }
  } catch {}
}

function startFeedPolling() {
  if (feedStatusTimer) return;
  const poll = async () => {
    try {
      const data = await api('api/feed/status');
      updateFeedDashboard(data);
      if (data.state !== 'running' && data.state !== 'paused') {
        stopFeedPolling();
        refreshFeedSummary();
      }
    } catch {
      stopFeedPolling();
    }
  };
  poll();
  feedStatusTimer = setInterval(poll, 1500);
}

function stopFeedPolling() {
  if (feedStatusTimer) {
    clearInterval(feedStatusTimer);
    feedStatusTimer = null;
  }
}

async function loadFeedPreview(more = false) {
  const container = $('#feedPostsContainer');
  const refreshBtn = $('#refreshFeedPreviewBtn');
  if (!container || isFeedPreviewLoading) return;

  if (!state.connected) {
    container.innerHTML = `
      <div class="empty-state" style="text-align:center; padding: 40px 20px; color: var(--text-muted, #888);">
        <p style="font-weight:600; margin-bottom:8px; color:#1e293b;">네이버 로그인이 필요합니다</p>
        <span style="font-size:12.5px; color:#64748b;">이웃 새글 피드를 가져오려면 먼저 네이버 계정을 연결해주세요.</span>
        <div style="margin-top:14px;">
          <button type="button" class="button primary small" id="feedGoSettingsBtn">네이버 계정 연결하기</button>
        </div>
      </div>
    `;
    $('#feedGoSettingsBtn')?.addEventListener('click', () => setActiveTab('settings', true));
    return;
  }

  isFeedPreviewLoading = true;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '조회 중...';
  }
  const queryStatus = $('#feedPreviewQueryStatus');
  if (queryStatus && !more) {
    queryStatus.className = 'status loading';
    queryStatus.innerHTML = '<i></i> 목록 조회 중';
  }

  const targetLimit = more ? Math.min((cachedFeedPosts.length || 30) + 20, 100) : 30;

  if (!more) {
    selectedFeedPostLogNos.clear();
    container.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color: var(--text-muted, #64748b);">
        <div class="desktop-spinner" style="margin: 0 auto 12px auto;"></div>
        <span>실시간 네이버 이웃 새글 피드를 가져오는 중입니다...</span>
      </div>
    `;
  } else {
    const loadMoreBtn = $('#feedLoadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = '⏳ 피드 글 더 불러오는 중...';
    }
  }

  try {
    const data = await api(`api/feed/preview?limit=${targetLimit}`);
    cachedFeedPosts = data.posts || [];
    renderFeedPosts();
    if (queryStatus && !more) {
      queryStatus.className = `status ${cachedFeedPosts.length ? 'online' : ''}`;
      queryStatus.innerHTML = `<i></i> ${cachedFeedPosts.length}개 조회`;
    }
    if (more) {
      toast(`이웃 새글 피드를 총 ${cachedFeedPosts.length}개까지 추가로 불러왔습니다.`);
    }
  } catch (err) {
    if (!more) {
      container.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color: #ef4444;">
          <p style="margin-bottom:8px; font-weight:600;">피드 목록을 불러오지 못했습니다.</p>
          <span style="font-size:12px; color:#64748b;">${escapeHtml(err.message)}</span>
        </div>
      `;
      if (queryStatus) {
        queryStatus.className = 'status error';
        queryStatus.innerHTML = '<i></i> 조회 실패';
      }
    } else {
      toast(`추가 피드 로딩 실패: ${err.message}`, true);
      const loadMoreBtn = $('#feedLoadMoreBtn');
      if (loadMoreBtn) {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = '➕ 피드 더 불러오기 (+20개)';
      }
    }
  } finally {
    isFeedPreviewLoading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '목록 조회';
    }
  }
}

function initFeedEngagement() {
  // Keep one clear flow: choose posts on the left, monitor progress on the right.
  const selectionOptionsSlot = $('#feedSelectionOptionsSlot');
  const optionGroup = $('#cardFeedDoLike')?.closest('.form-group');
  const advancedToggle = $('#toggleFeedAdvancedBtn');
  const advancedDrawer = $('#feedAdvancedSettings');
  if (selectionOptionsSlot) {
    if (optionGroup) selectionOptionsSlot.appendChild(optionGroup);
    if (advancedToggle) selectionOptionsSlot.appendChild(advancedToggle);
    if (advancedDrawer) selectionOptionsSlot.appendChild(advancedDrawer);
  }

  const runControls = $('#pauseFeedBtn')?.parentElement;
  const progressWidget = $('#feedLiveProgressWidget');
  if (runControls && progressWidget) {
    runControls.classList.add('feed-run-controls');
    progressWidget.insertAdjacentElement('afterend', runControls);
  }

  // Option Cards interactive toggle
  const cardDoLike = $('#cardFeedDoLike');
  const inputDoLike = $('#feedDoLike');
  const cardDoComment = $('#cardFeedDoComment');
  const inputDoComment = $('#feedDoComment');

  const syncOptionCards = () => {
    if (cardDoLike && inputDoLike) {
      cardDoLike.classList.toggle('checked', inputDoLike.checked);
    }
    if (cardDoComment && inputDoComment) {
      cardDoComment.classList.toggle('checked', inputDoComment.checked);
    }
  };

  cardDoLike?.addEventListener('click', (e) => {
    if (e.target !== inputDoLike) {
      inputDoLike.checked = !inputDoLike.checked;
    }
    syncOptionCards();
  });

  cardDoComment?.addEventListener('click', (e) => {
    if (e.target !== inputDoComment) {
      inputDoComment.checked = !inputDoComment.checked;
    }
    syncOptionCards();
  });

  inputDoLike?.addEventListener('change', syncOptionCards);
  inputDoComment?.addEventListener('change', syncOptionCards);

  // Quick count buttons
  $('#feedQuickCounts')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('#feedQuickCounts .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    const input = $('#feedTargetCount');
    if (input) {
      input.value = chip.dataset.val;
      input.dispatchEvent(new Event('input'));
    }
  });

  $('#feedTargetCount')?.addEventListener('input', (e) => {
    const val = String(e.target.value);
    $$('#feedQuickCounts .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.val === val);
    });
    if ($('#feedStatTarget')) $('#feedStatTarget').textContent = val || '10';
    const success = Number($('#feedStatSuccess')?.textContent) || 0;
    if ($('#feedStatRemaining')) $('#feedStatRemaining').textContent = String(Math.max(0, (Number(val) || 10) - success));
  });

  // Filter Tabs
  $('#feedFilterTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.feed-filter-btn');
    if (!btn) return;
    $$('#feedFilterTabs .feed-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeFeedFilter = btn.dataset.filter || 'all';
    renderFeedPosts();
  });

  // Search Input
  $('#feedSearchInput')?.addEventListener('input', (e) => {
    feedSearchQuery = String(e.target.value || '').trim();
    renderFeedPosts();
  });

  // Action Buttons
  $('#startFeedBtn')?.addEventListener('click', async (e) => {
    e?.preventDefault();

    if (!state.connected) {
      toast('⚠️ 네이버 계정이 연결되어 있지 않습니다. 먼저 계정을 연결해주세요.', true);
      setActiveTab('settings', true);
      return;
    }

    const doLike = $('#feedDoLike')?.checked ?? true;
    const doComment = $('#feedDoComment')?.checked ?? true;
    if (!doLike && !doComment) {
      return toast('공감(❤️) 또는 AI 맞춤 댓글(💬) 중 최소 1개 이상을 선택해주세요.', true);
    }

    const targetCount = Number($('#feedTargetCount')?.value) || 10;
    const tone = $('#feedCommentTone')?.value || 'friendly';
    const speedMode = $('#feedSpeedMode')?.value || 'safe';

    let minDelaySec = 25;
    let maxDelaySec = 40;
    if (speedMode === 'balanced') {
      minDelaySec = 15;
      maxDelaySec = 25;
    } else if (speedMode === 'fast') {
      minDelaySec = 8;
      maxDelaySec = 15;
    }

    const startBtn = $('#startFeedBtn');
    try {
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<span>⏳</span> <strong>피드 탐색 준비 중...</strong>';
      }

      await api('api/feed/start', {
        method: 'POST',
        body: JSON.stringify({ targetCount, doLike, doComment, tone, commentTone: tone, minDelaySec, maxDelaySec, ...readCommentStyle('feed') })
      });

      toast(`이웃 새글 실시간 자동 소통을 시작합니다. (목표: ${targetCount}건)`);
      startFeedPolling();
    } catch (err) {
      toast(`피드 소통 시작 실패: ${err.message}`, true);
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<span>🚀</span> <strong>이웃 새글 자동 소통 시작</strong>';
      }
    }
  });

  $('#pauseFeedBtn')?.addEventListener('click', async () => {
    try {
      await api('api/feed/pause', { method: 'POST' });
      toast('이웃 새글 소통 작업을 일시정지했습니다.');
      const data = await api('api/feed/status');
      updateFeedDashboard(data);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#resumeFeedBtn')?.addEventListener('click', async () => {
    try {
      await api('api/feed/resume', { method: 'POST' });
      toast('이웃 새글 소통 작업을 재개했습니다.');
      const data = await api('api/feed/status');
      updateFeedDashboard(data);
      startFeedPolling();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#stopFeedBtn')?.addEventListener('click', async () => {
    if (!confirm('정말 진행 중인 이웃 새글 소통 작업을 중단하시겠습니까?')) return;
    try {
      await api('api/feed/stop', { method: 'POST' });
      toast('이웃 새글 소통 작업 중단을 요청했습니다.');
      const data = await api('api/feed/status');
      updateFeedDashboard(data);
      stopFeedPolling();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#copyFeedLogsBtn')?.addEventListener('click', () => {
    copyTerminalLogs('#feedTerminalLogs');
  });

  $('#clearFeedLogsBtn')?.addEventListener('click', () => {
    const container = $('#feedTerminalLogs');
    if (container) container.innerHTML = '<div class="terminal-line info">[로그 초기화됨]</div>';
  });

  // Advanced Settings Drawer Toggle
  $('#toggleFeedAdvancedBtn')?.addEventListener('click', () => {
    const toggleBtn = $('#toggleFeedAdvancedBtn');
    const drawer = $('#feedAdvancedSettings');
    if (drawer) {
      const isHidden = drawer.classList.toggle('hidden');
      if (toggleBtn) {
        toggleBtn.classList.toggle('open', !isHidden);
        toggleBtn.setAttribute('aria-expanded', String(!isHidden));
      }
      const stateLabel = $('#feedAdvancedArrow');
      if (stateLabel) stateLabel.textContent = isHidden ? '열기' : '닫기';
    }
  });

  // Select all pending posts
  $('#feedSelectAllCheckbox')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const pendingPosts = cachedFeedPosts.filter((p) => !p.engaged && !p.skipped);
    if (isChecked) {
      pendingPosts.forEach((p) => selectedFeedPostLogNos.add(p.logNo));
    } else {
      pendingPosts.forEach((p) => selectedFeedPostLogNos.delete(p.logNo));
    }
    $$('#feedPostsContainer .feed-post-check').forEach((cb) => {
      cb.checked = isChecked;
    });
    updateFeedSelectionToolbar();
  });

  // Batch engage selected posts
  $('#feedEngageSelectedBtn')?.addEventListener('click', async (e) => {
    e?.preventDefault();

    if (!state.connected) {
      toast('⚠️ 네이버 계정이 연결되어 있지 않습니다. 먼저 계정을 연결해주세요.', true);
      setActiveTab('settings', true);
      return;
    }

    const selectedPosts = cachedFeedPosts.filter((p) => selectedFeedPostLogNos.has(p.logNo) && !p.engaged && !p.skipped);
    if (selectedPosts.length === 0) {
      return toast('선택된 소통 대기 글이 없습니다.', true);
    }

    const doLike = $('#feedDoLike')?.checked ?? true;
    const doComment = $('#feedDoComment')?.checked ?? true;
    if (!doLike && !doComment) {
      return toast('공감(❤️) 또는 AI 맞춤 댓글(💬) 중 최소 1개 이상을 선택해주세요.', true);
    }

    const targetCount = selectedPosts.length;
    const tone = $('#feedCommentTone')?.value || 'friendly';
    const speedMode = $('#feedSpeedMode')?.value || 'safe';

    let minDelaySec = 25;
    let maxDelaySec = 40;
    if (speedMode === 'balanced') {
      minDelaySec = 15;
      maxDelaySec = 25;
    } else if (speedMode === 'fast') {
      minDelaySec = 8;
      maxDelaySec = 15;
    }

    const engageBtn = $('#feedEngageSelectedBtn');
    try {
      if (engageBtn) {
        engageBtn.disabled = true;
        engageBtn.textContent = '⏳ 작업 시작 중...';
      }

      await api('api/feed/start', {
        method: 'POST',
        body: JSON.stringify({
          targetCount,
          doLike,
          doComment,
          tone,
          commentTone: tone,
          minDelaySec,
          maxDelaySec,
          ...readCommentStyle('feed'),
          selectedPosts
        })
      });

      activeFeedState = 'running';
      toast(`선택한 ${selectedPosts.length}개 이웃 글에 대해 자동 소통을 시작합니다.`);
      selectedFeedPostLogNos.clear();
      updateFeedSelectionToolbar();
      renderFeedPosts();
      startFeedPolling();
    } catch (err) {
      toast(`선택 소통 시작 실패: ${err.message}`, true);
      if (engageBtn) {
        engageBtn.disabled = false;
        engageBtn.textContent = `선택한 ${selectedPosts.length}개 글 소통 시작`;
      }
    }
  });

  // Event delegation: checkbox or card click selects a post.
  const feedContainer = $('#feedPostsContainer');
  feedContainer?.addEventListener('change', (e) => {
    const check = e.target.closest('.feed-post-check');
    if (!check) return;
    const logNo = check.dataset.logno;
    if (!logNo) return;
    if (check.checked) {
      selectedFeedPostLogNos.add(logNo);
    } else {
      selectedFeedPostLogNos.delete(logNo);
    }
    updateFeedSelectionToolbar();
    renderFeedPosts();
  });

  feedContainer?.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, label')) return;
    const card = e.target.closest('.feed-post-card[data-selectable="true"]');
    if (!card) return;
    const check = card.querySelector('.feed-post-check');
    if (!check) return;
    check.checked = !check.checked;
    check.dispatchEvent(new Event('change', { bubbles: true }));
  });

  feedContainer?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.feed-post-card[data-selectable="true"]');
    if (!card || e.target !== card) return;
    e.preventDefault();
    card.click();
  });

  $('#refreshFeedPreviewBtn')?.addEventListener('click', () => {
    loadFeedPreview();
  });

  refreshFeedSummary();
}

async function handleSinglePostEngage(logNo, buttonEl) {
  if (!state.connected) {
    toast('⚠️ 네이버 계정이 연결되어 있지 않습니다. 먼저 계정을 연결해주세요.', true);
    setActiveTab('settings', true);
    return;
  }

  const post = cachedFeedPosts.find((p) => String(p.logNo) === String(logNo));
  if (!post) return;
  if (engagingSingleLogNos.has(post.logNo)) return;

  const doLike = $('#feedDoLike')?.checked ?? true;
  const doComment = $('#feedDoComment')?.checked ?? true;
  if (!doLike && !doComment) {
    return toast('공감(❤️) 또는 AI 맞춤 댓글(💬) 중 최소 1개 이상을 선택해주세요.', true);
  }

  const tone = $('#feedCommentTone')?.value || 'friendly';

  engagingSingleLogNos.add(post.logNo);
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.innerHTML = '<span>⏳</span> 소통 중...';
  }

  try {
    toast(`@${post.author || post.blogId} 님의 글에 즉시 소통을 진행합니다...`);
    const res = await api('api/feed/engage-single', {
      method: 'POST',
      body: JSON.stringify({
        postUrl: post.url,
        logNo: post.logNo,
        blogId: post.blogId,
        author: post.author,
        title: post.title,
        doLike,
        doComment,
        tone,
        commentTone: tone,
        secretComment: readCommentStyle('feed').secretComment
      })
    });

    if (res.status === 'success' || res.liked || res.commented) {
      post.engaged = true;
      post.skipped = false;
      post.engagementRecord = res.record || {
        liked: res.liked,
        commented: res.commented,
        commentText: res.commentText,
        timestamp: new Date().toISOString(),
        status: 'success'
      };
      selectedFeedPostLogNos.delete(post.logNo);
      toast(`✅ @${post.author || post.blogId} 님의 글에 소통을 완료했습니다!`);
    } else if (res.status === 'skipped') {
      post.skipped = true;
      post.engagementRecord = res.record || {
        status: 'skipped',
        statusMessage: res.statusMessage || res.reason || '기작성 댓글 감지'
      };
      selectedFeedPostLogNos.delete(post.logNo);
      toast(`⏩ @${post.author || post.blogId} 님의 글: ${res.statusMessage || res.reason || '제외되었습니다.'}`);
    } else {
      toast(`⚠️ 소통 처리 완료 (${res.statusMessage || '완료'})`);
    }
    refreshFeedSummary();
    renderFeedPosts();
  } catch (err) {
    toast(`단일 소통 실패: ${err.message}`, true);
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.innerHTML = '⚡ 바로 소통';
    }
  } finally {
    engagingSingleLogNos.delete(post.logNo);
  }
}

// ---------------------------------------------------------------------------
// Neighbor Cleaner (Received AI Screening & Sent Slot Recovery) Controller
// ---------------------------------------------------------------------------
let cleanerStatusTimer = null;
let isCleanerLoading = false;

function updateCleanerDashboard(statusData) {
  if (!statusData) return;
  const { state: cleanerState, stats = {}, logs = [] } = statusData;
  const isRunning = cleanerState === 'running';
  const isPaused = cleanerState === 'paused';
  const isCompleted = cleanerState === 'completed';
  const isError = cleanerState === 'error';
  const isIdle = cleanerState === 'idle' || cleanerState === 'stopped' || isCompleted || isError;

  // If received task
  if (stats.type === 'received') {
    const statusBadge = $('#receivedCleanAutoStatus');
    if (statusBadge) {
      statusBadge.className = `status ${isRunning ? 'active' : isPaused ? 'warning' : isCompleted ? 'success' : isError ? 'error' : 'ready'}`;
      if (isRunning) statusBadge.innerHTML = `<i></i> 진행 중 (${stats.processed || 0}/${stats.total || 0})`;
      else if (isPaused) statusBadge.innerHTML = '<i></i> 일시정지됨';
      else if (isCompleted) statusBadge.innerHTML = '<i></i> 처리 완료';
      else if (isError) statusBadge.innerHTML = '<i></i> 오류 발생';
      else statusBadge.innerHTML = '<i></i> 대기 중';
    }

    const startBtn = $('#startReceivedCleanBtn');
    const pauseBtn = $('#pauseReceivedCleanBtn');
    const resumeBtn = $('#resumeReceivedCleanBtn');
    const stopBtn = $('#stopReceivedCleanBtn');

    if (startBtn) {
      startBtn.classList.toggle('hidden', !isIdle);
      if (isIdle) {
        startBtn.disabled = false;
        const acceptAll = !($('#cleanerAcceptGenuine')?.checked ?? true) && !($('#cleanerRejectSpam')?.checked ?? true);
        startBtn.innerHTML = acceptAll
          ? '<strong>모든 신청 수락</strong>'
          : '<strong>선별 처리 시작</strong>';
      }
    }
    if (pauseBtn) pauseBtn.classList.toggle('hidden', !isRunning);
    if (resumeBtn) resumeBtn.classList.toggle('hidden', !isPaused);
    if (stopBtn) stopBtn.classList.toggle('hidden', isIdle);

    if ($('#cleanerStatReceivedTotal')) $('#cleanerStatReceivedTotal').textContent = String(stats.total || 0);
    if ($('#cleanerStatReceivedAccepted')) $('#cleanerStatReceivedAccepted').textContent = String(stats.accepted || 0);
    if ($('#cleanerStatReceivedRejected')) $('#cleanerStatReceivedRejected').textContent = String(stats.rejected || 0);

    // Terminal logs
    const container = $('#cleanerTerminalLogs');
    if (container && Array.isArray(logs) && logs.length > 0) {
      const chronological = [...logs].reverse();
      container.innerHTML = chronological.map((log) => {
        const time = escapeHtml(log.time || '');
        const type = escapeHtml(log.type || 'info');
        const msg = escapeHtml(log.message || '');
        return `<div class="terminal-line ${type}">[${time}] ${msg}</div>`;
      }).join('');
      container.scrollTop = container.scrollHeight;
    }
  } else if (stats.type === 'sent') {
    // If sent task
    const statusBadge = $('#sentCleanAutoStatus');
    if (statusBadge) {
      statusBadge.className = `status ${isRunning ? 'active' : isPaused ? 'warning' : isCompleted ? 'success' : isError ? 'error' : 'ready'}`;
      if (isRunning) statusBadge.innerHTML = `<i></i> 취소 진행 중 (${stats.processed || 0}/${stats.total || 0})`;
      else if (isCompleted) statusBadge.innerHTML = '<i></i> 회수 완료';
      else if (isError) statusBadge.innerHTML = '<i></i> 오류 발생';
      else statusBadge.innerHTML = '<i></i> 대기 중';
    }

    const startBtn = $('#startSentCancelBtn');
    const stopBtn = $('#stopSentCancelBtn');

    if (startBtn) {
      startBtn.classList.toggle('hidden', !isIdle);
      if (isIdle) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<strong>오래된 신청 취소</strong>';
      }
    }
    if (stopBtn) stopBtn.classList.toggle('hidden', isIdle);

    if ($('#cleanerStatSentTotal')) $('#cleanerStatSentTotal').textContent = String(stats.total || 0);
    if ($('#cleanerStatSentCanceled')) $('#cleanerStatSentCanceled').textContent = String(stats.canceled || 0);

    const container = $('#sentTerminalLogs');
    if (container && Array.isArray(logs) && logs.length > 0) {
      const chronological = [...logs].reverse();
      container.innerHTML = chronological.map((log) => {
        const time = escapeHtml(log.time || '');
        const type = escapeHtml(log.type || 'info');
        const msg = escapeHtml(log.message || '');
        return `<div class="terminal-line ${type}">[${time}] ${msg}</div>`;
      }).join('');
      container.scrollTop = container.scrollHeight;
    }
  }
}

function startCleanerPolling(taskType) {
  if (cleanerStatusTimer) return;
  const poll = async () => {
    try {
      const data = await api('api/cleaner/status');
      updateCleanerDashboard(data);
      if (data.state !== 'running' && data.state !== 'paused') {
        stopCleanerPolling();
        if (taskType === 'received') loadReceivedCleanerList();
        if (taskType === 'sent') loadSentCleanerList();
      }
    } catch {
      stopCleanerPolling();
    }
  };
  poll();
  cleanerStatusTimer = setInterval(poll, 1500);
}

function stopCleanerPolling() {
  if (cleanerStatusTimer) {
    clearInterval(cleanerStatusTimer);
    cleanerStatusTimer = null;
  }
}

function renderCleanerEmptyState(title, description) {
  return `
    <div class="empty-state cleaner-empty-state">
      <div class="cleaner-empty-icon" aria-hidden="true"></div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

async function loadReceivedCleanerList() {
  const container = $('#receivedRequestsContainer');
  const refreshBtn = $('#refreshReceivedListBtn');
  const queryStatus = $('#receivedListStatus');
  if (!container || isCleanerLoading) return;

  if (!state.connected) {
    container.innerHTML = renderCleanerEmptyState(
      '네이버 로그인이 필요합니다',
      '받은 신청 목록을 불러오려면 먼저 네이버 계정을 연결해주세요.'
    );
    if (queryStatus) { queryStatus.className = 'status error'; queryStatus.innerHTML = '<i></i> 로그인 필요'; }
    return;
  }

  isCleanerLoading = true;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '조회 중...';
  }
  if (queryStatus) { queryStatus.className = 'status loading'; queryStatus.innerHTML = '<i></i> 목록 조회 중'; }

  container.innerHTML = `
    <div style="text-align:center; padding:40px 20px; color:var(--text-muted, #64748b);">
      <div class="desktop-spinner" style="margin:0 auto 12px auto;"></div>
      <span>받은 서로이웃 신청 목록을 가져와 AI 분석 중입니다...</span>
    </div>
  `;

  try {
    const data = await api('api/cleaner/received/preview');
    const requests = data.requests || [];

    if ($('#cleanerStatReceivedTotal')) $('#cleanerStatReceivedTotal').textContent = String(requests.length);
    if (queryStatus) { queryStatus.className = `status ${requests.length ? 'online' : ''}`; queryStatus.innerHTML = `<i></i> ${requests.length}개 조회`; }

    if (!requests.length) {
      container.innerHTML = renderCleanerEmptyState(
        '대기 중인 신청이 없습니다',
        '새로운 서로이웃 신청이 들어오면 이곳에 표시됩니다.'
      );
      return;
    }

    container.innerHTML = requests.map((req) => {
      const isAccept = req.evaluation?.decision === 'accept';
      const badgeStyle = isAccept
        ? 'background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;'
        : 'background:#fef2f2; color:#991b1b; border:1px solid #fecaca;';
      const badgeIcon = isAccept ? '✅' : '🛡️';
      const badgeLabel = isAccept ? '수락 권장' : '거절 권장';
      const reason = escapeHtml(req.evaluation?.reason || '');

      return `
        <article class="cleaner-request-card" data-received-blog-id="${escapeHtml(req.targetBlogId)}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:32px; height:32px; border-radius:50%; background:#e0e7ff; color:#4338ca; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; flex-shrink:0;">
                ${escapeHtml((req.nickname || req.targetBlogId || '이').slice(0, 1))}
              </div>
              <div style="display:flex; flex-direction:column; gap:1px;">
                <span style="font-size:13.5px; font-weight:700; color:#0f172a; line-height:1.2;">
                  ${escapeHtml(req.nickname || req.targetBlogId)}
                </span>
                <a href="${escapeHtml(req.blogUrl)}" target="_blank" rel="noopener noreferrer" style="color:#64748b; font-size:11.5px; text-decoration:none;">
                  @${escapeHtml(req.targetBlogId)} ↗
                </a>
              </div>
            </div>
            <span style="font-size:11px; font-weight:600; color:#64748b; background:#f1f5f9; padding:3px 8px; border-radius:9999px;">
              ${escapeHtml(req.dateStr || '')} (${req.daysAgo || 0}일 전)
            </span>
          </div>

          <div style="background:#f8fafc; padding:10px 12px; border-radius:8px; border:1px solid #f1f5f9; font-size:12.5px; color:#334155; line-height:1.5;">
            💬 "${escapeHtml(req.message || '메시지 없음')}"
          </div>

          <div class="cleaner-request-actions">
            <span class="cleaner-evaluation-badge" style="${badgeStyle}">
              <span>${badgeIcon}</span> ${badgeLabel} <small style="font-weight:500; opacity:0.85;">· ${reason}</small>
            </span>
            <button type="button" class="cleaner-single-accept-btn" data-blog-id="${escapeHtml(req.targetBlogId)}" data-nickname="${escapeHtml(req.nickname || req.targetBlogId)}">
              <span>✓</span> 수락
            </button>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    if (queryStatus) { queryStatus.className = 'status error'; queryStatus.innerHTML = '<i></i> 조회 실패'; }
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:#ef4444;">
        <p style="margin-bottom:8px; font-weight:600;">신청 목록을 불러오지 못했습니다.</p>
        <span style="font-size:12px; color:#64748b;">${escapeHtml(err.message)}</span>
      </div>
    `;
  } finally {
    isCleanerLoading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '목록 조회';
    }
  }
}

async function loadSentCleanerList() {
  const container = $('#sentRequestsContainer');
  const refreshBtn = $('#refreshSentListBtn');
  const queryStatus = $('#sentListStatus');
  if (!container || isCleanerLoading) return;

  if (!state.connected) {
    container.innerHTML = renderCleanerEmptyState(
      '네이버 로그인이 필요합니다',
      '보낸 신청 목록을 불러오려면 먼저 네이버 계정을 연결해주세요.'
    );
    if (queryStatus) { queryStatus.className = 'status error'; queryStatus.innerHTML = '<i></i> 로그인 필요'; }
    return;
  }

  const olderThanDays = Number($('#sentOlderThanDays')?.value) || 7;
  isCleanerLoading = true;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '조회 중...';
  }
  if (queryStatus) { queryStatus.className = 'status loading'; queryStatus.innerHTML = '<i></i> 목록 조회 중'; }

  container.innerHTML = `
    <div style="text-align:center; padding:40px 20px; color:var(--text-muted, #64748b);">
      <div class="desktop-spinner" style="margin:0 auto 12px auto;"></div>
      <span>${olderThanDays}일 이상 경과한 보낸 신청 목록을 탐색 중입니다...</span>
    </div>
  `;

  try {
    const data = await api(`api/cleaner/sent/preview?olderThanDays=${olderThanDays}`);
    const requests = data.requests || [];

    if ($('#cleanerStatSentTotal')) $('#cleanerStatSentTotal').textContent = String(requests.length);
    if (queryStatus) { queryStatus.className = `status ${requests.length ? 'online' : ''}`; queryStatus.innerHTML = `<i></i> ${requests.length}개 조회`; }

    if (!requests.length) {
      container.innerHTML = renderCleanerEmptyState(
        '정리할 보낸 신청이 없습니다',
        `${olderThanDays}일 이상 지난 미수락 신청이 없습니다.`
      );
      return;
    }

    container.innerHTML = requests.map((req) => {
      return `
        <article class="cleaner-request-card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; transition:all 0.2s ease;">
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              <span style="font-size:13px; font-weight:600; color:#1e293b;">
                ${escapeHtml(req.nickname || req.targetBlogId)}
              </span>
              <a href="https://blog.naver.com/${escapeHtml(req.targetBlogId)}" target="_blank" rel="noopener noreferrer" style="font-size:11.5px; color:#64748b; text-decoration:none;">@${escapeHtml(req.targetBlogId)} ↗</a>
            </div>
            <div style="font-size:11.5px; color:#64748b; margin-top:2px;">
              신청일: ${escapeHtml(req.dateStr || '')} · <strong style="color:#d97706;">${req.daysAgo || 0}일 경과</strong>
            </div>
          </div>
          <span style="font-size:12px; color:#dc2626; font-weight:600; background:#fef2f2; padding:3px 8px; border-radius:12px; border:1px solid #fecaca;">
            회수 대상
          </span>
        </article>
      `;
    }).join('');
  } catch (err) {
    if (queryStatus) { queryStatus.className = 'status error'; queryStatus.innerHTML = '<i></i> 조회 실패'; }
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:#ef4444;">
        <p style="margin-bottom:8px; font-weight:600;">보낸 신청 목록을 불러오지 못했습니다.</p>
        <span style="font-size:12px; color:#64748b;">${escapeHtml(err.message)}</span>
      </div>
    `;
  } finally {
    isCleanerLoading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '목록 조회';
    }
  }
}

function resetSentCleanerListQuery() {
  const container = $('#sentRequestsContainer');
  const queryStatus = $('#sentListStatus');
  const total = $('#cleanerStatSentTotal');
  if (queryStatus) { queryStatus.className = 'status'; queryStatus.innerHTML = '<i></i> 조회 전'; }
  if (total) total.textContent = '0';
  if (container) {
    container.innerHTML = renderCleanerEmptyState(
      '보낸 신청을 확인하세요',
      '목록 조회를 누르면 설정한 기간의 미수락 신청을 불러옵니다.'
    );
  }
}

function initNeighborCleaner() {
  // Sub-tab switcher
  $$('.cleaner-subtabs-nav .cleaner-subtab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.cleaner-subtabs-nav .cleaner-subtab-btn').forEach((b) => {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      const targetSubtab = btn.dataset.subtab;
      $('#subtabReceivedCleaner')?.classList.toggle('hidden', targetSubtab !== 'received-cleaner');
      $('#subtabSentCleaner')?.classList.toggle('hidden', targetSubtab !== 'sent-cleaner');
      $('#subtabNeighborHealth')?.classList.toggle('hidden', targetSubtab !== 'neighbor-health');

    });
  });

  // Option card toggle handlers. Turning both conditions off explicitly means accept all.
  const syncCleanerAcceptMode = () => {
    const acceptGenuine = $('#cleanerAcceptGenuine')?.checked ?? true;
    const rejectSpam = $('#cleanerRejectSpam')?.checked ?? true;
    const acceptAll = !acceptGenuine && !rejectSpam;
    const notice = $('#cleanerAcceptModeNotice');
    const title = $('#cleanerAcceptModeTitle');
    const desc = $('#cleanerAcceptModeDesc');
    const startBtn = $('#startReceivedCleanBtn');

    $('#cardOptionAcceptGenuine')?.classList.toggle('checked', acceptGenuine);
    $('#cardOptionRejectSpam')?.classList.toggle('checked', rejectSpam);
    notice?.classList.toggle('accept-all', acceptAll);
    if (title) title.textContent = acceptAll ? '조건 없이 모두 수락' : 'AI 선별 수락 모드';
    if (desc) {
      desc.textContent = acceptAll
        ? '두 조건이 모두 꺼져 있어 AI 판정 없이 대기 중인 신청을 전부 수락합니다.'
        : '선택한 조건에 따라 진성 이웃은 수락하고 광고·매크로는 거절합니다.';
    }
    if (startBtn && !startBtn.disabled) {
      startBtn.innerHTML = acceptAll
        ? '<strong>모든 신청 수락</strong>'
        : '<strong>선별 처리 시작</strong>';
    }
  };

  $('#cleanerAcceptGenuine')?.addEventListener('change', syncCleanerAcceptMode);
  $('#cleanerRejectSpam')?.addEventListener('change', syncCleanerAcceptMode);
  syncCleanerAcceptMode();

  // Received Cleaner Actions
  $('#startReceivedCleanBtn')?.addEventListener('click', async (e) => {
    e?.preventDefault();
    if (!state.connected) {
      toast('⚠️ 네이버 계정이 연결되어 있지 않습니다. 먼저 계정을 연결해주세요.', true);
      setActiveTab('settings', true);
      return;
    }

    const acceptGenuine = $('#cleanerAcceptGenuine')?.checked ?? true;
    const rejectSpam = $('#cleanerRejectSpam')?.checked ?? true;
    const acceptAll = !acceptGenuine && !rejectSpam;
    if (acceptAll && !confirm('AI 판정 없이 대기 중인 받은 서로이웃 신청을 모두 수락하시겠습니까?')) {
      return;
    }

    const startBtn = $('#startReceivedCleanBtn');
    try {
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<strong>준비 중...</strong>';
      }

      await api('api/cleaner/received/start', {
        method: 'POST',
        body: JSON.stringify({ acceptGenuine, rejectSpam })
      });

      toast(acceptAll
        ? '대기 중인 받은 서로이웃 신청을 조건 없이 모두 수락합니다.'
        : '받은 서로이웃 신청 AI 자동 선별 처리를 시작합니다.');
      startCleanerPolling('received');
    } catch (err) {
      toast(`선별 시작 실패: ${err.message}`, true);
      if (startBtn) {
        startBtn.disabled = false;
        syncCleanerAcceptMode();
      }
    }
  });

  $('#pauseReceivedCleanBtn')?.addEventListener('click', async () => {
    try {
      await api('api/cleaner/pause', { method: 'POST' });
      toast('선별 작업을 일시정지했습니다.');
      const data = await api('api/cleaner/status');
      updateCleanerDashboard(data);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#resumeReceivedCleanBtn')?.addEventListener('click', async () => {
    try {
      await api('api/cleaner/resume', { method: 'POST' });
      toast('선별 작업을 다시 재개합니다.');
      startCleanerPolling('received');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#stopReceivedCleanBtn')?.addEventListener('click', async () => {
    if (!confirm('정말 진행 중인 선별 작업을 중단하시겠습니까?')) return;
    try {
      await api('api/cleaner/stop', { method: 'POST' });
      toast('선별 작업 중단을 요청했습니다.');
      stopCleanerPolling();
      const data = await api('api/cleaner/status');
      updateCleanerDashboard(data);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#copyCleanerLogsBtn')?.addEventListener('click', () => {
    copyTerminalLogs('#cleanerTerminalLogs');
  });

  $('#clearCleanerLogsBtn')?.addEventListener('click', () => {
    const container = $('#cleanerTerminalLogs');
    if (container) container.innerHTML = '<div class="terminal-line info">[로그 초기화됨]</div>';
  });

  $('#refreshReceivedListBtn')?.addEventListener('click', () => {
    loadReceivedCleanerList();
  });

  $('#receivedRequestsContainer')?.addEventListener('click', async (e) => {
    const button = e.target.closest('.cleaner-single-accept-btn');
    if (!button || button.disabled) return;

    const targetBlogId = button.dataset.blogId;
    const nickname = button.dataset.nickname || targetBlogId;
    if (!targetBlogId) return;
    if (!confirm(`@${targetBlogId} (${nickname}) 님의 서로이웃 신청을 수락하시겠습니까?`)) return;

    button.disabled = true;
    button.innerHTML = '<span>⏳</span> 수락 중...';
    try {
      await api('api/cleaner/received/accept', {
        method: 'POST',
        body: JSON.stringify({ targetBlogId })
      });

      const card = button.closest('.cleaner-request-card');
      card?.classList.add('is-accepted');
      button.innerHTML = '<span>✓</span> 수락 완료';
      const acceptedEl = $('#cleanerStatReceivedAccepted');
      if (acceptedEl) acceptedEl.textContent = String((Number(acceptedEl.textContent) || 0) + 1);
      const totalEl = $('#cleanerStatReceivedTotal');
      if (totalEl) totalEl.textContent = String(Math.max(0, (Number(totalEl.textContent) || 0) - 1));
      toast(`✅ @${targetBlogId} 님의 서로이웃 신청을 수락했습니다.`);

      setTimeout(() => {
        card?.remove();
        const container = $('#receivedRequestsContainer');
        if (container && !container.querySelector('.cleaner-request-card')) {
          container.innerHTML = renderCleanerEmptyState(
            '대기 중인 신청이 없습니다',
            '새로운 서로이웃 신청이 들어오면 이곳에 표시됩니다.'
          );
        }
      }, 700);
    } catch (err) {
      button.disabled = false;
      button.innerHTML = '<span>✓</span> 수락';
      toast(`개별 수락 실패: ${err.message}`, true);
    }
  });

  // Sent Cleaner Actions
  $$('#sentDaysChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#sentDaysChips .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const input = $('#sentOlderThanDays');
      if (input) {
        input.value = chip.dataset.days;
        resetSentCleanerListQuery();
      }
    });
  });

  $('#sentOlderThanDays')?.addEventListener('change', () => {
    const val = $('#sentOlderThanDays')?.value;
    $$('#sentDaysChips .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.days === val);
    });
    resetSentCleanerListQuery();
  });

  $('#startSentCancelBtn')?.addEventListener('click', async (e) => {
    e?.preventDefault();
    if (!state.connected) {
      toast('⚠️ 네이버 계정이 연결되어 있지 않습니다. 먼저 계정을 연결해주세요.', true);
      setActiveTab('settings', true);
      return;
    }

    const olderThanDays = Number($('#sentOlderThanDays')?.value) || 7;
    if (!confirm(`${olderThanDays}일 이상 경과한 미수락 보낸 신청을 일괄 취소하여 슬롯을 복구하시겠습니까?`)) {
      return;
    }

    const startBtn = $('#startSentCancelBtn');
    try {
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<span class="btn-icon">⏳</span> <strong>신청 회수 준비 중...</strong>';
      }

      await api('api/cleaner/sent/start', {
        method: 'POST',
        body: JSON.stringify({ olderThanDays })
      });

      const statusBadge = $('#sentCleanAutoStatus');
      if (statusBadge) {
        statusBadge.className = 'status active';
        statusBadge.innerHTML = '<i></i> 목록 분석 중';
      }
      toast(`보낸 신청 회수 작업을 시작합니다. 진행 상황을 실시간으로 표시합니다. (${olderThanDays}일 이상 경과 대상)`);
      startCleanerPolling('sent');
    } catch (err) {
      toast(`회수 시작 실패: ${err.message}`, true);
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<strong>오래된 신청 취소</strong>';
      }
    }
  });

  $('#stopSentCancelBtn')?.addEventListener('click', async () => {
    if (!confirm('정말 보낸 신청 회수 작업을 중단하시겠습니까?')) return;
    try {
      await api('api/cleaner/stop', { method: 'POST' });
      toast('회수 작업 중단을 요청했습니다.');
      stopCleanerPolling();
      const data = await api('api/cleaner/status');
      updateCleanerDashboard(data);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#copySentLogsBtn')?.addEventListener('click', () => {
    copyTerminalLogs('#sentTerminalLogs');
  });

  $('#clearSentLogsBtn')?.addEventListener('click', () => {
    const container = $('#sentTerminalLogs');
    if (container) container.innerHTML = '<div class="terminal-line info">[로그 초기화됨]</div>';
  });

  $('#refreshSentListBtn')?.addEventListener('click', () => {
    loadSentCleanerList();
  });
}

// ---------------------------------------------------------------------------
// Target Finder & AI Recommendation Modal Controller
// ---------------------------------------------------------------------------
const CATEGORY_PRESETS = [
  {
    title: '🍽️ 맛집 / 카페 / 베이킹',
    keywords: ['맛집', '카페투어', '성수카페', '디저트', '베이킹', '홈카페', '브런치', '강남맛집']
  },
  {
    title: '✈️ 여행 / 캠핑 / 나들이',
    keywords: ['국내여행', '해외여행', '제주여행', '차박', '캠핑용품', '감성숙소', '주말나들이', '등산']
  },
  {
    title: '💄 뷰티 / 패션 / 다이어트',
    keywords: ['데일리룩', '스킨케어', '뷰티템', '올리브영추천', '다이어트식단', '패션코디', '네일아트', '메이크업']
  },
  {
    title: '👶 육아 / 키즈 / 일상',
    keywords: ['육아소통', '육아맘', '아이간식', '유아식', '책육아', '어린이집', '초등맘', '가족일상']
  },
  {
    title: '💻 IT / 테크 / 전자기기',
    keywords: ['IT리뷰', '전자기기', '스마트폰', '데스크테리어', '앱추천', '맥북', '아이패드', 'PC조립']
  },
  {
    title: '💰 재테크 / 부동산 / 비즈니스',
    keywords: ['재테크', '주식투자', '부동산', '청약', '짠테크', '부업', '마케팅', '자기계발']
  },
  {
    title: '🐶 반려동물 (펫)',
    keywords: ['반려견', '강아지일상', '고양이집사', '댕댕이', '펫스타그램', '애견동반', '멍스타그램', '반려묘']
  },
  {
    title: '📚 문화 / 도서 / 취미',
    keywords: ['책추천', '독서기록', '영화리뷰', '전시회', '음악추천', '취미미술', '글쓰기', '원데이클래스']
  }
];

function initTargetFinderModal() {
  const modal = $('#targetFinderModal');
  if (!modal) return;

  let activeTargetInput = $('#engKeyword');
  const selectedFinderKeywords = new Set();
  let trendsLoaded = false;
  let presetsRendered = false;
  let myBlogAnalysisData = null;

  function updateSelectedClasses() {
    // Update AI recommendation cards
    $$('#myBlogKeywordsGrid .rec-card').forEach((card) => {
      const kw = card.dataset.keyword;
      card.classList.toggle('selected', selectedFinderKeywords.has(kw));
    });

    // Update Trends cards
    $$('#modalTrendsGrid .trend-item-card').forEach((card) => {
      const kw = card.dataset.keyword;
      card.classList.toggle('selected', selectedFinderKeywords.has(kw));
    });

    // Update Presets chips
    $$('#categoryPresetsGrid .preset-chip').forEach((chip) => {
      const kw = chip.dataset.keyword;
      chip.classList.toggle('selected', selectedFinderKeywords.has(kw));
    });

    $$('#relatedKeywordsGrid .preset-chip').forEach((chip) => {
      const kw = chip.dataset.keyword;
      chip.classList.toggle('selected', selectedFinderKeywords.has(kw));
    });

    // Update Tray
    const countEl = $('#finderSelectedCount');
    if (countEl) countEl.textContent = selectedFinderKeywords.size;

    const chipsEl = $('#finderSelectedChips');
    if (chipsEl) {
      if (selectedFinderKeywords.size === 0) {
        chipsEl.innerHTML = '<span class="tray-empty-hint">위 목록에서 키워드를 클릭하여 소통 타겟을 추가하세요.</span>';
      } else {
        chipsEl.innerHTML = Array.from(selectedFinderKeywords)
          .map((kw) => `<span class="selected-tray-chip">${escapeHtml(kw)} <button type="button" class="btn-remove-chip" data-kw="${escapeHtml(kw)}" title="제거">✕</button></span>`)
          .join('');
      }
    }

    const applyBtn = $('#applyTargetFinderBtn');
    if (applyBtn) {
      applyBtn.disabled = selectedFinderKeywords.size === 0;
      const textEl = $('#applyTargetBtnText');
      if (textEl) {
        textEl.textContent = selectedFinderKeywords.size > 0 
          ? `선택 키워드 ${selectedFinderKeywords.size}개 적용하기` 
          : '선택 키워드 적용하기';
      }
    }
  }

  function toggleKeyword(kw) {
    if (!kw) return;
    kw = kw.trim();
    if (!kw) return;
    if (selectedFinderKeywords.has(kw)) {
      selectedFinderKeywords.delete(kw);
    } else {
      selectedFinderKeywords.add(kw);
    }
    updateSelectedClasses();
  }

  function openFinder(targetInputEl) {
    activeTargetInput = targetInputEl || $('#engKeyword');
    selectedFinderKeywords.clear();

    // Populate from active input
    if (activeTargetInput && activeTargetInput.value) {
      activeTargetInput.value.split(/[,，\n]+/)
        .map((k) => k.trim())
        .filter(Boolean)
        .forEach((k) => selectedFinderKeywords.add(k));
    }

    modal.classList.remove('hidden');

    // Default to first tab or keep state
    if (!presetsRendered) {
      renderCategoryPresets();
    }
    updateSelectedClasses();
  }

  function closeFinder() {
    modal.classList.add('hidden');
  }

  // Open triggers
  $('#openTargetFinderBtn')?.addEventListener('click', () => openFinder($('#engKeyword')));
  $('#openTargetFinderInlineBtn')?.addEventListener('click', () => openFinder($('#engKeyword')));
  $('#openAutoTargetFinderBtn')?.addEventListener('click', () => openFinder($('#autoKeyword')));
  $('#openAutoTargetFinderInlineBtn')?.addEventListener('click', () => openFinder($('#autoKeyword')));

  // Close triggers
  $('#closeTargetFinderModal')?.addEventListener('click', closeFinder);
  $('#cancelTargetFinderBtn')?.addEventListener('click', closeFinder);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeFinder();
  });

  // Tray interaction: remove chip
  $('#finderSelectedChips')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-chip');
    if (!btn) return;
    const kw = btn.dataset.kw;
    if (kw) {
      selectedFinderKeywords.delete(kw);
      updateSelectedClasses();
    }
  });

  // Tray clear
  $('#clearFinderSelectionBtn')?.addEventListener('click', () => {
    selectedFinderKeywords.clear();
    updateSelectedClasses();
  });

  // Tray apply
  $('#applyTargetFinderBtn')?.addEventListener('click', () => {
    if (selectedFinderKeywords.size === 0) return;
    if (activeTargetInput) {
      activeTargetInput.value = Array.from(selectedFinderKeywords).join(', ');
      activeTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    closeFinder();
    toast(`소통 타겟 키워드 ${selectedFinderKeywords.size}개가 적용되었습니다.`);
  });

  // Tab switching
  $$('.finder-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const tabId = tabBtn.dataset.finderTab;
      $$('.finder-tab').forEach((t) => t.classList.remove('active'));
      tabBtn.classList.add('active');

      $$('.finder-panel').forEach((p) => {
        if (p.dataset.panel === tabId) {
          p.classList.remove('hidden');
        } else {
          p.classList.add('hidden');
        }
      });

      if (tabId === 'trends' && !trendsLoaded) {
        loadModalTrends();
      }
      if (tabId === 'presets' && !presetsRendered) {
        renderCategoryPresets();
      }
    });
  });

  // TAB 1: My Blog AI Recommendations
  $('#startMyBlogAnalysisBtn')?.addEventListener('click', async () => {
    const banner = $('#myBlogAnalysisBanner');
    const loading = $('#myBlogAnalysisLoading');
    const result = $('#myBlogAnalysisResult');

    if (!state.connected) {
      toast('⚠️ 네이버 로그인이 필요합니다. 먼저 네이버 계정을 연결해주세요.', true);
      return;
    }

    try {
      if (banner) banner.classList.add('hidden');
      if (loading) loading.classList.remove('hidden');
      if (result) result.classList.add('hidden');

      const data = await api('api/blog/my-recommendations');
      myBlogAnalysisData = data;

      if (loading) loading.classList.add('hidden');
      if (result) result.classList.remove('hidden');

      const summaryText = $('#analysisSummaryText');
      const audienceText = $('#analysisAudienceText');
      if (summaryText) summaryText.textContent = data.summary || '최근 작성된 포스팅을 바탕으로 주제 분석을 완료했습니다.';
      if (audienceText) audienceText.textContent = data.audience || '일상, 리뷰, 관심사 기반의 활발한 소통 이웃';

      const grid = $('#myBlogKeywordsGrid');
      if (grid) {
        const targets = data.targets || [];
        if (targets.length === 0) {
          grid.innerHTML = '<div style="grid-column:1/-1; color:#94a3b8; text-align:center; padding:20px;">추출된 추천 키워드가 없습니다. 최근 포스팅을 확인해주세요.</div>';
        } else {
          grid.innerHTML = targets.map((item) => `
            <div class="rec-card ${selectedFinderKeywords.has(item.keyword) ? 'selected' : ''}" data-keyword="${escapeHtml(item.keyword)}">
              <div class="rec-card-header">
                <span class="rec-keyword">🎯 ${escapeHtml(item.keyword)}</span>
                <span class="rec-score">${escapeHtml(String(item.score || 90))}점</span>
              </div>
              <p class="rec-reason">${escapeHtml(item.reason || '내 블로그 포스팅과의 밀접한 연관성')}</p>
            </div>
          `).join('');
        }
      }
      updateSelectedClasses();
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      if (banner) banner.classList.remove('hidden');
      toast('블로그 분석 실패: ' + (err.message || '알 수 없는 오류'), true);
    }
  });

  // Add all AI recommended keywords
  $('#addAllMyBlogKeywordsBtn')?.addEventListener('click', () => {
    if (!myBlogAnalysisData?.targets?.length) return;
    myBlogAnalysisData.targets.forEach((item) => {
      if (item.keyword) selectedFinderKeywords.add(item.keyword);
    });
    updateSelectedClasses();
    toast(`AI 추천 키워드 ${myBlogAnalysisData.targets.length}개를 담았습니다.`);
  });

  // Keyword grid click (delegation)
  $('#myBlogKeywordsGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.rec-card');
    if (!card) return;
    toggleKeyword(card.dataset.keyword);
  });

  // TAB 2: Realtime Trends
  async function loadModalTrends(force = false) {
    const grid = $('#modalTrendsGrid');
    const status = $('#modalTrendStatus');
    const refreshBtn = $('#refreshModalTrendsBtn');

    try {
      if (refreshBtn) refreshBtn.disabled = true;
      if (status) status.textContent = '실시간 검색 트렌드 조회 중...';
      const data = await api(`api/blog/trends${force ? '?refresh=true' : ''}`);
      trendsLoaded = true;

      const items = (data.items || []).slice(0, 20);
      if (grid) {
        if (!items.length) {
          grid.innerHTML = '<div style="grid-column:1/-1; color:#94a3b8; text-align:center; padding:20px;">불러온 실시간 트렌드가 없습니다.</div>';
        } else {
          grid.innerHTML = items.map((item, idx) => `
            <div class="trend-item-card ${selectedFinderKeywords.has(item.keyword) ? 'selected' : ''}" data-keyword="${escapeHtml(item.keyword)}">
              <span class="trend-rank">${idx + 1}</span>
              <div class="trend-meta">
                <span class="trend-kw">${escapeHtml(item.keyword)}</span>
                <span class="trend-topic">${escapeHtml(item.topic || '실시간 검색어')} ${item.traffic ? `· ${escapeHtml(item.traffic)}` : ''}</span>
              </div>
            </div>
          `).join('');
        }
      }
      if (status) {
        status.textContent = `트렌드 ${items.length}개 · ${data.refreshedAt ? new Date(data.refreshedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '방금'} 갱신`;
      }
      updateSelectedClasses();
    } catch (err) {
      if (status) status.textContent = '트렌드 로드 실패: ' + (err.message || '오류');
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  $('#refreshModalTrendsBtn')?.addEventListener('click', () => loadModalTrends(true));

  $('#modalTrendsGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.trend-item-card');
    if (!card) return;
    toggleKeyword(card.dataset.keyword);
  });

  // TAB 4: User-entered related keyword search
  let relatedKeywordResults = [];
  async function searchRelatedKeywords() {
    const input = $('#relatedKeywordInput');
    const button = $('#searchRelatedKeywordsBtn');
    const grid = $('#relatedKeywordsGrid');
    const heading = $('#relatedKeywordHeading');
    const status = $('#relatedKeywordStatus');
    const addAllButton = $('#addAllRelatedKeywordsBtn');
    const keyword = input?.value?.replace(/\s+/g, ' ').trim();
    if (!keyword) return toast('연관 키워드를 찾을 기준 키워드를 입력해주세요.', true);
    try {
      if (button) { button.disabled = true; button.textContent = '찾는 중...'; }
      if (heading) heading.textContent = `'${keyword}' 연관 키워드 검색 중`;
      if (status) status.textContent = '네이버 검색 제안을 불러오고 있습니다.';
      if (grid) grid.innerHTML = '<div class="finder-loading-box"><div class="finder-spinner"></div><strong>연관 키워드를 찾는 중...</strong></div>';
      const data = await api(`api/blog/related-keywords?keyword=${encodeURIComponent(keyword)}`);
      relatedKeywordResults = Array.isArray(data.keywords) ? data.keywords : [];
      if (heading) heading.textContent = `'${data.keyword || keyword}' 연관 키워드`;
      if (status) status.textContent = relatedKeywordResults.length ? `${relatedKeywordResults.length}개를 찾았습니다. 원하는 키워드를 클릭하세요.` : '표시할 연관 키워드가 없습니다. 다른 표현으로 다시 검색해보세요.';
      if (addAllButton) addAllButton.classList.toggle('hidden', relatedKeywordResults.length === 0);
      if (grid) grid.innerHTML = relatedKeywordResults.length
        ? `<div class="preset-category-card"><span class="preset-cat-title">검색 제안 ${relatedKeywordResults.length}개</span><div class="preset-chips-wrap">${relatedKeywordResults.map((kw) => `<button type="button" class="preset-chip ${selectedFinderKeywords.has(kw) ? 'selected' : ''}" data-keyword="${escapeHtml(kw)}">${escapeHtml(kw)}</button>`).join('')}</div></div>`
        : '<div style="grid-column:1/-1; color:#94a3b8; text-align:center; padding:20px;">연관 키워드 결과가 없습니다.</div>';
      updateSelectedClasses();
    } catch (err) {
      relatedKeywordResults = [];
      if (heading) heading.textContent = `'${keyword}' 검색 실패`;
      if (status) status.textContent = err.message || '연관 키워드를 불러오지 못했습니다.';
      if (grid) grid.innerHTML = '<div style="grid-column:1/-1; color:#b33b3b; text-align:center; padding:20px;">연관 키워드를 불러오지 못했습니다.</div>';
      if (addAllButton) addAllButton.classList.add('hidden');
    } finally {
      if (button) { button.disabled = false; button.textContent = '연관 키워드 찾기'; }
    }
  }

  $('#searchRelatedKeywordsBtn')?.addEventListener('click', searchRelatedKeywords);
  $('#relatedKeywordInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); searchRelatedKeywords(); }
  });
  $('#relatedKeywordsGrid')?.addEventListener('click', (event) => {
    const chip = event.target.closest('.preset-chip');
    if (chip) toggleKeyword(chip.dataset.keyword);
  });
  $('#addAllRelatedKeywordsBtn')?.addEventListener('click', () => {
    relatedKeywordResults.forEach((keyword) => selectedFinderKeywords.add(keyword));
    updateSelectedClasses();
    toast(`연관 키워드 ${relatedKeywordResults.length}개를 담았습니다.`);
  });

  // TAB 3: Category Presets
  function renderCategoryPresets() {
    const grid = $('#categoryPresetsGrid');
    if (!grid) return;
    presetsRendered = true;

    grid.innerHTML = CATEGORY_PRESETS.map((cat) => `
      <div class="preset-category-card">
        <span class="preset-cat-title">${escapeHtml(cat.title)}</span>
        <div class="preset-chips-wrap">
          ${cat.keywords.map((kw) => `
            <button type="button" class="preset-chip ${selectedFinderKeywords.has(kw) ? 'selected' : ''}" data-keyword="${escapeHtml(kw)}">
              ${escapeHtml(kw)}
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  $('#categoryPresetsGrid')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip) return;
    toggleKeyword(chip.dataset.keyword);
  });
}

// ---------------------------------------------------------------------------
// License & Subscription Client Controller
// ---------------------------------------------------------------------------
let licenseState = {
  status: 'unregistered',
  daysLeft: 0,
  expiresAt: null,
  email: null,
  planType: null,
  hwidMasked: null
};

function updateLicenseBadgeUI(state) {
  const badge = $('#topLicenseBadge');
  const icon = $('#topLicenseBadgeIcon');
  const text = $('#topLicenseBadgeText');
  const detail = $('#licenseStatusDetailText');
  const daysBadge = $('#licenseDaysBadge');
  const hwidEl = $('#licenseHwidText');

  if (hwidEl && state.hwidMasked) {
    hwidEl.textContent = state.hwidMasked;
  }

  if (state.status === 'valid') {
    if (badge) {
      badge.style.background = '#ecfdf5';
      badge.style.color = '#065f46';
      badge.style.border = '1px solid #a7f3d0';
    }
    if (icon) icon.textContent = '👑';
    if (text) text.textContent = `구독: D-${state.daysLeft}일 남음`;
    if (detail) detail.textContent = `${state.email || '정품 회원'} (${state.planType || '정기구독'})`;
    if (daysBadge) {
      daysBadge.textContent = `D-${state.daysLeft}일`;
      daysBadge.style.background = '#dcfce7';
      daysBadge.style.color = '#166534';
    }
  } else if (state.status === 'offline_grace') {
    if (badge) {
      badge.style.background = '#fef3c7';
      badge.style.color = '#92400e';
      badge.style.border = '1px solid #fde68a';
    }
    if (icon) icon.textContent = '⏳';
    if (text) text.textContent = `오프라인: D-${state.daysLeft}일`;
    if (detail) detail.textContent = '오프라인 유예 모드 동작 중 (24시간 보장)';
    if (daysBadge) {
      daysBadge.textContent = `D-${state.daysLeft}일`;
      daysBadge.style.background = '#fef3c7';
      daysBadge.style.color = '#92400e';
    }
  } else if (state.status === 'expired') {
    if (badge) {
      badge.style.background = '#fee2e2';
      badge.style.color = '#991b1b';
      badge.style.border = '1px solid #fecaca';
    }
    if (icon) icon.textContent = '⚠️';
    if (text) text.textContent = '구독 만료: 연장 필요';
    if (detail) detail.textContent = '구독 기간이 만료되었습니다. 이용권을 갱신해주세요.';
    if (daysBadge) {
      daysBadge.textContent = '만료됨';
      daysBadge.style.background = '#fee2e2';
      daysBadge.style.color = '#991b1b';
    }
  } else if (state.status === 'unauthorized_device') {
    if (badge) {
      badge.style.background = '#fee2e2';
      badge.style.color = '#991b1b';
      badge.style.border = '1px solid #fecaca';
    }
    if (icon) icon.textContent = '⛔';
    if (text) text.textContent = '등록 기기 불일치';
    if (detail) detail.textContent = '다른 PC에서 등록된 계정입니다. (1인 1PC 정책)';
    if (daysBadge) {
      daysBadge.textContent = '기기제한';
      daysBadge.style.background = '#fee2e2';
      daysBadge.style.color = '#991b1b';
    }
  } else {
    // unregistered
    if (badge) {
      badge.style.background = '#f1f5f9';
      badge.style.color = '#475569';
      badge.style.border = '1px solid #cbd5e1';
    }
    if (icon) icon.textContent = '🔑';
    if (text) text.textContent = '이용권 등록 필요';
    if (detail) detail.textContent = '등록된 이용권이 없습니다. 로그인하거나 3일 무료체험을 시작하세요.';
    if (daysBadge) {
      daysBadge.textContent = '미등록';
      daysBadge.style.background = '#e2e8f0';
      daysBadge.style.color = '#475569';
    }
  }
}

async function refreshLicenseStatus() {
  try {
    const data = await api('api/license/status');
    if (data) {
      licenseState = data;
      updateLicenseBadgeUI(data);
    }
  } catch (err) {
    console.warn('Failed to fetch license status:', err);
  }
}

function openLicenseModal() {
  $('#licenseModal')?.classList.remove('hidden');
  refreshLicenseStatus();
}

function closeLicenseModal() {
  $('#licenseModal')?.classList.add('hidden');
}

function initLicenseManagement() {
  $('#topLicenseBadge')?.addEventListener('click', openLicenseModal);
  $('#closeLicenseModal')?.addEventListener('click', closeLicenseModal);
  $('#closeLicenseModalBottom')?.addEventListener('click', closeLicenseModal);

  // Tab Switcher between Login & Register
  $('#tabLicenseLoginBtn')?.addEventListener('click', () => {
    $('#tabLicenseLoginBtn').style.background = '#fff';
    $('#tabLicenseLoginBtn').style.color = '#0f172a';
    $('#tabLicenseLoginBtn').style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
    $('#tabLicenseRegisterBtn').style.background = 'transparent';
    $('#tabLicenseRegisterBtn').style.color = '#64748b';
    $('#tabLicenseRegisterBtn').style.boxShadow = 'none';

    $('#licenseLoginForm')?.classList.remove('hidden');
    $('#licenseKeySection')?.classList.remove('hidden');
    $('#licenseRegisterForm')?.classList.add('hidden');
  });

  $('#tabLicenseRegisterBtn')?.addEventListener('click', () => {
    $('#tabLicenseRegisterBtn').style.background = '#fff';
    $('#tabLicenseRegisterBtn').style.color = '#0f172a';
    $('#tabLicenseRegisterBtn').style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
    $('#tabLicenseLoginBtn').style.background = 'transparent';
    $('#tabLicenseLoginBtn').style.color = '#64748b';
    $('#tabLicenseLoginBtn').style.boxShadow = 'none';

    $('#licenseLoginForm')?.classList.add('hidden');
    $('#licenseKeySection')?.classList.add('hidden');
    $('#licenseRegisterForm')?.classList.remove('hidden');
  });

  // Login Form Submission
  $('#licenseLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#licenseEmailInput')?.value.trim();
    const password = $('#licensePasswordInput')?.value;
    const submitBtn = $('#licenseLoginSubmitBtn');

    if (!email || !password) return;
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '인증 확인 중...';
      }
      const res = await api('api/license/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      toast(`✅ 로그인 완료! (${res.state?.message || '정품 인증 완료'})`);
      await refreshLicenseStatus();
      closeLicenseModal();
    } catch (err) {
      toast(`❌ 로그인 실패: ${err.message}`, true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '이 PC에서 정품 로그인';
      }
    }
  });

  // Register Form Submission
  $('#licenseRegisterForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#regEmailInput')?.value.trim();
    const password = $('#regPasswordInput')?.value;
    const licenseKey = $('#regLicenseKeyInput')?.value.trim() || null;
    const submitBtn = $('#licenseRegisterSubmitBtn');

    if (!email || !password) return;
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '계정 생성 중...';
      }
      const res = await api('api/license/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, licenseKey })
      });
      toast(`🎉 회원가입 완료! 3일 무료체험이 활성화되었습니다.`);
      await refreshLicenseStatus();
      closeLicenseModal();
    } catch (err) {
      toast(`❌ 회원가입 실패: ${err.message}`, true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '신규 등록하고 3일 무료체험 시작';
      }
    }
  });

  // Direct License Key Activation
  $('#licenseActivateKeyBtn')?.addEventListener('click', async () => {
    const licenseKey = $('#licenseKeyInput')?.value.trim();
    if (!licenseKey) {
      toast('라이선스 키를 입력해주세요.', true);
      return;
    }

    const btn = $('#licenseActivateKeyBtn');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '확인 중...';
      }
      const res = await api('api/license/activate', {
        method: 'POST',
        body: JSON.stringify({ licenseKey })
      });
      toast(`🎉 ${res.message || '라이선스가 성공적으로 활성화되었습니다!'}`);
      if ($('#licenseKeyInput')) $('#licenseKeyInput').value = '';
      await refreshLicenseStatus();
    } catch (err) {
      toast(`❌ 키 활성화 실패: ${err.message}`, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '키 등록';
      }
    }
  });

  // Logout
  $('#licenseLogoutBtn')?.addEventListener('click', async () => {
    if (!confirm('정말 이 PC에서 로그아웃하시겠습니까?')) return;
    try {
      await api('api/license/logout', { method: 'POST' });
      toast('로그아웃되었습니다.');
      await refreshLicenseStatus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Initial fetch and periodic polling
  refreshLicenseStatus();
  setInterval(refreshLicenseStatus, 60 * 1000);
}

/* ==========================================================================
   Keyword & Topic Discovery Controller (Elite UI Designer Standard)
   ========================================================================== */

function initKeywordWorkspaceController() {
  let currentKeywordItems = [];
  const pickedKeywords = new Set();
  let selectedKeywordItem = null;
  let activeFilter = 'all';

  const searchInput = $('#keywordSearchInput');
  const searchForm = $('#keywordSearchForm');
  const loadingBox = $('#keywordLoadingBox');
  const emptyBox = $('#keywordEmptyBox');
  const cardsList = $('#keywordCardsList');
  const resultsToolbar = $('#keywordResultsToolbar');

  // Wire existing "주제 추천" buttons across engagement workspace to switch to the new full-page Keyword tab
  $('#openTargetFinderBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab('keyword');
  });
  $('#openTargetFinderInlineBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab('keyword');
  });
  $('#openAutoTargetFinderBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab('keyword');
  });
  $('#openAutoTargetFinderInlineBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab('keyword');
  });

  // Quick Seed Chips
  $$('#keywordWorkspace .seed-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const seed = chip.dataset.seed;
      if (searchInput) searchInput.value = seed;
      runGoldenKeywordDiscovery(seed);
    });
  });

  // Search Submit
  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = (searchInput?.value || '').trim();
    if (!query) {
      toast('찾아볼 주제를 입력해 주세요.', true);
      return;
    }
    runGoldenKeywordDiscovery(query);
  });

  // Filter Pills (All / Golden+Recommended / Niche / Stale top posts)
  $$('#keywordFilterChips .filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      $$('#keywordFilterChips .filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.filter;
      renderKeywordCards();
    });
  });

  // Subsegment Tabs (Golden / MyBlog / Trends)
  $$('#keywordWorkspace .keyword-sub-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('#keywordWorkspace .keyword-sub-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const sub = tab.dataset.subtab;

      const isGolden = sub === 'golden';
      const isMyBlog = sub === 'myblog';
      const isTrends = sub === 'trends';

      resultsToolbar?.classList.toggle('hidden', !isGolden);
      cardsList?.classList.toggle('hidden', !isGolden || currentKeywordItems.length === 0);
      emptyBox?.classList.toggle('hidden', !isGolden || currentKeywordItems.length > 0);
      $('#keywordDetailCard')?.closest('.keyword-sidebar-col')?.classList.toggle('hidden', !isGolden);

      $('#keywordMyBlogPanel')?.classList.toggle('hidden', !isMyBlog);
      $('#keywordTrendsPanel')?.classList.toggle('hidden', !isTrends);

      if (isTrends) loadKeywordTrends();
    });
  });

  const GRADE_BADGES = { S: '🏆 S 황금', A: '👍 A 추천', B: '🙂 B 보통', C: '⚠️ C 경쟁 심함', X: '❔ 확인 실패' };
  const gradeBadge = (item) => GRADE_BADGES[item.grade] || item.grade;

  // Discover Golden Keywords
  async function runGoldenKeywordDiscovery(keyword) {
    const clean = String(keyword || '').trim();
    if (!clean) return;

    const subGolden = $('#subTabGolden');
    if (subGolden && !subGolden.classList.contains('active')) {
      subGolden.click();
    }

    loadingBox?.classList.remove('hidden');
    emptyBox?.classList.add('hidden');
    cardsList?.classList.add('hidden');

    const submitBtn = $('#keywordSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="finder-spinner-sm"></span> 찾는 중...';
    }

    try {
      const data = await api(`api/blog/golden-keywords?keyword=${encodeURIComponent(clean)}&limit=24`);
      currentKeywordItems = Array.isArray(data.items) ? data.items : [];
      pickedKeywords.clear();

      if ($('#keywordCurrentQueryBadge')) $('#keywordCurrentQueryBadge').textContent = `#${data.query || clean}`;
      if ($('#keywordResultsCount')) {
        const golden = data.goldenCount || 0;
        const recommended = data.recommendedCount || 0;
        $('#keywordResultsCount').textContent = golden + recommended > 0
          ? `실제 검색어 ${currentKeywordItems.length}개 진단 · 🏆 황금 ${golden}개 · 👍 추천 ${recommended}개`
          : `실제 검색어 ${currentKeywordItems.length}개 진단 · 황금·추천 키워드 없음 (더 구체적인 주제로 찾아 보세요)`;
      }

      renderKeywordCards();
      if (currentKeywordItems.length > 0) selectKeywordDetail(currentKeywordItems[0]);
      else toast('이 주제로는 자동완성 검색어를 찾지 못했습니다. 다른 주제로 찾아 보세요.', true);
    } catch (err) {
      toast(`키워드 분석 실패: ${err.message || '네트워크 오류'}`, true);
      emptyBox?.classList.remove('hidden');
    } finally {
      loadingBox?.classList.add('hidden');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-icon">⚡</span> <strong>황금 키워드 찾기</strong>';
      }
    }
  }

  function filteredKeywordItems() {
    if (activeFilter === 'good') return currentKeywordItems.filter((it) => it.grade === 'S' || it.grade === 'A');
    if (activeFilter === 'niche') return currentKeywordItems.filter((it) => it.checked && it.isNiche);
    if (activeFilter === 'vacant') return currentKeywordItems.filter((it) => it.checked && it.isVacant);
    return currentKeywordItems;
  }

  // Render Keyword Cards with active filter
  function renderKeywordCards() {
    if (!cardsList) return;
    const items = filteredKeywordItems();

    if (items.length === 0) {
      cardsList.innerHTML = `
        <div class="kw-filter-empty">
          <strong>이 조건에 맞는 키워드가 없습니다.</strong>
          <p>'전체'를 누르거나 더 구체적인 주제(예: '캠핑' 대신 '캠핑 의자')로 찾아 보세요.</p>
        </div>
      `;
      cardsList.classList.remove('hidden');
      return;
    }

    cardsList.innerHTML = items.map((it) => {
      const isSelected = selectedKeywordItem && selectedKeywordItem.keyword === it.keyword;
      const gradeClass = `grade-${String(it.grade || 'b').toLowerCase()}`;
      const scoreWidth = Math.min(Math.max(Number(it.score) || 0, 4), 100);
      const chips = it.checked
        ? [
          `<span class="kw-tag ${it.demand?.score >= 45 ? 'good' : ''}">🔎 수요 ${escapeHtml(it.demand?.level || '-')}</span>`,
          `<span class="kw-tag ${it.titleMatchCount <= 3 ? 'good' : 'bad'}">🎯 노린 글 ${it.titleMatchCount}/10</span>`,
          `<span class="kw-tag ${it.avgAgeDays >= 90 ? 'good' : it.avgAgeDays < 30 ? 'bad' : ''}">🕰️ ${escapeHtml(it.recencyText)}</span>`,
          `<span class="kw-tag ${it.totalCapped ? '' : 'good'}">📚 ${escapeHtml(it.docCountText)}</span>`
        ].join('')
        : '<span class="kw-tag bad">상위 글을 확인하지 못했습니다</span>';

      return `
        <div class="kw-card ${isSelected ? 'selected' : ''} ${pickedKeywords.has(it.keyword) ? 'picked' : ''} ${gradeClass}" data-kw="${encodeURIComponent(it.keyword)}" tabindex="0">
          <div class="kw-card-head">
            <div class="kw-card-title-box">
              <label class="kw-pick" title="소통에 넣을 키워드로 체크">
                <input type="checkbox" class="kw-pick-input" ${pickedKeywords.has(it.keyword) ? 'checked' : ''} aria-label="${escapeHtml(it.keyword)} 체크">
              </label>
              <span class="kw-grade-badge ${gradeClass}">${gradeBadge(it)}</span>
              <strong class="kw-card-title">${escapeHtml(it.keyword)}</strong>
            </div>
            <div class="kw-score-wrap" title="100점 만점에 ${it.score}점">
              <span class="kw-score-text">${it.score}점</span>
              <div class="kw-score-track"><div class="kw-score-bar" style="width: ${scoreWidth}%;"></div></div>
            </div>
          </div>
          <div class="kw-tags-row">${chips}</div>
          <div class="kw-card-foot">
            <p class="kw-opportunity-text">${escapeHtml(it.summary || '')}</p>
          </div>
        </div>
      `;
    }).join('');

    cardsList.classList.remove('hidden');
    updatePickBar();
  }

  cardsList?.addEventListener('click', (e) => {
    const card = e.target.closest('.kw-card');
    if (!card) return;
    const item = currentKeywordItems.find((it) => it.keyword === decodeURIComponent(card.dataset.kw));
    if (!item) return;
    if (e.target.closest('.kw-pick')) {
      if (e.target.classList.contains('kw-pick-input')) togglePicked(item.keyword, e.target.checked);
      return;
    }
    selectKeywordDetail(item);
  });
  cardsList?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('kw-card')) return;
    const item = currentKeywordItems.find((it) => it.keyword === decodeURIComponent(e.target.dataset.kw));
    if (item) selectKeywordDetail(item);
  });

  // Select item & display in Right Sidebar
  function selectKeywordDetail(item) {
    selectedKeywordItem = item;

    $$('.kw-card').forEach((card) => {
      card.classList.toggle('selected', decodeURIComponent(card.dataset.kw) === item.keyword);
    });

    if ($('#detailKeywordTitle')) $('#detailKeywordTitle').textContent = item.keyword;

    const pill = $('#detailScorePill');
    if (pill) {
      pill.textContent = item.checked ? `${gradeBadge(item)} · ${item.score}점` : gradeBadge(item);
      pill.className = `pill ${item.grade === 'S' || item.grade === 'A' ? 'pill-green' : item.grade === 'B' ? 'pill-yellow' : 'pill-red'}`;
    }

    if ($('#detailDemand')) $('#detailDemand').textContent = item.demand?.level || '-';
    if ($('#detailMatchRate')) $('#detailMatchRate').textContent = item.checked ? `10개 중 ${item.titleMatchCount}개` : '-';
    if ($('#detailAvgAge')) $('#detailAvgAge').textContent = item.recencyText || '-';
    if ($('#detailDocCount')) $('#detailDocCount').textContent = item.docCountText || '-';

    const advice = $('#detailStrategyAdvice');
    if (advice) {
      const reasons = (item.reasons || []).map((r) => {
        const mark = r.good === true ? '✅' : r.good === false ? '⚠️' : '•';
        return `<li class="${r.good === true ? 'good' : r.good === false ? 'bad' : ''}"><span>${mark}</span>${escapeHtml(r.text)}</li>`;
      }).join('');
      advice.innerHTML = `
        ${item.summary ? `<p class="kw-reason-summary">${escapeHtml(item.summary)}</p>` : ''}
        <ul class="kw-reason-list">${reasons}</ul>
        ${item.advice ? `<p class="kw-reason-tip">✍️ <strong>글쓰기 팁</strong> ${escapeHtml(item.advice)}</p>` : ''}
      `;
    }

    const searchLink = $('#detailNaverSearchLink');
    if (searchLink) searchLink.href = `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(item.keyword)}`;

    const topPostsContainer = $('#detailTopPostsList');
    if (topPostsContainer) {
      const posts = Array.isArray(item.topPosts) ? item.topPosts : [];
      topPostsContainer.innerHTML = posts.length === 0
        ? '<p class="empty-hint">상위 글 정보가 없습니다.</p>'
        : posts.map((p, idx) => `
          <div class="top-post-item">
            <span class="post-rank-num">${idx + 1}</span>
            <div class="post-meta-box">
              <a href="${escapeHtml(p.url || searchLink?.href || '#')}" target="_blank" rel="noopener noreferrer" class="post-title-link" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</a>
              <div class="post-sub-meta">
                <span>${escapeHtml(p.blogName || '네이버 블로그')}</span>
                <span>•</span>
                <span>${escapeHtml(p.ageText || '')}</span>
                <span class="post-match-badge ${p.isExactMatch ? 'matched' : 'unmatched'}">${p.isExactMatch ? '키워드 노린 글' : '키워드 안 노림'}</span>
              </div>
            </div>
          </div>
        `).join('');
    }

    updateDetailPickButton();
  }

  // ☑️ Pick keywords, then hand them to the engagement form in one go. Nothing starts here: the user
  // checks the counts on the 소통 tab and presses start there. The engagement job takes up to 10 topics.
  const MAX_PICKED = 10;

  function togglePicked(keyword, on) {
    if (on && !pickedKeywords.has(keyword) && pickedKeywords.size >= MAX_PICKED) {
      toast(`소통 주제는 한 번에 최대 ${MAX_PICKED}개까지 넣을 수 있습니다.`, true);
    } else if (on) {
      pickedKeywords.add(keyword);
    } else {
      pickedKeywords.delete(keyword);
    }
    syncPickedState();
  }

  function syncPickedState() {
    $$('#keywordCardsList .kw-card').forEach((card) => {
      const picked = pickedKeywords.has(decodeURIComponent(card.dataset.kw));
      card.classList.toggle('picked', picked);
      const box = card.querySelector('.kw-pick-input');
      if (box) box.checked = picked;
    });
    updatePickBar();
    updateDetailPickButton();
  }

  function updatePickBar() {
    const bar = $('#kwPickBar');
    if (!bar) return;
    bar.classList.toggle('hidden', currentKeywordItems.length === 0);
    const count = pickedKeywords.size;
    const countText = $('#kwPickCount');
    if (countText) {
      countText.innerHTML = count
        ? `<strong>${count}개 체크</strong><span>${escapeHtml([...pickedKeywords].join(', '))}</span>`
        : '<strong>소통할 키워드를 체크하세요</strong><span>최대 10개까지 한 번에 소통 주제로 넣을 수 있습니다.</span>';
    }
    const applyBtn = $('#kwPickApply');
    if (applyBtn) applyBtn.disabled = count === 0;
    const clearBtn = $('#kwPickClear');
    if (clearBtn) clearBtn.classList.toggle('hidden', count === 0);
  }

  function updateDetailPickButton() {
    const btn = $('#detailPickBtn');
    if (!btn) return;
    if (!selectedKeywordItem) {
      btn.disabled = true;
      return;
    }
    const picked = pickedKeywords.has(selectedKeywordItem.keyword);
    btn.disabled = false;
    btn.classList.toggle('picked', picked);
    btn.innerHTML = picked ? '<strong>✅ 체크됨 · 해제하기</strong>' : '<strong>☑️ 이 키워드 체크</strong>';
  }

  $('#detailPickBtn')?.addEventListener('click', () => {
    if (selectedKeywordItem) togglePicked(selectedKeywordItem.keyword, !pickedKeywords.has(selectedKeywordItem.keyword));
  });

  $('#kwPickGood')?.addEventListener('click', () => {
    const good = currentKeywordItems.filter((it) => it.grade === 'S' || it.grade === 'A').map((it) => it.keyword);
    if (!good.length) {
      toast('황금·추천 등급 키워드가 없습니다. 원하는 키워드를 직접 체크하세요.', true);
      return;
    }
    good.forEach((keyword) => { if (pickedKeywords.size < MAX_PICKED) pickedKeywords.add(keyword); });
    syncPickedState();
  });

  $('#kwPickClear')?.addEventListener('click', () => {
    pickedKeywords.clear();
    syncPickedState();
  });

  $('#kwPickApply')?.addEventListener('click', async () => {
    const keywords = [...pickedKeywords];
    if (!keywords.length) return;
    const input = $('#engKeyword');
    if (input) {
      input.value = keywords.join(', ');
      input.dispatchEvent(new Event('input'));
    }
    const status = await api('api/engagement/status').catch(() => null);
    const busy = status && (status.state === 'running' || status.state === 'paused');
    setActiveTab('engagement');
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(busy
      ? `키워드 ${keywords.length}개를 소통 주제에 넣었습니다. 지금 진행 중인 소통이 끝나면 [소통 시작]을 누르세요.`
      : `키워드 ${keywords.length}개를 소통 주제에 넣었습니다. 글 수를 확인하고 [소통 시작]을 누르세요.`);
  });

  // Subtab 2: MyBlog AI Analysis
  $('#kwStartMyBlogAnalysisBtn')?.addEventListener('click', async () => {
    const banner = $('#kwStartMyBlogAnalysisBtn');
    const loading = $('#kwMyBlogLoading');
    const results = $('#kwMyBlogResults');
    const grid = $('#kwMyBlogKeywordsGrid');

    if (banner) banner.disabled = true;
    loading?.classList.remove('hidden');
    results?.classList.add('hidden');

    try {
      const data = await api('api/blog/my-recommendations');
      loading?.classList.add('hidden');
      results?.classList.remove('hidden');

      if ($('#kwMyBlogSummaryText')) $('#kwMyBlogSummaryText').textContent = data.summary || '내 블로그 분석 완료';
      if ($('#kwMyBlogAudienceText')) $('#kwMyBlogAudienceText').textContent = data.audience || '관련 이웃층';

      const targets = Array.isArray(data.targets) ? data.targets : [];
      if (grid) {
        if (targets.length === 0) {
          grid.innerHTML = '<p class="empty-hint" style="grid-column: 1 / -1;">발행된 글이 적어 추천 키워드를 추출하지 못했습니다.</p>';
        } else {
          grid.innerHTML = targets.map((t) => `
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <div>
                <strong style="color: #0f172a; font-size: 13.5px; display: block;">${t.keyword}</strong>
                <small style="color: #64748b; font-size: 11.5px;">${t.reason || '내 글 주제 분석'}</small>
              </div>
              <button type="button" class="button primary small kw-apply-myblog-btn" data-kw="${t.keyword}" style="padding: 5px 10px; font-size: 11.5px; flex-shrink: 0;">
                황금 분석 ⚡
              </button>
            </div>
          `).join('');

          $$('.kw-apply-myblog-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              const kw = btn.dataset.kw;
              if (searchInput) searchInput.value = kw;
              runGoldenKeywordDiscovery(kw);
            });
          });
        }
      }
    } catch (err) {
      loading?.classList.add('hidden');
      toast(`내 블로그 분석 실패: ${err.message}`, true);
    } finally {
      if (banner) banner.disabled = false;
    }
  });

  // Subtab 3: Real-time Trends
  let trendsLoaded = false;
  async function loadKeywordTrends(forceRefresh = false) {
    if (trendsLoaded && !forceRefresh) return;
    const grid = $('#kwTrendsGrid');
    if (!grid) return;

    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: #64748b;"><div class="finder-spinner" style="margin: 0 auto 10px;"></div>실시간 급상승 트렌드 불러오는 중...</div>';

    try {
      const endpoint = forceRefresh ? 'api/blog/trends?refresh=true' : 'api/blog/trends';
      const data = await api(endpoint);
      const trends = Array.isArray(data.items) ? data.items : (Array.isArray(data.trends) ? data.trends : []);
      trendsLoaded = true;

      if (trends.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: #64748b;">현재 불러올 수 있는 실시간 트렌드가 없습니다. [↻ 트렌드 새로고침]을 눌러보세요.</div>';
        return;
      }

      grid.innerHTML = trends.map((t, idx) => {
        const trafficBadge = t.traffic ? `<span style="font-size: 10px; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">조회 ${t.traffic}</span>` : '';
        return `
          <div style="background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px; cursor: pointer; transition: all 0.15s ease;" class="kw-trend-item-card" data-kw="${t.keyword || t.topic}">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: ${idx < 3 ? '#ecfdf5' : '#f1f5f9'}; color: ${idx < 3 ? '#047857' : '#64748b'}; font-size: 11px; font-weight: 800; flex-shrink: 0;">${idx + 1}</span>
              <div style="min-width: 0; flex: 1;">
                <strong style="color: #0f172a; font-size: 13.5px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.keyword || t.topic}</strong>
                ${trafficBadge}
              </div>
            </div>
            <span style="font-size: 11px; color: #03c75a; font-weight: 700; flex-shrink: 0;">발굴 ⚡</span>
          </div>
        `;
      }).join('');

      $$('.kw-trend-item-card').forEach((card) => {
        card.addEventListener('click', () => {
          const kw = card.dataset.kw;
          if (searchInput) searchInput.value = kw;
          runGoldenKeywordDiscovery(kw);
        });
      });
    } catch {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: #ef4444;">트렌드를 불러오지 못했습니다. [↻ 트렌드 새로고침] 버튼을 눌러주세요.</div>';
    }
  }

  $('#kwRefreshTrendsBtn')?.addEventListener('click', () => {
    loadKeywordTrends(true);
  });
}

// Naver QR login: scan with the Naver app. Needed where the login page cannot be shown (the web build's
// headless browser), since a security check or 2-step verification then blocks the ID/password login.
function initQrLogin() {
  // The program never types the ID/password (Naver locks accounts for that): QR first, and in the
  // desktop app a login window the user types into. The 112 web build has QR only.
  api('api/health').then((health) => {
    if (health?.loginMode !== 'qr') return;
    document.documentElement.classList.add('qr-only-login');
    document.querySelectorAll('[data-qr-login] .qr-login-row span').forEach((el) => {
      el.textContent = health.loginWindow
        ? '🔒 비밀번호 없이 휴대폰 네이버 앱으로 로그인합니다. 프로그램이 비밀번호를 입력하지 않아 계정이 안전합니다.'
        : '계정 보호를 위해 이 서버에서는 휴대폰 네이버 앱 QR로만 로그인합니다.';
    });
    document.querySelectorAll('[data-qr-login] .qr-login-open').forEach((el) => {
      el.textContent = 'QR로 로그인하기';
      el.classList.replace('ghost', 'primary');
    });
    if (health.loginWindow) document.querySelectorAll('[data-qr-login]').forEach(addLoginWindowFallback);
  }).catch(() => {});
  document.querySelectorAll('[data-qr-login]').forEach((root) => {
    const box = root.querySelector('.qr-login-box');
    const image = root.querySelector('.qr-login-image');
    const status = root.querySelector('.qr-login-status');
    let timer = null;
    const stop = () => { clearInterval(timer); timer = null; };
    // The number Naver asks for in the app (shown on the server's login page after the scan).
    let check = root.querySelector('.qr-login-check');
    if (!check) {
      check = document.createElement('div');
      check.className = 'qr-login-check hidden';
      check.innerHTML = '<div class="qr-login-code"></div><div class="qr-login-check-text"></div><img class="qr-login-screen" alt="네이버 로그인 화면">';
      root.querySelector('.qr-login-text')?.appendChild(check);
    }
    const showQrCheck = (result) => {
      if (!result || result.connected || (!result.code && !result.screen)) return;
      check.classList.remove('hidden');
      check.querySelector('.qr-login-code').textContent = result.code ? `휴대폰에서 고를 숫자: ${result.code}` : '';
      check.querySelector('.qr-login-check-text').textContent = result.code
        ? '네이버 앱에서 QR을 스캔한 뒤, 앱에 나오는 숫자 중 이 숫자를 선택하세요.'
        : '숫자를 찾지 못했습니다. 아래 네이버 로그인 화면을 보고 진행하세요.';
      const screen = check.querySelector('.qr-login-screen');
      if (result.code) screen.removeAttribute('src');
      else if (result.screen) screen.src = result.screen;
    };
    const setStatus = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
    const start = async () => {
      stop();
      box.classList.remove('hidden');
      image.removeAttribute('src');
      check.classList.add('hidden');
      setStatus('QR 코드를 불러오는 중…');
      try {
        const data = await api('api/naver/qr');
        if (data.connected) {
          setConnected(true, data.accountLabel);
          box.classList.add('hidden');
          toast('이미 네이버에 로그인되어 있습니다.');
          return;
        }
        image.src = String(data.qrImage || '').replace(/^(data:image\/\w+;base64,)\s+/, '$1');
        setStatus('네이버 앱에서 로그인을 기다리는 중…');
        const started = Date.now();
        timer = setInterval(async () => {
          const result = await api('api/naver/qr/status').catch(() => null);
          showQrCheck(result);
          if (result?.connected) {
            stop();
            box.classList.add('hidden');
            setConnected(true, result.accountLabel);
            toast('네이버 계정이 연결되었습니다.');
          } else if (Date.now() - started > 180000) {
            stop();
            setStatus('QR 코드가 만료되었습니다. [새 QR 받기]를 눌러 주세요.', true);
          }
        }, 2000);
      } catch (error) {
        setStatus(`QR 코드를 받지 못했습니다: ${error.message}`, true);
      }
    };
    root.querySelector('.qr-login-open')?.addEventListener('click', start);
    root.querySelector('.qr-login-refresh')?.addEventListener('click', start);
    root.querySelector('.qr-login-close')?.addEventListener('click', () => { stop(); box.classList.add('hidden'); });
  });
}

// No Naver app at hand: open Naver's own login page in a window and let the user type there.
function addLoginWindowFallback(root) {
  if (root.querySelector('.qr-login-window')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'qr-login-window';
  button.textContent = 'QR이 어렵다면 → 네이버 로그인 창을 열고 직접 입력하기';
  root.querySelector('.qr-login-row')?.after(button);
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = '⏳ 열린 네이버 로그인 창에서 아이디·비밀번호를 직접 입력해 주세요 (3분 안에)';
    try {
      const result = await api('api/naver/open-login-window', { method: 'POST' });
      if (!result.success) throw new Error(result.message || '로그인이 완료되지 않았습니다.');
      setConnected(true, '네이버 로그인됨');
      toast('네이버 계정이 연결되었습니다.');
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'QR이 어렵다면 → 네이버 로그인 창을 열고 직접 입력하기';
    }
  });
}

// AI engine: the local model, or the user's own Claude / Gemini subscription.
let aiEngineInfo = null;
let aiEngineLoginTimer = null;

const AI_ENGINE_STATES = {
  local: (info) => {
    const status = info.local?.status;
    if (status === 'running') return ['실행 중', 'ok'];
    if (status === 'starting') return ['준비 중', 'warn'];
    return ['꺼짐', 'off'];
  },
  cloud: (entry) => {
    if (!entry.installed) return ['미설치', 'off'];
    if (entry.connected) return ['연결됨', 'ok'];
    if (/만료/.test(entry.error || '')) return ['로그인 만료', 'warn'];
    return ['연결 필요', 'warn'];
  }
};

function renderAiEngine(info) {
  aiEngineInfo = info;
  const engine = info.settings?.engine || 'local';
  cloudEngineLabel = engine !== 'local' && info[engine]?.connected ? info.activeLabel : '';
  document.querySelectorAll('.ai-engine-card').forEach((card) => {
    const id = card.dataset.engine;
    const entry = id === 'local' ? null : info[id];
    const [label, tone] = id === 'local' ? AI_ENGINE_STATES.local(info) : AI_ENGINE_STATES.cloud(entry);
    const selected = id === engine;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-checked', String(selected));
    card.classList.toggle('disabled', Boolean(entry && !entry.connected));
    const state = card.querySelector('.ai-engine-state');
    state.textContent = label;
    state.className = `ai-engine-state ${tone}`;
    state.title = entry?.account ? `${entry.account}${entry.plan ? ` · ${entry.plan}` : ''}` : '';
    if (!entry) {
      // On the web build the "local" engine is a llama-server on another machine (NEIGHBORMATE_LLM_URL).
      if (info.local?.remote) {
        card.querySelector('.ai-engine-title span').textContent = `원격 서버 · ${info.local.modelId || 'LLM'}`;
        card.querySelector('.ai-engine-desc').textContent = '개발 서버의 LLM을 사용합니다. 이 PC에는 부담이 없습니다.';
      }
      return;
    }
    const desc = card.querySelector('.ai-engine-desc');
    if (!desc.dataset.base) desc.dataset.base = desc.textContent;
    desc.textContent = entry.connected && entry.account ? `${entry.account} 계정으로 연결되어 있습니다.` : (entry.installed ? desc.dataset.base : entry.error);
    const select = card.querySelector('.ai-engine-model');
    const current = id === 'claude' ? info.settings.claudeModel : info.settings.geminiModel;
    const models = entry.models || [];
    select.innerHTML = models.length
      ? models.map((m) => `<option value="${escapeHtml(m.id)}"${m.id === current ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')
      : '<option>연결 후 선택</option>';
    select.disabled = !entry.connected || !models.length;
    const button = card.querySelector('.ai-engine-connect');
    button.disabled = !entry.installed;
    button.textContent = entry.connected ? '다시 연결' : '계정 연결';
  });
  const badge = $('#aiEngineActiveBadge');
  if (badge) badge.textContent = info.activeLabel || '로컬 AI';
  if (cloudEngineLabel && $('#globalEngineStatusText')) {
    $('#globalEngineStatusText').textContent = cloudEngineLabel;
    $('#globalEngineStatusText').style.color = '#234e52';
  }
}

async function loadAiEngine(refresh = false) {
  const info = await api(`api/ai-engine${refresh ? '?refresh=1' : ''}`).catch(() => null);
  if (info) {
    renderAiEngine(info);
    refreshRuntimeStatus();
  }
  return info;
}

async function selectAiEngine(engine) {
  if (!aiEngineInfo || aiEngineInfo.settings?.engine === engine) return;
  if (engine !== 'local' && !aiEngineInfo[engine]?.connected) {
    toast('먼저 [계정 연결]로 로그인해 주세요.', true);
    return;
  }
  try {
    await api('api/ai-engine', { method: 'PUT', body: JSON.stringify({ engine }) });
    const info = await loadAiEngine();
    toast(engine === 'local' ? '로컬 AI로 전환했습니다. 모델을 불러오는 동안 잠시 기다려 주세요.' : `${info?.activeLabel || engine}(으)로 전환했습니다. 로컬 모델은 메모리에서 내렸습니다.`);
    if (engine === 'local') startRuntimeStatusPolling();
  } catch (error) {
    toast(error.message, true);
  }
}

function initAiEngineController() {
  document.querySelectorAll('.ai-engine-card').forEach((card) => {
    card.addEventListener('click', () => selectAiEngine(card.dataset.engine));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAiEngine(card.dataset.engine); }
    });
  });
  document.querySelectorAll('.ai-engine-model').forEach((select) => {
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', async () => {
      const key = select.dataset.modelFor === 'claude' ? 'claudeModel' : 'geminiModel';
      try {
        await api('api/ai-engine', { method: 'PUT', body: JSON.stringify({ [key]: select.value }) });
        await loadAiEngine();
        toast('모델을 바꿨습니다.');
      } catch (error) {
        toast(error.message, true);
      }
    });
  });
  document.querySelectorAll('.ai-engine-connect').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const provider = button.dataset.connect;
      try {
        await api(`api/ai-engine/${provider}/login`, { method: 'POST' });
        toast('새로 열린 창에서 로그인을 마치면 자동으로 연결됩니다.');
        clearInterval(aiEngineLoginTimer);
        const started = Date.now();
        aiEngineLoginTimer = setInterval(async () => {
          const info = await loadAiEngine(true);
          if (info?.[provider]?.connected || Date.now() - started > 300000) {
            clearInterval(aiEngineLoginTimer);
            if (info?.[provider]?.connected) toast(`${provider === 'claude' ? 'Claude' : 'Gemini'} 계정이 연결되었습니다.`);
          }
        }, 5000);
      } catch (error) {
        toast(error.message, true);
      }
    });
  });
  loadAiEngine();
}

// Initial health check and session restoration
api('api/health').then(async (data) => {
  initSettingsController();
  initAiEngineController();
  initQrLogin();
  initAiHardwareAndModels();
  initModelEvents();
  initEngagementAutomation();
  initFeedEngagement();
  initNeighborCleaner();
  initCommentManagement();
  initTargetFinderModal();
  initKeywordWorkspaceController();
  initLicenseManagement();

  if (data.connected) {
    setConnected(true);
    initAutoNeighborEvents();
    const status = await api('api/neighbors/auto/status').catch(() => null);
    if (status) updateAutoDashboard(status);
    return;
  }
  const restored = await api('api/naver/restore', { method: 'POST' }).catch(() => ({ connected: false }));
  setConnected(restored.connected, restored.accountLabel);
  if (restored.connected) {
    initAutoNeighborEvents();
    toast('저장된 네이버 로그인 상태를 불러왔습니다.');
    const status = await api('api/neighbors/auto/status').catch(() => null);
    if (status) updateAutoDashboard(status);
  }
}).catch(() => {
  setConnected(false);
  initSettingsController();
  initAiEngineController();
  initQrLogin();
  initAiHardwareAndModels();
  initModelEvents();
  initEngagementAutomation();
  initFeedEngagement();
  initNeighborCleaner();
  initCommentManagement();
  initTargetFinderModal();
  initKeywordWorkspaceController();
  initLicenseManagement();
});



// ---------------------------------------------------------------------------
// Growth options: target sources, comment style, return visits
// ---------------------------------------------------------------------------
const BLOG_ID_TOKEN = /^[a-zA-Z0-9_-]{2,50}$/;

function countBlogIds(text) {
  const ids = new Set();
  for (const raw of String(text || '').split(/[\s,，;]+/)) {
    let token = raw.trim().replace(/^@/, '');
    const param = token.match(/[?&]blogId=([^&#]+)/i)?.[1];
    if (param) token = param;
    else if (/naver\.com/i.test(token)) token = token.replace(/^https?:\/\//i, '').split('/')[1] || '';
    if (BLOG_ID_TOKEN.test(token)) ids.add(token.toLowerCase());
  }
  return ids.size;
}

function setOptionChipValue(rowId, value) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const button = row.querySelector(`.chip-btn[data-value="${value}"]`);
  if (!button) return;
  row.querySelectorAll('.chip-btn').forEach((chip) => chip.classList.toggle('active', chip === button));
  const input = document.getElementById(row.dataset.targetInput);
  if (input && input.value !== value) {
    input.value = value;
    input.dispatchEvent(new Event('change'));
  }
}

function readCommentStyle(prefix) {
  return {
    commentMode: $(`#${prefix}CommentMode`)?.value || 'ai',
    commentPhrases: $(`#${prefix}CommentPhrases`)?.value || '',
    secretComment: $(`#${prefix}SecretComment`)?.checked === true
  };
}

function rememberField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const key = `nm.${id}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      if (el.type === 'checkbox') el.checked = saved === '1';
      else el.value = saved;
    }
  } catch {}
  const save = () => {
    try { localStorage.setItem(key, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value); } catch {}
  };
  el.addEventListener(el.type === 'checkbox' || el.type === 'hidden' ? 'change' : 'input', save);
}

function initGrowthOptions() {
  document.querySelectorAll('.option-chip-row[data-target-input]').forEach((row) => {
    row.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip-btn[data-value]');
      if (chip) setOptionChipValue(row.id, chip.dataset.value);
    });
  });

  const syncTargetSource = () => {
    const source = $('#engTargetSource')?.value || 'keyword';
    document.querySelectorAll('[data-source-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.sourcePanel !== source);
    });
    const keywordInput = $('#engKeyword');
    if (keywordInput) keywordInput.required = source === 'keyword';
  };
  $('#engTargetSource')?.addEventListener('change', syncTargetSource);

  ['eng', 'feed'].forEach((prefix) => {
    const syncPhrases = () => {
      const mode = $(`#${prefix}CommentMode`)?.value || 'ai';
      $(`#${prefix}CommentPhrasesGroup`)?.classList.toggle('hidden', mode === 'ai');
    };
    $(`#${prefix}CommentMode`)?.addEventListener('change', syncPhrases);
    [`${prefix}CommentPhrases`, `${prefix}SecretComment`, `${prefix}CommentMode`].forEach(rememberField);
    const savedMode = $(`#${prefix}CommentMode`)?.value;
    if (savedMode) setOptionChipValue(`${prefix}CommentModeChips`, savedMode);
    syncPhrases();
  });

  const updateIdCount = () => {
    const label = $('#engTargetIdsCount');
    if (label) label.textContent = `${countBlogIds($('#engTargetIds')?.value).toLocaleString()}곳`;
  };
  $('#engTargetIds')?.addEventListener('input', updateIdCount);
  $('#engTargetIdsFileBtn')?.addEventListener('click', () => $('#engTargetIdsFile')?.click());
  $('#engTargetIdsFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const area = $('#engTargetIds');
      area.value = [area.value.trim(), text.trim()].filter(Boolean).join('\n');
      area.dispatchEvent(new Event('input'));
      toast(`📂 ${file.name}에서 블로그 ${countBlogIds(text).toLocaleString()}곳을 불러왔습니다.`);
    } catch (error) {
      toast(`파일을 읽지 못했습니다: ${error.message}`, true);
    } finally {
      event.target.value = '';
    }
  });

  ['engTargetSource', 'engSeedBlogs', 'engTargetIds', 'engAiNeighborMessage', 'engNeighborActiveOnly', 'commentReturnVisit', 'commentReturnVisitSecret'].forEach(rememberField);
  const savedSource = $('#engTargetSource')?.value;
  if (savedSource) setOptionChipValue('engTargetSourceChips', savedSource);
  syncTargetSource();
  updateIdCount();

  const syncReturnVisit = () => {
    $('#commentReturnVisitSecretCard')?.classList.toggle('hidden', !$('#commentReturnVisit')?.checked);
  };
  $('#commentReturnVisit')?.addEventListener('change', syncReturnVisit);
  syncReturnVisit();
}

initGrowthOptions();

// ---------------------------------------------------------------------------
// Autopilot (자율 주행) tab
// ---------------------------------------------------------------------------
const AP_STEP_INPUTS = {
  acceptNeighbors: '#apStepAcceptNeighbors',
  replies: '#apStepReplies',
  returnVisit: '#apStepReturnVisit',
  engage: '#apStepEngage',
  feed: '#apStepFeed'
};
const AP_PHASE_TEXT = {
  off: '꺼짐',
  running: '진행 중',
  waiting: '다음 회차 대기',
  sleeping: '운영 시간 외 휴식',
  blocked: '잠시 대기'
};
const AP_OFF_MESSAGE = '자율 주행이 꺼져 있습니다.';
let apStatus = null;
let apPollTimer = null;
let apSaveTimer = null;
let apApplyingSettings = false;

function readAutopilotSettings() {
  return {
    keywordMode: $('#apKeywordMode')?.value === 'fixed' ? 'fixed' : 'golden',
    seedTopics: $('#apSeedTopics')?.value || '',
    fixedKeywords: $('#apFixedKeywords')?.value || '',
    repliesPerCycle: Number($('#apRepliesPerCycle')?.value) || 10,
    replyNeighbor: $('#apReplyNeighbor')?.checked !== false,
    feedLike: $('#apFeedLike')?.checked !== false,
    feedComment: $('#apFeedComment')?.checked !== false,
    returnVisitLike: $('#apReturnVisitLike')?.checked !== false,
    returnVisitComment: $('#apReturnVisitComment')?.checked !== false,
    postsPerCycle: Number($('#apPostsPerCycle')?.value) || 20,
    feedPerCycle: Number($('#apFeedPerCycle')?.value) || 10,
    intervalMinutes: Number($('#apIntervalMinutes')?.value) || 90,
    activeStartHour: Number($('#apActiveStart')?.value),
    activeEndHour: Number($('#apActiveEnd')?.value),
    doLike: $('#apDoLike')?.checked !== false,
    doComment: $('#apDoComment')?.checked !== false,
    doNeighbor: $('#apDoNeighbor')?.checked !== false,
    allowGradeB: $('#apAllowGradeB')?.checked === true,
    returnVisitPerCycle: Number($('#apReturnVisitPerCycle')?.value) || 10,
    acceptMode: $('#apAcceptMode')?.value || 'screen',
    cancelSentDays: Number($('#apCancelSentDays')?.value ?? 14),
    pruneDormant: $('#apPruneDormant')?.checked === true,
    pruneDormantDays: Number($('#apPruneDormantDays')?.value) || 60,
    steps: Object.fromEntries(Object.entries(AP_STEP_INPUTS).map(([id, selector]) => [id, $(selector)?.checked !== false]))
  };
}

function applyAutopilotSettings(settings) {
  if (!settings) return;
  apApplyingSettings = true;
  const setChecked = (selector, value) => { const el = $(selector); if (el) el.checked = Boolean(value); };
  if ($('#apSeedTopics') && document.activeElement !== $('#apSeedTopics')) $('#apSeedTopics').value = settings.seedTopics || '';
  if ($('#apFixedKeywords') && document.activeElement !== $('#apFixedKeywords')) $('#apFixedKeywords').value = settings.fixedKeywords || '';
  setOptionChipValue('apKeywordModeChips', settings.keywordMode || 'golden');
  setOptionChipValue('apRepliesChips', String(settings.repliesPerCycle ?? 10));
  setChecked('#apReplyNeighbor', settings.replyNeighbor !== false);
  setChecked('#apFeedLike', settings.feedLike !== false);
  setChecked('#apFeedComment', settings.feedComment !== false);
  setChecked('#apReturnVisitLike', settings.returnVisitLike !== false);
  setChecked('#apReturnVisitComment', settings.returnVisitComment !== false);
  setOptionChipValue('apPostsChips', String(settings.postsPerCycle));
  setOptionChipValue('apFeedChips', String(settings.feedPerCycle));
  setOptionChipValue('apIntervalChips', String(settings.intervalMinutes));
  setOptionChipValue('apAcceptModeChips', settings.acceptMode || 'screen');
  setOptionChipValue('apCancelSentChips', String(settings.cancelSentDays ?? 14));
  setOptionChipValue('apPruneDaysChips', String(settings.pruneDormantDays ?? 60));
  setChecked('#apPruneDormant', settings.pruneDormant);
  if ($('#apActiveStart')) $('#apActiveStart').value = String(settings.activeStartHour);
  if ($('#apActiveEnd')) $('#apActiveEnd').value = String(settings.activeEndHour);
  setChecked('#apDoLike', settings.doLike);
  setChecked('#apDoComment', settings.doComment);
  setChecked('#apDoNeighbor', settings.doNeighbor);
  setChecked('#apAllowGradeB', settings.allowGradeB);
  setOptionChipValue('apReturnVisitChips', String(settings.returnVisitPerCycle ?? 10));
  Object.entries(AP_STEP_INPUTS).forEach(([id, selector]) => setChecked(selector, settings.steps?.[id] !== false));
  syncAutopilotSubPanels();
  apApplyingSettings = false;
}

// Each step is one row: switch + one-line summary of its settings; '설정' opens the details.
const AP_STEP_PANELS = [
  ['#apStepAcceptNeighbors', 'apNeighborPanel'],
  ['#apStepReplies', 'apRepliesPanel'],
  ['#apStepReturnVisit', 'apReturnVisitPanel'],
  ['#apStepEngage', 'apEngagePanel'],
  ['#apStepFeed', 'apFeedPanel']
];
let apOpenPanel = null;

function autopilotStepSummaries() {
  const s = readAutopilotSettings();
  const join = (items, empty) => items.filter(Boolean).join('·') || empty;
  const list = (value) => value.split(',').map((t) => t.trim()).filter(Boolean);
  const short = (items) => `${items.slice(0, 3).join(', ')}${items.length > 3 ? ` 외 ${items.length - 3}개` : ''}`;
  const topics = list(s.seedTopics);
  const fixed = list(s.fixedKeywords);
  const source = s.keywordMode === 'fixed'
    ? (fixed.length ? `📌 ${short(fixed)}` : '⚠️ 정해둔 키워드를 입력해주세요')
    : (topics.length ? `🏆 ${short(topics)} 주제의 황금 키워드` : '⚠️ 황금 키워드를 찾을 내 블로그 주제를 입력해주세요');
  return {
    apSumNeighbors: [
      s.acceptMode === 'all' ? '받은 신청 전부 수락' : '받은 신청 AI 선별',
      s.cancelSentDays ? `${s.cancelSentDays}일 지난 신청 회수` : '',
      s.pruneDormant ? `${s.pruneDormantDays}일 넘은 비활성 정리` : ''
    ].filter(Boolean).join(' · '),
    apSumEngage: source.startsWith('⚠️') ? source : `${source} · 회차당 ${s.postsPerCycle}개 · ${join([s.doNeighbor && '서이추', s.doLike && '공감', s.doComment && '댓글'], '작업 없음')}`,
    apSumReplies: `회차당 ${s.repliesPerCycle}건${s.replyNeighbor ? ' · 댓글 단 이웃 서이추' : ''}`,
    apSumFeed: `회차당 ${s.feedPerCycle}건 · ${join([s.feedLike && '공감', s.feedComment && '댓글'], '⚠️ 공감·댓글이 모두 꺼져 있음')}`,
    apSumReturnVisit: `회차당 ${s.returnVisitPerCycle}명 · ${join([s.returnVisitLike && '공감', s.returnVisitComment && '댓글'], '⚠️ 공감·댓글이 모두 꺼져 있음')}`
  };
}

function syncAutopilotSubPanels() {
  const stepInputs = { apSumNeighbors: '#apStepAcceptNeighbors', apSumReplies: '#apStepReplies', apSumReturnVisit: '#apStepReturnVisit', apSumEngage: '#apStepEngage', apSumFeed: '#apStepFeed' };
  Object.entries(autopilotStepSummaries()).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const on = $(stepInputs[id])?.checked;
    el.textContent = on ? text : '꺼짐';
    el.classList.toggle('warn', Boolean(on && text.includes('⚠️')));
    el.closest('.ap-step')?.classList.toggle('off', !on);
  });
  AP_STEP_PANELS.forEach(([input, panelId]) => {
    const on = $(input)?.checked;
    if (!on && apOpenPanel === panelId) apOpenPanel = null;
    const open = on && apOpenPanel === panelId;
    $(`#${panelId}`)?.classList.toggle('hidden', !open);
    $$(`#autopilotWorkspace [data-panel="${panelId}"]`).forEach((btn) => {
      btn.disabled = !on;
      if (btn.classList.contains('ap-step-more')) btn.setAttribute('aria-expanded', String(open));
    });
    $(`#${panelId}`)?.closest('.ap-step')?.classList.toggle('open', open);
  });
  $('#apPruneDaysGroup')?.classList.toggle('hidden', !$('#apPruneDormant')?.checked);
  const fixedMode = $('#apKeywordMode')?.value === 'fixed';
  $('#apGoldenGroup')?.classList.toggle('hidden', fixedMode);
  $('#apFixedGroup')?.classList.toggle('hidden', !fixedMode);
  $('#apGradeBToggle')?.classList.toggle('hidden', fixedMode);
  const countOn = (selectors, el) => {
    const on = selectors.filter((sel) => $(sel)?.checked).length;
    if ($(el)) $(el).textContent = `${on} / ${selectors.length} 켜짐`;
  };
  countOn(['#apStepAcceptNeighbors', '#apStepEngage'], '#apGroupNeighborCount');
  countOn(['#apStepReplies', '#apStepFeed', '#apStepReturnVisit'], '#apGroupCommentCount');
}

function scheduleAutopilotSave() {
  syncAutopilotSubPanels();
  if (apApplyingSettings) return;
  clearTimeout(apSaveTimer);
  apSaveTimer = setTimeout(() => {
    api('api/autopilot/settings', { method: 'POST', body: JSON.stringify(readAutopilotSettings()) }).catch(() => {});
  }, 600);
}

function formatRemaining(isoTime) {
  if (!isoTime) return '-';
  const ms = new Date(isoTime).getTime() - Date.now();
  if (ms <= 0) return '곧 시작';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}분 후`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 후`;
}

function renderAutopilot(status) {
  apStatus = status;
  const enabled = Boolean(status.enabled);
  const phase = enabled ? status.phase : 'off';
  const offMessage = status.message && status.message !== AP_OFF_MESSAGE ? status.message : '';

  const toggle = $('#apToggleBtn');
  if (toggle) {
    toggle.classList.toggle('danger', enabled);
    toggle.classList.toggle('primary', !enabled);
    toggle.innerHTML = enabled ? '<strong>⏹️ 자율 주행 끄기</strong>' : '<strong>🚗 자율 주행 시작</strong>';
  }
  $('#apHeroCard')?.classList.toggle('is-on', enabled);
  $('#apHeroTitle').textContent = enabled ? `자율 주행 중 · ${status.cycle}회차` : '켜두면 블로그 관리를 알아서 반복합니다';
  $('#apHeroDesc').textContent = enabled
    ? (status.message || '정해진 간격으로 반복하고 있습니다.')
    : (offMessage || '아래에서 할 일과 반복 간격을 고르고 시작을 누르세요. 앱을 다시 켜도 이어서 진행합니다.');
  $('#apTabDot')?.classList.toggle('hidden', !enabled);

  const dot = $('#apStatusDot');
  if (dot) dot.className = `desktop-status-dot${phase === 'running' ? ' running' : enabled ? ' paused' : ''}`;
  $('#apStatusText').textContent = enabled
    ? `${AP_PHASE_TEXT[phase] || '진행 중'} · ${status.message || ''}`
    : `꺼짐 · ${offMessage || '시작을 누르면 바로 1회차를 진행합니다'}`;
  const showNext = enabled && status.nextRunAt && phase !== 'running';
  $('#apNextRunBadge')?.classList.toggle('hidden', !showNext);
  if (showNext) $('#apNextRunText').textContent = formatRemaining(status.nextRunAt);

  const results = status.currentCycle?.results || [];
  const pipeline = $('#apPipeline');
  if (pipeline) {
    pipeline.innerHTML = (status.steps || []).map((step) => {
      const off = !status.settings?.steps?.[step.id];
      const done = results.find((item) => item.step === step.id);
      const running = enabled && status.currentStep === step.id;
      const stepState = off ? 'off' : running ? 'running' : done ? done.status : 'pending';
      const label = { off: '끔', running: '진행 중', done: '완료', skipped: '건너뜀', failed: '실패', pending: '대기' }[stepState];
      return `<div class="ap-pipe-step ${stepState}" title="${escapeHtml(done?.summary || '')}">
        <span class="ap-pipe-icon">${step.icon}</span>
        <span class="ap-pipe-label">${escapeHtml(step.label)}</span>
        <span class="ap-pipe-state">${label}</span>
      </div>`;
    }).join('');
  }

  $('#apStatCycles').textContent = String(status.cycle || 0);
  $('#apStatLikes').textContent = String(status.today?.likes ?? 0);
  $('#apStatComments').textContent = String(status.today?.comments ?? 0);
  $('#apStatNeighbors').textContent = String(status.today?.neighbors ?? 0);

  const historyList = $('#apHistoryList');
  if (historyList) {
    const current = status.currentCycle;
    const live = current && !current.finishedAt && !(status.history || []).some((c) => c.number === current.number) ? [{ ...current, live: true }] : [];
    const items = [...live, ...(status.history || [])];
    historyList.innerHTML = items.length ? items.slice(0, 6).map((cycle) => {
      const time = new Date(cycle.startedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const chips = (cycle.results || []).map((item) => `<span class="ap-result-chip ${item.status}" title="${escapeHtml(item.summary || '')}">${escapeHtml(item.label)} · ${escapeHtml(item.summary || item.status)}</span>`).join('');
      const state = cycle.live ? '<span class="ap-cycle-state live">진행 중</span>'
        : cycle.interrupted ? '<span class="ap-cycle-state cut" title="앱이 다시 켜지면서 이 회차가 중간에 끝났습니다.">중단됨 · 앱 재시작</span>'
        : cycle.stopped ? '<span class="ap-cycle-state cut">중단됨 · 자율 주행 끔</span>' : '';
      const empty = cycle.live ? '첫 단계를 진행하고 있습니다.' : '마친 단계가 없습니다.';
      return `<div class="ap-history-item${cycle.interrupted || cycle.stopped ? ' cut' : ''}">
        <div class="ap-history-head"><strong>${cycle.number}회차</strong><span>${time}</span>${state}${cycle.keyword ? `<span class="ap-keyword-badge">🏆 ${escapeHtml(cycle.keyword)}</span>` : ''}</div>
        <div class="ap-history-results">${chips || `<span class="ap-result-chip">${empty}</span>`}</div>
      </div>`;
    }).join('') : '<div class="ap-empty">아직 진행한 회차가 없습니다.</div>';
  }

  const terminal = $('#apTerminalLogs');
  if (terminal && status.logs?.length) {
    terminal.innerHTML = status.logs.slice(0, 80).map((entry) => `<div class="terminal-line ${entry.type || 'info'}">[${escapeHtml(entry.time)}] ${escapeHtml(entry.message)}</div>`).join('');
  }
}

async function refreshAutopilot() {
  try {
    renderAutopilot(await api('api/autopilot/status'));
  } catch {}
}

function startAutopilotPolling() {
  if (apPollTimer) return;
  apPollTimer = setInterval(() => {
    const visible = !$('#autopilotWorkspace')?.classList.contains('hidden');
    if (visible || apStatus?.enabled) refreshAutopilot();
  }, 4000);
}

function initAutopilot() {
  const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  $('#apActiveStart').innerHTML = hours(0, 23).map((h) => `<option value="${h}">${String(h).padStart(2, '0')}시</option>`).join('');
  $('#apActiveEnd').innerHTML = hours(1, 24).map((h) => `<option value="${h}">${h === 24 ? '자정(24시)' : `${String(h).padStart(2, '0')}시`}</option>`).join('');
  $('#apActiveStart').value = '9';
  $('#apActiveEnd').value = '23';

  document.querySelectorAll('#autopilotWorkspace input, #autopilotWorkspace select').forEach((el) => {
    el.addEventListener(el.type === 'text' ? 'input' : 'change', scheduleAutopilotSave);
  });

  $('#apToggleBtn')?.addEventListener('click', async () => {
    const button = $('#apToggleBtn');
    button.disabled = true;
    try {
      if (apStatus?.enabled) {
        renderAutopilot({ ...apStatus, ...(await api('api/autopilot/stop', { method: 'POST' })) });
        toast('⏹️ 자율 주행을 껐습니다. 진행 중이던 작업도 안전하게 멈춥니다.');
      } else {
        const settings = readAutopilotSettings();
        const fixedMode = settings.keywordMode === 'fixed';
        if (settings.steps.engage && !(fixedMode ? settings.fixedKeywords : settings.seedTopics).trim()) {
          apOpenPanel = 'apEngagePanel';
          syncAutopilotSubPanels();
          $(fixedMode ? '#apFixedKeywords' : '#apSeedTopics')?.focus();
          throw new Error(fixedMode ? '서이추에 쓸 키워드를 입력해주세요.' : '황금 키워드를 찾을 내 블로그 주제를 입력해주세요.');
        }
        if (!state.connected) {
          setActiveTab('settings', true);
          throw new Error('⚠️ 네이버 계정을 먼저 연결해주세요.');
        }
        renderAutopilot({ ...apStatus, ...(await api('api/autopilot/start', { method: 'POST', body: JSON.stringify({ settings }) })) });
        toast('🚗 자율 주행을 시작했습니다. 켜두시면 알아서 반복합니다.');
      }
      await refreshAutopilot();
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $('#copyApLogsBtn')?.addEventListener('click', () => {
    const text = (apStatus?.logs || []).map((entry) => `[${entry.time}] ${entry.message}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toast('자율 주행 로그를 복사했습니다.')).catch(() => toast('로그를 복사하지 못했습니다.', true));
  });

  $$('#autopilotWorkspace [data-panel]').forEach((btn) => btn.addEventListener('click', () => {
    apOpenPanel = apOpenPanel === btn.dataset.panel ? null : btn.dataset.panel;
    syncAutopilotSubPanels();
  }));

  $('#autopilotTab')?.addEventListener('click', refreshAutopilot);
  syncAutopilotSubPanels();
  api('api/autopilot/status').then((status) => {
    applyAutopilotSettings(status.settings);
    if (!status.settings?.seedTopics && $('#engKeyword')?.value) $('#apSeedTopics').value = $('#engKeyword').value;
    renderAutopilot(status);
  }).catch(() => {});
  startAutopilotPolling();
}

initAutopilot();

// ---------------------------------------------------------------------------
// 비활성 이웃 정리: the user sets what counts as inactive → 찾기 → picks neighbors → 정리.
// Nothing runs on tab open.
// ---------------------------------------------------------------------------
let nhStatus = null;
let nhPollTimer = null;
let nhAwaitingQuery = false;
let nhShownQueryId = null;
const nhSelected = new Set();

function nhRelationLabel(relation) {
  return relation === 'mutual' ? '서로이웃' : relation === 'oneway' ? '일방 이웃' : '열린이웃';
}

function readNeighborCriteria() {
  return {
    activeDays: Number($('#nhActiveDays')?.value) || 60,
    relation: $('#nhRelation')?.value || 'all',
    graceDays: Number($('#nhGraceDays')?.value) || 0,
    commentersActive: $('#nhCommentersActive')?.checked !== false
  };
}

function renderNeighborResult(result, running) {
  const list = $('#nhCandidateList');
  const items = result.inactive;
  $('#nhResultSummary')?.classList.remove('hidden');
  $('#nhResultToolbar')?.classList.toggle('hidden', !items.length);
  $('#nhResultCount').textContent = `비활성 이웃 ${result.inactiveCount.toLocaleString()}명`;
  const kept = [
    `활성 이웃 ${(result.activeCount - (result.commenterCount || 0)).toLocaleString()}명`,
    result.commenterCount ? `댓글 이웃 ${result.commenterCount}명` : '',
    result.watchingCount ? `새로 추가한 ${result.watchingCount}명` : ''
  ].filter(Boolean).join(', ');
  $('#nhResultCriteria').textContent = `이웃 ${result.total.toLocaleString()}명 중 · ${result.description} · ${kept}은 그대로 둡니다`;
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="empty-state cleaner-empty-state"><div class="cleaner-empty-icon" aria-hidden="true"></div><strong>정리할 비활성 이웃이 없습니다</strong><p>지금 기준으로는 모든 이웃이 활동 중입니다. 기간을 줄여 다시 찾아보세요.</p></div>';
    return;
  }
  list.innerHTML = items.map((n) => {
    const picked = nhSelected.has(n.buddyBlogNo);
    return `
    <label class="nh-candidate${picked ? ' selected' : ''}">
      <input type="checkbox" class="nh-candidate-check" value="${escapeHtml(n.buddyBlogNo)}"${picked ? ' checked' : ''}${running ? ' disabled' : ''}>
      <div class="nh-candidate-main">
        <div class="nh-candidate-title"><strong>${escapeHtml(n.nickname || n.blogId)}</strong><a href="https://blog.naver.com/${encodeURIComponent(n.blogId)}" target="_blank" rel="noopener">@${escapeHtml(n.blogId)}</a></div>
        <div class="nh-candidate-meta">
          <span class="nh-badge ${n.relation}">${nhRelationLabel(n.relation)}</span>
          <span class="nh-badge dormant">${escapeHtml(n.reason)}</span>
          <span>최근 글 ${escapeHtml(n.lastPostText || '없음')} · 추가 ${escapeHtml(n.addedText || '-')}${n.group ? ` · ${escapeHtml(n.group)}` : ''}</span>
        </div>
      </div>
    </label>`;
  }).join('');
}

function renderNeighborProgress(progress) {
  $('#nhResultSummary')?.classList.add('hidden');
  $('#nhResultToolbar')?.classList.add('hidden');
  const reading = progress.phase === 'read';
  const percent = reading && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const list = $('#nhCandidateList');
  if (!list) return;
  list.innerHTML = `
    <div class="nh-progress-card" role="status" aria-live="polite">
      <div class="nh-progress-spinner" aria-hidden="true"></div>
      <strong>${reading ? '내 이웃 목록을 읽고 있습니다' : '비활성 이웃을 고르고 있습니다'}</strong>
      <p>${reading
        ? (progress.total ? `${progress.done} / ${progress.total}페이지 · 지금까지 ${(progress.count || 0).toLocaleString()}명` : '첫 페이지를 여는 중입니다…')
        : '잠시만 기다려주세요.'}</p>
      <div class="nh-progress-track"><div class="nh-progress-fill${percent === null ? ' indeterminate' : ''}" style="width:${percent === null ? 35 : Math.max(4, percent)}%"></div></div>
      <small>이웃이 1,000명이면 1분쯤 걸립니다. 목록은 30분 동안 다시 쓰여서 다음 찾기는 바로 끝납니다.</small>
    </div>`;
}

function renderNeighborError(message) {
  $('#nhResultSummary')?.classList.add('hidden');
  $('#nhResultToolbar')?.classList.add('hidden');
  const list = $('#nhCandidateList');
  if (list) list.innerHTML = `<div class="empty-state cleaner-empty-state"><div class="cleaner-empty-icon" aria-hidden="true"></div><strong>비활성 이웃을 찾지 못했습니다</strong><p>${escapeHtml(message.replace(/^❌\s*/, ''))}</p></div>`;
  toast(`⚠️ ${message.replace(/^❌\s*/, '')}`, true);
}

function renderNeighborHealth(status) {
  nhStatus = status;
  const running = status.state === 'running';
  const progress = status.progress || {};

  // Results appear only for a 찾기 the user started on this screen.
  const result = status.result;
  if (result && nhAwaitingQuery && !running) {
    nhAwaitingQuery = false;
    if (result.queryId !== nhShownQueryId) {
      nhShownQueryId = result.queryId;
      nhSelected.clear();
    }
  }

  const badge = $('#nhStatusBadge');
  if (badge) {
    const label = running ? (progress.phase === 'prune' ? '정리 중' : '찾는 중') : nhShownQueryId ? '찾기 완료' : '찾기 전';
    badge.className = `status ${running ? 'running' : nhShownQueryId ? 'online' : 'ready'}`;
    badge.innerHTML = `<i></i> ${label}`;
  }
  const queryBtn = $('#nhQueryBtn');
  queryBtn.disabled = running;
  queryBtn.classList.toggle('is-busy', running);
  queryBtn.innerHTML = `<strong>${running ? (progress.phase === 'prune' ? '⏳ 정리하는 중…' : '⏳ 비활성 이웃 찾는 중…') : '🔍 비활성 이웃 찾기'}</strong>`;
  $('#nhStopBtn')?.classList.toggle('hidden', !running);
  const hasList = status.listAgeMinutes !== null && status.listAgeMinutes !== undefined;
  $('#nhRefreshOption')?.classList.toggle('hidden', !hasList || running);
  if (hasList) $('#nhRefreshText').textContent = `이웃 목록 새로 읽기 (지금 목록은 ${status.listAgeMinutes}분 전에 읽은 ${Number(status.listSize || 0).toLocaleString()}명)`;
  $('#nhProgressText').textContent = running
    ? (progress.phase === 'prune' ? `비활성 이웃 정리 중… ${progress.done || 0} / ${progress.total || 0}명` : `이웃 목록 읽는 중… ${progress.done || 0} / ${progress.total || '?'}페이지 (${(progress.count || 0).toLocaleString()}명)`)
    : (hasList ? '기준을 바꿔 다시 찾으면 바로 결과가 나옵니다.' : '처음 찾을 때 내 이웃 목록을 읽습니다. 이웃이 1,000명이면 1분쯤 걸립니다.');
  $('#nhLimitBadge').textContent = `오늘 정리 ${status.prunedToday || 0} / ${status.dailyLimit || 30}명`;

  if (nhAwaitingQuery && running) {
    renderNeighborProgress(progress);
  } else if (nhAwaitingQuery && status.state === 'error') {
    nhAwaitingQuery = false;
    renderNeighborError(status.logs?.[0]?.message || '이웃 목록을 읽지 못했습니다.');
  } else if (result && nhShownQueryId === result.queryId) {
    const valid = new Set(result.inactive.map((n) => n.buddyBlogNo));
    [...nhSelected].forEach((no) => { if (!valid.has(no)) nhSelected.delete(no); });
    renderNeighborResult(result, running);
    const selectedCount = nhSelected.size;
    const remaining = Math.max(0, (status.dailyLimit || 30) - (status.prunedToday || 0));
    $('#nhSelectedCount').textContent = `${selectedCount}명 선택${selectedCount > remaining ? ` (오늘은 ${remaining}명까지 정리)` : ''}`;
    $('#nhSelectAll').checked = result.inactive.length > 0 && selectedCount === result.inactive.length;
    $('#nhPruneBtn').disabled = running || !selectedCount || !remaining;
  }

  const terminal = $('#nhTerminalLogs');
  if (terminal && status.logs?.length) {
    terminal.innerHTML = status.logs.slice(0, 60).map((entry) => `<div class="terminal-line ${entry.type || 'info'}">[${escapeHtml(entry.time)}] ${escapeHtml(entry.message)}</div>`).join('');
  }

  if (running && !nhPollTimer) nhPollTimer = setInterval(refreshNeighborHealth, 1500);
  if (!running && nhPollTimer) { clearInterval(nhPollTimer); nhPollTimer = null; }
}

async function refreshNeighborHealth() {
  try { renderNeighborHealth(await api('api/neighbor-health/status')); } catch {}
}

function initNeighborHealth() {
  $('#nhQueryBtn')?.addEventListener('click', async () => {
    if (!state.connected && nhStatus?.listAgeMinutes == null) return toast('⚠️ 네이버 계정을 먼저 연결해주세요.', true);
    $('#nhConfirmBar')?.classList.add('hidden');
    const btn = $('#nhQueryBtn');
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.innerHTML = '<strong>⏳ 비활성 이웃 찾는 중…</strong>';
    renderNeighborProgress({ phase: 'read', done: 0, total: 0 });
    try {
      nhAwaitingQuery = true;
      const refresh = $('#nhRefresh')?.checked === true;
      renderNeighborHealth(await api('api/neighbor-health/query', { method: 'POST', body: JSON.stringify({ criteria: readNeighborCriteria(), refresh }) }));
      if ($('#nhRefresh')) $('#nhRefresh').checked = false;
      if (!nhPollTimer) nhPollTimer = setInterval(refreshNeighborHealth, 1500);
    } catch (error) {
      nhAwaitingQuery = false;
      renderNeighborError(error.message);
      if (nhStatus) renderNeighborHealth(nhStatus);
      else { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = '<strong>🔍 비활성 이웃 찾기</strong>'; }
    }
  });
  $('#nhStopBtn')?.addEventListener('click', async () => {
    try { renderNeighborHealth(await api('api/neighbor-health/stop', { method: 'POST' })); } catch (error) { toast(error.message, true); }
  });
  $('#nhCandidateList')?.addEventListener('change', (event) => {
    const box = event.target.closest('.nh-candidate-check');
    if (!box) return;
    if (box.checked) nhSelected.add(box.value); else nhSelected.delete(box.value);
    if (nhStatus) renderNeighborHealth(nhStatus);
  });
  $('#nhSelectAll')?.addEventListener('change', (event) => {
    nhSelected.clear();
    if (event.target.checked) (nhStatus?.result?.inactive || []).forEach((n) => nhSelected.add(n.buddyBlogNo));
    if (nhStatus) renderNeighborHealth(nhStatus);
  });
  $('#nhPruneBtn')?.addEventListener('click', () => {
    const remaining = Math.max(0, (nhStatus?.dailyLimit || 30) - (nhStatus?.prunedToday || 0));
    const count = Math.min(nhSelected.size, remaining);
    $('#nhConfirmText').textContent = `비활성 이웃 ${count}명을 이웃에서 삭제할까요? 서로이웃도 함께 끊기며 되돌릴 수 없습니다.`;
    $('#nhConfirmBar')?.classList.remove('hidden');
  });
  $('#nhConfirmCancel')?.addEventListener('click', () => $('#nhConfirmBar')?.classList.add('hidden'));
  $('#nhConfirmOk')?.addEventListener('click', async () => {
    $('#nhConfirmBar')?.classList.add('hidden');
    try {
      renderNeighborHealth(await api('api/neighbor-health/prune', {
        method: 'POST',
        body: JSON.stringify({ buddyBlogNos: [...nhSelected], queryId: nhShownQueryId })
      }));
      nhSelected.clear();
      if (!nhPollTimer) nhPollTimer = setInterval(refreshNeighborHealth, 1500);
      toast('🧹 선택한 비활성 이웃 정리를 시작했습니다.');
    } catch (error) { toast(error.message, true); }
  });
  // Only today's prune count and list age; earlier results stay hidden until the user searches.
  refreshNeighborHealth();
}

initNeighborHealth();


// App auto-update (installed app only): new versions download quietly; when one is ready the
// header shows a one-click restart button. Closing the app also installs it.
function initAppUpdate() {
  const pill = $('#appUpdatePill');
  const text = $('#appUpdateText');
  const badge = $('#appVersionBadge');
  if (!pill) return;
  let timer = null;
  let announced = '';
  let last = {};
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(refresh, ms); };

  function renderBadge(update) {
    if (!badge || !update?.currentVersion) return;
    badge.classList.remove('hidden');
    badge.textContent = `v${update.currentVersion}`;
    badge.classList.toggle('checking', update.status === 'checking');
    badge.title = {
      latest: `최신 버전입니다 (v${update.currentVersion}). 눌러서 다시 확인`,
      checking: '새 버전 확인 중…',
      downloading: `새 버전 ${update.version} 받는 중`,
      ready: `새 버전 ${update.version} 준비 완료`,
      error: '업데이트 서버에 연결하지 못했습니다. 눌러서 다시 확인'
    }[update.status] || '눌러서 새 버전 확인';
  }

  function render(update) {
    last = update || {};
    renderBadge(update);
    const status = update?.status;
    pill.classList.remove('ready', 'busy');
    if (status === 'downloading') {
      pill.classList.remove('hidden');
      pill.classList.add('busy');
      pill.disabled = true;
      pill.title = `현재 버전 ${update.currentVersion}`;
      pill.querySelector('.header-update-icon').textContent = '⬇️';
      text.textContent = `새 버전 받는 중 ${update.percent || 0}%`;
      return schedule(3000);
    }
    if (status === 'ready' || status === 'installing') {
      pill.classList.remove('hidden');
      pill.classList.add('ready');
      pill.disabled = status === 'installing';
      pill.title = `현재 ${update.currentVersion} → 새 버전 ${update.version}. 누르면 앱이 잠시 닫혔다가 새 버전으로 다시 열립니다.`;
      pill.querySelector('.header-update-icon').textContent = status === 'installing' ? '⏳' : '🎉';
      text.textContent = status === 'installing' ? '업데이트 중… 곧 다시 열립니다' : `새 버전 ${update.version} · 지금 업데이트`;
      if (status === 'ready' && announced !== update.version) {
        announced = update.version;
        toast(`🎉 새 버전 ${update.version}이 준비됐습니다. 위의 [지금 업데이트]를 누르거나, 앱을 닫으면 자동으로 설치됩니다.`);
      }
      return schedule(60 * 1000);
    }
    pill.classList.add('hidden');
    if (status === 'dev' || status === 'unavailable') return undefined;
    return schedule(status === 'checking' ? 5000 : 10 * 60 * 1000);
  }

  async function refresh() {
    try { render(await api('api/app-update')); } catch { schedule(10 * 60 * 1000); }
  }

  badge?.addEventListener('click', async () => {
    if (badge.classList.contains('checking')) return;
    badge.classList.add('checking');
    badge.title = '새 버전 확인 중…';
    try {
      const update = await api('api/app-update/check', { method: 'POST' });
      render(update);
      if (update.status === 'latest') toast(`✅ 최신 버전입니다 (v${update.currentVersion}).`);
      else if (update.status === 'error') toast('업데이트 서버에 연결하지 못했습니다. 잠시 후 다시 눌러 주세요.', true);
    } catch (error) {
      toast(error.message, true);
    } finally {
      badge.classList.remove('checking');
    }
  });

  pill.addEventListener('click', async () => {
    if (!pill.classList.contains('ready')) return;
    pill.disabled = true;
    render({ ...last, status: 'installing' });
    try {
      await api('api/app-update/install', { method: 'POST' });
    } catch (error) {
      toast(error.message, true);
      refresh();
    }
  });
  refresh();
}

initAppUpdate();
