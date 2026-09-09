import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { detectGpuSpecs } from './hardware.js';
import { buildBlogCommentMessages, commentSimilarity, contentKeywords, normalizeCommentText, validateBlogComment } from './comment-prompt.js';
export { COMMENT_DUPLICATE_THRESHOLD, COMMENT_PROMPT_VERSION, buildBlogCommentMessages, commentSimilarity, contentKeywords, normalizeCommentText, validateBlogComment } from './comment-prompt.js';

export class EmbeddedLlamaServer extends EventEmitter {
  constructor({ 
    modelManager, 
    binDir = path.join(process.cwd(), 'bin'),
    port = 8089,
    host = '127.0.0.1'
  }) {
    super();
    this.modelManager = modelManager;
    this.binDir = binDir;
    this.port = port;
    this.host = host;

    this.serverProcess = null;
    this.status = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'
    this.currentModelPath = null;
    this.currentModelId = null;
    this.logs = [];
    this.runtimeInstallPromise = null;
    this.startPromise = null;
    this.lastCommentFailure = '';
    this.acceleration = 'CPU';
    this.setup = { phase: 'idle', message: '로컬 AI 준비 대기 중', progress: 0, updatedAt: Date.now() };
  }

  setSetup(phase, message, progress) {
    this.setup = { phase, message, progress: Math.max(0, Math.min(Number(progress) || 0, 100)), updatedAt: Date.now() };
    this.emit('setup', this.getRuntimeStatus());
  }

  getRuntimeStatus() {
    return { status: this.status, modelId: this.currentModelId, hasRuntime: this.hasLocalBinary(), acceleration: this.acceleration, setup: { ...this.setup } };
  }

  getBinaryPath() {
    const isWin = process.platform === 'win32';
    const filename = isWin ? 'llama-server.exe' : 'llama-server';
    const localBin = path.join(this.binDir, filename);
    if (fs.existsSync(localBin)) return localBin;

    // Check system PATH
    return filename;
  }

  hasLocalBinary() {
    const isWin = process.platform === 'win32';
    const localBin = path.join(this.binDir, isWin ? 'llama-server.exe' : 'llama-server');
    // Current llama.cpp Windows packages use a small EXE launcher plus a
    // large implementation DLL. Both are required for a usable runtime.
    const implementation = path.join(this.binDir, isWin ? 'llama-server-impl.dll' : 'llama-server');
    try { return fs.existsSync(localBin) && fs.statSync(implementation).size >= 1024 * 1024; } catch { return false; }
  }

