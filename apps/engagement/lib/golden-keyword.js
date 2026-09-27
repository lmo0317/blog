import { normalizeAutocompleteKeywords } from './naver.js';

const INTENT_SUFFIXES = [
  '추천',
  '후기',
  '비용',
  '방법',
  '준비물',
  '순위',
  '가격',
  '장단점',
  '꿀팁',
  '비교',
  '주의사항',
  '식단',
  '코스',
  '초보',
  '정리'
];

/**
 * Fetch real-time search suggestions from Naver Autocomplete (Zero API Key)
 */
export async function fetchAutocompleteKeywords(keyword, limit = 15) {
  const clean = String(keyword || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  try {
    const params = new URLSearchParams({
      q: clean,
      con: '1',
      frm: 'nv',
      ans: '2',
      r_format: 'json',
      r_enc: 'UTF-8',
      r_unicode: '0',
      t_koreng: '1',
      run: '2',
      rev: '4',
      q_enc: 'UTF-8',
      st: '100'
    });
    const res = await fetch(`https://ac.search.naver.com/nx/ac?${params}`, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://search.naver.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const json = await res.json();
    return normalizeAutocompleteKeywords(json, clean, limit);
  } catch {
    return [];
  }
}

/**
 * Generate natural Korean search query variations
 */
export function generateIntentKeywords(seedKeyword, count = 10) {
  const clean = String(seedKeyword || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const results = [];
  for (const suffix of INTENT_SUFFIXES) {
    if (!clean.includes(suffix)) {
      results.push(`${clean} ${suffix}`);
    }
    if (results.length >= count) break;
  }
  return results;
}

/**
 * Parse top blog posts on Naver to evaluate recency and title match rate
 */
export async function analyzeSerpCompetition(keyword) {
  const clean = String(keyword || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { totalPosts: 0, posts: [], avgAgeDays: 0, titleMatchCount: 0 };

  const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(clean)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.naver.com/',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { totalPosts: 0, posts: [], avgAgeDays: 0, titleMatchCount: 0 };
    const html = await res.text();

    // Extract unique blog post links and titles
    const postLinks = [...html.matchAll(/<a[^>]+href="([^"]*(?:blog\.naver\.com\/[a-zA-Z0-9_.-]+\/\d+|m\.blog\.naver\.com\/[a-zA-Z0-9_.-]+\/\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const seenUrls = new Set();
    const posts = [];
    for (const p of postLinks) {
      const href = p[1].split('?')[0];
      const text = p[2].replace(/<[^>]+>/g, ' ').replace(/새 창 열림/g, '').replace(/\s+/g, ' ').trim();
      if (text.length > 5 && !seenUrls.has(href)) {
        seenUrls.add(href);
        posts.push({ href, title: text });
      }
      if (posts.length >= 10) break;
    }

    // Extract dates from HTML
    const dateMatches = [...html.matchAll(/(\d{4}\.\d{1,2}\.\d{1,2}\.?|\d+\s*(?:시간|일|주|개월|년)\s*전|방금|어제)/g)].map((m) => m[1]);
    const parsedAges = dateMatches.slice(0, 10).map((d) => parseDateToAgeDays(d));
    const validAges = parsedAges.filter((age) => age >= 0);
    const avgAgeDays = validAges.length > 0 ? Math.round(validAges.reduce((a, b) => a + b, 0) / validAges.length) : 30;

    // Check title exact match in top 5 posts
    let titleMatchCount = 0;
    const cleanKw = clean.toLowerCase().replace(/\s+/g, '');
    for (const post of posts.slice(0, 5)) {
      const normTitle = post.title.toLowerCase().replace(/\s+/g, '');
      if (normTitle.includes(cleanKw)) {
        titleMatchCount++;
      }
    }

    return {
      totalPosts: posts.length,
      posts: posts.slice(0, 5),
      avgAgeDays,
      titleMatchCount
    };
  } catch {
    return { totalPosts: 0, posts: [], avgAgeDays: 0, titleMatchCount: 0 };
  }
}

/**
 * Parse Korean relative/absolute date strings to age in days
 */
function parseDateToAgeDays(dateStr = '') {
  const str = String(dateStr).trim();
  if (!str) return -1;
  if (/방금|시간\s*전/i.test(str)) return 0;
  if (/어제/i.test(str)) return 1;
  const daysMatch = str.match(/(\d+)\s*일\s*전/i);
  if (daysMatch) return parseInt(daysMatch[1], 10);
  const weeksMatch = str.match(/(\d+)\s*주\s*전/i);
  if (weeksMatch) return parseInt(weeksMatch[1], 10) * 7;
  const monthsMatch = str.match(/(\d+)\s*개월\s*전/i);
  if (monthsMatch) return parseInt(monthsMatch[1], 10) * 30;
  const yearsMatch = str.match(/(\d+)\s*년\s*전/i);
  if (yearsMatch) return parseInt(yearsMatch[1], 10) * 365;

  const dateMatch = str.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (dateMatch) {
    const year = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1;
    const day = parseInt(dateMatch[3], 10);
    const target = new Date(year, month, day);
    const diff = Math.round((Date.now() - target.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  }
  return -1;
}

/**
 * Calculate Golden Score (0~100) and opportunity assessment
 */
export function evaluateGoldenKeyword(keyword, serpData, isAutocomplete = true) {
  const { avgAgeDays, titleMatchCount } = serpData;

  // Base score
  let score = 70;

  // Real-time demand weight (from autocomplete)
  if (isAutocomplete) score += 12;

  // Stale / Recency bonus (빈집 점수)
  if (avgAgeDays >= 150) {
    score += 15; // 5개월 이상 전 글이 상위 랭크 = 강력한 빈집
  } else if (avgAgeDays >= 60) {
    score += 8; // 2개월 이상 전 글 = 양호한 빈집
  } else if (avgAgeDays <= 2) {
    score -= 14; // 매일 신규 글이 쏟아지는 초경쟁 레드오션
  } else if (avgAgeDays <= 7) {
    score -= 6;
  }

  // Title Match Rate (제목 틈새 점수)
  if (titleMatchCount <= 1) {
    score += 10; // 상위 5개 중 1개 이하만 정확한 제목 매칭 = 제목만 제대로 쓰면 1페이지 진입 유력
  } else if (titleMatchCount >= 4) {
    score -= 8; // 상위 5개 중 4개 이상이 제목 최적화 완료
  }

  score = Math.min(99, Math.max(38, score));

  // Determine Grade
  let grade = 'C';
  let gradeLabel = '경쟁 치열';
  let gradeBadge = '🔴 보통';
  if (score >= 86) {
    grade = 'S';
    gradeLabel = '대박 황금';
    gradeBadge = '🏆 대박 황금';
  } else if (score >= 72) {
    grade = 'A';
    gradeLabel = '추천 황금';
    gradeBadge = '🟢 추천 황금';
  } else if (score >= 55) {
    grade = 'B';
    gradeLabel = '보통';
    gradeBadge = '🟡 일반';
  }

  // Opportunity summary statement
  let opportunity = '안정적인 검색 유입이 기대되는 키워드입니다.';
  const tags = [];

  if (isAutocomplete) {
    tags.push('🔥 실시간 검색수요');
  }

  if (avgAgeDays >= 90) {
    opportunity = `상위 1~3위 글이 ${Math.round(avgAgeDays / 30)}개월 전 글로 노후화되어 지금 포스팅 시 1페이지 선점이 유력한 빈집 키워드입니다.`;
    tags.push('🏆 상위글 노후 (빈집)');
  } else if (titleMatchCount <= 1) {
    opportunity = '상위 노출 글들의 제목 일치도가 낮아 제목에 키워드를 정확히 포함하면 단기간 상위 노출이 가능한 틈새 키워드입니다.';
    tags.push('✨ 제목 미일치 (틈새)');
  } else if (avgAgeDays <= 3) {
    opportunity = '신규 글 발행 빈도가 매우 높아 지속적인 유입 관리가 필요한 경쟁 구역입니다.';
    tags.push('⚡ 신규 발행 활발');
  }

  let recencyText = '최근 글 보통';
  if (avgAgeDays >= 120) recencyText = `상위글 평균 ${Math.round(avgAgeDays / 30)}개월 전 (노후)`;
  else if (avgAgeDays >= 30) recencyText = `상위글 평균 ${Math.round(avgAgeDays / 30)}개월 전`;
  else if (avgAgeDays <= 3) recencyText = '상위글 1~3일 전 (최신)';
  else recencyText = `상위글 평균 ${avgAgeDays}일 전`;

  const matchRateText = `제목 일치 ${titleMatchCount * 20}%`;

  return {
    keyword,
    score,
    grade,
    gradeLabel,
    gradeBadge,
    opportunity,
    demand: isAutocomplete ? '높음' : '보통',
    avgAgeDays,
    recencyText,
    titleMatchCount,
    matchRateText,
    isVacant: avgAgeDays >= 90,
    isNiche: titleMatchCount <= 1,
    tags
  };
}

/**
 * Discover Golden Keywords for a seed topic (Zero API Key, 100% self-contained)
 */
export async function discoverGoldenKeywords({ keyword, limit = 20 } = {}) {
  const seed = String(keyword || '').replace(/\s+/g, ' ').trim();
  if (!seed) return { query: '', totalCount: 0, goldenCount: 0, items: [] };

  // 1. Collect candidate queries
  const [acKeywords, intentKeywords] = await Promise.all([
    fetchAutocompleteKeywords(seed, 15),
    Promise.resolve(generateIntentKeywords(seed, 10))
  ]);

  // Combine and deduplicate
  const candidateMap = new Map();
  candidateMap.set(seed.toLowerCase(), { keyword: seed, isAc: true });
  for (const kw of acKeywords) {
    candidateMap.set(kw.toLowerCase(), { keyword: kw, isAc: true });
  }
  for (const kw of intentKeywords) {
    if (!candidateMap.has(kw.toLowerCase())) {
      candidateMap.set(kw.toLowerCase(), { keyword: kw, isAc: false });
    }
  }

  const candidateList = Array.from(candidateMap.values()).slice(0, Math.min(Number(limit) || 20, 25));

  // 2. Analyze SERP competition in parallel (chunks of 4 to prevent rate limiting)
  const results = [];
  const chunkSize = 4;
  for (let i = 0; i < candidateList.length; i += chunkSize) {
    const chunk = candidateList.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async ({ keyword: kw, isAc }) => {
        const serpData = await analyzeSerpCompetition(kw);
        return evaluateGoldenKeyword(kw, serpData, isAc);
      })
    );
    results.push(...chunkResults);
  }

  // Sort by golden score descending
  results.sort((a, b) => b.score - a.score);

  const goldenCount = results.filter((r) => r.score >= 72).length;

  return {
    query: seed,
    totalCount: results.length,
    goldenCount,
    items: results,
    searchedAt: new Date().toISOString()
  };
}
