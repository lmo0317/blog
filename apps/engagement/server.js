import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { NaverBrowserSession, normalizeAutocompleteKeywords } from './lib/naver.js';
import { LocalLlmClient } from './lib/llm.js';
import { fetchKoreanTrends } from './lib/trends.js';
import { fetchAlgumonRankDeals, isDirectProductUrl, unwrapKnownRedirectUrl } from './lib/algumon.js';
import { appendImageAttributions, cleanupDownloadedImages, downloadCommonsImages, searchOpenImages } from './lib/images.js';
import { extractArticleContent } from './lib/article-scraper.js';
import { NeighborHistoryStore, EngagementHistoryStore } from './lib/history.js';
import { NeighborAutomationManager } from './lib/automation.js';
import { getSystemHardwareSummary, MODEL_CATALOG } from './lib/hardware.js';
import { ModelManager } from './lib/model-manager.js';
import { EmbeddedLlamaServer } from './lib/embedded-llama.js';
import { EngagementAutomationManager } from './lib/engagement-automation.js';
import { renderVisualCardsForPost, renderVisualCardToPng } from './lib/visual-renderer.js';
import { generateAiDrawingsForPost, generateAiDrawing, AI_IMAGE_STYLES } from './lib/ai-image-generator.js';
import { CommentReplyStore } from './lib/comment-replies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(__dirname, '.env'))) loadEnvFile(path.join(__dirname, '.env'));
const app = express();
const port = Number(process.env.PORT || 4310);

const modelManager = new ModelManager(
  path.join(__dirname, '..', '..', 'windows', '.models'),
  path.join(__dirname, '.data', 'ai-config.json')
);
const embeddedLlama = new EmbeddedLlamaServer({ 
  modelManager, 
  binDir: path.join(__dirname, '..', '..', 'windows', 'bin'),
  port: 8089,
  host: '127.0.0.1'
});

const llmClient = new LocalLlmClient({ 
  baseUrl: `http://${embeddedLlama.host}:${embeddedLlama.port}`, 
  model: 'gemma-4-12b' 
});

const browserSession = new NaverBrowserSession({
  headless: String(process.env.NAVER_HEADLESS).toLowerCase() === 'true',
  profileDir: path.join(__dirname, '.playwright', 'naver-profile'),
  sessionStatePath: path.join(__dirname, '.playwright', 'naver-session.json')
});
const historyStore = new NeighborHistoryStore(path.join(__dirname, '.data', 'neighbor-history.json'));
const automationManager = new NeighborAutomationManager({ browserSession, historyStore });

const engagementHistoryStore = new EngagementHistoryStore(path.join(__dirname, '.data', 'engagement-history.json'));
const engagementManager = new EngagementAutomationManager({ browserSession, embeddedLlama, historyStore: engagementHistoryStore });
const commentReplyStore = new CommentReplyStore(path.join(__dirname, '.data', 'comment-replies.json'));

async function resolveActiveLlmEndpoint() {
  const activeModel = await modelManager.getActiveModel();
  if (activeModel && activeModel.actualPath) {
    if (embeddedLlama.status !== 'running') {
      await embeddedLlama.start().catch((err) => {
        console.error('Failed to start embedded llama-server:', err);
      });
    }
    return {
      type: 'local_gpu',
      label: `내 PC 로컬 GPU (${activeModel.name})`,
      baseUrl: `http://${embeddedLlama.host}:${embeddedLlama.port}`,
      model: activeModel.id
    };
  }
  throw new Error('내 PC에 다운로드된 Gemma 모델이 없습니다. [⚙️ 공통 환경 설정]에서 Gemma 모델을 다운로드해주세요.');
}

browserSession.restoreSession().then((res) => {
  if (res?.connected) console.log('Naver session automatically restored on server startup.');
}).catch(() => {});
setInterval(() => {
  browserSession.keepAlive().catch(() => {});
}, 20 * 60 * 1000);
let publishing = false;
let trendCache = { loadedAt: 0, items: [] };

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use('/generated-images', express.static(path.join(__dirname, '.images'), { etag: false, maxAge: 0 }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, connected: browserSession.connected });
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
// Hardware & Embedded AI Models Routes
// ---------------------------------------------------------------------------

