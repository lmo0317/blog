import { normalizeAutocompleteKeywords } from './naver.js';

const INTENT_SUFFIXES = [
  '추천',
  '후기',
  '내돈내산',
  '비용',
  '방법',
  '준비물',
  '순위',
  '가격',
  '장단점',
  '꿀팁',
  '비교',
  '주의사항',
  '혼밥',
  '점심',
  '코스',
  '초보',
  '정리',
  '예약',
  '위치',
  '시간'
];

const CONSONANTS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

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
 * Fetch 2nd-level expanded long-tail keywords using intents & selected consonants
 */
export async function fetchExpandedLongtailKeywords(seedKeyword, limit = 30) {
  const clean = String(seedKeyword || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const candidates = new Set();

  // 1. Primary autocomplete
  const primaryAc = await fetchAutocompleteKeywords(clean, 15);
  for (const kw of primaryAc) candidates.add(kw);

  // 2. High-intent combinations
  for (const suffix of INTENT_SUFFIXES.slice(0, 10)) {
    if (!clean.includes(suffix)) {
      candidates.add(`${clean} ${suffix}`);
    }
  }

  // 3. Fast consonant variations for popular seeds (first 3 consonants: ㄱ, ㅂ, ㅈ)
  const consonantTasks = CONSONANTS.slice(0, 3).map(async (c) => {
    try {
      const acList = await fetchAutocompleteKeywords(`${clean} ${c}`, 5);
      return acList.filter((k) => k !== `${clean} ${c}` && !k.endsWith(` ${c}`));
    } catch {
      return [];
    }
  });

  const consonantResults = await Promise.allSettled(consonantTasks);
  for (const r of consonantResults) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const kw of r.value) candidates.add(kw);
    }
  }

  return Array.from(candidates).slice(0, limit);
}

/**
 * Query official Naver Blog Section API (section.blog.naver.com)
 * Returns totalCount, top 5 posts, exact timestamps, and title match rate with ZERO API key
 */
export async function analyzeBlogSectionData(keyword) {
  const clean = String(keyword || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return {
      totalCount: 0,
      posts: [],
      avgAgeDays: 0,
      titleMatchCount: 0,
      hasBuyWithOwnMoney: false
    };
  }

  try {
    const url = `https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=5&currentPage=1&keyword=${encodeURIComponent(clean)}&orderBy=sim&type=post`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://section.blog.naver.com/Search/Post.naver',
        Accept: 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(9000)
    });

    if (!res.ok) {
      return fallbackSerpAnalysis(clean);
    }

    const text = await res.text();
    const cleanJson = text.replace(/^\)\]\}',\s*/, '');
    const data = JSON.parse(cleanJson);
    const result = data?.result || {};

    const rawTotal = Number(result.totalCount) || 0;
    const searchList = Array.isArray(result.searchList) ? result.searchList : [];
    const hasBuyWithOwnMoney = Boolean(result.hasBuyWithMyOwnMoneyPost);

    const now = Date.now();
    const cleanKw = clean.toLowerCase().replace(/\s+/g, '');
    let titleMatchCount = 0;

    const posts = searchList.slice(0, 5).map((item) => {
      const titleRaw = String(item.title || '').replace(/<[^>]+>/g, '').trim();
      const normTitle = titleRaw.toLowerCase().replace(/\s+/g, '');
      const isExactMatch = normTitle.includes(cleanKw);
      if (isExactMatch) titleMatchCount++;

      const addDateMs = Number(item.addDate) || now;
      const ageDays = Math.max(0, Math.round((now - addDateMs) / (1000 * 60 * 60 * 24)));

      return {
        title: titleRaw,
        blogName: String(item.blogName || '').trim(),
        blogId: String(item.blogId || '').trim(),
        logNo: String(item.logNo || '').trim(),
        url: item.blogId && item.logNo ? `https://blog.naver.com/${item.blogId}/${item.logNo}` : '',
        addDate: addDateMs,
        ageDays,
        ageText: formatAgeDays(ageDays),
        isExactMatch
      };
    });

    const validAges = posts.map((p) => p.ageDays);
    const avgAgeDays = validAges.length > 0
      ? Math.round(validAges.reduce((a, b) => a + b, 0) / validAges.length)
      : 30;

    return {
      totalCount: rawTotal,
      posts,
      avgAgeDays,
      titleMatchCount,
      hasBuyWithOwnMoney
    };
  } catch {
    return fallbackSerpAnalysis(clean);
  }
}

/**
 * Fallback parser using search.naver.com if section API is unreachable
 */
