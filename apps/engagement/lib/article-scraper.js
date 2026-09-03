export async function extractArticleContent(urlOrText, { fetchImpl = fetch } = {}) {
  const input = String(urlOrText || '').trim();
  if (!input) throw new Error('뉴스 기사 URL 또는 본문 텍스트를 입력해주세요.');

  if (!/^https?:\/\//i.test(input)) {
    const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
    return {
      title: lines[0]?.slice(0, 100) || '참조 텍스트',
      content: input,
      sourceUrl: '',
      images: []
    };
  }

  const url = input;
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      throw new Error(`웹페이지 응답 오류 (HTTP ${res.status})`);
    }

    const html = await res.text();
    
    let title = '';
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i);
    const docTitleMatch = html.match(/<title>(.*?)<\/title>/i);
    const rawTitle = ogTitleMatch?.[1] || docTitleMatch?.[1] || '';
    if (rawTitle) {
      title = decodeHtmlEntities(rawTitle.trim());
    }

    const images = [];
    const ogImgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i);
    if (ogImgMatch && ogImgMatch[1]) {
      images.push(ogImgMatch[1]);
    }

    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');

    const articleMatch = text.match(/<article[\s\S]*?<\/article>/i) ||
      text.match(/<div[^>]*class=["'][^"']*(?:article|content|view|news_body|se-main-container|dic_area)[^"']*["'][\s\S]*?<\/div>/i);
    
    if (articleMatch) {
      text = articleMatch[0];
    }

    text = text.replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    text = decodeHtmlEntities(text);
    if (text.length > 5000) {
      text = text.slice(0, 5000);
    }

    return {
      title: title || '참조 뉴스/포스팅',
      content: text,
      sourceUrl: url,
      images
    };
  } catch (err) {
    return {
      title: '참조 뉴스/포스팅',
      content: `URL: ${url} (스크랩 오류: ${err.message})`,
      sourceUrl: url,
      images: []
    };
  }
}

function decodeHtmlEntities(str = '') {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