app.get('/api/hardware/specs', async (_req, res, next) => {
  try {
    const summary = await getSystemHardwareSummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

app.get('/api/models/list', async (_req, res, next) => {
  try {
    const models = await modelManager.getInstalledModels();
    const active = await modelManager.getActiveModel();
    res.json({ models, activeModel: active, serverStatus: embeddedLlama.status });
  } catch (error) {
    next(error);
  }
});

app.post('/api/models/download', async (req, res, next) => {
  try {
    const { modelId } = req.body || {};
    if (!modelId) return res.status(400).json({ error: '다운로드할 모델 ID를 지정해주세요.' });
    // Start download asynchronously
    modelManager.downloadModel(modelId).catch(() => {});
    res.json({ ok: true, message: '모델 다운로드가 시작되었습니다.', modelId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/models/cancel', async (req, res, next) => {
  try {
    const { modelId } = req.body || {};
    const success = modelManager.cancelDownload(modelId);
    res.json({ ok: success });
  } catch (error) {
    next(error);
  }
});

app.post('/api/models/select', async (req, res, next) => {
  try {
    const { modelId } = req.body || {};
    if (!modelId) return res.status(400).json({ error: '선택할 모델 ID를 지정해주세요.' });
    const selected = await modelManager.setActiveModel(modelId);
    const engineMode = 'local_gpu';
    llmClient.model = modelId;
    llmClient.baseUrl = `http://${embeddedLlama.host}:${embeddedLlama.port}`;
    // Restart embedded llama-server with new model
    embeddedLlama.restartWithModel(modelId).catch(() => {});
    const activeEndpoint = await resolveActiveLlmEndpoint();
    res.json({ ok: true, model: selected, engineMode, activeEndpoint });
  } catch (error) {
    next(error);
  }
});

app.post('/api/models/delete', async (req, res, next) => {
  try {
    const { modelId } = req.body || {};
    if (!modelId) return res.status(400).json({ error: '삭제할 모델 ID를 지정해주세요.' });
    await modelManager.deleteModel(modelId);
    const installed = await modelManager.getInstalledModels();
    res.json({ ok: true, message: '모델 파일이 삭제되었습니다.' });
  } catch (error) {
    next(error);
  }
});

// Common Settings & LLM Endpoints
app.get('/api/settings', async (_req, res, next) => {
  try {
    const activeModel = await modelManager.getActiveModel();
    const installedModels = await modelManager.getInstalledModels();
    let activeEndpoint = null;
    try {
      activeEndpoint = await resolveActiveLlmEndpoint();
    } catch {}
    res.json({
      connected: browserSession.connected,
      accountLabel: browserSession.accountLabel || '',
      engineMode: 'local_gpu',
      activeModel,
      installedCount: installedModels.filter((m) => m.isInstalled).length,
      activeEndpoint
    });
  } catch (error) {
    next(error);
  }
});

// SSE Stream for AI Model Downloads
app.get('/api/models/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('retry: 3000\n\n');

  const onProgress = (data) => {
    res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onComplete = (data) => {
    res.write(`event: complete\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onError = (data) => {
    res.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
  };

  modelManager.on('download_progress', onProgress);
  modelManager.on('download_complete', onComplete);
  modelManager.on('download_error', onError);

  req.on('close', () => {
    modelManager.off('download_progress', onProgress);
    modelManager.off('download_complete', onComplete);
    modelManager.off('download_error', onError);
  });
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

app.get('/api/engagement/neighbor-quota', async (_req, res, next) => {
  try {
    const [neighborSummary, engagementSummary] = await Promise.all([
      historyStore.getSummary(),
      engagementHistoryStore.getSummary()
    ]);
    res.json({
      todayDate: engagementSummary.todayDate || neighborSummary.todayDate,
      todayNeighbors: (Number(neighborSummary.todayCount) || 0) + (Number(engagementSummary.todayNeighbors) || 0),
      neighborOnlyCount: Number(neighborSummary.todayCount) || 0,
      engagementCount: Number(engagementSummary.todayNeighbors) || 0,
      dailyLimit: 100
    });
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

// ---------------------------------------------------------------------------
// My-post comment management: scan -> AI reply -> mutual-neighbor request
// ---------------------------------------------------------------------------
app.get('/api/comment-management/scan', async (req, res, next) => {
  try {
    const result = await browserSession.scanMyBlogComments({
      postLimit: Math.min(Math.max(Number(req.query.postLimit) || 10, 1), 30),
      commentLimit: 100
    });
    const pending = [];
    for (const comment of result.comments) {
      if (!await commentReplyStore.has(comment.postUrl, comment.commentId)) pending.push(comment);
    }
    res.json({ ...result, comments: pending, pendingCount: pending.length });
  } catch (error) { next(error); }
});

app.get('/api/comment-management/history', async (_req, res, next) => {
  try { res.json({ records: await commentReplyStore.list() }); } catch (error) { next(error); }
});

app.post('/api/comment-management/process', async (req, res, next) => {
  try {
    const rawList = Array.isArray(req.body?.comments) ? req.body.comments : (req.body?.comment ? [req.body.comment] : []);
    const comments = rawList.slice(0, 20);
    if (!comments.length) return res.status(400).json({ error: '처리할 댓글을 선택해주세요.' });
    const requestNeighbor = req.body?.requestNeighbor !== false;
    const results = [];

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      const authorTag = comment.authorName || comment.authorId || '작성자';
      console.log(`[CommentManagement] [${i + 1}/${comments.length}] @${authorTag} 댓글 처리 시작...`);

      if (await commentReplyStore.has(comment.postUrl, comment.commentId)) {
        console.log(`[CommentManagement] 이미 처리된 댓글 건너뜀 (${comment.commentId})`);
        results.push({ commentId: comment.commentId, status: 'skipped', message: '이미 처리한 댓글입니다.' });
        continue;
      }

      let replyText = '';
      let replyResult = { replied: false };
      let neighborResult = { status: 'not_requested', message: '서로이웃 신청 안 함' };

      try {
        console.log(`[CommentManagement] AI 대댓글 생성 중... (게시글: ${comment.postTitle || '무제'})`);
        replyText = await embeddedLlama.generateCommentReply({
          postTitle: comment.postTitle,
          commentText: comment.text,
          commenterName: comment.authorName
        });
        console.log(`[CommentManagement] 생성된 대댓글: "${replyText}"`);

        console.log(`[CommentManagement] 네이버 블로그에 대댓글 등록 중...`);
        replyResult = await browserSession.replyToBlogComment({
          postUrl: comment.postUrl,
          commentId: comment.commentId,
          authorName: comment.authorName,
          commentText: comment.text,
          replyText
        });
        console.log(`[CommentManagement] 대댓글 등록 완료!`);

        if (requestNeighbor && comment.authorId && comment.authorId !== comment.myBlogId) {
          console.log(`[CommentManagement] @${comment.authorId} 서로이웃 신청 진행 중...`);
          const message = `${comment.authorName || '이웃'}님, 제 글에 남겨주신 댓글 감사합니다. 서로이웃으로 소통하고 지내요 :)`;
          try {
            neighborResult = await Promise.race([
              browserSession.addNeighbor(comment.authorId, message, comment.authorName),
              new Promise((_, reject) => setTimeout(() => reject(new Error('서로이웃 신청 시간 초과 (20초)')), 20000))
            ]);
            console.log(`[CommentManagement] 서로이웃 신청 결과: ${neighborResult.status} (${neighborResult.message || ''})`);
          } catch (nErr) {
            console.warn(`[CommentManagement] 서로이웃 신청 예외 (대댓글은 정상 등록됨): ${nErr.message}`);
            neighborResult = { status: 'neighbor_failed', message: nErr.message };
          }
        }

        const saved = await commentReplyStore.add({
          ...comment,
          replyText,
          replied: true,
          neighborStatus: neighborResult.status,
          neighborMessage: neighborResult.message,
          status: 'completed'
        });
        results.push(saved);
        console.log(`[CommentManagement] ✅ @${authorTag} 처리 완료!`);
      } catch (error) {
        console.error(`[CommentManagement] ❌ @${authorTag} 처리 실패: ${error.message}`);
        const saved = await commentReplyStore.add({
          ...comment,
          replyText,
          replied: Boolean(replyResult.replied),
          neighborStatus: neighborResult.status,
          neighborMessage: neighborResult.message,
          status: 'failed',
          error: error.message
        });
        results.push(saved);
      }

      if (i < comments.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    res.json({ results, completed: results.filter((item) => item.status === 'completed').length });
  } catch (error) { next(error); }
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
    const forceRefresh = String(_req.query?.refresh || '').toLowerCase() === 'true';
    if (forceRefresh || !trendCache.items.length || cacheAge > 5 * 60 * 1000) {
      trendCache = { loadedAt: Date.now(), items: await fetchKoreanTrends({ limit: 12 }) };
    }
    res.json({ items: trendCache.items, refreshedAt: new Date(trendCache.loadedAt).toISOString() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/related-keywords', async (req, res, next) => {
  try {
    const keyword = String(req.query?.keyword || '').replace(/\s+/g, ' ').trim();
    if (keyword.length < 1 || keyword.length > 50) {
      return res.status(400).json({ error: '연관 키워드는 1~50자로 입력해주세요.' });
    }
    const params = new URLSearchParams({
      q: keyword, con: '1', frm: 'nv', ans: '2', r_format: 'json', r_enc: 'UTF-8',
      r_unicode: '0', t_koreng: '1', run: '2', rev: '4', q_enc: 'UTF-8', st: '100'
    });
    const response = await fetch(`https://ac.search.naver.com/nx/ac?${params}`, {
      headers: { Accept: 'application/json', Referer: 'https://search.naver.com/', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`네이버 검색 제안 응답 오류 (${response.status})`);
    const keywords = normalizeAutocompleteKeywords(await response.json(), keyword, 20);
    res.json({ keyword, keywords, count: keywords.length, source: 'naver-search-suggestions', searchedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/blog/my-recommendations', async (req, res, next) => {
  try {
    if (!browserSession.connected) {
      return res.status(400).json({ error: '먼저 네이버 계정을 연결해주세요.' });
    }
    const analysis = await browserSession.analyzeMyBlogKeywords();
    let aiResult = {
      summary: '내 블로그의 최근 포스팅을 기반으로 분석된 추천 소통 주제입니다.',
      audience: '해당 관심사를 공유하는 네이버 블로그 이웃',
      targets: [],
      method: 'fallback'
    };
    try {
      aiResult = await embeddedLlama.analyzeBlogTargetKeywords({
        texts: analysis.texts || [],
        fallbackKeywords: analysis.keywords || []
      });
    } catch (err) {
      console.warn(`[MyBlogAnalysis] LLM analysis fallback: ${err.message}`);
    }
    const targets = (aiResult.targets && aiResult.targets.length)
      ? aiResult.targets
      : (analysis.keywords || []).map((kw, idx) => ({
          keyword: kw,
          reason: '최근 작성한 글에서 반복적으로 확인된 핵심 키워드',
          score: Math.max(50, 92 - idx * 6)
        }));

    res.json({
      success: true,
      blogUrl: analysis.blogUrl,
      analyzedCount: analysis.analyzedTextCount,
      summary: aiResult.summary,
      audience: aiResult.audience,
      targets,
      fallbackKeywords: analysis.keywords || []
    });
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
    if (notes.length > 1000) return res.status(400).json({ error: '추가 요청은 1,000자 이하로 입력해주세요.' });

    const activeEndpoint = await resolveActiveLlmEndpoint();
    const targetModel = activeEndpoint.model;
    llmClient.baseUrl = activeEndpoint.baseUrl;
    llmClient.model = targetModel;

    const post = await llmClient.generateDealsBlogPost({
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

app.post('/api/blog/draft', async (req, res, next) => {
  try {
    const topic = String(req.body?.topic || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (topic.length < 2 || topic.length > 200) return res.status(400).json({ error: '작성 주제를 2~200자로 입력해주세요.' });
    if (notes.length > 1000) return res.status(400).json({ error: '추가 요청은 1,000자 이하로 입력해주세요.' });
    const sourceUrl = normalizeHttpUrl(req.body?.sourceUrl);
    const newsTitle = String(req.body?.newsTitle || '').trim().slice(0, 500);
    const source = String(req.body?.source || '').trim().slice(0, 100);

    const activeEndpoint = await resolveActiveLlmEndpoint();
    const targetModel = activeEndpoint.model;
    llmClient.baseUrl = activeEndpoint.baseUrl;
    llmClient.model = targetModel;

    const post = await llmClient.generateBlogPost({
      topic,
      newsTitle,
      source,
      sourceUrl,
      tone: ['informative', 'friendly', 'review'].includes(req.body?.tone) ? req.body.tone : 'informative',
      length: ['short', 'medium', 'long'].includes(req.body?.length) ? req.body.length : 'medium',
      notes,
      model: targetModel
    });
    if (sourceUrl) {
      post.content = `${post.content}\n\n참고 자료\n${newsTitle || source || '관련 자료'}\n${sourceUrl}`;
    }

    const imageStyle = String(req.body?.imageStyle || 'photorealistic');
    let autoImages = [];
    try {
      autoImages = await generateAiDrawingsForPost(post, path.join(__dirname, '.images'), { style: imageStyle });
    } catch (err) {
      console.error('Failed to generate AI drawings:', err);
    }

    res.json({
      ...post,
      autoImages,
      images: autoImages,
      model: targetModel,
      engineType: activeEndpoint.type,
      engineLabel: activeEndpoint.label,
      serverUrl: activeEndpoint.baseUrl
    });
  } catch (error) {
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
    llmClient.baseUrl = activeEndpoint.baseUrl;
    llmClient.model = targetModel;

    const post = await llmClient.generateArticleRewriteBlogPost({
      sourceTitle,
      sourceContent,
      sourceUrl,
      tone: ['informative', 'friendly', 'review', 'column'].includes(req.body?.tone) ? req.body.tone : 'friendly',
      length: ['short', 'medium', 'long'].includes(req.body?.length) ? req.body.length : 'medium',
      notes,
      customFocus,
      model: targetModel
    });

    if (sourceUrl) {
      post.content = `${post.content}\n\n참고 자료\n${sourceTitle || '원문 기사'}\n${sourceUrl}`;
    }

    const imageStyle = String(req.body?.imageStyle || 'photorealistic');
    let autoImages = [];

    try {
      autoImages = await generateAiDrawingsForPost(post, path.join(__dirname, '.images'), { style: imageStyle });
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

app.post('/api/blog/images/generate', async (req, res, next) => {
  try {
    const { prompt, title, style = 'photorealistic', afterHeading } = req.body || {};
    const textPrompt = prompt || title;
    if (!textPrompt) return res.status(400).json({ error: '생성할 그림 프롬프트를 입력해주세요.' });
    const image = await generateAiDrawing({
      prompt: textPrompt,
      style,
      outputDir: path.join(__dirname, '.images')
    });
    if (afterHeading) image.afterHeading = afterHeading;
    res.json({ ok: true, image });
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
    const selections = await llmClient.selectRelevantImages({ topic, plans: rankingPlans });
    const used = new Set();
    const items = selections.map((selection) => {
      const planIndex = Number(selection.planIndex);
      const image = candidateGroups[planIndex]?.find((candidate) => candidate.id === String(selection.imageId || ''));
      if (!image || used.has(image.downloadUrl)) return null;
      used.add(image.downloadUrl);
      return {
        ...image,
        afterHeading: plans[planIndex]?.afterHeading || '',
        caption: String(selection.caption || '').trim().slice(0, 300),
        autoSelected: true
      };
    }).filter(Boolean).slice(0, 3);
    res.json({ topic, items });
  } catch (error) {
    next(error);
  }
});

app.post('/api/blog/publish', async (req, res, next) => {
  if (publishing) return res.status(409).json({ error: '다른 게시글을 발행 중입니다. 잠시 후 다시 시도해주세요.' });
  let downloadedImages = [];
  try {
    if (req.body?.confirmed !== true || req.body?.confirmationText !== '발행') {
      return res.status(400).json({ error: '내용을 검토하고 발행 동의를 확인해주세요.' });
    }
    publishing = true;
    const requestedImages = (Array.isArray(req.body?.images) ? req.body.images : []).slice(0, 5);
    downloadedImages = await downloadCommonsImages(
      requestedImages,
      path.join(__dirname, '.playwright', 'publish-uploads')
    );
    if (requestedImages.length && downloadedImages.length !== requestedImages.length) {
      throw new Error(`선택한 상품 이미지 ${requestedImages.length}장 중 ${downloadedImages.length}장만 준비되었습니다. 이미지 주소를 확인한 뒤 다시 시도해주세요.`);
    }
    const result = await browserSession.publishBlogPost({
      title: req.body?.title,
      content: appendImageAttributions(req.body?.content, downloadedImages),
      tags: req.body?.tags,
      images: downloadedImages,
      isDeals: req.body?.isDeals === true
    });
    res.json(result);
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
      const server = app.listen(customPort, '127.0.0.1', () => {
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
    await embeddedLlama.stop();
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

export { app, browserSession, modelManager, embeddedLlama, engagementManager };

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
