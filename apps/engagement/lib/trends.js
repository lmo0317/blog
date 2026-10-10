const TRENDS_RSS_URL = 'https://trends.google.com/trending/rss?geo=KR';

export function toTrendKeyword(topic = '') {
  const clean = String(topic).replace(/["'“”‘’()[\]{}<>]/g, ' ').replace(/[^0-9A-Za-z가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const useful = clean.split(' ').filter((word) => !/^(대한민국|한국|민생회복|관련|논란|소식|국가대표팀)$/.test(word));
  if (useful.length !== clean.split(' ').length) return useful.slice(-2).join('').slice(0, 10);
  if (clean.replace(/\s/g, '').length <= 10) return clean.replace(/\s+/g, '');
  const compact = useful.slice(-2).join('').slice(0, 10);
  return compact || clean.replace(/\s/g, '').slice(0, 10);
}

export function parseTrendRss(xml = '') {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const newsBlock = item.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/i)?.[0] || '';
    return {
      topic: readTag(item, 'title'),
      keyword: toTrendKeyword(readTag(item, 'title')),
      traffic: readTag(item, 'ht:approx_traffic'),
      publishedAt: readTag(item, 'pubDate'),
      newsTitle: readTag(newsBlock, 'ht:news_item_title'),
      source: readTag(newsBlock, 'ht:news_item_source'),
      sourceUrl: safeHttpUrl(readTag(newsBlock, 'ht:news_item_url'))
    };
  }).filter((item) => item.topic);
}

const FALLBACK_BLOG_TOPICS = [
  { topic: '성수동 핫플 카페거리', keyword: '성수동카페', traffic: '15,000+' },
  { topic: '가을 단풍 여행 코스', keyword: '단풍여행', traffic: '25,000+' },
  { topic: '제주도 감성 숙소 추천', keyword: '제주도숙소', traffic: '18,000+' },
  { topic: '직장인 다이어트 식단', keyword: '다이어트식단', traffic: '12,000+' },
  { topic: '가성비 차박 캠핑 장비', keyword: '캠핑장비', traffic: '10,000+' },
  { topic: '아이폰 꿀팁 모음', keyword: '아이폰꿀팁', traffic: '14,000+' },
  { topic: '피부과 리프팅 솔직후기', keyword: '피부과후기', traffic: '9,000+' },
  { topic: '서울 근교 드라이브 코스', keyword: '근교드라이브', traffic: '16,000+' },
  { topic: '국내 힐링 료칸 숙소', keyword: '국내료칸', traffic: '11,000+' },
  { topic: '초보 헬스 운동 루틴', keyword: '초보홈트', traffic: '8,000+' },
  { topic: '스타벅스 신메뉴 후기', keyword: '스타벅스신메뉴', traffic: '13,000+' },
  { topic: '주말 가족 나들이 명소', keyword: '주말나들이', traffic: '17,000+' }
];

export async function fetchKoreanTrends({ fetchImpl = fetch, limit = 12 } = {}) {
  try {
    const response = await fetchImpl(TRENDS_RSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000)
    });
    if (response.ok) {
      const xml = await response.text();
      const parsed = parseTrendRss(xml);
      if (parsed.length > 0) {
        return parsed.slice(0, Math.min(Math.max(Number(limit) || 12, 1), 20));
      }
    }
  } catch {
    // Fall back to curated popular blog topics on network or timeout failure
  }
  return FALLBACK_BLOG_TOPICS.slice(0, Math.min(Math.max(Number(limit) || 12, 1), 20));
}

