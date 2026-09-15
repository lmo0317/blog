import test from 'node:test';
import assert from 'node:assert/strict';
import { AgyClient, AGY_GEMINI_MODELS } from '../lib/agy-client.js';
import { parseLlmJson } from '../lib/llm.js';

test('AgyClient exposes Gemini models catalog and defaults to gemini-3.8-flash-high', () => {
  const client = new AgyClient();
  const models = client.getModels();
  assert.ok(Array.isArray(models));
  assert.ok(models.length >= 3);
  const flash = models.find((m) => m.id === 'gemini-3.8-flash-high');
  assert.ok(flash);
  assert.match(flash.name, /Gemini 3.8 Flash/);
  assert.equal(client.defaultModel, 'gemini-3.8-flash-high');
});
test('AgyClient parseLlmJson parses various JSON response formats cleanly', () => {
  // Plain JSON
  const plain = parseLlmJson('{"title":"테스트 제목","sections":[{"heading":"소제목","body":"본문"}]}');
  assert.equal(plain.title, '테스트 제목');
  assert.equal(plain.sections.length, 1);

  // Markdown code fence JSON
  const fenced = parseLlmJson('```json\n{"title":"마크다운 펜스 제목","sections":[]}\n```');
  assert.equal(fenced.title, '마크다운 펜스 제목');

  // Markdown code fence without language
  const unfenced = parseLlmJson('```\n{"title":"일반 코드블럭"}\n```');
  assert.equal(unfenced.title, '일반 코드블럭');

  // Leading text before JSON
  const leading = parseLlmJson('다음은 생성된 JSON입니다:\n{"title":"앞뒤 잡음 제거"}');
  assert.equal(leading.title, '앞뒤 잡음 제거');
});

test('AgyClient builds comprehensive Naver blog draft system prompt', () => {
  const client = new AgyClient();
  const prompt = client.buildSystemPrompt();

  assert.match(prompt, /네이버 블로그 고품질 작성 3대 핵심 원칙/);
  assert.match(prompt, /겉핥기식 압축 금지/);
  assert.match(prompt, /체계적인 1, 2, 3 구조화/);
  assert.match(prompt, /스마트에디터/);
});

test('AgyClient checks agy availability without throwing', async () => {
  const client = new AgyClient();
  const available = await client.isAvailable();
  assert.equal(typeof available, 'boolean');
});

test('AgyClient builds multi-part series prompt directives and injects depth criteria', () => {
  const client = new AgyClient();
  const seriesPrompt = client.buildSystemPrompt(null, { seriesCount: 3, seriesEpisode: 2 });
  assert.match(seriesPrompt, /3부작 기획 연재/);
  assert.match(seriesPrompt, /제2편/);
  assert.match(seriesPrompt, /seriesRoadmap/);
  assert.match(seriesPrompt, /nextEpisodeTeaser/);
  assert.match(seriesPrompt, /구체적 수치/);
  assert.match(seriesPrompt, /과학적\/실전 메커니즘/);
});
