import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddedLlamaServer } from '../lib/embedded-llama.js';

function fakeCloud({ engine = 'local', connected = [] } = {}) {
  const calls = [];
  return {
    calls,
    settings: { engine, claudeModel: 'claude-opus-5-5', geminiModel: 'gemini-3.8-flash-medium' },
    isConnected: (p) => connected.includes(p),
    fallbackProvider() { return [engine, 'claude', 'gemini'].find((p) => p !== 'local' && connected.includes(p)) || ''; },
    modelFor: (p) => (p === 'claude' ? 'claude-opus-5-5' : 'gemini-3.8-flash-medium'),
    async complete(provider, { messages }) { calls.push({ provider, messages }); return `${provider} 답변`; }
  };
}

test('a connected subscription chosen as the engine answers without touching the local model', async () => {
  const llama = new EmbeddedLlamaServer({ modelManager: null });
  const cloud = fakeCloud({ engine: 'claude', connected: ['claude'] });
  llama.attachCloud(cloud);
  const text = await llama.chatCompletion([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
  assert.equal(text, 'claude 답변');
  assert.equal(cloud.calls[0].provider, 'claude');
  assert.equal(llama.lastUsedModelId, 'claude:claude-opus-5-5');
  assert.equal(llama.status, 'stopped');
});

test('local engine without a usable model falls back to a connected subscription', async () => {
  const llama = new EmbeddedLlamaServer({ modelManager: null });
  const cloud = fakeCloud({ engine: 'local', connected: ['gemini'] });
  llama.attachCloud(cloud);
  assert.equal(await llama.chatCompletion([{ role: 'user', content: 'u' }]), 'gemini 답변');
});

test('with no local model and no connected account the call fails with a clear message', async () => {
  const llama = new EmbeddedLlamaServer({ modelManager: null });
  llama.attachCloud(fakeCloud({ engine: 'claude', connected: [] }));
  await assert.rejects(() => llama.chatCompletion([{ role: 'user', content: 'u' }]), /사용할 수 있는 AI가 없습니다/);
});
