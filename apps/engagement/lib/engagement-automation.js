import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COMMENT_PROMPT_VERSION } from './comment-prompt.js';
import { composeComment, normalizeCommentMode, normalizeCommentPhrases } from './comment-style.js';
import { fetchLatestPostsFromRss, MAX_SEED_BLOGS, normalizeBlogIdList, resolveLatestPosts } from './blog-targets.js';

export const TARGET_SOURCES = Object.freeze(['keyword', 'seed_commenters', 'id_list']);

export const ENGAGEMENT_LIMITS = Object.freeze({
  postsPerRun: 500,
  likesPerDay: 200,
  commentsPerDay: 100,
  neighborsPerDay: 100,
  maxActionsPerPost: 2,
  sessionPosts: 15, // Safe breath every 15 posts to avoid account protection flags
  sessionBreakMinSeconds: 180, // 3~5 min session break
  sessionBreakMaxSeconds: 300
});

function koreaDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function selectPostActions({ requested, todayCounts, postIndex = 0, enforceDailyLimits = true }) {
  const limits = {
    like: ENGAGEMENT_LIMITS.likesPerDay,
    comment: ENGAGEMENT_LIMITS.commentsPerDay,
    neighbor: ENGAGEMENT_LIMITS.neighborsPerDay
  };
  const counts = {
    like: Number(todayCounts?.likes) || 0,
    comment: Number(todayCounts?.comments) || 0,
    neighbor: Number(todayCounts?.neighbors) || 0
  };
  const order = ['like', 'comment', 'neighbor'];
  const offset = Math.abs(Number(postIndex) || 0) % order.length;
  const rotatedOrder = [...order.slice(offset), ...order.slice(0, offset)];
  return order
    .filter((action) => requested[action] && (!enforceDailyLimits || counts[action] < limits[action]))
    .sort((a, b) => {
      if (enforceDailyLimits) {
        const usageDiff = (counts[a] / limits[a]) - (counts[b] / limits[b]);
        if (usageDiff !== 0) return usageDiff;
      }
      return rotatedOrder.indexOf(a) - rotatedOrder.indexOf(b);
    })
    .slice(0, ENGAGEMENT_LIMITS.maxActionsPerPost);
}

export function buildNeighborMessage(baseMessage, bloggerName, keyword, index = 0) {
  const name = String(bloggerName || '').trim();
  const topic = String(keyword || '').trim();
  const base = String(baseMessage || '').trim();
  const variants = [
    `${name ? `${name}님, ` : ''}${topic ? `${topic} 글 ` : '포스팅 '}잘 읽었습니다. ${base}`,
    `${topic ? `${topic}에 관한 내용이 인상적이었어요. ` : ''}${base}${name ? ` ${name}님과 종종 소통하고 싶어요.` : ''}`,
    `${name ? `${name}님 안녕하세요. ` : '안녕하세요. '}${base}${topic ? ` ${topic} 관련 글도 기대할게요.` : ''}`,
    `${topic ? `${topic} 포스팅을 보고 ` : '글을 보고 '}${base}${name ? ` 반갑습니다, ${name}님.` : ''}`
  ];
  return variants[index % variants.length].replace(/\s+/g, ' ').trim().slice(0, 300);
}

export class EngagementAutomationManager extends EventEmitter {
  constructor({ browserSession, embeddedLlama, historyStore, statePath = '', getSharedTodayCounts = null, assessActivity = null }) {
    super();
    this.browserSession = browserSession;
    this.embeddedLlama = embeddedLlama;
    this.historyStore = historyStore;
    // Today's likes/comments made by feed engagement on the same account, so both share one daily cap.
    this.getSharedTodayCounts = getSharedTodayCounts;
    // Grades a blog's activity (see neighbor-health.js) so 서로이웃 goes only to active bloggers.
    this.assessActivity = assessActivity;
    this.statePath = statePath;
    this.saveTimer = null;

    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'error'
    this.config = {
      keyword: '',
      targetCount: 20,
      doLike: true,
      doComment: true,
      doNeighbor: true,
      neighborMessage: '안녕하세요! 포스팅 잘 보고 갑니다. 좋은 이웃으로 소통하고 지내요 😊',
      tone: 'friendly',
      minDelay: 30,
      maxDelay: 90,
      dailyNeighborLimit: 100,
      sessionPosts: 10,
      sessionBreakMinSeconds: 600,
      sessionBreakMaxSeconds: 1200,
      activeWithinDays: 14
    };

    this.stats = {
      targetCount: 0,
      processedCount: 0,
      likeSuccessCount: 0,
      commentSuccessCount: 0,
      neighborSuccessCount: 0,
      skippedCount: 0,
      failedCount: 0,
      targetReached: false,
      neighborLimitReached: false,
      startTime: null,
      endTime: null,
      currentPost: null,
      currentKeyword: '',
      keywordProcessedCounts: {},
      phase: 'idle',
      delayCountdown: 0
    };

    this.logs = [];
    this.restoreLastJob();
    if (this.statePath) this.on('status', () => this.scheduleSave());
    this.shouldStop = false;
    this.isPaused = false;
    this.pausePromise = null;
    this.pauseResolve = null;
  }

