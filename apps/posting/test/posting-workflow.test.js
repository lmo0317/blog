import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { PostHistoryStore } from '../lib/post-history.js';
import { parseMarkdownBatch } from '../lib/markdown-batch.js';

const appRoot = path.resolve(import.meta.dirname, '..');

test('auto posting UI uses topic and free-form prompt with explicit immediate-publish consent', async () => {
  const html = await readFile(path.join(appRoot, 'public', 'index.html'), 'utf8');
  assert.match(html, /id="autoPostTopic"/);
  assert.match(html, /id="autoPostBrief"/);
  assert.doesNotMatch(html, /알구몬 핫딜/);
  assert.doesNotMatch(html, /id="dealsModeContainer"/);
  assert.match(html, /id="autoPublishNow"/);
  assert.match(html, /id="autoPostProgress"/);
  assert.doesNotMatch(html, /id="articleImageModelSelect"/);
  assert.doesNotMatch(html, /id="articleModelSelect"/);
  assert.match(html, /로그인된 GPT 계정 사용/);
  assert.match(html, /이미지 3장 자동 생성/);
  assert.match(html, /id="settingsImageModelCardsGrid"/);
  assert.match(html, /id="openPromptJsonBtn"/);
  assert.match(html, /id="promptJsonEditor"/);
  assert.match(html, /id="usePromptPublishBtn"/);
  assert.match(html, /실제 사용 예제/);
  assert.match(html, /직장인을 위한 아침 스트레칭/);
  assert.doesNotMatch(html, /첫 번째 주제/);
});

