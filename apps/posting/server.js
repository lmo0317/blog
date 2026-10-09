import express from 'express';
import { createWebAuth } from './lib/web-auth.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import sharp from 'sharp';
import { NaverBrowserSession } from './lib/naver.js';
import { DEFAULT_PROMPT_CONFIG } from './lib/llm.js';
import { fetchKoreanTrends } from './lib/trends.js';
import { fetchAlgumonRankDeals, isDirectProductUrl, unwrapKnownRedirectUrl } from './lib/algumon.js';
import { appendImageAttributions, cleanupDownloadedImages, downloadCommonsImages, searchOpenImages } from './lib/images.js';
import { extractArticleContent } from './lib/article-scraper.js';
import { NeighborHistoryStore, EngagementHistoryStore } from './lib/history.js';
import { NeighborAutomationManager } from './lib/automation.js';
import { EngagementAutomationManager } from './lib/engagement-automation.js';
import { renderVisualCardsForPost, renderVisualCardToPng } from './lib/visual-renderer.js';
import { generateAiDrawingsForPost, generateAiDrawing, AI_IMAGE_STYLES } from './lib/ai-image-generator.js';
import { discoverGoldenKeywords, analyzeSingleKeyword } from './lib/golden-keyword.js';
import { OneShotPostingManager } from './lib/oneshot.js';
import { ImageModelManager } from './lib/image-model-manager.js';
import { contentSimilarity, PostHistoryStore } from './lib/post-history.js';
import { AgyClient, AGY_GEMINI_MODELS } from './lib/agy-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(__dirname, '.env'))) loadEnvFile(path.join(__dirname, '.env'));
const app = express();
const port = Number(process.env.PORT || 4310);

const agyClient = new AgyClient();
const imageModelManager = new ImageModelManager({
  engineDir: path.join(__dirname, '.image-engine'),
  configPath: path.join(__dirname, '.data', 'image-config.json')
});
await imageModelManager.init();
imageModelManager.agyClient = agyClient;
const postHistoryStore = new PostHistoryStore(path.join(__dirname, '.data', 'published-post-history.json'));

const browserSession = new NaverBrowserSession({
  headless: String(process.env.NAVER_HEADLESS).toLowerCase() === 'true',
  profileDir: path.join(__dirname, '.playwright', 'naver-profile'),
  sessionStatePath: path.join(__dirname, '.playwright', 'naver-session.json')
});
const historyStore = new NeighborHistoryStore(path.join(__dirname, '.data', 'neighbor-history.json'));
const automationManager = new NeighborAutomationManager({ browserSession, historyStore });

const engagementHistoryStore = new EngagementHistoryStore(path.join(__dirname, '.data', 'engagement-history.json'));
const engagementManager = new EngagementAutomationManager({ browserSession, agyClient, historyStore: engagementHistoryStore });

function normalizePromptConfig(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('프롬프트 설정은 올바른 객체 형식이어야 합니다.');
  const writingPrompt = String(value.writingPrompt || value.systemPrompt || '').trim();
  const imagePrompt = String(value.imagePrompt || value.imagePromptInstructions || '').trim();
  const userPromptTemplate = String(value.userPromptTemplate || '').trim();
  if (writingPrompt && (writingPrompt.length < 10 || writingPrompt.length > 20000)) throw new Error('글생성 프롬프트는 10~20,000자로 입력해주세요.');
  if (imagePrompt && imagePrompt.length > 10000) throw new Error('이미지 생성 프롬프트는 10,000자 이하로 입력해주세요.');
  return {
    writingPrompt,
    imagePrompt,
    systemPrompt: writingPrompt,
    imagePromptInstructions: imagePrompt,
    userPromptTemplate: userPromptTemplate || undefined
  };
}

let selectedGeminiModel = 'gemini-3.8-flash-high';

async function resolveActiveLlmEndpoint() {
  const isAgy = await agyClient.isAvailable();
  const modelObj = agyClient.getModels().find((m) => m.id === selectedGeminiModel) || agyClient.getModels()[0];
  return {
    type: 'gemini_agy',
    label: `💎 Google Gemini (${modelObj.name})`,
    model: modelObj.id,
    provider: 'Google Antigravity (구독 연동)',
    baseUrl: 'https://antigravity.google',
    isAvailable: isAgy
  };
}

browserSession.restoreSession().then((res) => {
  if (res?.connected) console.log('Naver session automatically restored on server startup.');
}).catch(() => {});
setInterval(() => {
  browserSession.keepAlive().catch(() => {});
}, 20 * 60 * 1000).unref();
let publishing = false;
let trendCache = { loadedAt: 0, items: [] };
const generationProgress = new Map();

function setGenerationProgress(id, update) {
  if (!id) return;
  const previous = generationProgress.get(id) || { startedAt: Date.now() };
  generationProgress.set(id, { ...previous, ...update, updatedAt: Date.now() });
}

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, progress] of generationProgress) {
    if ((progress.updatedAt || 0) < cutoff) generationProgress.delete(id);
  }
}, 10 * 60 * 1000).unref();

app.disable('x-powered-by');
// Web build only (APP_PASSWORD set): every page and API call needs the password first.
const webAuth = createWebAuth({ cookieName: 'nm_posting_auth', title: '블로그 자동 포스팅' });
if (webAuth) app.use(webAuth);
// SSE through the hub's nginx would otherwise be buffered until the stream ends.
app.use((_req, res, next) => { res.setHeader('X-Accel-Buffering', 'no'); next(); });

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
// Photo uploads carry one resized photo as a data URL, so they get a larger body limit.
app.use('/api/blog/photo-upload', express.json({ limit: '15mb' }));
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const imagesStorageDir = path.join(__dirname, '.images');
const thumbsStorageDir = path.join(imagesStorageDir, '.thumbs');

app.get('/generated-images/thumb/:filename', async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const originalPath = path.join(imagesStorageDir, filename);
    if (!existsSync(originalPath)) return res.status(404).send('Image not found');

    const thumbPath = path.join(thumbsStorageDir, filename);
    if (!existsSync(thumbPath)) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(thumbsStorageDir, { recursive: true });
      await sharp(originalPath)
        .resize({ width: 360, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(thumbPath);
    }

    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(thumbPath);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (err) {
    try {
      const { readFile } = await import('node:fs/promises');
      const originalPath = path.join(imagesStorageDir, path.basename(req.params.filename));
      if (existsSync(originalPath)) {
        const buffer = await readFile(originalPath);
        res.setHeader('Content-Type', 'image/jpeg');
        return res.send(buffer);
      }
    } catch {}
    res.status(404).send('Image not found');
  }
});

