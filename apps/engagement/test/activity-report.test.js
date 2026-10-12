import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx } from '../lib/xlsx.js';
import { buildActivityReport, cleanPostTitle } from '../lib/activity-report.js';
import { NeighborActionStore } from '../lib/neighbor-actions.js';

// Reads the stored files back out of the zip so the test checks real workbook XML.
function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extra;
    files[name] = inflateRawSync(buffer.subarray(start, start + size)).toString('utf8');
    offset = start + size;
  }
  return files;
}

const now = new Date('2026-10-12T05:00:00Z');

test('buildXlsx writes sheets, escaped text, numbers and clickable links', () => {
  const files = unzip(buildXlsx([
    { name: '내가 단 댓글', columns: [{ header: '글 주소', link: true }, { header: '댓글' }, { header: '수' }], rows: [['https://blog.naver.com/a/1', '좋아요 <3 & "감사"', 5]] },
    { name: '요약/합계?', columns: [{ header: '날짜' }], rows: [] }
  ]));
  assert.match(files['xl/workbook.xml'], /<sheet name="내가 단 댓글"/);
  assert.match(files['xl/workbook.xml'], /<sheet name="요약 합계"/);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /좋아요 &lt;3 &amp; &quot;감사&quot;/);
  assert.match(sheet, /<c r="C2"><v>5<\/v><\/c>/);
  assert.match(sheet, /<hyperlink ref="A2" r:id="rId1"\/>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(files['xl/worksheets/_rels/sheet1.xml.rels'], /Target="https:\/\/blog.naver.com\/a\/1" TargetMode="External"/);
  assert.ok(files['[Content_Types].xml'].includes('/xl/worksheets/sheet2.xml'));
});

test('cleanPostTitle keeps the title line out of the saved post header', () => {
  assert.equal(cleanPostTitle('생활정보\n\n"학비 670만원 전액 면제" 2027 AI 대학 총정리\n\n두런\n\n2026. 9. 7. 16:38\n\n 이웃추가\n본문 기타 기능', '두런'), '"학비 670만원 전액 면제" 2027 AI 대학 총정리');
  assert.equal(cleanPostTitle('그냥 제목'), '그냥 제목');
});

