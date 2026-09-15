const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  connected: false,
  items: [],
  selected: new Set(),
  deals: [],
  images: [],
  selectedImages: new Set(),
  sourceTopic: '',
  imagePlans: [],
  seriesEpisodes: [],
  currentEpisodeIdx: 0
};
let promptConfig = null;

function switchPromptTab(tab) {
  const writingBtn = $('#tabWritingPromptBtn');
  const imageBtn = $('#tabImagePromptBtn');
  const writingContent = $('#writingPromptTabContent');
  const imageContent = $('#imagePromptTabContent');

  if (tab === 'writing') {
    if (writingBtn) {
      writingBtn.style.background = '#03c75a';
      writingBtn.style.color = '#fff';
      writingBtn.style.border = 'none';
      writingBtn.classList.add('active');
    }
    if (imageBtn) {
      imageBtn.style.background = '#f8faf9';
      imageBtn.style.color = '#4a5568';
      imageBtn.style.border = '1px solid #dce3df';
      imageBtn.classList.remove('active');
    }
    writingContent?.classList.remove('hidden');
    imageContent?.classList.add('hidden');
  } else {
    if (imageBtn) {
      imageBtn.style.background = '#03c75a';
      imageBtn.style.color = '#fff';
      imageBtn.style.border = 'none';
      imageBtn.classList.add('active');
    }
    if (writingBtn) {
      writingBtn.style.background = '#f8faf9';
      writingBtn.style.color = '#4a5568';
      writingBtn.style.border = '1px solid #dce3df';
      writingBtn.classList.remove('active');
    }
    imageContent?.classList.remove('hidden');
    writingContent?.classList.add('hidden');
  }
}

$('#tabWritingPromptBtn')?.addEventListener('click', () => switchPromptTab('writing'));
$('#tabImagePromptBtn')?.addEventListener('click', () => switchPromptTab('image'));

async function loadPromptConfig(force = false) {
  if (promptConfig && !force) return promptConfig;
  promptConfig = await api('/api/blog/prompt-template');
  return promptConfig;
}

function parsePromptEditor() {
  const writingPrompt = $('#writingPromptEditor')?.value?.trim() || '';
  const imagePrompt = $('#imagePromptEditor')?.value?.trim() || '';
  if (writingPrompt.length < 10) throw new Error('글생성 프롬프트를 10자 이상 입력해주세요.');

  const config = {
    writingPrompt,
    imagePrompt,
    systemPrompt: writingPrompt,
    imagePromptInstructions: imagePrompt,
    userPromptTemplate: promptConfig?.userPromptTemplate || '다음 주제와 요청 내용으로 네이버 블로그 글을 작성하라.\n\n주제:\n{{topic}}\n\n내용 및 사용자 요청:\n{{content}}'
  };

  const jsonEditor = $('#promptJsonEditor');
  if (jsonEditor) {
    jsonEditor.value = JSON.stringify(config, null, 2);
  }
  return config;
}

$('#openPromptJsonBtn')?.addEventListener('click', async () => {
  try {
    const config = await loadPromptConfig();
    const writingEl = $('#writingPromptEditor');
    const imageEl = $('#imagePromptEditor');
    const jsonEl = $('#promptJsonEditor');
    if (writingEl) writingEl.value = config.writingPrompt || config.systemPrompt || '';
    if (imageEl) imageEl.value = config.imagePrompt || config.imagePromptInstructions || '';
    if (jsonEl) jsonEl.value = JSON.stringify(config, null, 2);
    switchPromptTab('writing');
    $('#promptJsonDialog')?.showModal();
  } catch (error) { toast(`프롬프트를 불러오지 못했습니다: ${error.message}`, true); }
});

$('#resetPromptJsonBtn')?.addEventListener('click', async () => {
  try {
    const config = await loadPromptConfig(true);
    const writingEl = $('#writingPromptEditor');
    const imageEl = $('#imagePromptEditor');
    const jsonEl = $('#promptJsonEditor');
    if (writingEl) writingEl.value = config.writingPrompt || config.systemPrompt || '';
    if (imageEl) imageEl.value = config.imagePrompt || config.imagePromptInstructions || '';
    if (jsonEl) jsonEl.value = JSON.stringify(config, null, 2);
    toast('기본 글생성 및 이미지 프롬프트로 복원되었습니다.');
  } catch (error) { toast(error.message, true); }
});

$('#usePromptPublishBtn')?.addEventListener('click', () => {
  try {
    promptConfig = parsePromptEditor();
    $('#promptJsonDialog')?.close();
    toast('글생성 및 이미지 생성 프롬프트가 적용되었습니다! ✨');
  } catch (error) { toast(`프롬프트 오류: ${error.message}`, true); }
});

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

// This desktop app exposes posting only; settings remains available as its
// independent configuration surface.
setActiveTab('publish');