  log(message, type = 'info', meta = {}) {
    const timestamp = new Date().toISOString();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp,
      time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
      message,
      type, // 'info' | 'success' | 'warn' | 'error' | 'delay'
      meta
    };
    this.logs.unshift(entry);
    if (this.logs.length > 200) this.logs.pop();
    this.emit('log', entry);
    this.emit('status', this.getStatus());
    console.log(`[AutoEngagement] [${entry.time}] ${message}`);
  }

  // The latest job (settings, counts, log) is kept on disk so a server restart or a closed browser does
  // not wipe it. A job that was running when the server stopped comes back as stopped, with a note.
  restoreLastJob() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8'));
      if (saved.config) this.config = { ...this.config, ...saved.config };
      if (saved.stats) this.stats = { ...this.stats, ...saved.stats, currentPost: null, delayCountdown: 0 };
      if (Array.isArray(saved.logs)) this.logs = saved.logs.slice(0, 200);
      const wasActive = saved.state === 'running' || saved.state === 'paused';
      this.state = wasActive ? 'stopped' : (saved.state || 'idle');
      if (wasActive) {
        this.stats.phase = 'stopped';
        this.stats.endTime = this.stats.endTime || saved.savedAt || new Date().toISOString();
        const now = new Date();
        this.logs.unshift({
          id: `${Date.now()}-restart`,
          timestamp: now.toISOString(),
          time: now.toLocaleTimeString('ko-KR', { hour12: false }),
          message: '⚠️ 프로그램이 다시 시작되어 진행 중이던 소통이 멈췄습니다. [소통 시작]을 다시 누르면 이미 소통한 글은 건너뛰고 이어서 진행합니다.',
          type: 'warn',
          meta: {}
        });
      }
    } catch (error) {
      console.warn('[AutoEngagement] Could not restore the last job:', error.message);
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(path.dirname(this.statePath), { recursive: true });
        writeFileSync(this.statePath, JSON.stringify({
          savedAt: new Date().toISOString(),
          state: this.state,
          config: this.config,
          stats: { ...this.stats, currentPost: null },
          logs: this.logs.slice(0, 200)
        }));
      } catch (error) {
        console.warn('[AutoEngagement] Could not save the job state:', error.message);
      }
    }, 1500);
  }

  getStatus() {
    return {
      state: this.state,
      config: { ...this.config },
      stats: { ...this.stats },
      logs: this.logs.slice(0, 50),
      connected: this.browserSession?.connected || false
    };
  }

  async start({ 
    keyword, 
    targetCount = 20, 
    doLike = true, 
    doComment = true, 
    doNeighbor = true,
    neighborMessage = '안녕하세요! 포스팅 잘 보고 갑니다. 좋은 이웃으로 소통하고 지내요 😊',
    tone = 'friendly',
    minDelay = 30,
    maxDelay = 180,
    dailyNeighborLimit = 100,
    sessionPosts = 10,
    sessionBreakMinSeconds = 600,
    sessionBreakMaxSeconds = 1200,
    activeWithinDays = 14,
    targetSource = 'keyword',
    seedBlogs = '',
    targetIds = '',
    neighborMessageMode = 'ai',
    commentMode = 'ai',
    commentPhrases = '',
    secretComment = false,
    neighborActiveOnly = true
  }) {
    if (this.state === 'running' || this.state === 'paused') {
      throw new Error('이미 실행 중인 공감/소통 작업이 있습니다.');
    }

    if (!this.browserSession?.connected) {
      throw new Error('네이버 계정이 연결되어 있지 않습니다. 먼저 로그인을 완료해주세요.');
    }

    const source = TARGET_SOURCES.includes(targetSource) ? targetSource : 'keyword';
    const cleanSeeds = source === 'seed_commenters' ? normalizeBlogIdList(seedBlogs, { limit: MAX_SEED_BLOGS }) : [];
    const cleanTargetIds = source === 'id_list' ? normalizeBlogIdList(targetIds) : [];
    // Non-keyword sources reuse the per-keyword bookkeeping with one label per group.
    const keywords = source === 'seed_commenters'
      ? cleanSeeds
      : source === 'id_list'
        ? (cleanTargetIds.length ? ['직접 입력 목록'] : [])
        : [...new Set(String(keyword || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean))].slice(0, 10);
    if (!keywords.length) {
      throw new Error({
        keyword: '검색 키워드를 입력해주세요.',
        seed_commenters: '댓글 이웃을 가져올 블로그 ID나 주소를 입력해주세요.',
        id_list: '소통할 블로그 ID 목록을 입력해주세요.'
      }[source]);
    }
    const cleanCommentMode = normalizeCommentMode(commentMode);
    const cleanPhrases = normalizeCommentPhrases(commentPhrases);
    if (doComment && cleanCommentMode === 'phrases' && !cleanPhrases.length) {
      throw new Error('[내 문구만] 댓글을 쓰려면 댓글 문구를 한 줄에 하나씩 입력해주세요.');
    }

    const cleanTarget = Math.min(Math.max(Number(targetCount) || 100, 1), ENGAGEMENT_LIMITS.postsPerRun);
    const targetPerKeyword = Math.ceil(cleanTarget / keywords.length);
    const cleanMinDelay = Math.min(Math.max(Number(minDelay) || 120, 30), 900);
    const cleanMaxDelay = Math.min(Math.max(Number(maxDelay) || 180, cleanMinDelay), 900);
    const cleanDailyNeighborLimit = Math.min(Math.max(Number(dailyNeighborLimit) || 100, 1), 100);
    const cleanSessionPosts = Math.min(Math.max(Number(sessionPosts) || 10, 5), 30);
    const cleanBreakMin = Math.min(Math.max(Number(sessionBreakMinSeconds) || 600, 60), 3600);
    const cleanBreakMax = Math.min(Math.max(Number(sessionBreakMaxSeconds) || 1200, cleanBreakMin), 3600);

    this.config = {
      keyword: keywords.join(', '),
      keywords,
      targetPerKeyword,
      targetCount: cleanTarget,
      doLike: Boolean(doLike),
      doComment: Boolean(doComment),
      doNeighbor: Boolean(doNeighbor),
      neighborMessage: String(neighborMessage || '').trim() || '안녕하세요! 포스팅 잘 보고 갑니다. 좋은 이웃으로 소통하고 지내요 😊',
      tone,
      minDelay: cleanMinDelay,
      maxDelay: cleanMaxDelay,
      dailyNeighborLimit: cleanDailyNeighborLimit,
      sessionPosts: cleanSessionPosts,
      sessionBreakMinSeconds: cleanBreakMin,
      sessionBreakMaxSeconds: cleanBreakMax,
      activeWithinDays: Number(activeWithinDays) || 0,
      targetSource: source,
      seedBlogs: cleanSeeds,
      targetIds: cleanTargetIds,
      neighborMessageMode: neighborMessageMode === 'fixed' ? 'fixed' : 'ai',
      commentMode: cleanCommentMode,
      commentPhrases: cleanPhrases,
      secretComment: Boolean(secretComment),
      neighborActiveOnly: neighborActiveOnly !== false
    };

    this.stats = {
      targetCount: cleanTarget,
      processedCount: 0,
      likeSuccessCount: 0,
      commentSuccessCount: 0,
      neighborSuccessCount: 0,
      skippedCount: 0,
      failedCount: 0,
      targetReached: false,
      neighborLimitReached: false,
      startTime: new Date().toISOString(),
      endTime: null,
      currentPost: null,
      currentKeyword: keywords[0],
      keywordProcessedCounts: Object.fromEntries(keywords.map((value) => [value, 0])),
      phase: 'preparing',
      delayCountdown: 0
    };

    this.shouldStop = false;
    this.isPaused = false;
    this.state = 'running';
    const sourceLabel = {
      keyword: `${keywords.length}개 키워드(${keywords.join(', ')})`,
      seed_commenters: `블로그 ${keywords.length}곳(${keywords.join(', ')})의 댓글 이웃`,
      id_list: `직접 입력한 블로그 ${cleanTargetIds.length}곳`
    }[source];
    this.log(`🚀 ${sourceLabel} 대상으로 순차 실행합니다. (전체 목표 ${cleanTarget}건, 키워드별 최대 ${targetPerKeyword}건, 하루 서로이웃 최대 ${cleanDailyNeighborLimit}명)`, 'info');
    this.log(`🛡️ 보호 설정: 작업 간 ${cleanMinDelay}~${cleanMaxDelay}초, ${cleanSessionPosts}건마다 ${Math.ceil(cleanBreakMin / 60)}~${Math.ceil(cleanBreakMax / 60)}분 휴식`, 'info');
    this.emit('status', this.getStatus());

    // Run in background
    this.runLoop().catch((err) => {
      this.state = 'error';
      this.log(`❌ 오류 발생: ${err.message}`, 'error');
      this.emit('status', this.getStatus());
    });

    return this.getStatus();
  }

  // Builds the post queue for the chosen target source. Keyword items keep their keyword as the
  // message topic; other sources have no topic so messages never mention a blog ID.
  async collectTargetPosts() {
    const items = [];
    const { targetSource, activeWithinDays } = this.config;
    const onSkip = (blogId, reason) => this.log(`⏩ @${blogId} 제외: ${reason}`, 'info');
    const shouldStop = () => this.shouldStop;

    if (targetSource === 'id_list') {
      const label = this.config.keywords[0];
      this.stats.currentKeyword = label;
      this.stats.phase = 'searching';
      this.emit('status', this.getStatus());
      this.log(`🔍 입력한 블로그 ${this.config.targetIds.length}곳의 최신 글을 확인하고 있습니다...`, 'info');
      const posts = await resolveLatestPosts(this.config.targetIds, { activeWithinDays, onSkip, shouldStop });
      items.push(...posts.map((post) => ({ ...post, engagementKeyword: label, engagementTopic: '' })));
      return items;
    }

    if (targetSource === 'seed_commenters') {
      const myBlogId = await this.browserSession.resolveMyBlogId?.().catch(() => '') || '';
      for (const seed of this.config.keywords) {
        if (this.shouldStop) break;
        this.stats.currentKeyword = seed;
        this.stats.phase = 'searching';
        this.emit('status', this.getStatus());
        this.log(`🔍 @${seed} 님의 최근 글에 댓글을 단 이웃을 모으고 있습니다...`, 'info');
        const seedPosts = await fetchLatestPostsFromRss(seed, { limit: 5 });
        if (!seedPosts.length) {
          this.log(`⚠️ @${seed} 님의 최근 글을 불러오지 못했습니다. 블로그 ID를 확인해주세요.`, 'warn');
          continue;
        }
        const commenters = await this.browserSession.collectBlogCommenters(seed, {
          postUrls: seedPosts.map((post) => post.url),
          maxAuthors: Math.min(Math.max(this.config.targetPerKeyword * 2, 30), 200),
          excludeIds: myBlogId ? [myBlogId] : []
        });
        this.log(`👥 @${seed} 님 글에서 댓글 이웃 ${commenters.length}명을 찾았습니다. 각자의 최신 글을 확인합니다...`, 'info');
        const nicknames = Object.fromEntries(commenters.map((person) => [person.blogId, person.nickname]));
        const posts = await resolveLatestPosts(commenters.map((person) => person.blogId), { activeWithinDays, onSkip, shouldStop, nicknames });
        items.push(...posts.map((post) => ({ ...post, engagementKeyword: seed, engagementTopic: '' })));
      }
      return items;
    }

    for (const keyword of this.config.keywords) {
      this.stats.currentKeyword = keyword;
      this.stats.phase = 'searching';
      this.emit('status', this.getStatus());
      this.log(`🔍 [${keyword}] 관련 타겟 포스팅을 검색하고 있습니다...`, 'info');
      const found = await this.browserSession.searchBlogs({ query: keyword, display: Math.min(Math.max(this.config.targetPerKeyword * 2, 100), 1000), activeWithinDays, excludeBlogIds: [] });
      const candidates = Array.isArray(found) ? found : (found?.items || []);
      items.push(...candidates.map((post) => ({ ...post, engagementKeyword: keyword })));
    }
    return items;
  }

  async runLoop() {
    try {
      const blockedActions = new Set();
      let neighborBlockedDate = '';
      let sessionProcessed = 0;
      const items = await this.collectTargetPosts();

      if (!items || items.length === 0) {
        this.state = 'completed';
        this.log('조건에 맞는 대상 포스팅을 찾지 못했습니다. (이미 소통한 이웃 제외됨)', 'warn');
        this.emit('status', this.getStatus());
        return;
      }

      this.log(`총 ${items.length}개의 포스팅을 발견했습니다. 순차적으로 반응을 진행합니다.`, 'info');
      const keywordProcessedCounts = Object.fromEntries(this.config.keywords.map((keyword) => [keyword, 0]));
      this.stats.keywordProcessedCounts = { ...keywordProcessedCounts };
      this.stats.phase = 'engaging';

      for (let i = 0; i < items.length; i += 1) {
        if (this.shouldStop) {
          this.log('⏹️ 사용자에 의해 작업이 중단되었습니다.', 'warn');
          this.state = 'stopped';
          break;
        }

        if (this.isPaused) {
          this.state = 'paused';
          this.log('⏸️ 작업이 일시정지되었습니다. 재개 대기 중...', 'info');
          this.emit('status', this.getStatus());
          await this.pausePromise;
          if (this.shouldStop) break;
          this.state = 'running';
          this.log('▶️ 작업이 재개되었습니다.', 'info');
        }

        if (this.stats.processedCount >= this.config.targetCount) {
          this.stats.targetReached = true;
          this.log(`🎉 설정한 목표(${this.config.targetCount}건)를 달성하여 작업을 성공적으로 종료합니다.`, 'success');
          this.state = 'completed';
          break;
        }

        const post = items[i];
        const currentKeyword = post.engagementKeyword || this.config.keywords[0];
        if (keywordProcessedCounts[currentKeyword] >= this.config.targetPerKeyword) continue;
        const targetUrl = post.url || post.link || `https://blog.naver.com/${post.blogId}`;

        // Skip previously processed posts before opening any additional Naver pages.
        if (this.historyStore && await this.historyStore.hasEngagedPost(targetUrl, post.blogId)) {
          this.stats.skippedCount += 1;
          this.log(`⏩ [중복 제외] @${post.blogId} (${post.title.slice(0, 20)}...) 이미 소통한 기록이 있어 건너뜁니다.`, 'info');
          continue;
        }

        const todaySummary = this.historyStore?.getSummary ? await this.historyStore.getSummary() : {};
        const sharedToday = this.getSharedTodayCounts ? await this.getSharedTodayCounts().catch(() => ({})) : {};
        const todayKey = koreaDateKey();
        if (neighborBlockedDate && neighborBlockedDate !== todayKey) {
          neighborBlockedDate = '';
          blockedActions.delete('neighbor');
          this.log('🌅 날짜가 바뀌어 서로이웃 일일 차단 상태를 초기화했습니다.', 'info');
        }
        const neighborDailyLimitReached = Number(todaySummary.todayNeighbors || 0) >= this.config.dailyNeighborLimit;
        if (this.config.doNeighbor && neighborDailyLimitReached) {
          this.stats.neighborLimitReached = true;
          this.state = 'completed';
          this.log(`🏁 서로이웃 신청 ${this.config.dailyNeighborLimit}명에 도달해 전체 자동 작업을 종료합니다.`, 'success');
          break;
        }
        let neighborPreflight = null;
        let neighborEligible = this.config.doNeighbor && !blockedActions.has('neighbor') && !neighborDailyLimitReached;
        if (neighborEligible && post.blogId && typeof this.historyStore?.getNeighborRelationship === 'function') {
          const knownRelationship = await this.historyStore.getNeighborRelationship(post.blogId);
          if (knownRelationship) {
            neighborPreflight = {
              status: knownRelationship.neighborStatus,
              message: ['requested', 'added'].includes(knownRelationship.neighborStatus)
                ? '프로그램 이력에 이미 이웃 신청을 보낸 기록이 있습니다.'
                : '프로그램 이력에 이미 이웃인 기록이 있습니다.',
              rawMessage: knownRelationship.statusMessage || ''
            };
            neighborEligible = false;
            this.log(`⏩ [이웃 이력 제외] @${post.blogId} ${neighborPreflight.message}`, 'info');
          }
        }
        if (neighborEligible && post.blogId && this.config.neighborActiveOnly && this.assessActivity) {
          const activity = await this.assessActivity(post.blogId).catch(() => null);
          if (activity && activity.grade !== 'active') {
            neighborEligible = false;
            neighborPreflight = { status: 'skipped_inactive', message: `활성 블로거가 아니라 서로이웃 신청을 건너뜁니다. (${activity.reason || activity.grade})` };
            this.log(`⏩ [비활성 제외] @${post.blogId} ${neighborPreflight.message}`, 'info');
          }
        }
        if (neighborEligible && post.blogId && typeof this.browserSession.inspectNeighborRelationship === 'function') {
          this.log(`🔎 @${post.blogId} 이웃·신청 상태를 먼저 확인합니다...`, 'info');
          try {
            neighborPreflight = await this.browserSession.inspectNeighborRelationship(post.blogId);
            const preflightSkipStatuses = new Set(['requested', 'already_mutual', 'already_added', 'self', 'mutual_unavailable', 'unavailable']);
            if (preflightSkipStatuses.has(neighborPreflight.status)) {
              neighborEligible = false;
              const rawDetail = neighborPreflight.rawMessage ? ` · 네이버 원문: ${neighborPreflight.rawMessage}` : '';
              this.log(`⏩ [이웃 사전 제외] @${post.blogId} ${neighborPreflight.message}${rawDetail}`, 'info');
            } else if (neighborPreflight.status === 'verification_required') {
              neighborEligible = false;
              blockedActions.add('neighbor');
              this.shouldStop = true;
              this.state = 'stopped';
              this.stats.protectionTriggered = true;
              this.log(`🛑 네이버 보호조치 신호를 감지해 모든 자동 작업을 즉시 중단합니다. 네이버 원문: ${neighborPreflight.rawMessage || neighborPreflight.message}`, 'error');
            }
          } catch (preflightError) {
            this.log(`⚠️ @${post.blogId} 이웃 상태 사전 확인 실패: ${preflightError.message} · 실제 신청 단계에서 다시 확인합니다.`, 'warn');
          }
        }
        if (this.shouldStop) break;
        const selectedActions = selectPostActions({
          requested: {
            like: this.config.doLike && !blockedActions.has('like'),
            comment: this.config.doComment && !blockedActions.has('comment'),
            neighbor: neighborEligible
          },
          todayCounts: {
            likes: (Number(todaySummary.todayLikes) || 0) + (Number(sharedToday?.likes) || 0),
            comments: (Number(todaySummary.todayComments) || 0) + (Number(sharedToday?.comments) || 0),
            neighbors: todaySummary.todayNeighbors
          },
          postIndex: this.stats.processedCount,
          enforceDailyLimits: true
        });
        if (!selectedActions.length) {
          this.log(`선택된 작업이 없어 다음 포스팅으로 넘어갑니다.`, 'info');
          continue;
        }
        const doLikeForPost = selectedActions.includes('like');
        const doCommentForPost = selectedActions.includes('comment');
        const doNeighborForPost = selectedActions.includes('neighbor');

        this.stats.currentPost = {
          title: post.title,
          blogId: post.blogId,
          bloggerName: post.bloggerName,
          url: targetUrl
        };
        this.stats.processedCount += 1;
        keywordProcessedCounts[currentKeyword] += 1;
        this.stats.currentKeyword = currentKeyword;
        this.stats.keywordProcessedCounts = { ...keywordProcessedCounts };
        this.emit('status', this.getStatus());

        this.log(`[${i + 1}/${items.length}] @${post.blogId} ('${post.title.slice(0, 25)}...') 분석 중...`, 'info');

        try {
          // 1. Inspect post
          const inspection = await this.browserSession.inspectPostForEngagement(targetUrl);
          if (inspection.alreadyCommented) { this.stats.processedCount -= 1; keywordProcessedCounts[currentKeyword] -= 1; this.stats.skippedCount += 1; this.log(`⏩ [중복 댓글 제외] @${post.blogId} 이미 내 댓글이 확인된 포스팅입니다.`, 'warn'); continue; }

          // 2. Generate AI comment if requested
          let generatedComment = '';
          let imageSummary = '';
          let recentComments = [];
          if (doCommentForPost) {
            this.log(`🤖 AI가 포스팅 내용과 사진을 읽고 맞춤 댓글을 생성하고 있습니다...`, 'info');
            imageSummary = inspection.firstImage?.alt || (inspection.images.length > 0 ? `${inspection.images.length}장의 본문 사진 포함` : '');
            recentComments = this.historyStore?.getRecentComments ? await this.historyStore.getRecentComments(30) : [];
            const composed = await composeComment({
              mode: this.config.commentMode,
              phrases: this.config.commentPhrases,
              recentComments,
              bloggerName: post.bloggerName,
              generateAi: () => this.embeddedLlama.generateBlogComment({
                title: inspection.title || post.title,
                contentSnippet: inspection.snippet,
                imageSummary,
                tone: this.config.tone, recentComments
              })
            });
            generatedComment = composed.text;
            if (!generatedComment) this.log('⏩ 글 관련성·문자·중복 검증을 통과한 댓글을 만들지 못해 댓글 등록을 건너뜁니다.', 'warn');
            else this.log(`💬 ${composed.source === 'phrase' ? '내 문구' : '검증된 AI'} 댓글${this.config.secretComment ? '(비밀)' : ''}: "${generatedComment}"`, 'info');
          }

          // 3. Like and Comment
          const result = await this.browserSession.likeAndCommentPost({
            postUrl: targetUrl,
            commentText: generatedComment,
            doLike: doLikeForPost,
            doComment: doCommentForPost && !!generatedComment,
            secret: this.config.secretComment
          });

          // A comment run can be skipped before reaching Naver when the local
          // model returns no usable text. Keep that distinct from a Naver
          // permission error so the user can act on the real cause.
          if (doCommentForPost && !generatedComment) {
            result.commentReason = this.embeddedLlama?.lastCommentFailure || 'AI 댓글 생성·검증에 실패해 등록하지 않았습니다.';
            result.message = result.liked
              ? `공감(❤️) 완료 (댓글 미작성: ${result.commentReason})`
              : `반응 불가 (사유: ${result.commentReason}${result.likeReason ? ` / ${result.likeReason}` : ''})`;
          }

          const restrictionText = `${result.likeReason || ''} ${result.commentReason || ''} ${result.message || ''}`;
          if (/자동입력 방지|캡차|보안 문자|보호조치|추가 인증|로그인이 필요/i.test(restrictionText)) {
            if (doLikeForPost) blockedActions.add('like');
            if (doCommentForPost) blockedActions.add('comment');
            this.shouldStop = true;
            this.state = 'stopped';
            this.stats.protectionTriggered = true;
            this.log('🛑 네이버 보호조치 신호를 감지해 모든 자동 작업을 즉시 중단합니다. 브라우저에서 계정 상태를 확인해주세요.', 'error');
          }

          if (result.liked && result.commented) {
            this.stats.likeSuccessCount += 1;
            this.stats.commentSuccessCount += 1;
            this.log(`✅ [소통 완료] @${post.blogId} 포스팅에 공감(❤️) 및 AI 댓글 등록 완료!`, 'success');
          } else if (result.liked && !result.commented) {
            this.stats.likeSuccessCount += 1;
            const commentReason = result.commentReason || '작성자가 댓글 비허용 또는 작성 권한 없음';
            this.log(`❌ [댓글 등록 실패] @${post.blogId} 공감(❤️) 완료 · 댓글 미등록 사유: ${commentReason}`, 'error');
          } else if (!result.liked && result.commented) {
            this.stats.commentSuccessCount += 1;
            const likeReason = result.likeReason || '작성자가 공감 비허용';
            this.log(`⚠️ [부분 완료] @${post.blogId} AI 댓글 등록 완료 (※ 공감 미적용 사유: ${likeReason})`, 'warn');
          } else {
            this.stats.skippedCount += 1;
            const reasonDetail = [result.likeReason, result.commentReason].filter(Boolean).join(' / ') || '공감 및 댓글 모두 비허용된 포스팅';
            this.log(`❌ [소통 실패] @${post.blogId} 포스팅에 반응 불가 · 사유: ${reasonDetail}`, 'error');
          }

          // 4. Send Neighbor Request if requested
          let neighborRequested = false;
          let neighborStatus = neighborPreflight && !doNeighborForPost ? neighborPreflight.status : '';
          let neighborResultMsg = neighborPreflight && !doNeighborForPost ? neighborPreflight.message : '';
          let neighborRawMessage = neighborPreflight && !doNeighborForPost ? neighborPreflight.rawMessage || '' : '';
          let sentNeighborMessage = '';
          if (doNeighborForPost && post.blogId) {
            this.log(`👥 @${post.blogId} 님에게 서로이웃 신청을 함께 보냅니다...`, 'info');
            try {
              const topic = post.engagementTopic ?? currentKeyword;
              if (this.config.neighborMessageMode === 'ai' && typeof this.embeddedLlama?.generateNeighborMessage === 'function') {
                sentNeighborMessage = await this.embeddedLlama.generateNeighborMessage({
                  bloggerName: post.bloggerName || post.blogId,
                  title: inspection.title || post.title,
                  contentSnippet: inspection.snippet || post.description,
                  baseMessage: this.config.neighborMessage
                });
                if (sentNeighborMessage) this.log(`✉️ AI 맞춤 신청 메시지: "${sentNeighborMessage}"`, 'info');
              }
              sentNeighborMessage ||= buildNeighborMessage(this.config.neighborMessage, post.bloggerName || post.blogId, topic, this.stats.processedCount);
              const nRes = await this.browserSession.addNeighbor(
                post.blogId,
                sentNeighborMessage,
                post.bloggerName || post.blogId
              );
              neighborStatus = nRes.status;
              neighborResultMsg = nRes.message;
              neighborRawMessage = nRes.rawMessage || '';

              if (nRes.status === 'requested' || nRes.status === 'added') {
                neighborRequested = true;
                this.stats.neighborSuccessCount += 1;
                const groupInfo = nRes.createdGroupName
                  ? ` (새 그룹 '${nRes.createdGroupName}' 생성)`
                  : (nRes.appliedGroupName ? ` [${nRes.appliedGroupName}]` : '');
                this.log(`✅ [서로이웃 성공] @${post.blogId} 님에게 서로이웃 신청 완료!${groupInfo} (누적 성공: ${this.stats.neighborSuccessCount})`, 'success');
              } else if (nRes.status === 'already_mutual' || nRes.status === 'already_added') {
                this.log(`ℹ️ [이웃 확인] @${post.blogId} 님과는 이미 서로이웃입니다.`, 'info');
              } else if (nRes.status === 'mutual_unavailable') {
                this.log(`⏩ [이웃 스킵] @${post.blogId} 님은 서로이웃 신청을 받지 않는 계정입니다.`, 'info');
              } else if (nRes.status === 'limit_reached') {
                this.stats.neighborLimitReached = true;
                this.state = 'completed';
                this.log(`🏁 네이버 서로이웃 일일 한도(100명)에 도달해 전체 자동 작업을 종료합니다.${neighborRawMessage ? ` 네이버 원문: ${neighborRawMessage}` : ''}`, 'success');
                blockedActions.add('neighbor');
                neighborBlockedDate = koreaDateKey();
              } else if (nRes.status === 'verification_required') {
                blockedActions.add('neighbor');
                this.shouldStop = true;
                this.state = 'stopped';
                this.stats.protectionTriggered = true;
                this.log('🛑 네이버 보호조치 신호를 감지해 모든 자동 작업을 즉시 중단합니다. 브라우저에서 계정 상태를 확인해주세요.', 'error');
              } else {
                this.log(`ℹ️ @${post.blogId} 서로이웃: ${nRes.message}${neighborRawMessage ? ` · 네이버 원문: ${neighborRawMessage}` : ''}`, 'info');
              }
            } catch (nErr) {
              neighborStatus = 'failed';
              this.log(`⚠️ @${post.blogId} 서로이웃 신청 오류: ${nErr.message}`, 'warn');
            }
          }

          // Save record in history store for deduplication & Excel export
          if (this.historyStore) {
            const finalStatusMsg = `${result.message}${neighborRequested ? ' | 서로이웃 신청 완료' : (neighborStatus && neighborStatus !== 'requested' ? ` | 서로이웃: ${neighborResultMsg || neighborStatus}${neighborRawMessage ? ` | 네이버 원문: ${neighborRawMessage}` : ''}` : '')}`;
            await this.historyStore.addRecord({
              blogId: post.blogId,
              bloggerName: post.bloggerName || post.blogId,
              title: inspection.title || post.title,
              postUrl: targetUrl,
              keyword: currentKeyword,
              liked: result.liked,
              commented: result.commented,
              commentText: generatedComment,
              contentSnippet: inspection.snippet,
              imageSummary,
              recentComments,
              promptVersion: COMMENT_PROMPT_VERSION,
              modelId: this.embeddedLlama?.lastUsedModelId || this.embeddedLlama?.currentModelId || '',
              neighborRequested,
              neighborStatus,
              neighborMessage: sentNeighborMessage,
              status: (result.liked && result.commented) ? 'success' : ((result.liked || result.commented || neighborRequested) ? 'partial' : 'failed'),
              statusMessage: finalStatusMsg
            }).catch(() => {});
          }
        } catch (postErr) {
          this.stats.failedCount += 1;
          this.log(`❌ [처리 실패] @${post.blogId} 처리 중 오류: ${postErr.message}`, 'error');
        }

        if (this.state === 'completed' && this.stats.neighborLimitReached) break;

        if (this.config.doNeighbor && typeof this.historyStore?.getSummary === 'function') {
          const latestSummary = await this.historyStore.getSummary().catch(() => ({}));
          if (Number(latestSummary.todayNeighbors || 0) >= this.config.dailyNeighborLimit) {
            this.stats.neighborLimitReached = true;
            this.state = 'completed';
            this.log(`🏁 서로이웃 신청 ${this.config.dailyNeighborLimit}명에 도달해 전체 자동 작업을 종료합니다.`, 'success');
            break;
          }
        }

        sessionProcessed += 1;
        if (sessionProcessed >= this.config.sessionPosts && i < items.length - 1 && !this.shouldStop) {
          const breakSeconds = randomInt(this.config.sessionBreakMinSeconds, this.config.sessionBreakMaxSeconds);
          this.log(`☕ ${this.config.sessionPosts}개 연속 처리를 마쳐 ${Math.ceil(breakSeconds / 60)}분간 세션 휴식합니다.`, 'delay');
          await this.countdownDelay(breakSeconds);
          sessionProcessed = 0;
        }

        // Random Delay between actions with human jitter buffer
        if (i < items.length - 1 && !this.shouldStop) {
          const baseDelay = randomInt(this.config.minDelay, this.config.maxDelay);
          const jitter = Math.floor(Math.random() * 21) - 5; // -5 to +15s jitter
          const delaySec = Math.max(baseDelay + jitter, 25);
          this.log(`⏳ 다음 포스팅까지 ${delaySec}초간 대기합니다 (계정 보호 랜덤 딜레이 +${jitter >= 0 ? jitter : 0}s)...`, 'delay');
          await this.countdownDelay(delaySec);
        }
      }

      if (this.state === 'running') {
        this.state = 'completed';
        if (this.stats.processedCount >= this.config.targetCount) {
          this.stats.targetReached = true;
          this.log(`🏁 목표 ${this.config.targetCount}개 포스팅 소통을 마쳤습니다. (공감: ${this.stats.likeSuccessCount}건, 댓글: ${this.stats.commentSuccessCount}건, 서로이웃: ${this.stats.neighborSuccessCount}건)`, 'success');
        } else {
          this.log(`⚠️ 후보 포스팅이 부족해 목표 ${this.config.targetCount}건 중 ${this.stats.processedCount}건만 처리했습니다. 목표 달성으로 기록하지 않습니다.`, 'warn');
        }
      }
    } finally {
      this.stats.endTime = new Date().toISOString();
      this.stats.phase = this.state;
      this.stats.currentPost = null;
      this.stats.delayCountdown = 0;
      this.emit('status', this.getStatus());
    }
  }

  async countdownDelay(seconds) {
    for (let s = seconds; s > 0; s -= 1) {
      if (this.shouldStop) break;
      this.stats.delayCountdown = s;
      this.emit('status', this.getStatus());
      await new Promise((r) => setTimeout(r, 1000));
    }
    this.stats.delayCountdown = 0;
    this.emit('status', this.getStatus());
  }

  pause() {
    if (this.state !== 'running') return false;
    this.isPaused = true;
    this.pausePromise = new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
    return true;
  }

  resume() {
    if (!this.isPaused) return false;
    this.isPaused = false;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
    return true;
  }

  stop() {
    this.shouldStop = true;
    this.resume();
    return true;
  }
}