  async ensureRuntime() {
    if (this.hasLocalBinary()) return { ok: true, installed: false };
    if (this.runtimeInstallPromise) return this.runtimeInstallPromise;

    this.runtimeInstallPromise = (async () => {
      if (process.platform !== 'win32') {
        throw new Error('내장 AI 실행 파일을 찾지 못했습니다. 이 배포판은 Windows 자동 설치만 지원합니다.');
      }

      this.addLog('로컬 AI 실행 엔진을 자동 설치하고 있습니다...', 'info');
      this.setSetup('installing_runtime', 'AI 실행 엔진 정보를 확인하고 있습니다.', 12);
      const releaseResponse = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NeighborMate-AI/1.0' },
        signal: AbortSignal.timeout(20000)
      });
      if (!releaseResponse.ok) throw new Error(`AI 실행 엔진 정보를 불러오지 못했습니다 (HTTP ${releaseResponse.status}).`);
      const releases = await releaseResponse.json();
      // The GitHub "latest" release can temporarily be source-only. Pick the
      // newest official release that actually ships the universal Windows x64
      // runtime instead of making the one-click setup depend on that timing.
      const asset = (Array.isArray(releases) ? releases : []).flatMap((release) => release.assets || [])
        .find((item) => /bin-win-cpu-x64\.zip$/i.test(item.name || ''));
      if (!asset?.browser_download_url || !String(asset.browser_download_url).startsWith('https://github.com/')) {
        throw new Error('안전한 Windows용 AI 실행 엔진 파일을 찾지 못했습니다.');
      }

      const tempRoot = path.join(this.binDir, `.llama-runtime-${Date.now()}`);
      const archivePath = path.join(tempRoot, 'llama-runtime.zip');
      try {
        await fs.promises.mkdir(tempRoot, { recursive: true });
        this.setSetup('downloading_runtime', 'AI 실행 엔진을 내려받고 있습니다.', 25);
        const archiveResponse = await fetch(asset.browser_download_url, {
          headers: { 'User-Agent': 'NeighborMate-AI/1.0' },
          signal: AbortSignal.timeout(120000)
        });
        if (!archiveResponse.ok) throw new Error(`AI 실행 엔진 다운로드에 실패했습니다 (HTTP ${archiveResponse.status}).`);
        const archive = Buffer.from(await archiveResponse.arrayBuffer());
        if (archive.length < 1024 * 1024) throw new Error('내려받은 AI 실행 엔진 파일이 비정상적으로 작습니다.');
        await fs.promises.writeFile(archivePath, archive);

        const extractDir = path.join(tempRoot, 'extract');
        this.setSetup('extracting_runtime', 'AI 실행 엔진을 안전하게 설치하고 있습니다.', 60);
        const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;
        await new Promise((resolve, reject) => {
          const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(extractDir)} -Force`
          ], { windowsHide: true, stdio: 'ignore' });
          child.once('error', reject);
          child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`AI 실행 엔진 압축 해제 실패 (코드 ${code})`)));
        });

        const findBinary = async (directory) => {
          const entries = await fs.promises.readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            const candidate = path.join(directory, entry.name);
            if (entry.isFile() && entry.name.toLowerCase() === 'llama-server.exe') return candidate;
            if (entry.isDirectory()) {
              const found = await findBinary(candidate);
              if (found) return found;
            }
          }
          return null;
        };
        const extractedBinary = await findBinary(extractDir);
        if (!extractedBinary) throw new Error('압축 파일에서 llama-server.exe를 찾지 못했습니다.');
        await fs.promises.mkdir(this.binDir, { recursive: true });
        // llama-server needs its sibling DLLs. Copy the complete official
        // runtime folder, not just the executable, or Windows exits before it
        // can open the local API port.
        const runtimeDir = path.dirname(extractedBinary);
        const runtimeFiles = await fs.promises.readdir(runtimeDir, { withFileTypes: true });
        await Promise.all(runtimeFiles.map((entry) => fs.promises.cp(
          path.join(runtimeDir, entry.name), path.join(this.binDir, entry.name), { recursive: entry.isDirectory(), force: true }
        )));
        this.addLog('로컬 AI 실행 엔진 설치가 완료되었습니다.', 'info');
        this.setSetup('runtime_installed', 'AI 실행 엔진 설치를 마쳤습니다. 모델을 불러옵니다.', 72);
        return { ok: true, installed: true };
      } finally {
        await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      }
    })();

    try {
      return await this.runtimeInstallPromise;
    } finally {
      this.runtimeInstallPromise = null;
    }
  }

  async start() {
    if (this.status === 'running') return { status: 'running', port: this.port };
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async _start() {
    if (this.status === 'running') return { status: 'running', port: this.port };

    try {
      const shared = await fetch(`http://${this.host}:${this.port}/health`, { signal: AbortSignal.timeout(1000) });
      if (shared.ok) {
        this.status = 'running';
        this.serverProcess = null;
        return { status: 'running', port: this.port, shared: true };
      }
    } catch {}

    if (!this.modelManager?.getActiveModel) {
      this.status = 'stopped';
      return { status: 'no_model', message: '로컬 AI 모델 관리자가 준비되지 않았습니다.' };
    }
    const activeModel = await this.modelManager.getActiveModel();
    if (!activeModel || !activeModel.actualPath) {
      this.status = 'stopped';
      return { status: 'no_model', message: '다운로드된 로컬 AI 모델이 없습니다.' };
    }

    this.setSetup('checking_runtime', '로컬 AI 실행 환경을 확인하고 있습니다.', 5);

    try {
      await this.ensureRuntime();
    } catch (error) {
      this.status = 'error';
      const message = `로컬 AI 실행 엔진 준비 실패: ${error.message}`;
      this.addLog(message, 'error');
      return { status: 'error', message };
    }

    const binPath = this.getBinaryPath();
    const gpuSpecs = await detectGpuSpecs();
    const gpuLayers = gpuSpecs.totalVramMb >= 3000 ? 99 : 0; // Offload to GPU if VRAM >= 3GB
    this.acceleration = gpuLayers > 0 ? 'GPU' : 'CPU';

    this.status = 'starting';
    this.setSetup('loading_model', `${activeModel.name} 모델을 메모리에 불러오고 있습니다.`, 78);
    this.currentModelPath = activeModel.actualPath;
    this.currentModelId = activeModel.id;

    const args = [
      '-m', activeModel.actualPath,
      '--host', this.host,
      '--port', String(this.port),
      '-c', '8192', // Shared context for comments and long structured posts
      '-ngl', String(gpuLayers),
      '--jinja',
      '--reasoning-budget', '0',
      '--chat-template-kwargs', '{"enable_thinking":false}'
    ];

    try {
      this.serverProcess = spawn(binPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.serverProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        this.addLog(text, 'stdout');
      });

      this.serverProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        this.addLog(text, 'stderr');
      });

