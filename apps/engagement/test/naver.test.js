import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProductLayout, classifyLoginPage, classifyNeighborResult, editorHeadingText, extractBlogId, isProductSectionCandidate, mapImagesToContentLines, normalizeBlogItem, normalizeWebSearchLinks, NaverSearchClient } from '../lib/naver.js';

test('extractBlogId accepts Naver blog URLs only', () => {
  assert.equal(extractBlogId('https://blog.naver.com/example/2234'), 'example');
  assert.equal(extractBlogId('https://m.blog.naver.com/my.blog-id'), 'my.blog-id');
  assert.equal(extractBlogId('https://blog.naver.com/MyBlog.naver'), '');
  assert.equal(extractBlogId('https://evil.example/example'), '');
});

test('normalizeBlogItem strips markup', () => {
  assert.deepEqual(normalizeBlogItem({
    bloggerlink: 'https://blog.naver.com/hello',
    title: '<b>제목</b>',
    description: '설명 &amp; 소개',
    bloggername: '<b>블로거</b>',
    postdate: '20260824'
  }), {
    blogId: 'hello', title: '제목', description: '설명 & 소개',
    bloggerName: '블로거', link: 'https://blog.naver.com/hello', postDate: '20260824'
  });
});

test('search deduplicates blogs and caps display', async () => {
  let requestedUrl = '';
  const client = new NaverSearchClient({
    clientId: 'id', clientSecret: 'secret',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => ({ items: [
        { bloggerlink: 'https://blog.naver.com/a-blog', title: 'A' },
        { bloggerlink: 'https://blog.naver.com/a-blog', title: 'A2' },
        { bloggerlink: 'https://example.com/nope', title: 'B' }
      ] }) };
    }
  });
  const items = await client.search({ query: '캠핑 장비', display: 500 });
  assert.equal(items.length, 1);
  assert.match(requestedUrl, /display=100/);
  assert.match(requestedUrl, /query=%EC%BA%A0%ED%95%91\+%EC%9E%A5%EB%B9%84/);
});

test('login page classification distinguishes security checks and credential errors', () => {
  assert.equal(classifyLoginPage({ authenticated: true }).status, 'connected');
  assert.deepEqual(classifyLoginPage({ text: '자동입력 방지 문자를 입력해 주세요.' }), {
    status: 'user_action',
    reason: 'captcha',
    message: '열린 네이버 창에서 자동입력 방지 문자를 입력해주세요.'
  });
  assert.equal(classifyLoginPage({ text: '아이디 또는 비밀번호를 잘못 입력했습니다.' }).status, 'invalid_credentials');
  assert.equal(classifyLoginPage({ text: '새로운 환경에서 로그인되었습니다.' }).reason, 'verification');
});

test('web search links become one card per blog', () => {
  const items = normalizeWebSearchLinks([
    { href: 'https://blog.naver.com/parent-note', text: '부모 노트\n새 창 열림' },
    { href: 'https://blog.naver.com/parent-note/123', text: '육아용품 정리\n새 창 열림' },
    { href: 'https://blog.naver.com/parent-note/123', text: '아이와 직접 사용해 본 육아용품을 자세하게 정리했습니다.' },
    { href: 'https://example.com/not-blog', text: '제외' }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].bloggerName, '부모 노트');
  assert.equal(items[0].title, '육아용품 정리');
  assert.match(items[0].description, /직접 사용/);
});

test('neighbor result classification handles success and known skips', () => {
  assert.equal(classifyNeighborResult('', true).status, 'added');
  assert.equal(classifyNeighborResult('이미 이웃으로 추가된 블로그입니다.').status, 'already_added');
  assert.equal(classifyNeighborResult('이미 추가한 이웃입니다.').status, 'already_added');
  assert.equal(classifyNeighborResult('홍길동님과 현재 이웃입니다.').status, 'already_added');
  assert.equal(classifyNeighborResult('자신의 블로그는 이웃으로 추가할 수 없습니다.').status, 'self');
  assert.equal(classifyNeighborResult('자동입력 방지 문자를 입력하세요.').status, 'verification_required');
  assert.equal(classifyNeighborResult('현재 서로이웃입니다.').status, 'already_mutual');
  assert.equal(classifyNeighborResult('서로이웃 신청중입니다.').status, 'requested');
  assert.equal(classifyNeighborResult('서로이웃 신청 진행중입니다.').status, 'requested');
  assert.equal(classifyNeighborResult('이웃수 5000명 초과로 서로이웃을 더 맺을 수 없습니다.').status, 'unavailable');
});

