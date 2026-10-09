// One-shot auto posting: from a single topic, pick golden keywords not posted yet and, for each one,
// write a brief, write the post, draw the images and publish it to Naver, one after another with a
// random gap between posts (to stay clear of Naver's account protection). Runs on the server, so the
// browser can be closed; the latest job (settings, progress, log) is kept on disk.
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAX_POSTS = 5;
const GAP_MIN_MINUTES = 15;
const GAP_MAX_MINUTES = 30;
const ACTIVE_STATES = new Set(['running', 'waiting']);

const normalizeKeyword = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');

export class OneShotPostingManager extends EventEmitter {
  constructor({
    agyClient,
    browserSession,
    postHistoryStore,
    imageModelManager,
    discoverGoldenKeywords,
    generateAiDrawingsForPost,
    publishPost,
    imagesDir,
    statePath = '',
    gapMinutes = [GAP_MIN_MINUTES, GAP_MAX_MINUTES]
  }) {
    super();
    Object.assign(this, { agyClient, browserSession, postHistoryStore, imageModelManager, discoverGoldenKeywords, generateAiDrawingsForPost, publishPost, imagesDir, statePath, gapMinutes });
    this.state = 'idle'; // idle | running | waiting | completed | stopped | error
    this.config = { seed: '', count: 3 };
    this.posts = [];
    this.logs = [];
    this.startedAt = null;
    this.endedAt = null;
    this.nextPostAt = null;
    this.shouldStop = false;
    this.wakeUp = null;
    this.restore();
  }

  getStatus() {
    return {
      state: this.state,
      config: this.config,
      posts: this.posts,
      logs: this.logs.slice(0, 80),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      nextPostAt: this.nextPostAt,
      limits: { maxPosts: MAX_POSTS, gapMinutes: this.gapMinutes }
    };
  }

  log(message, type = 'info') {
    const now = new Date();
    this.logs.unshift({ time: now.toLocaleTimeString('ko-KR', { hour12: false }), timestamp: now.toISOString(), message, type });
    if (this.logs.length > 300) this.logs.pop();
    console.log(`[OneShot] ${message}`);
    this.changed();
  }

  changed() {
    this.emit('status', this.getStatus());
    this.save();
  }

  save() {
    if (!this.statePath) return;
    try {
      mkdirSync(path.dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify({ ...this.getStatus(), logs: this.logs.slice(0, 300) }));
    } catch (error) {
      console.warn('[OneShot] Could not save state:', error.message);
    }
  }

