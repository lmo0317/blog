import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneShotPostingManager } from '../lib/oneshot.js';

function makeManager({ connected = true, history = [], items } = {}) {
  const published = [];
  const briefs = [];
  const manager = new OneShotPostingManager({
    agyClient: {
      generatePostBrief: async ({ topic, golden }) => { briefs.push({ topic, golden }); return `brief for ${topic}`; },
      generateBlogPost: async ({ topic, notes }) => ({ title: `${topic} 총정리`, content: `${notes} 본문`, tags: [topic], imagePlans: [{ afterHeading: '소제목' }] })
    },
    browserSession: { connected },
    postHistoryStore: {
      recent: async () => history,
      findSimilar: async () => null
    },
    imageModelManager: {},
    discoverGoldenKeywords: async () => ({
      items: items || [
        { keyword: '캠핑 의자 추천', grade: 'S', score: 80, reasons: [{ text: '노린 글 적음' }], topPosts: [{ title: '상위글', ageText: '1년 전' }], demand: { level: '높음' } },
        { keyword: '캠핑 의자 세트', grade: 'A', score: 65, reasons: [], topPosts: [] },
        { keyword: '캠핑 의자', grade: 'C', score: 30, reasons: [], topPosts: [] },
        { keyword: '경량 캠핑 의자', grade: 'B', score: 50, reasons: [], topPosts: [] }
      ]
    }),
    generateAiDrawingsForPost: async () => [{ downloadUrl: 'generated-images/a.jpg' }],
    publishPost: async (post) => { published.push(post); return { status: 'published', url: `https://blog.naver.com/x/${published.length}` }; },
    imagesDir: '/tmp',
    gapMinutes: [0, 0]
  });
  return { manager, published, briefs };
}

async function waitDone(manager) {
  for (let i = 0; i < 200 && ['running', 'waiting'].includes(manager.state); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('one-shot posts golden keywords in grade order, skipping C and already-posted keywords', async () => {
  const { manager, published, briefs } = makeManager({ history: [{ title: '캠핑 의자 세트 비교', sourceTopic: '캠핑 의자 세트' }] });
  await manager.start({ seed: '캠핑 의자', count: 3 });
  await waitDone(manager);
  assert.equal(manager.state, 'completed');
  assert.deepEqual(published.map((post) => post.sourceTopic), ['캠핑 의자 추천', '경량 캠핑 의자']);
  assert.equal(briefs[0].golden.topPosts[0].title, '상위글');
  assert.equal(published[0].images[0].afterHeading, '소제목');
  assert.ok(manager.posts.every((post) => post.status === 'published' && post.url));
});

test('one-shot refuses to start without a Naver login', async () => {
  const { manager } = makeManager({ connected: false });
  await assert.rejects(() => manager.start({ seed: '캠핑 의자', count: 1 }), /네이버 계정/);
  assert.equal(manager.state, 'idle');
});

test('one-shot stops after a login problem instead of trying the next posts', async () => {
  const { manager } = makeManager();
  manager.publishPost = async () => { throw new Error('네이버 로그인 세션이 만료되었습니다.'); };
  await manager.start({ seed: '캠핑 의자', count: 3 });
  await waitDone(manager);
  assert.equal(manager.state, 'stopped');
  assert.equal(manager.posts[0].status, 'failed');
  assert.ok(manager.posts.slice(1).every((post) => post.status === 'stopped'));
});
