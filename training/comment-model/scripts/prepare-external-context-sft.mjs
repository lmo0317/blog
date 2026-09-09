import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const input = path.join(root, 'training/comment-model/data/staged/reference-review-queue.jsonl');
const output = path.join(root, 'training/comment-model/data/processed/external-context-research-v2.jsonl');
const reportPath = path.join(root, 'training/comment-model/data/reports/external-context-research-v2.json');
const rows = fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);

const system = `네이버 블로그 글에 남길 짧고 자연스러운 한국어 맞춤 댓글을 작성한다.
본문 사실에만 반응하고 독자가 직접 방문·구매·사용했다고 지어내지 않는다.
근거 없는 소문, 광고, URL, 이웃 신청, 상투적인 인사말은 쓰지 않는다.
본문 정보가 부족하거나 안전하게 댓글을 만들 수 없으면 SKIP만 출력한다.`;

const examples = [];
const byCategory = {};
for (const [index, row] of rows.entries()) {
  const valid = (row.candidateComments || []).filter((item) => item.validation?.ok === true);
  const answer = row.shouldSkip || valid.length === 0 ? 'SKIP' : valid[0].comment;
  const facts = (row.facts || []).map((fact) => `- ${fact}`).join('\n');
  const user = `카테고리: ${row.category}\n글 주제: ${row.topic}\n본문에서 확인된 사실:\n${facts}\n\n댓글 한 개만 출력하세요.`;
  examples.push({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
      { role: 'assistant', content: answer }
    ],
    meta: {
      sourceType: row.sourceType,
      sourceFingerprint: row.sourceFingerprint,
      sourcePolicy: row.sourcePolicy,
      externalInternetOnly: true,
      automaticallyValidated: answer !== 'SKIP',
      approvedForProductionSft: false,
      researchOnly: true
    }
  });
  byCategory[row.category] = (byCategory[row.category] || 0) + 1;
  if (index % 4 === 0) {
    examples.push({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `카테고리: ${row.category}\n글 주제: ${row.topic}\n본문에서 확인된 사실:\n- 확인 가능한 구체적 사실 없음\n\n댓글 한 개만 출력하세요.` },
        { role: 'assistant', content: 'SKIP' }
      ],
      meta: {
        sourceType: 'externally-grounded-abstention',
        sourceFingerprint: row.sourceFingerprint,
        sourcePolicy: row.sourcePolicy,
        externalInternetOnly: true,
        automaticallyValidated: true,
        approvedForProductionSft: false,
        researchOnly: true
      }
    });
  }
}

const body = `${examples.map((row) => JSON.stringify(row)).join('\n')}\n`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(output, body, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify({
  createdAt: new Date().toISOString(),
  records: examples.length,
  comments: examples.filter((row) => row.messages.at(-1).content !== 'SKIP').length,
  skips: examples.filter((row) => row.messages.at(-1).content === 'SKIP').length,
  byCategory,
  externalInternetOnly: true,
  productionReady: false,
  sha256: createHash('sha256').update(body).digest('hex')
}, null, 2)}\n`, 'utf8');
console.log(`Prepared ${examples.length} external-context research examples.`);
