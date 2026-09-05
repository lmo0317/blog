import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLlmJson, normalizeGeneratedPost, LocalLlmClient } from '../lib/llm.js';
import { parseTrendRss } from '../lib/trends.js';
import { classifyPublishResult, isNaverLoginUrl, normalizePublishCategoryName } from '../lib/naver.js';
import { appendImageAttributions, searchCommonsImages } from '../lib/images.js';
import { extractAlgumonDestination, isDirectProductUrl, resolveAlgumonOutboundUrl, unwrapKnownRedirectUrl } from '../lib/algumon.js';

test('trend RSS parser extracts Korean topic and source safely', () => {
  const items = parseTrendRss(`
    <rss><channel><item><title>여름 휴가</title><ht:approx_traffic>2,000+</ht:approx_traffic>
    <pubDate>Tue, 25 Aug 2026 05:00:00 -0700</pubDate><ht:news_item>
    <ht:news_item_title>휴가 준비 &amp; 체크리스트</ht:news_item_title>
    <ht:news_item_url>https://example.com/news?id=1&amp;from=rss</ht:news_item_url>
    <ht:news_item_source>예시뉴스</ht:news_item_source></ht:news_item></item></channel></rss>`);
  assert.equal(items.length, 1);
  assert.equal(items[0].topic, '여름 휴가');
  assert.equal(items[0].newsTitle, '휴가 준비 & 체크리스트');
  assert.equal(items[0].sourceUrl, 'https://example.com/news?id=1&from=rss');
});

test('LLM JSON parser accepts fenced JSON and normalizes tags', () => {
  const parsed = parseLlmJson('```json\n{"title":"테스트 제목","content":"충분히 긴 본문입니다. ".repeat(10),"tags":[]}\n```'.replace('"충분히 긴 본문입니다. ".repeat(10)', `"${'충분히 긴 본문입니다. '.repeat(10)}"`));
  assert.equal(parsed.title, '테스트 제목');
  assert.deepEqual(normalizeGeneratedPost({ ...parsed, tags: ['#여행', '여행', ' 준비 '] }).tags, ['여행', '준비']);
});

test('structured LLM response becomes a readable fixed-form post', () => {
  const post = normalizeGeneratedPost({
    title: '잘 짜인 글',
    lead: '첫 문단입니다.\n두 번째 도입 문단입니다.',
    summaryPoints: ['첫 번째 핵심', '두 번째 핵심', '세 번째 핵심'],
    sections: [
      { heading: '첫 번째 소제목', body: '구체적인 설명과 바로 적용할 수 있는 팁을 충분히 작성합니다.' },
      { heading: '두 번째 소제목', body: '또 다른 예시와 확인할 내용을 이해하기 쉽게 정리합니다.' },
      { heading: '세 번째 소제목', body: '마지막으로 실천 순서와 주의할 점을 자세히 안내합니다.' }
    ],
    closing: '오늘 하나부터 직접 적용해 보세요.',
    tags: ['가이드'],
    imageQueries: ['Korean summer beach']
  });
  assert.match(post.content, /\[한눈에 보기\]\n• 첫 번째 핵심/);
  assert.match(post.content, /\[ 첫 번째 소제목 \]\n\n구체적인 설명/);
  assert.deepEqual(post.imageQueries, ['Korean summer beach']);
});

test('Commons image search keeps reusable images and builds attribution', async () => {
  const images = await searchCommonsImages('summer beach', { fetchImpl: async () => ({
    ok: true,
    json: async () => ({ query: { pages: {
      1: { pageid: 1, title: 'File:Beach.jpg', imageinfo: [{
        mime: 'image/jpeg',
        thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Beach.jpg/1200px-Beach.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Beach.jpg',
        extmetadata: {
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
          Artist: { value: '<b>Photo Author</b>' },
          ImageDescription: { value: 'A summer beach' }
        }
      }] },
      2: { pageid: 2, title: 'File:Blocked.svg', imageinfo: [{ mime: 'image/svg+xml', url: 'https://upload.wikimedia.org/test.svg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Blocked.svg', extmetadata: { LicenseShortName: { value: 'Unknown' } } }] }
    } } })
  }) });
  assert.equal(images.length, 1);
  assert.equal(images[0].author, 'Photo Author');
  assert.match(appendImageAttributions('본문', images), /이미지 출처 및 라이선스/);
  assert.match(appendImageAttributions('본문', images), /CC BY-SA 4.0/);
});

