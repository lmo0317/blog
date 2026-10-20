// What is running right now, for the top of the Summary tab: autopilot (with its current step) and
// one short row per background system. Takes the managers' own status objects; nothing here acts.
import { AUTOPILOT_STEPS } from './autopilot.js';

// Same daily caps the managers enforce (feed + topic engagement share likes/comments; 서이추 100/day).
export const DAILY_LIMITS = Object.freeze({ likes: 200, comments: 100, neighbors: 100 });

const OFF_MESSAGE = '자율 주행이 꺼져 있습니다.';
const num = (value) => Number(value) || 0;
const text = (value) => String(value || '').trim();

const kstClock = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('sv-SE', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
};

export function untilText(iso, now = new Date()) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - new Date(now).getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return '곧 시작';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}분 후`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 후`;
}

const row = (id, group, icon, name, state, label, detail) => ({ id, group, icon, name, state, label, detail });

function autopilotView(status = {}, now) {
  const enabled = Boolean(status.enabled);
  const phase = enabled ? (status.phase || 'running') : 'off';
  const settings = status.settings || {};
  const results = status.currentCycle?.results || [];
  const steps = (status.steps || AUTOPILOT_STEPS).map((step) => {
    const done = results.find((item) => item.step === step.id);
    const off = settings.steps ? !settings.steps[step.id] : false;
    const state = off ? 'off' : enabled && phase === 'running' && status.currentStep === step.id ? 'running' : done ? done.status : 'pending';
    return { id: step.id, icon: step.icon, label: step.label, state, summary: text(done?.summary) };
  });
  const current = steps.find((step) => step.state === 'running');
  const next = enabled && phase !== 'running' && status.nextRunAt ? { at: status.nextRunAt, clock: kstClock(status.nextRunAt), in: untilText(status.nextRunAt, now) } : null;

  let state = 'off';
  let label = '꺼짐';
  if (phase === 'running') { state = 'running'; label = '진행 중'; }
  else if (phase === 'waiting') { state = 'waiting'; label = '다음 회차 대기'; }
  else if (phase === 'sleeping') { state = 'waiting'; label = '쉬는 시간'; }
  else if (phase === 'blocked') { state = 'warn'; label = '잠시 멈춤'; }

  let detail = text(status.message);
  if (phase === 'running' && !detail && current) detail = `${current.icon} ${current.label} 진행 중`;
  if (!enabled) {
    // A stop reason (error, expired license) stays visible; the plain "off" message becomes a hint.
    const stopped = detail && detail !== OFF_MESSAGE;
    if (stopped) { state = 'error'; label = '멈춤'; }
    detail = stopped ? detail : '자율 주행 탭에서 켜면 블로그 관리를 알아서 반복합니다';
  }

  return {
    enabled, phase, state, label, detail,
    message: text(status.message),
    cycle: num(status.cycle),
    currentStep: current ? { id: current.id, icon: current.icon, label: current.label } : null,
    next,
    steps
  };
}

function engagementRow(status = {}) {
  const stats = status.stats || {};
  const keyword = text(stats.currentKeyword || status.config?.keyword);
  const lastResult = `공감 ${num(stats.likeSuccessCount)} · 댓글 ${num(stats.commentSuccessCount)} · 서이추 ${num(stats.neighborSuccessCount)}`;
  const progress = `${num(stats.processedCount)}/${num(stats.targetCount)}`;
  const s = status.state || 'idle';
  if (s === 'running') {
    const who = text(stats.currentPost?.bloggerName);
    return row('engagement', 'work', '👥', '주제 소통 · 서이추', 'running', '진행 중',
      `${keyword ? `'${keyword}' ` : ''}${progress}${who ? ` · @${who} 님 글 소통 중` : ''}`);
  }
  if (s === 'paused') return row('engagement', 'work', '👥', '주제 소통 · 서이추', 'warn', '일시정지', `${keyword ? `'${keyword}' ` : ''}${progress} 에서 멈춤`);
  if (s === 'error') return row('engagement', 'work', '👥', '주제 소통 · 서이추', 'error', '오류', '마지막 소통이 오류로 멈췄어요');
  const ran = num(stats.processedCount) > 0;
  return row('engagement', 'work', '👥', '주제 소통 · 서이추', 'idle', '대기', ran ? `마지막 · ${keyword ? `'${keyword}' ` : ''}${lastResult}` : '실행 중인 작업 없음');
}

