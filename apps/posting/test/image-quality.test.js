import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  findBespokeTopicImage,
  generateAiDrawingsForPost,
  CURATED_EDITORIAL_COLLECTIONS
} from '../lib/ai-image-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testOutDir = path.join(__dirname, '..', '.test-images');

test('findBespokeTopicImage maps refrigerator cleaning post to pristine refrigerator photos', async () => {
  const excludeUrls = new Set();
  const excludeTitles = new Set();

  const img1 = await findBespokeTopicImage({
    query: '냉장고 냄새 줄이는 정리법',
    outputDir: testOutDir,
    afterHeading: '1. 냄새의 원인부터 하나씩 찾아요 (상한 식재료 정리)',
    postTitle: '냉장고 냄새 줄이는 정리법',
    excludeUrls,
    excludeTitles
  });

  assert.ok(img1, 'Should find bespoke refrigerator image');
  assert.ok(fs.existsSync(img1.filePath), 'Generated file must exist');
  assert.match(img1.title, /냉장고|선반|식재료/);
  assert.ok(!img1.title.includes('yarn') && !img1.title.includes('crochet'), 'Must not be knitting yarn');

  const img2 = await findBespokeTopicImage({
    query: '냉장고 냄새 줄이는 정리법',
    outputDir: testOutDir,
    afterHeading: '2. 분리 가능한 선반과 서랍 세척 노하우',
    postTitle: '냉장고 냄새 줄이는 정리법',
    excludeUrls,
    excludeTitles
  });

  assert.ok(img2, 'Should find second bespoke refrigerator image');
  assert.notEqual(img1.filePath, img2.filePath, 'Sections must have distinct images');
  assert.notEqual(img1.title, img2.title, 'Sections must have distinct titles');
});

test('findBespokeTopicImage maps foam roller and stretching post to fitness/posture photos, NOT yoga pants', async () => {
  const excludeUrls = new Set();
  const excludeTitles = new Set();

  const img = await findBespokeTopicImage({
    query: '목 통증 완화 폼롤러 스트레칭',
    outputDir: testOutDir,
    afterHeading: '1. 폼롤러 올바른 위치 선정: 후두하근 받치기',
    postTitle: '목 통증 완화 폼롤러 스트레칭, 후두하근 이완 루틴',
    excludeUrls,
    excludeTitles
  });

  assert.ok(img, 'Should find bespoke foam roller image');
  assert.ok(fs.existsSync(img.filePath), 'File must exist');
  assert.match(img.title, /폼롤러|척추|이완|도구/);
});

test('CURATED_EDITORIAL_COLLECTIONS has zero knitting yarn or inappropriate yoga photos', () => {
  const fridgePhotos = CURATED_EDITORIAL_COLLECTIONS.refrigerator_kitchen;
  for (const item of fridgePhotos) {
    assert.ok(!item.url.includes('photo-1584992236310-6edddc08acff'), 'Knitting yarn must not be in refrigerator category');
  }

  const foamPhotos = CURATED_EDITORIAL_COLLECTIONS.neck_shoulder_foamroller;
  for (const item of foamPhotos) {
    assert.ok(!item.url.includes('photo-1599447421416-3414500d18a5'), 'Yoga pants photo must not be in foam roller category');
    assert.ok(!item.url.includes('photo-1544367567-0f2fcb009e0b'), 'Yoga pose photo must not be in foam roller category');
    assert.ok(!item.url.includes('photo-1506126613408-eca07ce68773'), 'Yoga silhouette photo must not be in foam roller category');
  }
});

test('generateAiDrawingsForPost produces 3 distinct, topic-matched images for a blog post', async () => {
  const post = {
    title: '가을 제철 신선한 수꽃게 손질법과 비린내 없이 찌는 노하우',
    sectionHeadings: [
      '1. 싱싱한 꽃게 고르는 법과 10분 기절 노하우',
      '2. 솔을 이용한 등딱지와 다리 사이 뻘 세척법',
      '3. 장이 흐르지 않게 찌는 핵심 비결: 배가 하늘로!'
    ]
  };

  const images = await generateAiDrawingsForPost(post, testOutDir, { style: 'photorealistic' });
  assert.equal(images.length, 3);

  const titles = new Set(images.map((img) => img.title));
  assert.equal(titles.size, 3, 'All 3 images must be completely distinct');

  for (const img of images) {
    assert.ok(fs.existsSync(img.filePath), `File ${img.filePath} must exist`);
    const stat = fs.statSync(img.filePath);
    assert.ok(stat.size > 20000, `Image file must be substantial (>20KB), got ${stat.size}`);
  }
});
