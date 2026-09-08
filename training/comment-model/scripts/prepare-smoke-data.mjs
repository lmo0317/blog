import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildBlogCommentMessages } from '../../../apps/engagement/lib/comment-prompt.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const inputPath = path.join(root, 'apps', 'engagement', 'eval', 'fixtures', 'comment-golden.jsonl');
const outputPath = path.join(root, 'training', 'comment-model', 'data', 'processed', 'smoke-100.jsonl');
const reportPath = path.join(root, 'training', 'comment-model', 'data', 'reports', 'smoke-100.json');
const fixtures = fs.readFileSync(inputPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const approved = fixtures.filter((row) => row.expected?.ok === true);

if (approved.length < 10) throw new Error(`Need at least 10 approved golden fixtures, found ${approved.length}`);

const rows = Array.from({ length: 100 }, (_, index) => {
  const source = approved[index % approved.length];
  return {
    id: `smoke-${String(index + 1).padStart(3, '0')}`,
    messages: [
      ...buildBlogCommentMessages(source),
      { role: 'assistant', content: source.candidate }
    ],
    meta: {
      sourceFixture: source.id,
      category: source.category,
      promptVersion: 'comment-system-v1',
      smokeOnly: true,
      duplicatedForPipelineTest: true,
      approvedForProductionSft: false
    }
  };
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const body = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
fs.writeFileSync(outputPath, body, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify({
  createdAt: new Date().toISOString(),
  records: rows.length,
  uniqueFixtures: approved.length,
  sha256: createHash('sha256').update(body).digest('hex'),
  smokeOnly: true,
  productionTrainingAllowed: false
}, null, 2)}\n`, 'utf8');
console.log(`Prepared ${rows.length} smoke-only records from ${approved.length} unique fixtures.`);
