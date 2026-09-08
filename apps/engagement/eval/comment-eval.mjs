import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMENT_PROMPT_VERSION, buildBlogCommentMessages, validateBlogComment } from '../lib/comment-prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, 'fixtures/comment-golden.jsonl');
const reportDir = path.join(here, 'reports');
const endpointArg = process.argv.find((arg) => arg.startsWith('--endpoint='));
const endpoint = endpointArg ? endpointArg.slice('--endpoint='.length).replace(/\/$/, '') : '';

const rows = (await fs.readFile(fixturePath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const results = [];

for (const row of rows) {
  const context = { title: row.title, contentSnippet: row.contentSnippet, imageSummary: row.imageSummary };
  let candidate = row.candidate;
  let latencyMs = 0;
  let modelId = 'fixture-candidate';
  if (endpoint) {
    const started = performance.now();
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: buildBlogCommentMessages({ ...context, tone: row.tone || 'friendly', recentComments: row.recentComments || [] }),
        temperature: 0,
        seed: 42,
        max_tokens: 150
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Model endpoint failed: ${response.status}`);
    const payload = await response.json();
    candidate = String(payload.choices?.[0]?.message?.content || '').trim();
    modelId = payload.model || 'live-model';
    latencyMs = Math.round(performance.now() - started);
  }
  const validation = validateBlogComment(candidate, context, row.recentComments || []);
  const expectedReasons = row.expected?.reasons || [];
  const staticPass = endpoint ? null : validation.ok === row.expected?.ok
    && expectedReasons.every((reason) => validation.reasons.includes(reason))
    && (!row.expected?.action || validation.action === row.expected.action);
  const messages = buildBlogCommentMessages({ ...context, tone: row.tone || 'friendly', recentComments: row.recentComments || [] });
  results.push({
    id: row.id,
    category: row.category,
    promptVersion: COMMENT_PROMPT_VERSION,
    promptHash: crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
    modelId,
    candidate,
    validation,
    expected: row.expected,
    staticPass,
    latencyMs
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  mode: endpoint ? 'live-model' : 'static-regression',
  endpoint: endpoint || null,
  promptVersion: COMMENT_PROMPT_VERSION,
  total: results.length,
  valid: results.filter((row) => row.validation.ok).length,
  skipped: results.filter((row) => row.validation.action === 'skip').length,
  staticPassed: results.filter((row) => row.staticPass === true).length,
  staticFailed: results.filter((row) => row.staticPass === false).length,
  averageLatencyMs: endpoint ? Math.round(results.reduce((sum, row) => sum + row.latencyMs, 0) / results.length) : null,
  rejectionReasons: results.flatMap((row) => row.validation.reasons).reduce((acc, reason) => ({ ...acc, [reason]: (acc[reason] || 0) + 1 }), {})
};

await fs.mkdir(reportDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await fs.writeFile(path.join(reportDir, `${stamp}.json`), `${JSON.stringify({ summary, results }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (!endpoint && summary.staticFailed) process.exitCode = 1;