function feedRow(status = {}) {
  const stats = status.stats || {};
  const s = status.state || 'idle';
  const progress = `${num(stats.successCount)}/${num(stats.target ?? status.config?.targetCount)}`;
  const name = '이웃 새글 댓글';
  if (s === 'running') {
    const who = text(status.currentPost?.author);
    return row('feed', 'work', '📰', name, 'running', '진행 중', `${progress}${who ? ` · @${who} 님 새 글 읽는 중` : ''}`);
  }
  if (s === 'paused') return row('feed', 'work', '📰', name, 'warn', '일시정지', `${progress} 에서 멈춤`);
  if (s === 'error') return row('feed', 'work', '📰', name, 'error', '오류', '마지막 작업이 오류로 멈췄어요');
  if (stats.dailyLimitReached) return row('feed', 'work', '📰', name, 'warn', '한도 도달', '오늘 공감·댓글 한도에 도달했어요');
  const ran = num(stats.processedCount) > 0;
  return row('feed', 'work', '📰', name, 'idle', '대기', ran ? `마지막 · 공감 ${num(stats.likedCount)} · 댓글 ${num(stats.commentedCount)}` : '실행 중인 작업 없음');
}

function repliesRow(active) {
  return active
    ? row('replies', 'work', '↩️', '내 글 대댓글', 'running', '진행 중', '내 글에 달린 새 댓글에 답글을 달고 있어요')
    : row('replies', 'work', '↩️', '내 글 대댓글', 'idle', '대기', '실행 중인 작업 없음');
}

function cleanerRow(status = {}) {
  const stats = status.stats || {};
  const s = status.state || 'idle';
  const what = stats.type === 'sent' ? '보낸 신청 회수' : '받은 신청 처리';
  const progress = `${num(stats.processed)}/${num(stats.total)}`;
  const name = '이웃 신청 관리';
  if (s === 'running') return row('cleaner', 'work', '🤝', name, 'running', '진행 중', `${what} ${progress}`);
  if (s === 'paused') return row('cleaner', 'work', '🤝', name, 'warn', '일시정지', `${what} ${progress} 에서 멈춤`);
  if (s === 'error') return row('cleaner', 'work', '🤝', name, 'error', '오류', `${what} 중 오류가 났어요`);
  if (s === 'completed' && stats.type !== 'none') {
    const result = stats.type === 'sent' ? `회수 ${num(stats.canceled)}건` : `수락 ${num(stats.accepted)} · 거절 ${num(stats.rejected)}`;
    return row('cleaner', 'work', '🤝', name, 'idle', '대기', `마지막 · ${what} ${result}`);
  }
  return row('cleaner', 'work', '🤝', name, 'idle', '대기', '실행 중인 작업 없음');
}

function healthRow(status = {}) {
  const pruned = `오늘 정리 ${num(status.prunedToday)}/${num(status.dailyLimit) || 30}명`;
  const name = '비활성 이웃 정리';
  if (status.state === 'running') {
    const p = status.progress || {};
    return row('health', 'work', '🩺', name, 'running', '진행 중', p.total ? `이웃 활동 확인 ${num(p.done)}/${num(p.total)}` : '이웃 활동을 확인하고 있어요');
  }
  if (status.state === 'error') return row('health', 'work', '🩺', name, 'error', '오류', pruned);
  return row('health', 'work', '🩺', name, 'idle', '대기', pruned);
}

// The old 이웃 추가 automation has no tab of its own any more; show it only while it is doing something.
function neighborAutoRow(status = {}) {
  const s = status.state || 'idle';
  const stats = status.stats || {};
  const progress = `${num(stats.successCount)}/${num(stats.targetCount)}`;
  const name = '서로이웃 추가';
  if (s === 'running') return row('neighborAuto', 'work', '➕', name, 'running', '진행 중', `${status.config?.keyword ? `'${status.config.keyword}' ` : ''}${progress}`);
  if (s === 'paused') return row('neighborAuto', 'work', '➕', name, 'warn', '일시정지', `${progress} 에서 멈춤`);
  if (s === 'limit_reached') return row('neighborAuto', 'work', '➕', name, 'warn', '한도 도달', '오늘 서로이웃 신청 한도에 도달했어요');
  if (s === 'verification_required') return row('neighborAuto', 'work', '➕', name, 'error', '확인 필요', '네이버 보안 확인이 필요해요');
  return null;
}

function aiRow(ai = {}) {
  const engine = ai.engine || 'local';
  const label = text(ai.label);
  if (engine !== 'local') {
    return ai.cloudConnected
      ? row('ai', 'env', '🤖', 'AI 엔진', 'ok', '연결됨', `${label || engine} 구독으로 댓글 작성`)
      : row('ai', 'env', '🤖', 'AI 엔진', 'warn', '연결 필요', `${label || engine} 계정 연결이 끊겼어요 · 설정에서 다시 연결`);
  }
  const runtime = ai.runtime || {};
  const accel = runtime.acceleration ? ` · ${String(runtime.acceleration).toUpperCase()}` : '';
  const model = label || '로컬 AI';
  const setup = runtime.setup || {};
  if (runtime.status === 'running') return row('ai', 'env', '🤖', 'AI 엔진', 'ok', '실행 중', `${model}${accel}`);
  if (runtime.status === 'starting') return row('ai', 'env', '🤖', 'AI 엔진', 'running', '켜는 중', `${model}을 불러오고 있어요`);
  if (/^(installing|downloading|extracting)_runtime$/.test(setup.phase || '')) return row('ai', 'env', '🤖', 'AI 엔진', 'running', `준비 중 ${num(setup.progress)}%`, text(setup.message) || 'AI 실행 엔진을 설치하고 있어요');
  if (runtime.status === 'error') return row('ai', 'env', '🤖', 'AI 엔진', 'error', '오류', `${model}을 켜지 못했어요 · 설정에서 확인`);
  if (runtime.status === 'fallback') return row('ai', 'env', '🤖', 'AI 엔진', 'warn', '대체 모드', `${model} 대신 기본 문장으로 작성 중`);
  return row('ai', 'env', '🤖', 'AI 엔진', 'idle', '꺼짐', `${model} · 댓글을 쓸 때 켜집니다`);
}

