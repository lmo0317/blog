import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function koreaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatKoreanTime(date = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  }).format(date);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseFeedHtml(html = '') {
  // Pure string/regex parser for unit test environments where DOM is mocked
  const items = [];
  const linkRegex = /href=["'](https?:\/\/m\.blog\.naver\.com\/([a-zA-Z0-9_.-]+)\/(\d{8,15}))(?:\?[^"']*)?["']/g;
  const seen = new Set();
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const fullUrl = match[1];
    const blogId = match[2];
    const logNo = match[3];
    if (blogId === 'blogpeople') continue;
    if (seen.has(logNo)) continue;
    seen.add(logNo);

    items.push({
      blogId,
      logNo,
      author: blogId,
      title: `이웃 새글 (${blogId})`,
      url: `https://m.blog.naver.com/${blogId}/${logNo}`
    });
  }
  return items;
}

export async function fetchNeighborFeedPosts(page, { maxItems = 30, maxScrolls = 8 } = {}) {
  await page.goto('https://m.blog.naver.com/FeedList.naver', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1200);

  // Progressive scroll to load deeper neighbor posts beyond 30
  let scrollAttempts = 0;
  while (scrollAttempts < maxScrolls) {
    const currentCount = await page.evaluate(() => {
      const postLinks = document.querySelectorAll('a[href*="?enterPage=feed"], a[data-click-area="fed.bptn"], a[data-ba-scene-id="neighbor_new_post"]');
      return postLinks.length;
    }).catch(() => 0);

    if (currentCount >= maxItems) break;

    // Scroll down to load more
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(1000);

    const newCount = await page.evaluate(() => {
      const postLinks = document.querySelectorAll('a[href*="?enterPage=feed"], a[data-click-area="fed.bptn"], a[data-ba-scene-id="neighbor_new_post"]');
      return postLinks.length;
    }).catch(() => 0);

    if (newCount <= currentCount) {
      // Reached bottom of feed or no more posts available
      break;
    }
    scrollAttempts += 1;
  }

  const posts = await page.evaluate((max) => {
    const postLinks = Array.from(document.querySelectorAll('a[href*="?enterPage=feed"], a[data-click-area="fed.bptn"], a[data-ba-scene-id="neighbor_new_post"]'));
    const unique = new Map();

    for (const link of postLinks) {
      const match = (link.href || '').match(/m\.blog\.naver\.com\/([a-zA-Z0-9_.-]+)\/(\d{8,15})/);
      if (!match) continue;
      const blogId = match[1];
      const logNo = match[2];
      if (blogId === 'blogpeople') continue; // Skip official Naver announcements
      if (unique.has(logNo)) continue;

      let card = link.closest('.feed_item, .card_item, li, div') || link.parentElement;
      while (card && card.parentElement && card.parentElement.children.length > 3 && card.parentElement.className.includes('list')) {
        break;
      }

      const title = (link.querySelector('strong, h3, h4, [class*="title"]')?.innerText || link.innerText || '').replace(/\s+/g, ' ').trim();
      let author = blogId;
      const authorLink = card?.querySelector(`a[href*="m.blog.naver.com/${blogId}"]:not([href*="${logNo}"])`);
      if (authorLink && authorLink.innerText.trim()) {
        author = authorLink.innerText.replace(/\s+/g, ' ').trim();
      }

      const timeEl = card?.querySelector('[class*="time"], [class*="date"], time, .txt_date');
      const publishedTime = (timeEl?.innerText || '').replace(/\s+/g, ' ').trim();

      const imgEl = card?.querySelector('img:not([src*="static.naver"]):not([src*="profile"])');
      const thumbnail = imgEl?.src || '';

      unique.set(logNo, {
        blogId,
        logNo,
        author: author || blogId,
        title: title.slice(0, 100) || `${author} 님의 새 글`,
        url: `https://m.blog.naver.com/${blogId}/${logNo}`,
        publishedTime,
        thumbnail
      });

      if (unique.size >= max) break;
    }

    return Array.from(unique.values());
  }, maxItems);

  return posts;
}

export class FeedEngagementHistoryStore {
  constructor(filePath) {
    this.filePath = filePath || path.resolve(process.cwd(), '.data', 'feed-engagement-history.json');
    this.data = {
      records: [],
      dailyCounts: {}
    };
    this.loaded = false;
    this.loadSync();
  }

