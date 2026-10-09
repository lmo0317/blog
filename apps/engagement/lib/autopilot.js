import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 자율 주행 모드: once switched on, it keeps the blog running by itself in repeating cycles.
// Each cycle: accept good neighbor requests → reply to new comments on my posts → find a golden
// keyword and engage with posts found for it → engage with the neighbor feed. Then it rests for
// the chosen interval and goes again, only inside the chosen active hours.
// The real work is done by the existing managers, passed in as `steps`, so this file only decides
// order, timing and safety stops.

export const AUTOPILOT_STEPS = Object.freeze([
  { id: 'acceptNeighbors', label: '이웃 관리 (신청 수락·회수)', icon: '🤝' },
  { id: 'replies', label: '내 글 새 댓글에 대댓글', icon: '💬' },
  { id: 'engage', label: '황금 키워드 찾아 소통', icon: '🔥' },
  { id: 'feed', label: '이웃 새글 소통', icon: '📰' }
]);

export const DEFAULT_AUTOPILOT_SETTINGS = Object.freeze({
  seedTopics: '',
  postsPerCycle: 20,
  feedPerCycle: 10,
  intervalMinutes: 90,
  activeStartHour: 9,
  activeEndHour: 23,
  doLike: true,
  doComment: true,
  doNeighbor: true,
  allowGradeB: false,
  returnVisit: false,
  acceptMode: 'screen',
  cancelSentDays: 14,
  steps: { acceptNeighbors: true, replies: true, engage: true, feed: true }
});

const KEYWORD_REUSE_DAYS = 7;
const MAX_LOGS = 200;
const RETRY_DISCONNECTED_MS = 10 * 60 * 1000;
const RETRY_BUSY_MS = 3 * 60 * 1000;

const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
};

export function normalizeAutopilotSettings(input = {}, base = DEFAULT_AUTOPILOT_SETTINGS) {
  const merged = { ...base, ...input, steps: { ...base.steps, ...(input.steps || {}) } };
  const seeds = [...new Set(String(merged.seedTopics || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean))].slice(0, 10);
  return {
    seedTopics: seeds.join(', '),
    postsPerCycle: clampInt(merged.postsPerCycle, 5, 50, 20),
    feedPerCycle: clampInt(merged.feedPerCycle, 0, 30, 10),
    intervalMinutes: clampInt(merged.intervalMinutes, 30, 360, 90),
    activeStartHour: clampInt(merged.activeStartHour, 0, 23, 9),
    activeEndHour: clampInt(merged.activeEndHour, 1, 24, 23),
    doLike: merged.doLike !== false,
    doComment: merged.doComment !== false,
    doNeighbor: merged.doNeighbor !== false,
    allowGradeB: merged.allowGradeB === true,
    returnVisit: merged.returnVisit === true,
    // 'screen': accept genuine bloggers and reject ads/macros; 'all': accept every request.
    acceptMode: merged.acceptMode === 'all' ? 'all' : 'screen',
    // Withdraw sent requests still pending after this many days (0 = off), once a day.
    cancelSentDays: [0, 7, 14, 30].includes(Number(merged.cancelSentDays)) ? Number(merged.cancelSentDays) : 14,
    steps: Object.fromEntries(AUTOPILOT_STEPS.map(({ id }) => [id, merged.steps[id] !== false]))
  };
}

function koreaHour(date) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(date));
}

// Active window in Korean time; end may pass midnight (e.g. 21 → 2).
export function isWithinActiveHours(date, startHour, endHour) {
  const hour = koreaHour(date);
  if (startHour === endHour) return true;
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

export function msUntilActive(date, startHour, endHour) {
  if (isWithinActiveHours(date, startHour, endHour)) return 0;
  const probe = new Date(date.getTime());
  probe.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 25; i += 1) {
    probe.setUTCHours(probe.getUTCHours() + 1);
    if (isWithinActiveHours(probe, startHour, endHour)) return probe.getTime() - date.getTime();
  }
  return 60 * 60 * 1000;
}