function readTag(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml).match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return decodeXml(String(match?.[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim());
}

function decodeXml(value) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

// ── Topic ideas for the golden keyword popup ───────────────────────────────
// Three sources, all free and keyless: Google's live search trends (Korean topics only), Naver
// DataLab's shopping keyword ranks per category, and a hand-picked list of topics for the month.

export const SHOPPING_CATEGORIES = [
  { id: '50000006', label: '식품', icon: '🍎' },
  { id: '50000008', label: '생활·건강', icon: '💊' },
  { id: '50000002', label: '화장품·미용', icon: '💄' },
  { id: '50000003', label: '디지털·가전', icon: '💻' },
  { id: '50000005', label: '출산·육아', icon: '👶' },
  { id: '50000007', label: '스포츠·레저', icon: '⛺' },
  { id: '50000009', label: '여가·생활편의', icon: '🎫' },
  { id: '50000004', label: '가구·인테리어', icon: '🛋️' },
  { id: '50000000', label: '패션의류', icon: '👕' },
  { id: '50000011', label: '도서', icon: '📚' }
];

const DATALAB_RANK_URL = 'https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver';

/** YYYY-MM-DD in Korea time, `daysAgo` days before `now`. */
function kstDate(now, daysAgo) {
  return new Date(now.getTime() + 9 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);
}

/** The 20 most searched shopping keywords of one category over the last 7 days. */
export async function fetchShoppingKeywordRanks({ categoryId = SHOPPING_CATEGORIES[0].id, fetchImpl = fetch, now = new Date() } = {}) {
  const category = SHOPPING_CATEGORIES.find((c) => c.id === String(categoryId)) || SHOPPING_CATEGORIES[0];
  const body = new URLSearchParams({
    cid: category.id, timeUnit: 'date', startDate: kstDate(now, 8), endDate: kstDate(now, 1),
    age: '', gender: '', device: '', page: '1', count: '20'
  });
  const response = await fetchImpl(DATALAB_RANK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: 'https://datalab.naver.com/shoppingInsight/sCategory.naver',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    },
    body,
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`네이버 데이터랩 응답 오류 (${response.status})`);
  const data = await response.json();
  const items = (Array.isArray(data?.ranks) ? data.ranks : [])
    .map((r) => ({ rank: Number(r.rank) || 0, keyword: String(r.keyword || '').trim() }))
    .filter((r) => r.keyword);
  if (!items.length) throw new Error('네이버 데이터랩에서 인기 키워드를 받지 못했습니다.');
  return { category, range: String(data.range || ''), items };
}

/** Live trends worth a blog post: Korean topics only (the feed also carries foreign-language searches). */
export function koreanTrendsOnly(items = []) {
  return items.filter((item) => /[가-힣]/.test(item.topic || ''));
}

const SEASON_TOPICS = {
  1: ['신년 다이어리 추천', '설날 선물 세트', '겨울 온천 여행', '연말정산 꿀팁', '새해 운동 루틴', '스키장 추천', '딸기 디저트 맛집', '겨울 실내 데이트'],
  2: ['졸업 선물 추천', '입학 준비물', '발렌타인데이 선물', '봄 신상 코디', '이사 준비 체크리스트', '겨울 방학 아이와 갈만한곳', '미세먼지 공기청정기', '봄맞이 대청소'],
  3: ['벚꽃 명소', '봄나들이 도시락', '새학기 준비물', '화이트데이 선물', '미세먼지 마스크', '봄 캠핑', '환절기 면역력', '봄 원피스 코디'],
  4: ['벚꽃 축제 일정', '봄 피크닉 장소', '어린이날 선물', '자전거 여행 코스', '꽃구경 드라이브', '봄 제철 음식', '등산 초보 코스', '봄 신상 카페'],
  5: ['어린이날 가볼만한곳', '어버이날 선물', '스승의날 선물', '가정의달 외식', '초여름 캠핑', '장미 축제', '여름 다이어트', '모기 퇴치'],
  6: ['여름 휴가지 추천', '장마철 제습기', '수박 고르는법', '물놀이 준비물', '에어컨 청소', '여름 보양식', '선크림 추천', '계곡 캠핑'],
  7: ['여름휴가 국내 여행', '물놀이장 추천', '삼계탕 맛집', '휴가 준비물', '아이랑 워터파크', '여름 냉면 맛집', '열대야 꿀잠', '모기 물렸을때'],
  8: ['늦여름 휴가', '개학 준비물', '추석 선물 세트', '가을 캠핑 준비', '여름 피부 관리', '태풍 대비', '복숭아 품종', '휴가 후 다이어트'],
  9: ['추석 선물 추천', '가을 단풍 명소', '추석 연휴 여행', '가을 캠핑', '전 부치기 레시피', '환절기 비염', '가을 코디', '대하 축제'],
  10: ['단풍 여행 코스', '할로윈 파티', '가을 캠핑 요리', '김장 준비', '가을 제철 음식', '억새 명소', '환절기 감기', '독감 예방접종'],
  11: ['김장 김치 레시피', '수능 선물', '블랙프라이데이', '겨울 패딩 추천', '가습기 추천', '빼빼로데이 선물', '연말 모임 장소', '귤 보관법'],
  12: ['크리스마스 선물', '연말 파티 음식', '송년회 장소', '겨울 여행지', '크리스마스 데이트', '새해 계획', '전기장판 추천', '연말정산 준비']
};

/** Hand-picked blog topics that come back every year in this month (Korea time). */
export function seasonTopics(now = new Date()) {
  const month = Number(kstDate(now, 0).slice(5, 7));
  return { month, topics: SEASON_TOPICS[month] || [] };
}