  loadSync() {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          records: Array.isArray(parsed.records) ? parsed.records : [],
          dailyCounts: parsed.dailyCounts && typeof parsed.dailyCounts === 'object' ? parsed.dailyCounts : {}
        };
        this.loaded = true;
      }
    } catch (e) {
      console.warn('[FeedEngagementHistoryStore] Load sync warning:', e.message);
    }
  }

  async load() {
    if (this.loaded) return;
    try {
      if (existsSync(this.filePath)) {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          records: Array.isArray(parsed.records) ? parsed.records : [],
          dailyCounts: parsed.dailyCounts && typeof parsed.dailyCounts === 'object' ? parsed.dailyCounts : {}
        };
      }
      this.loaded = true;
    } catch (e) {
      console.warn('[FeedEngagementHistoryStore] Load async warning:', e.message);
    }
  }

  saveSync() {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[FeedEngagementHistoryStore] Save sync error:', e.message);
    }
  }

  async save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[FeedEngagementHistoryStore] Save async error:', e.message);
    }
  }

  async hasEngaged(logNoOrUrl) {
    await this.load();
    const target = String(logNoOrUrl || '').trim();
    if (!target) return false;
    return this.data.records.some((r) => r.logNo === target || r.url === target || (r.url && r.url.includes(target)));
  }

  async getRecord(logNoOrUrl) {
    await this.load();
    const target = String(logNoOrUrl || '').trim();
    if (!target) return null;
    return this.data.records.find((r) => r.logNo === target || r.url === target || (r.url && r.url.includes(target))) || null;
  }

  async addRecord({ blogId, logNo, author = '', title = '', url = '', liked = false, commented = false, commentText = '', status = 'success', statusMessage = '' }) {
    await this.load();
    const dateKey = koreaDateKey();
    const nowIso = new Date().toISOString();

    const record = {
      blogId,
      logNo,
      author: author || blogId,
      title,
      url,
      liked: Boolean(liked),
      commented: Boolean(commented),
      commentText: String(commentText || '').trim(),
      status,
      statusMessage,
      timestamp: nowIso,
      date: dateKey
    };

    // Remove existing duplicate record if any, then prepend
    this.data.records = this.data.records.filter((r) => r.logNo !== logNo);
    this.data.records.unshift(record);

    // Keep maximum 1000 records
    if (this.data.records.length > 1000) {
      this.data.records = this.data.records.slice(0, 1000);
    }

    if (!this.data.dailyCounts[dateKey]) {
      this.data.dailyCounts[dateKey] = { total: 0, likes: 0, comments: 0 };
    }
    this.data.dailyCounts[dateKey].total += 1;
    if (liked) this.data.dailyCounts[dateKey].likes += 1;
    if (commented) this.data.dailyCounts[dateKey].comments += 1;

    await this.save();
    return record;
  }

  async getSummary() {
    await this.load();
    const dateKey = koreaDateKey();
    const today = this.data.dailyCounts[dateKey] || { total: 0, likes: 0, comments: 0 };
    return {
      todayTotal: today.total,
      todayLikes: today.likes,
      todayComments: today.comments,
      totalRecords: this.data.records.length,
      recentRecords: this.data.records.slice(0, 20)
    };
  }

  async getRecentComments(limit = 30) {
    await this.load();
    return this.data.records
      .filter((r) => r.commented && r.commentText)
      .slice(0, limit)
      .map((r) => r.commentText);
  }
}

export class FeedEngagementManager {
  constructor({ browserSession, embeddedLlama, historyStore }) {
    this.browserSession = browserSession;
    this.embeddedLlama = embeddedLlama;
    this.historyStore = historyStore;

    this.state = 'idle'; // idle | running | paused | stopped | completed | error
    this.shouldStop = false;
    this.isPaused = false;
    this.currentPost = null;
    this.logs = [];

    this.stats = {
      totalFound: 0,
      processedCount: 0,
      successCount: 0,
      likedCount: 0,
      commentedCount: 0,
      skippedCount: 0,
      targetReached: false,
      protectionTriggered: false
    };

    this.config = {
      targetCount: 10,
      doLike: true,
      doComment: true,
      commentTone: 'friendly',
      minDelaySec: 25,
      maxDelaySec: 45
    };
  }

  log(message, level = 'info') {
    const entry = {
      time: formatKoreanTime(),
      // The UI consumes `type`; keep `level` too for any older consumers.
      type: level,
      level,
      message
    };
    this.logs.unshift(entry);
    if (this.logs.length > 300) this.logs.pop();
    console.log(`[AutoFeed] [${entry.time}] ${message}`);
  }