async function api(url, options = {}) {
  const timeoutMs = options.timeoutMs || (url.includes('/draft') ? 300000 : 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    clearTimeout(timer);
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
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`요청 시간 초과 (${Math.round(timeoutMs / 1000)}초). AI 응답이 지연되고 있습니다. 다시 시도해주세요.`);
    }
    if (err.name === 'TypeError' && String(err.message).toLowerCase().includes('fetch')) {
      throw new Error('서버(Node.js)와 연결할 수 없습니다. 포스팅 프로그램을 재시작해주세요.');
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

function setAutoPostProgress(message = '', type = 'running') {
  const progress = $('#autoPostProgress');
  if (!progress) return;
  progress.textContent = message;
  progress.classList.toggle('hidden', !message);
  progress.style.whiteSpace = 'pre-line';
  progress.style.background = type === 'error' ? '#fff1f2' : type === 'complete' ? '#ecfdf3' : '#edf6ff';
  progress.style.color = type === 'error' ? '#b42318' : type === 'complete' ? '#167346' : '#24527a';
  progress.style.border = type === 'error' ? '1px solid #fda29b' : type === 'complete' ? '1px solid #86efac' : '1px solid #bfdbfe';
}

function startGenerationProgress(generationId) {
  const startedAt = Date.now();
  let latest = '생성 작업을 서버에 전달하는 중';
  let stopped = false;
  let pollFailCount = 0;
  const render = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    setAutoPostProgress(`${latest}\n경과 시간 ${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`);
  };
  const elapsedTimer = setInterval(() => {
    if (stopped) return;
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    if (seconds > 360) { // Safety ceiling: 6 minutes max
      stopped = true;
      clearInterval(elapsedTimer);
      clearInterval(pollTimer);
      setAutoPostProgress('생성 시간 초과 (6분 경과)\nAI 모델 또는 서버 응답이 지연되고 있습니다. 창을 새로고침하고 다시 시도해주세요.', 'error');
      const btn = $('#articleDraftBtn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">✨</span> <strong>Gemini (agy) 글 작성 + 맞춤 이미지 자동 생성</strong>';
      }
      return;
    }
    render();
  }, 1000);

  const pollTimer = setInterval(async () => {
    if (stopped) return;
    try {
      const progress = await api(`/api/blog/generation-status/${generationId}`, { timeoutMs: 3000 });
      pollFailCount = 0;
      latest = progress.message || latest;
      if (progress.status === 'error') {
        stopped = true;
        clearInterval(elapsedTimer);
        clearInterval(pollTimer);
        setAutoPostProgress(`오류 발생 (${progress.phase || '생성'})\n${latest}`, 'error');
      } else {
        render();
      }
    } catch {
      pollFailCount += 1;
      if (pollFailCount >= 10 && !stopped) {
        latest = '서버 응답을 기다리는 중...';
        render();
      }
    }
  }, 1500);
  render();
  return () => {
    stopped = true;
    clearInterval(elapsedTimer);
    clearInterval(pollTimer);
  };
}

function updateSeriesEpisodeOptions() {
  const countSelect = $('#articleSeriesCount');
  const episodeWrap = $('#seriesEpisodeWrap');
  const episodeSelect = $('#articleSeriesEpisode');
  const guidanceWrap = $('#seriesGuidance');
  if (!countSelect || !episodeSelect) return;

  const count = parseInt(countSelect.value, 10) || 1;
  if (count <= 1) {
    if (episodeWrap) episodeWrap.classList.add('hidden');
    if (guidanceWrap) guidanceWrap.classList.add('hidden');
    episodeSelect.innerHTML = '<option value="1" selected>[1편] 단편 집중 심층 분석</option>';
    return;
  }

  if (episodeWrap) episodeWrap.classList.remove('hidden');
  if (guidanceWrap) guidanceWrap.classList.remove('hidden');

  const episodeGuides = {
    2: [
      '[1/2] 제1편 - 핵심 개념 원리 및 현황 총분석',
      '[2/2] 제2편 - 실전 적용 전략 및 1% 전문가 꿀팁'
    ],
    3: [
      '[1/3] 제1편 - 기본 입문 및 꼭 알아야 할 기초 원리',
      '[2/3] 제2편 - 실전 로드맵 & 200% 활용 노하우',
      '[3/3] 제3편 - 심화 마스터 & 실수 방지 체크리스트'
    ],
    5: [
      '[1/5] 제1편 - 기초 개념 및 배경 원리 마스터',
      '[2/5] 제2편 - 환경 구축 및 필수 준비 단계',
      '[3/5] 제3편 - 실전 테크닉 및 1% 디테일 노하우',
      '[4/5] 제4편 - 빈출 함정 및 문제 해결(트러블슈팅)',
      '[5/5] 제5편 - 장기 성장 로드맵 및 전문가 마스터 총정리'
    ]
  };

  const guides = episodeGuides[count] || Array.from({ length: count }, (_, i) => `[${i + 1}/${count}] 제${i + 1}편`);
  const prevVal = parseInt(episodeSelect.value, 10) || 1;
  episodeSelect.innerHTML = guides.map((text, i) => `<option value="${i + 1}" ${i + 1 === Math.min(prevVal, count) ? 'selected' : ''}>${text}</option>`).join('');
}

