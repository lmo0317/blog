import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGoldenKeyword,
  estimateDemand,
  fetchExpandedLongtailKeywords
} from '../lib/golden-keyword.js';

const serp = (overrides) => ({
  checked: true,
  totalCount: 150,
  totalCapped: false,
  avgAgeDays: 200,
  titleMatchCount: 1,
  freshCount: 0,
  hasBuyWithOwnMoney: false,
  posts: [],
  ...overrides
});

test('searched keyword with few, stale, untargeted posts is golden (S)', () => {
  const result = evaluateGoldenKeyword('성수동 혼밥 맛집', serp(), { rank: 1, hits: 3 });
  assert.equal(result.grade, 'S');
  assert.equal(result.gradeLabel, '황금');
  assert.equal(result.isMicroDoc, true);
  assert.equal(result.isVacant, true);
  assert.equal(result.docCountText, '150건');
  assert.ok(result.reasons.some((reason) => reason.text.includes('150건')));
  assert.ok(result.reasons[0].text.startsWith('검색 수요 높음'));
});

test('easy competition alone is not golden when nobody searches for it', () => {
  const result = evaluateGoldenKeyword('성수동 혼밥 맛집 후기 정리', serp(), { rank: Infinity, hits: 0 });
  assert.notEqual(result.grade, 'S');
  assert.notEqual(result.grade, 'A');
  assert.equal(result.demand.level, '낮음');
});

test('red-ocean keyword is graded hard to rank (C)', () => {
  const result = evaluateGoldenKeyword('성수동 맛집', serp({ totalCount: 1000, totalCapped: true, avgAgeDays: 2, titleMatchCount: 9, freshCount: 6 }), { rank: 1, hits: 4 });
  assert.equal(result.grade, 'C');
  assert.equal(result.docCountText, '1,000건 이상');
  assert.ok(result.reasons.some((reason) => !reason.good && reason.text.includes('최근 7일')));
});

test('unreadable search results are marked failed, never scored with guesses', () => {
  const result = evaluateGoldenKeyword('아무 키워드', { checked: false, totalCount: 0, posts: [] }, { rank: 1, hits: 1 });
  assert.equal(result.grade, 'X');
  assert.equal(result.score, 0);
  assert.equal(result.docCountText, '확인 실패');
});

test('demand estimate follows autocomplete placement', () => {
  assert.equal(estimateDemand({ rank: 1, hits: 1 }).level, '높음');
  assert.equal(estimateDemand({ rank: 8, hits: 1 }).level, '보통');
  assert.equal(estimateDemand({ rank: Infinity, hits: 0 }).level, '낮음');
  assert.ok(estimateDemand({ rank: 8, hits: 3 }).score > estimateDemand({ rank: 8, hits: 1 }).score);
});

test('fetchExpandedLongtailKeywords returns real searched keywords for a seed', async () => {
  const result = await fetchExpandedLongtailKeywords('다이어트', 15);
  assert.ok(Array.isArray(result));
  assert.ok(result.length > 0);
  assert.ok(result.some((keyword) => keyword.includes('다이어트')));
  assert.ok(result.every((keyword) => !/\s[ㄱ-ㅎ]$/.test(keyword)));
});