  getState() {
    const recentRecords = this.historyStore?.data?.records?.slice(0, 50) || [];
    return {
      state: this.state,
      stats: {
        ...this.stats,
        target: this.config.targetCount,
        remaining: Math.max(0, this.config.targetCount - this.stats.successCount)
      },
      config: { ...this.config },
      currentPost: this.currentPost ? { ...this.currentPost } : null,
      recentRecords,
      logs: this.logs.slice(0, 50)
    };
  }

  pause() {
    if (this.state === 'running') {
      this.isPaused = true;
      this.state = 'paused';
      if (this.currentPost) {
        this.currentPost.step = 'paused';
        this.currentPost.stepLabel = '⏸️ 일시정지됨';
      }
      this.log('⏸️ 이웃 새글 자동 소통 작업이 일시정지되었습니다.', 'warn');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.isPaused = false;
      this.state = 'running';
      if (this.currentPost) {
        this.currentPost.step = 'resumed';
        this.currentPost.stepLabel = '▶️ 작업 재개 중...';
      }
      this.log('▶️ 이웃 새글 자동 소통 작업을 다시 재개합니다.', 'info');
    }
  }

  stop() {
    this.shouldStop = true;
    this.isPaused = false;
    this.state = 'stopped';
    this.currentPost = null;
    this.log('⏹️ 사용자에 의해 이웃 새글 소통 작업이 중단되었습니다.', 'warn');
  }

  async engageSinglePost({
    postUrl,
    logNo,
    blogId,
    author = '',
    title = '',
    doLike = true,
    doComment = true,
    commentTone = 'friendly',
    tone = ''
  } = {}) {
    if (!this.browserSession || !this.browserSession.connected) {
      throw new Error('네이버 계정이 연결되어 있지 않습니다. 먼저 네이버 로그인을 완료해주세요.');
    }

    const finalTone = commentTone || tone || 'friendly';
    const targetUrl = postUrl || `https://m.blog.naver.com/${blogId}/${logNo}`;
    const authorName = author || blogId;
    const postLabel = `@${authorName} ('${(title || '').slice(0, 24)}...')`;

    this.log(`⚡ [즉시 소통] ${postLabel} 분석 및 소통을 시작합니다.`, 'info');

    // 1. Inspect post
    const inspection = await this.browserSession.inspectPostForEngagement(targetUrl);
    if (inspection.alreadyCommented) {
      await this.historyStore.addRecord({
        blogId,
        logNo,
        author: authorName,
        title,
        url: targetUrl,
        liked: false,
        commented: false,
        status: 'skipped',
        statusMessage: '이미 작성한 댓글 존재'
      });
      this.log(`⏩ [중복 댓글 제외] ${postLabel} 이미 내 댓글이 확인된 포스팅입니다.`, 'warn');
      return {
        ok: true,
        liked: false,
        commented: false,
        status: 'skipped',
        statusMessage: '이미 작성한 댓글 존재'
      };
    }

    // 2. Generate comment
    let generatedComment = '';
    if (doComment && inspection.canComment) {
      this.log('🤖 AI가 이웃 글 내용과 사진을 읽고 맞춤 댓글을 생성하고 있습니다...', 'info');
      const imageSummary = inspection.firstImage?.alt || (inspection.images.length > 0 ? `${inspection.images.length}장의 본문 사진 포함` : '');
      const recentComments = await this.historyStore.getRecentComments(30);
      if (this.embeddedLlama) {
        generatedComment = await this.embeddedLlama.generateBlogComment({
          title: inspection.title || title,
          contentSnippet: inspection.snippet || '',
          imageSummary,
          tone: finalTone,
          recentComments
        }).catch(() => '');
      }
      if (generatedComment) {
        this.log(`💬 검증된 찐이웃 댓글: "${generatedComment}"`, 'info');
      }
    }

    // 3. Like & Comment
    const result = await this.browserSession.likeAndCommentPost({
      postUrl: targetUrl,
      commentText: generatedComment,
      doLike: Boolean(doLike),
      doComment: Boolean(doComment) && Boolean(generatedComment)
    });

    // 4. Save record
    const savedRecord = await this.historyStore.addRecord({
      blogId,
      logNo,
      author: authorName,
      title: inspection.title || title,
      url: targetUrl,
      liked: result.liked,
      commented: result.commented,
      commentText: generatedComment,
      status: result.status,
      statusMessage: result.message
    });

    const actions = [result.liked ? '공감(❤️)' : '', result.commented ? 'AI 댓글(💬)' : ''].filter(Boolean).join(' 및 ');
    this.log(`✅ [즉시 소통 완료] ${postLabel} ${actions} 등록 완료!`, 'success');

    return {
      ok: true,
      liked: result.liked,
      commented: result.commented,
      commentText: generatedComment,
      status: result.status,
      statusMessage: result.message,
      record: savedRecord
    };
  }

