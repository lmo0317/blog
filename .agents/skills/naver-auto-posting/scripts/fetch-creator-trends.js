#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'file:///D:/work/dev/blog/node_modules/playwright/index.js';
const { chromium } = pkg;

const DEFAULT_CATEGORIES = [
  '건강·의학',
  '요리·레시피',
  '인테리어·DIY',
  '상품리뷰',
  '일상·생각',
  'IT·컴퓨터'
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    categories: DEFAULT_CATEGORIES,
    limit: 20,
    outputFile: '',
    format: 'summary'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--categories' && i + 1 < args.length) {
      options.categories = args[++i].split(',').map((c) => c.trim()).filter(Boolean);
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[++i], 10) || 20;
    } else if (arg === '--output' && i + 1 < args.length) {
      options.outputFile = args[++i];
    } else if (arg === '--format' && i + 1 < args.length) {
      options.format = args[++i];
    }
  }

  return options;
}

function loadPublishedIndex() {
  const indexPath = 'D:/work/dev/blog/.agents/skills/naver-auto-posting/references/published-posts/INDEX.md';
  if (!fs.existsSync(indexPath)) return [];
  const text = fs.readFileSync(indexPath, 'utf8');
  const lines = text.split('\n');
  const published = [];
  for (const line of lines) {
    if (line.startsWith('| 2026-')) {
      const cols = line.split('|').map(c => c.trim());
      if (cols.length >= 6) {
        published.push({
          date: cols[1],
          title: cols[2],
          keywords: cols[3],
          claim: cols[4]
        });
      }
    }
  }
  return published;
}

function isKeywordOverlapping(query, publishedList) {
  const q = query.replace(/\s+/g, '').toLowerCase();
  for (const p of publishedList) {
    const fullText = (p.title + ' ' + p.keywords + ' ' + p.claim).replace(/\s+/g, '').toLowerCase();
    if (q.length >= 3 && fullText.includes(q)) {
      return { overlap: true, post: p.title };
    }
    const tokens = query.split(/\s+/).filter(t => t.length >= 2);
    for (const t of tokens) {
      if (['마그네슘', '비타민', '텀블러', '전자레인지', '세탁조', '샤워부스', '도마', '에어프라이어', '창문틀', '인덕션'].includes(t) && fullText.includes(t)) {
        return { overlap: true, post: p.title };
      }
    }
  }
  return { overlap: false };
}