test('downloaded deal images preserve their exact paragraph placement metadata', async () => {
  const { downloadCommonsImages, cleanupDownloadedImages } = await import('../lib/images.js');
  const images = await downloadCommonsImages([{
    title: '테스트 상품',
    downloadUrl: 'https://cdn.example/product.jpg',
    pageUrl: 'https://shop.example/product/1',
    author: '테스트몰',
    license: '핫딜 상품 이미지',
    afterHeading: '상품 정보 | 이 문장 바로 뒤에 사진을 넣습니다.',
    caption: '테스트 상품 대표 이미지'
  }], '.playwright/test-downloads', {
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer
    })
  });
  try {
    assert.equal(images[0].afterHeading, '상품 정보 | 이 문장 바로 뒤에 사진을 넣습니다.');
    assert.equal(images[0].caption, '테스트 상품 대표 이미지');
    assert.equal(appendImageAttributions('본문', images), '본문\n\n이미지 출처 | 각 상품 및 판매 페이지');
  } finally {
    await cleanupDownloadedImages(images);
  }
});

test('AI-generated images do not append an attribution block to the post body', () => {
  const images = [
    { title: '맞춤 이미지', isAiGenerated: true, license: 'OpenAI GPT generated image' }
  ];
  assert.equal(appendImageAttributions('본문', images), '본문');
});

test('local LLM client sends selected topic and returns a post', async () => {
  let requestBody;
  const client = new LocalLlmClient({
    baseUrl: 'http://llm.local:8081',
    model: 'local-model',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          title: '트렌드 활용법',
          content: '독자가 읽을 수 있는 충분한 길이의 안전한 테스트 본문입니다. '.repeat(5),
          tags: ['트렌드'],
          imageQueries: ['summer travel']
        }) } }] })
      };
    }
  });
  const post = await client.generateBlogPost({ topic: '오늘의 트렌드' });
  assert.equal(post.title, '트렌드 활용법');
  assert.match(requestBody.messages[1].content, /오늘의 트렌드/);
  assert.equal(requestBody.model, 'local-model');
});

test('publish outcome requires a confirmed Naver result', () => {
  assert.equal(classifyPublishResult({ url: 'https://blog.naver.com/PostView.naver?logNo=123' }).status, 'published');
  assert.equal(classifyPublishResult({ url: 'https://nid.naver.com/nidlogin.login' }).status, 'verification_required');
  assert.equal(classifyPublishResult({ url: 'https://blog.naver.com/PostWriteForm.naver' }).status, 'manual_required');
  assert.equal(isNaverLoginUrl('https://nid.naver.com/nidlogin.login?mode=form'), true);
  assert.equal(isNaverLoginUrl('https://blog.naver.com/GoBlogWrite.naver'), false);
});

test('publish category accepts the configured health and living categories only', () => {
  assert.equal(normalizePublishCategoryName(' 건강 '), '건강');
  assert.equal(normalizePublishCategoryName('생활'), '생활');
  assert.equal(normalizePublishCategoryName(''), '');
  assert.throws(() => normalizePublishCategoryName('기본'), /건강 또는 생활/);
});

