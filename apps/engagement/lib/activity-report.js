// Turns the stored activity (visits, comments, replies, neighbor work, autopilot cycles) into the
// sheets of the downloadable Excel report.
import { NEIGHBOR_ACTION_LABELS } from './neighbor-actions.js';

const NEIGHBOR_STATUS_LABELS = {
  requested: '신청 완료',
  added: '이웃 추가 완료',
  already_mutual: '이미 서로이웃',
  already_added: '이미 이웃',
  skipped_inactive: '건너뜀 (활동 적은 블로그)',
  mutual_unavailable: '서로이웃 불가 (이웃만 가능)',
  unavailable: '신청 불가 블로그',
  manual_required: '실패 (네이버 화면 확인 못함)',
  verification_required: '실패 (보안 확인 필요)',
  limit_reached: '오늘 한도 도달',
  failed: '실패',
  neighbor_failed: '실패',
  self: '내 블로그',
  unknown: '결과 확인 못함'
};
// No request was attempted for these.
const NO_NEIGHBOR_ATTEMPT = new Set(['', 'eligible', 'not_requested']);
// A request was actually sent (or tried and failed); skipped / already-neighbor rows stay in the visit sheet only.
const NEIGHBOR_ATTEMPTS = new Set(['requested', 'added', 'manual_required', 'verification_required', 'limit_reached', 'failed', 'neighbor_failed', 'unknown']);
// Browser errors carry a multi-line call log and automation wording; keep one line a person can read.
const firstLine = (text) => {
  const line = String(text || '').split(/\r?\n/)[0].trim();
  return /timeout|exceeded|locator\.|waitFor|Target (page|closed)|net::ERR|Execution context/i.test(line) ? '네이버 화면이 제때 열리지 않아 실패' : line;
};

const STEP_COLUMNS = [
  ['acceptNeighbors', '이웃 관리'],
  ['replies', '대댓글'],
  ['returnVisit', '답방'],
  ['engage', '서이추 (키워드)'],
  ['feed', '이웃 새글']
];

export const REPORT_RANGES = { 1: '오늘', 7: '최근 7일', 30: '최근 30일', 0: '전체' };

const kst = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
};
const dayOf = (value) => kst(value).slice(0, 10);
const blogUrl = (blogId) => (blogId ? `https://blog.naver.com/${blogId}` : '');
const yesNo = (flag) => (flag ? 'O' : '');
const neighborLabel = (status) => NEIGHBOR_STATUS_LABELS[status] || status || '';

// Saved titles are the whole post header ("카테고리\n\n제목\n\n닉네임\n\n날짜\n\n이웃추가…"); keep the title line.
export function cleanPostTitle(raw, bloggerName = '') {
  const lines = String(raw || '').split(/\n+/).map((line) => line.trim()).filter(Boolean)
    .filter((line) => !/^(본문 기타 기능|이웃추가|이웃|서로이웃|\d+분 전|\d+시간 전|어제)$/.test(line))
    .filter((line) => !/^\d{4}\. ?\d{1,2}\. ?\d{1,2}\./.test(line))
    .filter((line) => !bloggerName || line !== String(bloggerName).trim());
  if (lines.length <= 1) return lines[0] || '';
  // The category label is short and comes first; the title is the longest of the remaining lines.
  return lines.slice(1).reduce((best, line) => (line.length > best.length ? line : best), '');
}

function engagementSource(record) {
  if (record.keyword === '답방') return '답방 (내 글에 댓글 단 이웃)';
  return record.keyword ? `키워드 소통 · ${record.keyword}` : '키워드 소통';
}

/**
 * data: { engagement, feed, replies, neighborActions, neighborHistory, cycles } (raw store records)
 * days: 1 | 7 | 30 | 0 (all)
 */