async function fallbackSerpAnalysis(keyword) {
  try {
    const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://www.naver.com/'
      },
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) return { totalCount: 1000, posts: [], avgAgeDays: 30, titleMatchCount: 2, hasBuyWithOwnMoney: false };
    const html = await res.text();

    const postLinks = [...html.matchAll(/<a[^>]+href="([^"]*(?:blog\.naver\.com\/[a-zA-Z0-9_.-]+\/\d+|m\.blog\.naver\.com\/[a-zA-Z0-9_.-]+\/\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const seen = new Set();
    const posts = [];
    const cleanKw = keyword.toLowerCase().replace(/\s+/g, '');
    let titleMatchCount = 0;

    for (const p of postLinks) {
      const href = p[1].split('?')[0];
      const title = p[2].replace(/<[^>]+>/g, ' ').replace(/새 창 열림/g, '').replace(/\s+/g, ' ').trim();
      if (title.length > 5 && !seen.has(href)) {
        seen.add(href);
        const isMatch = title.toLowerCase().replace(/\s+/g, '').includes(cleanKw);
        if (isMatch) titleMatchCount++;
        posts.push({ title, url: href, blogName: '', ageDays: 30, ageText: '최근 글', isExactMatch: isMatch });
      }
      if (posts.length >= 5) break;
    }

    return {
      totalCount: 1000,
      posts,
      avgAgeDays: 30,
      titleMatchCount,
      hasBuyWithOwnMoney: false
    };
  } catch {
    return { totalCount: 1000, posts: [], avgAgeDays: 30, titleMatchCount: 2, hasBuyWithOwnMoney: false };
  }
}

/**
 * Format days into human-friendly Korean string
 */
