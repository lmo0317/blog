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

export async function fetchKoreanTrends({ fetchImpl = fetch, limit = 12 } = {}) {
  const response = await fetchImpl(TRENDS_RSS_URL, {
    headers: { 'User-Agent': 'NaverNeighborConsole/0.1 (+local trend reader)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`트렌드 조회 오류 (${response.status})`);
  const trends = parseTrendRss(await response.text()).slice(0, Math.min(Math.max(Number(limit) || 12, 1), 20));
  if (!trends.length) throw new Error('현재 확인할 수 있는 트렌드가 없습니다.');
  return trends;
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
