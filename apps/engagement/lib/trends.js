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