  restore() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8'));
      this.config = saved.config || this.config;
      this.posts = Array.isArray(saved.posts) ? saved.posts : [];
      this.logs = Array.isArray(saved.logs) ? saved.logs : [];
      this.startedAt = saved.startedAt || null;
      this.endedAt = saved.endedAt || null;
      this.state = ACTIVE_STATES.has(saved.state) ? 'stopped' : (saved.state || 'idle');
      if (ACTIVE_STATES.has(saved.state)) {
        this.endedAt = new Date().toISOString();
        this.posts.forEach((post) => { if (!['published', 'failed', 'skipped'].includes(post.status)) post.status = 'stopped'; });
        const now = new Date();
        this.logs.unshift({ time: now.toLocaleTimeString('ko-KR', { hour12: false }), timestamp: now.toISOString(), message: '⚠️ 프로그램이 다시 시작되어 원샷 포스팅이 멈췄습니다. 남은 글은 다시 시작하면 이어서 만듭니다.', type: 'warn' });
      }
    } catch (error) {
      console.warn('[OneShot] Could not restore state:', error.message);
    }
  }

  async start({ seed, count = 3, tone = 'friendly', length = 'medium' } = {}) {
    if (ACTIVE_STATES.has(this.state)) throw new Error('이미 원샷 포스팅이 진행 중입니다.');
    const cleanSeed = String(seed || '').replace(/\s+/g, ' ').trim();
    if (cleanSeed.length < 2 || cleanSeed.length > 50) throw new Error('주제를 2~50자로 입력해 주세요.');
    if (!this.browserSession?.connected) throw new Error('네이버 계정이 연결되어 있지 않습니다. 설정 탭에서 QR 로그인을 먼저 해 주세요.');

    this.config = {
      seed: cleanSeed,
      count: Math.min(Math.max(Number(count) || 1, 1), MAX_POSTS),
      tone: ['informative', 'friendly', 'review'].includes(tone) ? tone : 'friendly',
      length: ['short', 'medium', 'long'].includes(length) ? length : 'medium'
    };
    this.posts = [];
    this.logs = [];
    this.state = 'running';
    this.shouldStop = false;
    this.startedAt = new Date().toISOString();
    this.endedAt = null;
    this.nextPostAt = null;
    this.log(`🚀 '${cleanSeed}' 주제로 글 ${this.config.count}개 원샷 포스팅을 시작합니다.`, 'info');

    this.run().catch((error) => {
      this.state = 'error';
      this.endedAt = new Date().toISOString();
      this.log(`❌ 원샷 포스팅이 오류로 멈췄습니다: ${error.message}`, 'error');
    });
    return this.getStatus();
  }

  stop() {
    if (!ACTIVE_STATES.has(this.state)) return this.getStatus();
    this.shouldStop = true;
    this.wakeUp?.();
    this.log('⏹ 중단 요청을 받았습니다. 지금 단계가 끝나면 멈춥니다.', 'warn');
    return this.getStatus();
  }

  async pickKeywords() {
    const { seed, count } = this.config;
    this.log(`🏆 '${seed}' 황금 키워드를 찾는 중... (10~20초)`);
    const result = await this.discoverGoldenKeywords({ keyword: seed, limit: 24 });
    const recent = await this.postHistoryStore.recent(300);
    const used = new Set(recent.flatMap((record) => [normalizeKeyword(record.sourceTopic), normalizeKeyword(record.title)]).filter(Boolean));
    const isUsed = (keyword) => {
      const key = normalizeKeyword(keyword);
      return used.has(key) || [...used].some((value) => value.length > 4 && value.includes(key) && key.length >= 6);
    };
    const rank = { S: 0, A: 1, B: 2 };
    const candidates = (result.items || [])
      .filter((item) => item.grade in rank && !isUsed(item.keyword))
      .sort((a, b) => rank[a.grade] - rank[b.grade] || b.score - a.score);
    const picked = candidates.slice(0, count);
    if (!picked.length) {
      this.log(`ℹ️ 쓸 만한 황금 키워드가 없어 '${seed}' 주제 그대로 씁니다.`, 'warn');
      return [{ keyword: seed, grade: '-', golden: null }];
    }
    if (picked.length < count) this.log(`ℹ️ 아직 안 쓴 황금·추천·보통 키워드가 ${picked.length}개뿐이라 ${picked.length}개만 만듭니다.`, 'warn');
    this.log(`✅ 고른 키워드: ${picked.map((item) => `${item.keyword}(${item.grade})`).join(', ')}`, 'success');
    return picked.map((item) => ({
      keyword: item.keyword,
      grade: item.grade,
      golden: {
        keyword: item.keyword,
        demand: item.demand?.level || '',
        summary: item.summary || '',
        reasons: (item.reasons || []).map((reason) => reason.text),
        topPosts: (item.topPosts || []).map((post) => ({ title: post.title, ageText: post.ageText }))
      }
    }));
  }

  setPost(index, patch) {
    this.posts[index] = { ...this.posts[index], ...patch };
    this.changed();
  }

  async waitGap() {
    const [low, high] = this.gapMinutes;
    const minutes = low + Math.random() * (high - low);
    const ms = Math.round(minutes * 60 * 1000);
    this.state = 'waiting';
    this.nextPostAt = new Date(Date.now() + ms).toISOString();
    this.log(`⏳ 계정 보호를 위해 ${Math.round(minutes)}분 쉬었다가 다음 글을 만듭니다.`, 'delay');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wakeUp = () => { clearTimeout(timer); resolve(); };
    });
    this.wakeUp = null;
    this.nextPostAt = null;
    if (!this.shouldStop) this.state = 'running';
    this.changed();
  }

  async run() {
    const targets = await this.pickKeywords();
    this.posts = targets.map((target) => ({ keyword: target.keyword, grade: target.grade, status: 'pending', step: '대기', title: '', url: '' }));
    this.changed();

    for (let i = 0; i < targets.length; i += 1) {
      if (this.shouldStop) break;
      if (i > 0) {
        await this.waitGap();
        if (this.shouldStop) break;
      }
      await this.makeOnePost(i, targets[i]);
    }

    this.endedAt = new Date().toISOString();
    if (this.shouldStop) {
      this.state = 'stopped';
      this.posts.forEach((post, index) => { if (post.status === 'pending') this.posts[index] = { ...post, status: 'stopped', step: '중단됨' }; });
      this.log('⏹ 원샷 포스팅을 중단했습니다.', 'warn');
    } else {
      this.state = 'completed';
      const published = this.posts.filter((post) => post.status === 'published').length;
      this.log(`🏁 원샷 포스팅 완료: ${this.posts.length}개 중 ${published}개 발행`, published ? 'success' : 'warn');
    }
    this.changed();
  }

  async makeOnePost(index, target) {
    const label = `[${index + 1}/${this.posts.length}] '${target.keyword}'`;
    try {
      this.setPost(index, { status: 'working', step: '간략한 내용 작성' });
      this.log(`✨ ${label} 간략한 내용을 만드는 중...`);
      const brief = await this.agyClient.generatePostBrief({ topic: target.keyword, golden: target.golden });
      if (this.shouldStop) return this.setPost(index, { status: 'stopped', step: '중단됨' });

      this.setPost(index, { step: '글 작성' });
      this.log(`✍️ ${label} 글을 쓰는 중... (1~2분)`);
      const avoidHistory = await this.postHistoryStore.recent(25);
      const post = await this.agyClient.generateBlogPost({
        topic: target.keyword,
        tone: this.config.tone,
        length: this.config.length,
        notes: brief,
        avoidHistory
      });
      const duplicate = await this.postHistoryStore.findSimilar({ topic: target.keyword, title: post.title, content: post.content });
      if (duplicate) {
        this.log(`⏩ ${label} 이미 발행한 글 "${duplicate.record.title}"과 너무 비슷해 건너뜁니다.`, 'warn');
        return this.setPost(index, { status: 'skipped', step: '비슷한 글이 있어 건너뜀', title: post.title });
      }
      this.setPost(index, { step: '이미지 생성', title: post.title });
      if (this.shouldStop) return this.setPost(index, { status: 'stopped', step: '중단됨' });

      this.log(`🎨 ${label} Google Imagen으로 이미지 3장을 그리는 중... (1~2분)`);
      const images = await this.generateAiDrawingsForPost(post, this.imagesDir, { style: 'photorealistic', imageModelManager: this.imageModelManager });
      if (this.shouldStop) return this.setPost(index, { status: 'stopped', step: '중단됨' });

      this.setPost(index, { step: '네이버 발행' });
      this.log(`📤 ${label} 네이버 블로그에 발행하는 중... (이미지 ${images.length}장)`);
      const plans = post.imagePlans || [];
      const result = await this.publishPost({
        title: post.title,
        content: post.content,
        tags: post.tags || [],
        images: images.map((image, order) => ({ ...image, afterHeading: image.afterHeading || plans[order]?.afterHeading || '' })),
        sourceTopic: target.keyword
      });
      if (result?.status !== 'published') throw new Error(result?.message || '네이버 발행 결과를 확인하지 못했습니다.');
      this.setPost(index, { status: 'published', step: '발행 완료', url: result.url || '' });
      this.log(`✅ ${label} 발행 완료: ${post.title}${result.url ? ` (${result.url})` : ''}`, 'success');
    } catch (error) {
      this.setPost(index, { status: 'failed', step: `실패: ${error.message.slice(0, 80)}` });
      this.log(`❌ ${label} 실패: ${error.message}`, 'error');
      if (/로그인|세션|보호조치|인증/.test(error.message)) {
        this.shouldStop = true;
        this.log('⏹ 네이버 로그인·보호 문제로 남은 글은 만들지 않고 멈춥니다. 설정 탭에서 로그인 상태를 확인해 주세요.', 'warn');
      }
    }
  }
}
