import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { detectGpuSpecs } from './hardware.js';

const COMMENT_STOPWORDS = new Set(['그리고', '하지만', '정말', '너무', '관련', '대한', '이번', '오늘', '포스팅', '블로그', '후기', '정보', '내용', '사진', '입니다', '있습니다', '했어요', '하는', '에서', '으로']);

export function normalizeCommentText(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff\ufffd]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^(?:댓글|답변|assistant|comment)\s*[:：-]\s*/i, '')
    .replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentKeywords({ title = '', contentSnippet = '', imageSummary = '' }) {
  const source = `${title} ${contentSnippet} ${imageSummary}`.normalize('NFC');
  return [...new Set(source.match(/[가-힣A-Za-z0-9]{2,}/g) || [])]
    .filter((word) => !COMMENT_STOPWORDS.has(word) && !/^\d+$/.test(word))
    .sort((a, b) => b.length - a.length);
}

function similarity(a, b) {
  const grams = (text) => {
    const clean = normalizeCommentText(text).replace(/\s/g, '');
    return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, i) => clean.slice(i, i + 2)));
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((gram) => right.has(gram)).length;
  return overlap / Math.min(left.size, right.size);
}

export function validateBlogComment(comment, context = {}, recentComments = []) {
  const text = normalizeCommentText(comment);
  const reasons = [];
  if (text.length < 15 || text.length > 120) reasons.push('length');
  if (/[<>\[\]{}]|https?:\/\/|www\.|```|\b(?:system|assistant|user)\b/i.test(text)) reasons.push('artifact');
  if (/([!?.ㅋㅎㅠㅜ])\1{3,}/.test(text)) reasons.push('noise');
  const keywords = contentKeywords(context);
  if (keywords.length && !keywords.slice(0, 30).some((word) => text.toLowerCase().includes(word.toLowerCase()))) reasons.push('irrelevant');
  if (recentComments.some((previous) => similarity(text, previous) >= 0.72)) reasons.push('duplicate');
  return { ok: reasons.length === 0, text, reasons, keywords };
}

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
      '-ngl', String(gpuLayers)
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

      // Wait for health check (up to 30s for large 6.6GB models)
      const isReady = await this.waitForReady(30000);
      if (isReady) {
        this.status = 'running';
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
        const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ temperature: 0.25, max_tokens: 700, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: '네이버 블로그 콘텐츠 전략가입니다. 최근 글만 근거로 분석해 검색량을 확보할 수 있는 핵심 명사 1~2개, 한글 2~10자의 짧은 소통 타겟 키워드를 추천하세요. 방법, 효능, 추천, 좋은 음식, 높이는 법 같은 설명구는 붙이지 말고 JSON만 출력하세요.' }, { role: 'user', content: `[최근 글]\n${source}\n\n{"summary":"블로그 성격 요약","audience":"주요 독자","targets":[{"keyword":"2~10자의 짧은 검색 키워드","reason":"추천 근거","score":1~100}]}` }] }) });
        if (response.ok) { const data = await response.json(); const raw = String(data.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''); const parsed = JSON.parse(raw); const targets = (Array.isArray(parsed.targets) ? parsed.targets : []).map((item) => ({ keyword: String(item.keyword || '').replace(/[,，\n]/g, '').replace(/\s+/g, '').trim(), reason: String(item.reason || '').trim().slice(0, 160), score: Math.min(Math.max(Number(item.score) || 50, 1), 100) })).filter((item) => item.keyword.length >= 2 && item.keyword.length <= 10 && !/(방법|효능|추천|좋은음식|높이는법)$/.test(item.keyword)).slice(0, 8); if (targets.length) return { summary: String(parsed.summary || '').trim(), audience: String(parsed.audience || '').trim(), targets, method: 'llm' }; }
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
      const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000), body: JSON.stringify({ temperature: 0.55, max_tokens: 120, messages: [{ role: 'system', content: '당신은 네이버 블로그 운영자입니다. 내 글에 달린 방문자 댓글에 정중하고 자연스러운 한국어 대댓글 1~2문장을 작성하세요. 상대 댓글의 구체적인 표현에 답하고, 과장하거나 방문·구매 경험을 지어내지 마세요. 이모지는 최대 1개, 해시태그·URL·따옴표·자기소개는 금지합니다. 답글만 출력하세요.' }, { role: 'user', content: `[내 글 제목]\n${postTitle}\n[댓글 작성자]\n${commenterName}\n[받은 댓글]\n${source}` }] }) });
      if (!response.ok) return fallback;
      const text = normalizeCommentText((await response.json()).choices?.[0]?.message?.content || '');
      if (text.length < 10 || text.length > 120 || /https?:\/\/|www\.|[#<>\[\]{}]/i.test(text)) return fallback;
      return text;
    } catch { return fallback; }
  }

  async generateBlogComment({ title = '', contentSnippet = '', imageSummary = '', tone = 'friendly', recentComments = [] }) {
    const systemPrompt = `당신은 네이버 블로그를 즐겨보는 따뜻하고 진정성 있는 20~30대 한국인 이웃 블로거입니다.
상대방의 블로그 포스팅 제목, 본문 내용, 사진(이미지) 정보를 바탕으로 상대방이 기분 좋아할 만한 '자연스럽고 정중한 1~2줄 칭찬/공감 댓글'을 작성하세요.

[필수 작성 원칙]
1. 절대로 매크로나 봇처럼 보이면 안 됩니다. '안녕하세요 블로거님' 같은 억지 호칭은 절대 쓰지 마세요.
2. 사진 속 내용(음식, 인테리어, 풍경 등)이나 본문의 구체적인 포인트를 1개 자연스럽게 언급하세요.
3. 길이는 1~2문장 (50~100자 내외)으로 간결하고 깔끔하게 작성하세요.
4. 제목이나 본문에 실제로 나온 고유한 대상·장소·메뉴·경험 중 하나를 댓글에 그대로 포함하세요. 근거 없는 맛, 방문, 구매, 효과를 지어내지 마세요.
5. 최근 댓글과 문장 구조 및 표현을 반복하지 마세요. 이모지는 없어도 되며 최대 1개만 사용하세요.
6. 깨진 문자, 제어문자, 마크다운, 따옴표, 해시태그, URL, 자기소개, 이웃 신청 문구를 쓰지 마세요.
7. 오직 댓글 본문만 출력하세요. 조건을 만족할 근거가 부족하면 정확히 SKIP만 출력하세요.`;

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

[최근 작성 댓글 - 표현 중복 금지]
${recentComments.slice(0, 8).map((comment) => `- ${normalizeCommentText(comment)}`).join('\n') || '- 없음'}

[원하는 말투]
${toneDescriptions[tone] || toneDescriptions.friendly}

위 포스팅에 어울리는 자연스러운 1~2줄 맞춤 댓글을 작성해주세요:`;

    // 1. Try local embedded llama-server first
    if (this.status === 'running') {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await fetch(`http://${this.host}:${this.port}/v1/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `${userPrompt}\n${attempt ? `이전 출력은 검증에 실패했습니다. 글의 실제 핵심어를 포함해 완전히 새로 작성하세요. 재시도 ${attempt + 1}/3` : ''}` }], temperature: 0.45 + attempt * 0.05, max_tokens: 120 }),
            signal: AbortSignal.timeout(12000)
          });
          if (!response.ok) continue;
          const data = await response.json();
          const candidate = data.choices?.[0]?.message?.content?.trim();
          if (candidate === 'SKIP') break;
          const checked = validateBlogComment(candidate, { title, contentSnippet, imageSummary }, recentComments);
          if (checked.ok) return checked.text;
          this.addLog(`Comment rejected: ${checked.reasons.join(', ')}`, 'warn');
        }
      } catch (err) {
        this.addLog(`Local inference failed, falling back: ${err.message}`, 'warn');
      }
    }

    // 2. Smart Template Fallback if local LLM is still loading
    const fallback = this.generateSmartTemplateComment({ title, contentSnippet, imageSummary, tone, recentComments });
    return validateBlogComment(fallback, { title, contentSnippet, imageSummary }, recentComments).ok ? fallback : '';
  }

  cleanCommentOutput(text) {
    return normalizeCommentText(text);
  }

  generateSmartTemplateComment({ title = '', contentSnippet = '', imageSummary = '', tone = 'friendly', recentComments = [] }) {
    const cleanTitle = title.replace(/[\[\(][^\]\)]*[\]\)]/g, '').trim();
    const topic = contentKeywords({ title: cleanTitle, contentSnippet, imageSummary })[0] || '';
    if (!topic) return '';
    const templates = [
      `${topic}에 관해 직접 정리해 주신 부분이 특히 눈에 들어왔어요. 차분하게 잘 읽었습니다.`,
      `${topic} 이야기를 구체적으로 풀어주셔서 흐름을 이해하기 좋았어요. 정성스러운 글 잘 봤습니다.`,
      `${topic} 부분이 궁금했는데 글에서 짚어주신 내용이 인상적이네요. 공유해 주셔서 감사합니다.`
    ];
    return templates.find((candidate) => !recentComments.some((previous) => similarity(candidate, previous) >= 0.72)) || '';
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
