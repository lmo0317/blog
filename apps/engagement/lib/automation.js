import { EventEmitter } from 'node:events';

export class NeighborAutomationManager extends EventEmitter {
  constructor({ browserSession, historyStore }) {
    super();
    this.browserSession = browserSession;
    this.historyStore = historyStore;

    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'limit_reached' | 'error'
    this.config = {
      keyword: '',
      targetCount: 30,
      message: '안녕하세요! 블로그 글 유익하게 보고 갑니다. 서로이웃 맺고 소통해요 :)',
      minDelay: 15,
      maxDelay: 30,
      activeWithinDays: 30
    };

    this.stats = {
      targetCount: 0,
      processedCount: 0,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      startTime: null,
      endTime: null,
      currentBlog: null,
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
    if (this.logs.length > 200) {
      this.logs.pop();
    }
    this.emit('log', entry);
    this.emit('status', this.getStatus());
    console.log(`[AutoNeighbor] [${entry.time}] ${message}`);
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

  async start({ keyword, targetCount = 30, message = '', minDelay = 15, maxDelay = 30, activeWithinDays = 30 }) {
    if (this.state === 'running' || this.state === 'paused') {
      throw new Error('이미 실행 중인 자동화 작업이 있습니다.');
    }

    if (!this.browserSession?.connected) {
      throw new Error('네이버 계정이 연결되어 있지 않습니다. 먼저 로그인을 완료해주세요.');
    }

    const cleanKeyword = String(keyword || '').trim();
    if (!cleanKeyword) {
      throw new Error('검색 키워드를 입력해주세요.');
    }

    const cleanTarget = Math.min(Math.max(Number(targetCount) || 30, 1), 100);
    const cleanMinDelay = Math.max(Number(minDelay) || 15, 5);
    const cleanMaxDelay = Math.max(Number(maxDelay) || 30, cleanMinDelay);
    const cleanMessage = String(message || '').trim() || '안녕하세요! 블로그 글 유익하게 보고 갑니다. 서로이웃 맺고 소통해요 :)';
    const cleanActiveDays = Number(activeWithinDays) || 0;

    // Daily limit check (Naver limit: 100 per day)
    const todayCount = await this.historyStore.getTodayCount();
    if (todayCount >= 100) {
      this.state = 'limit_reached';
      this.log(`오늘 이미 100건의 서로이웃을 신청하여 네이버 일일 한도에 도달했습니다. 내일 다시 시도해주세요.`, 'warn');
      return this.getStatus();
    }

    const effectiveTarget = Math.min(cleanTarget, 100 - todayCount);

    this.config = {
      keyword: cleanKeyword,
      targetCount: effectiveTarget,
      message: cleanMessage,
      minDelay: cleanMinDelay,
      maxDelay: cleanMaxDelay,
      activeWithinDays: cleanActiveDays
    };

    this.stats = {
      targetCount: effectiveTarget,
      processedCount: 0,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      startTime: new Date().toISOString(),
      endTime: null,
      currentBlog: null,
      delayCountdown: 0
    };

    this.logs = [];
    this.shouldStop = false;
    this.isPaused = false;
    this.state = 'running';

    this.log(`🚀 '${cleanKeyword}' 키워드로 서로이웃 자동 추가 작업을 시작합니다. (목표: ${effectiveTarget}명, 오늘 누적: ${todayCount}명)`, 'info');

    // Run execution loop asynchronously in background
    this.runLoop().catch((err) => {
      console.error('Automation loop fatal error:', err);
      this.state = 'error';
      this.log(`치명적 오류 발생: ${err.message}`, 'error');
    });

    return this.getStatus();
  }

  pause() {
    if (this.state !== 'running') return this.getStatus();
    this.state = 'paused';
    this.isPaused = true;
    this.pausePromise = new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
    this.log(`⏸️ 작업이 일시정지되었습니다.`, 'warn');
    return this.getStatus();
  }

  resume() {
    if (this.state !== 'paused') return this.getStatus();
    this.state = 'running';
    this.isPaused = false;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pausePromise = null;
      this.pauseResolve = null;
    }
    this.log(`▶️ 작업을 재개합니다.`, 'info');
    return this.getStatus();
  }

  stop() {
    if (this.state === 'idle' || this.state === 'completed' || this.state === 'stopped') {
      return this.getStatus();
    }
    this.shouldStop = true;
    this.state = 'stopped';
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pausePromise = null;
      this.pauseResolve = null;
    }
    this.stats.endTime = new Date().toISOString();
    this.log(`⏹️ 사용자에 의해 작업이 중단되었습니다.`, 'warn');
    return this.getStatus();
  }

