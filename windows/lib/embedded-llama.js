import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { detectGpuSpecs } from './hardware.js';

export class EmbeddedLlamaServer extends EventEmitter {
  constructor({ 
    modelManager, 
    binDir = path.join(process.cwd(), 'bin'),
    port = 8089,
    host = '127.0.0.1',
    fallbackExternalUrl = process.env.LOCAL_LLM_URL || 'http://192.168.219.112:8081'
  }) {
    super();
    this.modelManager = modelManager;
    this.binDir = binDir;
    this.port = port;
    this.host = host;
    this.fallbackExternalUrl = fallbackExternalUrl;

    this.serverProcess = null;
    this.status = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'
    this.currentModelPath = null;
    this.currentModelId = null;
    this.logs = [];
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
    return fs.existsSync(localBin);
  }

  async start() {
    if (this.status === 'running') return { status: 'running', port: this.port };

    const activeModel = await this.modelManager.getActiveModel();
    if (!activeModel || !activeModel.actualPath) {
      this.status = 'stopped';
      return { status: 'no_model', message: '다운로드된 로컬 AI 모델이 없습니다.' };
    }

    const binPath = this.getBinaryPath();
    const gpuSpecs = await detectGpuSpecs();
    const gpuLayers = gpuSpecs.totalVramMb >= 3000 ? 99 : 0; // Offload to GPU if VRAM >= 3GB

    this.status = 'starting';
    this.currentModelPath = activeModel.actualPath;
    this.currentModelId = activeModel.id;

    const args = [
      '-m', activeModel.actualPath,
      '--host', this.host,
      '--port', String(this.port),
      '-c', '4096', // Context window
      '-ngl', String(gpuLayers),
      '--flash-attn'
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

      // Wait for health check
      const isReady = await this.waitForReady(15000);
      if (isReady) {
        this.status = 'running';
        this.emit('ready', { port: this.port, modelId: this.currentModelId });
        return { status: 'running', port: this.port, modelId: this.currentModelId };
      } else {
        this.status = 'fallback';
        return { status: 'fallback', message: '내장 llama-server 구동 대기시간 초과 (외부/하이브리드 모드로 전환)' };
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
  async generateBlogComment({ title = '', contentSnippet = '', imageSummary = '', tone = 'friendly' }) {
    const systemPrompt = `당신은 네이버 블로그를 즐겨보는 따뜻하고 진정성 있는 20~30대 한국인 이웃 블로거입니다.
상대방의 블로그 포스팅 제목, 본문 내용, 사진(이미지) 정보를 바탕으로 상대방이 기분 좋아할 만한 '자연스럽고 정중한 1~2줄 칭찬/공감 댓글'을 작성하세요.

[필수 작성 원칙]
1. 절대로 매크로나 봇처럼 보이면 안 됩니다. '안녕하세요 블로거님' 같은 억지 호칭은 절대 쓰지 마세요.
2. 사진 속 내용(음식, 인테리어, 풍경 등)이나 본문의 구체적인 포인트를 1개 자연스럽게 언급하세요.
3. 길이는 1~2문장 (50~100자 내외)으로 간결하고 깔끔하게 작성하세요.
4. 적절한 이모티콘(😊, ㅎㅎ, :), 👍)을 자연스럽게 1~2개 섞어주세요.
5. 오직 작성된 댓글 본문만 출력하고, 따옴표나 기타 부연설명은 일절 출력하지 마세요.`;

    const toneDescriptions = {
      friendly: '친근하고 발랄한 이웃 말투 (~해요! ㅎㅎ, 넘 맛있어보여요)',
      polite: '정중하고 차분한 소통 말투 (~합니다, 좋은 정보 감사합니다)',
      enthusiastic: '적극적으로 감탄하고 칭찬하는 말투 (와 비주얼 대박이네요! 저장해둘게요)'
    };

    const userPrompt = `[블로그 글 제목]
${title || '제목 없음'}

[본문 내용 일부]
${contentSnippet || '본문 내용'}

${imageSummary ? `[사진/이미지 정보]\n${imageSummary}` : ''}

[원하는 말투]
${toneDescriptions[tone] || toneDescriptions.friendly}

위 포스팅에 어울리는 자연스러운 1~2줄 맞춤 댓글을 작성해주세요:`;

    // 1. Try local embedded llama-server first
    if (this.status === 'running') {
      try {
        const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 150
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content?.trim();
          if (text) return this.cleanCommentOutput(text);
        }
      } catch (err) {
        this.addLog(`Local inference failed, falling back: ${err.message}`, 'warn');
      }
    }

    // 2. Try fallback external local LLM (e.g. 192.168.219.112:8081)
    if (this.fallbackExternalUrl) {
      try {
        const response = await fetch(`${this.fallbackExternalUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 150
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content?.trim();
          if (text) return this.cleanCommentOutput(text);
        }
      } catch {}
    }

    // 3. Smart Template Fallback if no LLM is currently reachable
    return this.generateSmartTemplateComment({ title, tone });
  }

  cleanCommentOutput(text) {
    return text
      .replace(/^["'「](.*)["'」]$/, '$1')
      .replace(/^(댓글\s*:\s*|작성된\s*댓글\s*:\s*)/i, '')
      .trim();
  }

  generateSmartTemplateComment({ title = '', tone = 'friendly' }) {
    const cleanTitle = title.replace(/[\[\(][^\]\)]*[\]\)]/g, '').trim();
    const templates = [
      `포스팅 글 재미있게 잘 읽고 가요! ${cleanTitle ? `'${cleanTitle}' 관련해서 ` : ''}유익한 꿀팁 많이 얻어갑니다 ㅎㅎ 좋은 하루 되세요 :)`,
      `사진이랑 글 설명이 너무 알차서 집중해서 봤어요! 정성스러운 포스팅 감사히 보고 갑니다 😊`,
      `오 유용한 정보네요! 저도 관심 있던 주제인데 덕분에 도움 많이 되었습니다. 자주 소통해요! 👍`,
      `포스팅 내용이 너무 유익하고 정리가 잘 되어 있네요 ㅎㅎ 이웃 맺고 자주 들릴게요 :)`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
}