test('activity report splits neighbor requests, comments, replies and neighbor management by period', () => {
  const report = buildActivityReport({
    engagement: [
      { blogId: 'a1', bloggerName: '에이', title: '여행\n\n제주 여행 코스\n\n에이', postUrl: 'https://blog.naver.com/a1/1', keyword: '제주 여행', liked: true, commented: true, commentText: '코스 정리 잘 봤어요', neighborStatus: 'requested', neighborMessage: '이웃해요', statusMessage: '공감(❤️) 및 댓글 작성 완료 | 서로이웃 신청 완료', timestamp: '2026-10-12T01:00:00Z' },
      { blogId: 'b2', bloggerName: '비', title: '글', postUrl: 'https://blog.naver.com/b2/2', keyword: '답방', liked: true, commented: false, neighborStatus: 'skipped_inactive', statusMessage: '공감(❤️) 완료 (댓글 미작성: AI 실패)', timestamp: '2026-10-11T01:00:00Z' },
      { blogId: 'old', bloggerName: '옛날', title: '옛글', postUrl: 'https://blog.naver.com/old/3', keyword: 'x', liked: true, commented: true, commentText: '예전 댓글', neighborStatus: 'requested', timestamp: '2026-09-01T01:00:00Z' }
    ],
    feed: [{ blogId: 'c3', author: '씨', title: '이웃 새 글', url: 'https://m.blog.naver.com/c3/4', liked: true, commented: true, commentText: '새 글 잘 읽었어요', statusMessage: '완료', timestamp: '2026-10-12T02:00:00Z' }],
    replies: [
      { postUrl: 'https://blog.naver.com/me/9', postTitle: '내 글', authorId: 'd4', authorName: '디', text: '잘 보고 가요', replyText: '들러주셔서 고마워요', replied: true, neighborStatus: 'neighbor_failed', neighborMessage: 'locator.waitFor: Timeout 7000ms exceeded.\nCall log:', repliedAt: '2026-10-12T03:00:00Z' },
      { postUrl: 'https://blog.naver.com/me/9', postTitle: '내 글', authorId: 'd4', authorName: '디', text: '잘 보고 가요', replyText: '', replied: false, status: 'duplicate', repliedAt: '2026-10-12T03:10:00Z' }
    ],
    neighborActions: [
      { action: 'accepted', blogId: 'e5', nickname: '이', reason: '진성 블로거', timestamp: '2026-10-12T00:30:00Z' },
      { action: 'canceled', blogId: 'f6', nickname: '에프', reason: '15일 동안 수락하지 않은 신청', timestamp: '2026-10-10T00:30:00Z' }
    ],
    neighborHistory: [],
    cycles: [{ number: 3, startedAt: '2026-10-12T00:00:00Z', finishedAt: '2026-10-12T00:40:00Z', keyword: '제주 여행', results: [{ step: 'replies', status: 'done', summary: '대댓글 1건' }, { step: 'engage', status: 'failed', summary: '오류' }] }]
  }, { days: 7, now });

  const sheet = (name) => report.sheets.find((s) => s.name === name);
  const neighbors = sheet('서이추 신청').rows;
  assert.deepEqual(neighbors.map((r) => [r[1], r[2]]), [['실패', 'd4'], ['신청 완료', 'a1']]);
  assert.equal(neighbors[0][6], '네이버 화면이 제때 열리지 않아 실패');
  assert.equal(neighbors[1][8], '제주 여행 코스');

  const comments = sheet('내가 단 댓글').rows;
  assert.deepEqual(comments.map((r) => [r[1], r[2], r[6]]), [['이웃 새글', 'c3', '새 글 잘 읽었어요'], ['키워드 소통 · 제주 여행', 'a1', '코스 정리 잘 봤어요']]);

  const replies = sheet('내 글 대댓글').rows;
  assert.deepEqual(replies.map((r) => r[1]), ['같은 댓글 반복 · 건너뜀', '대댓글 작성']);

  assert.deepEqual(sheet('이웃 관리').rows.map((r) => [r[1], r[2]]), [['받은 신청 수락', 'e5'], ['보낸 신청 회수', 'f6']]);
  assert.equal(sheet('방문 전체').rows.length, 3);
  assert.match(sheet('방문 전체').rows.find((r) => r[2] === 'b2')[1], /^답방/);

  const [total, ...days] = sheet('요약').rows;
  assert.deepEqual(total, ['합계', 3, 2, 1, 1, 1, 0, 1, 0]);
  assert.equal(days[0][0], '2026-10-12');

  const cycle = sheet('자율 주행 회차').rows[0];
  assert.equal(cycle[3], 40);
  assert.equal(cycle[6], '대댓글 1건');
  assert.equal(cycle[8], '실패 · 오류');

  const all = buildActivityReport({ engagement: [{ blogId: 'old', commented: true, commentText: 'x', timestamp: '2026-09-01T01:00:00Z' }] }, { days: 0, now });
  assert.equal(all.sheets.find((s) => s.name === '내가 단 댓글').rows.length, 1);
});

test('NeighborActionStore keeps each action newest first across reloads', async () => {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'neighbor-actions-')), 'actions.json');
  const store = new NeighborActionStore(file);
  await store.add({ action: 'accepted', blogId: 'a', nickname: '에이', reason: '진성' });
  await store.add({ action: 'removed', blogId: 'b', nickname: '비', reason: '90일 동안 새 글 없음' });
  const reloaded = new NeighborActionStore(file);
  assert.deepEqual((await reloaded.list()).map((r) => [r.action, r.blogId]), [['removed', 'b'], ['accepted', 'a']]);
});