      this.serverProcess.on('exit', (code, signal) => {
        this.addLog(`Llama-server exited with code ${code}, signal ${signal}`, 'warn');
        this.status = 'stopped';
        this.serverProcess = null;
        this.emit('stopped', { code, signal });
      });

      this.serverProcess.on('error', (err) => {
        this.addLog(`Failed to spawn llama-server: ${err.message}`, 'error');
        this.status = 'error';
        this.serverProcess = null;
      });

      // Gemma 4 12B can take well over 30 seconds to load on first GPU start.
      const isReady = await this.waitForReady(120000);
      if (isReady) {
        this.status = 'running';
        this.setSetup('ready', '로컬 AI가 준비되었습니다. 이제 AI 댓글을 작성할 수 있습니다.', 100);
        this.emit('ready', { port: this.port, modelId: this.currentModelId });
        return { status: 'running', port: this.port, modelId: this.currentModelId };
      } else {
        this.status = 'fallback';
        return { status: 'fallback', message: '내장 llama-server 구동 대기시간 초과' };
      }
    } catch (err) {
      this.status = 'fallback';
      this.addLog(`Embedded llama-server start error: ${err.message}`, 'error');
      return { status: 'fallback', message: err.message };
    }
  }

  async waitForReady(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://${this.host}:${this.port}/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return true;
      } catch {}
      const elapsedRatio = Math.min((Date.now() - start) / timeoutMs, 0.95);
      this.setSetup('loading_model', 'Gemma 모델을 메모리에 불러오고 있습니다. 처음에는 조금 걸릴 수 있어요.', 78 + Math.round(elapsedRatio * 17));
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  async stop() {
    if (this.serverProcess) {
      try {
        this.serverProcess.kill('SIGTERM');
      } catch {}
      this.serverProcess = null;
    }
    this.status = 'stopped';
    this.emit('stopped');
  }

  async restartWithModel(modelId) {
    await this.stop();
    await this.modelManager.setActiveModel(modelId);
    return this.start();
  }

  addLog(text, stream = 'info') {
    const lines = String(text || '').split('\n').filter(Boolean);
    for (const line of lines) {
      this.logs.push({ time: new Date().toLocaleTimeString('ko-KR'), text: line.trim(), stream });
      if (this.logs.length > 300) this.logs.shift();
    }
  }

  /**
   * Generate human-like natural blog comment using the embedded AI model.
   */
  async analyzeBlogTargetKeywords({ texts = [], fallbackKeywords = [] }) {
    const source = texts.map((text) => normalizeCommentText(text)).filter(Boolean).slice(0, 80).join('\n').slice(0, 12000);
    if (this.status === 'running' && source) {
      try {
        const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ temperature: 0.25, max_tokens: 700, response_format: { type: 'json_object' }, messages: [
            { role: 'system', content: '네이버 블로그의 콘텐츠 전략가입니다. 제공된 최근 글만 근거로 블로그의 주제, 주요 독자, 반복 소재를 분석하고 소통 타겟 검색 키워드를 추천하세요. 키워드는 글 제목이나 질문 문장이 아니라 검색량을 확보할 수 있는 핵심 명사 1~2개, 한글 기준 2~10자로 작성하세요. 예: 건강, 만성염증, 커큐민, 붓기관리. 조사, 방법, 효능, 추천, 좋은 음식, 높이는 법 같은 설명구를 붙이지 마세요. JSON만 출력하세요.' },
            { role: 'user', content: `[최근 글]\n${source}\n\n다음 JSON 형식으로 서로 겹치지 않는 짧은 키워드 3~8개를 추천하세요: {"summary":"블로그 성격 요약","audience":"주요 독자","targets":[{"keyword":"2~10자의 짧은 검색 키워드","reason":"추천 근거","score":1~100}]}` }
          ] })
        });
        if (response.ok) {
          const data = await response.json();
          const raw = String(data.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
          const parsed = JSON.parse(raw);
          const targets = (Array.isArray(parsed.targets) ? parsed.targets : []).map((item) => ({ keyword: String(item.keyword || '').replace(/[,，\n]/g, '').replace(/\s+/g, '').trim(), reason: String(item.reason || '').trim().slice(0, 160), score: Math.min(Math.max(Number(item.score) || 50, 1), 100) })).filter((item) => item.keyword.length >= 2 && item.keyword.length <= 10 && !/(방법|효능|추천|좋은음식|높이는법)$/.test(item.keyword)).slice(0, 8);
          if (targets.length) return { summary: String(parsed.summary || '').trim(), audience: String(parsed.audience || '').trim(), targets, method: 'llm' };
        }
      } catch (error) { this.addLog(`Keyword analysis fallback: ${error.message}`, 'warn'); }
    }
    return { summary: '최근 글에서 반복해서 나타난 주제를 기준으로 분석했습니다.', audience: '해당 주제에 관심 있는 네이버 블로그 독자', targets: fallbackKeywords.map((keyword, index) => ({ keyword, reason: '최근 글에서 반복적으로 확인된 주제', score: Math.max(55, 85 - index * 5) })), method: 'fallback' };
  }

  async generateCommentReply({ postTitle = '', commentText = '', commenterName = '' }) {
    const source = normalizeCommentText(commentText);
    if (!source) throw new Error('답글을 만들 댓글 내용이 없습니다.');
    const fallback = `${commenterName ? `${commenterName}님, ` : ''}따뜻한 댓글 감사합니다. 남겨주신 말씀 덕분에 힘이 나네요!`;
    if (this.status !== 'running') return fallback;
    try {
      const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000),
        body: JSON.stringify({ temperature: 0.55, max_tokens: 120, messages: [
          { role: 'system', content: '당신은 네이버 블로그 운영자입니다. 내 글에 달린 방문자 댓글에 정중하고 자연스러운 한국어 대댓글 1~2문장을 작성하세요. 상대 댓글의 구체적인 표현에 답하고, 과장하거나 방문·구매 경험을 지어내지 마세요. 이모지는 최대 1개, 해시태그·URL·따옴표·자기소개는 금지합니다. 답글만 출력하세요.' },
          { role: 'user', content: `[내 글 제목]\n${postTitle}\n[댓글 작성자]\n${commenterName}\n[받은 댓글]\n${source}` }
        ] })
      });
      if (!response.ok) return fallback;
      const text = normalizeCommentText((await response.json()).choices?.[0]?.message?.content || '');
      if (text.length < 10 || text.length > 120 || /https?:\/\/|www\.|[#<>\[\]{}]/i.test(text)) return fallback;
      return text;
    } catch { return fallback; }
  }

  async generateBlogComment({ title = '', contentSnippet = '', imageSummary = '', tone = 'friendly', recentComments = [] }) {
    const cpuMode = this.acceleration !== 'GPU';
    // Integrated graphics uses the CPU runtime. Keep its prompt compact and
    // give the first-token generation enough time on ordinary laptops.
    const commentContext = String(contentSnippet || '').slice(0, cpuMode ? 360 : 500);
    const messages = buildBlogCommentMessages({ title, contentSnippet: commentContext, imageSummary, tone, recentComments });
    const timeoutMs = cpuMode ? 60000 : 25000;
    const maxTokens = cpuMode ? 90 : 150;
    this.lastCommentFailure = '';

    // Comments are a one-click feature. If the application just opened or a
    // model was downloaded moments ago, prepare the local engine here instead
    // of silently falling through to an empty result.
    if (this.status !== 'running' && this.modelManager?.getActiveModel) {
      const startup = await this.start();
      if (startup.status !== 'running') {
        this.lastCommentFailure = startup.message || `로컬 AI 준비 상태: ${startup.status}`;
        this.addLog(`댓글 AI 준비 실패: ${this.lastCommentFailure}`, 'warn');
      }
    }

    // 1. Try local embedded llama-server first
    if (this.status === 'running') {
      try {
        const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            temperature: 0.7,
            max_tokens: maxTokens
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content?.trim();
          if (text && text !== 'SKIP') { const checked = validateBlogComment(text, { title, contentSnippet: commentContext, imageSummary }, recentComments); if (checked.ok) return checked.text; this.lastCommentFailure = `AI 응답이 안전성 검증에서 제외됨 (${checked.reasons.join(', ')})`; this.addLog(`Comment rejected: ${checked.reasons.join(', ')}`, 'warn'); }
          else if (!text) this.lastCommentFailure = '로컬 AI가 빈 응답을 반환했습니다.';
        } else {
          this.lastCommentFailure = `로컬 AI 응답 오류 (HTTP ${response.status})`;
        }
      } catch (err) {
        this.lastCommentFailure = `로컬 AI 추론 요청 실패 (${Math.round(timeoutMs / 1000)}초 대기): ${err.message}`;
        this.addLog(`Local inference failed, falling back: ${err.message}`, 'warn');
      }
    }

    // 2. Smart Template Fallback if local LLM is still loading
    const fallback = this.generateSmartTemplateComment({ title, contentSnippet: commentContext, imageSummary, tone, recentComments });
    const fallbackCheck = validateBlogComment(fallback, { title, contentSnippet: commentContext, imageSummary }, recentComments);
    if (!fallbackCheck.ok && !this.lastCommentFailure) this.lastCommentFailure = `대체 댓글이 검증에서 제외됨 (${fallbackCheck.reasons.join(', ')})`;
    return fallbackCheck.ok ? fallback : '';
  }

  cleanCommentOutput(text) {
    return normalizeCommentText(text);
  }

  generateSmartTemplateComment({ title = '', contentSnippet = '', imageSummary = '', tone = 'friendly', recentComments = [] }) {
    const cleanTitle = title.replace(/[\[\(][^\]\)]*[\]\)]/g, '').trim();
    const topic = contentKeywords({ title: cleanTitle, contentSnippet, imageSummary })[0] || '';
    if (!topic) return '';
    const grounded = [
      `${topic}에 관해 직접 정리해 주신 부분이 특히 눈에 들어왔어요. 차분하게 잘 읽었습니다.`,
      `${topic} 이야기를 구체적으로 풀어주셔서 흐름을 이해하기 좋았어요. 정성스러운 글 잘 봤습니다.`,
      `${topic} 부분이 궁금했는데 글에서 짚어주신 내용이 인상적이네요. 공유해 주셔서 감사합니다.`,
      `${topic}를 중심으로 핵심을 정리해 주셔서 내용을 따라가기 편했어요. 유익하게 읽고 갑니다.`,
      `${topic}와 관련된 설명이 명확해서 도움이 됐어요. 다음 글도 기대하며 잘 보고 갑니다.`,
      `${topic}에 대한 관점을 차분히 풀어주셔서 인상 깊었습니다. 좋은 정보 감사해요.`
    ];
    return grounded.find((candidate) => !recentComments.some((previous) => commentSimilarity(candidate, previous) >= 0.72)) || '';
  }

  async analyzeBlogTargetKeywords({ texts = [], fallbackKeywords = [] }) {
    const defaultResponse = {
      summary: texts.length
        ? `최근 포스팅 ${texts.length}개를 기반으로 작성된 맞춤 소통 추천입니다.`
        : '내 블로그의 최근 포스팅을 기반으로 분석된 추천 소통 주제입니다.',
      audience: fallbackKeywords.length
        ? `${fallbackKeywords.slice(0, 3).join(', ')} 관련 공통 관심사를 가진 블로거`
        : '해당 관심사를 공유하는 네이버 블로그 이웃',
      targets: fallbackKeywords.map((kw, idx) => ({
        keyword: kw,
        reason: '내 블로그 글에서 반복 추출된 핵심 관심사',
        score: Math.max(60, 95 - idx * 5)
      })),
      method: 'rule-fallback'
    };

    if (this.status !== 'running' || !texts.length) {
      return defaultResponse;
    }

    const prompt = `당신은 네이버 블로그 마케팅 및 이웃 소통 전문 AI입니다.
아래는 사용자가 최근 자신의 네이버 블로그에 작성한 글들의 제목과 본문 요약입니다:

${texts.slice(0, 8).map((t, idx) => `[글 ${idx + 1}] ${t.slice(0, 200)}`).join('\n\n')}

위 글들을 정밀하게 분석하여, 이 블로거가 서로이웃을 맺고 활발하게 소통(공감, 댓글)하면 가장 반응이 좋고 공감대가 형성될 만한 "소통 타겟 키워드 5~8개"를 선정하고 JSON 형식으로 응답하세요.

JSON 출력 형식 예시 (오직 유효한 JSON만 반환):
{
  "summary": "블로그 글 주제 요약 (1~2문장)",
  "audience": "가장 소통이 잘 통할 추천 타겟 이웃층 (1문장)",
  "targets": [
    { "keyword": "추천키워드", "reason": "이 키워드를 추천하는 이유 (간략히 1문장)", "score": 95 }
  ]
}`;

    try {
      const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          temperature: 0.3,
          max_tokens: 600,
          messages: [
            { role: 'system', content: 'You are a Korean blog analytics assistant. Output ONLY valid JSON matching the requested schema.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!response.ok) return defaultResponse;
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return defaultResponse;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.targets || !Array.isArray(parsed.targets) || parsed.targets.length === 0) {
        return defaultResponse;
      }

      return {
        summary: parsed.summary || defaultResponse.summary,
        audience: parsed.audience || defaultResponse.audience,
        targets: parsed.targets.filter((t) => t && t.keyword).map((t) => ({
          keyword: String(t.keyword).trim(),
          reason: String(t.reason || '블로그 포스팅 연관 소통 타겟').trim(),
          score: Number(t.score) || 90
        })),
        method: 'llama'
      };
    } catch (err) {
      return defaultResponse;
    }
  }
}
