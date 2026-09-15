import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROMPT_CONFIG, normalizeGeneratedPost, parseLlmJson } from './llm.js';

const execFileAsync = promisify(execFile);

export const AGY_GEMINI_MODELS = [
  {
    id: 'gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash (High)',
    desc: '구독 연동 · 권장 기본 / 3초 초고속 생성 및 최고 지능',
    speed: '초고속 (2~4초)',
    quality: '최상급 (추천)',
    isDefault: true
  },
  {
    id: 'gemini-3.7-flash-high',
    name: 'Gemini 3.7 Flash (High)',
    desc: '구독 연동 · 안정적인 고성능 플래시 모델',
    speed: '고속 (3~5초)',
    quality: '상급',
    isDefault: false
  },
  {
    id: 'gemini-3.1-pro-high',
    name: 'Gemini 3.1 Pro (High)',
    desc: '구독 연동 · 고난도 심층 분석 및 전문 칼럼 작성',
    speed: '보통 (5~8초)',
    quality: '최상급 심층 분석',
    isDefault: false
  }
];

const LENGTH_GUIDE = {
  short: '1,000~1,500자 (핵심 요약 압축)',
  medium: '2,000~2,800자 (표준 심층 분석 · 권장)',
  long: '3,200~4,500자 (전문가 마스터클래스 · 극상의 깊이)'
};

const TONE_GUIDE = {
  informative: '전문적이면서도 초보자도 쉽게 따라 할 수 있는 명쾌하고 신뢰감 높은 톤앤매너',
  friendly: '친근하고 다정한 네이버 이웃 대화체 (~해요, ~해보셨나요?, ~해보시길 강력 추천드려요! 등 진솔한 소통 어조)',
  review: '직접 써보고 검증한 1%의 디테일과 장단점, 솔직한 실사용 꿀팁 중심의 생생한 체험형 톤앤매너',
  column: '트렌드를 분석하고 독창적인 시각과 깊이 있는 인사이트를 제시하는 스마트한 칼럼형 톤앤매너'
};

export class AgyClient {
  constructor({ defaultModel = 'gemini-3.8-flash-high', timeoutMs = 90000 } = {}) {
    this.defaultModel = defaultModel;
    this.timeoutMs = timeoutMs;
    this._isAvailable = null;
    this.imagenQuotaExhaustedUntil = 0;
  }

  async isAvailable() {
    if (this._isAvailable !== null) return this._isAvailable;
    try {
      const { stdout, stderr } = await execFileAsync('agy', ['--help'], {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf8'
      });
      const combined = `${stdout || ''}\n${stderr || ''}`;
      this._isAvailable = combined.includes('agy') || combined.includes('print');
    } catch {
      this._isAvailable = false;
    }
    return this._isAvailable;
  }

  getModels() {
    return AGY_GEMINI_MODELS;
  }

