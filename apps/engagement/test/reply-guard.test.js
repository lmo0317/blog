// 2026-10-21 audit: nine comments on the owner's blog carried two to five owner replies each, because the post page
// hid replies in a folded list and failed confirmations were retried. The comment list is now the one source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommentInfo, ownerRepliesTo } from '../lib/reply-guard.js';

test('data-info from the comment list gives number, parent and owner flag', () => {
  const info = "commentNo:'903974464172064872', parentCommentNo:'903734535621967980', replyLevel:2, mine:true, regTime:'2026-09-05T11:50:25+0900'";
  assert.deepEqual(parseCommentInfo(info), { no: '903974464172064872', parent: '903734535621967980', mine: true });
  assert.deepEqual(parseCommentInfo("commentNo:'903734535621967980', replyLevel:1, mine:false"), { no: '903734535621967980', parent: '', mine: false });
});

test('a comment that already has an owner reply is found, a visitor reply alone is not', () => {
  const rows = [
    { no: '1001', parent: '', mine: false },
    { no: '1002', parent: '1001', mine: false, text: '무료 이용권 체험 중에 막혔어요' },
    { no: '2001', parent: '', mine: false },
    { no: '2002', parent: '2001', mine: true, text: '행복한 수요일 보내세요' }
  ];
  assert.equal(ownerRepliesTo(rows, '1001').length, 0);
  assert.equal(ownerRepliesTo(rows, '2001').length, 1);
  assert.equal(ownerRepliesTo(rows, '').length, 0);
});