// The best S/A (optionally B) keyword not used in the last week; null if none qualifies.
export function pickGoldenKeyword(items, { usedKeywords = {}, allowGradeB = false, now = Date.now() } = {}) {
  const grades = allowGradeB ? ['S', 'A', 'B'] : ['S', 'A'];
  const recent = (keyword) => {
    const usedAt = usedKeywords[String(keyword).toLowerCase()];
    return usedAt && now - new Date(usedAt).getTime() < KEYWORD_REUSE_DAYS * 24 * 60 * 60 * 1000;
  };
  return (items || []).find((item) => grades.includes(item.grade) && item.keyword && !recent(item.keyword)) || null;
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export class AutopilotManager {
  constructor({ statePath = '', steps, isConnected = () => true, getBusyLabel = () => '', getStopReason = () => '', stopActive = () => {}, sleep = null, now = () => new Date(), random = Math.random }) {
    this.statePath = statePath;
    this.steps = steps;
    this.isConnected = isConnected;
    // A reason that ends autopilot outright (e.g. the subscription expired).
    this.getStopReason = getStopReason;
    this.getBusyLabel = getBusyLabel;
    this.stopActive = stopActive;
    this.now = now;
    this.random = random;
    this.customSleep = sleep;

    this.settings = normalizeAutopilotSettings();
    this.enabled = false;
    this.phase = 'off'; // off | running | waiting | sleeping | blocked
    this.currentStep = null;
    this.message = '자율 주행이 꺼져 있습니다.';
    this.cycle = 0;
    this.nextRunAt = null;
    this.usedKeywords = {};
    this.seedCursor = 0;
    this.history = [];
    this.currentCycle = null;
    this.logs = [];
    this.loopPromise = null;
    this.wakeUp = null;
    this.load();
  }

  load() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8'));
      this.settings = normalizeAutopilotSettings(saved.settings || {});
      this.enabled = saved.enabled === true;
      this.cycle = Number(saved.cycle) || 0;
      this.usedKeywords = saved.usedKeywords && typeof saved.usedKeywords === 'object' ? saved.usedKeywords : {};
      this.seedCursor = Number(saved.seedCursor) || 0;
      this.history = Array.isArray(saved.history) ? saved.history.slice(0, 20) : [];
      this.logs = Array.isArray(saved.logs) ? saved.logs.slice(0, MAX_LOGS) : [];
    } catch {
      // A broken state file just starts fresh.
    }
  }

  save() {
    if (!this.statePath) return;
    try {
      mkdirSync(path.dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify({
        settings: this.settings,
        enabled: this.enabled,
        cycle: this.cycle,
        usedKeywords: this.usedKeywords,
        seedCursor: this.seedCursor,
        history: this.history.slice(0, 20),
        logs: this.logs.slice(0, MAX_LOGS)
      }, null, 2), 'utf8');
    } catch (error) {
      console.warn('[Autopilot] Could not save state:', error.message);
    }
  }

  log(message, type = 'info') {
    this.logs.unshift({ time: formatTime(this.now()), type, message });
    if (this.logs.length > MAX_LOGS) this.logs.length = MAX_LOGS;
    console.log(`[Autopilot] ${message}`);
  }

  updateSettings(input) {
    this.settings = normalizeAutopilotSettings(input, this.settings);
    this.save();
    return this.settings;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      phase: this.phase,
      message: this.message,
      currentStep: this.currentStep,
      cycle: this.cycle,
      nextRunAt: this.nextRunAt,
      settings: this.settings,
      steps: AUTOPILOT_STEPS,
      currentCycle: this.currentCycle,
      history: this.history.slice(0, 10),
      logs: this.logs.slice(0, 80)
    };
  }

  validate(settings = this.settings) {
    const enabledSteps = AUTOPILOT_STEPS.filter(({ id }) => settings.steps[id]);
    if (!enabledSteps.length) return '자율 주행에서 할 일을 하나 이상 켜주세요.';
    if (settings.steps.engage && !settings.seedTopics) return '황금 키워드를 찾을 내 블로그 주제를 하나 이상 입력해주세요.';
    if (settings.steps.engage && !settings.doLike && !settings.doComment && !settings.doNeighbor) return '키워드 소통에서 공감·댓글·서로이웃 중 하나 이상을 켜주세요.';
    return '';
  }

  start(settings = null) {
    if (settings) this.settings = normalizeAutopilotSettings(settings, this.settings);
    const problem = this.validate();
    if (problem) throw new Error(problem);
    const blocked = this.getStopReason();
    if (blocked) throw new Error(blocked);
    if (this.enabled && this.loopPromise) return this.getStatus();
    this.enabled = true;
    this.phase = 'running';
    this.message = '자율 주행을 준비하고 있습니다...';
    this.log('🚗 자율 주행을 시작합니다. 켜두시면 정해진 간격으로 알아서 반복합니다.', 'success');
    this.save();
    if (this.loopPromise) {
      // A just-stopped loop is still winding down; start a fresh one once it has exited.
      this.loopPromise.then(() => { if (this.enabled && !this.loopPromise) this.launch(); });
    } else {
      this.launch();
    }
    return this.getStatus();
  }

  // Resumes after an app restart if the user had left autopilot switched on.
  resumeIfEnabled() {
    if (!this.enabled || this.loopPromise || this.validate()) return false;
    this.log('🔁 앱이 다시 켜져 자율 주행을 이어서 진행합니다.', 'info');
    this.launch();
    return true;
  }

  launch() {
    this.loopPromise = this.runLoop()
      .catch((error) => {
        this.log(`🚨 자율 주행 오류: ${error.message}`, 'error');
        this.enabled = false;
        this.phase = 'off';
        this.message = `오류로 자율 주행을 멈췄습니다: ${error.message}`;
        this.save();
      })
      .finally(() => { this.loopPromise = null; });
  }

  stop(reason = '사용자가 자율 주행을 껐습니다.') {
    const wasEnabled = this.enabled;
    this.enabled = false;
    this.phase = 'off';
    this.currentStep = null;
    this.nextRunAt = null;
    this.message = reason;
    if (wasEnabled) this.log(`⏹️ ${reason}`, 'warn');
    this.wakeUp?.();
    try { this.stopActive(); } catch {}
    this.save();
    return this.getStatus();
  }

  // Interruptible wait: stop() wakes it immediately.
  wait(ms) {
    if (this.customSleep) return this.customSleep(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(done, Math.max(0, ms));
      function done() { clearTimeout(timer); resolve(); }
      this.wakeUp = () => { this.wakeUp = null; done(); };
    });
  }

  async runLoop() {
    while (this.enabled) {
      const stopReason = this.getStopReason();
      if (stopReason) {
        this.stop(stopReason);
        break;
      }
      const now = this.now();
      const { activeStartHour, activeEndHour } = this.settings;
      const untilActive = msUntilActive(now, activeStartHour, activeEndHour);
      if (untilActive > 0) {
        this.phase = 'sleeping';
        this.currentStep = null;
        this.nextRunAt = new Date(now.getTime() + untilActive).toISOString();
        this.message = `운영 시간(${activeStartHour}시~${activeEndHour}시)이 아니라 쉬는 중입니다.`;
        this.log(`🌙 운영 시간이 아니어서 ${Math.ceil(untilActive / 60000)}분 뒤에 다시 시작합니다.`, 'info');
        await this.wait(untilActive);
        continue;
      }

      if (!this.isConnected()) {
        this.phase = 'blocked';
        this.nextRunAt = new Date(now.getTime() + RETRY_DISCONNECTED_MS).toISOString();
        this.message = '네이버 로그인이 필요합니다. 로그인되면 자동으로 이어갑니다.';
        this.log('🔑 네이버 계정이 연결되어 있지 않아 10분 뒤 다시 확인합니다.', 'warn');
        await this.wait(RETRY_DISCONNECTED_MS);
        continue;
      }

      const busy = this.getBusyLabel();
      if (busy) {
        this.phase = 'blocked';
        this.nextRunAt = new Date(now.getTime() + RETRY_BUSY_MS).toISOString();
        this.message = `직접 실행한 '${busy}' 작업이 끝나길 기다리는 중입니다.`;
        this.log(`⏳ '${busy}' 작업이 진행 중이라 3분 뒤 다시 확인합니다.`, 'info');
        await this.wait(RETRY_BUSY_MS);
        continue;
      }

      const outcome = await this.runCycle();
      if (!this.enabled) break;
      if (outcome.protectionTriggered) {
        this.stop('네이버 보호조치 신호를 감지해 자율 주행을 안전하게 멈췄습니다. 브라우저에서 계정 상태를 확인해주세요.');
        break;
      }

      const jitter = 0.85 + this.random() * 0.3;
      const restMs = Math.round(this.settings.intervalMinutes * 60 * 1000 * jitter);
      this.phase = 'waiting';
      this.currentStep = null;
      this.nextRunAt = new Date(this.now().getTime() + restMs).toISOString();
      this.message = `${this.cycle}회차를 마쳤습니다. 다음 회차까지 쉬는 중입니다.`;
      this.log(`☕ 다음 회차까지 약 ${Math.round(restMs / 60000)}분 쉬어갑니다.`, 'info');
      this.save();
      await this.wait(restMs);
    }
  }

  async runCycle() {
    this.cycle += 1;
    this.phase = 'running';
    this.nextRunAt = null;
    const cycle = { number: this.cycle, startedAt: this.now().toISOString(), finishedAt: null, keyword: '', results: [] };
    this.currentCycle = cycle;
    this.log(`🚦 ${this.cycle}회차 자율 주행을 시작합니다.`, 'info');
    let protectionTriggered = false;

    for (const step of AUTOPILOT_STEPS) {
      if (!this.enabled || protectionTriggered) break;
      if (!this.settings.steps[step.id]) continue;
      const stopReason = this.getStopReason();
      if (stopReason) {
        this.stop(stopReason);
        break;
      }
      this.currentStep = step.id;
      this.message = `${step.icon} ${step.label} 중...`;
      this.log(`${step.icon} ${step.label}을(를) 시작합니다.`, 'info');
      const result = { step: step.id, label: step.label, status: 'done', summary: '' };
      try {
        const output = step.id === 'engage' ? await this.runEngageStep(cycle) : await this.steps[step.id](this.settings);
        result.summary = output?.summary || '';
        result.status = output?.skipped ? 'skipped' : 'done';
        protectionTriggered = Boolean(output?.protectionTriggered);
        this.log(`${result.status === 'skipped' ? '⏩' : '✅'} ${step.label}: ${result.summary || '완료'}`, result.status === 'skipped' ? 'info' : 'success');
      } catch (error) {
        result.status = 'failed';
        result.summary = error.message;
        this.log(`❌ ${step.label} 실패: ${error.message}`, 'error');
      }
      cycle.results.push(result);
      this.save();
    }

    cycle.finishedAt = this.now().toISOString();
    this.history.unshift(cycle);
    this.history = this.history.slice(0, 20);
    this.currentStep = null;
    this.save();
    return { protectionTriggered };
  }

  // Picks the next seed topic in rotation, finds its best unused golden keyword, then engages.
  async runEngageStep(cycle) {
    const seeds = this.settings.seedTopics.split(/,\s*/).filter(Boolean);
    let picked = null;
    for (let tries = 0; tries < seeds.length && !picked && this.enabled; tries += 1) {
      const seed = seeds[this.seedCursor % seeds.length];
      this.seedCursor += 1;
      this.message = `🔎 '${seed}' 주제에서 황금 키워드를 찾는 중...`;
      this.log(`🔎 '${seed}' 주제에서 황금 키워드를 찾고 있습니다...`, 'info');
      const found = await this.steps.findKeywords(seed);
      picked = pickGoldenKeyword(found?.items, { usedKeywords: this.usedKeywords, allowGradeB: this.settings.allowGradeB, now: this.now().getTime() });
      if (!picked) this.log(`⚠️ '${seed}'에서 최근 7일 안에 안 쓴 ${this.settings.allowGradeB ? 'S·A·B' : 'S·A'}등급 키워드를 찾지 못했습니다.`, 'warn');
    }
    if (!picked) return { skipped: true, summary: '쓸 만한 황금 키워드가 없어 이번 회차 키워드 소통은 건너뜁니다.' };

    this.usedKeywords[picked.keyword.toLowerCase()] = this.now().toISOString();
    cycle.keyword = picked.keyword;
    this.log(`🏆 '${picked.keyword}' (${picked.grade}등급)로 소통합니다.`, 'success');
    this.message = `🔥 '${picked.keyword}' 키워드로 소통 중...`;
    const output = await this.steps.engage({ keyword: picked.keyword, settings: this.settings });
    return { ...output, summary: `'${picked.keyword}' · ${output?.summary || '완료'}` };
  }
}