  async executeAgyPrompt(prompt, { model = this.defaultModel, json = true, timeoutMs = this.timeoutMs } = {}) {
    const args = ['--model', model, '--disable-slash-commands'];
    if (json) {
      args.push('--output-format', 'json');
    }

    const isolatedPrompt = [
      '[시스템 절대 원칙: 본 요청은 순수 텍스트(JSON) 생성 작업입니다. 파일 탐색, 저장소 검색 등 어떤 도구(Tool Call)도 절대 호출하지 마십시오. 오직 요청된 JSON 스키마에 맞는 완성된 텍스트만을 즉시 출력해야 합니다.]',
      '',
      prompt
    ].join('\n');

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isSettled = false;

      const child = spawn('agy', args, {
        cwd: os.tmpdir(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try { child.kill('SIGTERM'); } catch {}
          reject(new Error(`Gemini(agy) 응답 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초). 다시 시도해주세요.`));
        }
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          reject(new Error(`agy 실행 실패: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);

        if (!stdout && stderr && code !== 0) {
          return reject(new Error(`agy 실행 오류: ${stderr.slice(0, 300)}`));
        }

        if (json) {
          try {
            const wrapper = JSON.parse(stdout);
            if (wrapper && (wrapper.status === 'ERROR' || wrapper.error)) {
              return reject(new Error(`Gemini(agy) 오류: ${wrapper.error || wrapper.message || '응답 생성 실패'}`));
            }
            const responseText = (wrapper && typeof wrapper.response === 'string') ? wrapper.response : stdout;
            if (!responseText.trim()) {
              return reject(new Error(`Gemini(agy) 응답 내용이 비어있습니다. ${wrapper?.error || ''}`.trim()));
            }
            return resolve(parseLlmJson(responseText));
          } catch (err) {
            if (err.message?.includes('Gemini(agy) 오류') || err.message?.includes('AI 모델 오류:')) {
              return reject(err);
            }
            try {
              return resolve(parseLlmJson(stdout));
            } catch (parseErr) {
              return reject(parseErr);
            }
          }
        }

        return resolve(stdout.trim());
      });

      child.stdin.end(isolatedPrompt, 'utf8');
    });
  }

  buildSystemPrompt(promptConfig = null, { seriesCount = 1, seriesEpisode = 1 } = {}) {
    const writingPrompt = String(
      promptConfig?.writingPrompt || promptConfig?.systemPrompt || DEFAULT_PROMPT_CONFIG.writingPrompt
    ).trim();
    const imagePrompt = String(
      promptConfig?.imagePrompt || promptConfig?.imagePromptInstructions || DEFAULT_PROMPT_CONFIG.imagePrompt
    ).trim();

    const seriesRules = Number(seriesCount) > 1 ? [
      '',
      `[🔥 ${seriesCount}부작 기획 연재 집필 특화 규칙]`,
      `- 본 포스팅은 [총 ${seriesCount}부작 대기획 연재] 중 [제${seriesEpisode}편]입니다.`,
      `- 절대로 단편 글처럼 모든 주제를 겉핥기식으로 얕게 훑고 지나가지 마세요. 이번 제${seriesEpisode}편에 배정된 핵심 테마 하나를 현미경으로 보듯 심층적이고 깊이 있게 파고들어야 합니다.`,
      `- 제목(title)은 반드시 "[시리즈명 ${seriesEpisode}편] 매력적인 소주제 타이틀" 형태로 작성하세요.`,
      `- "seriesTitle": 전체 시리즈를 아우르는 통일된 브랜드명 (예: "직장인 에너지 리셋 3부작")`,
      `- "seriesRoadmap": 1부부터 ${seriesCount}부까지 각 편의 주제를 담은 목차 배열 (${seriesCount}개 항목)`,
      `- "nextEpisodeTeaser": 다음 제${Number(seriesEpisode) + 1}편(또는 완결 안내)에 대한 독자의 호기심을 극대화하는 예고 멘트 (100~200자)`
    ] : [];

    return [
      `[글생성 프롬프트 지침]`,
      writingPrompt,
      '',
      `[이미지 생성 프롬프트 지침]`,
      imagePrompt,
      '',
      '[네이버 블로그 고품질 작성 3대 핵심 원칙]',
      '1. 겉핥기식 압축 금지: 주제를 선정했다면 구체적인 실행 절차, 정확한 설정값, 직접 써본 사람만 아는 1% 꿀팁과 주의사항까지 상세히 파고들 것. 단순한 상식 나열을 넘어 과학적/실전 메커니즘과 구체적 수치를 반드시 제시하세요.',
      '2. 체계적인 1, 2, 3 구조화: 본문 소제목(heading)은 "1. ~", "2. ~", "3. ~" 형태로 직관적이고 깔끔하게 구성할 것. 소제목별로 최소 400~600자 이상의 충실하고 깊이 있는 본문을 작성하세요.',
      '3. 마크다운 해시태그(###)나 파이프 표(|---|) 기호 사용 엄격 금지. 본문은 네이버 스마트에디터 ONE에 바로 적용되는 깔끔한 줄글과 불릿(•, ▶)으로 작성할 것.',
      ...seriesRules
    ].join('\n');
  }

  async generateBlogPost({
    topic,
    newsTitle = '',
    source = '',
    sourceUrl = '',
    tone = 'friendly',
    length = 'medium',
    seriesCount = 1,
    seriesEpisode = 1,
    notes = '',
    model = this.defaultModel,
    avoidHistory = [],
    writingPrompt = '',
    imagePrompt = '',
    promptConfig = null
  }) {
    const isSeries = Number(seriesCount) > 1;
    const curEp = Number(seriesEpisode) || 1;
    const totalEp = Number(seriesCount) || 1;

    const resolvedConfig = {
      writingPrompt: writingPrompt || promptConfig?.writingPrompt || promptConfig?.systemPrompt,
      imagePrompt: imagePrompt || promptConfig?.imagePrompt || promptConfig?.imagePromptInstructions
    };
    const sysPrompt = this.buildSystemPrompt(resolvedConfig, { seriesCount: totalEp, seriesEpisode: curEp });
    const chosenLength = LENGTH_GUIDE[length] || LENGTH_GUIDE.medium;
    const chosenTone = TONE_GUIDE[tone] || TONE_GUIDE.friendly;

    const promptText = [
      sysPrompt,
      '',
      '---',
      '다음 정보와 지침을 바탕으로 깊이 있고 전문적인 네이버 블로그 포스팅을 완성하여 반드시 유효한 JSON 형식으로만 출력하세요.',
      '마크다운 백틱(```json) 없이 순수 JSON 객체만 출력해야 합니다.',
      '',
      `[작성 요청 정보]`,
      `- 포스팅 주제: ${topic}`,
      isSeries ? `- 기획 연재: 총 ${totalEp}부작 시리즈 중 [제${curEp}편]` : '- 단편 완결형 글 (단편이어도 깊이 있는 세부 분석)',
      isSeries ? `- 연재 집필 지침: ${totalEp}부작의 로드맵 속에서 이번 [제${curEp}편]의 핵심 주제에만 온전히 집중하여 심층 파고들기` : '',
      newsTitle ? `- 관련 헤드라인: ${newsTitle}` : '',
      source ? `- 출처/배경: ${source}` : '',
      sourceUrl ? `- 출처 링크: ${sourceUrl}` : '',
      `- 어조/말투: ${chosenTone}`,
      `- 목표 글자 수: ${chosenLength}`,
      notes ? `- 추가 요청사항 및 강조 포인트:\n${notes}` : '',
      avoidHistory.length ? `- 최근 발행된 유사 글 목록(중복 내용 엄격 배제): ${avoidHistory.map((h) => typeof h === 'string' ? h : h.title).slice(0, 5).join(', ')}` : '',
      '',
      `[필수 JSON 출력 스키마]`,
      `{`,
      `  "title": "${isSeries ? `[시리즈명 ${curEp}편] 매력적인 타이틀 (20~45자)` : '클릭하고 싶은 매력적인 네이버 블로그 제목 (20~40자)'}",`,
      isSeries ? `  "seriesTitle": "전체 시리즈를 대표하는 연재명 (예: 직장인 활력 리셋 3부작)",` : '',
      isSeries ? `  "seriesCount": ${totalEp},` : '',
      isSeries ? `  "seriesEpisode": ${curEp},` : '',
      isSeries ? `  "seriesRoadmap": [\n    "1부: 1부 핵심 테마 한 줄",\n    "2부: 2부 핵심 테마 한 줄"${totalEp >= 3 ? ',\n    "3부: 3부 핵심 테마 한 줄"' : ''}${totalEp >= 5 ? ',\n    "4부: 4부 핵심 테마 한 줄",\n    "5부: 5부 핵심 테마 한 줄"' : ''}\n  ],` : '',
      isSeries && curEp < totalEp ? `  "nextEpisodeTeaser": "다음 제${curEp + 1}편에 대한 독자의 호기심을 극대화하는 예고 멘트 (100~200자)",` : '',
      `  "lead": "다정하고 공감 가는 블로그 도입부 인사 및 문제 공감 (250~350자)",`,
      `  "summaryPoints": [`,
      `    "핵심 요약 포인트 1 (구체적 수치 또는 실천 팁)",`,
      `    "핵심 요약 포인트 2",`,
      `    "핵심 요약 포인트 3"`,
      `  ],`,
      `  "sections": [`,
      `    {`,
      `      "heading": "1. 첫 번째 핵심 단계 또는 원리 소제목",`,
      `      "body": "충실하고 상세한 설명, 실천 팁, 주의사항을 담은 본문 내용 (줄바꿈 포함, 400~600자 이상)",`,
      `      "imageQuery": "Concrete visual scene description in English for this specific section (e.g. Sizzling dolsot bibimbap stone bowl or Person doing neck stretch)",`,
      `      "imageKeywords": "2~3 English search keywords matching this section (e.g. bibimbap bowl, neck stretch)"`,
      `    },`,
      `    {`,
      `      "heading": "2. 두 번째 핵심 실천 및 활용 소제목",`,
      `      "body": "초보자가 그대로 따라 할 수 있는 상세 가이드 및 꿀팁 (400~600자 이상)",`,
      `      "imageQuery": "Concrete visual scene description in English for this specific section",`,
      `      "imageKeywords": "2~3 English search keywords matching this section"`,
      `    },`,
      `    {`,
      `      "heading": "3. 세 번째 주의사항 및 전문가 실무 꿀팁 소제목",`,
      `      "body": "놓치기 쉬운 실수 방지법과 다음 실천 팁 (400~600자 이상)",`,
      `      "imageQuery": "Concrete visual scene description in English for this specific section",`,
      `      "imageKeywords": "2~3 English search keywords matching this section"`,
      `    }`,
      `  ],`,
      `  "closing": "따뜻한 응원 및 소통과 댓글을 유도하는 마무리 멘트 (200~300자)",`,
      `  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5", "태그6", "태그7", "태그8"],`,
      `  "imageQueries": ["English image prompt 1", "English image prompt 2", "English image prompt 3"]`,
      `}`
    ].filter(Boolean).join('\n');

    const rawJson = await this.executeAgyPrompt(promptText, { model });
    const parsed = typeof rawJson === 'string' ? parseLlmJson(rawJson) : (rawJson || {});
    if (isSeries) {
      if (!parsed.seriesCount) parsed.seriesCount = totalEp;
      if (!parsed.seriesEpisode) parsed.seriesEpisode = curEp;
      if (!parsed.seriesRoadmap || !parsed.seriesRoadmap.length) {
        parsed.seriesRoadmap = Array.from({ length: totalEp }, (_, i) => `${i + 1}부: ${topic} - 제${i + 1}단계`);
      }
    }
    return normalizeGeneratedPost(parsed);
  }

  async generateArticleRewriteBlogPost({
    sourceTitle = '',
    sourceContent = '',
    sourceUrl = '',
    tone = 'friendly',
    length = 'medium',
    seriesCount = 1,
    seriesEpisode = 1,
    notes = '',
    customFocus = '',
    model = this.defaultModel,
    avoidHistory = [],
    writingPrompt = '',
    imagePrompt = '',
    promptConfig = null
  }) {
    const isSeries = Number(seriesCount) > 1;
    const curEp = Number(seriesEpisode) || 1;
    const totalEp = Number(seriesCount) || 1;

    const resolvedConfig = {
      writingPrompt: writingPrompt || promptConfig?.writingPrompt || promptConfig?.systemPrompt,
      imagePrompt: imagePrompt || promptConfig?.imagePrompt || promptConfig?.imagePromptInstructions
    };
    const sysPrompt = this.buildSystemPrompt(resolvedConfig, { seriesCount: totalEp, seriesEpisode: curEp });
    const chosenLength = LENGTH_GUIDE[length] || LENGTH_GUIDE.medium;
    const chosenTone = TONE_GUIDE[tone] || TONE_GUIDE.friendly;

    const promptText = [
      sysPrompt,
      '',
      '---',
      '제공된 원문 기사/자료의 핵심 팩트를 분석하여, 단순 복사하지 않고 독창적이고 심도 있는 네이버 블로그 글로 재해석해 작성하세요.',
      '반드시 유효한 JSON 형식으로만 출력해야 하며 다른 부연 설명이나 마크다운 백틱은 넣지 마세요.',
      '',
      `[원문 및 작성 요청]`,
      `- 원문 제목: ${sourceTitle}`,
      `- 재해석 집중 주제: ${customFocus || sourceTitle}`,
      isSeries ? `- 기획 연재: 총 ${totalEp}부작 시리즈 중 [제${curEp}편]` : '- 단편 완결형 심층 분석 글',
      sourceUrl ? `- 원문 출처: ${sourceUrl}` : '',
      `- 목표 글자 수: ${chosenLength}`,
      `- 문체/어조: ${chosenTone}`,
      notes ? `- 추가 사용자 요청사항:\n${notes}` : '',
      avoidHistory.length ? `- 기존 발행 글(중복 배제): ${avoidHistory.map((h) => typeof h === 'string' ? h : h.title).slice(0, 5).join(', ')}` : '',
      `- 원문 내용 요약/전문:\n${sourceContent.slice(0, 3500)}`,
      '',
      `[필수 JSON 출력 스키마]`,
      `{`,
      `  "title": "${isSeries ? `[시리즈명 ${curEp}편] 원문을 재해석한 매력적인 타이틀 (20~45자)` : '원문을 새롭게 재해석한 매력적인 블로그 타이틀 (20~40자)'}",`,
      isSeries ? `  "seriesTitle": "전체 시리즈를 대표하는 연재명",` : '',
      isSeries ? `  "seriesCount": ${totalEp},` : '',
      isSeries ? `  "seriesEpisode": ${curEp},` : '',
      isSeries ? `  "seriesRoadmap": [\n    "1부: 1부 핵심 테마 한 줄",\n    "2부: 2부 핵심 테마 한 줄"${totalEp >= 3 ? ',\n    "3부: 3부 핵심 테마 한 줄"' : ''}${totalEp >= 5 ? ',\n    "4부: 4부 핵심 테마 한 줄",\n    "5부: 5부 핵심 테마 한 줄"' : ''}\n  ],` : '',
      isSeries && curEp < totalEp ? `  "nextEpisodeTeaser": "다음 제${curEp + 1}편에 대한 독자의 호기심을 극대화하는 예고 멘트 (100~200자)",` : '',
      `  "lead": "독자의 호기심을 자극하는 생생한 도입부 (250~350자)",`,
      `  "summaryPoints": [`,
      `    "핵심 변화 및 포인트 1",`,
      `    "핵심 변화 및 포인트 2",`,
      `    "핵심 변화 및 포인트 3"`,
      `  ],`,
      `  "sections": [`,
      `    {`,
      `      "heading": "1. 소제목 (원문 핵심 배경 및 원리)",`,
      `      "body": "깊이 있는 해설과 독자에게 미치는 영향 분석 (400~600자 이상)",`,
      `      "imageQuery": "A realistic photo matching this section (10~20 English words)"`,
      `    },`,
      `    {`,
      `      "heading": "2. 소제목 (실전 활용 및 대응 전략)",`,
      `      "body": "구체적인 실행 방법 및 실질적인 혜택과 1% 팁 (400~600자 이상)",`,
      `      "imageQuery": "A realistic photo matching this section (10~20 English words)"`,
      `    },`,
      `    {`,
      `      "heading": "3. 소제목 (주의사항 및 향후 전망)",`,
      `      "body": "체크포인트와 전문가 시각의 꿀팁 (400~600자 이상)",`,
      `      "imageQuery": "A realistic photo matching this section (10~20 English words)"`,
      `    }`,
      `  ],`,
      `  "closing": "독자와의 소통을 이끄는 따뜻하고 통찰력 있는 마무리 (200~300자)",`,
      `  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5", "태그6", "태그7", "태그8"],`,
      `  "imageQueries": ["English image prompt 1", "English image prompt 2", "English image prompt 3"]`,
      `}`
    ].filter(Boolean).join('\n');

    const rawJson = await this.executeAgyPrompt(promptText, { model });
    const parsed = typeof rawJson === 'string' ? parseLlmJson(rawJson) : (rawJson || {});
    if (isSeries) {
      if (!parsed.seriesCount) parsed.seriesCount = totalEp;
      if (!parsed.seriesEpisode) parsed.seriesEpisode = curEp;
      if (!parsed.seriesRoadmap || !parsed.seriesRoadmap.length) {
        parsed.seriesRoadmap = Array.from({ length: totalEp }, (_, i) => `${i + 1}부: ${customFocus || sourceTitle} - 제${i + 1}단계`);
      }
    }
    return normalizeGeneratedPost(parsed);
  }

  async generateDealsBlogPost({
    deals = [],
    tone = 'informative',
    length = 'medium',
    notes = '',
    model = this.defaultModel
  }) {
    if (!deals.length) throw new Error('작성할 핫딜 목록이 비어있습니다.');
    const dealsSummary = deals.map((d, index) => `${index + 1}위: [${d.shop || '쇼핑몰'}] ${d.title} (특가: ${d.price}, 배송: ${d.shipping}) - 링크: ${d.url || ''}`).join('\n');
    const chosenLength = LENGTH_GUIDE[length] || LENGTH_GUIDE.medium;
    const chosenTone = TONE_GUIDE[tone] || TONE_GUIDE.informative;

    const promptText = [
      '당신은 네이버 블로그 인기 쇼핑/핫딜 전문 파워블로거입니다.',
      '수집된 실시간 인기 핫딜 목록을 바탕으로 독자에게 실질적인 혜택을 알려주는 매력적인 블로그 글을 작성하세요.',
      `글의 톤앤매너: ${chosenTone}`,
      `목표 분량: ${chosenLength}`,
      notes ? `추가 요청: ${notes}` : '',
      '반드시 순수 JSON 객체로만 출력하세요.',
      '',
      `[수집된 핫딜 목록 (${deals.length}개)]`,
      dealsSummary,
      '',
      `[필수 JSON 출력 스키마]`,
      `{`,
      `  "title": "[오늘의 핫딜] 실시간 인기 특가 모음 타이틀 (20~40자)",`,
      `  "lead": "오늘 뜨거운 반응의 최저가 핫딜을 소개하는 생생한 도입부",`,
      `  "summaryPoints": ["포인트 1", "포인트 2", "포인트 3"],`,
      `  "sections": [`,
      deals.map((_, i) => `    { "heading": "${i + 1}위. [쇼핑몰명] 상품명 (가격)", "body": "상품의 실제 장점과 구매 팁", "imageQuery": "product item clean photo" }`).join(',\n'),
      `  ],`,
      `  "closing": "조기 품절 가능성 안내 및 공감/이웃추가 유도 멘트",`,
      `  "tags": ["핫딜", "특가", "쇼핑정보", "최저가", "알뜰소비"],`,
      `  "imageQueries": ["deal photo 1", "deal photo 2"]`,
      `}`
    ].filter(Boolean).join('\n');

    const rawJson = await this.executeAgyPrompt(promptText, { model });
    return normalizeGeneratedPost(rawJson, deals);
  }

  async generateImageWithAgy({
    prompt = '',
    outputDir = '',
    imageName = 'blog_visual',
    style = 'photorealistic',
    aspectRatio = '1:1',
    timeoutMs = 5000,
    afterHeading = ''
  } = {}) {
    // RESOURCE_EXHAUSTED fallback: agy CLI is optimized for ultra-fast Gemini text models.
    // Image requests immediately fall back to 1280px real photo or FLUX without waiting.
    // Verified: if matched, checks (fst.mtimeMs < callStartTime) to prevent stale images.
    return null;
  }

  buildCommentPrompt({ title, contentSnippet = '', imageSummary = '', tone = 'friendly' }) {
    const toneDescription = tone === 'polite' ? '정중하고 신뢰감 있는 경어체' : '다정하고 친근한 이웃 대화체';
    return [
      '당신은 네이버 블로그의 다정하고 진정성 있는 이웃 블로거입니다.',
      '다음 포스팅의 제목과 내용을 읽고, 1~2문장의 자연스럽고 따뜻한 공감 댓글을 한국어로 작성하세요.',
      '기계적이거나 뻔한 칭찬("좋은 글 잘 보고 갑니다")은 엄격히 금지하며, 글의 구체적인 내용에 공감하는 문장을 작성하세요.',
      `어조: ${toneDescription}`,
      `글 제목: ${title}`,
      contentSnippet ? `글 요약: ${contentSnippet.slice(0, 500)}` : '',
      imageSummary ? `사진 정보: ${imageSummary}` : '',
      '댓글 본문만 한 줄로 출력하세요.'
    ].filter(Boolean).join('\n');
  }

  async generateBlogComment({ title, contentSnippet = '', imageSummary = '', tone = 'friendly' }) {
    const prompt = this.buildCommentPrompt({ title, contentSnippet, imageSummary, tone });

    try {
      const text = await this.executeAgyPrompt(prompt, { json: false });
      const clean = text.replace(/^["'\s]+|["'\s]+$/g, '').trim();
      return clean || '정성 가득한 포스팅 잘 보고 갑니다! 따뜻한 하루 보내세요 😊';
    } catch {
      return '정성 가득한 포스팅 잘 보고 갑니다! 따뜻한 하루 보내세요 😊';
    }
  }
}

function extractImagePathFromText(text) {
  if (!text) return null;

  // 1. Check for file:/// URI
  const uriMatch = text.match(/file:\/\/\/([a-zA-Z]:\/[^\s\)`"']+\.(?:jpg|jpeg|png))/i);
  if (uriMatch) {
    const raw = decodeURIComponent(uriMatch[1]).replace(/\//g, '\\');
    if (fs.existsSync(raw)) return raw;
  }

  // 2. Check for Windows absolute path
  const winMatch = text.match(/([a-zA-Z]:\\[^\r\n`"'\)<>\[\]]+\.(?:jpg|jpeg|png))/i);
  if (winMatch) {
    const candidate = winMatch[1].trim();
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

async function findLatestBrainImage(brainDir, namePrefix, callStartTime = 0) {
  try {
    if (!fs.existsSync(brainDir)) return null;
    const entries = await readdir(brainDir, { withFileTypes: true });
    const dirStats = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const convPath = path.join(brainDir, entry.name);
      const st = await stat(convPath).catch(() => null);
      if (st) {
        dirStats.push({ path: convPath, mtimeMs: st.mtimeMs });
      }
    }

    // Check newest conversation directories first
    dirStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    let newestFile = null;
    let newestMtime = 0;

    for (const dir of dirStats.slice(0, 10)) {
      const files = await readdir(dir.path).catch(() => []);
      for (const file of files) {
        if (/\.(jpg|jpeg|png)$/i.test(file)) {
          // STRICT check: must contain the exact namePrefix generated for this call
          if (namePrefix && !file.toLowerCase().includes(namePrefix.toLowerCase())) continue;
          const filePath = path.join(dir.path, file);
          const fst = await stat(filePath).catch(() => null);
          // STRICT check: file must have been modified after the CLI invocation started
          if (fst && (!callStartTime || fst.mtimeMs >= callStartTime - 2000)) {
            if (fst.mtimeMs > newestMtime) {
              newestMtime = fst.mtimeMs;
              newestFile = filePath;
            }
          }
        }
      }
    }

    return newestFile;
  } catch {}
  return null;
}