test('editor image placement targets the ranked section heading, not its summary mention', () => {
  const heading = editorHeadingText('3위. [아마존] MSI 프리렌한정판 5070 TI ($1,149.99)');
  const summary = editorHeadingText('3. 핵심 혜택 3: MSI 프리렌한정판 5070 TI 특가');
  assert.equal(heading, '3. [아마존] MSI 프리렌한정판 5070 TI ($1,149.99)');
  assert.notEqual(summary, heading);
  assert.equal(isProductSectionCandidate(
    '3. 핵심 혜택 3: MSI 프리렌한정판 5070 TI 특가',
    ['다음 요약 문장'],
    'MSI 프리렌한정판 5070 TI'
  ), false);
  assert.equal(isProductSectionCandidate(
    '4. [아마존] MSI 프리렌한정판 5070 TI ($1,149.99)',
    ['판매처: 아마존', '가격: $1,149.99', '배송: 배송 $129.53'],
    'MSI 프리렌한정판 5070 TI'
  ), true);
});

test('editor images are interleaved after each product information line', () => {
  const content = [
    '오늘의 핫딜 한눈에 보기',
    '1. 갈비 특가',
    '',
    '상품 1 | 미트프로젝트 양념 LA 꽃갈비 800g',
    '가격 | 27,900원',
    '상품 정보 | 냉장 보관하는 양념 LA 꽃갈비 상품입니다.',
    '',
    '상품 2 | 얼리버드 쿠폰',
    '가격 | 무료',
    '상품 정보 | 행사 페이지에서 적용 대상을 확인해주세요.'
  ].join('\n');
  const first = { title: '미트프로젝트 양념 LA 꽃갈비 800g', afterHeading: '상품 정보 | 냉장 보관하는 양념 LA 꽃갈비 상품입니다.' };
  const second = { title: '얼리버드 쿠폰', afterHeading: '상품 정보 | 행사 페이지에서 적용 대상을 확인해주세요.' };
  const mapped = mapImagesToContentLines(content, [first, second]);
  assert.deepEqual([...mapped.keys()], [5, 9]);
  assert.equal(mapped.get(5)[0], first);
  assert.equal(mapped.get(9)[0], second);
});

test('publish preflight rejects scrambled product image and link components', () => {
  const url = 'https://shop.example/product/1';
  const correct = assessProductLayout([
    { type: 'text', text: '상품 정보 | 첫 상품 설명' },
    { type: 'image', text: '' },
    { type: 'text', text: `${url} 상품 페이지 열기`, hrefs: [url] }
  ], [{ anchor: '상품 정보 | 첫 상품 설명', url }]);
  assert.equal(correct.ok, true);

  const scrambled = assessProductLayout([
    { type: 'text', text: '상품 정보 | 첫 상품 설명' },
    { type: 'text', text: url, hrefs: [url] },
    { type: 'image', text: '' }
  ], [{ anchor: '상품 정보 | 첫 상품 설명', url }]);
  assert.equal(scrambled.ok, false);
  assert.match(scrambled.problems.join(', '), /클릭 링크 위치 없음/);
});

test('publish preflight accepts Naver grouping the previous URL and next product text together', () => {
  const firstUrl = 'https://shop.example/product/1';
  const secondUrl = 'https://shop.example/product/2';
  const grouped = assessProductLayout([
    { type: 'text', text: '상품 정보 | 첫 상품 설명' },
    { type: 'image', text: '' },
    { type: 'text', text: `${firstUrl} 상품 페이지 열기 ───── 상품 2 | 두 번째 상품 상품 정보 | 두 번째 상품 설명`, hrefs: [firstUrl] },
    { type: 'image', text: '' },
    { type: 'text', text: `${secondUrl} 상품 페이지 열기`, hrefs: [secondUrl] }
  ], [
    { anchor: '상품 정보 | 첫 상품 설명', url: firstUrl },
    { anchor: '상품 정보 | 두 번째 상품 설명', url: secondUrl }
  ]);
  assert.equal(grouped.ok, true, grouped.problems.join(', '));
});
