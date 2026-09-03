import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
await fs.mkdir('test-results', { recursive: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.route('**/api/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, connected: true })
  }));
  await page.route('**/api/search', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: '육아', items: [
      { blogId: 'happy-family', bloggerName: '행복한 가족', description: '아이와 함께하는 일상 기록', link: 'https://blog.naver.com/happy-family' },
      { blogId: 'play-day', bloggerName: '오늘도 놀이', description: '주말 체험과 놀이 아이디어', link: 'https://blog.naver.com/play-day' },
      { blogId: 'parent-note', bloggerName: '부모 노트', description: '육아용품과 생활 팁', link: 'https://blog.naver.com/parent-note' }
    ] })
  }));
  await page.route('**/api/blog/deals?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ deals: [{
      dealId: '1', rank: 1, shop: 'G마켓', source: '테스트 커뮤니티', title: '테스트 간식 세트',
      price: '15,840원', shipping: '배송 무료', image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      url: 'https://item.gmarket.co.kr/Item?goodscode=1', algumonUrl: 'https://www.algumon.com/n/deal/1', linkType: 'product'
    }] })
  }));
  await page.route('**/api/blog/deals/draft', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      title: '[오늘의 핫딜] 테스트 간식 세트',
      content: '오늘의 핫딜 한눈에 보기\n- 테스트 간식 세트 | 15,840원\n\n────────────────────────\n상품 1 | 테스트 간식 세트\n판매처 | G마켓\n가격 | 15,840원\n배송 | 무료\n상품 정보 | 간편하게 확인할 수 있는 상품입니다.\n상품 페이지 | 아래 파란 주소를 클릭하세요.\nhttps://item.gmarket.co.kr/Item?goodscode=1\n\n────────────────────────\n마무리\n구매 전 최종 조건을 확인해주세요.',
      tags: ['핫딜', '특가'],
      imageQueries: ['snack set'],
      sectionHeadings: ['상품 1 | 테스트 간식 세트'],
      imagePlans: [{ query: 'snack set', afterHeading: '상품 정보 | 간편하게 확인할 수 있는 상품입니다.' }],
      dealImages: [{
        id: 'deal-image-1', title: '테스트 간식 세트', previewUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        downloadUrl: 'https://cdn.algumon.com/image-v2/deal/test.jpeg', pageUrl: 'https://item.gmarket.co.kr/Item?goodscode=1',
        author: 'G마켓', license: '핫딜 상품 이미지', licenseUrl: 'https://item.gmarket.co.kr/Item?goodscode=1',
        afterHeading: '상품 정보 | 간편하게 확인할 수 있는 상품입니다.', caption: '테스트 상품 대표 이미지'
      }],
      model: 'gemma-4-e4b-it-q4km'
    })
  }));
  await page.route('**/api/blog/images?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{
      id: '1', title: '테스트 간식 세트', previewUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/test.jpg',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Test.jpg', author: '테스트 작가',
      license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', description: '푸른 바다'
    }] })
  }));
  await page.route('**/api/blog/images/auto', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{
      id: '1', title: '여름 바다', previewUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/test.jpg',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Test.jpg', author: '테스트 작가',
      license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', description: '푸른 바다',
      afterHeading: '상품 정보 | 간편하게 확인할 수 있는 상품입니다.', caption: '상품 문단과 연결되는 사진입니다.', autoSelected: true
    }] })
  }));
  await page.route('**/api/blog/publish', (route) => {
    const payload = route.request().postDataJSON();
    if (payload.images?.length !== 1 || payload.images[0].afterHeading !== '상품 정보 | 간편하게 확인할 수 있는 상품입니다.') throw new Error('선택 이미지와 문단 배치가 발행 요청에 포함되지 않았습니다.');
    if (!payload.content.includes('https://item.gmarket.co.kr/Item?goodscode=1') || payload.content.includes('algumon.com/n/deal')) throw new Error('실제 상품 링크가 발행 본문에 포함되지 않았습니다.');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'published', message: '블로그 글이 발행되었습니다.', url: 'https://blog.naver.com/example/123' })
    });
  });

  await page.goto('http://127.0.0.1:4310', { waitUntil: 'networkidle' });
  const neighborTab = page.getByRole('tab', { name: /서로이웃 추가/ });
  const publishTab = page.getByRole('tab', { name: /블로그 게시/ });
  if (await neighborTab.getAttribute('aria-selected') !== 'true') throw new Error('서로이웃 추가 탭이 기본 선택되지 않았습니다.');

  await publishTab.click();
  if (await publishTab.getAttribute('aria-selected') !== 'true') throw new Error('블로그 게시 탭이 선택되지 않았습니다.');
  if (await neighborTab.getAttribute('aria-selected') !== 'false') throw new Error('비활성 탭의 선택 상태가 해제되지 않았습니다.');
  if (!(await page.getByRole('heading', { name: '알구몬 실시간 핫딜 TOP 5 블로그 자동발행', exact: true }).isVisible())) throw new Error('블로그 게시 화면이 표시되지 않았습니다.');
  if (!(await page.locator('#neighborWorkspace').isHidden())) throw new Error('게시 탭에서 서로이웃 화면이 숨겨지지 않았습니다.');
  await page.getByRole('button', { name: '알구몬 최저가 5개 긁어오기', exact: true }).click();
  await page.getByRole('link', { name: /상품 보기/ }).waitFor();
  if ((await page.getByRole('link', { name: /상품 보기/ }).getAttribute('href')).includes('algumon.com')) throw new Error('딜 카드가 알구몬 링크를 사용합니다.');
  await page.getByRole('button', { name: '로컬 LLM으로 핫딜 글 작성', exact: true }).click();
  await page.locator('#postTitle').waitFor({ state: 'visible' });
  if (await page.locator('#postTitle').inputValue() !== '[오늘의 핫딜] 테스트 간식 세트') throw new Error('LLM 초안 제목이 입력되지 않았습니다.');
  await page.getByRole('checkbox', { name: '테스트 간식 세트 선택', exact: true }).waitFor();
  const publishButton = page.getByRole('button', { name: '네이버 블로그에 게시 발행', exact: true });
  if (await publishButton.isEnabled()) throw new Error('발행 동의 전에 게시 버튼이 활성화되었습니다.');
  await page.getByText('제목·본문·상품 이미지를 검토했으며', { exact: false }).click();
  if (!(await publishButton.isEnabled())) throw new Error('발행 동의 후 게시 버튼이 활성화되지 않았습니다.');
  await publishButton.click();
  await page.getByRole('link', { name: /발행된 글 보기/ }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/publish-tab.png', fullPage: true });

  await neighborTab.click();
  if (!(await page.locator('#neighborWorkspace').isVisible())) throw new Error('서로이웃 추가 화면으로 돌아오지 못했습니다.');
  await page.getByPlaceholder('예: 강남 맛집, 육아 일상, 캠핑 장비').fill('육아');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.getByText('행복한 가족', { exact: true }).waitFor();
  await page.locator('.result input').first().check();

  if (await page.locator('.result').count() !== 3) throw new Error('검색 결과 카드 수가 다릅니다.');
  if (await page.locator('.selection-bar').isHidden()) throw new Error('선택 바가 표시되지 않았습니다.');
  if (await page.getByRole('button', { name: '선택한 서로이웃 일괄 신청' }).isEnabled()) {
    throw new Error('검토 동의 전 실행 버튼이 활성화되었습니다.');
  }
  await page.getByText('선택한 블로그에 서로이웃 신청을 보내는', { exact: false }).click();
  if (!(await page.getByRole('button', { name: '선택한 서로이웃 일괄 신청' }).isEnabled())) {
    throw new Error('검토 동의 후 실행 버튼이 활성화되지 않았습니다.');
  }
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error(`모바일 가로 넘침: ${JSON.stringify(metrics)}`);
  if (errors.length) throw new Error(`브라우저 콘솔 오류: ${errors.join(' | ')}`);

  console.log(JSON.stringify({ ok: true, tabs: 2, cards: 3, mobileOverflow: false, consoleErrors: errors.length }));
} finally {
  await browser.close();
}
