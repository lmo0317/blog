// Groups what the app did into Korean calendar days for the Summary tab: neighbors added, replies
// posted under my own posts, and comments left on other blogs. Reads the same store records as the
// Excel activity report; nothing here writes.
import { cleanPostTitle } from './activity-report.js';

// Neighbor rows count only when the request went out (or the neighbor was added / accepted).
const ADDED_STATUSES = new Set(['requested', 'added']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const kst = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
};
export const seoulDay = (value = new Date()) => kst(value).slice(0, 10);
const timeOf = (value) => kst(value).slice(11, 16);
const newest = (a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
const text = (value) => String(value || '').trim();

function engagementSource(record) {
  if (record.keyword === '답방') return '답방';
  return record.keyword ? `키워드 · ${record.keyword}` : '키워드 소통';
}

function collectRows(data) {
  const engagement = data.engagement || [];
  const feed = data.feed || [];
  const replies = (data.replies || []).map((r) => ({ ...r, timestamp: r.repliedAt || r.timestamp }));

  const neighbors = [
    ...engagement.filter((r) => ADDED_STATUSES.has(r.neighborStatus)).map((r) => ({
      timestamp: r.timestamp, blogId: text(r.blogId), name: text(r.bloggerName), kind: 'requested',
      source: engagementSource(r), postTitle: cleanPostTitle(r.title, r.bloggerName), postUrl: text(r.postUrl)
    })),
    ...replies.filter((r) => ADDED_STATUSES.has(r.neighborStatus)).map((r) => ({
      timestamp: r.timestamp, blogId: text(r.authorId), name: text(r.authorName), kind: 'requested',
      source: '내 글에 댓글 단 이웃', postTitle: text(r.postTitle), postUrl: text(r.postUrl)
    })),
    ...(data.neighborHistory || []).filter((r) => ADDED_STATUSES.has(r.status)).map((r) => ({
      timestamp: r.timestamp, blogId: text(r.blogId), name: text(r.bloggerName), kind: r.status === 'added' ? 'added' : 'requested',
      source: r.keyword ? `이웃 추가 · ${r.keyword}` : '이웃 추가', postTitle: '', postUrl: ''
    })),
    ...(data.neighborActions || []).filter((r) => r.action === 'accepted').map((r) => ({
      timestamp: r.timestamp, blogId: text(r.blogId), name: text(r.nickname), kind: 'accepted',
      source: '받은 신청 수락', postTitle: '', postUrl: ''
    }))
  ];

  const replyRows = replies.filter((r) => r.replied && text(r.replyText)).map((r) => ({
    timestamp: r.timestamp, blogId: text(r.authorId), name: text(r.authorName),
    postTitle: text(r.postTitle), postUrl: text(r.postUrl), received: text(r.text), text: text(r.replyText)
  }));

  const comments = [
    ...engagement.filter((r) => r.commented && text(r.commentText)).map((r) => ({
      timestamp: r.timestamp, blogId: text(r.blogId), name: text(r.bloggerName), source: engagementSource(r),
      postTitle: cleanPostTitle(r.title, r.bloggerName), postUrl: text(r.postUrl), text: text(r.commentText), liked: Boolean(r.liked)
    })),
    ...feed.filter((r) => r.commented && text(r.commentText)).map((r) => ({
      timestamp: r.timestamp, blogId: text(r.blogId), name: text(r.author), source: '이웃 새글',
      postTitle: text(r.title), postUrl: text(r.url), text: text(r.commentText), liked: Boolean(r.liked)
    }))
  ];

  return { neighbors, replies: replyRows, comments };
}

function byDay(rows) {
  const days = new Map();
  for (const row of rows) {
    const day = seoulDay(row.timestamp);
    if (!day) continue;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({ ...row, time: timeOf(row.timestamp) });
  }
  for (const list of days.values()) list.sort(newest);
  return days;
}

// The same blogger can be requested by two paths on one day (keyword visit + my-post reply); count once.
function uniqueNeighbors(list) {
  const seen = new Set();
  return list.filter((row) => {
    const key = row.blogId.toLowerCase() || `${row.name}|${row.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * data: { engagement, feed, replies, neighborActions, neighborHistory } (raw store records)
 * date: the day to list in detail (YYYY-MM-DD, Asia/Seoul); defaults to today.
 * Returns { today, date, totals, days: [{ date, neighbors, replies, comments }], detail }.
 */
export function buildDailySummary(data, { date = '', now = new Date() } = {}) {
  const today = seoulDay(now);
  const selected = DAY_RE.test(String(date)) ? String(date) : today;
  const rows = collectRows(data);
  const grouped = {
    neighbors: byDay(rows.neighbors),
    replies: byDay(rows.replies),
    comments: byDay(rows.comments)
  };
  for (const [day, list] of grouped.neighbors) grouped.neighbors.set(day, uniqueNeighbors(list));

  const allDays = new Set([...grouped.neighbors.keys(), ...grouped.replies.keys(), ...grouped.comments.keys()]);
  const days = [...allDays].filter((day) => day <= today).sort((a, b) => b.localeCompare(a)).map((day) => ({
    date: day,
    neighbors: grouped.neighbors.get(day)?.length || 0,
    replies: grouped.replies.get(day)?.length || 0,
    comments: grouped.comments.get(day)?.length || 0
  }));
  const totals = days.reduce((sum, day) => ({
    neighbors: sum.neighbors + day.neighbors, replies: sum.replies + day.replies, comments: sum.comments + day.comments
  }), { neighbors: 0, replies: 0, comments: 0 });

  return {
    today,
    date: selected,
    totals,
    days,
    detail: {
      date: selected,
      neighbors: grouped.neighbors.get(selected) || [],
      replies: grouped.replies.get(selected) || [],
      comments: grouped.comments.get(selected) || []
    }
  };
}