test('auto posting client routes the unified user prompt through draft, image, and publish flow', async () => {
  const script = await readFile(path.join(appRoot, 'public', 'app.js'), 'utf8');
  assert.match(script, /api\('\/api\/blog\/draft'/);
  assert.doesNotMatch(script, /inputMode === 'link'/);
  assert.match(script, /publishCurrentDraft\(\)/);
  assert.match(script, /state\.images = data\.autoImages \|\| \[\]/);
  assert.match(script, /3\/3 생성된 글과 이미지를 네이버 블로그에 발행/);
  assert.match(script, /generation-status/);
  assert.match(script, /경과 시간/);
  assert.match(script, /오류 발생/);
  assert.match(script, /\/api\/image-models\/select/);
  assert.match(script, /\/api\/image-models\/download/);
  assert.match(script, /function resetPublishedPostWorkspace\(\)/);
  assert.match(script, /resetPublishedPostWorkspace\(\)/);
  assert.match(script, /promptConfig/);
  assert.match(script, /api\('\/api\/blog\/prompt-template'/);
});

test('draft endpoint detects a URL inside the user prompt for automatic reinterpretation', async () => {
  const server = await readFile(path.join(appRoot, 'server.js'), 'utf8');
  assert.match(server, /promptUrl = `\$\{topic\}\\n\$\{notes\}`\.match/);
  assert.match(server, /generateArticleRewriteBlogPost/);
  assert.match(server, /promptWithoutUrl/);
  assert.match(server, /normalizePromptConfig/);
  assert.match(server, /promptConfig/);
  assert.doesNotMatch(server, /rememberBatchImports/);
  assert.doesNotMatch(server, /findSimilarImport/);
});

test('posting drafts use the logged-in GPT account instead of local Gemma or ComfyUI', async () => {
  const server = await readFile(path.join(appRoot, 'server.js'), 'utf8');
  const client = await readFile(path.join(appRoot, 'lib', 'codex-account-client.js'), 'utf8');
  assert.match(server, /new CodexAccountClient/);
  assert.match(server, /codexAccountClient\.generateBlogPost/);
  assert.match(server, /codexAccountClient\.generateImagesForPost/);
  assert.match(server, /engineType: 'chatgpt_account'/);
  assert.match(client, /auth\.json/);
  assert.match(client, /'exec', '--ephemeral'/);
  assert.match(client, /공백 제외 최소 1,500자/);
  assert.match(client, /이미지 생성 계획은 정확히 3개/);
  assert.match(client, /이미지를 정확히 1장 생성/);
});

test('editable prompt JSON exposes the complete writing and image instructions', async () => {
  const llm = await readFile(path.join(appRoot, 'lib', 'llm.js'), 'utf8');
  assert.match(llm, /DEFAULT_PROMPT_CONFIG/);
  assert.match(llm, /userPromptTemplate/);
  assert.match(llm, /imagePromptInstructions/);
  assert.match(llm, /각 본문 section마다/);
  assert.match(llm, /확인되지 않은 사실, 수치, 사용 경험은 만들어내지 않는다/);
  assert.match(llm, /노출, 속옷, 수영복/);
});

test('image model catalog exposes online, Z-Image-Turbo, and FLUX local choices', async () => {
  const manager = await readFile(path.join(appRoot, 'lib', 'image-model-manager.js'), 'utf8');
  const worker = await readFile(path.join(appRoot, '.image-engine', 'worker.py'), 'utf8');
  assert.match(manager, /Tongyi-MAI\/Z-Image-Turbo/);
  assert.match(manager, /black-forest-labs\/FLUX\.2-klein-4B/);
  assert.match(manager, /UV_DEFAULT_INDEX:'https:\/\/download\.pytorch\.org\/whl\/cu128'/);
  assert.match(manager, /torch==2\.10\.0\+cu128/);
  assert.doesNotMatch(worker, /ComfyUI/i);
  const generator = await readFile(path.join(appRoot, 'lib', 'ai-image-generator.js'), 'utf8');
  assert.match(generator, /strictly family-friendly editorial still life/);
  assert.match(generator, /ABSOLUTELY NO PEOPLE/);
  assert.match(generator, /HUMAN_IMAGE_WORDS/);
  assert.match(manager, /await this\.select\(id\)/);
  assert.match(manager, /이미지 생성이 5분을 초과해 자동 중단/);
});

test('Gemma 4 server disables reasoning so JSON output is not consumed by hidden thinking', async () => {
  const server = await readFile(path.join(appRoot, 'lib', 'embedded-llama.js'), 'utf8');
  assert.match(server, /'--reasoning-budget', '0'/);
  assert.match(server, /'--chat-template-kwargs', '\{"enable_thinking":false\}'/);
  assert.match(server, /waitForReady\(120000\)/);
  assert.match(server, /'-c', '8192'/);
});

test('posting app shares the single local LLM port without duplicate model loading', async () => {
  const server = await readFile(path.join(appRoot, 'server.js'), 'utf8');
  const embedded = await readFile(path.join(appRoot, 'lib', 'embedded-llama.js'), 'utf8');
  assert.match(server, /port: 8089/);
  assert.match(embedded, /shared: true/);
});

test('LLM client retries a truncated structured response with a larger output budget', async () => {
  const script = await readFile(path.join(appRoot, 'lib', 'llm.js'), 'utf8');
  assert.match(script, /async callJsonCompletion\(bodyPayload\)/);
  assert.match(script, /max_tokens: Math\.max\(Number\(bodyPayload\.max_tokens \|\| 4096\), 6144\)/);
  assert.match(script, /JSON이 중간에 잘렸거나 문법이 올바르지 않았습니다/);
});

test('published post history persists and detects substantially repeated content', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'post-history-'));
  try {
    const store = new PostHistoryStore(path.join(dir, 'history.json'));
    await store.add({ title: '아침 피로를 줄이는 건강 루틴', content: '충분한 수면과 가벼운 스트레칭으로 활력을 회복하는 방법' });
    assert.equal((await store.recent()).length, 1);
    assert.ok(await store.findSimilar({ title: '아침 피로를 줄이는 건강 루틴', content: '충분한 수면과 가벼운 스트레칭으로 활력을 회복하는 방법' }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('markdown batch parser supports labeled and heading post formats', () => {
  const labeled = parseMarkdownBatch('주제: 첫 글\n내용:\n첫 내용\n\n---\n\n주제: 둘째 글\n내용:\n둘째 내용');
  assert.deepEqual(labeled.map((item) => item.topic), ['첫 글', '둘째 글']);
  const headings = parseMarkdownBatch('# 세 번째 글\n세 번째 내용\n\n# 네 번째 글\n네 번째 내용');
  assert.deepEqual(headings.map((item) => item.topic), ['세 번째 글', '네 번째 글']);
});