  async start({
    targetCount = 10,
    doLike = true,
    doComment = true,
    commentTone = 'friendly',
    tone = '',
    minDelaySec = 25,
    maxDelaySec = 45,
    selectedPosts = null
  } = {}) {
    if (this.state === 'running') {
      throw new Error('이미 이웃 새글 자동 소통 작업이 실행 중입니다.');
    }

    if (!this.browserSession || !this.browserSession.connected) {
      throw new Error('네이버 계정이 연결되어 있지 않습니다. 먼저 네이버 로그인을 완료해주세요.');
    }

    this.selectedPosts = Array.isArray(selectedPosts) && selectedPosts.length > 0 ? selectedPosts : null;
    const defaultTarget = this.selectedPosts ? this.selectedPosts.length : 10;
    const boundTarget = Math.max(1, Math.min(Number(targetCount) || defaultTarget, 50));

    this.config = {
      targetCount: boundTarget,
      doLike: Boolean(doLike),
      doComment: Boolean(doComment),
      commentTone: commentTone || tone || 'friendly',
      minDelaySec: minDelaySec !== undefined ? Math.max(0, Number(minDelaySec)) : 25,
      maxDelaySec: maxDelaySec !== undefined ? Math.max(0, Number(maxDelaySec)) : 45
    };

    this.state = 'running';
    this.shouldStop = false;
    this.isPaused = false;
    this.stats = {
      totalFound: 0,
      processedCount: 0,
      successCount: 0,
      likedCount: 0,
      commentedCount: 0,
      skippedCount: 0,
      targetReached: false,
      protectionTriggered: false
    };

    const runDesc = this.selectedPosts
      ? `선택한 ${this.selectedPosts.length}개 새글`
      : `목표: ${boundTarget}건`;
    this.log(`🚀 이웃 새글 피드 자동 소통을 시작합니다. (${runDesc}, 공감: ${this.config.doLike ? 'ON' : 'OFF'}, AI 댓글: ${this.config.doComment ? 'ON' : 'OFF'})`, 'info');

    // Run in background without blocking caller
    this._runLoop().catch((err) => {
      this.state = 'error';
      this.log(`🚨 자동 소통 중 예외 오류 발생: ${err.message}`, 'error');
    });

    return { ok: true, state: this.state, targetCount: boundTarget };
  }

