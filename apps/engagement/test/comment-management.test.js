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

test('a repeated comment from the same person on the same post is answered once', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'comment-replies-'));
  try {
    const store = new CommentReplyStore(path.join(dir, 'history.json'));
    const first = { postUrl: 'https://blog.naver.com/me/123', commentId: '907215378445238277', authorId: 'ma080501', text: '포스팅 좋아요 잘 보고 갑니다' };
    await store.add({ ...first, replyText: '응원 고마워요', replied: true, status: 'completed' });
    assert.equal(await store.repliedSame({ ...first, commentId: '907256035310305300', text: '포스팅 좋아요  잘 보고 갑니다' }), true);
    assert.equal(await store.repliedSame({ ...first, commentId: '1', text: '다른 말' }), false);
    assert.equal(await store.repliedSame({ ...first, postUrl: 'https://blog.naver.com/me/456' }), false);
    await store.add({ ...first, commentId: '907256035310305300', replied: false, status: 'duplicate' });
    assert.equal(await store.has(first.postUrl, '907256035310305300'), true);
    assert.deepEqual(await store.recentReplies(), ['응원 고마워요']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('comment replies avoid stock sentences and recent replies, and never fall back to a fixed one', async () => {
  const { EmbeddedLlamaServer } = await import('../lib/embedded-llama.js');
  const llama = new EmbeddedLlamaServer({ modelManager: null });
  const answers = ['도움이 되셨다니 다행이에요 😊 궁금한 점 있으시면 언제든 찾아주세요!', '카메라 백업 순서를 짚어 주셔서 반가워요. 사진이 많을수록 차이가 크더라고요.'];
  const prompts = [];
  llama.chatCompletion = async (messages) => { prompts.push(messages[1].content); return answers.shift(); };
  const reply = await llama.generateCommentReply({ postTitle: '사진 백업 정리', postSnippet: '카메라 사진을 한 번에 백업하는 방법', commentText: '잘보고갑니다', commenterName: '뚜벅이', recentReplies: ['응원해주셔서 감사해요!'] });
  assert.match(reply, /카메라 백업/);
  assert.match(prompts[0], /\[내 글 앞부분\]/);
  assert.match(prompts[0], /\[최근에 쓴 대댓글\]\n- 응원해주셔서 감사해요!/);

  llama.chatCompletion = async () => '응원해주셔서 정말 감사해요! 힘이 납니다.';
  await assert.rejects(() => llama.generateCommentReply({ commentText: '응원합니다', recentReplies: ['응원해주셔서 정말 감사해요! 힘이 나네요.'] }), /새 대댓글을 만들지 못했습니다/);
});

test('blog comments are skipped, not filled from a template, when the AI fails', async () => {
  const { EmbeddedLlamaServer } = await import('../lib/embedded-llama.js');
  const llama = new EmbeddedLlamaServer({ modelManager: null });
  llama.chatCompletion = async () => { throw new Error('엔진 없음'); };
  assert.equal(await llama.generateBlogComment({ title: '헤어스타일 추천', contentSnippet: '헤어스타일을 바꿨어요' }), '');
  assert.match(llama.lastCommentFailure, /엔진 없음/);
});