function formatAgeDays(days) {
  if (days <= 0) return '방금 전';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

/**
 * Evaluate Golden Keyword score (0~100) and grade (S, A, B, C)
 */
export function evaluateGoldenKeyword(keyword, serpData, isAutocomplete = true) {
  const { totalCount, avgAgeDays, titleMatchCount, hasBuyWithOwnMoney } = serpData;

  // Base score
  let score = 65;

  // 1. Demand Bonus (Autocomplete presence confirms real searchers)
  if (isAutocomplete) score += 12;

  // 2. Total Document Competition Bonus / Penalty
  if (totalCount > 0 && totalCount < 300) {
    score += 15; // Extremely low competition (Micro-niche)
  } else if (totalCount > 0 && totalCount < 1000) {
    score += 10; // Under 1,000 documents
  } else if (totalCount >= 1000) {
    // 1,000+ docs (capped in section API)
    score -= 2;
  }

  // 3. Stale / Recency Bonus (빈집 판정)
  if (avgAgeDays >= 120) {
    score += 14; // Top posts are 4+ months old (Stale)
  } else if (avgAgeDays >= 60) {
    score += 8; // Top posts 2+ months old
  } else if (avgAgeDays <= 2) {
    score -= 10; // Fierce red-ocean, published today/yesterday
  } else if (avgAgeDays <= 7) {
    score -= 4;
  }

  // 4. Exact Title Match Rate (틈새 판정)
  if (titleMatchCount === 0) {
    score += 12; // None of top 5 posts have exact keyword in title!
  } else if (titleMatchCount === 1) {
    score += 8; // Only 1 post matches title
  } else if (titleMatchCount >= 4) {
    score -= 8; // Top posts already SEO-optimized
  }

  // Cap between 35 and 99
  score = Math.min(99, Math.max(35, score));

  // Determine Grade
  let grade = 'C';
  let gradeLabel = '경쟁 치열';
  let gradeBadge = '🔴 보통';
  if (score >= 85) {
    grade = 'S';
    gradeLabel = '대박 황금';
    gradeBadge = '🏆 대박 황금';
  } else if (score >= 70) {
    grade = 'A';
    gradeLabel = '추천 황금';
    gradeBadge = '🟢 추천 황금';
  } else if (score >= 52) {
    grade = 'B';
    gradeLabel = '일반';
    gradeBadge = '🟡 일반';
  }

  // Tags & Opportunity summary
  const tags = [];
  if (isAutocomplete) tags.push('🔥 실시간 검색수요');
  if (totalCount > 0 && totalCount < 1000) {
    tags.push(`📚 문서 ${totalCount}건 (극세사)`);
  }
  if (avgAgeDays >= 90) {
    tags.push(`🏆 상위글 ${Math.round(avgAgeDays / 30)}개월 전 (빈집)`);
  }
  if (titleMatchCount <= 1) {
    tags.push('✨ 제목 미일치 (틈새 진입)');
  }
  if (hasBuyWithOwnMoney) {
    tags.push('💳 내돈내산 스마트블록');
  }

  let opportunity = '안정적인 검색 유입이 기대되는 키워드입니다.';
  let actionAdvice = '키워드를 제목 앞부분에 배치하여 포스팅을 작성하세요.';

  if (totalCount > 0 && totalCount < 1000 && titleMatchCount <= 1) {
    opportunity = `총 문서 수가 ${totalCount}건으로 매우 적고 상위 글 제목 일치도가 낮아, 제목에 키워드를 정확히 포함하면 단기간 1페이지 선점이 유력합니다.`;
    actionAdvice = `[${keyword}] 키워드를 제목에 정확히 넣어 1,500자 이상 정성글을 발행하세요.`;
  } else if (avgAgeDays >= 90) {
    opportunity = `상위 노출 글들이 평균 ${Math.round(avgAgeDays / 30)}개월 전 글로 노후화되어 최신성 지수로 상위 탈환이 수월한 빈집 키워드입니다.`;
    actionAdvice = '최근 정보와 고화질 이미지를 포함해 최신성 우위를 확보하세요.';
  } else if (titleMatchCount <= 1) {
    opportunity = '상위 5개 글 중 키워드가 제목에 온전히 들어간 글이 거의 없어 제목 최적화만으로도 순위 상승이 가능합니다.';
    actionAdvice = '제목 첫머리에 키워드를 배치하고 본문에 3~4회 자연스럽게 반복하세요.';
  } else if (avgAgeDays <= 4) {
    opportunity = '신규 글 발행 빈도가 높아 초기 이웃 소통과 공감/댓글 반응을 빠르게 모아야 하는 경쟁 구역입니다.';
    actionAdvice = '글 발행 즉시 [새글 부스터]로 이웃 소통을 활성화하세요.';
  }

  const docCountText = totalCount > 0 && totalCount < 1000
    ? `${totalCount.toLocaleString()}건`
    : (totalCount >= 1000 ? '1,000건 이상' : '집계 중');

  const recencyText = avgAgeDays >= 120
    ? `평균 ${Math.round(avgAgeDays / 30)}개월 전 (노후)`
    : (avgAgeDays >= 30 ? `평균 ${Math.round(avgAgeDays / 30)}개월 전` : `평균 ${avgAgeDays}일 전`);

  return {
    keyword,
    score,
    grade,
    gradeLabel,
    gradeBadge,
    opportunity,
    actionAdvice,
    demand: isAutocomplete ? '높음' : '보통',
    totalCount,
    docCountText,
    avgAgeDays,
    recencyText,
    titleMatchCount,
    matchRateText: `제목 일치 ${titleMatchCount}/5개 (${titleMatchCount * 20}%)`,
    isVacant: avgAgeDays >= 60,
    isNiche: titleMatchCount <= 1,
    isMicroDoc: totalCount > 0 && totalCount < 1000,
    hasBuyWithOwnMoney,
    tags,
    topPosts: serpData.posts || []
  };
}

/**
 * Discover Golden Keywords for a seed topic (Zero API Key, 100% self-contained)
 */
export async function discoverGoldenKeywords({ keyword, limit = 20 } = {}) {
  const seed = String(keyword || '').replace(/\s+/g, ' ').trim();
  if (!seed) return { query: '', totalCount: 0, goldenCount: 0, items: [] };

  // 1. Collect expanded candidates
  const candidates = await fetchExpandedLongtailKeywords(seed, Math.min(Math.max(Number(limit) || 20, 10), 30));

  // Ensure seed is at the beginning
  const candidateMap = new Map();
  candidateMap.set(seed.toLowerCase(), { keyword: seed, isAc: true });
  for (const kw of candidates) {
    if (!candidateMap.has(kw.toLowerCase())) {
      candidateMap.set(kw.toLowerCase(), { keyword: kw, isAc: true });
    }
  }

  const candidateList = Array.from(candidateMap.values()).slice(0, 25);

  // 2. Analyze competition via official Naver Blog Section API in chunks of 3
  const results = [];
  const chunkSize = 3;
  for (let i = 0; i < candidateList.length; i += chunkSize) {
    const chunk = candidateList.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async ({ keyword: kw, isAc }) => {
        const serpData = await analyzeBlogSectionData(kw);
        return evaluateGoldenKeyword(kw, serpData, isAc);
      })
    );
    results.push(...chunkResults);
  }

  // Sort: S-grade and highest score first
  results.sort((a, b) => b.score - a.score);

  const goldenCount = results.filter((r) => r.score >= 70).length;
  const vacantCount = results.filter((r) => r.isVacant).length;
  const nicheCount = results.filter((r) => r.isNiche).length;

  return {
    query: seed,
    totalCount: results.length,
    goldenCount,
    vacantCount,
    nicheCount,
    items: results,
    searchedAt: new Date().toISOString()
  };
}