  async _runLoop() {
    let feedPage = null;
    try {
      if (!this.selectedPosts && !this.browserSession.context) {
        throw new Error('브라우저 세션 컨텍스트가 유효하지 않습니다.');
      }

      let feedPosts = [];
      if (this.selectedPosts && this.selectedPosts.length > 0) {
        feedPosts = this.selectedPosts;
        this.stats.totalFound = feedPosts.length;
        this.log(`🎯 사용자가 직접 선택한 ${feedPosts.length}개의 이웃 새글을 순차적으로 소통합니다.`, 'info');
      } else {
        feedPage = await this.browserSession.context.newPage();
        this.log('🔍 네이버 모바일 이웃 피드(FeedList.naver)에서 최신 새글을 탐색합니다...', 'info');

        const maxFetch = Math.max(this.config.targetCount * 3, 30);
        feedPosts = await fetchNeighborFeedPosts(feedPage, {
          maxItems: maxFetch,
          maxScrolls: Math.max(5, Math.ceil(maxFetch / 10))
        });
        await feedPage.close().catch(() => {});
        feedPage = null;

        this.stats.totalFound = feedPosts.length;
        this.log(`📰 총 ${feedPosts.length}개의 이웃 새글을 발견했습니다. 순차적으로 소통을 시작합니다.`, 'info');
      }

      if (!feedPosts.length) {
        this.log('⚠️ 현재 소통할 이웃 새글이 없습니다.', 'warn');
        this.state = 'completed';
        return;
      }

      for (let i = 0; i < feedPosts.length; i++) {
        if (this.shouldStop) break;

        while (this.isPaused && !this.shouldStop) {
          await sleep(500);
        }
        if (this.shouldStop) break;

        if (this.stats.successCount >= this.config.targetCount) {
          this.stats.targetReached = true;
          this.log(`🎉 설정한 목표(${this.config.targetCount}건)를 달성하여 작업을 성공적으로 종료합니다.`, 'success');
          break;
        }

        const post = feedPosts[i];
        const postLabel = `@${post.author} ('${post.title.slice(0, 24)}...')`;

        this.currentPost = {
          logNo: post.logNo,
          blogId: post.blogId,
          author: post.author,
          title: post.title,
          url: post.url,
          thumbnail: post.thumbnail || '',
          publishedTime: post.publishedTime || '',
          step: 'checking',
          stepLabel: '📋 기존 소통 이력 확인 중...',
          countdown: 0
        };

        // Check history deduplication
        const alreadyEngaged = await this.historyStore.hasEngaged(post.logNo);
        if (alreadyEngaged) {
          this.stats.skippedCount += 1;
          this.currentPost.step = 'skipped';
          this.currentPost.stepLabel = '⏩ 이미 소통한 기록이 있어 건너뜁니다.';
          this.log(`⏩ [기록 제외] ${postLabel} 이미 소통한 기록이 있는 글입니다.`, 'info');
          continue;
        }

        this.stats.processedCount += 1;
        this.currentPost.step = 'inspecting';
        this.currentPost.stepLabel = '🔍 이웃 글 본문 및 사진 분석 중...';
        this.log(`[${this.stats.processedCount}] ${postLabel} 분석 중...`, 'info');

        try {
          // 1. Inspect post
          const inspection = await this.browserSession.inspectPostForEngagement(post.url);

          if (inspection.alreadyCommented) {
            this.stats.skippedCount += 1;
            this.currentPost.step = 'skipped';
            this.currentPost.stepLabel = '⏩ 이미 내 댓글이 확인되어 건너뜁니다 (중복 방지).';
            this.log(`⏩ [중복 댓글 제외] ${postLabel} 이미 내 댓글이 확인된 포스팅입니다.`, 'warn');
            await this.historyStore.addRecord({
              blogId: post.blogId,
              logNo: post.logNo,
              author: post.author,
              title: post.title,
              url: post.url,
              liked: false,
              commented: false,
              status: 'skipped',
              statusMessage: '이미 작성한 댓글 존재'
            });
            continue;
          }

          // 2. Generate contextual AI comment if enabled
          let generatedComment = '';
          if (this.config.doComment && inspection.canComment) {
            this.currentPost.step = 'generating';
            this.currentPost.stepLabel = '🤖 온디바이스 AI 맞춤 찐이웃 댓글 작성 중...';
            this.log(`🤖 AI가 이웃 글 내용과 사진을 읽고 맞춤 댓글을 생성하고 있습니다...`, 'info');
            const imageSummary = inspection.firstImage?.alt || (inspection.images.length > 0 ? `${inspection.images.length}장의 본문 사진 포함` : '');
            const recentComments = await this.historyStore.getRecentComments(30);

            if (this.embeddedLlama) {
              generatedComment = await this.embeddedLlama.generateBlogComment({
                title: inspection.title || post.title,
                contentSnippet: inspection.snippet || post.snippet,
                imageSummary,
                tone: this.config.commentTone,
                recentComments
              }).catch(() => '');
            }

            if (!generatedComment) {
              this.log('⏩ 적합한 댓글을 생성하지 못해 댓글 작성을 건너뜁니다.', 'warn');
            } else {
              this.log(`💬 검증된 찐이웃 댓글: "${generatedComment}"`, 'info');
            }
          }

          // 3. Execute Like & Comment
          this.currentPost.step = 'engaging';
          this.currentPost.stepLabel = '❤️ 공감 누르기 및 💬 댓글 등록 중...';
          const result = await this.browserSession.likeAndCommentPost({
            postUrl: post.url,
            commentText: generatedComment,
            doLike: this.config.doLike,
            doComment: this.config.doComment && Boolean(generatedComment)
          });

          if (this.config.doComment && !generatedComment) {
            result.commentReason = this.embeddedLlama?.lastCommentFailure || 'AI 댓글 생성·검증에 실패해 등록하지 않았습니다.';
            result.message = result.liked
              ? `공감(❤️) 완료 (댓글 미작성: ${result.commentReason})`
              : `반응 불가 (사유: ${result.commentReason}${result.likeReason ? ` / ${result.likeReason}` : ''})`;
          }

          // Check security restrictions
          const restrictionText = `${result.likeReason || ''} ${result.commentReason || ''} ${result.message || ''}`;
          if (/자동입력 방지|캡차|보안 문자|보호조치|추가 인증|로그인이 필요/i.test(restrictionText)) {
            this.shouldStop = true;
            this.state = 'stopped';
            this.stats.protectionTriggered = true;
            this.currentPost = null;
            this.log(`🛑 네이버 보호조치 신호를 감지해 작업을 즉시 안전하게 중단합니다.`, 'error');
            break;
          }

          if (result.liked || result.commented) {
            this.stats.successCount += 1;
            if (result.liked) this.stats.likedCount += 1;
            if (result.commented) this.stats.commentedCount += 1;

            this.currentPost.step = 'done';
            this.currentPost.stepLabel = `✅ 소통 완료 (${this.stats.successCount}/${this.config.targetCount})`;
            this.currentPost.commentText = generatedComment;
            this.currentPost.liked = result.liked;
            this.currentPost.commented = result.commented;

            const actions = [result.liked ? '공감(❤️)' : '', result.commented ? 'AI 댓글(💬)' : ''].filter(Boolean).join(' 및 ');
            if (this.config.doComment && !result.commented) {
              this.log(`❌ [댓글 등록 실패] ${postLabel} ${actions || '공감'} 완료 · 댓글 미등록 사유: ${result.commentReason || '확인되지 않은 오류'}`, 'error');
            } else {
              this.log(`✅ [새글 소통 완료] ${postLabel} ${actions} 등록 완료! (누적 성공: ${this.stats.successCount}/${this.config.targetCount})`, 'success');
            }
          } else {
            this.log(`❌ [소통 실패] ${postLabel}: ${result.message || result.commentReason || '소통 가능한 영역 없음'}`, 'error');
          }

          // Save in history store
          await this.historyStore.addRecord({
            blogId: post.blogId,
            logNo: post.logNo,
            author: post.author,
            title: post.title,
            url: post.url,
            liked: result.liked,
            commented: result.commented,
            commentText: generatedComment,
            status: result.status,
            statusMessage: result.message
          });

          // 4. Human-behavior jitter delay between posts
          if (this.stats.successCount < this.config.targetCount && i < feedPosts.length - 1) {
            const baseDelay = this.config.minDelaySec;
            const jitter = Math.floor(Math.random() * Math.max(1, this.config.maxDelaySec - this.config.minDelaySec));
            const totalDelaySec = baseDelay + jitter;
            const nextPost = feedPosts[i + 1];
            const nextAuthor = nextPost ? `@${nextPost.author || nextPost.blogId}` : '다음 글';
            this.log(`⏳ 다음 이웃 새글(${nextAuthor})까지 ${totalDelaySec}초간 안전 대기합니다 (네이버 계정 보호 모드)...`, 'info');

            this.currentPost = {
              logNo: post.logNo,
              blogId: post.blogId,
              author: post.author,
              title: post.title,
              nextAuthor,
              nextTitle: nextPost ? nextPost.title : '',
              step: 'waiting',
              stepLabel: `🛡️ [계정 보호 안전 대기] ${totalDelaySec}초 후 ${nextAuthor} 님 글로 이동`,
              totalDelaySec,
              countdown: totalDelaySec
            };

            let elapsed = 0;
            while (elapsed < totalDelaySec * 1000 && !this.shouldStop) {
              const remainingSec = Math.max(0, Math.ceil((totalDelaySec * 1000 - elapsed) / 1000));
              this.currentPost.countdown = remainingSec;
              this.currentPost.stepLabel = `🛡️ [계정 보호 안전 대기] ${remainingSec}초 후 ${nextAuthor} 님 글로 이동`;
              await sleep(500);
              elapsed += 500;
              while (this.isPaused && !this.shouldStop) {
                await sleep(500);
              }
            }
          }
        } catch (postError) {
          this.log(`❌ [처리 실패] ${postLabel} 처리 중 오류: ${postError.message}`, 'error');
        }
      }

      if (!this.shouldStop && !this.stats.targetReached) {
        if (this.stats.successCount > 0) {
          this.log(`🏁 준비된 이웃 새글 처리를 마쳤습니다. (총 ${this.stats.successCount}건 소통 완료)`, 'info');
        } else {
          this.log('⚠️ 소통 가능한 신규 이웃 새글이 부족하여 작업을 종료합니다.', 'warn');
        }
      }

      this.currentPost = null;
      this.state = this.stats.targetReached ? 'completed' : (this.shouldStop ? 'stopped' : 'completed');
    } finally {
      if (feedPage && !feedPage.isClosed()) {
        await feedPage.close().catch(() => {});
      }
    }
  }
}