export async function fetchCreatorAdvisorTrends(options = {}) {
  const {
    categories = DEFAULT_CATEGORIES,
    limit = 20,
    blogId = 'lmo0317'
  } = options;

  const sessionPath = 'D:/work/dev/blog/apps/engagement/.playwright/naver-session.json';
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Naver session state file not found at: ${sessionPath}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionPath,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    const targetUrl = `https://creator-advisor.naver.com/naver_blog/${encodeURIComponent(blogId)}/trends#trend-by-categories`;
    console.log(`[fetch-trends] Navigating to ${targetUrl} ...`);
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(1500);

    const detectedDate = await page.evaluate(() => {
      const textNodes = Array.from(document.querySelectorAll('button, span, div, p'))
        .map(el => (el.innerText || el.textContent || '').trim())
        .filter(t => /^\d{4}\.\s*\d{2}\.\s*\d{2}\.?$/.test(t));
      if (textNodes.length > 0) {
        const match = textNodes[0].match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})/);
        if (match) return `${match[1]}-${match[2]}-${match[3]}`;
      }
      return null;
    });

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fallbackDate = yesterday.toISOString().slice(0, 10);
    const targetDate = detectedDate || fallbackDate;
    console.log(`[fetch-trends] Target Date: ${targetDate} (detected: ${detectedDate})`);

    // Chunk categories into batches of at most 5
    const chunkedCategories = [];
    for (let i = 0; i < categories.length; i += 5) {
      chunkedCategories.push(categories.slice(i, i + 5));
    }

    const allData = [];
    for (const chunk of chunkedCategories) {
      const categoriesParam = encodeURIComponent(chunk.join(','));
      const apiUrl = `https://creator-advisor.naver.com/api/v6/trend/category?categories=${categoriesParam}&contentType=text&date=${targetDate}&hasRankChange=true&interval=day&limit=${limit}&service=naver_blog`;

      console.log(`[fetch-trends] Requesting chunk (${chunk.join(', ')}) ...`);
      const trendResult = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url);
          return await res.json();
        } catch (e) {
          return { error: e.message };
        }
      }, apiUrl);

      if (trendResult && trendResult.data) {
        allData.push(...trendResult.data);
      } else {
        console.warn(`Warning on chunk ${chunk.join(', ')}:`, trendResult?.message || trendResult);
      }
    }

    const publishedList = loadPublishedIndex();
    const trendsByCategory = {};
    const candidateRecommendations = [];

    for (const item of allData) {
      const catName = item.category;
      trendsByCategory[catName] = (item.queryList || []).map((q) => {
        const overlapCheck = isKeywordOverlapping(q.query, publishedList);
        const enriched = {
          rank: q.rank,
          query: q.query,
          rankChange: q.rankChange,
          isNew: q.rankChange === null || q.rankChange === undefined,
          ratioPercent: (q.ratio * 100).toFixed(4),
          rawRatio: q.ratio,
          isOverlap: overlapCheck.overlap,
          overlappingPost: overlapCheck.post || null
        };

        if (!overlapCheck.overlap) {
          const isPracticalTopic = /효능|레시피|방법|찌는법|정리|세척|보관|꿀팁|아이템|추천|출시|해지|버리는/i.test(q.query);
          let priorityScore = (20 - q.rank) * 2;
          if (enriched.isNew) priorityScore += 15;
          if (q.rankChange > 0) priorityScore += Math.min(q.rankChange, 10);
          if (isPracticalTopic) priorityScore += 20;

          candidateRecommendations.push({
            category: catName,
            query: q.query,
            rank: q.rank,
            isNew: enriched.isNew,
            rankChange: q.rankChange,
            ratioPercent: enriched.ratioPercent,
            priorityScore,
            isPracticalTopic
          });
        }

        return enriched;
      });
    }

    candidateRecommendations.sort((a, b) => b.priorityScore - a.priorityScore);

    return {
      date: targetDate,
      blogId,
      categoriesCount: categories.length,
      trends: trendsByCategory,
      recommendedCandidates: candidateRecommendations.slice(0, 10),
      fetchedAt: new Date().toISOString()
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs();
  console.log(`[fetch-trends] Fetching trends for categories:`, options.categories);
  const data = await fetchCreatorAdvisorTrends(options);

  if (options.outputFile) {
    fs.mkdirSync(path.dirname(path.resolve(options.outputFile)), { recursive: true });
    fs.writeFileSync(path.resolve(options.outputFile), JSON.stringify(data, null, 2), 'utf8');
    console.log(`[fetch-trends] Saved full JSON output to: ${options.outputFile}`);
  }

  console.log(`\n======================================================`);
  console.log(`📊 네이버 크리에이터 어드바이저 실시간 카테고리 트렌드 (${data.date})`);
  console.log(`======================================================`);

  for (const [cat, queries] of Object.entries(data.trends)) {
    console.log(`\n[카테고리: ${cat}]`);
    for (const q of queries.slice(0, 7)) {
      const changeStr = q.isNew ? '🔥 NEW' : (q.rankChange > 0 ? `▲ +${q.rankChange}` : (q.rankChange < 0 ? `▼ ${q.rankChange}` : '-'));
      const statusStr = q.isOverlap ? `[기발행: ${q.overlappingPost.slice(0, 15)}...]` : '✓ 신규추천';
      console.log(`  ${q.rank.toString().padStart(2, ' ')}위 | ${q.query.padEnd(25, ' ')} | 변동: ${changeStr.padEnd(8, ' ')} | 점유율: ${q.ratioPercent}% | ${statusStr}`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`🎯 추천 포스팅 후보 TOP 5 (실시간 트렌드 급상승 & 미발행 검증)`);
  console.log(`======================================================`);
  data.recommendedCandidates.slice(0, 5).forEach((c, idx) => {
    const trendNote = c.isNew ? '🔥 신규 진입' : (c.rankChange > 0 ? `▲ +${c.rankChange} 순위 급상승` : '상위권 유지');
    console.log(`${idx + 1}. [${c.category}] "${c.query}" (순위 ${c.rank}위, 점유율 ${c.ratioPercent}%, ${trendNote})`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[fetch-trends] Error:', err);
    process.exit(1);
  });
}
