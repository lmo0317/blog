// Golden keyword finder without API keys.
//
// A golden keyword is one people actually search for, where few or stale blog posts compete, so a new
// post can reach the first page. Two signals, both from public Naver pages:
//  - demand: only real search queries are candidates (Naver autocomplete for the seed and for
//    "seed + ㄱ..ㅎ"); a query shown near the top of autocomplete, or in several lists, is searched more.
//    This is an estimate (high / medium / low), not a monthly search count; that needs the Search Ad API.
//  - competition: Naver blog search for the keyword: total documents (exact below 1,000, capped above),
//    how many of the top 10 posts carry every keyword word in the title, and how old the top posts are.
// When the blog search cannot be read, the keyword is marked unchecked instead of scored with guesses.
import { normalizeAutocompleteKeywords } from './naver.js';

const CONSONANTS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const sectionCache = new Map();

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** Naver autocomplete suggestions for a query (no API key). */
export async function fetchAutocompleteKeywords(keyword, limit = 15) {
  const clean = cleanText(keyword);
  if (!clean) return [];
  try {
    const params = new URLSearchParams({
      q: clean, con: '1', frm: 'nv', ans: '2', r_format: 'json', r_enc: 'UTF-8', r_unicode: '0',
      t_koreng: '1', run: '2', rev: '4', q_enc: 'UTF-8', st: '100'
    });
    const res = await fetch(`https://ac.search.naver.com/nx/ac?${params}`, {
      headers: { Accept: 'application/json', Referer: 'https://search.naver.com/', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    return normalizeAutocompleteKeywords(await res.json(), clean, limit);
  } catch {
    return [];
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

/**
 * Real search queries around a seed, with how strongly autocomplete surfaces each one.
 * Returns [{ keyword, rank (best position, 1-based), hits (lists it appeared in), sources }].
 */
export async function collectSearchedKeywords(seed) {
  const clean = cleanText(seed);
  if (!clean) return [];
  const queries = [{ q: clean, source: 'seed' }, ...CONSONANTS.map((c) => ({ q: `${clean} ${c}`, source: c }))];
  const lists = await mapLimit(queries, 4, async ({ q, source }) => ({ source, items: await fetchAutocompleteKeywords(q, 10) }));

  const byKeyword = new Map();
  const add = (keyword, rank, source) => {
    const key = keyword.toLowerCase();
    const entry = byKeyword.get(key) || { keyword, rank: Infinity, hits: 0, sources: [] };
    entry.rank = Math.min(entry.rank, rank);
    entry.hits += 1;
    entry.sources.push(source);
    byKeyword.set(key, entry);
  };
  for (const { source, items } of lists) {
    items.forEach((keyword, index) => {
      if (/\s[ㄱ-ㅎ]$/.test(keyword)) return;
      // Consonant lists rank below the seed's own list: their top entry is weaker evidence.
      add(keyword, source === 'seed' ? index + 1 : index + 4, source);
    });
  }
  if (!byKeyword.has(clean.toLowerCase())) byKeyword.set(clean.toLowerCase(), { keyword: clean, rank: 1, hits: 1, sources: ['seed'] });

  // Second level: broad two-word queries are usually red oceans, so also collect what people type after
  // the strongest ones ("캠핑 의자" -> "캠핑 의자 추천 2인용"). Those narrower queries are where gaps are.
  const parents = [...byKeyword.values()]
    .filter((entry) => entry.keyword.toLowerCase() !== clean.toLowerCase())
    .sort((a, b) => a.rank - b.rank || b.hits - a.hits)
    .slice(0, 8);
  const childLists = await mapLimit(parents, 4, async (parent) => ({ parent, items: await fetchAutocompleteKeywords(parent.keyword, 8) }));
  for (const { parent, items } of childLists) {
    items.forEach((keyword, index) => {
      if (keyword.toLowerCase() === parent.keyword.toLowerCase() || /\s[ㄱ-ㅎ]$/.test(keyword)) return;
      add(keyword, index + 3, parent.keyword);
    });
  }
  return [...byKeyword.values()];
}

/** Kept for callers of the old API: the real searched keywords around a seed. */
export async function fetchExpandedLongtailKeywords(seed, limit = 30) {
  const found = await collectSearchedKeywords(seed);
  return found.sort((a, b) => a.rank - b.rank || b.hits - a.hits).slice(0, limit).map((item) => item.keyword);
}

function formatAgeDays(days) {
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

function titleHasAllWords(title, keyword) {
  const normalizedTitle = String(title || '').toLowerCase().replace(/\s+/g, '');
  return keyword.toLowerCase().split(/\s+/).filter(Boolean).every((word) => normalizedTitle.includes(word));
}

/**
 * Competition for one keyword from Naver blog search (most relevant 10 posts).
 * Returns { checked, totalCount, totalCapped, posts, titleMatchCount, avgAgeDays, freshCount, hasBuyWithOwnMoney }.
 */
export async function analyzeBlogSectionData(keyword) {
  const clean = cleanText(keyword);
  const empty = { checked: false, totalCount: 0, totalCapped: false, posts: [], titleMatchCount: 0, avgAgeDays: 0, freshCount: 0, hasBuyWithOwnMoney: false };
  if (!clean) return empty;

  const cached = sectionCache.get(clean.toLowerCase());
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    const url = `https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=10&currentPage=1&keyword=${encodeURIComponent(clean)}&orderBy=sim&type=post`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://section.blog.naver.com/Search/Post.naver', Accept: 'application/json, text/plain, */*' },
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` };
    const data = JSON.parse((await res.text()).replace(/^\)\]\}',\s*/, ''));
    const result = data?.result || {};
    const list = Array.isArray(result.searchList) ? result.searchList : [];
    const now = Date.now();

    const posts = list.slice(0, 10).map((item) => {
      const title = String(item.noTagTitle || item.title || '').replace(/<[^>]+>/g, '').trim();
      const addDate = Number(item.addDate) || now;
      const ageDays = Math.max(0, Math.round((now - addDate) / 86400000));
      const blogId = String(item.domainIdOrBlogId || item.blogId || '').trim();
      const logNo = String(item.logNo || '').trim();
      return {
        title,
        blogName: String(item.blogName || item.nickName || '').trim(),
        url: item.postUrl || (blogId && logNo ? `https://blog.naver.com/${blogId}/${logNo}` : ''),
        ageDays,
        ageText: formatAgeDays(ageDays),
        isExactMatch: titleHasAllWords(title, clean)
      };
    });

    const totalCount = Number(result.totalCount) || 0;
    const analysis = {
      checked: true,
      totalCount,
      totalCapped: totalCount >= 1000,
      posts,
      titleMatchCount: posts.filter((post) => post.isExactMatch).length,
      avgAgeDays: posts.length ? Math.round(posts.reduce((sum, post) => sum + post.ageDays, 0) / posts.length) : 0,
      freshCount: posts.filter((post) => post.ageDays <= 7).length,
      hasBuyWithOwnMoney: Boolean(result.hasBuyWithMyOwnMoneyPost) || list.some((item) => item.buyWithMyOwnMoney)
    };
    sectionCache.set(clean.toLowerCase(), { at: Date.now(), data: analysis });
    return analysis;
  } catch (error) {
    return { ...empty, error: error.message };
  }
}

/** Demand estimate from autocomplete placement. demand: { rank, hits } or a boolean (in autocomplete or not). */
export function estimateDemand(demand) {
  const info = typeof demand === 'object' && demand ? demand : { rank: demand ? 5 : Infinity, hits: demand ? 1 : 0 };
  const rank = Number.isFinite(info.rank) ? info.rank : Infinity;
  let score = 0;
  if (rank <= 2) score = 80;
  else if (rank <= 5) score = 65;
  else if (rank <= 10) score = 45;
  else if (Number.isFinite(rank)) score = 30;
  score += Math.min(Math.max((info.hits || 0) - 1, 0) * 8, 20);
  score = Math.min(score, 100);
  const level = score >= 70 ? '높음' : score >= 45 ? '보통' : '낮음';
  const reason = Number.isFinite(rank)
    ? `자동완성 ${rank <= 10 ? `${rank}번째` : '하위'}에 노출${info.hits > 1 ? ` · ${info.hits}개 목록에 등장` : ''}`
    : '자동완성에 나오지 않음';
  return { score, level, rank: Number.isFinite(rank) ? rank : null, hits: info.hits || 0, reason };
}

/**
 * Competition score (higher = easier to rank) with the reasons behind it.
 * Naver caps the blog search total at 1,000, so most keywords show "1,000+": the count only adds a bonus
 * when it is below the cap. The real signal is the first page: whether its posts target this exact
 * keyword in their titles, and how old they are.
 */
export function estimateCompetition(serp) {
  const reasons = [];
  let score = 0;

  if (serp.titleMatchCount <= 1) { score += 40; reasons.push({ good: true, text: `상위 10개 중 제목에 이 키워드를 다 넣은 글 ${serp.titleMatchCount}개 (노린 글 거의 없음)` }); }
  else if (serp.titleMatchCount <= 3) { score += 28; reasons.push({ good: true, text: `상위 10개 중 제목에 이 키워드를 다 넣은 글 ${serp.titleMatchCount}개` }); }
  else if (serp.titleMatchCount <= 6) { score += 14; reasons.push({ good: false, text: `상위 10개 중 ${serp.titleMatchCount}개가 제목에 이 키워드를 넣음` }); }
  else { score += 3; reasons.push({ good: false, text: `상위 10개 중 ${serp.titleMatchCount}개가 제목에 이 키워드를 넣음 (경쟁 치열)` }); }

  if (serp.avgAgeDays >= 180) { score += 35; reasons.push({ good: true, text: `상위 글 평균 ${formatAgeDays(serp.avgAgeDays)} 작성 (오래돼서 밀어내기 쉬움)` }); }
  else if (serp.avgAgeDays >= 90) { score += 26; reasons.push({ good: true, text: `상위 글 평균 ${formatAgeDays(serp.avgAgeDays)} 작성 (오래된 편)` }); }
  else if (serp.avgAgeDays >= 30) { score += 14; reasons.push({ good: null, text: `상위 글 평균 ${formatAgeDays(serp.avgAgeDays)} 작성` }); }
  else { score += 4; reasons.push({ good: false, text: `상위 글 평균 ${formatAgeDays(serp.avgAgeDays)} 작성 (최신 글끼리 경쟁)` }); }

  if (serp.freshCount === 0) score += 15;
  else if (serp.freshCount <= 2) score += 8;
  else reasons.push({ good: false, text: `상위 10개 중 ${serp.freshCount}개가 최근 7일 안에 쓴 글` });

  if (!serp.totalCapped && serp.totalCount > 0) {
    score += serp.totalCount < 300 ? 15 : 10;
    reasons.push({ good: true, text: `블로그 문서 ${serp.totalCount.toLocaleString()}건뿐 (적음)` });
  }

  score = Math.min(score, 100);
  return { score, level: score >= 65 ? '낮음' : score >= 40 ? '보통' : '높음', reasons };
}

/** Grade one keyword from its competition data and demand estimate. */
export function evaluateGoldenKeyword(keyword, serp, demandInput = true) {
  const demand = estimateDemand(demandInput);
  const base = {
    keyword,
    demand,
    totalCount: serp.totalCount || 0,
    totalCapped: Boolean(serp.totalCapped),
    docCountText: serp.checked ? (serp.totalCapped ? '1,000건 이상' : `${(serp.totalCount || 0).toLocaleString()}건`) : '확인 실패',
    avgAgeDays: serp.avgAgeDays || 0,
    recencyText: serp.checked && serp.posts?.length ? `평균 ${formatAgeDays(serp.avgAgeDays)}` : '-',
    titleMatchCount: serp.titleMatchCount || 0,
    matchRateText: serp.checked ? `상위 10개 중 ${serp.titleMatchCount}개` : '-',
    hasBuyWithOwnMoney: Boolean(serp.hasBuyWithOwnMoney),
    topPosts: (serp.posts || []).slice(0, 5),
    checked: Boolean(serp.checked)
  };

  if (!serp.checked) {
    return {
      ...base,
      score: 0,
      grade: 'X',
      gradeLabel: '확인 실패',
      competition: { score: 0, level: '-', reasons: [] },
      reasons: [{ good: false, text: '네이버 블로그 검색 결과를 읽지 못했습니다. 잠시 뒤 다시 시도하세요.' }],
      summary: '경쟁 정보를 확인하지 못했습니다.',
      advice: '',
      isVacant: false,
      isNiche: false,
      isMicroDoc: false
    };
  }

  const competition = estimateCompetition(serp);
  const score = Math.round(demand.score * 0.4 + competition.score * 0.6);
  let grade = 'C';
  if (score >= 70 && demand.score >= 45 && competition.score >= 60) grade = 'S';
  else if (score >= 58 && demand.score >= 45) grade = 'A';
  else if (score >= 45 && competition.score >= 35) grade = 'B';
  const gradeLabel = { S: '황금', A: '추천', B: '보통', C: '경쟁 심함' }[grade];

  const isMicroDoc = !serp.totalCapped && serp.totalCount > 0;
  const isVacant = serp.avgAgeDays >= 90;
  const isNiche = serp.titleMatchCount <= 1;

  let summary;
  if (grade === 'S' || grade === 'A') {
    const why = [isMicroDoc ? '경쟁 글이 적고' : null, isVacant ? '상위 글이 오래됐고' : null, isNiche ? '제목을 맞춘 글이 드물어' : null].filter(Boolean);
    summary = `찾는 사람이 ${demand.level === '높음' ? '많은' : '꾸준한'} 검색어인데 ${why.length ? why.join(' ') : '경쟁이 약해'} 새 글이 상위에 오를 가능성이 큽니다.`;
  } else if (grade === 'B') {
    summary = demand.score < 45 ? '경쟁은 견딜 만하지만 찾는 사람이 많지 않은 검색어입니다.' : '찾는 사람은 있지만 경쟁 글도 꽤 있는 검색어입니다.';
  } else {
    summary = '이미 잘 쓴 글이 많아 새 글이 상위에 오르기 어렵습니다.';
  }
  const advice = grade === 'C'
    ? '더 구체적인 하위 검색어(지역·대상·상황을 붙인 검색어)로 바꿔 보세요.'
    : `제목 앞부분에 '${keyword}'를 그대로 넣고, 본문에 직접 해 본 내용과 사진을 담으세요.`;

  return {
    ...base,
    score,
    grade,
    gradeLabel,
    competition,
    reasons: [{ good: demand.score >= 45, text: `검색 수요 ${demand.level}: ${demand.reason}` }, ...competition.reasons],
    summary,
    advice,
    isVacant,
    isNiche,
    isMicroDoc
  };
}

/** Golden keywords for a seed: real searched keywords, graded, best first. */
export async function discoverGoldenKeywords({ keyword, limit = 20 } = {}) {
  const seed = cleanText(keyword);
  if (!seed) return { query: '', totalCount: 0, goldenCount: 0, items: [] };

  const searched = await collectSearchedKeywords(seed);
  const max = Math.min(Math.max(Number(limit) || 20, 5), 25);
  // Half the slots go to narrower queries (3+ words), which are where low competition usually is.
  const byDemand = (a, b) => estimateDemand(b).score - estimateDemand(a).score || a.keyword.length - b.keyword.length;
  const wordCount = (entry) => entry.keyword.split(/\s+/).length;
  const specific = searched.filter((entry) => wordCount(entry) >= 3).sort(byDemand);
  const broad = searched.filter((entry) => wordCount(entry) < 3).sort(byDemand);
  const takeSpecific = Math.min(specific.length, Math.ceil(max / 2) + Math.max(0, Math.floor(max / 2) - broad.length));
  const candidates = [...broad.slice(0, max - takeSpecific), ...specific.slice(0, takeSpecific)];

  const items = await mapLimit(candidates, 3, async (candidate) => evaluateGoldenKeyword(candidate.keyword, await analyzeBlogSectionData(candidate.keyword), candidate));
  const gradeOrder = { S: 0, A: 1, B: 2, C: 3, X: 4 };
  items.sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade] || b.score - a.score);

  return {
    query: seed,
    totalCount: items.length,
    goldenCount: items.filter((item) => item.grade === 'S').length,
    recommendedCount: items.filter((item) => item.grade === 'A').length,
    failedCount: items.filter((item) => item.grade === 'X').length,
    items,
    searchedAt: new Date().toISOString()
  };
}

/** One keyword picked from elsewhere (my-blog analysis, trends): demand from its own autocomplete. */
export async function analyzeSingleKeyword(keyword) {
  const clean = cleanText(keyword);
  const [serp, suggestions] = await Promise.all([analyzeBlogSectionData(clean), fetchAutocompleteKeywords(clean.split(' ')[0] || clean, 10)]);
  const index = suggestions.findIndex((item) => item.toLowerCase() === clean.toLowerCase());
  return evaluateGoldenKeyword(clean, serp, index >= 0 ? { rank: index + 1, hits: 1 } : { rank: Infinity, hits: 0 });
}
