import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySummary, seoulDay } from '../lib/daily-summary.js';

// 2026-10-20 14:00 in Seoul.
const now = new Date('2026-10-20T05:00:00Z');

const data = {
  engagement: [
    // 2026-10-20 09:10 KST: keyword visit, commented and requested
    { blogId: 'foodie', bloggerName: '맛집탐험가', title: '맛집\n\n성수동 파스타 맛집 후기\n\n맛집탐험가', postUrl: 'https://blog.naver.com/foodie/224400000001', keyword: '파스타', liked: true, commented: true, commentText: '파스타 사진 보니 배고파지네요 😊', neighborStatus: 'requested', timestamp: '2026-10-20T00:10:00Z' },
    // Visited but no comment, request hit the daily limit: counts as nothing
    { blogId: 'limit', bloggerName: '한도', title: '글', postUrl: 'https://blog.naver.com/limit/224400000002', keyword: '파스타', liked: true, commented: false, commentText: '', neighborStatus: 'limit_reached', timestamp: '2026-10-20T01:00:00Z' },
    // 2026-10-19 23:30 KST is still the 19th even though it is the 19th 14:30 UTC
    { blogId: 'late', bloggerName: '야행성', title: '밤 산책', postUrl: 'https://blog.naver.com/late/224400000003', keyword: '답방', liked: false, commented: true, commentText: '밤 공기 좋네요', neighborStatus: '', timestamp: '2026-10-19T14:30:00Z' },
    // 2026-10-20 00:30 KST belongs to the 20th although UTC says the 19th
    { blogId: 'early', bloggerName: '새벽', title: '새벽 커피', postUrl: 'https://blog.naver.com/early/224400000004', keyword: '', liked: false, commented: true, commentText: '새벽 커피 최고죠', neighborStatus: 'already_mutual', timestamp: '2026-10-19T15:30:00Z' }
  ],
  feed: [
    { blogId: 'neighbor1', author: '이웃1', title: '가을 단풍 여행', url: 'https://m.blog.naver.com/neighbor1/224400000010', liked: true, commented: true, commentText: '단풍 색이 정말 곱네요', timestamp: '2026-10-20T03:00:00Z' },
    { blogId: 'neighbor2', author: '이웃2', title: '공감만', url: 'https://m.blog.naver.com/neighbor2/224400000011', liked: true, commented: false, commentText: '', timestamp: '2026-10-20T03:05:00Z' }
  ],
  replies: [
    { authorId: 'guest', authorName: '손님', text: '잘 보고 갑니다', postTitle: '내 글 제목', postUrl: 'https://blog.naver.com/me/224400000020', replyText: '와주셔서 감사해요 😊', replied: true, status: 'completed', neighborStatus: 'requested', repliedAt: '2026-10-20T02:00:00Z' },
    // Same blogger requested twice today (keyword visit + reply): counted once
    { authorId: 'FOODIE', authorName: '맛집탐험가', text: '반가워요', postTitle: '내 글 제목', postUrl: 'https://blog.naver.com/me/224400000020', replyText: '저도 반가워요', replied: true, status: 'completed', neighborStatus: 'requested', repliedAt: '2026-10-20T04:00:00Z' },
    // Not posted: no reply row
    { authorId: 'owner', authorName: '직접', text: '질문 있어요', postTitle: '내 글 제목', postUrl: 'https://blog.naver.com/me/224400000020', replyText: '', replied: false, status: 'needs_owner', repliedAt: '2026-10-20T04:30:00Z' }
  ],
  neighborActions: [
    { action: 'accepted', blogId: 'friend', nickname: '친구', timestamp: '2026-10-18T03:00:00Z' },
    { action: 'rejected', blogId: 'spam', nickname: '광고', timestamp: '2026-10-18T03:01:00Z' }
  ],
  neighborHistory: [
    { blogId: 'manual', bloggerName: '수동', keyword: '여행', status: 'requested', timestamp: '2026-10-18T05:00:00Z' },
    { blogId: 'failed', bloggerName: '실패', keyword: '여행', status: 'failed', timestamp: '2026-10-18T05:01:00Z' }
  ]
};

test('seoulDay uses the Korean calendar day', () => {
  assert.equal(seoulDay('2026-10-19T15:30:00Z'), '2026-10-20');
  assert.equal(seoulDay('2026-10-19T14:30:00Z'), '2026-10-19');
  assert.equal(seoulDay('not a date'), '');
});

test('today lists neighbors added, replies posted and comments left, newest first', () => {
  const summary = buildDailySummary(data, { now });
  assert.equal(summary.today, '2026-10-20');
  assert.equal(summary.date, '2026-10-20');

  const { neighbors, replies, comments } = summary.detail;
  // foodie (keyword + reply, once) and guest
  assert.deepEqual(neighbors.map((r) => r.blogId.toLowerCase()), ['foodie', 'guest']);
  assert.equal(neighbors.length, 2);
  assert.equal(neighbors.every((r) => r.kind === 'requested'), true);

  assert.deepEqual(replies.map((r) => r.text), ['저도 반가워요', '와주셔서 감사해요 😊']);
  assert.equal(replies[1].received, '잘 보고 갑니다');
  assert.equal(replies[1].time, '11:00');

  assert.deepEqual(comments.map((r) => r.blogId), ['neighbor1', 'foodie', 'early']);
  const keyword = comments.find((r) => r.blogId === 'foodie');
  assert.equal(keyword.postTitle, '성수동 파스타 맛집 후기');
  assert.equal(keyword.source, '키워드 · 파스타');
  assert.equal(keyword.liked, true);
  assert.equal(comments[0].source, '이웃 새글');
  assert.equal(comments[0].time, '12:00');
});

test('days give per-day counts for the whole history and any day can be opened', () => {
  const summary = buildDailySummary(data, { now, date: '2026-10-18' });
  assert.deepEqual(summary.days, [
    { date: '2026-10-20', neighbors: 2, replies: 2, comments: 3 },
    { date: '2026-10-19', neighbors: 0, replies: 0, comments: 1 },
    { date: '2026-10-18', neighbors: 2, replies: 0, comments: 0 }
  ]);
  assert.deepEqual(summary.totals, { neighbors: 4, replies: 2, comments: 4 });

  assert.equal(summary.date, '2026-10-18');
  const kinds = summary.detail.neighbors.map((r) => [r.blogId, r.kind, r.source]);
  assert.deepEqual(kinds, [['manual', 'requested', '이웃 추가 · 여행'], ['friend', 'accepted', '받은 신청 수락']]);
  assert.deepEqual(summary.detail.replies, []);
  assert.deepEqual(summary.detail.comments, []);

  assert.equal(buildDailySummary(data, { now, date: '2026-10-19' }).detail.comments[0].source, '답방');
});

test('an empty day or empty stores give empty lists, and a bad date falls back to today', () => {
  const quiet = buildDailySummary(data, { now, date: '2026-10-01' });
  assert.deepEqual(quiet.detail, { date: '2026-10-01', neighbors: [], replies: [], comments: [] });

  const empty = buildDailySummary({}, { now, date: '../../etc' });
  assert.equal(empty.date, '2026-10-20');
  assert.deepEqual(empty.days, []);
  assert.deepEqual(empty.totals, { neighbors: 0, replies: 0, comments: 0 });
});