app.use('/generated-images', express.static(imagesStorageDir, { etag: false, maxAge: 0 }));

// NAVER_LOGIN_MODE=qr (the 112 web build): only Naver QR login is allowed. A program typing the ID and password
// on a server browser looks like credential stuffing to Naver and gets the account locked (보호조치).
const qrOnlyLogin = String(process.env.NAVER_LOGIN_MODE || '').toLowerCase() === 'qr';

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, connected: browserSession.connected, loginMode: qrOnlyLogin ? 'qr' : 'all' });
});

app.post(['/api/naver/login', '/api/naver/open-login', '/api/naver/open-login-window'], (_req, res, next) => {
  if (!qrOnlyLogin) return next();
  res.status(403).json({ error: '이 서버에서는 계정 보호를 위해 QR 로그인만 사용합니다. [QR로 로그인]을 눌러 휴대폰 네이버 앱으로 로그인해 주세요.' });
});

app.get('/api/blog/generation-status/:id', (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return res.status(400).json({ error: '잘못된 작업 ID입니다.' });
  res.json(generationProgress.get(id) || { status: 'waiting', message: '생성 작업 시작을 기다리는 중' });
});

app.post('/api/naver/login', async (req, res, next) => {
  let { id = '', password = '' } = req.body || {};
  try {
    id = String(id).trim();
    password = String(password);
    if (!id || !password || id.length > 80 || password.length > 200) {
      return res.status(400).json({ error: '아이디와 비밀번호를 정확히 입력해주세요.' });
    }
    const result = await browserSession.loginWithCredentials(id, password);
    res.json(result);
  } catch (error) {
    next(error);
  } finally {
    id = '';
    password = '';
    if (req.body) req.body.password = '';
  }
});

app.get('/api/naver/qr', async (_req, res, next) => {
  try {
    res.json(await browserSession.getQrCode());
  } catch (error) {
    next(error);
  }
});

app.get('/api/naver/qr/status', async (_req, res, next) => {
  try {
    res.json(await browserSession.checkQrLoginStatus());
  } catch (error) {
    next(error);
  }
});