function saveCurrentEpisodeState() {
  if (!state.seriesEpisodes || !state.seriesEpisodes[state.currentEpisodeIdx]) return;
  const current = state.seriesEpisodes[state.currentEpisodeIdx];
  current.title = $('#postTitle')?.value || current.title;
  current.content = $('#postContent')?.value || current.content;
  current.tags = ($('#postTags')?.value || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  current.images = [...state.images];
  current.autoImages = [...state.images];
  current.imagePlans = [...state.imagePlans];
}

function updatePublishButtonLabel() {
  if (!publishButton) return;
  const publishAllBtn = $('#publishAllSeriesBtn');
  if (state.seriesEpisodes && state.seriesEpisodes.length > 1) {
    const curNum = state.currentEpisodeIdx + 1;
    const isPub = state.seriesEpisodes[state.currentEpisodeIdx]?.isPublished;
    publishButton.textContent = isPub
      ? `네이버 블로그에 [제${curNum}편] 다시 발행하기`
      : `네이버 블로그에 [제${curNum}편] 게시 발행`;
    if (publishAllBtn) {
      publishAllBtn.classList.remove('hidden');
      publishAllBtn.textContent = `🚀 총 ${state.seriesEpisodes.length}부작 전편 순차 자동 발행`;
    }
  } else {
    publishButton.textContent = '네이버 블로그에 게시 발행';
    if (publishAllBtn) publishAllBtn.classList.add('hidden');
  }
}

function renderSeriesTabs() {
  const banner = $('#seriesPostBanner');
  const cardsGrid = $('#seriesEpisodeCardsGrid');
  const badge = $('#seriesActiveEpBadge');
  const continuousView = $('#seriesAllContinuousView');
  if (!banner) return;

  if (!state.seriesEpisodes || state.seriesEpisodes.length <= 1) {
    banner.classList.add('hidden');
    if (cardsGrid) cardsGrid.innerHTML = '';
    if (continuousView) continuousView.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  if (badge) {
    badge.textContent = `제${state.currentEpisodeIdx + 1}편 편집 중 (${state.currentEpisodeIdx + 1}/${state.seriesEpisodes.length})`;
  }

  if (cardsGrid) {
    cardsGrid.innerHTML = state.seriesEpisodes.map((ep, idx) => {
      const isActive = idx === state.currentEpisodeIdx;
      const isPub = Boolean(ep.isPublished);
      const epTitle = ep.title || `제${idx + 1}편 포스팅`;
      const wordCount = (ep.content || '').replace(/\s+/g, '').length;
      const images = (ep.autoImages || ep.images || []).slice(0, 3);
      const leadSnippet = (ep.lead || ep.content || '').slice(0, 75).replace(/\n/g, ' ') + '…';

      const thumbHtml = images.length > 0
        ? `<div style="display:flex; gap:6px; margin-top:8px;">
            ${images.map((img) => `<img src="${img.previewUrl || img.downloadUrl || ''}" alt="썸네일" style="width:54px; height:40px; object-fit:cover; border-radius:6px; border:1px solid #cbd5e1; background:#f1f5f9;">`).join('')}
          </div>`
        : `<div style="font-size:11px; color:#94a3b8; margin-top:6px;">이미지 준비 완료</div>`;

      return `
        <div class="series-card-item" data-episode-idx="${idx}" style="
          padding: 14px 16px;
          border-radius: 12px;
          cursor: pointer;
          border: 2px solid ${isActive ? '#03c75a' : '#e2e8f0'};
          background: ${isActive ? '#f0fdf4' : '#ffffff'};
          box-shadow: ${isActive ? '0 4px 12px rgba(3,199,90,0.18)' : '0 1px 3px rgba(0,0,0,0.04)'};
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        ">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="
                font-size: 11px;
                font-weight: 800;
                color: ${isActive ? '#15803d' : '#64748b'};
                background: ${isActive ? '#dcfce7' : '#f1f5f9'};
                padding: 2px 8px;
                border-radius: 9999px;
              ">제${idx + 1}편</span>
              <div style="display:flex; gap:4px; align-items:center;">
                <span style="font-size:11px; color:#64748b;">약 ${wordCount.toLocaleString()}자</span>
                ${isPub ? '<span style="font-size:11px; font-weight:700; color:#15803d; background:#dcfce7; padding:1px 6px; border-radius:4px;">✓발행됨</span>' : ''}
              </div>
            </div>
            <strong style="
              font-size: 13px;
              line-height: 1.4;
              color: #0f172a;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
              margin-bottom: 4px;
            ">${escapeHtml(epTitle)}</strong>
            <p style="
              font-size: 11px;
              color: #64748b;
              margin: 0;
              line-height: 1.35;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            ">${escapeHtml(leadSnippet)}</p>
            ${thumbHtml}
          </div>
          <div style="margin-top:10px; display:flex; justify-content:flex-end;">
            <button type="button" style="
              padding: 5px 12px;
              font-size: 12px;
              font-weight: ${isActive ? '700' : '600'};
              border-radius: 6px;
              border: 1px solid ${isActive ? '#03c75a' : '#cbd5e1'};
              background: ${isActive ? '#03c75a' : '#ffffff'};
              color: ${isActive ? '#ffffff' : '#334155'};
              cursor: pointer;
            ">${isActive ? '✓ 현재 편집 중' : '선택하여 편집'}</button>
          </div>
        </div>
      `;
    }).join('');

    cardsGrid.querySelectorAll('.series-card-item').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.episodeIdx, 10);
        if (!isNaN(idx) && idx !== state.currentEpisodeIdx) {
          switchToEpisode(idx);
        }
      });
    });
  }

  // Render Full Continuous Series View
  if (continuousView) {
    continuousView.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding-bottom:10px; border-bottom:1.5px solid #e2e8f0;">
        <h4 style="margin:0; font-size:15px; color:#0f172a;">📖 전체 ${state.seriesEpisodes.length}부작 연속 미리보기</h4>
        <small style="color:#64748b;">(아래 각 편의 제목, 본문, 이미지를 한번에 검토할 수 있습니다)</small>
      </div>
      <div style="display:flex; flex-direction:column; gap:24px;">
        ${state.seriesEpisodes.map((ep, idx) => {
          const epImgs = (ep.autoImages || ep.images || []);
          return `
            <article style="
              padding: 16px;
              background: #f8fafc;
              border: 1.5px solid #e2e8f0;
              border-radius: 10px;
            ">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <span style="font-size:12px; font-weight:700; color:#15803d; background:#dcfce7; padding:2px 10px; border-radius:9999px;">제${idx + 1}편</span>
                <button type="button" class="switch-to-ep-btn" data-episode-idx="${idx}" style="
                  font-size:12px; color:#03c75a; background:none; border:1px solid #03c75a; border-radius:6px; padding:3px 10px; cursor:pointer; font-weight:600;
                ">이 회차 에디터로 불러오기 ✏️</button>
              </div>
              <h3 style="font-size:16px; color:#0f172a; margin:0 0 10px 0;">${escapeHtml(ep.title || '')}</h3>
              ${epImgs.length > 0 ? `
                <div style="display:flex; gap:10px; margin-bottom:12px; overflow-x:auto; padding-bottom:6px;">
                  ${epImgs.map((img) => `<img src="${img.previewUrl || img.downloadUrl || ''}" alt="이미지" style="height:90px; border-radius:8px; border:1px solid #cbd5e1; object-fit:cover;">`).join('')}
                </div>
              ` : ''}
              <div style="font-size:13px; color:#334155; line-height:1.6; white-space:pre-wrap; max-height:240px; overflow-y:auto; background:#ffffff; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">${escapeHtml((ep.content || '').slice(0, 1200))}${(ep.content || '').length > 1200 ? '\n\n…(이하 생략, 상단 에디터에서 전체 확인 가능)' : ''}</div>
            </article>
          `;
        }).join('')}
      </div>
    `;

    continuousView.querySelectorAll('.switch-to-ep-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.episodeIdx, 10);
        if (!isNaN(idx)) {
          switchToEpisode(idx);
          $('#publishForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }
}

function switchToEpisode(idx) {
  if (!state.seriesEpisodes || !state.seriesEpisodes[idx]) return;
  saveCurrentEpisodeState();
  state.currentEpisodeIdx = idx;
  const ep = state.seriesEpisodes[idx];

  if ($('#postTitle')) $('#postTitle').value = ep.title || '';
  if ($('#postContent')) $('#postContent').value = ep.content || '';
  if ($('#postTags')) $('#postTags').value = (ep.tags || []).join(', ');
  if ($('#imageQuery')) $('#imageQuery').value = ep.imageQueries?.[0] || ep.title.slice(0, 20);

  state.imagePlans = ep.imagePlans || [];
  state.images = ep.autoImages || ep.images || [];
  state.selectedImages = new Set(state.images.map((_, i) => i));
  renderImages();

  renderSeriesTabs();
  updatePublishButtonLabel();
  updatePublishState();
}

$('#articleSeriesCount')?.addEventListener('change', updateSeriesEpisodeOptions);

$('#articleDraftForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const topic = $('#autoPostTopic')?.value?.trim() || '';
  const brief = $('#autoPostBrief')?.value?.trim() || '';
  if (topic.length < 2) return toast('포스팅 주제를 2자 이상 입력해주세요.', true);
  if ($('#autoPublishNow')?.checked && !state.connected) return toast('자동 발행을 사용하려면 먼저 네이버 계정을 연결해주세요.', true);

  const btn = $('#articleDraftBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> <strong>Gemini가 글과 맞춤 이미지를 만드는 중...</strong>';
  $('#llmStatus').className = 'status';
  const generationId = crypto.randomUUID();
  const stopProgress = startGenerationProgress(generationId);

  try {
    state.sourceTopic = topic;
    const tone = $('#articleTone')?.value || 'friendly';
    const length = $('#articleLength')?.value || 'medium';
    const seriesCount = parseInt($('#articleSeriesCount')?.value, 10) || 1;
    const seriesEpisode = parseInt($('#articleSeriesEpisode')?.value, 10) || 1;
    const notes = $('#articleNotes')?.value?.trim() || '';
    const model = $('#articleModelSelect')?.value || '';
    const imageStyle = $('#articleImageStyle')?.value || 'photorealistic';
    const imageModelId = $('#articleImageModelSelect')?.value || '';

    if (imageModelId && imageModelId !== activeImageModelId) {
      await api('/api/image-models/select', { method: 'POST', body: JSON.stringify({ modelId: imageModelId }) });
      activeImageModelId = imageModelId;
    }

    const payload = {
      generationId,
      topic,
      notes: [brief, notes].filter(Boolean).join('\n\n').slice(0, 3000),
      tone,
      length,
      seriesCount,
      seriesEpisode,
      model,
      imageStyle,
      writingPrompt: promptConfig?.writingPrompt || promptConfig?.systemPrompt || '',
      imagePrompt: promptConfig?.imagePrompt || promptConfig?.imagePromptInstructions || '',
      promptConfig
    };
    const data = await api('/api/blog/draft', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    stopProgress();

    state.images = data.autoImages || [];
    state.seriesEpisodes = Array.isArray(data.episodes) && data.episodes.length > 0 ? data.episodes : [data];
    state.currentEpisodeIdx = 0;
    switchToEpisode(0);

    const seriesBadge = data.seriesCount > 1 ? ` · [총 ${data.seriesCount}부작 전편 집필 완료]` : '';
    $('#draftModel').textContent = `${data.engineLabel || data.model || '💎 Google Gemini (agy)'}${seriesBadge}`;

    // Series banner display
    const seriesBanner = $('#seriesPostBanner');
    const seriesBannerTitle = $('#seriesBannerTitle');
    const seriesBannerRoadmap = $('#seriesBannerRoadmap');
    if (seriesBanner && seriesBannerTitle) {
      if (data.seriesCount > 1) {
        seriesBanner.classList.remove('hidden');
        seriesBannerTitle.textContent = `📚 [기획 연재] ${data.seriesTitle || topic} (총 ${data.seriesCount}부작 전편 완결)`;
        if (seriesBannerRoadmap) {
          const roadmapSummary = Array.isArray(data.seriesRoadmap) && data.seriesRoadmap.length
            ? data.seriesRoadmap.join(' ➔ ')
            : `총 ${data.seriesCount}부작 기획 연재`;
          seriesBannerRoadmap.textContent = roadmapSummary;
        }

        // Auto-expand all-series continuous view by default so all episodes are immediately visible
        const continuous = $('#seriesAllContinuousView');
        const toggleText = $('#toggleAllSeriesText');
        if (continuous) {
          continuous.classList.remove('hidden');
          if (toggleText) toggleText.textContent = `${data.seriesCount}부작 전편 접기 🔼`;
        }
      } else {
        seriesBanner.classList.add('hidden');
      }
    }

    if (data.sourceUrl) {
      renderPostSource({ sourceUrl: data.sourceUrl, source: '참조 뉴스/포스팅 원문' });
    } else {
      renderPostSource(null);
    }

    publishForm.classList.remove('hidden');
    $('#llmStatus').className = 'status online';
    publishForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (publishConfirm) publishConfirm.checked = Boolean($('#autoPublishNow')?.checked);
    updatePublishState();
    if ($('#autoPublishNow')?.checked) {
      setAutoPostProgress('3/3 생성된 글과 이미지를 네이버 블로그에 발행하고 있습니다…');
      const result = await publishCurrentDraft();
      if (result?.status === 'published') setAutoPostProgress('완료: 네이버 블로그에 자동 포스팅했습니다.', 'complete');
      else setAutoPostProgress('네이버 발행 창이 열렸습니다. 화면에서 최종 상태를 확인해주세요.');
    } else {
      setAutoPostProgress('완료: 글과 이미지가 준비됐습니다. 아래에서 검토 후 발행할 수 있습니다.', 'complete');
      toast(data.seriesCount > 1
        ? `✨ [총 ${data.seriesCount}부작] 전편 글과 맞춤 이미지가 준비되었습니다! 회차별 탭을 클릭하여 확인하세요.`
        : `✨ [${data.engineLabel || data.model}] 글과 맞춤 이미지 생성이 완료되었습니다!`);
    }
  } catch (error) {
    stopProgress();
    $('#llmStatus').className = 'status';
    setAutoPostProgress(`오류 발생\n${error.message}`, 'error');
    toast(`AI 자동 포스팅 실패: ${error.message}`, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">✨</span> <strong>Gemini (agy) 글 작성 + 맞춤 이미지 자동 생성</strong>';
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

$('#toggleAllSeriesViewBtn')?.addEventListener('click', () => {
  const continuous = $('#seriesAllContinuousView');
  const text = $('#toggleAllSeriesText');
  if (!continuous) return;
  const isHidden = continuous.classList.contains('hidden');
  if (isHidden) {
    continuous.classList.remove('hidden');
    if (text) text.textContent = '3부작 전편 접기 🔼';
    continuous.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    continuous.classList.add('hidden');
    if (text) text.textContent = '3부작 전편 한번에 펼쳐보기';
  }
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
      const isAi = image.isAiGenerated || image.license?.includes('Gemini') || image.license?.includes('Imagen') || image.license?.includes('Gemma');
      const cardBorder = isAi ? 'border: 2px solid #3b82f6; background: #eff6ff;' : 'border: 2px solid #10b981; background: #f0fdf4;';
      return `
      <label class="image-card${state.selectedImages.has(index) ? ' selected' : ''}${isAi ? ' ai-card' : ' real-photo-card'}" data-image-index="${index}" style="${cardBorder}">
        <input type="checkbox" value="${escapeHtml(image.id)}" aria-label="${escapeHtml(image.title)} 선택"${state.selectedImages.has(index) ? ' checked' : ''}>
        <img src="${escapeHtml(image.previewUrl)}" alt="${escapeHtml(image.description || image.title)}" loading="lazy" style="object-fit:cover; border-radius:6px;">
        <span>
          ${isAi
            ? `<div style="color:#1d4ed8; font-size:11px; font-weight:800; margin-bottom:2px;">💎 Gemini AI 맞춤 그림</div>`
            : `<div style="color:#059669; font-size:11px; font-weight:800; margin-bottom:2px;">📸 고화질 실사 포토 (1280px)</div>`}
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
  const publishAllBtn = $('#publishAllSeriesBtn');
  if (publishAllBtn) {
    publishAllBtn.disabled = !ready;
  }
  $('#publishHelp')?.classList.toggle('hidden', state.connected);
}