export function buildActivityReport(data, { days = 7, now = new Date() } = {}) {
  const startDay = days > 0 ? dayOf(new Date(now.getTime() - (days - 1) * 86400000)) : '';
  const inRange = (value) => {
    const day = dayOf(value);
    return Boolean(day) && (!startDay || day >= startDay);
  };
  const newest = (a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''));

  const engagement = (data.engagement || []).filter((r) => inRange(r.timestamp)).sort(newest);
  const feed = (data.feed || []).filter((r) => inRange(r.timestamp)).sort(newest);
  const replies = (data.replies || []).filter((r) => inRange(r.repliedAt)).map((r) => ({ ...r, timestamp: r.repliedAt })).sort(newest);
  const actions = (data.neighborActions || []).filter((r) => inRange(r.timestamp)).sort(newest);
  const manualNeighbors = (data.neighborHistory || []).filter((r) => inRange(r.timestamp)).sort(newest);
  const cycles = (data.cycles || []).filter((c) => inRange(c.startedAt));

  // --- Neighbor requests from every path ---
  const neighborRows = [
    ...engagement.filter((r) => NEIGHBOR_ATTEMPTS.has(r.neighborStatus)).map((r) => ({
      timestamp: r.timestamp, source: engagementSource(r), blogId: r.blogId, name: r.bloggerName,
      status: r.neighborStatus, detail: r.statusMessage?.split('서로이웃:')[1]?.trim() || '', message: r.neighborMessage,
      postTitle: cleanPostTitle(r.title, r.bloggerName), postUrl: r.postUrl
    })),
    ...replies.filter((r) => NEIGHBOR_ATTEMPTS.has(r.neighborStatus)).map((r) => ({
      timestamp: r.timestamp, source: '내 글에 댓글 단 이웃', blogId: r.authorId, name: r.authorName,
      status: r.neighborStatus, detail: r.neighborMessage, message: '', postTitle: r.postTitle, postUrl: r.postUrl
    })),
    ...manualNeighbors.map((r) => ({
      timestamp: r.timestamp, source: r.keyword ? `이웃 추가 · ${r.keyword}` : '이웃 추가', blogId: r.blogId, name: r.bloggerName,
      status: r.status, detail: r.statusText, message: r.message, postTitle: '', postUrl: ''
    }))
  ].sort(newest);

  // --- Comments I wrote on other blogs ---
  const commentRows = [
    ...engagement.filter((r) => r.commented && r.commentText).map((r) => ({
      timestamp: r.timestamp, source: engagementSource(r), blogId: r.blogId, name: r.bloggerName,
      title: cleanPostTitle(r.title, r.bloggerName), url: r.postUrl, text: r.commentText, liked: r.liked
    })),
    ...feed.filter((r) => r.commented && r.commentText).map((r) => ({
      timestamp: r.timestamp, source: '이웃 새글', blogId: r.blogId, name: r.author,
      title: r.title, url: r.url, text: r.commentText, liked: r.liked
    }))
  ].sort(newest);

  // --- Every visit, including the ones where nothing was posted and why ---
  const visitRows = [
    ...engagement.map((r) => ({
      timestamp: r.timestamp, source: engagementSource(r), blogId: r.blogId, name: r.bloggerName,
      title: cleanPostTitle(r.title, r.bloggerName), url: r.postUrl, liked: r.liked, commented: r.commented,
      neighbor: NO_NEIGHBOR_ATTEMPT.has(r.neighborStatus || '') ? '' : neighborLabel(r.neighborStatus), message: r.statusMessage
    })),
    ...feed.map((r) => ({
      timestamp: r.timestamp, source: '이웃 새글', blogId: r.blogId, name: r.author, title: r.title, url: r.url,
      liked: r.liked, commented: r.commented, neighbor: '', message: r.statusMessage
    }))
  ].sort(newest);

  // --- Daily summary ---
  const daily = new Map();
  const bump = (value, key) => {
    const day = dayOf(value);
    if (!day) return;
    const row = daily.get(day) || { likes: 0, comments: 0, requests: 0, replies: 0, accepted: 0, rejected: 0, canceled: 0, removed: 0 };
    row[key] += 1;
    daily.set(day, row);
  };
  [...engagement, ...feed].forEach((r) => { if (r.liked) bump(r.timestamp, 'likes'); if (r.commented) bump(r.timestamp, 'comments'); });
  neighborRows.filter((r) => r.status === 'requested' || r.status === 'added').forEach((r) => bump(r.timestamp, 'requests'));
  replies.filter((r) => r.replied).forEach((r) => bump(r.timestamp, 'replies'));
  actions.filter((r) => ['accepted', 'rejected', 'canceled', 'removed'].includes(r.action)).forEach((r) => bump(r.timestamp, r.action));
  const summaryKeys = ['likes', 'comments', 'requests', 'replies', 'accepted', 'rejected', 'canceled', 'removed'];
  const dayRows = [...daily.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, row]) => [day, ...summaryKeys.map((k) => row[k])]);
  const totals = summaryKeys.map((_, i) => dayRows.reduce((sum, row) => sum + row[i + 1], 0));

  const sheets = [
    {
      name: '요약',
      columns: [
        { header: '날짜', width: 13 }, { header: '공감', width: 9 }, { header: '댓글', width: 9 }, { header: '서이추 신청', width: 12 },
        { header: '내 글 대댓글', width: 13 }, { header: '받은 신청 수락', width: 14 }, { header: '받은 신청 거절', width: 14 },
        { header: '보낸 신청 회수', width: 14 }, { header: '비활성 이웃 정리', width: 16 }
      ],
      rows: [['합계', ...totals], ...dayRows]
    },
    {
      name: '서이추 신청',
      columns: [
        { header: '시간', width: 17 }, { header: '결과', width: 24 }, { header: '블로그 ID', width: 18 }, { header: '닉네임', width: 16 },
        { header: '블로그 주소', width: 34, link: true }, { header: '경로', width: 26 }, { header: '상세', width: 40, wrap: true },
        { header: '신청 메시지', width: 40, wrap: true }, { header: '계기가 된 글', width: 40, wrap: true }, { header: '글 주소', width: 44, link: true }
      ],
      rows: neighborRows.map((r) => [kst(r.timestamp), neighborLabel(r.status), r.blogId, r.name, blogUrl(r.blogId), r.source, firstLine(r.detail), r.message, r.postTitle, r.postUrl])
    },
    {
      name: '내가 단 댓글',
      columns: [
        { header: '시간', width: 17 }, { header: '구분', width: 26 }, { header: '블로그 ID', width: 18 }, { header: '닉네임', width: 16 },
        { header: '글 제목', width: 40, wrap: true }, { header: '글 주소', width: 44, link: true }, { header: '내 댓글', width: 60, wrap: true }, { header: '공감', width: 7 }
      ],
      rows: commentRows.map((r) => [kst(r.timestamp), r.source, r.blogId, r.name, r.title, r.url, r.text, yesNo(r.liked)])
    },
    {
      name: '내 글 대댓글',
      columns: [
        { header: '시간', width: 17 }, { header: '결과', width: 16 }, { header: '내 글 제목', width: 36, wrap: true }, { header: '내 글 주소', width: 44, link: true },
        { header: '댓글 단 사람 ID', width: 18 }, { header: '닉네임', width: 16 }, { header: '받은 댓글', width: 44, wrap: true },
        { header: '내 대댓글', width: 50, wrap: true }, { header: '서이추', width: 22 }, { header: '답방', width: 30, wrap: true }
      ],
      rows: replies.map((r) => [
        kst(r.timestamp),
        r.replied ? '대댓글 작성' : r.status === 'duplicate' ? '같은 댓글 반복 · 건너뜀' : `실패${r.message ? ` · ${firstLine(r.message)}` : ''}`,
        r.postTitle, r.postUrl, r.authorId, r.authorName, r.text, r.replyText,
        NO_NEIGHBOR_ATTEMPT.has(r.neighborStatus || '') ? '' : neighborLabel(r.neighborStatus),
        r.visitStatus ? [r.visitStatus === 'success' ? '답방 완료' : r.visitStatus, firstLine(r.visitMessage)].filter(Boolean).join(' · ') : ''
      ])
    },
    {
      name: '이웃 관리',
      columns: [
        { header: '시간', width: 17 }, { header: '작업', width: 18 }, { header: '블로그 ID', width: 18 }, { header: '닉네임', width: 16 },
        { header: '블로그 주소', width: 34, link: true }, { header: '사유', width: 60, wrap: true }
      ],
      rows: actions.map((r) => [kst(r.timestamp), NEIGHBOR_ACTION_LABELS[r.action] || r.action, r.blogId, r.nickname, blogUrl(r.blogId), firstLine(r.reason)])
    },
    {
      name: '방문 전체',
      columns: [
        { header: '시간', width: 17 }, { header: '구분', width: 26 }, { header: '블로그 ID', width: 18 }, { header: '닉네임', width: 16 },
        { header: '글 제목', width: 40, wrap: true }, { header: '글 주소', width: 44, link: true }, { header: '공감', width: 7 }, { header: '댓글', width: 7 },
        { header: '서이추', width: 22 }, { header: '처리 결과', width: 60, wrap: true }
      ],
      rows: visitRows.map((r) => [kst(r.timestamp), r.source, r.blogId, r.name, r.title, r.url, yesNo(r.liked), yesNo(r.commented), r.neighbor, firstLine(r.message)])
    },
    {
      name: '자율 주행 회차',
      columns: [
        { header: '회차', width: 7 }, { header: '시작', width: 17 }, { header: '끝', width: 17 }, { header: '걸린 시간(분)', width: 13 },
        { header: '키워드', width: 22 }, ...STEP_COLUMNS.map(([, label]) => ({ header: label, width: 36, wrap: true }))
      ],
      rows: cycles.map((c) => {
        const minutes = c.finishedAt ? Math.round((new Date(c.finishedAt) - new Date(c.startedAt)) / 60000) : '';
        return [c.number, kst(c.startedAt), c.finishedAt ? kst(c.finishedAt) : '진행 중', minutes, c.keyword || '',
          ...STEP_COLUMNS.map(([id]) => {
            const step = (c.results || []).find((s) => s.step === id);
            if (!step) return '';
            return step.status === 'done' ? step.summary || '완료' : `${step.status === 'skipped' ? '건너뜀' : step.status === 'failed' ? '실패' : step.status}${step.summary ? ` · ${step.summary}` : ''}`;
          })];
      })
    }
  ];

  return {
    sheets,
    counts: { neighbors: neighborRows.length, comments: commentRows.length, replies: replies.length, actions: actions.length, visits: visitRows.length, cycles: cycles.length }
  };
}