test('local LLM client generates deals blog post from Algumon rankings', async () => {
  const deals = [
    { rank: 1, shop: 'G마켓', title: '삼양 짱구', price: '15,840원', shipping: '무료배송', url: 'https://item.gmarket.co.kr/Item?goodscode=1' },
    { rank: 2, shop: '네이버쇼핑', title: '메가커피 아메리카노', price: '1,550원', shipping: '무료배송', url: 'https://smartstore.naver.com/example/products/2' }
  ];
  let requestBody;
  const client = new LocalLlmClient({
    baseUrl: 'http://llm.local:8081',
    model: 'local-model',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          title: '[오늘의 핫딜] 실시간 인기 특가 TOP 5',
          lead: '오늘 알구몬 랭킹 인기 핫딜을 모아봤습니다.',
          summaryPoints: ['짱구 특가', '메가커피 23% 할인', '무료배송 혜택'],
          sections: [
            { heading: '1위. [G마켓] 삼양 짱구 (15,840원)', body: '가성비 최고의 간식 특가입니다. 💖\nimageQuery: snack', imageQuery: 'snack' },
            { heading: '2위. [네이버쇼핑] 메가커피 아메리카노 (1,550원)', body: '가볍게 즐기기 좋은 커피 쿠폰입니다.', imageQuery: 'coffee' }
          ],
          closing: '품절 전 서두르세요!',
          tags: ['핫딜', '특가', '알구몬'],
          imageQueries: ['snack', 'coffee']
        }) } }] })
      };
    }
  });
  const post = await client.generateDealsBlogPost({ deals });
  assert.equal(post.title, '[오늘의 핫딜] 실시간 인기 특가 TOP 5');
  assert.match(requestBody.messages[1].content, /삼양 짱구/);
  assert.match(post.content, /오늘의 핫딜 한눈에 보기\n- 삼양 짱구 \| 15,840원/);
  assert.match(post.content, /상품 1 \| 삼양 짱구\n판매처 \| G마켓\n가격 \| 15,840원\n배송 \| 무료배송\n상품 정보 \| 가성비 최고의 간식 특가입니다\./);
  assert.match(post.content, /상품 페이지 \| 아래 파란 주소를 클릭하세요\.\nhttps:\/\/item.gmarket.co.kr\/Item\?goodscode=1/);
  assert.equal(post.imagePlans[0].afterHeading, '상품 정보 | 가성비 최고의 간식 특가입니다.');
  assert.doesNotMatch(`${post.title}\n${post.content}\n${post.tags.join(',')}`, /알구몬|[💖◆■⚠️❤️]|imageQuery/i);
});

test('deal posts ignore free-form content and always keep the publish-quality product block order', () => {
  const post = normalizeGeneratedPost({
    title: '[알구몬] 오늘의 핫딜',
    content: 'AI가 임의로 만든 형식의 본문입니다. '.repeat(10),
    lead: '알구몬에서 확인한 상품을 정리했습니다.',
    summaryPoints: ['요약 하나', '요약 둘', '요약 셋'],
    sections: [{ heading: '마음대로 쓴 제목', body: '실제 상품의 간단한 안내입니다.', imageQuery: 'product' }],
    closing: '알구몬 링크가 아니라 실제 상품 페이지를 확인하세요.',
    tags: ['알구몬', '핫딜']
  }, [{ shop: '테스트몰', title: '테스트 상품', price: '9,900원', shipping: '무료배송', url: 'https://shop.example/products/1' }]);

  const expectedOrder = [
    '상품 1 | 테스트 상품',
    '판매처 | 테스트몰',
    '가격 | 9,900원',
    '배송 | 무료배송',
    '상품 정보 | 실제 상품의 간단한 안내입니다.',
    '상품 페이지 | 아래 파란 주소를 클릭하세요.',
    'https://shop.example/products/1'
  ];
  let previousIndex = -1;
  expectedOrder.forEach((text) => {
    const index = post.content.indexOf(text);
    assert.ok(index > previousIndex, `${text} 순서가 잘못되었습니다.`);
    previousIndex = index;
  });
  assert.doesNotMatch(`${post.title}\n${post.content}\n${post.tags.join(',')}`, /알구몬/);
  assert.equal(post.imagePlans[0].afterHeading, '상품 정보 | 실제 상품의 간단한 안내입니다.');
});

test('Algumon moving page resolves to the original external deal page', async () => {
  const movingPage = '<p class="fallback"><a href="https://shop.example/item/1?x=1&amp;y=2">여기를 눌러 주세요</a></p>';
  assert.equal(extractAlgumonDestination(movingPage), 'https://shop.example/item/1?x=1&y=2');
  const resolved = await resolveAlgumonOutboundUrl('https://www.algumon.com/n/d/1?token=x', {
    fetchImpl: async () => ({ ok: true, url: 'https://www.algumon.com/n/d/1?token=x', text: async () => movingPage })
  });
  assert.equal(resolved, 'https://shop.example/item/1?x=1&y=2');
});

test('community source links are rejected while known warning redirects unwrap to products', () => {
  assert.equal(isDirectProductUrl('https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1'), false);
  assert.equal(isDirectProductUrl('https://arca.live/b/hotdeal/1'), false);
  assert.equal(isDirectProductUrl('https://eomisae.co.kr/index.php?document_srl=1'), false);
  assert.equal(
    unwrapKnownRedirectUrl('https://unsafelink.com/https://shopping.naver.com/festa/onsale/example'),
    'https://shopping.naver.com/festa/onsale/example'
  );
  assert.equal(isDirectProductUrl('https://unsafelink.com/https://shopping.naver.com/festa/onsale/example'), true);
});