function naverRow(naver = {}) {
  return naver.connected
    ? row('naver', 'env', '🌐', '네이버 로그인', 'ok', '연결됨', naver.blogId ? `@${naver.blogId} 블로그로 활동 중` : '네이버 계정 연결됨')
    : row('naver', 'env', '🌐', '네이버 로그인', 'error', '로그인 필요', '설정 탭에서 QR로 로그인해 주세요');
}

function licenseRow(license = {}) {
  const days = num(license.daysLeft);
  const name = '이용권';
  switch (license.status) {
    case 'valid': return row('license', 'env', '🎫', name, days <= 3 ? 'warn' : 'ok', `D-${days}`, `${days}일 남음${days <= 3 ? ' · 곧 만료돼요' : ''}`);
    case 'offline_grace': return row('license', 'env', '🎫', name, 'warn', '오프라인', '인증 서버에 연결하지 못해 임시로 사용 중');
    case 'expired': return row('license', 'env', '🎫', name, 'error', '만료', '이용권이 만료되어 자동 작업이 멈춰요');
    case 'unauthorized_device': return row('license', 'env', '🎫', name, 'error', '다른 PC', '다른 PC에 등록된 이용권이에요');
    case 'connection_error': return row('license', 'env', '🎫', name, 'warn', '확인 실패', '인증 서버에 연결하지 못했어요');
    default: return row('license', 'env', '🎫', name, 'warn', '등록 필요', '상단 구독 뱃지를 눌러 이용권을 등록해 주세요');
  }
}

function updateRow(update = {}, appVersion = '') {
  const current = text(update.currentVersion || appVersion);
  const v = current ? `v${current}` : '';
  const name = '앱 업데이트';
  switch (update.status) {
    case 'downloading': return row('update', 'env', '⬇️', name, 'running', `${num(update.percent)}%`, `새 버전 ${text(update.version)} 받는 중`);
    case 'ready': return row('update', 'env', '🎉', name, 'warn', '준비됨', `새 버전 ${text(update.version)} · 상단 [지금 업데이트]`);
    case 'installing': return row('update', 'env', '⏳', name, 'running', '설치 중', '곧 새 버전으로 다시 열립니다');
    case 'error': return row('update', 'env', '⬆️', name, 'idle', '확인 실패', `${v} · 업데이트 서버에 연결하지 못했어요`);
    case 'checking': return row('update', 'env', '⬆️', name, 'idle', '확인 중', `${v} · 새 버전 확인 중`);
    case 'latest': return row('update', 'env', '⬆️', name, 'ok', '최신', `${v} 최신 버전`);
    default: return row('update', 'env', '⬆️', name, 'idle', v || '-', update.status === 'dev' ? `${v} 개발 버전` : `${v} 사용 중`);
  }
}

/**
 * raw: { autopilot, engagement, feed, cleaner, neighborAuto, neighborHealth, repliesActive,
 *        ai: { engine, cloudConnected, label, runtime }, naver: { connected, blogId },
 *        license: { status, daysLeft }, update, appVersion, usage: { likes, comments, neighbors } }
 */
export function buildSystemStatus(raw = {}, { now = new Date() } = {}) {
  const systems = [
    engagementRow(raw.engagement),
    feedRow(raw.feed),
    repliesRow(Boolean(raw.repliesActive)),
    cleanerRow(raw.cleaner),
    healthRow(raw.neighborHealth),
    neighborAutoRow(raw.neighborAuto),
    aiRow(raw.ai),
    naverRow(raw.naver),
    licenseRow(raw.license),
    updateRow(raw.update, raw.appVersion)
  ].filter(Boolean);
  const usage = raw.usage || {};
  return {
    now: new Date(now).toISOString(),
    autopilot: autopilotView(raw.autopilot, now),
    systems,
    busy: systems.filter((s) => s.group === 'work' && s.state === 'running').map((s) => s.id),
    today: {
      likes: num(usage.likes),
      comments: num(usage.comments),
      neighbors: num(usage.neighbors),
      limits: { ...DAILY_LIMITS }
    }
  };
}