function resetPublishedPostWorkspace() {
  state.images = [];
  state.selectedImages.clear();
  state.imagePlans = [];
  state.sourceTopic = '';
  state.selectedTrend = null;
  state.seriesEpisodes = [];
  state.currentEpisodeIdx = 0;

  ['#postTitle', '#postContent', '#postTags', '#imageQuery'].forEach((selector) => {
    const field = $(selector);
    if (field) field.value = '';
  });
  $('#articleDraftForm')?.reset();
  $('#topicInputFields')?.classList.remove('hidden');
  $('#linkInputFields')?.classList.add('hidden');
  $('#seriesEpisodeTabsBar')?.classList.add('hidden');
  $('#seriesPostBanner')?.classList.add('hidden');
  renderImages();
  publishForm?.classList.add('hidden');
  if (publishConfirm) publishConfirm.checked = false;
  setAutoPostProgress('');
  updatePublishState();
  $('#articleDraftForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function publishCurrentDraft() {
  if (!state.connected) {
    updatePublishState();
    throw new Error('네이버 계정 연결이 필요합니다.');
  }
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
        sourceTopic: state.sourceTopic,
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

      if (state.seriesEpisodes && state.seriesEpisodes[state.currentEpisodeIdx]) {
        state.seriesEpisodes[state.currentEpisodeIdx].isPublished = true;
        renderSeriesTabs();
      }

      const nextIdx = state.currentEpisodeIdx + 1;
      if (state.seriesEpisodes && nextIdx < state.seriesEpisodes.length) {
        toast(`🎉 [제${state.currentEpisodeIdx + 1}편]이 네이버 블로그에 성공적으로 발행되었습니다! 다음 [제${nextIdx + 1}편]으로 전환합니다.`);
        switchToEpisode(nextIdx);
        publishForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast('🎉 네이버 블로그에 포스팅이 성공적으로 완료되었습니다!');
        resetPublishedPostWorkspace();
      }
    } else {
      toast(data.message || '열린 네이버 창에서 발행 상태를 확인해주세요.', true);
    }
    return data;
  } catch (error) {
    if (error.message.includes('로그인 세션이 만료')) setConnected(false);
    throw error;
  } finally {
    updatePublishButtonLabel();
    updatePublishState();
  }
}

publishForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await publishCurrentDraft();
  } catch (error) {
    toast(error.message, true);
  }
});

$('#publishAllSeriesBtn')?.addEventListener('click', async () => {
  if (!state.connected) return toast('자동 발행을 사용하려면 먼저 네이버 계정을 연결해주세요.', true);
  if (!publishConfirm?.checked) return toast('발행 동의 체크박스를 선택해주세요.', true);
  const episodes = state.seriesEpisodes || [];
  if (episodes.length <= 1) return;

  const btn = $('#publishAllSeriesBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🚀 순차 자동 발행 진행 중...';
  }

  try {
    for (let i = 0; i < episodes.length; i += 1) {
      switchToEpisode(i);
      toast(`[제${i + 1}편/${episodes.length}편] 네이버 블로그에 발행을 시작합니다...`);
      await publishCurrentDraft();
      if (i < episodes.length - 1) {
        toast(`[제${i + 1}편 발행 완료] 다음 편 발행 대기 중 (4초)...`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    toast(`🎉 [총 ${episodes.length}부작] 모든 회차가 네이버 블로그에 성공적으로 발행되었습니다!`);
  } catch (err) {
    toast(`순차 발행 중 오류: ${err.message}`, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      updatePublishButtonLabel();
    }
  }
});

$('#generateEpisodeImagesBtn')?.addEventListener('click', async () => {
  const currentEp = state.seriesEpisodes[state.currentEpisodeIdx] || {
    title: $('#postTitle')?.value,
    content: $('#postContent')?.value,
    imagePlans: state.imagePlans
  };
  const btn = $('#generateEpisodeImagesBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🎨 AI 이미지 생성 중...';
  }
  try {
    const imageStyle = $('#articleImageStyle')?.value || 'photorealistic';
    const res = await api('/api/blog/series/generate-images', {
      method: 'POST',
      body: JSON.stringify({
        episodePost: currentEp,
        imageStyle,
        imagePrompt: promptConfig?.imagePrompt || ''
      })
    });
    if (res.images && res.images.length > 0) {
      state.images = res.images;
      state.selectedImages = new Set(state.images.map((_, i) => i));
      if (state.seriesEpisodes[state.currentEpisodeIdx]) {
        state.seriesEpisodes[state.currentEpisodeIdx].images = res.images;
        state.seriesEpisodes[state.currentEpisodeIdx].autoImages = res.images;
      }
      renderImages();
      toast(`제${state.currentEpisodeIdx + 1}편 맞춤 이미지 ${res.images.length}장이 생성되었습니다!`);
    } else {
      toast('이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.', true);
    }
  } catch (err) {
    toast(`이미지 생성 실패: ${err.message}`, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🎨 이 회차 맞춤 AI 이미지 생성';
    }
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

  const targetCount = Number($('#targetCount')?.value) || 50;
  const minDelay = Number($('#minDelay')?.value) || 45;
  const maxDelay = Number($('#maxDelay')?.value) || 90;
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
let activeImageModelId = 'pollinations';
let imageModelRefreshTimer = null;

function updateLocalAiSummaryUI(activeModel, activeEndpoint, geminiInfo) {
  const globalStatus = $('#globalEngineStatusText');
  const summaryModel = $('#summaryModelName');
  const summaryEndpoint = $('#summaryEndpointUrl');
  const currentBadge = $('#currentEngineBadge');
  const activePill = $('#activeAiStatusPill');
  const summaryEngineType = $('#summaryEngineType');

  const modelName = activeModel?.name || activeEndpoint?.label || 'Gemini 3.8 Flash (High)';
  if (summaryEngineType) summaryEngineType.textContent = '💎 Google Gemini (agy CLI 연동)';
  if (summaryModel) summaryModel.textContent = modelName;
  if (summaryEndpoint) summaryEndpoint.textContent = '초고속 3초 (클라우드 가속)';
  if (globalStatus) {
    globalStatus.textContent = `💎 Google Gemini (${modelName.replace(/\s*\(.*?\)/, '')})`;
    globalStatus.style.color = '#1d4ed8';
  }
  if (currentBadge) {
    currentBadge.className = 'pill pill-blue';
    currentBadge.textContent = `💎 ${modelName}`;
  }
  if (activePill) {
    activePill.className = 'pill pill-blue';
    activePill.textContent = '구독 연동 · PC 부하 0% · 초고속';
  }
  if ($('#llmStatus')) {
    $('#llmStatus').className = 'status online';
    $('#llmStatus').innerHTML = `<i></i> 💎 ${escapeHtml(modelName)}`;
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
    const specs = await api('/api/hardware/specs').catch(() => ({}));
    currentHardwareSpecs = specs;

    const gpuNameText = 'Google Cloud TPU / GPU';
    if ($('#gpuSpecBadge')) $('#gpuSpecBadge').innerHTML = `💎 ${escapeHtml(gpuNameText)}`;
    if ($('#localGpuSummaryText')) {
      $('#localGpuSummaryText').innerHTML = `💎 <strong>Google Gemini (agy 연동)</strong> 가동 중 · 구독 중인 클라우드 가속으로 PC 부하 없이 초고속 작성`;
    }

    if ($('#hardwareRecommendText')) {
      $('#hardwareRecommendText').innerHTML = `구독 중인 <strong>[💎 Google Gemini (agy 연동)]</strong> 엔진을 사용합니다. PC 사양(VRAM)과 무관하게 3초 만에 글과 이미지를 완성합니다.`;
    }

    const modelsRes = await api('/api/models/list').catch(() => null);
    if (modelsRes) {
      currentModelsList = modelsRes.models || [];
      activeModelId = modelsRes.activeModel?.id || 'gemini-3.8-flash-high';

      renderModelCards(modelsRes.models, activeModelId, '#settingsAiModelCardsGrid');
      updateLocalAiSummaryUI(modelsRes.activeModel, settings?.activeEndpoint, settings?.geminiInfo);

      // Synchronize global select dropdowns
      $$('.ai-model-global-select').forEach((sel) => {
        if (!sel) return;
        sel.replaceChildren();
        (modelsRes.models || []).forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = `💎 ${m.name}`;
          opt.selected = (m.id === activeModelId);
          sel.append(opt);
        });
      });
    }
  } catch (err) {
    console.error('Failed to init hardware specs:', err);
  }
}

async function initImageModels() {
  try {
    const result = await api('/api/image-models/list');
    const models = result.models || [];
    activeImageModelId = result.activeModel?.id || 'gemini-imagen';
    renderImageModelCards(models);
    const badge = $('#currentImageEngineBadge');
    if (badge) badge.textContent = result.activeModel?.name || 'Google Imagen (agy 연동)';
    $$('.image-model-global-select').forEach((select) => {
      select.replaceChildren();
      models.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `💎 ${model.name}`;
        option.selected = (model.id === activeImageModelId);
        select.append(option);
      });
    });
  } catch (err) {
    console.error('Failed to load image models:', err);
  }
}

function renderImageModelCards(models) {
  const container = $('#settingsImageModelCardsGrid');
  if (!container) return;
  container.innerHTML = (models || []).map((model) => {
    const active = model.isActive;
    const status = active ? '✓ 사용 중' : '사용 가능';
    const button = active
      ? '<button type="button" class="button small" disabled style="background:#2563eb; color:#fff; font-weight:700;">✓ 활성화됨</button>'
      : `<button type="button" class="button small primary image-model-action" data-action="select" data-id="${escapeHtml(model.id)}">이 모델 사용</button>`;
    return `<div class="ai-model-card ${active ? 'active-model' : ''}" data-image-model="${escapeHtml(model.id)}" style="border: 2px solid ${active ? '#3b82f6' : '#e2e8f0'}; background:${active ? '#eff6ff' : '#ffffff'};">
      <div class="model-card-header">
        <div>
          <strong style="color:#1e3a8a; font-size:14.5px;">💎 ${escapeHtml(model.name)}</strong>
          <span class="model-badge-sub" style="color:#2563eb; font-weight:600;">클라우드 AI · 고화질 이미지</span>
        </div>
        <span class="pill ${active ? 'pill-blue' : ''}">${status}</span>
      </div>
      <p class="model-card-desc" style="color:#4b5563;">${escapeHtml(model.description || '')}</p>
      <div class="model-card-footer" style="display:flex; justify-content:space-between; align-items:center;">
        <span class="model-vram-hint" style="color:#059669; font-weight:700;">⚡ PC 부하 0% · 클라우드 생성</span>
        ${button}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.image-model-action').forEach((button) => {
    button.addEventListener('click', async () => {
      const { id: modelId } = button.dataset;
      try {
        button.disabled = true;
        button.textContent = '적용 중…';
        await api('/api/image-models/select', { method: 'POST', body: JSON.stringify({ modelId }) });
        toast(`이미지 생성 모델을 [${modelId}]로 설정했습니다.`);
        await initImageModels();
      } catch (err) {
        button.disabled = false;
        toast(err.message, true);
      }
    });
  });
}

function renderModelCards(models, activeId, containerSelector = '#settingsAiModelCardsGrid') {
  const container = $(containerSelector);
  if (!container) return;

  const geminiModels = (models && models.length > 0) ? models : [
    { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', desc: '구독 연동 · 권장 기본 / 3초 초고속 생성 및 최고 지능', isDefault: true },
    { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)', desc: '구독 연동 · 안정적인 고성능 플래시 모델' },
    { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)', desc: '구독 연동 · 고난도 심층 분석 및 칼럼' }
  ];

  container.innerHTML = geminiModels.map((m) => {
    const isSelected = (m.id === activeId || (!activeId && m.isDefault));
    return `
      <div class="ai-model-card ${isSelected ? 'active-model' : ''}" style="border: 2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}; background:${isSelected ? '#eff6ff' : '#ffffff'};">
        <div class="model-card-header">
          <div>
            <strong style="color:#1e3a8a; font-size:14.5px;">💎 ${escapeHtml(m.name)}</strong>
            <span class="model-badge-sub" style="color:#2563eb; font-weight:600;">Google Gemini (구독 연동) · 클라우드</span>
          </div>
          <span class="pill ${isSelected ? 'pill-blue' : ''}">${isSelected ? '✓ 현재 사용 중' : '사용 가능'}</span>
        </div>
        <p class="model-card-desc" style="color:#4b5563;">${escapeHtml(m.desc || m.description || '')}</p>
        <div class="model-card-footer" style="display:flex; justify-content:space-between; align-items:center;">
          <span class="model-vram-hint" style="color:#059669; font-weight:700;">⚡ VRAM 0MB · 초고속 3초</span>
          ${isSelected
            ? '<button type="button" class="button small" disabled style="background:#3b82f6; color:#fff; font-weight:700;">✓ 활성화됨</button>'
            : `<button type="button" class="button small primary gemini-select-btn" data-model="${escapeHtml(m.id)}">이 모델로 시작</button>`}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.gemini-select-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.model;
      try {
        btn.disabled = true;
        btn.textContent = '설정 중…';
        await api('/api/models/select', {
          method: 'POST',
          body: JSON.stringify({ modelId })
        });
        toast(`💎 Gemini 엔진이 [${modelId}]로 설정되었습니다.`);
        await initAiHardwareAndModels();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
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
  $$('.eng-chips button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#engKeyword');
      if (input) input.value = btn.textContent.trim();
    });
  });

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

    const targetCount = Number($('#engTargetCount')?.value) || 50;
    const doLike = $('#engDoLike')?.checked ?? true;
    const doComment = $('#engDoComment')?.checked ?? true;
    const doNeighbor = $('#engDoNeighbor')?.checked ?? true;
    const neighborMessage = $('#engNeighborMessage')?.value?.trim() || '안녕하세요! 포스팅 잘 보고 갑니다. 좋은 이웃으로 소통하고 지내요 😊';
    const tone = $('#engTone')?.value || 'friendly';
    const minDelay = Number($('#engMinDelay')?.value) || 45;
    const maxDelay = Number($('#engMaxDelay')?.value) || 90;

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
      toast(`'${keyword}' 키워드로 공감, AI 댓글 및 서로이웃 소통을 시작합니다!`);
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
    if (isRunning) statusEl.textContent = `🚀 '${config.keyword || ''}' AI 공감, 댓글 및 서로이웃 소통 진행 중...`;
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
updateSeriesEpisodeOptions();
api('/api/health').then(async (data) => {
  initSettingsController();
  initAiHardwareAndModels();
  initImageModels();
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
  initImageModels();
  initEngagementAutomation();
});
