import fs from 'node:fs';
import { validateBlogComment } from '../../../apps/engagement/lib/comment-prompt.js';

const file = process.argv[2];
if (!file) throw new Error('benchmark JSON path is required');
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const totals = {};
for (const row of report.cases) {
  const context = { title: row.topic, contentSnippet: row.facts.join(' '), imageSummary: '' };
  for (const [model, output] of Object.entries(row.outputs)) {
    const validation = validateBlogComment(output.text, context, []);
    const actionCorrect = row.expectedAction === 'skip' ? output.text === 'SKIP' : validation.ok && output.text !== 'SKIP';
    output.validation = validation;
    output.actionCorrect = actionCorrect;
    output.score = (actionCorrect ? 4 : 0) + (validation.ok ? 3 : 0) + (output.text.length >= 15 && output.text.length <= 120 ? 2 : 0) + (validation.keywords?.length ? 1 : 0);
    totals[model] ||= { score: 0, actionCorrect: 0, validatorPass: 0, seconds: 0, cases: 0 };
    totals[model].score += output.score;
    totals[model].actionCorrect += Number(actionCorrect);
    totals[model].validatorPass += Number(validation.ok);
    totals[model].seconds += output.seconds;
    totals[model].cases += 1;
  }
}
for (const value of Object.values(totals)) {
  value.averageScore = Number((value.score / value.cases).toFixed(2));
  value.averageSeconds = Number((value.seconds / value.cases).toFixed(3));
}
report.summary = totals;
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(totals, null, 2));