  async runLoop() {
    const { keyword, targetCount, message, minDelay, maxDelay, activeWithinDays } = this.config;

    try {
      this.log(`🔍 대상 블로그를 탐색하고 필터링하는 중입니다...`, 'info');
      
      // Collect candidates
      const candidates = await this.browserSession.searchBlogs({
        query: keyword,
        display: Math.max(targetCount * 2, 40),
        activeWithinDays
      });

      if (!candidates || candidates.length === 0) {
        this.log(`'${keyword}' 검색 결과에서 대상 블로그를 찾지 못했습니다. 키워드를 변경해보세요.`, 'warn');
        this.state = 'completed';
        this.stats.endTime = new Date().toISOString();
        return;
      }

      this.log(`총 ${candidates.length}개의 후보 블로그를 발견했습니다. 순차적으로 신청을 진행합니다.`, 'info');

      for (let i = 0; i < candidates.length; i++) {
        if (this.shouldStop) break;

        // Handle pause
        if (this.isPaused && this.pausePromise) {
          await this.pausePromise;
          if (this.shouldStop) break;
        }

        // Check if target is achieved
        if (this.stats.successCount >= targetCount) {
          this.log(`🎉 목표 인원(${targetCount}명) 서로이웃 신청을 모두 완료했습니다!`, 'success');
          break;
        }

        const candidate = candidates[i];
        this.stats.currentBlog = candidate;
        this.stats.processedCount += 1;

        // Check history duplicate
        const hasHistory = await this.historyStore.hasHistory(candidate.blogId);
        if (hasHistory) {
          const existing = await this.historyStore.getExistingRecord(candidate.blogId);
          this.stats.skippedCount += 1;
          this.log(`[${i + 1}/${candidates.length}] @${candidate.blogId} (${candidate.bloggerName || '블로거'}) - 이미 처리된 블로그 (건너뜀: ${existing?.statusText || existing?.status})`, 'info');
          continue;
        }

        // Send neighbor request
        this.log(`[${i + 1}/${candidates.length}] @${candidate.blogId} (${candidate.bloggerName || '블로거'}) 님에게 서로이웃 신청 시도 중...`, 'info');

        try {
          const result = await this.browserSession.addNeighbor(candidate.blogId, message, candidate.bloggerName);

          if (result.status === 'limit_reached') {
            this.state = 'limit_reached';
            this.log(`⚠️ 네이버 일일 서로이웃 신청 한도(100명)에 도달하여 작업을 안전하게 중단합니다.`, 'warn');
            await this.historyStore.addRecord({
              blogId: candidate.blogId,
              bloggerName: candidate.bloggerName,
              keyword,
              message,
              status: 'limit_reached',
              statusText: result.message
            });
            break;
          }

          if (result.status === 'verification_required') {
            this.state = 'verification_required';
            this.log(`🚨 네이버 보안 확인(자동입력방지/2차인증)이 발생하여 작업을 중단합니다.`, 'error');
            break;
          }

          if (result.status === 'requested' || result.status === 'added') {
            this.stats.successCount += 1;
            this.log(`✅ [성공] @${candidate.blogId} 님에게 서로이웃 신청 완료! (누적 성공: ${this.stats.successCount}/${targetCount})`, 'success');
            await this.historyStore.addRecord({
              blogId: candidate.blogId,
              bloggerName: candidate.bloggerName,
              keyword,
              message,
              status: 'requested',
              statusText: result.message
            });
          } else if (result.status === 'already_mutual' || result.status === 'already_added' || result.status === 'self') {
            this.stats.skippedCount += 1;
            this.log(`⏩ [스킵] @${candidate.blogId} (${result.message})`, 'info');
            await this.historyStore.addRecord({
              blogId: candidate.blogId,
              bloggerName: candidate.bloggerName,
              keyword,
              message,
              status: result.status,
              statusText: result.message
            });
          } else if (result.status === 'unavailable' || result.status === 'mutual_unavailable') {
            this.stats.skippedCount += 1;
            this.log(`⏩ [신청 불가] @${candidate.blogId} (${result.message})`, 'warn');
            await this.historyStore.addRecord({
              blogId: candidate.blogId,
              bloggerName: candidate.bloggerName,
              keyword,
              message,
              status: 'unavailable',
              statusText: result.message
            });
          } else {
            this.stats.failedCount += 1;
            this.log(`❌ [확인 필요] @${candidate.blogId} (${result.message})`, 'warn');
            await this.historyStore.addRecord({
              blogId: candidate.blogId,
              bloggerName: candidate.bloggerName,
              keyword,
              message,
              status: 'failed',
              statusText: result.message
            });
          }
        } catch (err) {
          this.stats.failedCount += 1;
          this.log(`❌ @${candidate.blogId} 신청 중 에러 발생: ${err.message}`, 'error');
        }

        // Check if finished or need more delay
        if (this.stats.successCount >= targetCount || i === candidates.length - 1 || this.shouldStop) {
          break;
        }

        // Random delay to mimic human behavior
        const delaySeconds = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        this.log(`⏳ 다음 신청까지 ${delaySeconds}초간 대기합니다 (계정 보호 랜덤 딜레이)...`, 'delay');

        for (let s = delaySeconds; s > 0; s--) {
          if (this.shouldStop) break;
          this.stats.delayCountdown = s;
          this.emit('status', this.getStatus());
          await new Promise((r) => setTimeout(r, 1000));
          if (this.isPaused && this.pausePromise) {
            await this.pausePromise;
          }
        }
        this.stats.delayCountdown = 0;
      }

      if (!this.shouldStop && this.state !== 'limit_reached' && this.state !== 'verification_required') {
        this.state = 'completed';
        this.log(`🏁 모든 작업이 마무리되었습니다. (신청 성공: ${this.stats.successCount}건, 스킵: ${this.stats.skippedCount}건, 실패: ${this.stats.failedCount}건)`, 'success');
      }
    } catch (error) {
      this.state = 'error';
      this.log(`작업 중 오류 발생: ${error.message}`, 'error');
    } finally {
      this.stats.endTime = new Date().toISOString();
      this.stats.currentBlog = null;
      this.emit('status', this.getStatus());
    }
  }
}