import { EventEmitter } from 'node:events';

export const ENGAGEMENT_LIMITS = Object.freeze({
  likesPerDay: 200,
  commentsPerDay: 100,
  neighborsPerDay: 80,
  maxActionsPerPost: 2,
  sessionPosts: 15, // Safe breath every 15 posts to avoid account protection flags
  sessionBreakMinSeconds: 180, // 3~5 min session break
  sessionBreakMaxSeconds: 300
});

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
  constructor({ browserSession, embeddedLlama, historyStore }) {
    super();
    this.browserSession = browserSession;
    this.embeddedLlama = embeddedLlama;
    this.historyStore = historyStore;

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
      startTime: null,
      endTime: null,
      currentPost: null,
      currentKeyword: '',
      keywordProcessedCounts: {},
      phase: 'idle',
      delayCountdown: 0
    };

    this.logs = [];
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
    maxDelay = 90,
    activeWithinDays = 14 
  }) {
    if (this.state === 'running' || this.state === 'paused') {
      throw new Error('이미 실행 중인 공감/소통 작업이 있습니다.');
    }

    if (!this.browserSession?.connected) {
      throw new Error('네이버 계정이 연결되어 있지 않습니다. 먼저 로그인을 완료해주세요.');
    }

    const keywords = [...new Set(String(keyword || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean))].slice(0, 10);
    if (!keywords.length) {
      throw new Error('검색 키워드를 입력해주세요.');
    }

    const targetPerKeyword = Math.min(Math.max(Number(targetCount) || 20, 1), 500);
    const cleanTarget = targetPerKeyword * keywords.length;
    const cleanMinDelay = Math.max(Number(minDelay) || 30, 30);
    const cleanMaxDelay = Math.min(Math.max(Number(maxDelay) || 90, cleanMinDelay), 300);

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
      activeWithinDays: Number(activeWithinDays) || 0
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
    this.log(`🚀 ${keywords.length}개 키워드(${keywords.join(', ')})를 순차 실행합니다. (키워드당 ${targetPerKeyword}건, 총 ${cleanTarget}건)`, 'info');
    this.emit('status', this.getStatus());

    // Run in background
    this.runLoop().catch((err) => {
      this.state = 'error';
      this.log(`❌ 오류 발생: ${err.message}`, 'error');
      this.emit('status', this.getStatus());
    });

    return this.getStatus();
  }

  async runLoop() {
    try {
      const blockedActions = new Set();
      let sessionProcessed = 0;
      const items = [];
      for (const keyword of this.config.keywords) {
        this.stats.currentKeyword = keyword;
        this.stats.phase = 'searching';
        this.emit('status', this.getStatus());
        this.log(`🔍 [${keyword}] 관련 타겟 포스팅을 검색하고 있습니다...`, 'info');
        const found = await this.browserSession.searchBlogs({ query: keyword, display: Math.min(Math.max(this.config.targetPerKeyword * 2, 100), 1000), activeWithinDays: this.config.activeWithinDays, excludeBlogIds: [] });
        const candidates = Array.isArray(found) ? found : (found?.items || []);
        items.push(...candidates.map((post) => ({ ...post, engagementKeyword: keyword })));
      }

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

        const todaySummary = this.historyStore?.getSummary ? await this.historyStore.getSummary() : {};
        const selectedActions = selectPostActions({
          requested: {
            like: this.config.doLike && !blockedActions.has('like'),
            comment: this.config.doComment && !blockedActions.has('comment'),
            neighbor: this.config.doNeighbor && !blockedActions.has('neighbor')
          },
          todayCounts: {
            likes: todaySummary.todayLikes,
            comments: todaySummary.todayComments,
            neighbors: todaySummary.todayNeighbors
          },
          postIndex: this.stats.processedCount,
          enforceDailyLimits: false // User requested continuous operation without artificial daily limit
        });
        if (!selectedActions.length) {
          this.log(`선택된 작업이 없어 다음 포스팅으로 넘어갑니다.`, 'info');
          continue;
        }
        const doLikeForPost = selectedActions.includes('like');
        const doCommentForPost = selectedActions.includes('comment');
        const doNeighborForPost = selectedActions.includes('neighbor');

        // Check deduplication
        if (this.historyStore && await this.historyStore.hasEngagedPost(targetUrl, post.blogId)) {
          this.stats.skippedCount += 1;
          this.log(`⏩ [중복 제외] @${post.blogId} (${post.title.slice(0, 20)}...) 이미 소통한 기록이 있어 건너뜁니다.`, 'info');
          continue;
        }

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
          if (doCommentForPost) {
            this.log(`🤖 AI가 포스팅 내용과 사진을 읽고 맞춤 댓글을 생성하고 있습니다...`, 'info');
            const imageSummary = inspection.firstImage?.alt || (inspection.images.length > 0 ? `${inspection.images.length}장의 본문 사진 포함` : '');
            const recentComments = this.historyStore?.getRecentComments ? await this.historyStore.getRecentComments(30) : [];
            generatedComment = await this.embeddedLlama.generateBlogComment({
              title: inspection.title || post.title,
              contentSnippet: inspection.snippet,
              imageSummary,
              tone: this.config.tone, recentComments
            });
            if (!generatedComment) this.log('⏩ 글 관련성·문자·중복 검증을 통과한 댓글을 만들지 못해 댓글 등록을 건너뜁니다.', 'warn'); else this.log(`💬 검증된 댓글: "${generatedComment}"`, 'info');
          }

          // 3. Like and Comment
          const result = await this.browserSession.likeAndCommentPost({
            postUrl: targetUrl,
            commentText: generatedComment,
            doLike: doLikeForPost,
            doComment: doCommentForPost && !!generatedComment
          });

          const restrictionText = `${result.likeReason || ''} ${result.commentReason || ''} ${result.message || ''}`;
          if (/자동입력 방지|캡차|보안 문자|보호조치|추가 인증|로그인이 필요/i.test(restrictionText)) {
            if (doLikeForPost) blockedActions.add('like');
            if (doCommentForPost) blockedActions.add('comment');
            this.log('🛡️ 네이버 보안 확인 신호를 감지해 공감·댓글 기능을 이번 실행에서 중단합니다.', 'warn');
          }

          if (result.liked && result.commented) {
            this.stats.likeSuccessCount += 1;
            this.stats.commentSuccessCount += 1;
            this.log(`✅ [소통 완료] @${post.blogId} 포스팅에 공감(❤️) 및 AI 댓글 등록 완료!`, 'success');
          } else if (result.liked && !result.commented) {
            this.stats.likeSuccessCount += 1;
            const commentReason = result.commentReason || '작성자가 댓글 비허용 또는 작성 권한 없음';
            this.log(`⚠️ [부분 완료] @${post.blogId} 공감(❤️) 완료 (※ 댓글 미등록 사유: ${commentReason})`, 'warn');
          } else if (!result.liked && result.commented) {
            this.stats.commentSuccessCount += 1;
            const likeReason = result.likeReason || '작성자가 공감 비허용';
            this.log(`⚠️ [부분 완료] @${post.blogId} AI 댓글 등록 완료 (※ 공감 미적용 사유: ${likeReason})`, 'warn');
          } else {
            this.stats.skippedCount += 1;
            const reasonDetail = [result.likeReason, result.commentReason].filter(Boolean).join(' / ') || '공감 및 댓글 모두 비허용된 포스팅';
            this.log(`⏩ [스킵] @${post.blogId} 포스팅에 반응 불가 (사유: ${reasonDetail})`, 'warn');
          }

          // 4. Send Neighbor Request if requested
          let neighborRequested = false;
          let neighborStatus = '';
          let neighborResultMsg = '';
          let sentNeighborMessage = '';
          if (doNeighborForPost && post.blogId) {
            this.log(`👥 @${post.blogId} 님에게 서로이웃 신청을 함께 보냅니다...`, 'info');
            try {
              sentNeighborMessage = buildNeighborMessage(this.config.neighborMessage, post.bloggerName || post.blogId, currentKeyword, this.stats.processedCount);
              const nRes = await this.browserSession.addNeighbor(
                post.blogId,
                sentNeighborMessage,
                post.bloggerName || post.blogId
              );
              neighborStatus = nRes.status;
              neighborResultMsg = nRes.message;

              if (nRes.status === 'requested' || nRes.status === 'added') {
                neighborRequested = true;
                this.stats.neighborSuccessCount += 1;
                this.log(`✅ [서로이웃 성공] @${post.blogId} 님에게 서로이웃 신청 완료! (누적 성공: ${this.stats.neighborSuccessCount})`, 'success');
              } else if (nRes.status === 'already_mutual' || nRes.status === 'already_added') {
                this.log(`ℹ️ [이웃 확인] @${post.blogId} 님과는 이미 서로이웃입니다.`, 'info');
              } else if (nRes.status === 'mutual_unavailable') {
                this.log(`⏩ [이웃 스킵] @${post.blogId} 님은 서로이웃 신청을 받지 않는 계정입니다.`, 'info');
              } else if (nRes.status === 'limit_reached') {
                this.log(`⚠️ 네이버 서로이웃 일일 한도(100명)에 도달했습니다.`, 'warn');
                blockedActions.add('neighbor');
              } else if (nRes.status === 'verification_required') {
                blockedActions.add('neighbor');
                this.log('🛡️ 네이버 보안 확인 신호를 감지해 서로이웃 기능을 이번 실행에서 중단합니다.', 'warn');
              } else {
                this.log(`ℹ️ @${post.blogId} 서로이웃: ${nRes.message}`, 'info');
              }
            } catch (nErr) {
              neighborStatus = 'failed';
              this.log(`⚠️ @${post.blogId} 서로이웃 신청 오류: ${nErr.message}`, 'warn');
            }
          }

          // Save record in history store for deduplication & Excel export
          if (this.historyStore) {
            const finalStatusMsg = `${result.message}${neighborRequested ? ' | 서로이웃 신청 완료' : (neighborStatus && neighborStatus !== 'requested' ? ` | 서로이웃: ${neighborResultMsg || neighborStatus}` : '')}`;
            await this.historyStore.addRecord({
              blogId: post.blogId,
              bloggerName: post.bloggerName || post.blogId,
              title: inspection.title || post.title,
              postUrl: targetUrl,
              keyword: currentKeyword,
              liked: result.liked,
              commented: result.commented,
              commentText: generatedComment,
              neighborRequested,
              neighborStatus,
              neighborMessage: sentNeighborMessage,
              status: (result.liked && result.commented) ? 'success' : ((result.liked || result.commented || neighborRequested) ? 'partial' : 'failed'),
              statusMessage: finalStatusMsg
            }).catch(() => {});
          }
        } catch (postErr) {
          this.stats.failedCount += 1;
          this.log(`⚠️ @${post.blogId} 처리 중 오류: ${postErr.message}`, 'warn');
        }

        sessionProcessed += 1;
        if (sessionProcessed >= ENGAGEMENT_LIMITS.sessionPosts && i < items.length - 1 && !this.shouldStop) {
          const breakSeconds = randomInt(ENGAGEMENT_LIMITS.sessionBreakMinSeconds, ENGAGEMENT_LIMITS.sessionBreakMaxSeconds);
          this.log(`☕ ${ENGAGEMENT_LIMITS.sessionPosts}개 연속 처리를 마쳐 ${Math.ceil(breakSeconds / 60)}분간 세션 휴식합니다.`, 'delay');
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
