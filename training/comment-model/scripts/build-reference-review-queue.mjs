import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { validateBlogComment } from '../../../apps/engagement/lib/comment-prompt.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const outputPath = path.join(root, 'training', 'comment-model', 'data', 'staged', 'reference-review-queue.jsonl');
const reportPath = path.join(root, 'training', 'comment-model', 'data', 'reports', 'reference-review-queue.json');
const llamaUrl = process.env.COMMENT_TEACHER_URL || 'http://127.0.0.1:8089/v1/chat/completions';
const perCategoryArg = process.argv.find((arg) => arg.startsWith('--per-category='));
const perCategory = Math.min(Math.max(Number(perCategoryArg?.split('=')[1]) || 4, 1), 25);

const categories = [
  ['맛집/카페', '직접 방문 맛집 카페 후기'],
  ['여행', '국내 여행 실제 방문 후기'],
  ['살림/요리', '살림 요리 생활 꿀팁 후기'],
  ['육아/일상', '육아 일상 실제 경험 기록'],
  ['IT/제품', 'IT 제품 실사용 후기'],
  ['뷰티/패션', '뷰티 패션 직접 사용 후기'],
  ['반려동물', '반려동물 생활 경험 후기'],
  ['취미/교육', '취미 교육 직접 해본 후기']
];

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w.-]+/g, ' ')
    .replace(/(?:01[016789])-?\d{3,4}-?\d{4}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function extractJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Teacher did not return a JSON object.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function collectSearchCards(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const collected = [];
  for (const [category, query] of categories) {
    await page.goto(`https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForTimeout(1200);
    for (let scroll = 0; scroll < 8; scroll += 1) {
      const rows = await page.evaluate(() => {
        // Naver search uses generated class names. Group anchors by numeric post
        // URL and infer title/summary from the short and long text variants.
        const groups = new Map();
        for (const anchor of document.querySelectorAll('a[href*="blog.naver.com"]')) {
          const href = (anchor.href || '').split('?')[0];
          if (!/^https:\/\/blog\.naver\.com\/[^/]+\/\d+$/i.test(href)) continue;
          const text = (anchor.innerText || anchor.textContent || '').replace(/새 창 열림/g, '').replace(/\s+/g, ' ').trim();
          if (text.length < 5) continue;
          if (!groups.has(href)) groups.set(href, new Set());
          groups.get(href).add(text);
        }
        return [...groups].map(([href, texts]) => {
          const sorted = [...texts].sort((a, b) => a.length - b.length);
          const title = sorted[0] || '';
          const description = [...sorted].reverse().find((text) => text.length > title.length + 20) || '';
          return { href, title, description };
        }).filter((row) => row.title && row.description);
      });
      for (const row of rows) {
        const sourceFingerprint = fingerprint(row.href.split('?')[0]);
        if (collected.some((item) => item.sourceFingerprint === sourceFingerprint)) continue;
        collected.push({ category, query, sourceFingerprint, title: cleanText(row.title), snippet: cleanText(row.description) });
        if (collected.filter((item) => item.category === category).length >= perCategory) break;
      }
      if (collected.filter((item) => item.category === category).length >= perCategory) break;
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(700);
    }
  }
  await page.close();
  return collected;
}

async function transformWithTeacher(source, index) {
  const prompt = `아래 공개 블로그 검색 요약은 참고 문맥이다. 원문 문장을 복사하지 말고 개인정보나 작성자 식별정보를 제거한 학습 검수 후보를 JSON 하나로 작성하라.

카테고리: ${source.category}
제목: ${source.title}
검색 요약: ${source.snippet}

JSON 필드:
- topic: 원문을 그대로 베끼지 않은 짧은 주제
- facts: 검색 요약에서 확실히 확인되는 사실만 바꿔 쓴 문자열 배열 2~5개
- authorExperience: 작성자가 직접 했다고 명확한 행동만 문자열 배열
- forbiddenClaims: 독자가 직접 방문/구매/사용했다고 지어내면 안 되는 주장 배열
- shouldSkip: 근거 부족, 광고 문구뿐임, 민감정보 포함이면 true
- candidateComments: 사실에 근거한 자연스러운 한국어 댓글 2개. 각각 35~100자, 독자의 허위 경험 금지, 홍보/URL/이웃신청/상투적 인사 금지

설명 없이 JSON만 출력하라.`;
  const response = await fetch(llamaUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma-4-12b-it',
      messages: [
        { role: 'system', content: '당신은 한국어 블로그 댓글 학습 데이터 큐레이터다. 입력에 없는 사실을 만들지 않는다.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.25,
      max_tokens: 650,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`Teacher HTTP ${response.status}`);
  const payload = await response.json();
  const parsed = extractJson(payload.choices?.[0]?.message?.content);
  const facts = Array.isArray(parsed.facts) ? parsed.facts.map(cleanText).filter(Boolean).slice(0, 5) : [];
  const comments = Array.isArray(parsed.candidateComments) ? parsed.candidateComments.map(cleanText).filter(Boolean).slice(0, 2) : [];
  const context = { title: cleanText(parsed.topic), contentSnippet: facts.join(' '), imageSummary: '' };
  const checked = comments.map((comment) => ({ comment, validation: validateBlogComment(comment, context, []) }));
  return {
    id: `reference-${String(index + 1).padStart(4, '0')}`,
    sourceType: 'naver-public-search-summary',
    sourcePolicy: 'C',
    sourceFingerprint: source.sourceFingerprint,
    rawStored: false,
    category: source.category,
    topic: cleanText(parsed.topic),
    facts,
    authorExperience: Array.isArray(parsed.authorExperience) ? parsed.authorExperience.map(cleanText).filter(Boolean).slice(0, 4) : [],
    forbiddenClaims: Array.isArray(parsed.forbiddenClaims) ? parsed.forbiddenClaims.map(cleanText).filter(Boolean).slice(0, 5) : [],
    shouldSkip: Boolean(parsed.shouldSkip) || facts.length < 2,
    candidateComments: checked,
    reviewStatus: 'pending',
    approvedForProductionSft: false,
    teacherModel: 'gemma-4-12b-it-qat-q4_0',
    createdAt: new Date().toISOString()
  };
}

const browser = await chromium.launch({ headless: true });
let sources;
try {
  sources = await collectSearchCards(browser);
} finally {
  await browser.close();
}

const queue = [];
const errors = [];
for (let index = 0; index < sources.length; index += 1) {
  try {
    queue.push(await transformWithTeacher(sources[index], index));
    console.log(`[${index + 1}/${sources.length}] ${sources[index].category}: transformed`);
  } catch (error) {
    errors.push({ sourceFingerprint: sources[index].sourceFingerprint, category: sources[index].category, error: error.message });
    console.warn(`[${index + 1}/${sources.length}] ${sources[index].category}: ${error.message}`);
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const body = queue.length ? `${queue.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
fs.writeFileSync(outputPath, body, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify({
  createdAt: new Date().toISOString(),
  requestedPerCategory: perCategory,
  collectedSearchSummaries: sources.length,
  stagedReviewRecords: queue.length,
  automaticallyValidCandidates: queue.reduce((sum, row) => sum + row.candidateComments.filter((item) => item.validation.ok).length, 0),
  pendingHumanReview: queue.length,
  approvedForProductionSft: 0,
  rawSourceStored: false,
  sha256: fingerprint(body),
  errors
}, null, 2)}\n`, 'utf8');
console.log(`Created ${queue.length} pending review records. No record was approved for production SFT.`);
