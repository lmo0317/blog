import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CommentReplyStore } from '../lib/comment-replies.js';

test('comment reply history prevents the same comment from being processed twice', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'comment-replies-'));
  try {
    const file = path.join(dir, 'history.json');
    const store = new CommentReplyStore(file);
    assert.equal(await store.has('https://blog.naver.com/me/123?x=1', 'c1'), false);
    await store.add({ postUrl: 'https://blog.naver.com/me/123?x=1', commentId: 'c1', replyText: '감사합니다', status: 'completed' });
    assert.equal(await store.has('https://blog.naver.com/me/123#comment', 'c1'), true);
    await store.add({ postUrl: 'https://blog.naver.com/me/123', commentId: 'c1', replyText: '새 답글', status: 'completed' });
    const records = await store.list();
    assert.equal(records.length, 1);
    assert.equal(records[0].replyText, '새 답글');
    const disk = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(disk.records.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