app.post('/api/naver/cookies', async (req, res, next) => {
  try {
    res.json(await browserSession.setSessionCookies(req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/naver/check', async (_req, res, next) => {
  try {
    res.json(await browserSession.checkConnection());
  } catch (error) {
    next(error);
  }
});

app.post('/api/naver/open-login', async (_req, res, next) => {
  try {
    res.json(await browserSession.openLoginPage());
  } catch (error) {
    next(error);
  }
});

app.post('/api/naver/restore', async (_req, res, next) => {
  try {
    res.json(await browserSession.restoreSession());
  } catch (error) {
    next(error);
  }
});

app.post('/api/naver/open-login-window', async (_req, res, next) => {
  try {
    const result = await browserSession.openLoginWindow();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/naver/inject-cookies', async (req, res, next) => {
  try {
    const { nidAut, nidSes } = req.body || {};
    const result = await browserSession.injectCookies(nidAut, nidSes);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/neighbors/summary', async (_req, res, next) => {
  try {
    const summary = await historyStore.getSummary();
    res.json({
      ...summary,
      connected: browserSession.connected,
      autoState: automationManager.state
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/search', async (req, res, next) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (query.length < 2 || query.length > 100) {
      return res.status(400).json({ error: '검색 카테고리 또는 키워드를 2~100자로 입력해주세요.' });
    }
    const activeWithinDays = Number(req.body?.activeWithinDays) || 0;
    const display = Math.min(Math.max(Number(req.body?.display) || 30, 1), 100);

    const rawItems = await browserSession.searchBlogs({
      query,
      display,
      activeWithinDays
    });

    const items = [];
    for (const item of rawItems) {
      const hasHistory = await historyStore.hasHistory(item.blogId);
      const existing = hasHistory ? await historyStore.getExistingRecord(item.blogId) : null;
      items.push({
        ...item,
        hasHistory,
        historyStatus: existing?.status || null,
        historyStatusText: existing?.statusText || null
      });
    }

    res.json({ query, items, total: items.length });
  } catch (error) {
    next(error);
  }
});

// Automation Control Endpoints
app.get('/api/neighbors/auto/status', (_req, res) => {
  res.json(automationManager.getStatus());
});

app.get('/api/neighbors/auto/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendStatus = (status) => {
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
  };

  const sendLog = (log) => {
    res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
  };

  sendStatus(automationManager.getStatus());

  automationManager.on('status', sendStatus);
  automationManager.on('log', sendLog);

  req.on('close', () => {
    automationManager.off('status', sendStatus);
    automationManager.off('log', sendLog);
  });
});

app.post('/api/neighbors/auto/start', async (req, res, next) => {
  try {
    const { keyword, targetCount, message, minDelay, maxDelay, activeWithinDays } = req.body || {};
    const status = await automationManager.start({
      keyword,
      targetCount,
      message,
      minDelay,
      maxDelay,
      activeWithinDays
    });
    res.json(status);
  } catch (error) {
    next(error);
  }
});

app.post('/api/neighbors/auto/pause', (_req, res) => {
  res.json(automationManager.pause());
});

app.post('/api/neighbors/auto/resume', (_req, res) => {
  res.json(automationManager.resume());
});

app.post('/api/neighbors/auto/stop', (_req, res) => {
  res.json(automationManager.stop());
});

// History Endpoints
app.get('/api/neighbors/history', async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    const keyword = String(req.query?.keyword || '').trim();
    const status = String(req.query?.status || '').trim();

    const data = await historyStore.getRecords({ page, limit, keyword, status });
    const summary = await historyStore.getSummary();
    res.json({ ...data, summary });
  } catch (error) {
    next(error);
  }
});

app.get('/api/neighbors/history/export', async (_req, res, next) => {
  try {
    const csv = await historyStore.exportCsv();
    const filename = `neighbor_history_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

app.post('/api/neighbors/history/clear', async (_req, res, next) => {
  try {
    await historyStore.clear();
    res.json({ ok: true, message: '서로이웃 신청 이력이 초기화되었습니다.' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Google Gemini & Cloud AI Engine Routes
// ---------------------------------------------------------------------------

app.get('/api/hardware/specs', (_req, res) => {
  res.json({
    engine: 'gemini',
    type: 'cloud',
    name: 'Google Gemini (구독 연동)',
    status: 'online',
    gpu: {
      primaryGpu: { name: 'Google Cloud TPU/GPU' },
      vramFormatted: '클라우드 가속 (내 PC 부하 0%)'
    },
    recommendedModel: {
      id: 'gemini-3.8-flash-high',
      modelInfo: { name: 'Gemini 3.8 Flash (High)' }
    }
  });
});

app.get('/api/models/list', async (_req, res, next) => {
  try {
    const models = agyClient.getModels().map((m) => ({
      id: m.id,
      name: m.name,
      sizeFormatted: '구독 연동',
      description: m.desc,
      speed: m.speed,
      quality: m.quality,
      isInstalled: true,
      isActive: m.id === selectedGeminiModel
    }));
    const active = models.find((m) => m.id === selectedGeminiModel) || models[0];
    res.json({ models, activeModel: active, serverStatus: 'running', provider: 'gemini' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/models/download', async (_req, res) => {
  res.json({ ok: true, message: 'Google Gemini는 구독 연동 클라우드 모델로 별도 다운로드가 필요 없습니다.' });
});

app.post('/api/models/cancel', async (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/models/delete', async (_req, res) => {
  res.json({ ok: true, message: '클라우드 모델은 삭제할 수 없습니다.' });
});

app.post('/api/models/select', async (req, res, next) => {
  try {
    const { modelId } = req.body || {};
    const valid = agyClient.getModels().find((m) => m.id === modelId);
    if (!valid) return res.status(400).json({ error: '선택할 수 없는 Gemini 모델입니다.' });
    selectedGeminiModel = modelId;
    agyClient.defaultModel = modelId;
    const activeEndpoint = await resolveActiveLlmEndpoint();
    res.json({ ok: true, model: valid, engineMode: 'gemini_agy', activeEndpoint });
  } catch (error) {
    next(error);
  }
});

app.get('/api/image-models/list', async (_req, res, next) => {
  try {
    const models = await imageModelManager.list();
    res.json({ models, activeModelId: imageModelManager.activeModelId, activeModel: models.find((model) => model.isActive) || null });
  } catch (error) { next(error); }
});

app.post('/api/image-models/select', async (req, res, next) => {
  try { res.json({ ok: true, model: await imageModelManager.select(String(req.body?.modelId || '')) }); } catch (error) { next(error); }
});

app.post('/api/image-models/download', async (req, res) => {
  res.json({ ok: true, message: '클라우드 이미지 모델은 다운로드가 필요 없습니다.' });
});

app.get('/api/image-models/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 5000\n\n');
  const timer = setInterval(() => res.write(': keepalive\n\n'), 20000);
  req.on('close', () => clearInterval(timer));
});

// Common Settings & LLM Endpoints
app.get('/api/settings', async (_req, res, next) => {
  try {
    const isAgy = await agyClient.isAvailable();
    const activeEndpoint = await resolveActiveLlmEndpoint();
    const geminiModels = agyClient.getModels();
    const activeModel = geminiModels.find((m) => m.id === selectedGeminiModel) || geminiModels[0];
    res.json({
      connected: browserSession.connected,
      accountLabel: browserSession.accountLabel || '',
      engineMode: 'gemini_agy',
      activeModel: {
        id: activeModel.id,
        name: activeModel.name,
        sizeFormatted: '구독 연동',
        isInstalled: true
      },
      installedCount: geminiModels.length,
      activeEndpoint,
      geminiInfo: {
        available: isAgy,
        activeModel: selectedGeminiModel,
        models: geminiModels
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/engine-mode', async (req, res, next) => {
  try {
    const { modelId } = req.body || {};
    if (modelId && agyClient.getModels().some((m) => m.id === modelId)) {
      selectedGeminiModel = modelId;
      agyClient.defaultModel = modelId;
    }
    const activeEndpoint = await resolveActiveLlmEndpoint();
    res.json({ ok: true, engineMode: 'gemini_agy', activeEndpoint });
  } catch (error) {
    next(error);
  }
});

app.get('/api/models/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('retry: 5000\n\n');
  const timer = setInterval(() => res.write(': keepalive\n\n'), 20000);
  req.on('close', () => clearInterval(timer));
});

// ---------------------------------------------------------------------------
// Engagement (Like & AI Comment) Routes
// ---------------------------------------------------------------------------

app.get('/api/engagement/status', (_req, res) => {
  res.json(engagementManager.getStatus());
});

app.get('/api/engagement/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('retry: 2000\n\n');

  const onStatus = (status) => {
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
  };
  const onLog = (log) => {
    res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
  };

  engagementManager.on('status', onStatus);
  engagementManager.on('log', onLog);

  res.write(`event: status\ndata: ${JSON.stringify(engagementManager.getStatus())}\n\n`);

  req.on('close', () => {
    engagementManager.off('status', onStatus);
    engagementManager.off('log', onLog);
  });
});

app.post('/api/engagement/start', async (req, res, next) => {
  try {
    const result = await engagementManager.start(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/engagement/pause', (_req, res, next) => {
  try {
    const success = engagementManager.pause();
    res.json({ ok: success, state: engagementManager.state });
  } catch (error) {
    next(error);
  }
});

app.post('/api/engagement/resume', (_req, res, next) => {
  try {
    const success = engagementManager.resume();
    res.json({ ok: success, state: engagementManager.state });
  } catch (error) {
    next(error);
  }
});

app.post('/api/engagement/stop', (_req, res, next) => {
  try {
    const success = engagementManager.stop();
    res.json({ ok: success, state: engagementManager.state });
  } catch (error) {
    next(error);
  }
});

app.get('/api/engagement/history', async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    const keyword = String(req.query?.keyword || '').trim();
    const status = String(req.query?.status || '').trim();
    const result = await engagementHistoryStore.getRecords({ page, limit, keyword, status });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/engagement/summary', async (_req, res, next) => {
  try {
    const summary = await engagementHistoryStore.getSummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

app.get('/api/engagement/history/csv', async (_req, res, next) => {
  try {
    const csv = await engagementHistoryStore.exportCsv();
    const filename = `engagement-history-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/engagement/history', async (_req, res, next) => {
  try {
    await engagementHistoryStore.clear();
    res.json({ ok: true, message: '공감/댓글 소통 이력이 초기화되었습니다.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/neighbors/open', async (req, res, next) => {
  try {
    const blogIds = [...new Set((req.body?.blogIds || []).map(String))].slice(0, 5);
    if (!blogIds.length) return res.status(400).json({ error: '대상 블로그를 선택해주세요.' });
    const results = [];
    for (const blogId of blogIds) {
      results.push(await browserSession.openNeighborForm(blogId));
    }
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.post('/api/neighbors/add', async (req, res, next) => {
  try {
    const targets = Array.isArray(req.body?.targets)
      ? req.body.targets
      : (req.body?.blogIds || []).map((id) => ({ blogId: id, bloggerName: '' }));
    
    if (!targets.length) return res.status(400).json({ error: '대상 블로그를 선택해주세요.' });
    const message = String(req.body?.message || '').trim();
    if (message.length < 2 || message.length > 300) {
      return res.status(400).json({ error: '서로이웃 신청 메시지를 2~300자로 입력해주세요.' });
    }
    const keyword = String(req.body?.keyword || '').trim();
    const results = [];

    for (const target of targets.slice(0, 20)) {
      const blogId = typeof target === 'string' ? target : target.blogId;
      const bloggerName = typeof target === 'object' ? target.bloggerName : '';
      const result = await browserSession.addNeighbor(blogId, message, bloggerName);
      
      await historyStore.addRecord({
        blogId,
        bloggerName: result.bloggerName || bloggerName,
        keyword,
        message,
        status: result.status,
        statusText: result.message
      });

      results.push(result);
      if (result.status === 'verification_required' || result.status === 'limit_reached') break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/trends', async (_req, res, next) => {
  try {
    const cacheAge = Date.now() - trendCache.loadedAt;
    if (!trendCache.items.length || cacheAge > 5 * 60 * 1000) {
      trendCache = { loadedAt: Date.now(), items: await fetchKoreanTrends({ limit: 12 }) };
    }
    res.json({ items: trendCache.items, refreshedAt: new Date(trendCache.loadedAt).toISOString() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/deals', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 5, 1), 10);
    const forceRefresh = String(req.query?.refresh).toLowerCase() === 'true';
    const candidates = await fetchAlgumonRankDeals({ limit: Math.max(limit * 3, 15), forceRefresh });
    const deals = candidates.map(normalizePublishableDeal).filter(Boolean).slice(0, limit);
    if (!deals.length) throw new Error('실제 판매 상품 링크가 확인된 핫딜을 찾지 못했습니다. 잠시 후 다시 시도해주세요.');
    res.json({ deals, fetchedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/blog/deals/draft', async (req, res, next) => {
  try {
    let deals = (Array.isArray(req.body?.deals) ? req.body.deals : []).map(normalizePublishableDeal).filter(Boolean);
    if (!deals.length) {
      deals = (await fetchAlgumonRankDeals({ limit: 15 })).map(normalizePublishableDeal).filter(Boolean).slice(0, 5);
    }
    if (!deals.length) return res.status(400).json({ error: '실제 판매 상품 링크가 확인된 핫딜이 없습니다. 핫딜을 다시 불러와주세요.' });
    const notes = String(req.body?.notes || '').trim();
    if (notes.length > 2000) return res.status(400).json({ error: '간략한 내용과 추가 요청은 합계 2,000자 이하로 입력해주세요.' });

    const activeEndpoint = await resolveActiveLlmEndpoint();
    const targetModel = activeEndpoint.model;
    const post = await agyClient.generateDealsBlogPost({
      deals: deals.slice(0, 5),
      tone: ['informative', 'friendly', 'review'].includes(req.body?.tone) ? req.body.tone : 'informative',
      length: ['short', 'medium', 'long'].includes(req.body?.length) ? req.body.length : 'medium',
      notes,
      model: targetModel
    });

    const dealImages = deals.slice(0, 5).map((deal, index) => {
      if (!deal.image) return null;
      return {
        id: `deal-image-${deal.dealId || index}`,
        title: deal.title,
        downloadUrl: deal.image,
        previewUrl: deal.image,
        pageUrl: deal.url || '',
        author: deal.shop || '상품 판매처',
        license: '핫딜 상품 이미지',
        licenseUrl: deal.url || '',
        afterHeading: post.imagePlans[index]?.afterHeading || '',
        caption: `${deal.shop || '특가'} - ${deal.title} (${deal.price})`,
        autoSelected: true
      };
    }).filter(Boolean);

    res.json({
      ...post,
      deals,
      dealImages,
      sourceUrl: 'https://www.algumon.com/n/deal/rank',
      model: targetModel,
      engineType: activeEndpoint.type,
      engineLabel: activeEndpoint.label,
      serverUrl: activeEndpoint.baseUrl
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/prompt-template', (_req, res) => {
  res.json(DEFAULT_PROMPT_CONFIG);
});

app.post('/api/blog/draft', async (req, res, next) => {
  const generationId = /^[a-zA-Z0-9-]{8,80}$/.test(String(req.body?.generationId || '')) ? String(req.body.generationId) : '';
  try {
    setGenerationProgress(generationId, { status: 'running', phase: 'prepare', message: '입력 내용을 확인하는 중' });
    const topic = String(req.body?.topic || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (topic.length < 2 || topic.length > 200) {
      const message = '작성 주제를 2~200자로 입력해주세요.';
      setGenerationProgress(generationId, { status: 'error', phase: 'validation', message });
      return res.status(400).json({ error: message });
    }
    if (notes.length > 3000) {
      const message = '추가 요청은 3,000자 이하로 입력해주세요.';
      setGenerationProgress(generationId, { status: 'error', phase: 'validation', message });
      return res.status(400).json({ error: message });
    }
    let sourceUrl = normalizeHttpUrl(req.body?.sourceUrl);
    const newsTitle = String(req.body?.newsTitle || '').trim().slice(0, 500);
    const source = String(req.body?.source || '').trim().slice(0, 100);
    const rawWritingPrompt = String(req.body?.writingPrompt || req.body?.promptConfig?.writingPrompt || req.body?.promptConfig?.systemPrompt || '').trim();
    const rawImagePrompt = String(req.body?.imagePrompt || req.body?.promptConfig?.imagePrompt || req.body?.promptConfig?.imagePromptInstructions || '').trim();
    const promptConfig = normalizePromptConfig(rawWritingPrompt || rawImagePrompt ? { writingPrompt: rawWritingPrompt, imagePrompt: rawImagePrompt, ...req.body?.promptConfig } : req.body?.promptConfig);
    const writingPrompt = promptConfig?.writingPrompt || '';
    const imagePrompt = promptConfig?.imagePrompt || '';

    const seriesCount = Math.max(1, Math.min(10, parseInt(req.body?.seriesCount, 10) || 1));
    const seriesEpisode = Math.max(1, Math.min(seriesCount, parseInt(req.body?.seriesEpisode, 10) || 1));

    const activeEndpoint = await resolveActiveLlmEndpoint();
    const targetModel = activeEndpoint.model;

    const avoidHistory = await postHistoryStore.recent(25);
    const promptUrl = `${topic}\n${notes}`.match(/https?:\/\/[^\s<>()]+/i)?.[0] || '';
    sourceUrl = sourceUrl || normalizeHttpUrl(promptUrl);
    let resolvedSourceTitle = newsTitle || source || '';
    let extractedContent = '';

    if (sourceUrl) {
      setGenerationProgress(generationId, { phase: 'source', message: '링크의 원문 내용을 분석하는 중' });
      const extracted = await extractArticleContent(sourceUrl);
      resolvedSourceTitle = extracted.title || resolvedSourceTitle;
      extractedContent = extracted.content || '';
    }

    const episodes = [];
    let sharedSeriesTitle = '';
    const seriesRoadmap = [];

    for (let ep = 1; ep <= seriesCount; ep += 1) {
      const seriesBadgeText = seriesCount > 1 ? `[${seriesCount}부작 중 제${ep}편] ` : '';
      setGenerationProgress(generationId, {
        phase: 'writing',
        current: ep,
        total: seriesCount,
        message: `💎 Google Gemini가 ${seriesBadgeText}고품질 글을 집필하는 중 (${ep}/${seriesCount})`
      });

      const epNotes = ep === 1
        ? notes
        : [
            notes,
            sharedSeriesTitle ? `시리즈 대표명: ${sharedSeriesTitle}` : '',
            seriesRoadmap.length ? `시리즈 전체 로드맵: ${seriesRoadmap.join(' -> ')}` : '',
            `[연재 지침] 본 글은 전체 ${seriesCount}부작 중 제${ep}편입니다. 이번 회차 배정 테마(${seriesRoadmap[ep - 1] || `제${ep}부`})에 깊이 있게 집중하여 이전 편과 차별화된 심층 글을 작성하세요.`
          ].filter(Boolean).join('\n');

      let currentPost;
      if (sourceUrl) {
        const promptWithoutUrl = epNotes.replace(promptUrl, '').trim();
        currentPost = await agyClient.generateArticleRewriteBlogPost({
          sourceTitle: resolvedSourceTitle || newsTitle || topic,
          sourceContent: extractedContent,
          sourceUrl,
          tone: ['informative', 'friendly', 'review', 'column'].includes(req.body?.tone) ? req.body.tone : 'friendly',
          length: ['short', 'medium', 'long'].includes(req.body?.length) ? req.body.length : 'medium',
          seriesCount,
          seriesEpisode: ep,
          notes: promptWithoutUrl,
          customFocus: topic,
          model: targetModel,
          avoidHistory: [...avoidHistory, ...episodes.map((e) => e.title)],
          writingPrompt,
          imagePrompt,
          promptConfig
        });
      } else {
        currentPost = await agyClient.generateBlogPost({
          topic,
          newsTitle,
          source,
          sourceUrl,
          tone: ['informative', 'friendly', 'review'].includes(req.body?.tone) ? req.body.tone : 'informative',
          length: ['short', 'medium', 'long'].includes(req.body?.length) ? req.body.length : 'medium',
          seriesCount,
          seriesEpisode: ep,
          notes: epNotes,
          model: targetModel,
          avoidHistory: [...avoidHistory, ...episodes.map((e) => e.title)],
          writingPrompt,
          imagePrompt,
          promptConfig
        });
      }

      if (sourceUrl) {
        currentPost.content = `${currentPost.content}\n\n참고 자료\n${resolvedSourceTitle || '관련 자료'}\n${sourceUrl}`;
      }

      if (currentPost.seriesTitle && !sharedSeriesTitle) sharedSeriesTitle = currentPost.seriesTitle;
      if (Array.isArray(currentPost.seriesRoadmap) && currentPost.seriesRoadmap.length > seriesRoadmap.length) {
        seriesRoadmap.splice(0, seriesRoadmap.length, ...currentPost.seriesRoadmap);
      }

      episodes.push(currentPost);
    }

    const firstPost = episodes[0];
    const duplicate = await postHistoryStore.findSimilar({ topic, title: firstPost.title, content: firstPost.content });
    if (duplicate) throw new Error(`기존 발행 글 "${duplicate.record.title}"과 내용이 너무 비슷해 생성을 중단했습니다. 주제나 강조점을 조금 다르게 입력해주세요.`);

    const imageStyle = String(req.body?.imageStyle || 'photorealistic');

    // Generate distinct AI images for all episodes (shared exclude sets guarantee zero duplicates across all episodes)
    const sharedExcludeUrls = new Set();
    const sharedExcludeTitles = new Set();
    for (let i = 0; i < episodes.length; i += 1) {
      setGenerationProgress(generationId, {
        phase: 'image',
        current: i + 1,
        total: episodes.length,
        message: episodes.length > 1
          ? `제${i + 1}편 맞춤 고화질 이미지 준비 중 (${i + 1}/${episodes.length})`
          : '본문 작성 완료 · 맞춤 고화질 이미지 준비 중'
      });
      try {
        const epImages = await generateAiDrawingsForPost(episodes[i], path.join(__dirname, '.images'), {
          style: imageStyle,
          imageModelManager,
          imagePrompt,
          excludeUrls: sharedExcludeUrls,
          excludeTitles: sharedExcludeTitles
        });
        episodes[i].autoImages = epImages;
        episodes[i].images = epImages;
      } catch (err) {
        console.error(`Failed to generate AI drawings for episode ${i + 1}:`, err);
        episodes[i].autoImages = [];
        episodes[i].images = [];
      }
    }

    setGenerationProgress(generationId, {
      status: 'complete',
      phase: 'complete',
      current: seriesCount,
      total: seriesCount,
      message: seriesCount > 1
        ? `총 ${seriesCount}부작 전편 집필 및 각 편 맞춤 이미지 생성 완료`
        : '글과 이미지 3장 생성 완료'
    });

    res.json({
      ...firstPost,
      episodes,
      autoImages: firstPost.autoImages || [],
      images: firstPost.images || [],
      model: targetModel,
      engineType: activeEndpoint.type,
      engineLabel: activeEndpoint.label,
      serverUrl: activeEndpoint.baseUrl,
      sourceUrl
    });
  } catch (error) {
    setGenerationProgress(generationId, { status: 'error', phase: 'error', message: error.message || '알 수 없는 생성 오류' });
    next(error);
  }
});

app.post('/api/blog/article/extract', async (req, res, next) => {
  try {
    const urlOrText = String(req.body?.urlOrText || req.body?.url || req.body?.text || '').trim();
    if (!urlOrText) return res.status(400).json({ error: '뉴스 기사 URL 또는 본문 텍스트를 입력해주세요.' });
    const extracted = await extractArticleContent(urlOrText);
    res.json(extracted);
  } catch (error) {
    next(error);
  }
});

app.post('/api/blog/article/draft', async (req, res, next) => {
  try {
    let sourceTitle = String(req.body?.sourceTitle || req.body?.title || '').trim();
    let sourceContent = String(req.body?.sourceContent || req.body?.content || req.body?.urlOrText || '').trim();
    let sourceUrl = normalizeHttpUrl(req.body?.sourceUrl || req.body?.url);
    const notes = String(req.body?.notes || '').trim();
    const customFocus = String(req.body?.customFocus || '').trim();
    let scrapedImages = [];

    if (/^https?:\/\//i.test(sourceContent) || /^https?:\/\//i.test(sourceUrl)) {
      const targetUrl = /^https?:\/\//i.test(sourceContent) ? sourceContent : sourceUrl;
      const extracted = await extractArticleContent(targetUrl);
      sourceContent = extracted.content || sourceContent;
      if (!sourceTitle) sourceTitle = extracted.title;
      sourceUrl = extracted.sourceUrl || sourceUrl;
      scrapedImages = extracted.images || [];
    }

    if (!sourceContent || sourceContent.length < 10) {
      return res.status(400).json({ error: '참조할 기사 내용이나 텍스트를 충분히 입력해주세요.' });
    }

    const activeEndpoint = await resolveActiveLlmEndpoint();
    const targetModel = activeEndpoint.model;
    const avoidHistory = await postHistoryStore.recent(25);
    const post = await agyClient.generateArticleRewriteBlogPost({
      sourceTitle,
      sourceContent,
      sourceUrl,
      tone: ['informative', 'friendly', 'review', 'column'].includes(req.body?.tone) ? req.body.tone : 'friendly',
      length: ['short', 'medium', 'long'].includes(req.body?.length) ? req.body.length : 'medium',
      notes,
      customFocus,
      model: targetModel,
      avoidHistory
    });
    const duplicate = await postHistoryStore.findSimilar({ topic: sourceTitle, title: post.title, content: post.content });
    if (duplicate) throw new Error(`기존 발행 글 "${duplicate.record.title}"과 내용이 너무 비슷해 생성을 중단했습니다. 다른 링크나 관점을 사용해주세요.`);

    if (sourceUrl) {
      post.content = `${post.content}\n\n참고 자료\n${sourceTitle || '원문 기사'}\n${sourceUrl}`;
    }

    const imageStyle = String(req.body?.imageStyle || 'photorealistic');
    let autoImages = [];

    try {
      autoImages = await generateAiDrawingsForPost(post, path.join(__dirname, '.images'), { style: imageStyle, imageModelManager });
    } catch (err) {
      console.error('Failed to generate AI drawings:', err);
    }

    res.json({
      ...post,
      autoImages,
      images: autoImages,
      sourceUrl,
      model: targetModel,
      engineType: activeEndpoint.type,
      serverUrl: activeEndpoint.baseUrl,
      engineLabel: activeEndpoint.label
    });
  } catch (error) {
    next(error);
  }
});

// Golden keyword finder (same engine as 이웃메이트 Engage): real searched keywords graded by how easy
// they are to rank for, so a post can start from one.
app.post('/api/blog/brief', async (req, res, next) => {
  try {
    const topic = String(req.body?.topic || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (topic.length < 2) return res.status(400).json({ error: '포스팅 주제를 2자 이상 입력해 주세요.' });
    const golden = req.body?.golden && typeof req.body.golden === 'object' ? req.body.golden : null;
    res.json({ ok: true, brief: await agyClient.generatePostBrief({ topic, golden }) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/golden-keywords', async (req, res, next) => {
  try {
    const keyword = String(req.query?.keyword || '').replace(/\s+/g, ' ').trim();
    if (keyword.length < 1 || keyword.length > 50) {
      return res.status(400).json({ error: '황금 키워드 검색어는 1~50자로 입력해주세요.' });
    }
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 5), 25);
    res.json(await discoverGoldenKeywords({ keyword, limit }));
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/keyword-detail', async (req, res, next) => {
  try {
    const keyword = String(req.query?.keyword || '').replace(/\s+/g, ' ').trim();
    if (!keyword) return res.status(400).json({ error: '키워드를 입력해주세요.' });
    res.json(await analyzeSingleKeyword(keyword));
  } catch (error) {
    next(error);
  }
});

app.post('/api/blog/images/generate', async (req, res, next) => {
  try {
    const { prompt, title, style = 'photorealistic', afterHeading } = req.body || {};
    const textPrompt = prompt || title;
    if (!textPrompt) return res.status(400).json({ error: '생성할 그림 프롬프트를 입력해주세요.' });
    const image = await generateAiDrawing({
      prompt: textPrompt,
      style,
      outputDir: path.join(__dirname, '.images'),
      imageModelManager,
      afterHeading,
      postTitle: title || textPrompt
    });
    if (afterHeading) image.afterHeading = afterHeading;
    res.json({ ok: true, image });
  } catch (error) {
    next(error);
  }
});

app.post('/api/blog/series/generate-images', async (req, res, next) => {
  try {
    const { episodePost, imageStyle = 'photorealistic', imagePrompt = '' } = req.body || {};
    if (!episodePost) return res.status(400).json({ error: '포스팅 정보가 필요합니다.' });
    const images = await generateAiDrawingsForPost(episodePost, path.join(__dirname, '.images'), {
      style: imageStyle,
      imageModelManager,
      imagePrompt
    });
    res.json({ ok: true, images });
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/images', async (req, res, next) => {
  try {
    const query = String(req.query?.query || '').trim();
    const sourceUrl = normalizeHttpUrl(req.query?.sourceUrl);
    res.json({ query, items: await searchOpenImages(query, { sourceUrl }) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/blog/images/auto', async (req, res, next) => {
  try {
    const topic = String(req.body?.topic || '').trim().slice(0, 200);
    const sourceUrl = normalizeHttpUrl(req.body?.sourceUrl);
    const plans = (Array.isArray(req.body?.plans) ? req.body.plans : []).slice(0, 3).map((plan) => ({
      query: String(plan?.query || '').trim().slice(0, 200),
      afterHeading: String(plan?.afterHeading || '').trim().slice(0, 200)
    })).filter((plan) => plan.query.length >= 2);
    if (topic.length < 2 || !plans.length) return res.status(400).json({ error: '이미지 배치 계획을 만들 수 없습니다.' });

    const candidateGroups = await Promise.all(plans.map((plan) => searchOpenImages(plan.query, { limit: 12, sourceUrl })));
    const rankingPlans = plans.map((plan, index) => ({
      planIndex: index,
      query: plan.query,
      afterHeading: plan.afterHeading,
      candidates: candidateGroups[index].map((image) => ({
        id: image.id,
        title: image.title,
        description: image.description,
        keywords: image.searchText || '',
        provider: image.provider || 'Wikimedia Commons'
      }))
    }));
    const used = new Set();
    const items = [];
    for (let index = 0; index < plans.length; index += 1) {
      const group = candidateGroups[index] || [];
      const image = group.find((candidate) => candidate.downloadUrl && !used.has(candidate.downloadUrl));
      if (image) {
        used.add(image.downloadUrl);
        items.push({
          ...image,
          afterHeading: plans[index]?.afterHeading || '',
          caption: image.title ? String(image.title).slice(0, 100) : '',
          autoSelected: true
        });
      }
    }
    res.json({ topic, items: items.slice(0, 3) });
  } catch (error) {
    next(error);
  }
});

// Publishes one prepared post (manual review form or one-shot job). Only one post is published at a
// time: the browser session drives a single Naver editor.
async function publishPreparedPost({ title, content, tags, images, sourceTopic, categoryName, isDeals = false }) {
  let downloadedImages = [];
  publishing = true;
  try {
    const requestedImages = (Array.isArray(images) ? images : []).slice(0, 10);
    downloadedImages = await downloadCommonsImages(
      requestedImages,
      path.join(__dirname, '.playwright', 'publish-uploads')
    );
    if (requestedImages.length && downloadedImages.length !== requestedImages.length) {
      throw new Error(`선택한 상품 이미지 ${requestedImages.length}장 중 ${downloadedImages.length}장만 준비되었습니다. 이미지 주소를 확인한 뒤 다시 시도해주세요.`);
    }
    const result = await browserSession.publishBlogPost({
      title,
      content: appendImageAttributions(content, downloadedImages),
      tags,
      images: downloadedImages,
      isDeals,
      categoryName
    });
    if (result?.status === 'published') {
      await postHistoryStore.add({ title, content, url: result.url, sourceTopic });
    }
    return result;
  } finally {
    await cleanupDownloadedImages(downloadedImages);
    publishing = false;
  }
}

app.post('/api/blog/publish', async (req, res, next) => {
  if (publishing) return res.status(409).json({ error: '다른 게시글을 발행 중입니다. 잠시 후 다시 시도해주세요.' });
  try {
    if (req.body?.confirmed !== true || req.body?.confirmationText !== '발행') {
      return res.status(400).json({ error: '내용을 검토하고 발행 동의를 확인해주세요.' });
    }
    res.json(await publishPreparedPost({
      title: req.body?.title,
      content: req.body?.content,
      tags: req.body?.tags,
      images: req.body?.images,
      sourceTopic: req.body?.sourceTopic,
      categoryName: req.body?.categoryName,
      isDeals: req.body?.isDeals === true
    }));
  } catch (error) {
    next(error);
  }
});

// 🚀 One-shot auto posting: topic in, golden keywords → brief → post → images → publish, in the background.
const oneShotManager = new OneShotPostingManager({
  agyClient,
  browserSession,
  postHistoryStore,
  imageModelManager,
  discoverGoldenKeywords,
  generateAiDrawingsForPost,
  imagesDir: path.join(__dirname, '.images'),
  statePath: path.join(__dirname, '.data', 'oneshot-last-job.json'),
  publishPost: async (post) => {
    for (let waited = 0; publishing && waited < 600; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (publishing) throw new Error('다른 글 발행이 끝나지 않아 이번 글을 발행하지 못했습니다.');
    return publishPreparedPost(post);
  }
});

// 📷 Photo-based posting: the user's photos are stored with the generated images (so the review form and
// publishing treat them alike), then Gemini looks at them and writes the post.
const PHOTO_FILE = /^photo-[a-f0-9-]{8,40}\.jpg$/;

app.post('/api/blog/photo-upload', async (req, res, next) => {
  try {
    const match = String(req.body?.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: 'JPG, PNG, WEBP 사진만 올릴 수 있습니다.' });
    const filename = `photo-${randomUUID()}.jpg`;
    const filePath = path.join(imagesStorageDir, filename);
    await mkdir(imagesStorageDir, { recursive: true });
    // rotate() applies the camera orientation; metadata (GPS etc.) is not copied to the output.
    await sharp(Buffer.from(match[2], 'base64'))
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(filePath);
    const name = String(req.body?.name || '내 사진').replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
    res.json({
      id: filename,
      title: name,
      filePath,
      previewUrl: `generated-images/thumb/${filename}`,
      downloadUrl: `generated-images/${filename}`,
      thumbnailUrl: `generated-images/thumb/${filename}`,
      pageUrl: '',
      author: '내 사진',
      license: '직접 촬영한 사진',
      isUserPhoto: true,
      autoSelected: true
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/blog/photo-post', async (req, res, next) => {
  try {
    const files = (Array.isArray(req.body?.photos) ? req.body.photos : []).map((value) => path.basename(String(value || ''))).filter((file) => PHOTO_FILE.test(file));
    if (!files.length) return res.status(400).json({ error: '사진을 한 장 이상 올려 주세요.' });
    if (files.length > 10) return res.status(400).json({ error: '사진은 한 번에 10장까지 쓸 수 있습니다.' });
    const missing = files.filter((file) => !existsSync(path.join(imagesStorageDir, file)));
    if (missing.length) return res.status(400).json({ error: '올린 사진 일부를 찾지 못했습니다. 사진을 다시 올려 주세요.' });

    // Gemini reads the photos from a private folder holding only them.
    const workDir = path.join(imagesStorageDir, '.photo-jobs', randomUUID());
    await mkdir(workDir, { recursive: true });
    const names = files.map((_file, i) => `photo-${String(i + 1).padStart(2, '0')}.jpg`);
    await Promise.all(files.map((file, i) => copyFile(path.join(imagesStorageDir, file), path.join(workDir, names[i]))));
    let post;
    try {
      post = await agyClient.generatePhotoBlogPost({
        photoDir: workDir,
        photoFiles: names,
        hint: String(req.body?.hint || '').trim().slice(0, 500),
        tone: ['informative', 'friendly', 'review'].includes(req.body?.tone) ? req.body.tone : 'friendly',
        length: ['short', 'medium', 'long'].includes(req.body?.length) ? req.body.length : 'medium'
      });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    const images = files.map((file, i) => ({
      id: file,
      title: post.photoPlacement?.[i]?.caption || `내 사진 ${i + 1}`,
      filePath: path.join(imagesStorageDir, file),
      previewUrl: `generated-images/thumb/${file}`,
      downloadUrl: `generated-images/${file}`,
      thumbnailUrl: `generated-images/thumb/${file}`,
      pageUrl: '',
      author: '내 사진',
      license: '직접 촬영한 사진',
      caption: post.photoPlacement?.[i]?.caption || '',
      afterHeading: post.photoPlacement?.[i]?.afterHeading || '',
      isUserPhoto: true,
      autoSelected: true
    }));
    const endpoint = await resolveActiveLlmEndpoint();
    res.json({ ...post, autoImages: images, images, model: endpoint.model, engineLabel: endpoint.label });
  } catch (error) {
    next(error);
  }
});

app.get('/api/oneshot/status', (_req, res) => {
  res.json(oneShotManager.getStatus());
});

app.post('/api/oneshot/start', async (req, res, next) => {
  try {
    res.json(await oneShotManager.start({
      seed: req.body?.seed,
      count: req.body?.count,
      tone: req.body?.tone,
      length: req.body?.length
    }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/oneshot/stop', (_req, res) => {
  res.json(oneShotManager.stop());
});

app.post('/api/blog/update', async (req, res, next) => {
  if (publishing) return res.status(409).json({ error: '다른 게시글을 발행 또는 수정 중입니다. 잠시 후 다시 시도해주세요.' });
  let downloadedImages = [];
  try {
    if (req.body?.confirmed !== true || req.body?.confirmationText !== '수정') {
      return res.status(400).json({ error: '내용을 검토하고 수정 동의를 확인해주세요.' });
    }
    publishing = true;
    const requestedImages = (Array.isArray(req.body?.images) ? req.body.images : []).slice(0, 5);
    downloadedImages = await downloadCommonsImages(
      requestedImages,
      path.join(__dirname, '.playwright', 'publish-uploads')
    );
    if (requestedImages.length && downloadedImages.length !== requestedImages.length) {
      throw new Error(`선택한 이미지 ${requestedImages.length}장 중 ${downloadedImages.length}장만 준비되었습니다.`);
    }
    const ready = await browserSession.prepareBlogPostUpdate({
      blogId: req.body?.blogId,
      logNo: req.body?.logNo,
      title: req.body?.title,
      content: req.body?.content,
      tags: req.body?.tags,
      images: downloadedImages,
      links: req.body?.links
    });
    if (ready?.status !== 'ready' || ready?.imageCount !== downloadedImages.length) {
      throw new Error(`수정 화면 검증에 실패했습니다. 예상 이미지 ${downloadedImages.length}장, 확인 ${ready?.imageCount ?? 0}장`);
    }
    const result = await browserSession.confirmPreparedBlogPostUpdate();
    res.json({ ...result, imageCount: ready.imageCount });
  } catch (error) {
    next(error);
  } finally {
    await cleanupDownloadedImages(downloadedImages);
    publishing = false;
  }
});

app.post('/api/naver/logout', async (_req, res, next) => {
  try {
    await browserSession.close();
    res.json({ connected: false });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const message = error?.code === 'NAVER_API_NOT_CONFIGURED'
    ? error.message
    : (error?.message || '처리 중 오류가 발생했습니다.');
  console.error(`[${new Date().toISOString()}]`, message);
  const status = error?.code === 'NAVER_API_NOT_CONFIGURED' ? 503
    : error?.code === 'NAVER_SESSION_EXPIRED' ? 401
      : 500;
  res.status(status).json({ error: message });
});

function normalizePublishableDeal(deal) {
  const url = unwrapKnownRedirectUrl(deal?.productUrl || deal?.url);
  const image = normalizeHttpUrl(deal?.image);
  if (!isDirectProductUrl(url) || !image) return null;
  return { ...deal, image, url, productUrl: url, linkType: 'product' };
}

let serverInstance = null;

export function startServer(customPort = port) {
  return new Promise((resolve, reject) => {
    let isSettled = false;
    try {
      // HOST=0.0.0.0 serves the app to other machines (web development on the 112 server); the desktop app keeps loopback.
      const server = app.listen(customPort, process.env.HOST || '127.0.0.1', () => {
        if (isSettled) return;
        isSettled = true;
        serverInstance = server;
        const addr = server.address();
        const actualPort = (addr && typeof addr === 'object' && addr.port) ? addr.port : Number(customPort);
        console.log(`NeighborMate Desktop Backend: http://127.0.0.1:${actualPort}`);
        resolve({ server, port: actualPort });
      });

      server.once('error', (err) => {
        if (isSettled) return;
        isSettled = true;
        reject(err);
      });
    } catch (err) {
      if (!isSettled) {
        isSettled = true;
        reject(err);
      }
    }
  });
}

export async function shutdown() {
  try {
    await browserSession.close();
  } catch {}
  if (serverInstance) {
    serverInstance.close();
  }
}

// Auto-start if run directly as node script
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().catch((err) => {
    console.error('Server startup failed:', err);
  });
}

process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] Uncaught Exception:`, err);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] Unhandled Rejection:`, reason);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, browserSession, agyClient, imageModelManager, engagementManager, postHistoryStore };

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
