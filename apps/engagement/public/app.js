const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  connected: false,
  items: [],
  selected: new Set(),
  deals: [],
  images: [],
  selectedImages: new Set(),
  imagePlans: []
};

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
const workspaceTabs = [...document.querySelectorAll('[role="tab"]')].filter((tab) => tab.offsetParent !== null);
const fetchDealsButton = $('#fetchDealsButton');
const dealsResults = $('#dealsResults');
const draftForm = $('#draftForm');
const draftButton = $('#draftButton');
const publishForm = $('#publishForm');
const publishConfirm = $('#publishConfirm');
const publishButton = $('#publishButton');
const imageSearchButton = $('#imageSearchButton');
const imageResults = $('#imageResults');

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
    const data = await api('/api/blog/deals?refresh=true&limit=5');
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
    const data = await api('/api/blog/deals/draft', {
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
    const data = await api('/api/blog/article/extract', {
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

    const data = await api('/api/blog/article/draft', {
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
    const data = await api(`/api/blog/images?query=${encodeURIComponent(query)}&sourceUrl=${encodeURIComponent(sourceUrl)}`);
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
    const data = await api('/api/blog/images/auto', {
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
    const data = await api('/api/blog/publish', {
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
    const data = await api('/api/naver/login', {
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
    const res = await api('/api/naver/inject-cookies', {
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
    const summary = await api('/api/neighbors/summary');
    if ($('#dailyLimitBadge')) {
      $('#dailyLimitBadge').innerHTML = `📊 오늘 신청: <strong>${summary.todayCount || 0}</strong> / 100건`;
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// 서로이웃 자동화 (Nomalab Style Automation) 컨트롤러
// ---------------------------------------------------------------------------

let sseSource = null;

function initAutoNeighborEvents() {
  if (sseSource) return;
  sseSource = new EventSource('/api/neighbors/auto/events');

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

  const targetCount = Number($('#targetCount')?.value) || 30;
  const minDelay = Number($('#minDelay')?.value) || 15;
  const maxDelay = Number($('#maxDelay')?.value) || 30;
  const message = $('#autoMessage')?.value?.trim() || '';
  const activeWithinDays = Number($('#activeFilter')?.value) || 0;

  try {
    initAutoNeighborEvents();
    $('#liveDashboard')?.classList.remove('hidden');
    const res = await api('/api/neighbors/auto/start', {
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
    const res = await api('/api/neighbors/auto/pause', { method: 'POST' });
    updateAutoDashboard(res);
    toast('작업을 일시정지했습니다.');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#resumeAutoBtn')?.addEventListener('click', async () => {
  try {
    const res = await api('/api/neighbors/auto/resume', { method: 'POST' });
    updateAutoDashboard(res);
    toast('작업을 재개했습니다.');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#stopAutoBtn')?.addEventListener('click', async () => {
  if (!confirm('정말 진행 중인 서로이웃 자동화 작업을 중단하시겠습니까?')) return;
  try {
    const res = await api('/api/neighbors/auto/stop', { method: 'POST' });
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
    const data = await api(`/api/neighbors/history?limit=100&keyword=${encodeURIComponent(query)}`);
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
  window.open('/api/neighbors/history/export', '_blank');
});

$('#clearHistoryBtn')?.addEventListener('click', async () => {
  if (!confirm('정말 모든 서로이웃 신청 이력을 초기화하시겠습니까? (중복 신청 방지 기록도 함께 삭제됩니다)')) return;
  try {
    await api('/api/neighbors/history/clear', { method: 'POST' });
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
  const tbody = $('#engHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px;">소통 이력을 불러오는 중...</td></tr>';

  try {
    const data = await api(`/api/engagement/history?limit=100&keyword=${encodeURIComponent(query)}`);
    const records = data.items || [];
    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#a0aec0;">공감/댓글 소통 이력이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = records.map((r) => {
      const reactions = [];
      if (r.liked) reactions.push('<span class="pill pill-pink" style="background:#fed7e2; color:#b83280; font-weight:700;">❤️ 공감</span>');
      if (r.commented) reactions.push('<span class="pill pill-purple" style="background:#e9d8fd; color:#6b46c1; font-weight:700;">💬 댓글</span>');
      const reactionHtml = reactions.length > 0 ? reactions.join(' ') : '<span class="pill">확인필요</span>';

      let neighborHtml = '<span class="pill" style="background:#edf2f7; color:#718096;">-</span>';
      if (r.neighborRequested) {
        if (r.neighborStatus === 'requested' || r.neighborStatus === 'added') {
          neighborHtml = '<span class="pill" style="background:#bee3f8; color:#2b6cb0; font-weight:700;">👥 신청완료</span>';
        } else if (r.neighborStatus === 'already_mutual' || r.neighborStatus === 'already_added') {
          neighborHtml = '<span class="pill">기존이웃</span>';
        } else {
          neighborHtml = `<span class="pill" style="background:#feebc8; color:#c05621;">${escapeHtml(r.neighborStatus)}</span>`;
        }
      }

      const postTitleLink = r.postUrl 
        ? `<a href="${escapeHtml(r.postUrl)}" target="_blank" style="color:#2b6cb0; text-decoration:none; font-weight:600;" title="${escapeHtml(r.title || '')}">${escapeHtml((r.title || '포스팅').slice(0, 22))} ↗</a>`
        : escapeHtml((r.title || '포스팅').slice(0, 22));

      return `
        <tr>
          <td>${escapeHtml(r.timestamp?.slice(5, 16)?.replace('T', ' ') || '')}</td>
          <td><a href="https://blog.naver.com/${escapeHtml(r.blogId)}" target="_blank" style="color:#03c75a; font-weight:600; text-decoration:none;">@${escapeHtml(r.blogId)}</a></td>
          <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${postTitleLink}</td>
          <td>${reactionHtml}</td>
          <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.commentText || '')}">${escapeHtml(r.commentText || '-')}</td>
          <td>${neighborHtml}</td>
          <td><span class="pill pill-green">${escapeHtml(r.status === 'success' ? '완료' : r.status)}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#e53e3e;">이력 로드 실패: ${escapeHtml(err.message)}</td></tr>`;
  }
}

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
  window.open('/api/engagement/history/csv', '_blank');
});

$('#clearEngHistoryBtn')?.addEventListener('click', async () => {
  if (!confirm('정말 모든 공감/댓글 소통 이력을 초기화하시겠습니까? (중복 소통 방지 기록도 함께 삭제됩니다)')) return;
  try {
    await api('/api/engagement/history', { method: 'DELETE' });
    toast('공감/댓글 소통 이력이 성공적으로 초기화되었습니다.');
    loadEngagementHistory();
  } catch (err) {
    toast(err.message, true);
  }
});

// Logout

$('#logoutButton')?.addEventListener('click', async () => {
  await api('/api/naver/logout', { method: 'POST' }).catch(() => {});
  setConnected(false);
  toast('연결이 해제되었습니다.');
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

let currentHardwareSpecs = null;
let currentModelsList = [];
let activeModelId = null;

function updateLocalAiSummaryUI(activeModel, activeEndpoint) {
  const globalStatus = $('#globalEngineStatusText');
  const summaryModel = $('#summaryModelName');
  const summaryEndpoint = $('#summaryEndpointUrl');
  const currentBadge = $('#currentEngineBadge');

  if (activeModel) {
    if (summaryModel) summaryModel.textContent = `${activeModel.name} (${activeModel.sizeFormatted || ''})`;
    if (summaryEndpoint) summaryEndpoint.textContent = activeEndpoint?.baseUrl || 'http://127.0.0.1:8089';
    if (globalStatus) {
      globalStatus.textContent = `⚡ 내 PC 로컬 GPU (${activeModel.name})`;
      globalStatus.style.color = '#234e52';
    }
    if (currentBadge) {
      currentBadge.className = 'pill pill-green';
      currentBadge.textContent = `⚡ ${activeModel.name}`;
    }
    if ($('#llmStatus')) {
      $('#llmStatus').className = 'status online';
      $('#llmStatus').innerHTML = `<i></i> ⚡ 로컬 GPU (${escapeHtml(activeModel.name)})`;
    }
  } else {
    if (summaryModel) summaryModel.textContent = '미설치 (Gemma 모델 다운로드 필요)';
    if (summaryEndpoint) summaryEndpoint.textContent = '-';
    if (globalStatus) {
      globalStatus.textContent = '⚠️ AI 모델 다운로드 필요';
      globalStatus.style.color = '#c53030';
    }
    if (currentBadge) {
      currentBadge.className = 'pill pill-gray';
      currentBadge.textContent = '미설치';
    }
    if ($('#llmStatus')) {
      $('#llmStatus').className = 'status offline';
      $('#llmStatus').innerHTML = `<i></i> ⚠️ 모델 설치 필요`;
    }
  }
}

function initSettingsController() {
  // Global Header Status Click
  $('#globalEngineStatusBox')?.addEventListener('click', () => {
    setActiveTab('settings', true);
  });

  // 1. Settings Naver Login & Logout
  $('#settingsAccountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleIdPwLogin($('#settingsAccountForm'), '#settingsUserId', '#settingsUserPassword');
  });

  $('#settingsLogoutButton')?.addEventListener('click', async () => {
    await api('/api/naver/logout', { method: 'POST' }).catch(() => {});
    setConnected(false);
    toast('네이버 계정 연결이 해제되었습니다.');
  });
}

async function initAiHardwareAndModels() {
  try {
    const settings = await api('/api/settings').catch(() => null);

    const specs = await api('/api/hardware/specs');
    currentHardwareSpecs = specs;
    
    // Update GPU badges & text
    const gpuNameText = specs.gpu?.primaryGpu ? `${specs.gpu.primaryGpu.name} (${specs.gpu.vramFormatted})` : '시스템 GPU';
    if ($('#gpuSpecBadge')) $('#gpuSpecBadge').innerHTML = `🎮 ${escapeHtml(gpuNameText)}`;
    if ($('#localGpuSummaryText')) $('#localGpuSummaryText').textContent = `🎮 내 그래픽: ${gpuNameText} · 전용 VRAM ${specs.gpu?.vramFormatted || '8GB'}`;

    const summaryHtml = `내 컴퓨터 사양(<strong>${escapeHtml(specs.gpu?.primaryGpu?.name || 'GPU')}</strong> / <strong>${escapeHtml(specs.gpu?.vramFormatted || '8GB')}</strong>)에 맞는 <strong>[${escapeHtml(specs.recommendedModel?.modelInfo?.name || '로컬 AI')}]</strong> 모델을 추천합니다. 실제 설치된 모델만 선택해 글과 댓글을 생성합니다.`;

    if ($('#hardwareRecommendText')) $('#hardwareRecommendText').innerHTML = summaryHtml;

    const modelsRes = await api('/api/models/list').catch(() => null);
    if (modelsRes) {
      currentModelsList = modelsRes.models || [];
      activeModelId = modelsRes.activeModel?.id || null;
      
      renderModelCards(modelsRes.models, activeModelId, specs.recommendedModel?.id, '#aiModelCardsGrid');
      renderModelCards(modelsRes.models, activeModelId, specs.recommendedModel?.id, '#settingsAiModelCardsGrid');
      
      updateLocalAiSummaryUI(modelsRes.activeModel, settings?.activeEndpoint);

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
    modelEventSource = new EventSource('/api/models/events');
    
    modelEventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data || '{}');
      updateDownloadProgressUI(data);
    });

    modelEventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data || '{}');
      toast(`✨ [${data.meta?.name || data.modelId}] 다운로드가 완료되어 내 PC GPU 활성 모델로 설정되었습니다!`);
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
      btnHtml = `<button type="button" class="button small model-select-btn" disabled style="background:#2b6cb0; color:#fff; font-weight:700;">✓ 사용 중 (내 PC GPU)</button>`;
      statusPill = `<span class="pill pill-green" style="font-size:11px;">⚡ 내 PC GPU 활성</span>`;
    } else if (isInstalled) {
      btnHtml = `<button type="button" class="button small model-select-btn" data-action="select" data-id="${escapeHtml(m.id)}">내 PC GPU로 전환</button>`;
      statusPill = `<span class="pill" style="font-size:11px; background:#edf2f7; color:#4a5568;">💾 설치됨 (대기)</span>`;
    } else {
      btnHtml = `<button type="button" class="button small ghost model-select-btn" data-action="download" data-id="${escapeHtml(m.id)}">다운로드 (${escapeHtml(m.sizeFormatted)})</button>`;
      statusPill = `<span class="pill" style="font-size:11px; background:#fffaf0; color:#dd6b20; border:1px solid #feebc8;">미설치 (다운로드 필요)</span>`;
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
          <span class="model-vram-hint">💡 최소 VRAM: ${(m.minVramMb / 1024).toFixed(1)}GB</span>
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
          await api('/api/models/select', { method: 'POST', body: JSON.stringify({ modelId }) });
          toast(`활성 AI 모델이 '${modelId}'(으)로 전환되었습니다.`);
          initAiHardwareAndModels();
        } catch (err) {
          toast(err.message, true);
        }
      } else if (action === 'download') {
        try {
          btn.disabled = true;
          btn.textContent = '다운로드 요청 중...';
          await api('/api/models/download', { method: 'POST', body: JSON.stringify({ modelId }) });
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
let engagementTargetDraft = [];

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
  $$('.eng-chips button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#engKeyword');
      if (!input) return;
      const keyword = btn.textContent.trim();
      const keywords = [...new Set(input.value.split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean))];
      const next = keywords.includes(keyword) ? keywords.filter((value) => value !== keyword) : [...keywords, keyword];
      input.value = next.join(', ');
      syncEngKeywordChips();
    });
  });
  $('#engKeyword')?.addEventListener('input', syncEngKeywordChips);
  syncEngKeywordChips();

  const readEngTargets = () => [...new Set(($('#engKeyword')?.value || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean))].map((keyword) => ({ keyword, reason: '직접 추가', score: null }));
  const renderEngTargetManager = () => {
    const list = $('#engTargetManagerList');
    if (!list) return;
    list.innerHTML = engagementTargetDraft.length ? engagementTargetDraft.map((item, index) => `<div class="target-manager-item"><div><strong>${escapeHtml(item.keyword)}</strong>${item.score ? `<span class="target-score">적합도 ${item.score}</span>` : ''}<small>${escapeHtml(item.reason || '직접 추가')}</small></div><div><button type="button" data-target-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-target-down="${index}" ${index === engagementTargetDraft.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="danger" data-target-remove="${index}">삭제</button></div></div>`).join('') : '<div class="empty-state" style="padding:24px;">관리할 키워드를 추가하거나 AI 분석을 실행하세요.</div>';
  };
  const closeTargetManager = () => $('#engTargetManagerModal')?.classList.add('hidden');
  $('#openEngTargetManagerBtn')?.addEventListener('click', () => { engagementTargetDraft = readEngTargets(); renderEngTargetManager(); $('#engTargetManagerModal')?.classList.remove('hidden'); });
  $('#closeEngTargetManagerBtn')?.addEventListener('click', closeTargetManager);
  $('#cancelEngTargetsBtn')?.addEventListener('click', closeTargetManager);
  $('#engTargetManagerModal')?.addEventListener('click', (event) => { if (event.target.id === 'engTargetManagerModal') closeTargetManager(); });
  $('#analyzeEngTargetsBtn')?.addEventListener('click', async () => {
    const button = $('#analyzeEngTargetsBtn');
    const status = $('#engTargetAnalysisStatus');
    try {
      button.disabled = true;
      button.textContent = '분석 중...';
      if (status) status.textContent = '최근 글 수집 → 로컬 LLM 주제·독자 분석 중...';
      const result = await api('/api/engagement/keyword-recommendations');
      if (!result.targets?.length) throw new Error('최근 글에서 추천할 주제를 찾지 못했습니다.');
      engagementTargetDraft = result.targets;
      renderEngTargetManager();
      const summary = $('#engTargetAnalysisSummary');
      if (summary) { summary.classList.remove('hidden'); summary.innerHTML = `<strong>${escapeHtml(result.summary || '분석 완료')}</strong><span>주요 독자: ${escapeHtml(result.audience || '-')}</span>`; }
      if (status) status.textContent = `${result.analyzedTextCount}개 요소 · ${result.method === 'llm' ? '로컬 LLM 분석' : '규칙 기반 보완'} 완료`;
    } catch (error) {
      if (status) status.textContent = error.message;
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = '내 블로그 AI 재분석';
    }
  });
  $('#addEngTargetBtn')?.addEventListener('click', () => { const input = $('#engTargetAddInput'); const keyword = input?.value.trim().replace(/[,，\n]/g, ''); if (!keyword || engagementTargetDraft.some((item) => item.keyword === keyword)) return; engagementTargetDraft.push({ keyword, reason: '직접 추가', score: null }); input.value = ''; renderEngTargetManager(); });
  $('#engTargetManagerList')?.addEventListener('click', (event) => { const button = event.target.closest('button'); if (!button) return; const remove = button.dataset.targetRemove; const up = button.dataset.targetUp; const down = button.dataset.targetDown; if (remove !== undefined) engagementTargetDraft.splice(Number(remove), 1); else { const from = Number(up ?? down); const to = up !== undefined ? from - 1 : from + 1; if (from >= 0 && to >= 0 && to < engagementTargetDraft.length) [engagementTargetDraft[from], engagementTargetDraft[to]] = [engagementTargetDraft[to], engagementTargetDraft[from]]; } renderEngTargetManager(); });
  $('#applyEngTargetsBtn')?.addEventListener('click', () => { if (!engagementTargetDraft.length) return toast('소통 타겟을 한 개 이상 추가해주세요.', true); $('#engKeyword').value = engagementTargetDraft.map((item) => item.keyword).join(', '); syncEngKeywordChips(); closeTargetManager(); toast(`${engagementTargetDraft.length}개 소통 타겟을 적용했습니다.`); });

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
      setActiveTab('neighbor', true);
      return;
    }

    const keyword = $('#engKeyword')?.value?.trim();
    if (!keyword) return toast('소통 타겟 키워드를 입력해주세요.', true);

    const targetCount = Number($('#engTargetCount')?.value) || 20;
    const doLike = $('#engDoLike')?.checked ?? true;
    const doComment = $('#engDoComment')?.checked ?? true;
    const doNeighbor = $('#engDoNeighbor')?.checked ?? true;
    const neighborMessage = $('#engNeighborMessage')?.value?.trim() || '안녕하세요! 포스팅 잘 보고 갑니다. 좋은 이웃으로 소통하고 지내요 😊';
    const tone = $('#engTone')?.value || 'friendly';
    const minDelay = Number($('#engMinDelay')?.value) || 15;
    const maxDelay = Number($('#engMaxDelay')?.value) || 30;

    if (!doLike && !doComment && !doNeighbor) {
      return toast('공감(❤️), AI 댓글(💬), 서로이웃(👥) 중 최소 1개 이상을 선택해주세요.', true);
    }

    const startBtn = $('#startEngBtn');
    try {
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<span class="btn-icon">⏳</span> <strong>시작 준비 중...</strong>';
      }
      const dashboard = $('#engDashboard');
      if (dashboard) dashboard.classList.remove('hidden');

      await api('/api/engagement/start', {
        method: 'POST',
        body: JSON.stringify({ keyword, targetCount, doLike, doComment, doNeighbor, neighborMessage, tone, minDelay, maxDelay })
      });
      const keywordCount = keyword.split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean).length;
      toast(`${keywordCount}개 키워드를 순차 실행합니다. 키워드당 ${targetCount}건`);
      initEngagementEvents();
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<span class="btn-icon">🚀</span> <strong>공감 & AI 맞춤 댓글 시작</strong>';
      }
    }
  });

  // 4-1. Neighbor checkbox toggle message group
  $('#engDoNeighbor')?.addEventListener('change', (e) => {
    $('#engNeighborMsgGroup')?.classList.toggle('hidden', !e.target.checked);
  });

  // 5. Pause, Resume, Stop buttons
  $('#pauseEngBtn')?.addEventListener('click', async () => {
    try {
      await api('/api/engagement/pause', { method: 'POST' });
      toast('작업을 일시정지했습니다.');
    } catch (err) { toast(err.message, true); }
  });

  $('#resumeEngBtn')?.addEventListener('click', async () => {
    try {
      await api('/api/engagement/resume', { method: 'POST' });
      toast('작업을 재개했습니다.');
    } catch (err) { toast(err.message, true); }
  });

  $('#stopEngBtn')?.addEventListener('click', async () => {
    if (!confirm('정말 진행 중인 공감/댓글 자동화 작업을 중단하시겠습니까?')) return;
    try {
      await api('/api/engagement/stop', { method: 'POST' });
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

  engagementEventSource = new EventSource('/api/engagement/events');

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

function updateEngagementDashboard(data) {
  if (!data) return;
  const { state, stats = {}, config = {} } = data;
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const isIdle = state === 'idle' || state === 'stopped' || state === 'completed' || state === 'error';

  const dashboard = $('#engDashboard');
  if (dashboard) {
    if (!isIdle) dashboard.classList.remove('hidden');
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
    if (isRunning) statusEl.textContent = stats.phase === 'searching' ? `🔍 '${stats.currentKeyword || ''}' 후보 검색 중...` : `🚀 '${stats.currentKeyword || ''}' 주제 소통 진행 중...`;
    else if (isPaused) statusEl.textContent = '⏸️ 작업 일시정지됨';
    else if (state === 'completed') {
      statusEl.textContent = stats.targetReached
        ? `🎉 목표 ${stats.targetCount || config.targetCount || 0}개 포스팅 소통 완료!`
        : `⚠️ 후보 부족: ${stats.processedCount || 0} / ${stats.targetCount || config.targetCount || 0}개 포스팅 처리`;
    }
    else if (state === 'stopped') statusEl.textContent = '⏹️ 사용자에 의해 중단됨';
    else if (state === 'error') statusEl.textContent = '⚠️ 오류로 인해 중단됨';
    else statusEl.textContent = '대기 중';
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
    topicProgress.innerHTML = keywords.map((keyword) => { const count = counts[keyword] || 0; const done = count >= perTarget; const currentTopic = !done && stats.currentKeyword === keyword; const stateLabel = done ? '완료' : currentTopic ? (stats.phase === 'searching' ? '후보 검색 중' : '진행 중') : '대기'; return `<div class="eng-topic-row ${done ? 'done' : currentTopic ? 'current' : 'pending'}"><span>${done ? '✅' : currentTopic ? '▶' : '○'} <strong>${escapeHtml(keyword)}</strong></span><span>${count} / ${perTarget} · ${stateLabel}</span></div>`; }).join('');
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
  line.className = `terminal-line ${escapeHtml(entry.type || 'info')}`;
  line.innerHTML = `<span class="terminal-time">[${escapeHtml(entry.time || '')}]</span> <span class="terminal-msg">${escapeHtml(entry.message || '')}</span>`;
  container.appendChild(line);

  // Auto scroll to bottom
  container.scrollTop = container.scrollHeight;

  // Keep max 150 lines
  while (container.children.length > 150) {
    container.removeChild(container.firstChild);
  }
}

// Initial health check and session restoration
api('/api/health').then(async (data) => {
  initSettingsController();
  initAiHardwareAndModels();
  initModelEvents();
  initEngagementAutomation();

  if (data.connected) {
    setConnected(true);
    initAutoNeighborEvents();
    const status = await api('/api/neighbors/auto/status').catch(() => null);
    if (status) updateAutoDashboard(status);
    return;
  }
  const restored = await api('/api/naver/restore', { method: 'POST' }).catch(() => ({ connected: false }));
  setConnected(restored.connected, restored.accountLabel);
  if (restored.connected) {
    initAutoNeighborEvents();
    toast('저장된 네이버 로그인 상태를 불러왔습니다.');
    const status = await api('/api/neighbors/auto/status').catch(() => null);
    if (status) updateAutoDashboard(status);
  }
}).catch(() => {
  setConnected(false);
  initSettingsController();
  initAiHardwareAndModels();
  initModelEvents();
  initEngagementAutomation();
});
