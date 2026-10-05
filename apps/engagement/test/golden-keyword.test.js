import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGoldenKeyword,
  fetchAutocompleteKeywords,
  fetchExpandedLongtailKeywords,
  discoverGoldenKeywords
} from '../lib/golden-keyword.js';

test('evaluateGoldenKeyword assigns high score to micro-doc and stale posts', () => {
  const serpData = {
    totalCount: 150,
    avgAgeDays: 130,
    titleMatchCount: 1,
    hasBuyWithOwnMoney: false,
    posts: [
      { title: '성수 맛집 탐방', ageDays: 130, isExactMatch: false },
      { title: '성수동 카페거리', ageDays: 120, isExactMatch: true }
    ]
  };

  const evalResult = evaluateGoldenKeyword('성수동 혼밥 맛집', serpData, true);
  assert.equal(evalResult.grade, 'S');
  assert.ok(evalResult.score >= 85, `Score should be >= 85, got ${evalResult.score}`);
  assert.equal(evalResult.isVacant, true);
  assert.equal(evalResult.isNiche, true);
  assert.equal(evalResult.isMicroDoc, true);
  assert.ok(evalResult.tags.some(t => t.includes('문서 150건')));
});

test('evaluateGoldenKeyword penalizes red-ocean high-competition keywords', () => {
  const serpData = {
    totalCount: 1000,
    avgAgeDays: 1,
    titleMatchCount: 5,
    hasBuyWithOwnMoney: true,
    posts: []
  };

  const evalResult = evaluateGoldenKeyword('성수동 맛집', serpData, false);
  assert.ok(evalResult.score < 70, `Score should be < 70, got ${evalResult.score}`);
  assert.equal(evalResult.isVacant, false);
  assert.equal(evalResult.isNiche, false);
});

test('fetchExpandedLongtailKeywords returns expanded list for seed', async () => {
  const result = await fetchExpandedLongtailKeywords('다이어트', 15);
  assert.ok(Array.isArray(result));
  assert.ok(result.length > 0);
  assert.ok(result.some(kw => kw.includes('다이어트')));
});
